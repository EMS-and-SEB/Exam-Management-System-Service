import { Controller, Get } from '@nestjs/common';
import { Roles, CurrentUser } from '../../auth/decorators/auth.decorator.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';
import { PortalCoursesService } from '../services/portal-courses.service.js';

@Roles(UserRole.STUDENT)
@Controller('portal/courses')
export class PortalCoursesController {
  constructor(private readonly portalCoursesService: PortalCoursesService) {}

  /**
   * GET /api/v1/portal/courses
   * Returns all active course enrollments and cohort memberships for the
   * authenticated student, including instructor / coordinator contact details.
   */
  @Get()
  getCourses(@CurrentUser() user: JwtPayload) {
    return this.portalCoursesService.getEnrolledCourses(user.sub);
  }
}
