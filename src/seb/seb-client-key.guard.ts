import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { AppException } from '../common/exceptions/app-exceptions.js';

@Injectable()
export class SebClientKeyGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey: string | undefined = request.headers['x-seb-client-key'];
    const expectedKey = this.configService.getOrThrow<string>('seb.clientKey');

    if (!providedKey || !this.matches(providedKey, expectedKey)) {
      throw AppException.unauthorized('Invalid SEB client key.');
    }
    return true;
  }

  private matches(provided: string, expected: string): boolean {
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}