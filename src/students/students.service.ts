import { Injectable } from '@nestjs/common';
import { bcryptHash } from '../auth/utils/hash.util.js';
import { parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StudentDirectory } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { StudentQueryDto } from './dto/student-query.dto.js';
import type { UpdateStudentDto } from './dto/update-student.dto.js';

/** Strip the password hash before sending any student record to the client. */
function sanitizeStudent(student: StudentDirectory): Omit<StudentDirectory, 'passwordHash'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _hash, ...safe } = student;
  return safe;
}

@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateStudentDto) {
    const existing = await this.prisma.studentDirectory.findUnique({
      where: { studentId: dto.studentId },
    });
    if (existing) {
      throw AppException.conflict('A student with this ID already exists.');
    }

    // Fall back to studentId as the initial password when none is provided.
    const passwordHash = await bcryptHash(dto.password ?? dto.studentId);

    const student = await this.prisma.studentDirectory.create({
      data: {
        studentId: dto.studentId,
        name: dto.name,
        email: dto.email,
        passwordHash,
      },
    });
    return sanitizeStudent(student);
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
      students: data.map(sanitizeStudent),
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
    return sanitizeStudent(student);
  }

  async update(id: string, dto: UpdateStudentDto) {
    const existing = await this.prisma.studentDirectory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw AppException.notFound('Student not found.');
    }

    if (dto.studentId && dto.studentId !== existing.studentId) {
      const conflict = await this.prisma.studentDirectory.findUnique({
        where: { studentId: dto.studentId },
      });
      if (conflict) {
        throw AppException.conflict('A student with this ID already exists.');
      }
    }

    // Only hash a new password when explicitly provided by the admin.
    const passwordHash = dto.password ? await bcryptHash(dto.password) : undefined;

    const updated = await this.prisma.studentDirectory.update({
      where: { id },
      data: {
        studentId: dto.studentId,
        name: dto.name,
        email: dto.email,
        isActive: dto.isActive,
        ...(passwordHash !== undefined && { passwordHash }),
      },
    });
    return sanitizeStudent(updated);
  }

  async importStudents(fileBuffer: Buffer) {
    const { rows, errors } = parseRosterCsv(fileBuffer);
    if (rows.length === 0) return { created: 0, updated: 0, errors };

    const studentIds = rows.map((r) => r.studentId);
    const existing = await this.prisma.studentDirectory.findMany({
      where: { studentId: { in: studentIds } },
    });
    const existingMap = new Map(existing.map((s) => [s.studentId, s]));

    const newRows = rows.filter((r) => !existingMap.has(r.studentId));
    const rowsToUpdate = rows.filter((r) => {
      const current = existingMap.get(r.studentId);
      return current && current.name !== r.name;
    });

    // Pre-hash all passwords before the transaction so async work stays outside of it.
    const newRowsWithHashes = await Promise.all(
      newRows.map(async (r) => ({
        studentId: r.studentId,
        name: r.name,
        email: r.email,
        passwordHash: await bcryptHash(r.password ?? r.studentId),
      })),
    );

    await this.prisma.$transaction([
      ...(newRowsWithHashes.length > 0
        ? [
            this.prisma.studentDirectory.createMany({
              data: newRowsWithHashes,
              skipDuplicates: true,
            }),
          ]
        : []),
      ...rowsToUpdate.map((r) =>
        this.prisma.studentDirectory.update({
          where: { studentId: r.studentId },
          data: { name: r.name },
        }),
      ),
    ]);

    return { created: newRows.length, updated: rowsToUpdate.length, errors };
  }

  async findOrCreateByStudentId(
    studentId: string,
    name?: string,
  ): Promise<StudentDirectory> {
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

      // System-created records get a deterministic initial password.
      const passwordHash = await bcryptHash(studentId);
      return tx.studentDirectory.create({
        data: { studentId, name, passwordHash },
      });
    });
  }
}

