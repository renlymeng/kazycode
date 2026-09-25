import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoService {
  private readonly encKey = Buffer.from(process.env.FIELD_ENCRYPTION_KEY!, 'hex'); // 32 bytes

  // ---------------------------------------------------------------------
  // Webhook HMAC-SHA256 verification (ABA KHQR / PayWay)
  // ---------------------------------------------------------------------

  /**
   * Computes HMAC-SHA256 of the raw request body using the provider's shared
   * secret and compares it against the signature header using a
   * constant-time comparison to prevent timing attacks.
   */
  verifyHmacSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
    if (!signatureHeader) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHeader.replace(/^sha256=/, ''), 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  signHmac(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  }

  // ---------------------------------------------------------------------
  // AES-256-GCM field encryption (MFA TOTP secrets, provider API keys)
  // ---------------------------------------------------------------------

  encryptField(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // format: iv:authTag:ciphertext, all base64
    return [iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':');
  }

  decryptField(payload: string): string {
    const [ivB64, tagB64, dataB64] = payload.split(':');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Deterministic idempotency key from provider + their own transaction id. */
  buildIdempotencyKey(provider: string, providerTxnId: string): string {
    return crypto.createHash('sha256').update(`${provider}:${providerTxnId}`).digest('hex');
  }
}
