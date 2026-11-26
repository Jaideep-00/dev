/**
 * 32-character unambiguous alphabet (excludes 0, 1, I, O)
 * 5 bits per character => 60 bits for 12 characters (e.g. 7K2P-9QXM-4TDA).
 */
export const JOIN_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface JoinCodeParseResult {
  ok: true;
  canonical: string; // 12 uppercase chars
  grouped: string;   // XXXX-XXXX-XXXX
}

export interface JoinCodeParseError {
  ok: false;
  error: string;
}

export function generateJoinCode(): string {
  const random = new Uint8Array(12);
  crypto.getRandomValues(random);
  let chars = '';
  for (let i = 0; i < 12; i++) {
    chars += JOIN_CODE_ALPHABET[random[i] & 0x1f];
  }
  return formatGroupedCode(chars);
}

export function formatGroupedCode(canonical12: string): string {
  return `${canonical12.slice(0, 4)}-${canonical12.slice(4, 8)}-${canonical12.slice(8, 12)}`;
}

export function parseJoinCode(input: string): JoinCodeParseResult | JoinCodeParseError {
  let canonical = '';
  for (const ch of input) {
    if (ch === '-' || /\s/.test(ch)) continue;
    const upper = ch.toUpperCase();
    if (!JOIN_CODE_ALPHABET.includes(upper)) {
      return {
        ok: false,
        error: `Character "${ch}" is not allowed in join codes (0, 1, I, O are excluded).`,
      };
    }
    canonical += upper;
    if (canonical.length > 12) {
      return { ok: false, error: 'Join code must be exactly 12 characters.' };
    }
  }
  if (canonical.length !== 12) {
    return {
      ok: false,
      error: `Expected 12 characters (${canonical.length} entered). Format: XXXX-XXXX-XXXX.`,
    };
  }
  return {
    ok: true,
    canonical,
    grouped: formatGroupedCode(canonical),
  };
}
