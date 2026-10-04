import { Module } from '@nestjs/common';
import { PortalCoursesController } from './controllers/portal-courses.controller.js';
import { PortalCoursesService } from './services/portal-courses.service.js';

@Module({
  controllers: [PortalCoursesController],
  providers: [PortalCoursesService],
  exports: [PortalCoursesService],
})
export class PortalModule {}
