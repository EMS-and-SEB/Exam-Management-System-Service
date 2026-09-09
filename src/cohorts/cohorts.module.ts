import { Module } from '@nestjs/common';
import { CohortsController } from './cohorts.controller.js';
import { CohortsService } from './cohorts.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { CsvImportModule } from '../common/csv-import/csv-import.module.js';
import { RosterMembershipModule } from '../common/roster-membership/roster-membership.module.js';
import { CohortAccessService } from '../common/guards/cohort-access.js';

@Module({
  imports: [PrismaModule, CsvImportModule, RosterMembershipModule],
  controllers: [CohortsController],
  providers: [CohortsService, CohortAccessService],
  exports: [CohortsService],
})
export class CohortsModule {}
