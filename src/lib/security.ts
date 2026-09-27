import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { TOTP, Secret } from "otpauth";

export function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function validatePassword(password: string): void {
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Use a password of at least 12 characters and at most 72 UTF-8 bytes.");
  }
}
function key(): Buffer {
  const value = process.env.AUTH_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error("MFA encryption is not configured.");
  return Buffer.from(value, "hex");
}
export function encryptSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(v => v.toString("base64url")).join(".");
}
export function decryptSecret(value: string): string {
  const [iv, tag, data] = value.split(".").map(v => Buffer.from(v, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
export function authenticator(secret: string, email: string): TOTP {
  return new TOTP({ issuer: "Ledger", label: email, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}
export function totpStep(secret: string, code: string, timestamp = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = authenticator(secret, "").validate({ token: code, timestamp, window: 1 });
  return delta === null ? null : Math.floor(timestamp / 30000) + delta;
}
