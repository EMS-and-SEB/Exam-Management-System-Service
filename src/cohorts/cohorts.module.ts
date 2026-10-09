import { Module } from '@nestjs/common';
import { CohortsController } from './cohorts.controller.js';
import { CohortsService } from './cohorts.service.js';
import { StudentsModule } from '../students/students.module.js';
import { OrgUnitsModule } from '../org-units/org-units.module.js';

@Module({
  imports: [StudentsModule, OrgUnitsModule],
  controllers: [CohortsController],
  providers: [CohortsService],
  exports: [CohortsService],
})
export class CohortsModule {}
