import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PortalAuthController } from './controllers/portal-auth.controller.js';
import { PortalAuthService } from './services/portal-auth.service.js';

/**
 * PortalModule owns all student-facing portal features.
 * It imports AuthModule to inherit the shared JwtModule (same signing secret
 * and expiry as staff tokens — the role claim distinguishes them at the guard level).
 */
@Module({
  imports: [AuthModule],
  controllers: [PortalAuthController],
  providers: [PortalAuthService],
})
export class PortalModule {}
