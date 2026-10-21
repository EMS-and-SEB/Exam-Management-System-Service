import { AuthGuard } from './auth.guard.js';
import { StaffRole } from '../../generated/prisma/client.js';

const uuid = 'd9428888-122b-4c21-a4e2-2e9a0303c099';
const sessionId = '0f8fad5b-d9cb-469f-a165-70867728950e';
const orgUnitId = '3f8f9f56-6d7c-4db7-8b57-d8b7b6d8cfd2';

function setup(
  claims: unknown,
  session: unknown = { staff: { isActive: true } },
  studentSession: unknown = { student: { isActive: true } },
) {
  const verify = vi.fn(() => claims);
  const findFirst = vi.fn().mockResolvedValue(session);
  const findStudentFirst = vi.fn().mockResolvedValue(studentSession);
  const request: { headers: { authorization: string }; user?: unknown } = {
    headers: { authorization: 'Bearer token' },
  };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const guard = new AuthGuard(
    { verify } as never,
    { getAllAndOverride: () => false } as never,
    { refreshToken: { findFirst }, studentRefreshToken: { findFirst: findStudentFirst } } as never,
  );
  return { guard, verify, findFirst, findStudentFirst, request, context: context as never };
}

function claims(overrides: Record<string, unknown> = {}) {
  return {
    sub: uuid,
    sid: sessionId,
    orgUnitId,
    role: StaffRole.INSTRUCTOR,
    ...overrides,
  };
}

describe('AuthGuard session claim validation', () => {
  it.each([
    ['missing sid', claims({ sid: undefined })],
    ['malformed sid', claims({ sid: 'not-a-uuid' })],
    ['missing subject', claims({ sub: undefined })],
    ['malformed subject', claims({ sub: 42 })],
    ['invalid role', claims({ role: 'STUDENT' })],
    ['non-object claims', null],
  ])('rejects %s before querying sessions', async (_label, tokenClaims) => {
    const { guard, findFirst, context } = setup(tokenClaims);
    await expect(guard.canActivate(context)).rejects.toThrow();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('requires a valid session owned by the subject and still active', async () => {
    const { guard, findFirst, context } = setup(claims(), null);
    await expect(guard.canActivate(context)).rejects.toThrow();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: sessionId,
        staffId: uuid,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: { staff: { select: { isActive: true } } },
    });
  });

  it('rejects sessions whose staff account has been deactivated', async () => {
    const { guard, context } = setup(claims(), { staff: { isActive: false } });
    await expect(guard.canActivate(context)).rejects.toThrow();
  });

  it('attaches validated claims when the persisted session is active', async () => {
    const tokenClaims = claims();
    const { guard, context, request } = setup(tokenClaims);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(tokenClaims);
  });

  it('validates student sessions against the student refresh-token table', async () => {
    const studentClaims = { sub: uuid, sid: sessionId, role: 'STUDENT', userType: 'student' };
    const { guard, context, request, findStudentFirst, findFirst } = setup(studentClaims);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findStudentFirst).toHaveBeenCalledWith({
      where: { id: sessionId, studentId: uuid, revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      select: { student: { select: { isActive: true } } },
    });
    expect(findFirst).not.toHaveBeenCalled();
    expect(request.user).toEqual(studentClaims);
  });

  it('rejects inactive student sessions', async () => {
    const studentClaims = { sub: uuid, sid: sessionId, role: 'STUDENT', userType: 'student' };
    const { guard, context } = setup(studentClaims, undefined, { student: { isActive: false } });
    await expect(guard.canActivate(context)).rejects.toThrow();
  });
});
