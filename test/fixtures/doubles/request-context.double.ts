import {
  RequestContextService,
  RequestContextValue,
} from '../../../src/shared/context/request-context.service';

type RequestContextDoubleValue = Omit<RequestContextValue, 'requestId'> & {
  requestId?: string;
};

export class RequestContextDouble {
  constructor(private readonly value: RequestContextDoubleValue) {}

  get(): RequestContextValue {
    return {
      ...this.value,
      requestId: this.value.requestId ?? this.value.correlationId,
    };
  }

  asService(): RequestContextService {
    return this as unknown as RequestContextService;
  }
}