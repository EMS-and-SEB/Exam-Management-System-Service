import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorator.js';
import { SebClientKeyGuard } from './seb-client-key.guard.js';
import { HandshakeDto, VerifyExitDto } from './validation/seb.dto.js';
import { AuthService } from '../auth/auth.service.js';
import { Throttle } from '@nestjs/throttler';
import { AppException } from '../common/exceptions/app-exceptions.js';
import { SessionsService } from '../sessions/sessions.service.js';

@Controller('seb')
export class SebController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionsService: SessionsService,
  ) {}

  @Public()
  @UseGuards(SebClientKeyGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('handshake')
  @HttpCode(HttpStatus.OK)
  handshake(@Body() _dto: HandshakeDto) {
    return this.authService.issueSebHandshakeToken().then((handshakeToken) => ({ success: true, handshakeToken }));
  }

  @Public()
  @UseGuards(SebClientKeyGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-exit')
  @HttpCode(HttpStatus.OK)
  async verifyExit(@Body() dto: VerifyExitDto) {
    if (dto.sessionToken) {
      const invigilator = await this.authService.authenticateAssignedInvigilator(
        dto.sessionToken,
        dto.email,
        dto.password,
      );
      const exit = await this.sessionsService.exitByAuthorizedInvigilator(dto.sessionToken, invigilator.id);
      return { authorized: true, ...exit };
    } else if (dto.examOtp) {
      await this.authService.authenticateAssignedInvigilatorForExamOtp(dto.examOtp, dto.email, dto.password);
    } else {
      // The DTO refinement makes this unreachable for HTTP requests.
      throw AppException.badRequest('An exam session or access code is required.');
    }
    return { authorized: true };
  }

  @Public()
  @UseGuards(SebClientKeyGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('verify-return')
  @HttpCode(HttpStatus.OK)
  async verifyReturn(@Body() dto: VerifyExitDto) {
    if (dto.sessionToken) {
      await this.authService.authenticateAssignedInvigilator(
        dto.sessionToken,
        dto.email,
        dto.password,
        'return-to-login',
      );
    } else if (dto.examOtp) {
      await this.authService.authenticateAssignedInvigilatorForExamOtp(
        dto.examOtp,
        dto.email,
        dto.password,
        'return-to-login',
      );
    } else {
      throw AppException.badRequest('An exam session or access code is required.');
    }

    return { authorized: true };
  }
}
