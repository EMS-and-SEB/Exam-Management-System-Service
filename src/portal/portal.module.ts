import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module.js';
import { PortalCoursesController } from './controllers/portal-courses.controller.js';
import { PortalExamsController } from './controllers/portal-exams.controller.js';
import { PortalCoursesService } from './services/portal-courses.service.js';
import { PortalExamsService } from './services/portal-exams.service.js';

/**
 * PortalModule owns all student-facing academic portal features.
 *
 * Authentication is now handled entirely by AuthModule (unified login/refresh/logout/me).
 * This module only owns academic data endpoints: courses, exams, results, inquiries.
 *
 * Dependency map (no circular dependencies):
 *
 *   PrismaModule — @Global(), PrismaService injected everywhere automatically
 *   ConfigModule — @Global(isGlobal: true), ConfigService available everywhere
 *   AuditModule  — @Global(), AuditService available everywhere
 *   EmailModule  — provides EmailService for roster-inquiry dispatch
 */
@Module({
  imports: [EmailModule],
  controllers: [PortalCoursesController, PortalExamsController],
  providers: [PortalCoursesService, PortalExamsService],
  exports: [PortalCoursesService, PortalExamsService],
})
export class PortalModule {}
