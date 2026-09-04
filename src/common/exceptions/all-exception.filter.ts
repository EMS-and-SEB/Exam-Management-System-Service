import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
import { ZodError } from 'zod';
import { ErrorCode } from './error-response.codes.js';
import { AppException } from './app-exceptions.js';

interface ResolvedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const resolved = this.resolve(exception);
    this.log(exception, resolved, req);

    res.status(resolved.status).json({
      error: { code: resolved.code, message: resolved.message, details: resolved.details },
    });
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof AppException) {
      const body = exception.getResponse() as { code: ErrorCode; message: string; details?: unknown };
      return { status: exception.getStatus(), code: body.code, message: body.message, details: body.details };
    }

    if (exception instanceof ZodError) {
      return {
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed.',
        details: exception.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: 409,
            code: ErrorCode.CONFLICT,
            message: 'A record with this value already exists.',
          };
        case 'P2025':
          return { status: 404, code: ErrorCode.NOT_FOUND, message: 'The requested record was not found.' };
        case 'P2003':
          return { status: 409, code: ErrorCode.CONFLICT, message: 'This action conflicts with related data.' };
        default:
          return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong. Please try again later.' };
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong. Please try again later.' };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : Array.isArray((response as any).message)
            ? 'Validation failed.'
            : ((response as any).message ?? exception.message);
      const details = Array.isArray((response as any)?.message)
        ? (response as any).message.map((m: string) => ({ message: m }))
        : undefined;
      return { status, code: this.codeForStatus(status), message, details };
    }

    return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Something went wrong. Please try again later.' };
  }

  private codeForStatus(status: number): ErrorCode {
    switch (status) {
      case 400: return ErrorCode.BAD_REQUEST;
      case 401: return ErrorCode.UNAUTHORIZED;
      case 403: return ErrorCode.FORBIDDEN;
      case 404: return ErrorCode.NOT_FOUND;
      case 409: return ErrorCode.CONFLICT;
      case 429: return ErrorCode.RATE_LIMITED;
      default: return ErrorCode.INTERNAL_ERROR;
    }
  }

  private log(exception: unknown, resolved: ResolvedError, req: Request) {
    const context = `${req.method} ${req.originalUrl}`;
    const line = `[${resolved.code}] ${resolved.message}`;

    if (resolved.status >= 500) {
      const devDetail =
        exception instanceof Prisma.PrismaClientKnownRequestError
          ? `Prisma[${exception.code}] ${JSON.stringify(exception.meta)}\n${exception.stack}`
          : exception instanceof Error
            ? exception.stack
            : String(exception);
      this.logger.error(`${context} - ${line}`, devDetail);
      return;
    }

    if (resolved.status === 401 || resolved.status === 403) {
      this.logger.warn(`${context} - ${line}`);
      return;
    }

    this.logger.debug(`${context} - ${line}`);
  }
}