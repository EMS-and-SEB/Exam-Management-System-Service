import { Module } from '@nestjs/common';
import { QuestionsController } from './questions.controllers.js';
import { QuestionsService } from './questions.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [QuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
