// Cryptography Helper for ReplyGenius AI using Web Crypto API (AES-GCM)
// Compatible with Cloudflare Workers and Modern Web Browsers

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Derives a 256-bit AES-GCM key from a master key string using SHA-256.
 */
async function deriveKey(masterKeyText) {
  const encoder = new TextEncoder();
  const keyData = await crypto.subtle.digest('SHA-256', encoder.encode(masterKeyText));
  return await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts cleartext using a master key text and returns a base64 string.
 */
export async function encryptText(text, masterKeyText) {
  if (!text) return '';
  if (!masterKeyText) throw new Error("Encryption key not configured");

  const encoder = new TextEncoder();
  const key = await deriveKey(masterKeyText);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // AES-GCM standard IV length is 12 bytes

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoder.encode(text)
  );

  const ciphertext = new Uint8Array(ciphertextBuffer);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(ciphertext, iv.byteLength);

  return arrayBufferToBase64(combined.buffer);
}

/**
 * Decrypts a base64 string using a master key text and returns the cleartext.
 */
export async function decryptText(encryptedBase64, masterKeyText) {
  if (!encryptedBase64) return '';
  if (!masterKeyText) throw new Error("Decryption key not configured");

  try {
    const key = await deriveKey(masterKeyText);
    const combined = new Uint8Array(base64ToArrayBuffer(encryptedBase64));
    
    if (combined.length < 13) {
      throw new Error("Invalid encrypted payload size");
    }

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext.buffer
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt credentials. Ensure the SECRET_ENCRYPTION_KEY is correct.");
  }
}
