import { Module } from '@nestjs/common';
import { ResultsExportModule } from '../common/results-export/results-export.module.js';
import {
  AnswerGradingController,
  CohortResultsController,
  CourseResultsController,
  ExamResultsController,
  SessionAnswersController,
} from './grading.controllers.js';
import { GradingService } from './grading.service.js';

@Module({
  imports: [ResultsExportModule],
  controllers: [
    ExamResultsController,
    SessionAnswersController,
    AnswerGradingController,
    CourseResultsController,
    CohortResultsController,
  ],
  providers: [GradingService],
  exports: [GradingService],
})
export class GradingModule {}
