import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AuditService } from './audit.service.js';
import { Roles } from '../auth/decorators/auth.decorator.js';
import { StaffRole } from '../generated/prisma/client.js';
import { AuditQueryDto } from './validation/audit.dto.js';

@Controller('users/:userId/audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Roles(StaffRole.EXAM_ADMIN)
  @Get()
  findForUser(@Param('userId', ParseUUIDPipe) userId: string, @Query() query: AuditQueryDto) {
    return this.auditService.findForUser(userId, query.page, query.limit);
  }
}