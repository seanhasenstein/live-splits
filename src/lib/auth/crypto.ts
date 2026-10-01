import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

// No 0/O/1/I so codes read unambiguously off a phone screen.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set (add it to .env.local)");
  return s;
}

/** Join codes are case-insensitive and may be typed with spaces or dashes. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Keyed hash, so a typed code can be looked up by hashing it. Never store the plaintext. */
export function hashSecret(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

export function hashCode(code: string): string {
  return hashSecret(`code:${normalizeCode(code)}`);
}

export function generateCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Shown as "ABC-DEF". */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return hashSecret(`token:${token}`);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
