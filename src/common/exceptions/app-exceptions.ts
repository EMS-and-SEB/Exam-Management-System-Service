import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-response.codes.js';

export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    status: number,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }

  static badRequest(message: string, details?: unknown) {
    return new AppException(ErrorCode.BAD_REQUEST, message, HttpStatus.BAD_REQUEST, details);
  }
  static unauthorized(message = 'Authentication required.') {
    return new AppException(ErrorCode.UNAUTHORIZED, message, HttpStatus.UNAUTHORIZED);
  }
  static forbidden(message = 'You do not have permission to perform this action.') {
    return new AppException(ErrorCode.FORBIDDEN, message, HttpStatus.FORBIDDEN);
  }
  static notFound(message: string) {
    return new AppException(ErrorCode.NOT_FOUND, message, HttpStatus.NOT_FOUND);
  }
  static conflict(message: string, details?: unknown) {
    return new AppException(ErrorCode.CONFLICT, message, HttpStatus.CONFLICT, details);
  }

  static internal(message = 'Something went wrong. Please try again later.') {
    return new AppException(ErrorCode.INTERNAL_ERROR, message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}