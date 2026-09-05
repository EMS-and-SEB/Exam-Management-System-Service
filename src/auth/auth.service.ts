import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { bcryptHash, bcryptCompare, sha256Hash } from './utils/hash.util.js';
import { generateOtp, generateOpaqueToken } from './utils/token.util.js';
import type { JwtPayload } from './validation/auth.interface.js';
import { EmailService } from '../email/email.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  async login(email: string, password: string) {
    const staff = await this.prisma.staffAccount.findUnique({ where: { email } });
    if (!staff || !staff.isActive) throw AppException.unauthorized('Invalid credentials.');

    const matches = await bcryptCompare(password, staff.passwordHash);
    if (!matches) throw AppException.unauthorized('Invalid credentials.');

    return this.issueSession(staff.id, staff.role);
  }

  async refresh(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) throw AppException.unauthorized();

    const tokenHash = sha256Hash(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!existing) throw AppException.unauthorized('Session expired. Please log in again.');

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    const staff = await this.prisma.staffAccount.findUniqueOrThrow({ where: { id: existing.staffId } });
    return this.issueSession(staff.id, staff.role);
  }

  async logout(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256Hash(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(staffId: string) {
    const { passwordHash: _omit, ...safe } = await this.prisma.staffAccount.findUniqueOrThrow({
      where: { id: staffId },
    });
    return safe;
  }

    async requestPasswordReset(email: string) {
    const staff = await this.prisma.staffAccount.findUnique({ where: { email } });
    if (!staff) return;

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
      where: {
        resetTokenHash: sha256Hash(resetToken),
        resetTokenConsumedAt: null,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!reset) throw AppException.badRequest('Invalid or expired reset token.');

    await this.prisma.$transaction([
      this.prisma.staffAccount.update({
        where: { id: reset.staffId },
        data: { passwordHash: await bcryptHash(newPassword) },
      }),
      this.prisma.staffPasswordReset.update({
        where: { id: reset.id },
        data: { resetTokenConsumedAt: new Date() },
      }),
    ]);

    await this.revokeAllSessions(reset.staffId);
  }

  async revokeAllSessions(staffId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { staffId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueSession(staffId: string, role: JwtPayload['role']) {
    const accessToken = this.jwtService.sign({ sub: staffId, role });

    const rawRefreshToken = generateOpaqueToken();
    const refreshExpiresInMs = this.configService.getOrThrow<number>('jwt.refreshExpiresInMs');
    await this.prisma.refreshToken.create({
      data: {
        staffId,
        tokenHash: sha256Hash(rawRefreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresInMs),
      },
    });

    return { accessToken, rawRefreshToken };
  }
}