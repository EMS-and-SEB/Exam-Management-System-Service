import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { bcryptHash, bcryptCompare, sha256Hash } from './utils/hash.util.js';
import { generateOtp, generateOpaqueToken } from './utils/token.util.js';
import type { AuthenticatedUser, JwtPayload } from './validation/auth.interface.js';
import { EmailService } from '../email/email.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { ExamStatus, Prisma, StaffAccount, SessionStatus, StaffRole } from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SEB_HANDSHAKE_AUDIENCE, SEB_HANDSHAKE_ISSUER } from '../seb/seb.constants.js';

function generateUndergraduateEmail(name: string, studentId: string): string | null {
  const idParts = /^UGR\/(\d{4})\/(\d{2})$/.exec(studentId);
  const firstName = name.trim().split(/\s+/)[0]?.toLowerCase();
  if (!idParts || !firstName) return null;

  const email = `${firstName}.ugr-${idParts[1]}-${idParts[2]}@aau.edu.et`;
  return z.email().safeParse(email).success ? email : null;
}

const UNDERGRADUATE_ID_PATTERN = /^UGR\/\d{4}\/\d{2}$/i;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  async requestStudentActivation(studentId: string) {
    const normalizedStudentId = studentId.trim().toUpperCase();
    const student = await this.prisma.studentDirectory.findUnique({
      where: { studentId: normalizedStudentId },
      select: { id: true },
    });
    if (!student) return;

    await this.createStudentActivationInvitation(student.id);
  }

  async requestStudentActivationByAdmin(studentRecordId: string, email: string) {
    const student = await this.prisma.studentDirectory.findUnique({
      where: { id: studentRecordId },
      select: { id: true },
    });
    if (!student) throw AppException.notFound('Student not found.');

    await this.createStudentActivationInvitation(student.id, email, true);
  }

  private async createStudentActivationInvitation(studentId: string, providedEmail?: string, strict = false) {
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "StudentDirectory" WHERE id = ${studentId} FOR UPDATE`,
      );
      const current = await tx.studentDirectory.findUnique({
        where: { id: studentId },
        select: { studentId: true, name: true, email: true, passwordHash: true, isActive: true },
      });
      if (!current) {
        if (strict) throw AppException.notFound('Student not found.');
        return null;
      }
      if (current.isActive || current.email || current.passwordHash) {
        if (strict) throw AppException.badRequest('This student account is already active or has already been activated.');
        return null;
      }

      const email = providedEmail ?? generateUndergraduateEmail(current.name, current.studentId);
      if (!email) {
        if (strict) throw AppException.badRequest('An institutional email address is required for this student.');
        return null;
      }

      const rawToken = generateOpaqueToken();
      const now = new Date();
      await tx.studentActivationInvitation.updateMany({
        where: { studentId, consumedAt: null },
        data: { consumedAt: now },
      });
      await tx.studentActivationInvitation.create({
        data: {
          studentId,
          email,
          tokenHash: sha256Hash(rawToken),
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });

      return { email, name: current.name, rawToken };
    });

    if (!invitation) return;
    const invitationUrl = `${this.configService.getOrThrow<string>('app.staffPortalUrl')}/set-password?token=${encodeURIComponent(invitation.rawToken)}`;
    await this.emailService.sendStaffInvitation(invitation.email, invitation.name, invitationUrl);
  }

  async login(identifier: string, password: string) {
    if (UNDERGRADUATE_ID_PATTERN.test(identifier.trim())) {
      const studentId = identifier.trim().toUpperCase();
      return this.prisma.$transaction(async (tx) => {
        const found = await tx.studentDirectory.findUnique({ where: { studentId }, select: { id: true } });
        if (!found) throw AppException.unauthorized('Invalid credentials.');
        await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "StudentDirectory" WHERE id = ${found.id} FOR UPDATE`,
        );
        const student = await tx.studentDirectory.findUnique({ where: { id: found.id } });
        if (!student || !student.isActive || !student.passwordHash || !student.email) {
          throw AppException.unauthorized('Invalid credentials.');
        }
        if (!(await bcryptCompare(password, student.passwordHash))) {
          throw AppException.unauthorized('Invalid credentials.');
        }

        const { accessToken, rawRefreshToken } = await this.issueStudentSession(student, tx);
        return {
          accessToken,
          rawRefreshToken,
          staff: {
            id: student.id,
            name: student.name,
            studentId: student.studentId,
            email: student.email,
            isActive: student.isActive,
            role: 'STUDENT' as const,
            userType: 'student' as const,
          },
        };
      });
    }

    if (!z.email().safeParse(identifier).success) {
      throw AppException.unauthorized('Invalid credentials.');
    }
    const email = identifier;
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.staffAccount.findUnique({ where: { email } });
      if (!found) throw AppException.unauthorized('Invalid credentials.');
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "StaffAccount" WHERE id = ${found.id} FOR UPDATE`,
      );
      const staff = await tx.staffAccount.findUnique({
        where: { id: found.id },
        include: { orgUnit: { select: { id: true, name: true } } },
      });
      if (!staff) throw AppException.unauthorized('Invalid credentials.');
      if (!staff.isActive) {
        throw AppException.unauthorized('Invalid credentials.');
      }

      const matches = await bcryptCompare(password, staff.passwordHash);
      if (!matches) throw AppException.unauthorized('Invalid credentials.');

      const { accessToken, rawRefreshToken } = await this.issueSession(staff, tx);
      const { passwordHash: _omit, ...safeStaff } = staff;
      return { accessToken, rawRefreshToken, staff: safeStaff };
    });
  }

  async refresh(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) throw AppException.unauthorized();

    const tokenHash = sha256Hash(rawRefreshToken);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const existing = await tx.refreshToken.findFirst({
        where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      });
      if (!existing) {
        const studentSession = await tx.studentRefreshToken.findFirst({
          where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
        });
        if (!studentSession) return { kind: 'invalid' as const };

        await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM "StudentDirectory" WHERE id = ${studentSession.studentId} FOR UPDATE`,
        );
        const student = await tx.studentDirectory.findUnique({ where: { id: studentSession.studentId } });
        if (!student || !student.isActive) {
          await this.revokeAllStudentSessions(studentSession.studentId, tx);
          return { kind: 'inactive' as const };
        }

        const consumed = await tx.studentRefreshToken.updateMany({
          where: { id: studentSession.id, tokenHash, revokedAt: null, expiresAt: { gt: now } },
          data: { revokedAt: now },
        });
        if (consumed.count !== 1) return { kind: 'invalid' as const };
        return { kind: 'rotated' as const, session: await this.issueStudentSession(student, tx) };
      }

      // Staff-row locking serializes rotation with deactivation, which updates
      // the same row before revoking every session in its transaction.
      await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "StaffAccount" WHERE id = ${existing.staffId} FOR UPDATE`,
      );
      const staff = await tx.staffAccount.findUnique({ where: { id: existing.staffId } });
      if (!staff || !staff.isActive) {
        await this.revokeAllSessions(existing.staffId, tx);
        return { kind: 'inactive' as const };
      }

      const consumed = await tx.refreshToken.updateMany({
        where: { id: existing.id, tokenHash, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (consumed.count !== 1) return { kind: 'invalid' as const };

      return { kind: 'rotated' as const, session: await this.issueSession(staff, tx) };
    });

    if (outcome.kind === 'inactive') throw AppException.unauthorized('Invalid or expired session.');
    if (outcome.kind === 'invalid') throw AppException.unauthorized('Session expired. Please log in again.');
    return outcome.session;
  }

  async logout(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;
    const where = { tokenHash: sha256Hash(rawRefreshToken), revokedAt: null };
    const data = { revokedAt: new Date() };
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where, data }),
      this.prisma.studentRefreshToken.updateMany({ where, data }),
    ]);
  }

  async issueSebHandshakeToken() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 60_000);
    const id = randomUUID();
    await this.prisma.$transaction(async (tx) => {
      await tx.sebHandshakeToken.deleteMany({ where: { expiresAt: { lt: now } } });
      await tx.sebHandshakeToken.create({ data: { id, expiresAt } });
    });
    return this.jwtService.sign(
      { type: 'seb-handshake', jti: id },
      {
        secret: this.configService.getOrThrow<string>('seb.handshakeSecret'),
        expiresIn: '5m',
        issuer: SEB_HANDSHAKE_ISSUER,
        audience: SEB_HANDSHAKE_AUDIENCE,
        algorithm: 'HS256',
      },
    );
  }

  async me(user: AuthenticatedUser) {
    if (user.userType === 'student') {
      return this.prisma.studentDirectory.findUniqueOrThrow({
        where: { id: user.sub },
        select: { id: true, studentId: true, name: true, email: true, isActive: true },
      }).then((student) => ({ ...student, role: 'STUDENT' as const, userType: 'student' as const }));
    }
    const { passwordHash: _omit, ...safe } = await this.prisma.staffAccount.findUniqueOrThrow({
      where: { id: user.sub },
      include: { orgUnit: { select: { id: true, name: true } } },
    });
    return safe;
  }

  async requestPasswordReset(identifier: string) {
    if (UNDERGRADUATE_ID_PATTERN.test(identifier.trim())) {
      const student = await this.prisma.studentDirectory.findUnique({
        where: { studentId: identifier.trim().toUpperCase() },
        select: { id: true, email: true, isActive: true },
      });
      if (!student?.isActive || !student.email) return;

      await this.prisma.studentPasswordReset.updateMany({
        where: { studentId: student.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const otp = generateOtp();
      await this.prisma.studentPasswordReset.create({
        data: {
          studentId: student.id,
          codeHash: await bcryptHash(otp),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      await this.emailService.sendPasswordResetOtp(student.email, otp);
      return;
    }

    const email = identifier;
    const staff = await this.prisma.staffAccount.findUnique({ where: { email } });
    if (!staff) return;
    if (!staff.isActive) {
      throw AppException.badRequest('Your account is inactive. Please contact your administrator.');
    }

    await this.prisma.staffPasswordReset.updateMany({
      where: { staffId: staff.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const otp = generateOtp();
    await this.prisma.staffPasswordReset.create({
      data: {
        staffId: staff.id,
        codeHash: await bcryptHash(otp),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    await this.emailService.sendPasswordResetOtp(email, otp);
  }

  async verifyPasswordReset(identifier: string, code: string) {
    if (UNDERGRADUATE_ID_PATTERN.test(identifier.trim())) {
      const student = await this.prisma.studentDirectory.findUnique({
        where: { studentId: identifier.trim().toUpperCase() },
        select: { id: true, isActive: true },
      });
      if (!student?.isActive) throw AppException.badRequest('Invalid or expired code.');

      const reset = await this.prisma.studentPasswordReset.findFirst({
        where: { studentId: student.id, consumedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { expiresAt: 'desc' },
      });
      if (!reset || !(await bcryptCompare(code, reset.codeHash))) {
        throw AppException.badRequest('Invalid or expired code.');
      }

      const resetToken = generateOpaqueToken();
      const now = new Date();
      const consumed = await this.prisma.studentPasswordReset.updateMany({
        where: { id: reset.id, consumedAt: null, expiresAt: { gt: now } },
        data: {
          consumedAt: now,
          resetTokenHash: sha256Hash(resetToken),
          resetTokenExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
        },
      });
      if (consumed.count !== 1) throw AppException.badRequest('Invalid or expired code.');
      return { resetToken };
    }

    const email = identifier;
    const staff = await this.prisma.staffAccount.findUnique({ where: { email } });
    if (!staff) throw AppException.badRequest('Invalid or expired code.');

    const reset = await this.prisma.staffPasswordReset.findFirst({
      where: { staffId: staff.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    if (!reset || !(await bcryptCompare(code, reset.codeHash))) {
      throw AppException.badRequest('Invalid or expired code.');
    }

    const resetToken = generateOpaqueToken();
    await this.prisma.staffPasswordReset.update({
      where: { id: reset.id },
      data: {
        consumedAt: new Date(),
        resetTokenHash: sha256Hash(resetToken),
        resetTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return { resetToken };
  }

  async confirmPasswordReset(resetToken: string, newPassword: string) {
    const reset = await this.prisma.staffPasswordReset.findFirst({
      where: { resetTokenHash: sha256Hash(resetToken), resetTokenConsumedAt: null, resetTokenExpiresAt: { gt: new Date() } },
      include: { staff: { select: { name: true } } },
    });
    if (reset) {
      await this.prisma.$transaction(async (tx) => {
        await tx.staffAccount.update({ where: { id: reset.staffId }, data: { passwordHash: await bcryptHash(newPassword) } });
        await tx.staffPasswordReset.update({ where: { id: reset.id }, data: { resetTokenConsumedAt: new Date() } });
        await this.auditService.log(
          {
            actorId: reset.staffId,
            action: AuditAction.STAFF_PASSWORD_RESET,
            entityType: 'StaffAccount',
            entityId: reset.staffId,
            metadata: { displayName: reset.staff.name },
          },
          tx,
        );
      });

      await this.revokeAllSessions(reset.staffId);
      return;
    }

    const studentReset = await this.prisma.studentPasswordReset.findFirst({
      where: { resetTokenHash: sha256Hash(resetToken), resetTokenConsumedAt: null, resetTokenExpiresAt: { gt: new Date() } },
      include: { student: { select: { isActive: true } } },
    });
    if (!studentReset || !studentReset.student.isActive) {
      throw AppException.badRequest('Invalid or expired reset token.');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const consumed = await tx.studentPasswordReset.updateMany({
        where: {
          id: studentReset.id,
          resetTokenHash: sha256Hash(resetToken),
          resetTokenConsumedAt: null,
          resetTokenExpiresAt: { gt: now },
        },
        data: { resetTokenConsumedAt: now },
      });
      if (consumed.count !== 1) throw AppException.badRequest('Invalid or expired reset token.');
      const updated = await tx.studentDirectory.updateMany({
        where: { id: studentReset.studentId, isActive: true },
        data: { passwordHash: await bcryptHash(newPassword) },
      });
      if (updated.count !== 1) throw AppException.badRequest('Invalid or expired reset token.');
    });

    await this.revokeAllStudentSessions(studentReset.studentId);
  }

  async verifyStaffInvitation(token: string) {
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: new Date() } },
      include: { staff: { select: { name: true, email: true } } },
    });
    if (invitation) return { name: invitation.staff.name, email: invitation.staff.email };

    const studentInvitation = await this.prisma.studentActivationInvitation.findFirst({
      where: { tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: new Date() } },
      include: { student: { select: { name: true, isActive: true } } },
    });
    if (!studentInvitation || studentInvitation.student.isActive) {
      throw AppException.badRequest('This invitation is invalid or has expired.');
    }
    return { name: studentInvitation.student.name, email: studentInvitation.email, accountType: 'student' as const };
  }

  async completeStaffInvitation(token: string, newPassword: string) {
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (invitation) {
      await this.prisma.$transaction(async (tx) => {
        await tx.staffAccount.update({
          where: { id: invitation.staffId },
          data: { passwordHash: await bcryptHash(newPassword) },
        });
        await tx.staffInvitation.update({
          where: { id: invitation.id },
          data: { consumedAt: new Date() },
        });
        await this.auditService.log(
          { actorId: invitation.staffId, action: AuditAction.STAFF_INVITATION_ACCEPTED, entityType: 'StaffAccount', entityId: invitation.staffId },
          tx,
        );
      });

      await this.revokeAllSessions(invitation.staffId);
      return;
    }

    const studentInvitation = await this.prisma.studentActivationInvitation.findFirst({
      where: { tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: new Date() } },
      include: { student: { select: { isActive: true } } },
    });
    if (!studentInvitation || studentInvitation.student.isActive) {
      throw AppException.badRequest('This invitation is invalid or has expired.');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const consumed = await tx.studentActivationInvitation.updateMany({
        where: { id: studentInvitation.id, tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw AppException.badRequest('This invitation is invalid or has expired.');

      const activated = await tx.studentDirectory.updateMany({
        where: { id: studentInvitation.studentId, isActive: false, email: null, passwordHash: null },
        data: {
          email: studentInvitation.email,
          passwordHash: await bcryptHash(newPassword),
          isActive: true,
        },
      });
      if (activated.count !== 1) throw AppException.badRequest('This invitation is invalid or has expired.');
    });
  }

  async revokeAllSessions(staffId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    await tx.refreshToken.updateMany({ where: { staffId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async revokeAllStudentSessions(studentId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    await tx.studentRefreshToken.updateMany({ where: { studentId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async issueSession(
    staff: Pick<StaffAccount, 'id' | 'role' | 'orgUnitId'>,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const rawRefreshToken = generateOpaqueToken();
    const refreshExpiresInMs = this.configService.getOrThrow<number>('jwt.refreshExpiresInMs');
    const refreshToken = await db.refreshToken.create({
      data: {
        staffId: staff.id,
        tokenHash: sha256Hash(rawRefreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresInMs),
      },
    });

    const payload: JwtPayload = {
      sub: staff.id,
      sid: refreshToken.id,
      role: staff.role,
      orgUnitId: staff.orgUnitId,
      userType: 'staff',
    };
    const accessToken = this.jwtService.sign(payload);

    return { accessToken, rawRefreshToken };
  }

  private async issueStudentSession(
    student: { id: string },
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const rawRefreshToken = generateOpaqueToken();
    const refreshExpiresInMs = this.configService.getOrThrow<number>('jwt.refreshExpiresInMs');
    const refreshToken = await db.studentRefreshToken.create({
      data: {
        studentId: student.id,
        tokenHash: sha256Hash(rawRefreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresInMs),
      },
    });

    const payload: AuthenticatedUser = {
      sub: student.id,
      sid: refreshToken.id,
      role: 'STUDENT',
      userType: 'student',
    };
    const accessToken = this.jwtService.sign(payload);
    return { accessToken, rawRefreshToken };
  }

  async identifyAssignedInvigilator(examId: string, password: string) {
    const assignment = await this.prisma.examInvigilator.findFirst({
      where: { examId },
      include: { invigilator: true },
    });
    if (!assignment || !assignment.invigilator.isActive) {
      throw AppException.unauthorized('No active invigilator is assigned to this exam.');
    }
    if (!(await bcryptCompare(password, assignment.invigilator.passwordHash))) {
      throw AppException.unauthorized('Incorrect password.');
    }
    return assignment.invigilator;
  }

  async authenticateAssignedInvigilator(
    sessionToken: string,
    email: string,
    password: string,
    authorizationContext: 'active-session' | 'return-to-login' = 'active-session',
  ) {
    const session = await this.prisma.examSession.findUnique({
      where: { id: sessionToken },
      select: { examId: true },
    });
    if (!session) {
      throw AppException.unauthorized('Invalid invigilator credentials for this exam session.');
    }
    const invigilator = await this.authenticateAssignedInvigilatorForExam(session.examId, email, password);
    await this.auditService.log({
      actorId: invigilator.id,
      action: AuditAction.SEB_EXIT_AUTHORIZED,
      entityType: 'ExamSession',
      entityId: sessionToken,
      metadata: { authorizationContext },
    });
    return invigilator;
  }

  async authenticateAssignedInvigilatorForExamOtp(
    otp: string,
    email: string,
    password: string,
    authorizationContext: 'exam-access-code' | 'return-to-login' = 'exam-access-code',
  ) {
    const examOtp = await this.prisma.examOTP.findFirst({
      where: { code: otp, expiresAt: { gt: new Date() } },
      include: { exam: { select: { id: true, status: true } } },
    });
    if (!examOtp || examOtp.exam.status !== ExamStatus.RELEASED) {
      throw AppException.unauthorized('Invalid invigilator credentials or exam access code.');
    }
    const invigilator = await this.authenticateAssignedInvigilatorForExam(examOtp.exam.id, email, password);
    await this.auditService.log({
      actorId: invigilator.id,
      action: AuditAction.SEB_EXIT_AUTHORIZED,
      entityType: 'Exam',
      entityId: examOtp.exam.id,
      metadata: { authorizationContext },
    });
    return invigilator;
  }

  private async authenticateAssignedInvigilatorForExam(examId: string, email: string, password: string) {
    const assignment = await this.prisma.examInvigilator.findFirst({
      where: { examId },
      include: { invigilator: true },
    });
    if (
      !assignment ||
      !assignment.invigilator.isActive ||
      ![StaffRole.INVIGILATOR, StaffRole.INSTRUCTOR, StaffRole.EXIT_EXAM_COORDINATOR].some(
        (role) => role === assignment.invigilator.role,
      ) ||
      assignment.invigilator.email.toLowerCase() !== email.trim().toLowerCase()
    ) {
      throw AppException.unauthorized('Invalid invigilator credentials for this exam session.');
    }
    if (!(await bcryptCompare(password, assignment.invigilator.passwordHash))) {
      throw AppException.unauthorized('Invalid invigilator credentials for this exam session.');
    }
    return { id: assignment.invigilator.id, name: assignment.invigilator.name };
  }
}
