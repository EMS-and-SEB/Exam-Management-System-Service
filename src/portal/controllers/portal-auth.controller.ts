import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { PortalAuthService } from '../services/portal-auth.service.js';
import { PortalLoginDto } from '../validation/portal-auth.dto.js';
import { CurrentUser, Public, Roles } from '../../auth/decorators/auth.decorator.js';
import { UserRole } from '../../auth/validation/auth.interface.js';
import type { JwtPayload } from '../../auth/validation/auth.interface.js';

/** Cookie name is scoped to the portal auth path only. */
const PORTAL_REFRESH_COOKIE = 'portal_refresh_token';

@Controller('portal/auth')
export class PortalAuthController {
  constructor(
    private readonly portalAuthService: PortalAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * POST /api/v1/portal/auth/login
   * Verifies studentId + password and issues a JWT + httpOnly refresh cookie.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: PortalLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, rawRefreshToken, student } = await this.portalAuthService.login(
      dto.studentId,
      dto.password,
    );
    this.setRefreshCookie(res, rawRefreshToken);
    return { jwt: accessToken, student };
  }

  /**
   * POST /api/v1/portal/auth/refresh
   * Rotates the refresh token; issues a new JWT and a new cookie.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, rawRefreshToken } = await this.portalAuthService.refresh(
      req.cookies?.[PORTAL_REFRESH_COOKIE],
    );
    this.setRefreshCookie(res, rawRefreshToken);
    return { jwt: accessToken };
  }

  /**
   * POST /api/v1/portal/auth/logout
   * Revokes the current refresh token and clears the cookie.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.portalAuthService.logout(req.cookies?.[PORTAL_REFRESH_COOKIE]);
    res.clearCookie(PORTAL_REFRESH_COOKIE, { path: '/api/v1/portal/auth' });
    return { success: true };
  }

  /**
   * GET /api/v1/portal/auth/me
   * Returns the authenticated student's safe profile. Requires a valid STUDENT JWT.
   */
  @Roles(UserRole.STUDENT)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.portalAuthService.me(user.sub);
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(PORTAL_REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.configService.getOrThrow<string>('app.environment') === 'production',
      sameSite: 'strict',
      maxAge: this.configService.getOrThrow<number>('jwt.refreshExpiresInMs'),
      path: '/api/v1/portal/auth',
    });
  }
}
