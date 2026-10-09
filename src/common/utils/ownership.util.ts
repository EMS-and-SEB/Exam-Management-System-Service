import { StaffRole } from '../../generated/prisma/client.js';
import { AppException } from '../exceptions/app-exceptions.js';

const ADMIN_ROLES: readonly StaffRole[] = [StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN];

export function isAdminRole(role: StaffRole): boolean {
  return ADMIN_ROLES.includes(role);
}

export function buildOwnerScopeWhere(
  role: StaffRole,
  callerId: string,
  ownerField: string,
  scopedOrgUnitIds: string[],
): Record<string, unknown> {
  if (isAdminRole(role)) return { orgUnitId: { in: scopedOrgUnitIds } };
  return { [ownerField]: callerId };
}

export function assertOwnsOrIsAdmin(
  resourceOrgUnitId: string,
  ownerId: string | null,
  callerId: string,
  role: StaffRole,
  scopedOrgUnitIds: string[],
): void {
  if (isAdminRole(role)) {
    if (!scopedOrgUnitIds.includes(resourceOrgUnitId)) throw AppException.forbidden();
    return;
  }
  if (ownerId === null || ownerId !== callerId) throw AppException.forbidden();
}