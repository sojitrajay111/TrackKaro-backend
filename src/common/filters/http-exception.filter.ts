import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Normalizes every thrown error (HttpException, class-validator failures, unexpected
 * exceptions) into one response envelope so the frontend's RTK Query `error.data` always
 * has a predictable shape. Success responses are left as plain DTOs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const envelope: ErrorEnvelope = {
      success: false,
      error: {
        code: HttpStatus[status] ?? 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong. Please try again.',
      },
    };

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        envelope.error.message = body;
      } else if (typeof body === 'object' && body !== null) {
        const { message, ...rest } = body as { message?: unknown };
        if (typeof message === 'string') {
          envelope.error.message = message;
        } else if (Array.isArray(message)) {
          // class-validator returns an array of human-readable constraint failures
          envelope.error.message = 'Validation failed.';
          envelope.error.details = message;
        }
        if (Object.keys(rest).length > 0) {
          envelope.error.details = envelope.error.details ?? rest;
        }
      }
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json(envelope);
  }
}
