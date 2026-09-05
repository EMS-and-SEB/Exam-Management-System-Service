import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import { ROLES_KEY } from '../decorators/auth.decorator.js';
import { StaffRole } from '../../generated/prisma/client.js';
import type { JwtPayload } from '../validation/auth.interface.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<StaffRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const { role } = context.switchToHttp().getRequest().user as JwtPayload;
    if (!requiredRoles.includes(role)) throw AppException.forbidden();
    return true;
  }
}