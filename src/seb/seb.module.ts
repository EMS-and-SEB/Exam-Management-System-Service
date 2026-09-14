import { Module } from '@nestjs/common';
import { SebController } from './seb.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [SebController],
})
export class SebModule {}