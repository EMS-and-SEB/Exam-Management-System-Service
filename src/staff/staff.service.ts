import { Injectable } from '@nestjs/common';
import { bcryptHash } from '../auth/utils/hash.util.js';
import { generateOpaqueToken } from '../auth/utils/token.util.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction } from '../audit/audit.const.js';
import { AuthService } from '../auth/auth.service.js';
import type { CreateStaffDto } from './dto/create-staff.dto.js';
import type { StaffQueryDto } from './dto/staff-query.dto.js';
import type { UpdateStaffDto } from './dto/update-staff.dto.js';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly authService: AuthService,
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

    const staff = await this.prisma.$transaction(async (tx) => {
      const created = await tx.staffAccount.create({
        data: { name: dto.name, email: dto.email, role: dto.role, passwordHash, isActive: true },
      });
      await this.auditService.log(
        { actorId: callerId, action: AuditAction.STAFF_CREATED, entityType: 'StaffAccount', entityId: created.id },
        tx,
      );
      return created;
    });

    const { passwordHash: _passwordHash, ...safe } = staff;
    return safe;
  }

  async findAll(query: StaffQueryDto) {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

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
    const staff = await this.prisma.staffAccount.findUnique({ where: { id } });
    if (!staff) {
      throw AppException.notFound('Staff member not found.');
    }
    const { passwordHash: _passwordHash, ...safe } = staff;
    return safe;
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
