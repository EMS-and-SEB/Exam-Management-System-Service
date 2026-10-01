import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class PortalCoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async getEnrolledCourses(studentDirectoryId: string) {
    const [enrollments, cohortMemberships] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          studentId: studentDirectoryId,
          deletedAt: null,
        },
        select: {
          course: {
            select: {
              id: true,
              name: true,
              status: true,
              instructor: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      }),

      this.prisma.cohortMember.findMany({
        where: {
          studentId: studentDirectoryId,
          deletedAt: null,
        },
        select: {
          cohort: {
            select: {
              id: true,
              name: true,
              status: true,
              coordinator: {
                select: { id: true, name: true, email: true },
              },
            },
          },
        },
      }),
    ]);

    return {
      courses: enrollments.map((e) => e.course),
      cohorts: cohortMemberships.map((m) => m.cohort),
    };
  }
}
