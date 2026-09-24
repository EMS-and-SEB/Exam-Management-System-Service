import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { EmailModule } from '../email/email.module.js';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}