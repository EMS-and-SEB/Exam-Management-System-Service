import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../auth/decorators/auth.decorator.js';
import { AppException } from '../../common/exceptions/app-exceptions.js';
import { SessionsService } from '../sessions.service.js';
import { SaveAnswerDto } from '../validation/sessions.dto.js';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Public()
  @Get(':id')
  async poll(@Param('id') id: string, @Req() req: Request) {
    this.assertToken(req, id);
    return this.sessionsService.getSession(id);
  }

  @Public()
  @Post(':id/answers')
  @HttpCode(HttpStatus.OK)
  async saveAnswer(
    @Param('id') id: string,
    @Body() dto: SaveAnswerDto,
    @Req() req: Request,
  ) {
    this.assertToken(req, id);
    return this.sessionsService.saveAnswer(id, dto);
  }

  @Public()
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  async submit(@Param('id') id: string, @Req() req: Request) {
    this.assertToken(req, id);
    return this.sessionsService.submit(id);
  }

  private assertToken(req: Request, sessionId: string) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw AppException.unauthorized('Missing session token.');
    }
    const token = auth.slice(7).trim();
    if (token !== sessionId) {
      throw AppException.unauthorized('Invalid session token.');
    }
  }
}
