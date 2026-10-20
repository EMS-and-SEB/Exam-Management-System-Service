import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { bcryptHash, bcryptCompare, sha256Hash } from './utils/hash.util.js';
import { generateOtp, generateOpaqueToken } from './utils/token.util.js';
import type { JwtPayload } from './validation/auth.interface.js';
import { EmailService } from '../email/email.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { ExamStatus, Prisma, StaffAccount, SessionStatus, StaffRole } from '../generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { SEB_HANDSHAKE_AUDIENCE, SEB_HANDSHAKE_ISSUER } from '../seb/seb.constants.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
    private readonly auditService: AuditService,
  ) {}

  async login(email: string, password: string) {
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
      if (!existing) return { kind: 'invalid' as const };

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
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256Hash(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
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

  async me(staffId: string) {
    const { passwordHash: _omit, ...safe } = await this.prisma.staffAccount.findUniqueOrThrow({
      where: { id: staffId },
      include: { orgUnit: { select: { id: true, name: true } } },
    });
    return safe;
  }

  async requestPasswordReset(email: string) {
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

  async verifyPasswordReset(email: string, code: string) {
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
    if (!reset) throw AppException.badRequest('Invalid or expired reset token.');

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
  }

  async verifyStaffInvitation(token: string) {
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: new Date() } },
      include: { staff: { select: { name: true, email: true } } },
    });
    if (!invitation) throw AppException.badRequest('This invitation is invalid or has expired.');
    return { name: invitation.staff.name, email: invitation.staff.email };
  }

  async completeStaffInvitation(token: string, newPassword: string) {
    const invitation = await this.prisma.staffInvitation.findFirst({
      where: { tokenHash: sha256Hash(token), consumedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!invitation) throw AppException.badRequest('This invitation is invalid or has expired.');

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
  }

  async revokeAllSessions(staffId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    await tx.refreshToken.updateMany({ where: { staffId, revokedAt: null }, data: { revokedAt: new Date() } });
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

  async authenticateAssignedInvigilator(sessionToken: string, email: string, password: string) {
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
      metadata: { authorizationContext: 'active-session' },
    });
    return invigilator;
  }

  async authenticateAssignedInvigilatorForExamOtp(otp: string, email: string, password: string) {
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
      metadata: { authorizationContext: 'exam-access-code' },
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
