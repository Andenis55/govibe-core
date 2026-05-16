import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable, finalize } from 'rxjs';
import { RequestContextService } from '../context/request-context.service';
import { TelemetryService } from './telemetry.service';

type HttpRequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
  baseUrl?: string;
  route?: { path?: string };
};

type HttpResponseLike = {
  statusCode?: number;
};

const SLOW_PATH_THRESHOLD_MS = 750;

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  constructor(
    private readonly telemetry: TelemetryService,
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
    const method = request?.method ?? 'UNKNOWN';
    const route = resolveRouteLabel(request);

    return next.handle().pipe(
      finalize(() => {
        const durationMs = Date.now() - startedAt;

        this.telemetry.recordTiming('http.request.duration', durationMs, {
          correlationId: requestContext?.correlationId,
          requestId: requestContext?.requestId,
          userId: requestContext?.userId,
          deviceId: requestContext?.deviceId,
          method,
          route,
          statusCode: response?.statusCode,
        });

        if (durationMs >= SLOW_PATH_THRESHOLD_MS) {
          this.telemetry.incrementCounter('http.request.slow', 1, {
            correlationId: requestContext?.correlationId,
            requestId: requestContext?.requestId,
            method,
            route,
            durationMs,
            statusCode: response?.statusCode,
          });
        }
      }),
    );
  }
}

function resolveRouteLabel(request: HttpRequestLike | undefined): string {
  const routePath = request?.route?.path;
  const baseUrl = request?.baseUrl ?? '';

  if (routePath) {
    return normalizeRoute(`${baseUrl}/${routePath}`);
  }

  return normalizeRoute(request?.originalUrl ?? request?.url ?? '/');
}

function normalizeRoute(raw: string): string {
  const withoutQuery = raw.split('?')[0] ?? raw;
  const withLeadingSlash = withoutQuery.startsWith('/')
    ? withoutQuery
    : `/${withoutQuery}`;

  return withLeadingSlash
    .replace(/\/+/g, '/')
    .replace(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
      '/:id',
    )
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}
