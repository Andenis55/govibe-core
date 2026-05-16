import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Observable } from 'rxjs';
import { RequestContextService } from '../context/request-context.service';

type HttpRequestLike = {
  correlationId?: string;
  requestId?: string;
};

type HttpResponseLike = {
  setHeader(name: string, value: string): void;
};

@Injectable()
export class CorrelationInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const requestContext = this.requestContext.get();
    const correlationId = requestContext?.correlationId;
    const requestId = requestContext?.requestId;

    if (!correlationId || !requestId) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();

    if (request) {
      request.correlationId = correlationId;
      request.requestId = requestId;
    }

    if (response) {
      response.setHeader('x-correlation-id', correlationId);
      response.setHeader('x-request-id', requestId);
    }

    return next.handle();
  }
}
