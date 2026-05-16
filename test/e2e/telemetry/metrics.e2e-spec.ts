import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { TelemetryModule } from '../../../src/shared/telemetry/telemetry.module';
import { TelemetryService } from '../../../src/shared/telemetry/telemetry.service';
import { createTestApp } from '../../setup/test-app.factory';

describe('metrics endpoint e2e', () => {
  @Module({
    imports: [TelemetryModule],
  })
  class MetricsTestModule {}

  it('exposes Prometheus metrics with the recorded application signals', async () => {
    const app = await createTestApp(
      Test.createTestingModule({
        imports: [MetricsTestModule],
      }),
    );

    const telemetry = app.get(TelemetryService);

    telemetry.incrementCounter('custom.metric', 5, {
      provider: 'paystack',
      correlationId: 'should-not-be-exported',
    });
    telemetry.recordTiming('http.request.duration', 87, {
      method: 'GET',
      route: '/health/ready',
      statusCode: 200,
    });

    await request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect((response) => {
        expect(response.text).toContain('govibe_application_counters_total');
        expect(response.text).toContain('metric_name="custom.metric"');
        expect(response.text).toContain('provider="paystack"');
        expect(response.text).toContain('govibe_application_duration_milliseconds_bucket');
        expect(response.text).toContain('route="/health/ready"');
        expect(response.text).not.toContain('should-not-be-exported');
      });

    await app.close();
  });
});