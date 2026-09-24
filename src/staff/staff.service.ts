import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { bcryptHash } from '../auth/utils/hash.util.js';
import { generateOpaqueToken } from '../auth/utils/token.util.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { StaffRole } from '../generated/prisma/client.js';
import { AuthService } from '../auth/auth.service.js';
import { EmailService } from '../email/email.service.js';
import { sha256Hash } from '../auth/utils/hash.util.js';
import type { CreateStaffDto } from './dto/create-staff.dto.js';
import type { StaffQueryDto } from './dto/staff-query.dto.js';
import type { UpdateStaffDto } from './dto/update-staff.dto.js';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  async create(dto: CreateStaffDto, callerId: string) {
    const existing = await this.prisma.staffAccount.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw AppException.conflict(
        'A staff account with this email already exists.',
      );
    }

    const passwordHash = await bcryptHash(generateOpaqueToken());

    const { staff, invitationToken } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.staffAccount.create({
        data: { name: dto.name, email: dto.email, role: dto.role, passwordHash, isActive: true },
      });
      const invitationToken = generateOpaqueToken();
      await tx.staffInvitation.create({
        data: {
          staffId: created.id,
          tokenHash: sha256Hash(invitationToken),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await this.auditService.log(
        { actorId: callerId, action: AuditAction.STAFF_CREATED, entityType: 'StaffAccount', entityId: created.id },
        tx,
      );
      return { staff: created, invitationToken };
    });

    const invitationUrl = `${this.configService.getOrThrow<string>('app.staffPortalUrl')}/set-password?token=${encodeURIComponent(invitationToken)}`;
    await this.emailService.sendStaffInvitation(staff.email, staff.name, invitationUrl);

    const { passwordHash: _passwordHash, ...safe } = staff;
    return safe;
  }

  async findAll(query: StaffQueryDto, callerRole: StaffRole) {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;
    const role = callerRole === StaffRole.EXAM_ADMIN ? query.role : StaffRole.INVIGILATOR;

    const where = search
      ? {
          ...(role ? { role } : {}),
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : role ? { role } : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.staffAccount.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.staffAccount.count({ where }),
    ]);

    const safeData = data.map(
      ({ passwordHash: _passwordHash, ...safe }) => safe,
    );

    return {
      staff: safeData,
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const staff = await this.prisma.staffAccount.findUnique({
      where: { id },
      include: {
        courses: { select: { id: true, name: true, status: true } },
        coordinatedCohorts: { select: { id: true, name: true, status: true } },
      },
    });
    if (!staff) {
      throw AppException.notFound('Staff member not found.');
    }
    const { passwordHash: _passwordHash, ...safe } = staff;
    return safe;
  }

  async unassignCourse(staffId: string, courseId: string) {
    const result = await this.prisma.course.updateMany({
      where: { id: courseId, instructorId: staffId },
      data: { instructorId: null },
    });
    if (result.count === 0) throw AppException.notFound('Course assignment not found.');
    return { success: true };
  }

  async unassignCohort(staffId: string, cohortId: string) {
    const result = await this.prisma.cohort.updateMany({
      where: { id: cohortId, coordinatorId: staffId },
      data: { coordinatorId: null },
    });
    if (result.count === 0) throw AppException.notFound('Cohort assignment not found.');
    return { success: true };
  }

  async update(id: string, dto: UpdateStaffDto, callerId: string) {
    const existing = await this.prisma.staffAccount.findUnique({
      where: { id },
    });
    if (!existing) {
      throw AppException.notFound('Staff member not found.');
    }

    if (dto.email && dto.email !== existing.email) {
      const conflict = await this.prisma.staffAccount.findUnique({
        where: { email: dto.email },
      });
      if (conflict) {
        throw AppException.conflict(
          'A staff account with this email already exists.',
        );
      }
    }

    const isDeactivation = dto.isActive === false;
    const isReactivation = dto.isActive === true && existing.isActive === false;
    const isEmailChange = dto.email !== undefined && dto.email !== existing.email;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.staffAccount.update({
        where: { id },
        data: { name: dto.name, email: dto.email, isActive: dto.isActive },
      });

      if (isDeactivation || isReactivation || isEmailChange) {
        await this.authService.revokeAllSessions(id, tx);
      }
      if (isDeactivation) {
        await this.auditService.log(
          { actorId: callerId, action: AuditAction.STAFF_DEACTIVATED, entityType: 'StaffAccount', entityId: id },
          tx,
        );
      }
      if (isReactivation) {
        await this.auditService.log(
          { actorId: callerId, action: AuditAction.STAFF_REACTIVATED, entityType: 'StaffAccount', entityId: id },
          tx,
        );
      }
      return result;
    });

    const { passwordHash: _passwordHash, ...safe } = updated;
    return safe;
  }

  async findByEmail(email: string) {
    return this.prisma.staffAccount.findUnique({ where: { email } });
  }
}
