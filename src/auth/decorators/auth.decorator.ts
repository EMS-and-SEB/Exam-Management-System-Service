import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '../../generated/prisma/client.js';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../validation/auth.interface.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => ctx.switchToHttp().getRequest().user,
);

