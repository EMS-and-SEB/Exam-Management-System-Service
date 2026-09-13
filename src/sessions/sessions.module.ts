import { Module } from '@nestjs/common';
import { SessionsController } from './controllers/sessions.controller.js';
import { StudentAuthController } from './controllers/student-auth.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  controllers: [SessionsController, StudentAuthController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
