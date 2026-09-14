import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AppException } from '../exceptions/app-exceptions.js';

@Injectable()
export class StudentSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const sessionId = request.params.id ?? request.params.sessionId;
    const auth = request.headers.authorization;

    if (!auth?.startsWith('Bearer ')) throw AppException.unauthorized('Missing session token.');
    const token = auth.slice(7).trim();
    if (token !== sessionId) throw AppException.unauthorized('Invalid session token.');

    return true;
  }
}