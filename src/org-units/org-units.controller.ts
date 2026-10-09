import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles } from '../auth/decorators/auth.decorator.js';
import type { JwtPayload } from '../auth/validation/auth.interface.js';
import { StaffRole } from '../generated/prisma/client.js';
import { OrgUnitsService } from './org-units.service.js';

@Controller('org-units')
export class OrgUnitsController {
  constructor(private readonly orgUnitsService: OrgUnitsService) {}

  @Get()
  @Roles(StaffRole.SUPER_ADMIN, StaffRole.UNIT_ADMIN)
  listScoped(@CurrentUser() user: JwtPayload) {
    return this.orgUnitsService.listScoped(user.orgUnitId);
  }
}