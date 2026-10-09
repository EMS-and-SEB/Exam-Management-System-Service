import { Injectable } from '@nestjs/common';
import { findNameMismatches, parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StudentDirectory } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { StudentQueryDto } from './dto/student-query.dto.js';
import type { UpdateStudentDto } from './dto/update-student.dto.js';
import { StaffRole } from '../generated/prisma/client.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';

function normalizeStudentId(studentId: string): string {
  return studentId.trim().toUpperCase();
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgUnitsService: OrgUnitsService,
  ) {}

  async create(dto: CreateStudentDto) {
    const studentId = normalizeStudentId(dto.studentId);
    const existing = await this.prisma.studentDirectory.findUnique({
      where: { studentId },
    });
    if (existing) {
      throw AppException.conflict('A student with this ID already exists.');
    }

    const student = await this.prisma.studentDirectory.create({
      data: {
        studentId,
        name: dto.name,
      },
    });
    return student;
  }

  async findAll(query: StudentQueryDto) {
    const { page, limit, search } = query;
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { studentId: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [data, total] = await this.prisma.$transaction([
      this.prisma.studentDirectory.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.studentDirectory.count({ where }),
    ]);

    return {
      students: data,
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const student = await this.prisma.studentDirectory.findUnique({
      where: { id },
    });
    if (!student) {
      throw AppException.notFound('Student not found.');
    }
    return student;
  }

  async update(id: string, dto: UpdateStudentDto) {
    const existing = await this.prisma.studentDirectory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw AppException.notFound('Student not found.');
    }

    const studentId = dto.studentId ? normalizeStudentId(dto.studentId) : undefined;
    if (studentId && studentId !== existing.studentId) {
      const conflict = await this.prisma.studentDirectory.findUnique({
        where: { studentId },
      });
      if (conflict) {
        throw AppException.conflict('A student with this ID already exists.');
      }
    }

    return this.prisma.studentDirectory.update({
      where: { id },
      data: {
        studentId,
        name: dto.name,
      },
    });
  }

  async importStudents(fileBuffer: Buffer) {
    const { rows, errors } = parseRosterCsv(fileBuffer);
    if (rows.length === 0) return { created: 0, alreadyExisted: 0, nameMismatches: [], errors };

    const normalizedRows = Array.from(
      new Map(rows.map((row) => [normalizeStudentId(row.studentId), {
        ...row,
        studentId: normalizeStudentId(row.studentId),
      }])).values(),
    );
    const studentIds = normalizedRows.map((r) => r.studentId);
    const existing = await this.prisma.studentDirectory.findMany({ where: { studentId: { in: studentIds } } });
    const existingMap = new Map(existing.map((s) => [s.studentId, s]));
    const nameMismatches = findNameMismatches(normalizedRows, existing);

    const newRows = normalizedRows.filter((r) => !existingMap.has(r.studentId));
    const alreadyExisted = normalizedRows.length - newRows.length;

    if (newRows.length > 0) {
      await this.prisma.studentDirectory.createMany({
        data: newRows.map((r) => ({ studentId: r.studentId, name: r.name })),
        skipDuplicates: true,
      });
    }

    return { created: newRows.length, alreadyExisted, nameMismatches, errors };
  }

  async findOrCreateByStudentId(
    studentId: string,
    name?: string,
  ): Promise<StudentDirectory> {
    studentId = normalizeStudentId(studentId);
    const existing = await this.prisma.studentDirectory.findUnique({
      where: { studentId },
    });
    if (existing) return existing;

    if (!name) {
      throw AppException.badRequest('Cannot create student without a name.');
    }

    return await this.prisma.$transaction(async (tx) => {
      const maybeNow = await tx.studentDirectory.findUnique({
        where: { studentId },
      });
      if (maybeNow) return maybeNow;

      return tx.studentDirectory.create({
        data: { studentId, name },
      });
    });
  }

    async findEnrollments(id: string, caller: JwtPayload) {
    const student = await this.prisma.studentDirectory.findUnique({ where: { id } });
    if (!student) throw AppException.notFound('Student not found.');

    const scopedOrgUnitIds =
      caller.role === StaffRole.UNIT_ADMIN
        ? await this.orgUnitsService.getScopedIds(caller.orgUnitId)
        : undefined;

    const [enrollments, memberships] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where: {
          studentId: student.id,
          deletedAt: null,
          ...(scopedOrgUnitIds ? { course: { orgUnitId: { in: scopedOrgUnitIds } } } : {}),
        },
        include: { course: { select: { id: true, name: true, status: true, orgUnitId: true } } },
      }),
      this.prisma.cohortMember.findMany({
        where: {
          studentId: student.id,
          deletedAt: null,
          ...(scopedOrgUnitIds ? { cohort: { orgUnitId: { in: scopedOrgUnitIds } } } : {}),
        },
        include: { cohort: { select: { id: true, name: true, status: true, orgUnitId: true } } },
      }),
    ]);

    return {
      courses: enrollments.map((e) => e.course),
      cohorts: memberships.map((m) => m.cohort),
    };
  }
}


