import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';
import { OrgUnitsService } from '../org-units/org-units.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [StudentsController],
  providers: [StudentsService, OrgUnitsService],
  exports: [StudentsService],
})
export class StudentsModule {}
