import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestContextService } from '../context/request-context.service';
import { mapErrorToHttp } from './http-error-mapper';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const mapped =
      exception instanceof HttpException ? exception : mapErrorToHttp(exception);

    const status = mapped.getStatus();
    const payload = mapped.getResponse();
    const contextValue = this.requestContext.get();

    response.status(status).json({
      path: request.url,
      method: request.method,
      requestId: contextValue?.requestId,
      correlationId: contextValue?.correlationId,
      error: typeof payload === 'string' ? payload : payload,
    });
  }
}