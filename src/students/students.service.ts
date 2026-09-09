import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
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

  async bulkImport(fileBuffer: Buffer): Promise<{
    created: number;
    updated: number;
    errors: Array<{ row: number; reason: string }>;
  }> {
    let records: any[];
    try {
      records = parse(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (_err) {
      throw AppException.badRequest('Invalid CSV format.');
    }

    const results = {
      created: 0,
      updated: 0,
      errors: [] as Array<{ row: number; reason: string }>,
    };

    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rowNum = i + 2;

      const studentId = row.studentId?.trim();
      const name = row.name?.trim();

      if (!studentId) {
        results.errors.push({ row: rowNum, reason: 'Missing studentId.' });
        continue;
      }
      if (!name) {
        results.errors.push({ row: rowNum, reason: 'Missing name.' });
        continue;
      }

      try {
        const existing = await this.prisma.studentDirectory.findUnique({
          where: { studentId },
        });
        if (existing) {
          await this.prisma.studentDirectory.update({
            where: { studentId },
            data: { name },
          });
          results.updated += 1;
        } else {
          await this.prisma.studentDirectory.create({
            data: { studentId, name },
          });
          results.created += 1;
        }
      } catch (err) {
        results.errors.push({
          row: rowNum,
          reason: 'Database error: ' + ((err as Error)?.message || 'unknown'),
        });
      }
    }

    return results;
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
