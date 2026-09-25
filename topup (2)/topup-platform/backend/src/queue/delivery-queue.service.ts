import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

/**
 * Producer side of the fulfillment queue. A paid order is enqueued here;
 * the DeliveryProcessor (separate worker process) consumes it, calls the
 * game-item provider API, and marks the order DELIVERED — with automatic
 * retries and exponential backoff if the provider is briefly unavailable.
 */
@Injectable()
export class DeliveryQueueService {
  private redisConnection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

  private queue = new Queue('game-delivery', {
    connection: this.redisConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s, 20s, 40s, 80s
      removeOnComplete: 1000,
      removeOnFail: false, // keep failed jobs for manual admin review
    },
  });

  async enqueueDelivery(orderId: string) {
    // jobId = orderId guarantees BullMQ-level de-duplication too, as a second
    // layer behind the DB idempotency key — the same order can never be
    // queued twice concurrently.
    await this.queue.add('deliver', { orderId }, { jobId: orderId });
  }
}
