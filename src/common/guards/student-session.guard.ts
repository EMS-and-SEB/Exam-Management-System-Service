import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../exceptions/app-exceptions.js';

@Injectable()
export class StudentSessionGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const sessionId = request.params.id ?? request.params.sessionId;
    const auth = request.headers.authorization;

    if (!auth?.startsWith('Bearer ')) {
      throw AppException.unauthorized('Missing session token.');
    }
    
    const token = auth.slice(7).trim();

    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      });

      if (payload.sub !== sessionId) {
        throw AppException.unauthorized('Invalid session token.');
      }

      return true;
    } catch {
      throw AppException.unauthorized('Invalid or expired session token.');
    }
  }
}