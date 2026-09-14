import { Body, Controller, Get, Put } from '@nestjs/common';
import { RetentionPolicyService } from './retention.service.js';
import { Roles, CurrentUser } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';
import { UpdateRetentionPolicyDto } from './validation/retention-policy.dto.js';

@Controller('retention-policy')
@Roles(StaffRole.EXAM_ADMIN)
export class RetentionPolicyController {
  constructor(private readonly retentionPolicyService: RetentionPolicyService) {}

  @Get()
  get() {
    return this.retentionPolicyService.get();
  }

  @Put()
  update(@Body() dto: UpdateRetentionPolicyDto, @CurrentUser() user: JwtPayload) {
    return this.retentionPolicyService.update(dto.resultRetentionDays, user.sub);
  }
}