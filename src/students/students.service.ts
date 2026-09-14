import { Injectable } from '@nestjs/common';
import { parseRosterCsv } from '../common/utils/csv-parser.util.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { StudentDirectory } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStudentDto } from './dto/create-student.dto.js';
import type { StudentQueryDto } from './dto/student-query.dto.js';
import type { UpdateStudentDto } from './dto/update-student.dto.js';

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

    const student = await this.prisma.studentDirectory.create({
      data: {
        studentId: dto.studentId,
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

    if (dto.studentId && dto.studentId !== existing.studentId) {
      const conflict = await this.prisma.studentDirectory.findUnique({
        where: { studentId: dto.studentId },
      });
      if (conflict) {
        throw AppException.conflict('A student with this ID already exists.');
      }
    }

    return this.prisma.studentDirectory.update({
      where: { id },
      data: {
        studentId: dto.studentId,
        name: dto.name,
      },
    });
  }

  async bulkImport(fileBuffer: Buffer) {
    const { rows, errors } = parseRosterCsv(fileBuffer);
    if (rows.length === 0) return { created: 0, updated: 0, errors };

    const studentIds = rows.map((r) => r.studentId);
    const existing = await this.prisma.studentDirectory.findMany({ where: { studentId: { in: studentIds } } });
    const existingMap = new Map(existing.map((s) => [s.studentId, s]));

    const newRows = rows.filter((r) => !existingMap.has(r.studentId));
    const rowsToUpdate = rows.filter((r) => {
      const current = existingMap.get(r.studentId);
      return current && current.name !== r.name;
    });

    await this.prisma.$transaction([
      ...(newRows.length > 0
        ? [this.prisma.studentDirectory.createMany({
            data: newRows.map((r) => ({ studentId: r.studentId, name: r.name })),
            skipDuplicates: true,
          })]
        : []),
      ...rowsToUpdate.map((r) =>
        this.prisma.studentDirectory.update({ where: { studentId: r.studentId }, data: { name: r.name } }),
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

      return tx.studentDirectory.create({
        data: { studentId, name },
      });
    });
  }
}
