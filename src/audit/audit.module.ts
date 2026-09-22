import { Global, Module } from '@nestjs/common';
import { AuditController, RecentAuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Global()
@Module({
  controllers: [AuditController, RecentAuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}