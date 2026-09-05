import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service.js';
import { CurrentUser, Public } from './decorators/auth.decorator.js';
import type { JwtPayload } from './validation/auth.interface.js';
import {
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  PasswordResetVerifyDto,
} from './validation/auth.dto.js';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, rawRefreshToken } = await this.authService.login(dto.email, dto.password);
    this.setRefreshCookie(res, rawRefreshToken);
    return { accessToken };
  }

  @Public()
  @Post('staff/refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, rawRefreshToken } = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setRefreshCookie(res, rawRefreshToken);
    return { accessToken };
  }

  @Public()
  @Post('staff/logout')
 @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE);
    return { success: true };
  }

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 10 * 60_000 } })
  @Post('staff/password-reset/request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: PasswordResetRequestDto) {
    await this.authService.requestPasswordReset(dto.email);
    return { sent: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 10 * 60_000 } })
  @Post('staff/password-reset/verify')
  @HttpCode(HttpStatus.OK)
  verifyPasswordReset(@Body() dto: PasswordResetVerifyDto) {
    return this.authService.verifyPasswordReset(dto.email, dto.code);
  }

  @Public()
  @Post('staff/password-reset/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(@Body() dto: PasswordResetConfirmDto) {
    await this.authService.confirmPasswordReset(dto.resetToken, dto.newPassword);
    return { success: true };
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.getOrThrow<string>('app.environment') === 'production',
      sameSite: 'strict',
      maxAge: this.configService.getOrThrow<number>('jwt.refreshExpiresInMs'),
      path: '/api/v1/auth/staff',
    });
  }
}