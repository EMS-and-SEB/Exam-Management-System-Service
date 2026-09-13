import { Module } from '@nestjs/common';
import { ResultsExportService } from './results-export.service.js';

@Module({
  providers: [ResultsExportService],
  exports: [ResultsExportService],
})
export class ResultsExportModule {}
