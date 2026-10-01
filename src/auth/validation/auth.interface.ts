import { StaffRole } from '../../generated/prisma/client.js';

/**
 * Unified role set for JWT payloads.
 * Spreads all Prisma StaffRole values and appends STUDENT so that a single
 * guard can authorize both staff and portal-authenticated students without
 * touching the PostgreSQL enum.
 */
export const UserRole = {
  ...StaffRole,
  STUDENT: 'STUDENT',
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface JwtPayload {
  /** UUID of the staff account or student directory record. */
  sub: string;
  /** Role carried in the token — one of StaffRole values or 'STUDENT'. */
  role: UserRole;
  /**
   * Human-readable unique identifier:
   *   - Staff   → email address
   *   - Student → studentId string (e.g. "UGR/1234/16")
   */
  identifier: string;
}

