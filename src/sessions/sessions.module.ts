import { Module } from '@nestjs/common';
import { SessionsController } from './controllers/sessions.controller.js';
import { StudentAuthController } from './controllers/student-auth.controller.js';
import { SessionsService } from './sessions.service.js';
import { AuthModule } from '../auth/auth.module.js'; // <-- THIS IS THE CRITICAL LINE

@Module({
  imports: [AuthModule], // <-- THIS BRINGS IN JwtService
  controllers: [SessionsController, StudentAuthController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}