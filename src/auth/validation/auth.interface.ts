import { StaffRole } from '../../generated/prisma/client.js';

export const UserRole = {
  ...StaffRole,
  STUDENT: 'STUDENT',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface JwtPayload {
  sub: string;
  role: UserRole;
  identifier: string;
}
