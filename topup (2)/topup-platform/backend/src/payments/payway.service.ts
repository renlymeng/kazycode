import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../prisma.service';
import { PaymentMethod, PaymentStatus } from '@prisma/client';

/**
 * ABA PayWay (card / account) checkout. PayWay requires each request to be
 * signed with a merchant hash (HMAC-SHA256 of the concatenated required
 * fields + the merchant's API secret) — this is separate from, and in
 * addition to, the inbound webhook signature verified later.
 */
@Injectable()
export class PaywayService {
  private readonly baseUrl = process.env.PAYWAY_API_URL!;
  private readonly merchantId = process.env.PAYWAY_MERCHANT_ID!;
  private readonly apiSecret = process.env.PAYWAY_API_SECRET!;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  async createCheckout(orderId: string, amount: number, currency: string, orderNo: string) {
    const reqTime = Date.now().toString();
    // PayWay's documented hash order: req_time + merchant_id + tran_id + amount
    const hashInput = `${reqTime}${this.merchantId}${orderNo}${amount}`;
    const hash = this.crypto.signHmac(hashInput, this.apiSecret);

    const { data } = await axios.post(
      `${this.baseUrl}/api/payment-gateway/v1/payments/purchase`,
      {
        req_time: reqTime,
        merchant_id: this.merchantId,
        tran_id: orderNo,
        amount,
        currency,
        return_url: `${process.env.API_PUBLIC_URL}/payments/webhook/payway`,
        continue_success_url: `${process.env.WEB_PUBLIC_URL}/order/${orderNo}/success`,
        hash,
      },
      { timeout: 10000 },
    );

    await this.prisma.payment.create({
      data: {
        orderId,
        provider: PaymentMethod.PAYWAY,
        providerTxnRef: data.tran_id,
        status: PaymentStatus.AWAITING_WEBHOOK,
      },
    });

    return { checkoutUrl: data.checkout_url };
  }
}
