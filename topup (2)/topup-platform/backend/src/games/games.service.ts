import { Injectable, NotFoundException, BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NicknameValidationService } from './nickname-validation.service';

@Injectable()
export class GamesService {
  constructor(
    private prisma: PrismaService,
    private nicknameService: NicknameValidationService,
  ) {}

  /** Public storefront: only returns games currently toggled ON. */
  async listActiveGames() {
    return this.prisma.game.findMany({
      where: { isActive: true },
      orderBy: [{ isHot: 'desc' }, { sortOrder: 'asc' }],
      include: {
        packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } },
      },
    });
  }

  async getBySlug(slug: string) {
    const game = await this.prisma.game.findUnique({
      where: { slug },
      include: { packages: { where: { isActive: true }, orderBy: { sortOrder: 'asc' } } },
    });
    // A game toggled OFF is treated as not found on the public site —
    // it disappears from purchase entirely, not just from the listing.
    if (!game || !game.isActive) {
      throw new NotFoundException('This game is currently unavailable for top-up.');
    }
    return game;
  }

  /**
   * Calls the publisher's nickname-lookup API for the given game + player ID
   * and returns the display name so the customer can confirm before paying.
   * Never trust a client-submitted nickname — always re-verify server-side
   * again at order-creation time.
   */
  async validatePlayerId(gameSlug: string, playerId: string, playerServer?: string) {
    const game = await this.getBySlug(gameSlug);
    try {
      const nickname = await this.nicknameService.lookup(game.nicknameApiAdapter, {
        playerId,
        playerServer,
      });
      if (!nickname) {
        return { valid: false, nickname: null, message: 'Player ID not found. Double-check and try again.' };
      }
      return { valid: true, nickname };
    } catch {
      throw new BadGatewayException(
        'Could not reach the game server to verify this ID right now. Please try again shortly.',
      );
    }
  }

  // -----------------------------------------------------------------------
  // ADMIN: the core game ON/OFF toggle
  // -----------------------------------------------------------------------

  async setGameActive(gameId: string, isActive: boolean, adminId: string, ip?: string) {
    const game = await this.prisma.game.update({ where: { id: gameId }, data: { isActive } });

    await this.prisma.auditLog.create({
      data: {
        adminId,
        action: isActive ? 'GAME_TOGGLE_ON' : 'GAME_TOGGLE_OFF',
        targetType: 'Game',
        targetId: gameId,
        metadata: { slug: game.slug },
        ipAddress: ip,
      },
    });

    return game;
  }

  async listAllGamesForAdmin() {
    return this.prisma.game.findMany({
      orderBy: [{ sortOrder: 'asc' }],
      include: { packages: true },
    });
  }
}
