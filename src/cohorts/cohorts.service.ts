import { Injectable } from '@nestjs/common';
import { CohortStatus, StaffRole } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { CohortAccessService } from '../common/guards/cohort-access.js';
import { RosterMembershipService } from '../common/roster-membership/roster-membership.service.js';
import { CsvImportService } from '../common/csv-import/csv-import.service.js';
import type { AddMemberDto, CreateCohortDto, SelectMembersDto, UpdateCohortDto } from './validation/cohorts.dto.js';

@Injectable()
export class CohortsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: CohortAccessService,
    private readonly roster: RosterMembershipService,
    private readonly csv: CsvImportService,
  ) {}

  async create(dto: CreateCohortDto) {
    const coordinator = await this.prisma.staffAccount.findUnique({ where: { id: dto.coordinatorId }, select: { id: true, role: true, isActive: true } });
    if (!coordinator || coordinator.role !== StaffRole.EXIT_EXAM_COORDINATOR || !coordinator.isActive) {
      throw AppException.badRequest('coordinatorId must reference an active Exit Exam Coordinator.');
    }
    return this.prisma.cohort.create({ data: { name: dto.name, coordinatorId: dto.coordinatorId } });
  }

  async list(userId: string, role: StaffRole) {
    const where = role === StaffRole.EXAM_ADMIN ? {} : { coordinatorId: userId };
    return this.prisma.cohort.findMany({ where, orderBy: { createdAt: 'desc' }, include: { coordinator: { select: { id: true, name: true, email: true } } } });
  }

  async get(id: string, userId: string, role: StaffRole) {
    await this.access.getOwnedCohort(id, userId, role);
    return this.prisma.cohort.findUnique({ where: { id }, include: { coordinator: { select: { id: true, name: true, email: true } } } });
  }

  async update(id: string, dto: UpdateCohortDto) {
    const cohort = await this.prisma.cohort.findUnique({ where: { id } });
    if (!cohort) throw AppException.notFound('Cohort not found.');
    if (dto.coordinatorId) {
      const coordinator = await this.prisma.staffAccount.findUnique({ where: { id: dto.coordinatorId }, select: { role: true, isActive: true } });
      if (!coordinator || coordinator.role !== StaffRole.EXIT_EXAM_COORDINATOR || !coordinator.isActive) throw AppException.badRequest('coordinatorId must reference an active Exit Exam Coordinator.');
    }
    return this.prisma.cohort.update({
      where: { id },
      data: { name: dto.name, coordinatorId: dto.coordinatorId, status: dto.status as CohortStatus | undefined },
    });
  }

  async addMember(id: string, userId: string, dto: AddMemberDto) {
    await this.access.getOwnedCohort(id, userId, StaffRole.EXIT_EXAM_COORDINATOR);
    const member = await this.roster.addOne(id, dto.studentId, dto.name);
    return member;
  }

  async selectMembers(id: string, userId: string, dto: SelectMembersDto) {
    await this.access.getOwnedCohort(id, userId, StaffRole.EXIT_EXAM_COORDINATOR);
    return this.roster.addKnown(id, dto.studentIds);
  }

  async listMembers(id: string, userId: string, role: StaffRole) {
    await this.access.getOwnedCohort(id, userId, role);
    return this.roster.list(id);
  }

  async removeMember(id: string, studentId: string, userId: string) {
    await this.access.getOwnedCohort(id, userId, StaffRole.EXIT_EXAM_COORDINATOR);
    await this.roster.remove(id, studentId);
  }

  async bulkMembers(id: string, userId: string, file: { buffer?: Buffer }) {
    await this.access.getOwnedCohort(id, userId, StaffRole.EXIT_EXAM_COORDINATOR);
    if (!file?.buffer) throw AppException.badRequest('CSV file is required.');
    const rows = await this.csv.parseStudents(file.buffer);
    let created = 0, alreadyExisted = 0, added = 0;
    const errors: { row: number; reason: string }[] = [];

    for (const row of rows) {
      if (!row.studentId || !row.name) { errors.push({ row: row.row, reason: 'studentId and name are required.' }); continue; }
      try {
        const existing = await this.prisma.studentDirectory.findUnique({ where: { studentId: row.studentId }, select: { id: true } });
        const student = existing
          ? existing
          : await this.prisma.studentDirectory.create({ data: { studentId: row.studentId, name: row.name }, select: { id: true } });
        if (existing) alreadyExisted++;
        const member = await this.prisma.cohortMember.findUnique({ where: { cohortId_studentId: { cohortId: id, studentId: student.id } }, select: { id: true } });
        if (member) { errors.push({ row: row.row, reason: 'Student is already a member of this cohort.' }); continue; }
        await this.prisma.cohortMember.create({ data: { cohortId: id, studentId: student.id } });
        added++;
        if (!existing) created++;
      } catch (error: any) {
        errors.push({ row: row.row, reason: error?.message ?? 'Unable to import row.' });
      }
    }
    return { created, alreadyExisted, added, errors };
  }
}
