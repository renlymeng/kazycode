import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
/** Attach to a controller/route: @Roles(Role.ADMIN, Role.SUPER_ADMIN) */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * RolesGuard — enforces RBAC on top of JwtAuthGuard.
 * Must run AFTER JwtAuthGuard so request.user is populated.
 * Also enforces that MFA was completed for this session (mfaVerified claim)
 * for any route requiring ADMIN or SUPER_ADMIN.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new ForbiddenException('Not authenticated');
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    const isStaffRole = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' || user.role === 'SUPPORT';
    if (isStaffRole && !user.mfaVerified) {
      throw new ForbiddenException('MFA verification required for this session');
    }

    return true;
  }
}
