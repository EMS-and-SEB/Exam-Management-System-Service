import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';
import { PortalAuthController } from './controllers/portal-auth.controller.js';
import { PortalAuthService } from './services/portal-auth.service.js';

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
 *   PortalAuthService — available to future portal sub-modules
 *                       (PortalCoursesModule, PortalExamsModule, etc.)
 */
@Module({
  imports: [
    AuthModule,   // re-exports JwtModule → JwtService available in this module
    EmailModule,  // EmailService → future inquiry / notification features
  ],
  controllers: [PortalAuthController],
  providers: [PortalAuthService],
  exports: [PortalAuthService],
})
export class PortalModule {}
