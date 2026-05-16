import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, finalize } from 'rxjs';
import { RequestContextService } from '../context/request-context.service';
import { AppLoggerService } from './logger.service';

type HttpRequestLike = {
  method?: string;
  url?: string;
  route?: { path?: string };
};

type HttpResponseLike = {
  statusCode?: number;
};

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: AppLoggerService,
    private readonly requestContext: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const startedAt = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();
    const requestContext = this.requestContext.get();
    const correlationId = requestContext?.correlationId ?? 'n/a';
    const requestId = requestContext?.requestId ?? 'n/a';
    const method = request?.method ?? 'UNKNOWN';
    const route = request?.route?.path ?? request?.url ?? '/';
    const userId = requestContext?.userId ?? 'anonymous';
    const deviceId = requestContext?.deviceId ?? 'n/a';

    this.logger.log(
      `request_start method=${method} route=${route} request_id=${requestId} user_id=${userId} device_id=${deviceId}`,
      'HTTP',
    );

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Date.now() - startedAt;
        const statusCode = response?.statusCode ?? 0;

        this.logger.log(
          `request_end method=${method} route=${route} status=${statusCode} latency_ms=${durationMs} request_id=${requestId} correlation_id=${correlationId} user_id=${userId} device_id=${deviceId}`,
          'HTTP',
        );
      }),
    );
  }
}
