import { AuthService } from './auth.service.js';
import { StaffRole } from '../generated/prisma/client.js';
import { sha256Hash } from './utils/hash.util.js';
import { SEB_HANDSHAKE_AUDIENCE, SEB_HANDSHAKE_ISSUER } from '../seb/seb.constants.js';

vi.mock('./utils/hash.util.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils/hash.util.js')>();
  return { ...actual, bcryptCompare: vi.fn().mockResolvedValue(true) };
});

const staff = {
  id: 'd9428888-122b-4c21-a4e2-2e9a0303c099',
  role: StaffRole.INSTRUCTOR,
  orgUnitId: '3f8f9f56-6d7c-4db7-8b57-d8b7b6d8cfd2',
  isActive: true,
};

function makeService(updateCounts: number[], active = true) {
  const refreshToken = {
    findFirst: vi.fn().mockResolvedValue({
      id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      staffId: staff.id,
      tokenHash: sha256Hash('refresh-token'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    }),
    updateMany: vi.fn().mockImplementation(async () => ({ count: updateCounts.shift() ?? 0 })),
    create: vi.fn().mockResolvedValue({ id: 'new-session-id' }),
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    staffAccount: { findUnique: vi.fn().mockResolvedValue({ ...staff, isActive: active }) },
    refreshToken,
    sebHandshakeToken: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    examSession: { findUnique: vi.fn() },
    examOTP: { findFirst: vi.fn() },
    examInvigilator: { findFirst: vi.fn() },
  };
  const jwtService = { sign: vi.fn().mockReturnValue('access-token') };
  const configService = { getOrThrow: vi.fn().mockReturnValue(86_400_000) };
  const auditService = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(prisma as never, jwtService as never, configService as never, {} as never, auditService as never);
  return { service, tx, refreshToken, jwtService };
}

describe('AuthService refresh rotation', () => {
  it('consumes a refresh token with a conditional single-use update', async () => {
    const { service, refreshToken, jwtService } = makeService([1]);
    await expect(service.refresh('refresh-token')).resolves.toMatchObject({ accessToken: 'access-token' });
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: '0f8fad5b-d9cb-469f-a165-70867728950e',
        tokenHash: sha256Hash('refresh-token'),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(refreshToken.create).toHaveBeenCalledTimes(1);
    expect(jwtService.sign).toHaveBeenCalledTimes(1);
  });

  it('does not issue a replacement when the conditional consume loses a race', async () => {
    const { service, refreshToken, jwtService } = makeService([0]);
    await expect(service.refresh('refresh-token')).rejects.toThrow();
    expect(refreshToken.create).not.toHaveBeenCalled();
    expect(jwtService.sign).not.toHaveBeenCalled();
  });

  it('revokes sessions and denies refresh for an inactive account', async () => {
    const { service, tx, refreshToken } = makeService([0], false);
    await expect(service.refresh('refresh-token')).rejects.toThrow();
    expect(refreshToken.updateMany).toHaveBeenCalledWith({
      where: { staffId: staff.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(refreshToken.create).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('issues short-lived handshake tokens with a distinct purpose and audience', async () => {
    const { service, tx, jwtService } = makeService([]);
    await service.issueSebHandshakeToken();

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'seb-handshake', jti: expect.any(String) }),
      expect.objectContaining({
        expiresIn: '5m',
        issuer: SEB_HANDSHAKE_ISSUER,
        audience: SEB_HANDSHAKE_AUDIENCE,
        algorithm: 'HS256',
      }),
    );
    expect(tx.sebHandshakeToken.create).toHaveBeenCalledTimes(1);
  });

  it('derives the authorized exam from the server-side session token', async () => {
    const { service } = makeService([]);
    const prisma = Reflect.get(service, 'prisma') as {
      examSession: { findUnique: ReturnType<typeof vi.fn> };
      examInvigilator: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.examSession.findUnique.mockResolvedValue({ examId: 'trusted-exam', status: 'IN_PROGRESS' });
    prisma.examInvigilator.findFirst.mockResolvedValue({
      invigilator: {
        id: staff.id,
        name: 'Assigned Invigilator',
        email: 'invigilator@example.test',
        passwordHash: 'stored-hash',
        isActive: true,
        role: StaffRole.INVIGILATOR,
      },
    });

    await expect(service.authenticateAssignedInvigilator('session-id', ' INVIGILATOR@example.test ', 'password'))
      .resolves.toEqual({ id: staff.id, name: 'Assigned Invigilator' });
    expect(prisma.examInvigilator.findFirst).toHaveBeenCalledWith({
      where: { examId: 'trusted-exam' },
      include: { invigilator: true },
    });
  });

  it('rejects an invigilator who is not assigned to the session exam', async () => {
    const { service } = makeService([]);
    const prisma = Reflect.get(service, 'prisma') as {
      examSession: { findUnique: ReturnType<typeof vi.fn> };
      examInvigilator: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.examSession.findUnique.mockResolvedValue({ examId: 'trusted-exam', status: 'IN_PROGRESS' });
    prisma.examInvigilator.findFirst.mockResolvedValue(null);

    await expect(service.authenticateAssignedInvigilator('session-id', 'other@example.test', 'password'))
      .rejects.toThrow();
    expect(prisma.examInvigilator.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { examId: 'trusted-exam' },
    }));
  });

  it('allows an assigned invigilator to authorize exit from a waiting session', async () => {
    const { service } = makeService([]);
    const prisma = Reflect.get(service, 'prisma') as {
      examSession: { findUnique: ReturnType<typeof vi.fn> };
      examInvigilator: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.examSession.findUnique.mockResolvedValue({ examId: 'trusted-exam', status: 'NOT_STARTED' });
    prisma.examInvigilator.findFirst.mockResolvedValue({
      invigilator: {
        id: staff.id,
        name: 'Assigned Invigilator',
        email: 'invigilator@example.test',
        passwordHash: 'stored-hash',
        isActive: true,
        role: StaffRole.INVIGILATOR,
      },
    });

    await expect(service.authenticateAssignedInvigilator(
      'waiting-session', 'invigilator@example.test', 'password',
    )).resolves.toMatchObject({ id: staff.id });
  });

  it('authorizes pre-login exit only for the invigilator assigned to the exam selected by a valid OTP', async () => {
    const { service } = makeService([]);
    const prisma = Reflect.get(service, 'prisma') as {
      examOTP: { findFirst: ReturnType<typeof vi.fn> };
      examInvigilator: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.examOTP.findFirst.mockResolvedValue({ exam: { id: 'trusted-exam', status: 'RELEASED' } });
    prisma.examInvigilator.findFirst.mockResolvedValue({
      invigilator: {
        id: staff.id,
        name: 'Assigned Invigilator',
        email: 'invigilator@example.test',
        passwordHash: 'stored-hash',
        isActive: true,
        role: StaffRole.INVIGILATOR,
      },
    });

    await expect(service.authenticateAssignedInvigilatorForExamOtp(
      '123456', 'invigilator@example.test', 'password',
    )).resolves.toEqual({ id: staff.id, name: 'Assigned Invigilator' });
    expect(prisma.examOTP.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: '123456', expiresAt: { gt: expect.any(Date) } },
    }));
    expect(prisma.examInvigilator.findFirst).toHaveBeenCalledWith({
      where: { examId: 'trusted-exam' },
      include: { invigilator: true },
    });
  });

  it('does not allow an expired or invalid exam OTP to scope pre-login invigilator authorization', async () => {
    const { service } = makeService([]);
    const prisma = Reflect.get(service, 'prisma') as {
      examOTP: { findFirst: ReturnType<typeof vi.fn> };
      examInvigilator: { findFirst: ReturnType<typeof vi.fn> };
    };
    prisma.examOTP.findFirst.mockResolvedValue(null);

    await expect(service.authenticateAssignedInvigilatorForExamOtp(
      'expired-code', 'invigilator@example.test', 'password',
    )).rejects.toThrow();
    expect(prisma.examInvigilator.findFirst).not.toHaveBeenCalled();
  });
});
