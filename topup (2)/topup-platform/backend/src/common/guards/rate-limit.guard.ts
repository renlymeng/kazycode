import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Sliding-window rate limiter backed by Redis.
 * Applied to endpoints that are attractive to abuse: nickname lookup,
 * order creation, webhook replay probing, admin login.
 *
 * Usage: @UseGuards(new RateLimitGuard(redisClient, { windowSec: 60, max: 10 }))
 * or register per-route via a factory provider — see games.controller.ts.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly redis: Redis,
    private readonly opts: { windowSec: number; max: number; keyPrefix: string },
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip;

    const key = `ratelimit:${this.opts.keyPrefix}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, this.opts.windowSec);
    }

    if (count > this.opts.max) {
      throw new HttpException(
        'Too many requests — please slow down and try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
