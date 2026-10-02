import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

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

// Reversible encryption for things coaches need to see again (join codes).
const encryptionKey = () => createHash("sha256").update(`enc:${secret()}`).digest();

/** AES-256-GCM; output is base64url iv.tag.ciphertext. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
}

/** Null if the value is missing or was encrypted with a different SESSION_SECRET. */
export function decrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const [iv, tag, data] = value.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
