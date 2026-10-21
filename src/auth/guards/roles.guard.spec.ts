import { RolesGuard } from './roles.guard.js';
import { StaffRole } from '../../generated/prisma/client.js';

function makeGuard(requiredRoles: Array<StaffRole | 'STUDENT'> | undefined, role?: string, userType?: string) {
  const request = { user: role ? { role, userType } : undefined };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const guard = new RolesGuard({ getAllAndOverride: () => requiredRoles } as never);
  return { guard, context: context as never };
}

describe('RolesGuard student access', () => {
  it('allows unauthenticated public routes without role requirements', () => {
    const { guard, context } = makeGuard(undefined);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies student tokens when an endpoint has no explicit role policy', () => {
    const { guard, context } = makeGuard(undefined, 'STUDENT', 'student');
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('denies student tokens from staff-only endpoints', () => {
    const { guard, context } = makeGuard([StaffRole.SUPER_ADMIN], 'STUDENT', 'student');
    expect(() => guard.canActivate(context)).toThrow();
  });

  it('allows student tokens only when the endpoint explicitly includes the student role', () => {
    const { guard, context } = makeGuard(['STUDENT'], 'STUDENT', 'student');
    expect(guard.canActivate(context)).toBe(true);
  });

  it('preserves existing staff role checks', () => {
    const { guard, context } = makeGuard([StaffRole.INSTRUCTOR], StaffRole.INSTRUCTOR);
    expect(guard.canActivate(context)).toBe(true);
  });
});
