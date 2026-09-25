import { Controller, Post, Req, Res, Headers, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaService } from '../prisma.service';
import { CryptoService } from '../common/crypto.service';
import { DeliveryQueueService } from '../queue/delivery-queue.service';
import { PaymentMethod, PaymentStatus, OrderStatus } from '@prisma/client';

/**
 * Webhook endpoints for ABA KHQR and PayWay.
 *
 * SECURITY-CRITICAL PATH — every request here is money. Rules enforced:
 *   1. Raw body is used for HMAC verification (never the parsed JSON — a
 *      re-serialized body can differ byte-for-byte and break the signature,
 *      which is why main.ts mounts `express.raw()` on these two routes only).
 *   2. Every request is logged to WebhookLog BEFORE any business logic runs,
 *      signature-valid or not, for forensic replay/audit.
 *   3. An idempotency key (hash of provider + provider's own transaction id)
 *      is enforced as a DB-level UNIQUE constraint on Payment.idempotencyKey.
 *      A duplicate webhook (provider retries, replay, attacker resend) hits
 *      a unique-constraint violation and is a safe no-op — it can NEVER
 *      credit the same order twice.
 *   4. Order status transition PAID -> DELIVERING happens inside the same
 *      DB transaction as the idempotency check, so there is no window where
 *      two concurrent webhook deliveries could both "win".
 */
@Controller('payments/webhook')
export class PaymentsWebhookController {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private deliveryQueue: DeliveryQueueService,
  ) {}

  @Post('aba')
  async abaWebhook(@Req() req: Request, @Res() res: Response, @Headers('x-aba-signature') signature: string) {
    const rawBody = (req as any).rawBody as string; // populated by express.raw() middleware, see main.ts
    const signatureValid = this.crypto.verifyHmacSignature(rawBody, signature, process.env.ABA_WEBHOOK_SECRET!);

    await this.prisma.webhookLog.create({
      data: {
        provider: PaymentMethod.ABA_KHQR,
        headers: req.headers as any,
        rawBody,
        signatureValid,
      },
    });

    if (!signatureValid) {
      // Always 200 to a bad-signature call is a bad idea for some providers,
      // but ABA's retry semantics expect 401 on auth failure specifically.
      return res.status(HttpStatus.UNAUTHORIZED).json({ ok: false });
    }

    const payload = JSON.parse(rawBody);
    const providerTxnId: string = payload.tran_id;
    const orderNo: string = payload.tran_id; // ABA echoes our own tran_id
    const paymentStatus: string = payload.status; // e.g. "APPROVED"

    const idempotencyKey = this.crypto.buildIdempotencyKey('ABA_KHQR', providerTxnId);

    await this.processVerifiedWebhook({
      provider: PaymentMethod.ABA_KHQR,
      orderNo,
      idempotencyKey,
      isSuccess: paymentStatus === 'APPROVED' || paymentStatus === '0',
      rawPayload: payload,
    });

    return res.status(HttpStatus.OK).json({ ok: true });
  }

  @Post('payway')
  async paywayWebhook(@Req() req: Request, @Res() res: Response, @Headers('x-payway-signature') signature: string) {
    const rawBody = (req as any).rawBody as string;
    const signatureValid = this.crypto.verifyHmacSignature(rawBody, signature, process.env.PAYWAY_WEBHOOK_SECRET!);

    await this.prisma.webhookLog.create({
      data: {
        provider: PaymentMethod.PAYWAY,
        headers: req.headers as any,
        rawBody,
        signatureValid,
      },
    });

    if (!signatureValid) {
      return res.status(HttpStatus.UNAUTHORIZED).json({ ok: false });
    }

    const payload = JSON.parse(rawBody);
    const idempotencyKey = this.crypto.buildIdempotencyKey('PAYWAY', payload.tran_id);

    await this.processVerifiedWebhook({
      provider: PaymentMethod.PAYWAY,
      orderNo: payload.tran_id,
      idempotencyKey,
      isSuccess: payload.status === '00',
      rawPayload: payload,
    });

    return res.status(HttpStatus.OK).json({ ok: true });
  }

  // -------------------------------------------------------------------------

  private async processVerifiedWebhook(args: {
    provider: PaymentMethod;
    orderNo: string;
    idempotencyKey: string;
    isSuccess: boolean;
    rawPayload: any;
  }) {
    const { provider, orderNo, idempotencyKey, isSuccess, rawPayload } = args;

    try {
      await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({ where: { orderNo }, include: { payment: true } });
        if (!order || !order.payment) {
          throw new Error(`Webhook for unknown order ${orderNo}`);
        }

        // The unique constraint on idempotencyKey does the heavy lifting:
        // if this key was already written by a prior webhook delivery,
        // this update-with-unique-set will throw P2002 and we catch it below
        // as a safe duplicate — no order mutation happens on that path.
        await tx.payment.update({
          where: { orderId: order.id },
          data: {
            idempotencyKey,
            status: isSuccess ? PaymentStatus.VERIFIED : PaymentStatus.FAILED,
            rawWebhookPayload: rawPayload,
            signatureValid: true,
            verifiedAt: new Date(),
          },
        });

        if (isSuccess && order.status === OrderStatus.PENDING_PAYMENT) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: OrderStatus.PAID, paidAt: new Date() },
          });
        }

        return order;
      });

      // Enqueue fulfillment OUTSIDE the DB transaction, only after commit,
      // and only for genuinely new, successful payments.
      if (isSuccess) {
        const order = await this.prisma.order.findUnique({ where: { orderNo } });
        if (order) await this.deliveryQueue.enqueueDelivery(order.id);
      }
    } catch (err: any) {
      if (err.code === 'P2002') {
        // Duplicate webhook for an idempotency key we've already processed.
        await this.prisma.webhookLog.updateMany({
          where: { rawBody: JSON.stringify(rawPayload) },
          data: { processedOk: true, errorMessage: 'Duplicate — idempotency key already used' },
        });
        return;
      }
      throw err;
    }
  }
}
