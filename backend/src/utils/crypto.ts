import crypto from "crypto";
import { config } from "../config";

const ALGO = "aes-256-gcm";
const key = Buffer.from(config.masterKeyHex, "hex");

if (key.length !== 32) {
  throw new Error("MASTER_KEY must be 32 bytes (64 hex characters)");
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // store iv:authTag:ciphertext, all hex
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}
