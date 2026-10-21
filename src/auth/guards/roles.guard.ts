import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import { ROLES_KEY } from '../decorators/auth.decorator.js';
import type { AuthRole } from '../decorators/auth.decorator.js';
import type { AuthenticatedUser } from '../validation/auth.interface.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) {
      if (!requiredRoles?.length) return true;
      throw AppException.unauthorized();
    }
    if (user.userType === 'student') {
      if (!requiredRoles?.includes('STUDENT')) throw AppException.forbidden();
      return true;
    }
    if (!requiredRoles?.length) return true;
    const { role } = user;
    if (!requiredRoles.includes(role)) throw AppException.forbidden();
    return true;
  }
}
