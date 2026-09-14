import { Module } from '@nestjs/common';
import { ExamController } from './exam.controller.js';
import { ExamService } from './exam.service.js';

@Module({
  controllers: [ExamController],
  providers: [ExamService],
})
export class ExamModule {}