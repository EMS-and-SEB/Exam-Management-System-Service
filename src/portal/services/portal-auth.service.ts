import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import { bcryptCompare, sha256Hash } from '../../auth/utils/hash.util.js';
import { generateOpaqueToken } from '../../auth/utils/token.util.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';

@Injectable()
export class PortalAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(studentId: string, password: string) {
    const student = await this.prisma.studentDirectory.findUnique({
      where: { studentId },
    });

    // Use a constant-time compare path even on missing student to resist timing attacks.
    if (!student || !student.isActive) {
      throw AppException.unauthorized('Invalid credentials.');
    }

    if (!student.passwordHash) {
      // Edge case: record pre-dates credential provisioning.
      throw AppException.unauthorized('Account not yet activated. Please contact your administrator.');
    }

    const matches = await bcryptCompare(password, student.passwordHash);
    if (!matches) {
      throw AppException.unauthorized('Invalid credentials.');
    }

    const { accessToken, rawRefreshToken } = await this.issueSession(student.id, student.studentId);

    return {
      accessToken,
      rawRefreshToken,
      student: {
        id: student.id,
        studentId: student.studentId,
        name: student.name,
        email: student.email,
      },
    };
  }

  async refresh(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) throw AppException.unauthorized();

    const tokenHash = sha256Hash(rawRefreshToken);
    const existing = await this.prisma.studentRefreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { student: { select: { id: true, studentId: true, isActive: true } } },
    });
    if (!existing) {
      throw AppException.unauthorized('Session expired. Please log in again.');
    }
    if (!existing.student.isActive) {
      throw AppException.unauthorized('Account is inactive.');
    }

    // Rotate: revoke the consumed token then issue a fresh one.
    await this.prisma.studentRefreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(existing.student.id, existing.student.studentId);
  }

  async logout(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;

    await this.prisma.studentRefreshToken.updateMany({
      where: { tokenHash: sha256Hash(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(studentDirectoryId: string) {
    const student = await this.prisma.studentDirectory.findUnique({
      where: { id: studentDirectoryId },
      select: {
        id: true,
        studentId: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!student) throw AppException.notFound('Student not found.');
    return student;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  /**
   * Signs a short-lived access JWT and creates a new StudentRefreshToken row.
   * Mirrors AuthService.issueSession() but targets StudentRefreshToken.
   */
  private async issueSession(studentDirectoryId: string, studentId: string) {
    const payload: JwtPayload = {
      sub: studentDirectoryId,
      role: UserRole.STUDENT,
      identifier: studentId,
    };
    const accessToken = this.jwtService.sign(payload);

    const rawRefreshToken = generateOpaqueToken();
    const refreshExpiresInMs = this.configService.getOrThrow<number>('jwt.refreshExpiresInMs');

    await this.prisma.studentRefreshToken.create({
      data: {
        studentId: studentDirectoryId,
        tokenHash: sha256Hash(rawRefreshToken),
        expiresAt: new Date(Date.now() + refreshExpiresInMs),
      },
    });

    return { accessToken, rawRefreshToken };
  }
}
