import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { Public } from '../../auth/decorators/auth.decorator.js';
import { SessionsService } from '../sessions.service.js';
import { SaveAnswerDto } from '../validation/sessions.dto.js';
import { UseGuards } from '@nestjs/common';
import { StudentSessionGuard } from '../../common/guards/student-session.guard.js';

@Controller('sessions')
@Public()
@UseGuards(StudentSessionGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get(':id')
  poll(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessionsService.getSession(id);
  }

  @Post(':id/answers')
  @HttpCode(HttpStatus.OK)
  saveAnswer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveAnswerDto) {
    return this.sessionsService.saveAnswer(id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessionsService.submit(id);
  }
}