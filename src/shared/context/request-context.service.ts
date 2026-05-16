import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextValue {
  correlationId: string;
  requestId: string;
  userId?: string;
  deviceId?: string;
  organizerId?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextValue>();

  run<T>(context: RequestContextValue, callback: () => T): T {
    return this.storage.run(context, callback);
  }

  get(): RequestContextValue | undefined {
    return this.storage.getStore();
  }

  set(context: Partial<RequestContextValue>): void {
    const store = this.get();

    if (!store) {
      return;
    }

    Object.assign(store, context);
  }

  getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  getCorrelationId(): string | undefined {
    return this.get()?.correlationId;
  }

  getUserId(): string | undefined {
    return this.get()?.userId;
  }

  getDeviceId(): string | undefined {
    return this.get()?.deviceId;
  }
}
