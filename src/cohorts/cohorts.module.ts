import { Module } from '@nestjs/common';
import { CohortsController } from './cohorts.controller.js';
import { CohortsService } from './cohorts.service.js';
import { StudentsModule } from '../students/students.module.js';

@Module({
  imports: [StudentsModule],
  controllers: [CohortsController],
  providers: [CohortsService],
  exports: [CohortsService],
})
export class CohortsModule {}
