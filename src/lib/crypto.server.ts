/**
 * Server-only cryptography helpers.
 *
 * Message bodies and other sensitive values are encrypted at rest with
 * AES-256-GCM using a key held only in the server environment
 * (MESSAGE_ENCRYPTION_KEY). MESSAGE_ENCRYPTION_KEY_PREVIOUS allows key
 * rotation: new writes use the current key, reads fall back to the previous
 * one so existing rows keep working until they are re-encrypted.
 *
 * All functions read env inside the call (never at module scope) so they work
 * on request-scoped runtimes.
 */

const ENC_VERSION = 1;

function decodeKey(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) out[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const bytes = Uint8Array.from(Buffer.from(trimmed, "base64"));
  if (bytes.length === 32) return bytes;
  // Fall back to a derived key so a shorter passphrase still yields 32 bytes.
  return new Uint8Array(0);
}

async function importKey(raw: string): Promise<CryptoKey> {
  let bytes = decodeKey(raw);
  if (bytes.length !== 32) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    bytes = new Uint8Array(digest);
  }
  return crypto.subtle.importKey("raw", bytes as unknown as ArrayBuffer, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

function currentKeyMaterial(): string | null {
  return process.env["MESSAGE_ENCRYPTION_KEY"] ?? null;
}

function previousKeyMaterial(): string | null {
  return process.env["MESSAGE_ENCRYPTION_KEY_PREVIOUS"] ?? null;
}

export function encryptionEnabled(): boolean {
  return Boolean(currentKeyMaterial());
}

export type SealedValue = {
  cipher: string;
  nonce: string;
  version: number;
};

/**
 * Encrypts a plaintext string. Returns null when no key is configured, so
 * callers can fall back to storing plaintext during initial rollout.
 */
export async function seal(plaintext: string): Promise<SealedValue | null> {
  const material = currentKeyMaterial();
  if (!material) return null;
  const key = await importKey(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    key,
    data as unknown as ArrayBuffer,
  );
  return {
    cipher: Buffer.from(new Uint8Array(encrypted)).toString("base64"),
    nonce: Buffer.from(iv).toString("base64"),
    version: ENC_VERSION,
  };
}

async function tryOpen(material: string, cipher: string, nonce: string): Promise<string | null> {
  try {
    const key = await importKey(material);
    const iv = Uint8Array.from(Buffer.from(nonce, "base64"));
    const bytes = Uint8Array.from(Buffer.from(cipher, "base64"));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
      key,
      bytes as unknown as ArrayBuffer,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

/** Decrypts a sealed value, trying the current key then the previous key. */
export async function open(cipher: string | null, nonce: string | null): Promise<string | null> {
  if (!cipher || !nonce) return null;
  const current = currentKeyMaterial();
  if (current) {
    const plain = await tryOpen(current, cipher, nonce);
    if (plain !== null) return plain;
  }
  const previous = previousKeyMaterial();
  if (previous) {
    const plain = await tryOpen(previous, cipher, nonce);
    if (plain !== null) return plain;
  }
  return null;
}

/** SHA-256 hex digest — used for API key storage and lookup. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison for signatures and tokens. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

/** HMAC-SHA256 hex signature, used for signed media URLs and webhooks. */
export async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload) as unknown as ArrayBuffer,
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Signs a storage object path with an expiry, for the media proxy. */
export async function signMediaPath(path: string, expiresAtMs: number): Promise<string> {
  const secret = process.env["MEDIA_URL_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  return hmacHex(secret, `${path}:${expiresAtMs}`);
}

export async function verifyMediaSignature(
  path: string,
  expiresAtMs: number,
  signature: string,
): Promise<boolean> {
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return false;
  const expected = await signMediaPath(path, expiresAtMs);
  return timingSafeEqualStrings(expected, signature);
}
