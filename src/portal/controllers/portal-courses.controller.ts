import { Controller, Get } from '@nestjs/common';
import { CurrentUser, Roles } from '../../auth/decorators/auth.decorator.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';
import { PortalCoursesService } from '../services/portal-courses.service.js';

@Roles(UserRole.STUDENT)
@Controller('portal/courses')
export class PortalCoursesController {
  constructor(private readonly portalCoursesService: PortalCoursesService) {}

  @Get()
  getEnrolledCourses(@CurrentUser() user: JwtPayload) {
    return this.portalCoursesService.getEnrolledCourses(user.sub);
  }
}
