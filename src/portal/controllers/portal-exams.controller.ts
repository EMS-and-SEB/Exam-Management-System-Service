import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorator.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';
import { PortalExamsService } from '../services/portal-exams.service.js';

@Roles(UserRole.STUDENT)
@Controller('portal/exams')
export class PortalExamsController {
  constructor(private readonly portalExamsService: PortalExamsService) {}

  @Get('incoming')
  getIncomingExams(@CurrentUser() user: JwtPayload) {
    return this.portalExamsService.getIncomingExams(user.sub);
  }
}
