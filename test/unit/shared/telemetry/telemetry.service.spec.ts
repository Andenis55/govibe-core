import { TelemetryService } from '../../../../src/shared/telemetry/telemetry.service';

describe('TelemetryService', () => {
  let service: TelemetryService;

  beforeEach(() => {
    service = new TelemetryService({
      get: jest.fn((key: string) => {
        if (key === 'APP_NAME') {
          return 'govibe-core';
        }

        if (key === 'NODE_ENV') {
          return 'test';
        }

        return undefined;
      }),
    } as never);
  });

  it('exports counters, gauges, durations, and drops high-cardinality labels', async () => {
    service.incrementCounter('http.request.slow', 2, {
      method: 'POST',
      route: '/payments/initiate',
      statusCode: 504,
      correlationId: 'corr-should-not-export',
    });
    service.setGauge('dependency.health', 1, {
      dependency: 'redis',
    });
    service.recordTiming('http.request.duration', 123, {
      method: 'GET',
      route: '/health/ready',
      statusCode: 200,
      requestId: 'req-should-not-export',
    });
    service.record('outbox.processor.dispatch_failed', {
      eventType: 'PaymentInitiated',
      errorCode: 'PAYSTACK_TIMEOUT',
      retryable: true,
      deadLetter: false,
      retryCount: 3,
      eventId: '11111111-1111-4111-8111-111111111111',
    });

    const stopSpan = service.startSpan('verify-payment', {
      provider: 'paystack',
    });
    stopSpan();

    const metrics = await service.getMetricsSnapshot();

    expect(metrics).toContain('govibe_application_counters_total');
    expect(metrics).toContain('metric_name="http.request.slow"');
    expect(metrics).toContain('route="/payments/initiate"');
    expect(metrics).toContain('status_code="504"');
    expect(metrics).toContain('govibe_application_gauges');
    expect(metrics).toContain('dependency="redis"');
    expect(metrics).toContain('govibe_application_duration_milliseconds_bucket');
    expect(metrics).toContain('metric_name="http.request.duration"');
    expect(metrics).toContain('govibe_application_events_total');
    expect(metrics).toContain('event_name="outbox.processor.dispatch_failed"');
    expect(metrics).toContain('event_type="PaymentInitiated"');
    expect(metrics).toContain('error_code="PAYSTACK_TIMEOUT"');
    expect(metrics).toContain('metric_name="event.outbox.processor.dispatch_failed.retryCount"');
    expect(metrics).toContain('metric_name="verify-payment.duration"');
    expect(metrics).toContain('app_name="govibe-core"');
    expect(metrics).toContain('environment="test"');
    expect(metrics).not.toContain('corr-should-not-export');
    expect(metrics).not.toContain('req-should-not-export');
    expect(metrics).not.toContain('11111111-1111-4111-8111-111111111111');
  });
});