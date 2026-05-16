import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  RequestContextService,
  type RequestContextValue,
} from './request-context.service';

type HeaderRecord = Record<string, string | string[] | undefined>;

type RequestLike = {
  headers: HeaderRecord;
  ip?: string;
  socket?: { remoteAddress?: string };
  user?: {
    id?: string;
    userId?: string;
    deviceId?: string;
    organizerId?: string;
  } | Record<string, unknown>;
};

type ResponseLike = {
  setHeader(name: string, value: string): void;
};

type NextFunction = () => void;

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

function getHeaderValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  return Array.isArray(value) ? value[0] : undefined;
}

function isValidCorrelationId(value: string | undefined): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly requestContext: RequestContextService) {}

  use(request: RequestLike, response: ResponseLike, next: NextFunction): void {
    const inboundCorrelationId = getHeaderValue(request.headers['x-correlation-id']);
    const userAgent = getHeaderValue(request.headers['user-agent']);
    const deviceIdHeader = getHeaderValue(request.headers['x-device-id']);
    const organizerIdHeader = getHeaderValue(request.headers['x-organizer-id']);
    const user = request.user as
      | {
          id?: string;
          userId?: string;
          deviceId?: string;
          organizerId?: string;
        }
      | undefined;
    const requestId = randomUUID();

    const correlationId = isValidCorrelationId(inboundCorrelationId)
      ? inboundCorrelationId
      : randomUUID();

    const context: RequestContextValue = {
      correlationId,
      requestId,
      userId: user?.id ?? user?.userId,
      deviceId: user?.deviceId ?? deviceIdHeader,
      organizerId: user?.organizerId ?? organizerIdHeader,
      ipAddress: request.ip ?? request.socket?.remoteAddress,
      userAgent,
    };

    response.setHeader('x-correlation-id', correlationId);
    response.setHeader('x-request-id', requestId);
    this.requestContext.run(context, next);
  }
}
