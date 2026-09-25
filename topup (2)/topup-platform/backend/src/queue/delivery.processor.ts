import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import axios from 'axios';
import { PrismaClient, OrderStatus, DeliveryStatus } from '@prisma/client';

/**
 * Standalone worker process (run as `node dist/queue/delivery.processor.js`
 * in its own container/dyno, separate from the API server, so a slow
 * provider API never blocks HTTP request handling).
 *
 * Each attempt is written to DeliveryAttempt for full auditability — an
 * admin can see exactly why a given order's delivery failed and how many
 * times it was retried, without digging through logs.
 */
const prisma = new PrismaClient();
const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const worker = new Worker(
  'game-delivery',
  async (job: Job<{ orderId: string }>) => {
    const { orderId } = job.data;

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { game: true, package: true },
    });

    // Idempotency at the business level too: if this order was already
    // marked DELIVERED (e.g. a retried job landed after a prior attempt
    // actually succeeded but the worker crashed before ack), skip cleanly.
    if (order.status === OrderStatus.DELIVERED) {
      return { skipped: true, reason: 'already delivered' };
    }

    const attempt = await prisma.deliveryAttempt.create({
      data: { orderId, attemptNo: job.attemptsMade + 1, status: DeliveryStatus.PROCESSING },
    });

    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.DELIVERING } });

    try {
      const providerResponse = await callFulfillmentProvider(order);

      await prisma.$transaction([
        prisma.deliveryAttempt.update({
          where: { id: attempt.id },
          data: { status: DeliveryStatus.SUCCESS, providerResponse, finishedAt: new Date() },
        }),
        prisma.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.DELIVERED, deliveredAt: new Date() },
        }),
      ]);

      return { success: true };
    } catch (err: any) {
      const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 5);

      await prisma.deliveryAttempt.update({
        where: { id: attempt.id },
        data: {
          status: isFinalAttempt ? DeliveryStatus.FAILED_PERMANENT : DeliveryStatus.RETRY_SCHEDULED,
          errorMessage: err?.message ?? 'Unknown fulfillment error',
          finishedAt: new Date(),
        },
      });

      if (isFinalAttempt) {
        // Permanently failed after all retries: flag for manual admin
        // intervention (refund or manual credit) rather than silently
        // leaving the customer's order stuck.
        await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.FAILED } });
      }

      throw err; // re-throw so BullMQ schedules the next retry with backoff
    }
  },
  { connection, concurrency: 10 },
);

async function callFulfillmentProvider(order: any) {
  // Routed by game.publisherCode — each publisher has its own item-delivery
  // API contract; this is the production call, not a stub.
  const { data } = await axios.post(
    `${process.env.FULFILLMENT_API_BASE_URL}/deliver`,
    {
      publisher_code: order.game.publisherCode,
      player_id: order.playerId,
      player_server: order.playerServer,
      sku: order.package.providerSku,
      reference: order.orderNo,
    },
    {
      headers: { Authorization: `Bearer ${process.env.FULFILLMENT_API_KEY}` },
      timeout: 15000,
    },
  );
  if (!data?.success) throw new Error(data?.message ?? 'Provider rejected delivery');
  return data;
}

worker.on('failed', (job, err) => {
  console.error(`[delivery] job ${job?.id} failed permanently or will retry:`, err.message);
});

export default worker;
