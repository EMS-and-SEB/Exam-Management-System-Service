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

describe('AuthService student activation', () => {
  const directoryStudent = {
    id: 'student-row-id',
    studentId: 'UGR/1212/16',
    name: 'elbethel ambachew',
    email: null,
    passwordHash: null,
    isActive: false,
  };

  function makeActivationService() {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      studentDirectory: {
        findUnique: vi.fn().mockResolvedValue(directoryStudent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      studentActivationInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 'activation-id' }),
        findFirst: vi.fn(),
      },
    };
    const prisma = {
      studentDirectory: { findUnique: vi.fn().mockResolvedValue({ id: directoryStudent.id }) },
      studentActivationInvitation: { findFirst: vi.fn() },
      staffInvitation: { findFirst: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const emailService = { sendStaffInvitation: vi.fn().mockResolvedValue(undefined) };
    const configService = { getOrThrow: vi.fn().mockReturnValue('https://staff.example.test') };
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      prisma as never,
      {} as never,
      configService as never,
      emailService as never,
      auditService as never,
    );
    return { service, prisma, tx, emailService };
  }

  it('sends a generated undergraduate invitation without saving credentials before activation', async () => {
    const { service, tx, emailService } = makeActivationService();

    await service.requestStudentActivation(' ugr/1212/16 ');

    expect(tx.studentActivationInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: directoryStudent.id,
        email: 'elbethel.ugr-1212-16@aau.edu.et',
        tokenHash: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(emailService.sendStaffInvitation).toHaveBeenCalledWith(
      'elbethel.ugr-1212-16@aau.edu.et',
      directoryStudent.name,
      expect.stringMatching(/^https:\/\/staff\.example\.test\/set-password\?token=/),
    );
    expect(tx.studentDirectory.updateMany).not.toHaveBeenCalled();
  });

  it('does not send an invitation for an unknown student ID', async () => {
    const { service, prisma, emailService } = makeActivationService();
    prisma.studentDirectory.findUnique.mockResolvedValue(null);

    await expect(service.requestStudentActivation('UGR/9999/99')).resolves.toBeUndefined();
    expect(emailService.sendStaffInvitation).not.toHaveBeenCalled();
  });

  it('allows an administrator to invite a graduate student using a manually supplied email', async () => {
    const { service, tx, emailService } = makeActivationService();
    tx.studentDirectory.findUnique.mockResolvedValue({ ...directoryStudent, studentId: 'MSc/123/2024' });

    await service.requestStudentActivationByAdmin(directoryStudent.id, 'graduate.student@aau.edu.et');

    expect(tx.studentActivationInvitation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        studentId: directoryStudent.id,
        email: 'graduate.student@aau.edu.et',
        tokenHash: expect.any(String),
      }),
    });
    expect(emailService.sendStaffInvitation).toHaveBeenCalledWith(
      'graduate.student@aau.edu.et',
      directoryStudent.name,
      expect.stringContaining('/set-password?token='),
    );
    expect(tx.studentDirectory.updateMany).not.toHaveBeenCalled();
  });

  it('does not issue a manual invitation for an already-active student', async () => {
    const { service, tx, emailService } = makeActivationService();
    tx.studentDirectory.findUnique.mockResolvedValue({ ...directoryStudent, isActive: true });

    await expect(service.requestStudentActivationByAdmin(directoryStudent.id, 'student@aau.edu.et')).rejects.toThrow();
    expect(tx.studentActivationInvitation.create).not.toHaveBeenCalled();
    expect(emailService.sendStaffInvitation).not.toHaveBeenCalled();
  });

  it('verifies a student invitation through the existing staff invitation endpoint', async () => {
    const { service, prisma } = makeActivationService();
    prisma.studentActivationInvitation.findFirst.mockResolvedValue({
      email: 'elbethel.ugr-1212-16@aau.edu.et',
      student: { name: directoryStudent.name, isActive: false },
    });

    await expect(service.verifyStaffInvitation('raw-token')).resolves.toEqual({
      name: directoryStudent.name,
      email: 'elbethel.ugr-1212-16@aau.edu.et',
      accountType: 'student',
    });
  });

  it('activates a student and consumes the invitation in one transaction', async () => {
    const { service, prisma, tx } = makeActivationService();
    prisma.studentActivationInvitation.findFirst.mockResolvedValue({
      id: 'activation-id',
      studentId: directoryStudent.id,
      email: 'elbethel.ugr-1212-16@aau.edu.et',
      student: { isActive: false },
    });

    await service.completeStaffInvitation('raw-token', 'strong-password');

    expect(tx.studentActivationInvitation.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'activation-id', tokenHash: sha256Hash('raw-token'), consumedAt: null }),
      data: { consumedAt: expect.any(Date) },
    });
    expect(tx.studentDirectory.updateMany).toHaveBeenCalledWith({
      where: { id: directoryStudent.id, isActive: false, email: null, passwordHash: null },
      data: {
        email: 'elbethel.ugr-1212-16@aau.edu.et',
        passwordHash: expect.stringMatching(/^\$2[aby]\$/),
        isActive: true,
      },
    });
  });

  it('rejects an already-active student invitation', async () => {
    const { service, prisma, tx } = makeActivationService();
    prisma.studentActivationInvitation.findFirst.mockResolvedValue({
      id: 'activation-id',
      studentId: directoryStudent.id,
      email: 'elbethel.ugr-1212-16@aau.edu.et',
      student: { isActive: true },
    });

    await expect(service.completeStaffInvitation('raw-token', 'strong-password')).rejects.toThrow();
    expect(tx.studentActivationInvitation.updateMany).not.toHaveBeenCalled();
    expect(tx.studentDirectory.updateMany).not.toHaveBeenCalled();
  });
});

describe('AuthService shared login', () => {
  const studentRecord = {
    id: 'student-row-id',
    studentId: 'UGR/1212/16',
    name: 'elbethel ambachew',
    email: 'elbethel.ugr-1212-16@aau.edu.et',
    passwordHash: 'student-hash',
    isActive: true,
  };
  const staffRecord = {
    id: staff.id,
    name: 'Staff Member',
    email: 'staff@example.test',
    passwordHash: 'staff-hash',
    role: StaffRole.INSTRUCTOR,
    orgUnitId: staff.orgUnitId,
    isActive: true,
    orgUnit: { id: staff.orgUnitId, name: 'Unit' },
  };

  function makeLoginService(studentActive = true) {
    const studentDirectory = {
      findUnique: vi.fn().mockImplementation(async (args: { where: { id?: string; studentId?: string } }) => {
        if (args.where.studentId) return { id: studentRecord.id };
        return { ...studentRecord, isActive: studentActive };
      }),
    };
    const studentRefreshToken = {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'student-session-id' }),
    };
    const staffAccount = { findUnique: vi.fn().mockResolvedValue(staffRecord) };
    const refreshToken = {
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'staff-session-id' }),
    };
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      studentDirectory,
      studentRefreshToken,
      staffAccount,
      refreshToken,
    };
    const prisma = { $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)) };
    const jwtService = { sign: vi.fn().mockReturnValue('access-token') };
    const configService = { getOrThrow: vi.fn().mockReturnValue(86_400_000) };
    const service = new AuthService(prisma as never, jwtService as never, configService as never, {} as never, {} as never);
    return { service, tx, studentRefreshToken, refreshToken, jwtService };
  }

  it('authenticates an active student ID through the shared login service and issues a student token', async () => {
    const { service, studentRefreshToken, jwtService } = makeLoginService();

    const result = await service.login(' ugr/1212/16 ', 'student-password');

    expect(result.staff).toMatchObject({ id: studentRecord.id, studentId: studentRecord.studentId, role: 'STUDENT' });
    expect(result.staff).not.toHaveProperty('passwordHash');
    expect(studentRefreshToken.create).toHaveBeenCalledWith({
      data: { studentId: studentRecord.id, tokenHash: expect.any(String), expiresAt: expect.any(Date) },
    });
    expect(jwtService.sign).toHaveBeenCalledWith({
      sub: studentRecord.id,
      sid: 'student-session-id',
      role: 'STUDENT',
      userType: 'student',
    });
  });

  it('rejects login for an inactive student account', async () => {
    const { service, studentRefreshToken } = makeLoginService(false);
    await expect(service.login('UGR/1212/16', 'student-password')).rejects.toThrow();
    expect(studentRefreshToken.create).not.toHaveBeenCalled();
  });

  it('continues to authenticate staff emails and issue staff sessions', async () => {
    const { service, tx, refreshToken, jwtService } = makeLoginService();

    const result = await service.login('staff@example.test', 'staff-password');

    expect(result.staff).toMatchObject({ id: staffRecord.id, email: staffRecord.email, role: StaffRole.INSTRUCTOR });
    expect(tx.staffAccount.findUnique).toHaveBeenCalledWith({ where: { email: 'staff@example.test' } });
    expect(refreshToken.create).toHaveBeenCalledTimes(1);
    expect(jwtService.sign).toHaveBeenCalledWith(expect.objectContaining({ role: StaffRole.INSTRUCTOR, userType: 'staff' }));
  });

  it('rotates student refresh tokens through the shared refresh endpoint service', async () => {
    const { service, tx, studentRefreshToken } = makeLoginService();
    studentRefreshToken.findFirst.mockResolvedValue({
      id: 'old-student-session',
      studentId: studentRecord.id,
      tokenHash: sha256Hash('student-refresh-token'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.refresh('student-refresh-token')).resolves.toMatchObject({ accessToken: 'access-token' });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(studentRefreshToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'old-student-session',
        tokenHash: sha256Hash('student-refresh-token'),
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(studentRefreshToken.create).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService student password recovery', () => {
  const student = {
    id: 'student-row-id',
    studentId: 'UGR/1212/16',
    email: 'elbethel.ugr-1212-16@aau.edu.et',
    isActive: true,
  };

  function makeRecoveryService(active = true) {
    const studentPasswordReset = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'student-reset-id' }),
      findFirst: vi.fn(),
    };
    const studentDirectory = {
      findUnique: vi.fn().mockResolvedValue({ ...student, isActive: active }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const studentRefreshToken = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const staffPasswordReset = {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn(),
    };
    const tx = { studentPasswordReset, studentDirectory };
    const prisma = {
      studentDirectory,
      studentPasswordReset,
      studentRefreshToken,
      staffAccount: { findUnique: vi.fn() },
      staffPasswordReset,
      $transaction: vi.fn(async (callback: (client: unknown) => unknown) => callback(tx)),
    };
    const emailService = { sendPasswordResetOtp: vi.fn().mockResolvedValue(undefined) };
    const auditService = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new AuthService(prisma as never, {} as never, {} as never, emailService as never, auditService as never);
    return { service, prisma, tx, emailService, studentPasswordReset, studentDirectory, studentRefreshToken };
  }

  it('sends a reset code to the saved email for an active student account', async () => {
    const { service, studentPasswordReset, emailService } = makeRecoveryService();

    await service.requestPasswordReset(' ugr/1212/16 ');

    expect(studentPasswordReset.create).toHaveBeenCalledWith({
      data: {
        studentId: student.id,
        codeHash: expect.stringMatching(/^\$2[aby]\$/),
        expiresAt: expect.any(Date),
      },
    });
    expect(emailService.sendPasswordResetOtp).toHaveBeenCalledWith(student.email, expect.stringMatching(/^\d{6}$/));
  });

  it('does not create or send a reset code for an inactive student account', async () => {
    const { service, studentPasswordReset, emailService } = makeRecoveryService(false);

    await expect(service.requestPasswordReset(student.studentId)).resolves.toBeUndefined();

    expect(studentPasswordReset.create).not.toHaveBeenCalled();
    expect(emailService.sendPasswordResetOtp).not.toHaveBeenCalled();
  });

  it('exchanges a valid student reset code for a single-use reset token', async () => {
    const { service, studentPasswordReset } = makeRecoveryService();
    studentPasswordReset.findFirst.mockResolvedValue({ id: 'student-reset-id', codeHash: 'code-hash' });

    const result = await service.verifyPasswordReset(student.studentId, '123456');

    expect(result.resetToken).toEqual(expect.any(String));
    expect(studentPasswordReset.updateMany).toHaveBeenCalledWith({
      where: { id: 'student-reset-id', consumedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: {
        consumedAt: expect.any(Date),
        resetTokenHash: expect.any(String),
        resetTokenExpiresAt: expect.any(Date),
      },
    });
  });

  it('consumes a student reset token, updates the password hash, and revokes sessions', async () => {
    const { service, studentPasswordReset, studentDirectory, studentRefreshToken } = makeRecoveryService();
    studentPasswordReset.findFirst.mockResolvedValue({
      id: 'student-reset-id',
      studentId: student.id,
      student: { isActive: true },
    });

    await service.confirmPasswordReset('single-use-token', 'new-password');

    expect(studentPasswordReset.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'student-reset-id', resetTokenHash: sha256Hash('single-use-token') }),
      data: { resetTokenConsumedAt: expect.any(Date) },
    }));
    expect(studentDirectory.updateMany).toHaveBeenCalledWith({
      where: { id: student.id, isActive: true },
      data: { passwordHash: expect.stringMatching(/^\$2[aby]\$/) },
    });
    expect(studentRefreshToken.updateMany).toHaveBeenCalledWith({
      where: { studentId: student.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('rejects a student reset before activation', async () => {
    const { service, studentPasswordReset } = makeRecoveryService();
    studentPasswordReset.findFirst.mockResolvedValue({
      id: 'student-reset-id',
      studentId: student.id,
      student: { isActive: false },
    });

    await expect(service.confirmPasswordReset('reset-token', 'new-password')).rejects.toThrow();
  });
});
