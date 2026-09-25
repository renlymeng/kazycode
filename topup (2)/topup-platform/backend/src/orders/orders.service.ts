import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { GamesService } from '../games/games.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private games: GamesService,
  ) {}

  /**
   * Guest checkout: no account required. Player ID + package selection only.
   * The nickname is re-validated server-side right here — a customer cannot
   * submit a fabricated nickname from the client, because the price/identity
   * binding for fulfillment depends on it.
   */
  async createOrder(dto: CreateOrderDto, ip: string, userAgent: string, userId?: string) {
    const game = await this.games.getBySlug(dto.gameSlug);

    const pkg = game.packages.find((p) => p.id === dto.packageId);
    if (!pkg) throw new BadRequestException('Selected package is not available for this game.');

    const verification = await this.games.validatePlayerId(dto.gameSlug, dto.playerId, dto.playerServer);
    if (!verification.valid || !verification.nickname) {
      throw new BadRequestException('Could not verify this Player ID. Please check it and try again.');
    }

    const orderNo = await this.generateOrderNo();

    const order = await this.prisma.order.create({
      data: {
        orderNo,
        userId,
        gameId: game.id,
        packageId: pkg.id,
        playerId: dto.playerId,
        playerServer: dto.playerServer,
        playerNickname: verification.nickname,
        amount: pkg.amount,
        currency: pkg.currency,
        contactPhone: dto.contactPhone,
        ipAddress: ip,
        userAgent,
        status: OrderStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15-minute payment window
      },
    });

    return order;
  }

  async getByOrderNo(orderNo: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNo },
      include: { game: true, package: true, payment: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** Background job (cron) should call this every minute to expire stale unpaid orders. */
  async expireStaleOrders() {
    return this.prisma.order.updateMany({
      where: { status: OrderStatus.PENDING_PAYMENT, expiresAt: { lt: new Date() } },
      data: { status: OrderStatus.EXPIRED },
    });
  }

  private async generateOrderNo(): Promise<string> {
    const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seq = await this.prisma.order.count({
      where: { createdAt: { gte: new Date(new Date().toDateString()) } },
    });
    return `TOP-${datePart}-${String(seq + 1).padStart(6, '0')}`;
  }
}
