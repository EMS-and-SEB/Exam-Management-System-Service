import { SetMetadata } from '@nestjs/common';
import { StaffRole } from '../../generated/prisma/client.js';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../validation/auth.interface.js';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export type AuthRole = StaffRole | 'STUDENT';
export const Roles = (...roles: AuthRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser => ctx.switchToHttp().getRequest().user,
);

