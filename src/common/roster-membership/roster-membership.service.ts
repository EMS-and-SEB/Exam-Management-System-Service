import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class RosterMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  async addMember(
    cohortId: string,
    studentId: string,
    name: string,
  ) {
    const cohort = await this.prisma.cohort.findUnique({
      where: {
        id: cohortId,
      },
    });

    if (!cohort) {
      throw new NotFoundException('Cohort not found');
    }

    const normalizedStudentId = studentId.trim();
    const normalizedName = name.trim();

    if (!normalizedStudentId) {
      throw new BadRequestException('studentId is required');
    }

    if (!normalizedName) {
      throw new BadRequestException('name is required');
    }

    let student = await this.prisma.studentDirectory.findUnique({
      where: {
        studentId: normalizedStudentId,
      },
    });

    if (!student) {
      student = await this.prisma.studentDirectory.create({
        data: {
          studentId: normalizedStudentId,
          name: normalizedName,
        },
      });
    } else if (student.name !== normalizedName) {
      student = await this.prisma.studentDirectory.update({
        where: {
          id: student.id,
        },
        data: {
          name: normalizedName,
        },
      });
    }

    const existing = await this.prisma.cohortMember.findUnique({
      where: {
        cohortId_studentId: {
          cohortId,
          studentId: student.id,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        'Student is already a member of this cohort',
      );
    }

    const member = await this.prisma.cohortMember.create({
      data: {
        cohortId,
        studentId: student.id,
      },
      include: {
        student: true,
      },
    });

    return member;
  }

  async addOne(
    cohortId: string,
    studentId: string,
    name: string,
  ) {
    return this.addMember(
      cohortId,
      studentId,
      name,
    );
  }

  async addExistingStudents(
    cohortId: string,
    studentIds: string[],
  ) {
    const cohort = await this.prisma.cohort.findUnique({
      where: {
        id: cohortId,
      },
    });

    if (!cohort) {
      throw new NotFoundException('Cohort not found');
    }

    const added: string[] = [];
    const alreadyMember: string[] = [];

    const uniqueStudentIds = [
      ...new Set(
        studentIds
          .map((id) => String(id).trim())
          .filter(Boolean),
      ),
    ];

    for (const studentId of uniqueStudentIds) {
      const student = await this.prisma.studentDirectory.findUnique({
        where: {
          id: studentId,
        },
      });

      if (!student) {
        continue;
      }

      const existing = await this.prisma.cohortMember.findUnique({
        where: {
          cohortId_studentId: {
            cohortId,
            studentId: student.id,
          },
        },
      });

      if (existing) {
        alreadyMember.push(studentId);
        continue;
      }

      await this.prisma.cohortMember.create({
        data: {
          cohortId,
          studentId: student.id,
        },
      });

      added.push(studentId);
    }

    return {
      added,
      alreadyMember,
    };
  }

  async addKnown(
    cohortId: string,
    studentIds: string[],
  ) {
    return this.addExistingStudents(
      cohortId,
      studentIds,
    );
  }

  async getMembers(cohortId: string) {
    const cohort = await this.prisma.cohort.findUnique({
      where: {
        id: cohortId,
      },
    });

    if (!cohort) {
      throw new NotFoundException('Cohort not found');
    }

    const members = await this.prisma.cohortMember.findMany({
      where: {
        cohortId,
      },
      orderBy: {
        createdAt: 'asc',
      },
      include: {
        student: true,
      },
    });

    return members;
  }

  async list(cohortId: string) {
    return this.getMembers(cohortId);
  }

  async removeMember(
    cohortId: string,
    studentId: string,
  ) {
    const cohort = await this.prisma.cohort.findUnique({
      where: {
        id: cohortId,
      },
      include: {
        exams: {
          where: {
            OR: [
              {
                status: 'RELEASED',
              },
              {
                status: 'CLOSED',
              },
            ],
          },
          select: {
            id: true,
            status: true,
          },
          take: 1,
        },
      },
    });

    if (!cohort) {
      throw new NotFoundException('Cohort not found');
    }

    if (cohort.exams.length > 0) {
      throw new ForbiddenException(
        'Members cannot be removed after the exit exam has been released or taken',
      );
    }

    const normalizedStudentId = studentId.trim();

    if (!normalizedStudentId) {
      throw new BadRequestException(
        'studentId is required',
      );
    }

    const member = await this.prisma.cohortMember.findFirst({
      where: {
        cohortId,
        student: {
          studentId: normalizedStudentId,
        },
      },
      include: {
        student: true,
      },
    });

    if (!member) {
      throw new NotFoundException(
        'Student is not a member of this cohort',
      );
    }

    await this.prisma.cohortMember.delete({
      where: {
        id: member.id,
      },
    });

    return {
      success: true,
    };
  }

  async remove(
    cohortId: string,
    studentId: string,
  ) {
    return this.removeMember(
      cohortId,
      studentId,
    );
  }
}
