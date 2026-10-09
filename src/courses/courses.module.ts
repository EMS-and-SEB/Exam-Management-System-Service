import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';
import { StudentsModule } from '../students/students.module.js';
import { OrgUnitsModule } from '../org-units/org-units.module.js';

@Module({
  imports: [StudentsModule, OrgUnitsModule],
  controllers: [CoursesController],
  providers: [CoursesService],
})
export class CoursesModule {}