import { Body, Controller, Get, Param, Patch, Post, UseGuards, Req } from '@nestjs/common';
import { GamesService } from './games.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { Role } from '@prisma/client';
import { ValidatePlayerIdDto } from './dto/validate-player-id.dto';
import { ToggleGameDto } from './dto/toggle-game.dto';

@Controller('games')
export class GamesController {
  constructor(private games: GamesService) {}

  // ---- Public storefront -------------------------------------------------

  @Get()
  list() {
    return this.games.listActiveGames();
  }

  @Get(':slug')
  getOne(@Param('slug') slug: string) {
    return this.games.getBySlug(slug);
  }

  /**
   * Rate-limited via RateLimitGuard registered globally on this route prefix
   * in main.ts (10 requests / 60s per IP) to stop ID-enumeration abuse.
   */
  @Post(':slug/validate-player-id')
  validatePlayerId(@Param('slug') slug: string, @Body() dto: ValidatePlayerIdDto) {
    return this.games.validatePlayerId(slug, dto.playerId, dto.playerServer);
  }

  // ---- Admin ---------------------------------------------------------------

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Get('admin/all')
  listAllForAdmin() {
    return this.games.listAllGamesForAdmin();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @Patch('admin/:id/toggle')
  toggle(@Param('id') id: string, @Body() dto: ToggleGameDto, @Req() req: any) {
    return this.games.setGameActive(id, dto.isActive, req.user.sub, req.ip);
  }
}
