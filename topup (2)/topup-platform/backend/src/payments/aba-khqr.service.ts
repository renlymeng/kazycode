import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma.service';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

/**
 * ABA PayWay KHQR integration. ABA's "Open API — KHQR" issues a QR payload
 * that customers scan in the ABA Mobile / any KHQR-compatible bank app.
 * Confirmation of payment arrives asynchronously via the signed webhook
 * (see payments-webhook.controller.ts) — this service only *creates* the
 * QR/payment intent, it never marks an order as paid itself.
 */
@Injectable()
export class AbaKhqrService {
  private readonly baseUrl = process.env.ABA_KHQR_API_URL!;
  private readonly merchantId = process.env.ABA_MERCHANT_ID!;
  private readonly apiKey = process.env.ABA_API_KEY!;

  constructor(private prisma: PrismaService) {}

  async createPaymentIntent(orderId: string, amount: number, currency: string, orderNo: string) {
    const { data } = await axios.post(
      `${this.baseUrl}/api/payment-gateway/v1/khqr/generate`,
      {
        merchant_id: this.merchantId,
        tran_id: orderNo,
        amount,
        currency,
        // ABA requires the webhook callback URL to be pre-registered per merchant,
        // but we also pass it explicitly where the API allows per-txn override.
        callback_url: `${process.env.API_PUBLIC_URL}/payments/webhook/aba`,
      },
      { headers: { Authorization: `Bearer ${this.apiKey}` }, timeout: 10000 },
    );

    await this.prisma.payment.create({
      data: {
        orderId,
        provider: PaymentMethod.ABA_KHQR,
        providerTxnRef: data.tran_id,
        qrString: data.qr_string,
        status: PaymentStatus.AWAITING_WEBHOOK,
      },
    });

    return { qrString: data.qr_string, qrImageUrl: data.qr_image_url, expiresInSec: data.expire_in ?? 900 };
  }
}
