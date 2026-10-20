import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import { IS_PUBLIC_KEY } from '../decorators/auth.decorator.js';
import type { JwtPayload } from '../validation/auth.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StaffRole } from '../../generated/prisma/client.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.split(' ')[1];
    if (!token) throw AppException.unauthorized();

    let decoded: unknown;
    try {
      decoded = this.jwtService.verify<Record<string, unknown>>(token);
    } catch {
      throw AppException.unauthorized('Invalid or expired token.');
    }

    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw AppException.unauthorized('Invalid or expired token.');
    }
    const claims = decoded as Record<string, unknown>;
    if (
      typeof claims.sub !== 'string' || !UUID_PATTERN.test(claims.sub) ||
      typeof claims.sid !== 'string' || !UUID_PATTERN.test(claims.sid) ||
      typeof claims.orgUnitId !== 'string' || !UUID_PATTERN.test(claims.orgUnitId) ||
      typeof claims.role !== 'string' || !Object.values(StaffRole).includes(claims.role as StaffRole)
    ) {
      throw AppException.unauthorized('Invalid or expired token.');
    }
    const user = claims as unknown as JwtPayload;

    const session = await this.prisma.refreshToken.findFirst({
      where: {
        id: user.sid,
        staffId: user.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { staff: { select: { isActive: true } } },
    });
    if (!session?.staff.isActive) {
      throw AppException.unauthorized('Your account session is inactive or has been revoked. Please sign in again.');
    }
    request.user = user;
    return true;
  }
}
