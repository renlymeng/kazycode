import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto.service';
import { OAuth2Client } from 'google-auth-library';

@Injectable()
export class AuthService {
  private googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private crypto: CryptoService,
  ) {}

  // ---------------------------------------------------------------------
  // STAFF LOGIN (Admin / Support) — password + mandatory TOTP MFA
  // No email OTP anywhere in this flow, per product requirement.
  // ---------------------------------------------------------------------

  /** Step 1: verify email + password. Returns a short-lived pre-auth token, NOT a session. */
  async staffLoginStep1(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !['ADMIN', 'SUPER_ADMIN', 'SUPPORT'].includes(user.role)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (!user.mfaEnabled) {
      // First-time login: force MFA enrollment before any session is issued.
      return { requiresMfaSetup: true, preAuthToken: this.signPreAuthToken(user.id) };
    }
    return { requiresMfaCode: true, preAuthToken: this.signPreAuthToken(user.id) };
  }

  /** Step 2: verify the 6-digit TOTP code from an authenticator app (Google/Microsoft Authenticator). */
  async staffLoginStep2(preAuthToken: string, totpCode: string) {
    const { sub: userId } = this.jwt.verify(preAuthToken, { secret: process.env.PREAUTH_JWT_SECRET });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret) throw new BadRequestException('MFA not configured for this account');

    const secret = this.crypto.decryptField(user.mfaSecret);
    const verified = speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: totpCode,
      window: 1, // allow ±30s clock drift
    });
    if (!verified) throw new UnauthorizedException('Invalid or expired authentication code');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    return this.issueSessionToken(user.id, user.role, true);
  }

  /** Generates a new TOTP secret + QR code for enrollment; secret stored encrypted only after confirm. */
  async beginMfaEnrollment(preAuthToken: string) {
    const { sub: userId } = this.jwt.verify(preAuthToken, { secret: process.env.PREAUTH_JWT_SECRET });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const secret = speakeasy.generateSecret({
      name: `TopUpAdmin (${user.email})`,
      length: 32,
    });
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url!);

    // Store temporarily in Redis keyed by userId with short TTL in the real
    // implementation (injected RedisService); the secret is only persisted
    // to Postgres, encrypted, once the user proves possession in confirmMfaEnrollment.
    return { qrDataUrl, base32Secret: secret.base32, preAuthToken };
  }

  async confirmMfaEnrollment(preAuthToken: string, base32Secret: string, totpCode: string) {
    const { sub: userId } = this.jwt.verify(preAuthToken, { secret: process.env.PREAUTH_JWT_SECRET });

    const verified = speakeasy.totp.verify({
      secret: base32Secret,
      encoding: 'base32',
      token: totpCode,
      window: 1,
    });
    if (!verified) throw new UnauthorizedException('Code did not match — scan the QR again');

    const encrypted = this.crypto.encryptField(base32Secret);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: encrypted, mfaEnabled: true, lastLoginAt: new Date() },
    });

    return this.issueSessionToken(user.id, user.role, true);
  }

  // ---------------------------------------------------------------------
  // CUSTOMER LOGIN — Google One-Tap / Telegram Login Widget. No password.
  // ---------------------------------------------------------------------

  async loginWithGoogle(idToken: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) throw new UnauthorizedException('Invalid Google token');

    const user = await this.prisma.user.upsert({
      where: { googleId: payload.sub },
      update: { lastLoginAt: new Date() },
      create: {
        googleId: payload.sub,
        email: payload.email,
        displayName: payload.name,
        role: 'CUSTOMER',
      },
    });
    return this.issueSessionToken(user.id, user.role, false);
  }

  /**
   * Telegram Login Widget sends a signed payload. We verify it using the
   * HMAC of the bot token per Telegram's documented algorithm before trusting it.
   */
  async loginWithTelegram(payload: Record<string, string>) {
    const { hash, ...data } = payload;
    const checkString = Object.keys(data)
      .sort()
      .map((k) => `${k}=${data[k]}`)
      .join('\n');

    const secretKey = require('crypto').createHash('sha256').update(process.env.TELEGRAM_BOT_TOKEN!).digest();
    const hmac = require('crypto').createHmac('sha256', secretKey).update(checkString).digest('hex');
    if (hmac !== hash) throw new UnauthorizedException('Invalid Telegram login signature');

    // Reject stale login attempts (older than 5 minutes) to prevent replay.
    const authDate = parseInt(data.auth_date, 10);
    if (Date.now() / 1000 - authDate > 300) {
      throw new UnauthorizedException('Telegram login expired, please try again');
    }

    const user = await this.prisma.user.upsert({
      where: { telegramId: data.id },
      update: { lastLoginAt: new Date() },
      create: {
        telegramId: data.id,
        displayName: data.username || data.first_name,
        role: 'CUSTOMER',
      },
    });
    return this.issueSessionToken(user.id, user.role, false);
  }

  // ---------------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------------

  private signPreAuthToken(userId: string) {
    return this.jwt.sign({ sub: userId }, { secret: process.env.PREAUTH_JWT_SECRET, expiresIn: '5m' });
  }

  private issueSessionToken(userId: string, role: string, mfaVerified: boolean) {
    const accessToken = this.jwt.sign(
      { sub: userId, role, mfaVerified },
      { secret: process.env.JWT_SECRET, expiresIn: '15m' },
    );
    const refreshToken = this.jwt.sign(
      { sub: userId, type: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '30d' },
    );
    return { accessToken, refreshToken };
  }
}
