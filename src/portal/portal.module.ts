import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { PortalAuthController } from './controllers/portal-auth.controller.js';
import { PortalCoursesController } from './controllers/portal-courses.controller.js';
import { PortalExamsController } from './controllers/portal-exams.controller.js';
import { PortalAuthService } from './services/portal-auth.service.js';
import { PortalCoursesService } from './services/portal-courses.service.js';
import { PortalExamsService } from './services/portal-exams.service.js';

/**
 * PortalModule owns all student-facing portal features.
 *
 * Dependency map (no circular dependencies):
 *
 *   PrismaModule   — @Global(), PrismaService injected everywhere automatically
 *   ConfigModule   — @Global(isGlobal: true), ConfigService available everywhere
 *   AuthModule     — provides JwtModule (re-exported) so PortalAuthService can
 *                    inject JwtService using the same secret/expiry as staff tokens
 *   EmailModule    — provides EmailService for roster-inquiry dispatch (Phase 6)
 *
 * Exports:
 *   PortalAuthService    — available to future portal sub-modules
 *   PortalCoursesService — available to future portal sub-modules
 *                          (PortalExamsModule, etc.)
 */
@Module({
  imports: [
    AuthModule,   // re-exports JwtModule → JwtService available in this module
    EmailModule,  // EmailService → future inquiry / notification features
  ],
  controllers: [PortalAuthController, PortalCoursesController, PortalExamsController],
  providers: [PortalAuthService, PortalCoursesService, PortalExamsService],
  exports: [PortalAuthService, PortalCoursesService, PortalExamsService],
})
export class PortalModule {}

