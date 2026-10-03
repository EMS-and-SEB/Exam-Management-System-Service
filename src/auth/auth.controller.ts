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
  StaffInvitationDto,
  StaffInvitationCompleteDto,
} from './validation/auth.dto.js';

/**
 * Single cookie name for the unified auth flow.
 * Cookie path is /api/v1/auth so the browser sends it back on all auth routes
 * (login, refresh, logout, me) for both staff and students.
 */
const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH    = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  // ── Unified primary endpoints ────────────────────────────────────────────

  /**
   * POST /api/v1/auth/login
   * Accepts { identifier, password } where identifier is either a staff email
   * or a student's studentId / email.
   * Also accepts the legacy { email, password } shape (preprocessed by LoginDto).
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, rawRefreshToken, user } = await this.authService.login(
      (dto as unknown as { identifier: string }).identifier,
      dto.password,
    );
    this.setRefreshCookie(res, rawRefreshToken);
    return { jwt: accessToken, user };
  }

  /**
   * POST /api/v1/auth/refresh
   * Rotates the refresh token cookie and returns a new JWT.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, rawRefreshToken } = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
    this.setRefreshCookie(res, rawRefreshToken);
    return { jwt: accessToken };
  }

  /**
   * POST /api/v1/auth/logout
   * Revokes the current token and clears the cookie.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
    return { success: true };
  }

  /**
   * GET /api/v1/auth/me
   * Returns the authenticated user's safe profile (staff or student).
   */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub, user.role);
  }

  // ── Backwards-compatible staff-prefixed aliases ──────────────────────────
  // Keeps any existing staff front-end / integration clients working without
  // changes. All three delegate directly to the unified methods above.

  /** @deprecated Use POST /api/v1/auth/login */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('staff/login')
  @HttpCode(HttpStatus.OK)
  staffLogin(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.login(dto, res);
  }

  /** @deprecated Use POST /api/v1/auth/refresh */
  @Public()
  @Post('staff/refresh')
  @HttpCode(HttpStatus.OK)
  staffRefresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.refresh(req, res);
  }

  /** @deprecated Use POST /api/v1/auth/logout */
  @Public()
  @Post('staff/logout')
  @HttpCode(HttpStatus.OK)
  staffLogout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.logout(req, res);
  }

  // ── Staff password-reset & invitation (unchanged) ────────────────────────

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

  @Public()
  @Post('staff/invitation/verify')
  verifyStaffInvitation(@Body() dto: StaffInvitationDto) {
    return this.authService.verifyStaffInvitation(dto.token);
  }

  @Public()
  @Post('staff/invitation/complete')
  async completeStaffInvitation(@Body() dto: StaffInvitationCompleteDto) {
    await this.authService.completeStaffInvitation(dto.token, dto.newPassword);
    return { success: true };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.getOrThrow<string>('app.environment') === 'production',
      sameSite: 'strict',
      maxAge: this.configService.getOrThrow<number>('jwt.refreshExpiresInMs'),
      path: COOKIE_PATH,
    });
  }
}