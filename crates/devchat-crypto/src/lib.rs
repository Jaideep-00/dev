pub mod dpapi;

use base64::Engine as _;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use zeroize::Zeroize;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("invalid key length or encoding")]
    InvalidKey,
    #[error("invalid signature format or verification failed")]
    InvalidSignature,
    #[error("authenticated encryption failed")]
    EncryptionFailed,
    #[error("authenticated decryption failed (wrong key or tampered AAD/ciphertext)")]
    DecryptionFailed,
    #[error("Windows DPAPI protection failed")]
    DpapiFailed,
    #[error("invalid backup envelope")]
    InvalidBackup,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeIdentityKeypair {
    pub author_id: String,
    pub public_key_hex: String,
    pub secret_key_hex: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedBackupEnvelope {
    pub version: u8,
    pub kdf: String,
    pub iterations: u32,
    pub salt_base64: String,
    pub nonce_base64: String,
    pub ciphertext_base64: String,
}

pub fn generate_identity_keypair() -> NativeIdentityKeypair {
    let mut csprng = rand::rngs::OsRng;
    let signing = SigningKey::generate(&mut csprng);
    let verifying = signing.verifying_key();
    let pub_bytes = verifying.to_bytes();
    let fingerprint = sha256_hex(&pub_bytes);

    NativeIdentityKeypair {
        author_id: fingerprint[..16].to_string(),
        public_key_hex: hex::encode(pub_bytes),
        secret_key_hex: hex::encode(signing.to_bytes()),
    }
}

pub fn sign_payload(secret_key_hex: &str, message: &[u8]) -> Result<String, CryptoError> {
    let mut key_bytes = hex::decode(secret_key_hex).map_err(|_| CryptoError::InvalidKey)?;
    let arr: [u8; 32] = key_bytes
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::InvalidKey)?;
    let signing = SigningKey::from_bytes(&arr);
    let sig = signing.sign(message);
    key_bytes.zeroize();
    Ok(hex::encode(sig.to_bytes()))
}

pub fn verify_payload(
    public_key_hex: &str,
    message: &[u8],
    signature_hex: &str,
) -> Result<bool, CryptoError> {
    let pub_bytes = hex::decode(public_key_hex).map_err(|_| CryptoError::InvalidKey)?;
    let pub_arr: [u8; 32] = pub_bytes
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::InvalidKey)?;
    let verifying = VerifyingKey::from_bytes(&pub_arr).map_err(|_| CryptoError::InvalidKey)?;

    let sig_bytes = hex::decode(signature_hex).map_err(|_| CryptoError::InvalidSignature)?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| CryptoError::InvalidSignature)?;
    let sig = Signature::from_bytes(&sig_arr);

    Ok(verifying.verify(message, &sig).is_ok())
}

pub fn generate_room_key_base64() -> String {
    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    key.zeroize();
    encoded
}

/// Encrypts room message plaintext using XChaCha20-Poly1305 with AAD binding.
/// Output format: `hex(24-byte nonce || ciphertext+tag)`.
pub fn encrypt_room_payload(
    key_base64: &str,
    aad: &[u8],
    plaintext: &[u8],
) -> Result<String, CryptoError> {
    let mut key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key_base64)
        .map_err(|_| CryptoError::InvalidKey)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(&key_bytes).map_err(|_| CryptoError::InvalidKey)?;
    key_bytes.zeroize();

    let mut nonce_bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = XNonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    let mut combined = Vec::with_capacity(24 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(hex::encode(combined))
}

pub fn decrypt_room_payload(
    key_base64: &str,
    aad: &[u8],
    ciphertext_hex: &str,
) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key_base64)
        .map_err(|_| CryptoError::InvalidKey)?;
    let cipher =
        XChaCha20Poly1305::new_from_slice(&key_bytes).map_err(|_| CryptoError::InvalidKey)?;
    key_bytes.zeroize();

    let combined = hex::decode(ciphertext_hex).map_err(|_| CryptoError::DecryptionFailed)?;
    if combined.len() < 24 + 16 {
        return Err(CryptoError::DecryptionFailed);
    }
    let nonce = XNonce::from_slice(&combined[..24]);
    let ct = &combined[24..];

    cipher
        .decrypt(nonce, Payload { msg: ct, aad })
        .map_err(|_| CryptoError::DecryptionFailed)
}

/// Derives a rotating 5-minute HMAC-SHA256 LAN discovery token from the room key.
pub fn derive_discovery_token(key_base64: &str, unix_secs: u64) -> Result<String, CryptoError> {
    let mut key_bytes = base64::engine::general_purpose::STANDARD
        .decode(key_base64)
        .map_err(|_| CryptoError::InvalidKey)?;
    let bucket = unix_secs / 300;
    let label = format!("devchat-discovery-v1:{bucket}");

    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(&key_bytes).map_err(|_| CryptoError::InvalidKey)?;
    key_bytes.zeroize();
    mac.update(label.as_bytes());
    let digest = mac.finalize().into_bytes();
    Ok(hex::encode(&digest[..8]))
}

pub fn export_encrypted_backup(
    plaintext: &[u8],
    passphrase: &str,
) -> Result<EncryptedBackupEnvelope, CryptoError> {
    const ITERATIONS: u32 = 150_000;
    let mut salt = [0u8; 16];
    let mut nonce_bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);

    let mut derived = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), &salt, ITERATIONS, &mut derived);

    let cipher =
        XChaCha20Poly1305::new_from_slice(&derived).map_err(|_| CryptoError::InvalidKey)?;
    derived.zeroize();

    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce_bytes),
            Payload {
                msg: plaintext,
                aad: b"devchat-identity-backup-v1",
            },
        )
        .map_err(|_| CryptoError::EncryptionFailed)?;

    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(EncryptedBackupEnvelope {
        version: 1,
        kdf: "PBKDF2-HMAC-SHA256".to_string(),
        iterations: ITERATIONS,
        salt_base64: b64.encode(salt),
        nonce_base64: b64.encode(nonce_bytes),
        ciphertext_base64: b64.encode(ct),
    })
}

pub fn restore_encrypted_backup(
    envelope: &EncryptedBackupEnvelope,
    passphrase: &str,
) -> Result<Vec<u8>, CryptoError> {
    if envelope.version != 1 {
        return Err(CryptoError::InvalidBackup);
    }
    let b64 = base64::engine::general_purpose::STANDARD;
    let salt = b64
        .decode(&envelope.salt_base64)
        .map_err(|_| CryptoError::InvalidBackup)?;
    let nonce_bytes = b64
        .decode(&envelope.nonce_base64)
        .map_err(|_| CryptoError::InvalidBackup)?;
    let ct = b64
        .decode(&envelope.ciphertext_base64)
        .map_err(|_| CryptoError::InvalidBackup)?;

    if nonce_bytes.len() != 24 {
        return Err(CryptoError::InvalidBackup);
    }

    let mut derived = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(
        passphrase.as_bytes(),
        &salt,
        envelope.iterations,
        &mut derived,
    );

    let cipher =
        XChaCha20Poly1305::new_from_slice(&derived).map_err(|_| CryptoError::InvalidKey)?;
    derived.zeroize();

    cipher
        .decrypt(
            XNonce::from_slice(&nonce_bytes),
            Payload {
                msg: &ct,
                aad: b"devchat-identity-backup-v1",
            },
        )
        .map_err(|_| CryptoError::DecryptionFailed)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ed25519_sign_and_verify() {
        let kp = generate_identity_keypair();
        let sig = sign_payload(&kp.secret_key_hex, b"hello lan").unwrap();
        assert!(verify_payload(&kp.public_key_hex, b"hello lan", &sig).unwrap());
        assert!(!verify_payload(&kp.public_key_hex, b"tampered", &sig).unwrap());
    }

    #[test]
    fn xchacha20_roundtrip_and_aad_binding() {
        let key = generate_room_key_base64();
        let aad = b"room1:1:alice:42";
        let ct = encrypt_room_payload(&key, aad, b"encrypted message").unwrap();
        let pt = decrypt_room_payload(&key, aad, &ct).unwrap();
        assert_eq!(pt, b"encrypted message");
        assert!(decrypt_room_payload(&key, b"room1:2:alice:42", &ct).is_err());
    }

    #[test]
    fn backup_export_and_restore() {
        let env = export_encrypted_backup(b"secret-identity-json", "hunter2-strong").unwrap();
        let restored = restore_encrypted_backup(&env, "hunter2-strong").unwrap();
        assert_eq!(restored, b"secret-identity-json");
        assert!(restore_encrypted_backup(&env, "wrong-passphrase").is_err());
    }
}
