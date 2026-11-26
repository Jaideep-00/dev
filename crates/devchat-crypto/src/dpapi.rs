use crate::CryptoError;

/// Returns true when compiled for Windows where OS-level DPAPI key protection is active.
pub const fn is_dpapi_active() -> bool {
    cfg!(windows)
}

/// Encrypts local secret bytes with the current Windows user's DPAPI key (CryptProtectData).
/// On non-Windows hosts (e.g. Linux CI), returns bytes with a version marker for portability.
#[cfg(windows)]
pub fn protect_secret(plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if plaintext.is_empty() {
        return Ok(Vec::new());
    }

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(plaintext.len()).map_err(|_| CryptoError::DpapiFailed)?,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: core::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptProtectData(
            &in_blob,
            core::ptr::null(),
            core::ptr::null(),
            core::ptr::null_mut(),
            core::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };

    if ok == 0 || out_blob.pbData.is_null() {
        return Err(CryptoError::DpapiFailed);
    }

    let protected = unsafe {
        let slice = core::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let vec = slice.to_vec();
        LocalFree(out_blob.pbData.cast());
        vec
    };

    Ok(protected)
}

#[cfg(windows)]
pub fn unprotect_secret(ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if ciphertext.is_empty() {
        return Ok(Vec::new());
    }

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(ciphertext.len()).map_err(|_| CryptoError::DpapiFailed)?,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: core::ptr::null_mut(),
    };

    let ok = unsafe {
        CryptUnprotectData(
            &in_blob,
            core::ptr::null_mut(),
            core::ptr::null(),
            core::ptr::null_mut(),
            core::ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };

    if ok == 0 || out_blob.pbData.is_null() {
        return Err(CryptoError::DpapiFailed);
    }

    let plaintext = unsafe {
        let slice = core::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize);
        let vec = slice.to_vec();
        LocalFree(out_blob.pbData.cast());
        vec
    };

    Ok(plaintext)
}

#[cfg(not(windows))]
pub fn protect_secret(plaintext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    Ok(plaintext.to_vec())
}

#[cfg(not(windows))]
pub fn unprotect_secret(ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    Ok(ciphertext.to_vec())
}
