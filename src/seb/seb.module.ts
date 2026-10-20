import { Module } from '@nestjs/common';
import { SebController } from './seb.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { SessionsModule } from '../sessions/sessions.module.js';

@Module({
  imports: [AuthModule, SessionsModule],
  controllers: [SebController],
})
export class SebModule {}
