import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StaffRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class CohortAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getCohortOrThrow(cohortId: string) {
    const cohort = await this.prisma.cohort.findUnique({
      where: { id: cohortId },
    });

    if (!cohort) {
      throw new NotFoundException('Cohort not found');
    }

    return cohort;
  }

  async assertCanManage(
    cohortId: string,
    userId: string,
    role: StaffRole,
  ) {
    const cohort = await this.getCohortOrThrow(cohortId);

    if (role === StaffRole.EXAM_ADMIN) {
      return cohort;
    }

    if (role !== StaffRole.EXIT_EXAM_COORDINATOR) {
      throw new ForbiddenException(
        'Only the cohort coordinator can manage this cohort',
      );
    }

    if (String(cohort.coordinatorId) !== String(userId)) {
      throw new ForbiddenException(
        'You do not have access to this cohort',
      );
    }

    return cohort;
  }

  async assertCanView(
    cohortId: string,
    userId: string,
    role: StaffRole,
  ) {
    return this.assertCanManage(cohortId, userId, role);
  }

  async isOwner(cohortId: string, userId: string): Promise<boolean> {
    const cohort = await this.prisma.cohort.findUnique({
      where: { id: cohortId },
      select: {
        coordinatorId: true,
      },
    });

    if (!cohort) {
      return false;
    }

    return String(cohort.coordinatorId) === String(userId);
  }
  async getOwnedCohort(
  cohortId: string,
  userId: string,
  role: StaffRole,
) {
  return this.assertCanManage(cohortId, userId, role);
}
}

