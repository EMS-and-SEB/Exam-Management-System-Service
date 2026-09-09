import { Module } from '@nestjs/common';
import { CsvImportService } from './csv-import.service.js';

@Module({
  providers: [CsvImportService],
  exports: [CsvImportService],
})
export class CsvImportModule {}