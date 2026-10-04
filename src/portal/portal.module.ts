import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { PortalCoursesController } from './controllers/portal-courses.controller.js';
import { PortalCoursesService } from './services/portal-courses.service.js';
import { PortalExamsController } from './controllers/portal-exams.controller.js';
import { PortalExamsService } from './services/portal-exams.service.js';

@Module({
  imports: [EmailModule],
  controllers: [PortalCoursesController, PortalExamsController],
  providers: [PortalCoursesService, PortalExamsService],
  exports: [PortalCoursesService, PortalExamsService],
})
export class PortalModule {}
