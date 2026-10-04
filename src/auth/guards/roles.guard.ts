import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import { ROLES_KEY } from '../decorators/auth.decorator.js';
import type { UserRole, JwtPayload } from '../validation/auth.interface.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const user = context.switchToHttp().getRequest().user as JwtPayload | undefined;
    if (!user) throw AppException.forbidden();
    if (!requiredRoles.includes(user.role)) throw AppException.forbidden();
    return true;
  }
}