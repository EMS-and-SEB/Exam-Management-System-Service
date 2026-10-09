import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';

@Module({
  controllers: [StudentsController],
  providers: [StudentsService, OrgUnitsService],
  exports: [StudentsService],
})
export class StudentsModule {}
