import { StaffRole } from '../../generated/prisma/client.js';
import { AppException } from '../exceptions/app-exceptions.js';

export function buildOwnerScopeWhere(
  role: StaffRole,
  callerId: string,
  ownerField: string,
): Record<string, string> {
  if (role === StaffRole.EXAM_ADMIN) return {};
  return { [ownerField]: callerId };
}

export function assertOwnsOrIsAdmin(ownerId: string, callerId: string, role: StaffRole): void {
  if (role === StaffRole.EXAM_ADMIN) return;
  if (ownerId !== callerId) throw AppException.forbidden();
}