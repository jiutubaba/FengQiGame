import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const TOKEN_CIPHER_ALGORITHM = "aes-256-gcm";
const TOKEN_CIPHER_AAD = Buffer.from("fengqi-api-key-token:v1", "utf8");

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString("base64")}$${Buffer.from(key).toString("base64")}`;
}

export async function verifyPassword(password, storedHash) {
  try {
    const [algorithm, n, r, p, saltText, keyText] = storedHash.split("$");
    if (algorithm !== "scrypt") return false;
    const expected = Buffer.from(keyText, "base64");
    const actual = Buffer.from(
      await scrypt(password, Buffer.from(saltText, "base64"), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 64 * 1024 * 1024,
      }),
    );
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  } catch {
    return false;
  }
}

export function createOpaqueToken(prefix = "") {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptToken(token, encryptionKey) {
  const key = decodeTokenEncryptionKey(encryptionKey);
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_CIPHER_ALGORITHM, key, iv);
  cipher.setAAD(TOKEN_CIPHER_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptToken(payload, encryptionKey) {
  const [version, ivText, ciphertextText, tagText, extra] =
    String(payload).split(".");
  if (version !== "v1" || !ivText || !ciphertextText || !tagText || extra) {
    throw new Error("API Key 密文格式无效");
  }
  const decipher = createDecipheriv(
    TOKEN_CIPHER_ALGORITHM,
    decodeTokenEncryptionKey(encryptionKey),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAAD(TOKEN_CIPHER_AAD);
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function decodeTokenEncryptionKey(value) {
  const key = Buffer.from(String(value || ""), "base64url");
  if (key.length !== 32) throw new Error("API Key 加密密钥必须为 32 字节");
  return key;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function requestId() {
  return randomUUID();
}

export function sanitizeFileName(value) {
  return (
    value
      .normalize("NFKC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "unnamed"
  );
}

export function normalizeRelativePath(value = "") {
  const normalized = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map(sanitizeFileName)
    .join("/");
  return normalized.slice(0, 900);
}
