use rand::RngCore;

/// 32-character unambiguous Crockford-style alphabet (5 bits per char => 12 chars = 60 bits).
/// Excludes 0, O, 1, I, L to prevent visual transcription mistakes.
const JOIN_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";

pub fn generate_join_code() -> String {
    let mut rng = rand::rngs::OsRng;
    let mut raw = [0u8; 12];
    rng.fill_bytes(&mut raw);

    let mut out = String::with_capacity(14);
    for (idx, byte) in raw.iter().enumerate() {
        if idx > 0 && idx % 4 == 0 {
            out.push('-');
        }
        let ch = JOIN_ALPHABET[(*byte as usize) % JOIN_ALPHABET.len()] as char;
        out.push(ch);
    }
    out
}

pub fn normalize_join_code(input: &str) -> String {
    input
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

pub fn format_join_code(canonical: &str) -> String {
    let norm = normalize_join_code(canonical);
    let mut formatted = String::with_capacity(14);
    for (i, ch) in norm.chars().enumerate() {
        if i > 0 && i % 4 == 0 {
            formatted.push('-');
        }
        formatted.push(ch);
    }
    formatted
}

pub fn is_valid_join_code(input: &str) -> bool {
    let norm = normalize_join_code(input);
    norm.len() == 12 && norm.bytes().all(|b| JOIN_ALPHABET.contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_valid_12_char_grouped_codes() {
        let code = generate_join_code();
        assert_eq!(code.len(), 14);
        assert!(is_valid_join_code(&code));
        assert_eq!(format_join_code(&normalize_join_code(&code)), code);
    }
}
