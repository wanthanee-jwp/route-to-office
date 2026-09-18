import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';

// Global filter: every response — success or failure — carries a request ID
// and a display-ready `message`. Google's own error text is logged server-side
// and never returned to the client (requirement.md §7).

interface ErrorBody {
  statusCode: number;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId =
      (request.headers['x-request-id'] as string | undefined) ?? randomUUID();

    const { status, message } = this.resolve(exception);

    const body: ErrorBody = {
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (status >= 500) {
      this.logger.error(
        { requestId, path: request.url, exception: this.serialize(exception) },
        'Unhandled server error',
      );
    } else if (status !== HttpStatus.TOO_MANY_REQUESTS) {
      // 429 is noisy and expected; log at debug only.
      this.logger.warn(
        { requestId, path: request.url, status, message },
        'Client-facing error',
      );
    }

    if (exception instanceof ThrottlerException) {
      response.setHeader('Retry-After', '60');
    }
    response.setHeader('X-Request-Id', requestId);
    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      const message =
        typeof res === 'string'
          ? res
          : (res as { message?: string | string[] }).message
            ? Array.isArray((res as { message: string[] }).message)
              ? (res as { message: string[] }).message.join(', ')
              : ((res as { message: string }).message as string)
            : exception.message;
      return { status, message };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'An unexpected error occurred. Please try again shortly.',
    };
  }

  private serialize(exception: unknown): unknown {
    if (exception instanceof Error) {
      return { name: exception.name, message: exception.message, stack: exception.stack };
    }
    return exception;
  }
}
