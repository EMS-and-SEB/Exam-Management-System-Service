import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../auth/decorators/auth.decorator.js';
import { SessionsService } from '../sessions.service.js';
import { StudentLoginDto } from '../validation/sessions.dto.js';

@Controller('students')
export class StudentAuthController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: StudentLoginDto) {
    return this.sessionsService.studentLogin(dto);
  }
}
