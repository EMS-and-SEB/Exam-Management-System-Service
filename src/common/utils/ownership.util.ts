import { StaffRole } from '../../generated/prisma/client.js';
import type { UserRole } from '../../auth/validation/auth.interface.js';
import { AppException } from '../exceptions/app-exceptions.js';

export function buildOwnerScopeWhere(
  role: UserRole,
  callerId: string,
  ownerField: string,
): Record<string, string> {
  if (role === StaffRole.EXAM_ADMIN) return {};
  return { [ownerField]: callerId };
}

export function assertOwnsOrIsAdmin(ownerId: string | null, callerId: string, role: UserRole): void {
  if (role === StaffRole.EXAM_ADMIN) return;
  if (ownerId === null || ownerId !== callerId) throw AppException.forbidden();
}