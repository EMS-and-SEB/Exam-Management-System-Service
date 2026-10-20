import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller.js';
import { InvigilationController } from './invigilation.controller.js';
import { ExamService } from './exam.service.js';
import { OrgUnitsModule } from '../org-units/org-units.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';

@Module({
  imports: [OrgUnitsModule, SessionsModule],
  controllers: [ExamController, InvigilationController],
  providers: [ExamService],
})
export class ExamModule {}
