import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { AppConfigService } from '../config/config.service';

const DEFAULT_LABEL_VALUE = 'n/a';

const COMMON_LABEL_NAMES = [
  'method',
  'route',
  'status_code',
  'provider',
  'event_type',
  'error_code',
  'retryable',
  'dead_letter',
  'result',
  'currency',
  'dependency',
] as const;

type CommonLabelName = (typeof COMMON_LABEL_NAMES)[number];

type CommonLabels = Record<CommonLabelName, string>;

const DURATION_BUCKETS_MS = [25, 50, 100, 250, 500, 750, 1000, 2500, 5000, 10000];

@Injectable()
export class TelemetryService {
  private readonly registry = new Registry();

  private readonly eventCounter: Counter<string>;

  private readonly customCounter: Counter<string>;

  private readonly customGauge: Gauge<string>;

  private readonly durationHistogram: Histogram<string>;

  constructor(private readonly configService: AppConfigService) {
    this.registry.setDefaultLabels({
      app_name: String(this.configService.get('APP_NAME')),
      environment: String(this.configService.get('NODE_ENV')),
    });

    this.eventCounter = new Counter({
      name: 'govibe_application_events_total',
      help: 'Count of application events recorded by the telemetry service.',
      registers: [this.registry],
      labelNames: ['event_name', ...COMMON_LABEL_NAMES],
    });

    this.customCounter = new Counter({
      name: 'govibe_application_counters_total',
      help: 'Counted application metrics recorded by the telemetry service.',
      registers: [this.registry],
      labelNames: ['metric_name', ...COMMON_LABEL_NAMES],
    });

    this.customGauge = new Gauge({
      name: 'govibe_application_gauges',
      help: 'Gauge-based application metrics recorded by the telemetry service.',
      registers: [this.registry],
      labelNames: ['metric_name', ...COMMON_LABEL_NAMES],
    });

    this.durationHistogram = new Histogram({
      name: 'govibe_application_duration_milliseconds',
      help: 'Application duration metrics recorded in milliseconds.',
      registers: [this.registry],
      labelNames: ['metric_name', ...COMMON_LABEL_NAMES],
      buckets: DURATION_BUCKETS_MS,
    });
  }

  incrementCounter(
    metricName: string,
    value = 1,
    attributes?: Record<string, unknown>,
  ): void {
    this.customCounter.inc(
      {
        metric_name: metricName,
        ...this.buildCommonLabels(attributes),
      },
      Number.isFinite(value) ? value : 0,
    );
  }

  setGauge(
    metricName: string,
    value: number,
    attributes?: Record<string, unknown>,
  ): void {
    this.customGauge.set(
      {
        metric_name: metricName,
        ...this.buildCommonLabels(attributes),
      },
      Number.isFinite(value) ? value : 0,
    );
  }

  record(eventName: string, payload?: Record<string, unknown>): void {
    const labels = this.buildCommonLabels(payload);

    this.eventCounter.inc({
      event_name: eventName,
      ...labels,
    });

    for (const [field, rawValue] of Object.entries(payload ?? {})) {
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        continue;
      }

      this.incrementCounter(`event.${eventName}.${field}`, rawValue, payload);
    }
  }

  recordTiming(
    metricName: string,
    durationMs: number,
    attributes?: Record<string, unknown>,
  ): void {
    this.durationHistogram.observe(
      {
        metric_name: metricName,
        ...this.buildCommonLabels(attributes),
      },
      Number.isFinite(durationMs) ? durationMs : 0,
    );
  }

  startSpan(
    spanName: string,
    attributes?: Record<string, unknown>,
  ): () => void {
    const startedAt = process.hrtime.bigint();

    return () => {
      const finishedAt = process.hrtime.bigint();
      const durationMs = Number(finishedAt - startedAt) / 1_000_000;

      this.recordTiming(`${spanName}.duration`, durationMs, attributes);
    };
  }

  async getMetricsSnapshot(): Promise<string> {
    return this.registry.metrics();
  }

  resetForTests(): void {
    this.registry.resetMetrics();
  }

  private buildCommonLabels(attributes?: Record<string, unknown>): CommonLabels {
    return {
      method: this.toLabelValue(attributes?.method),
      route: this.normalizeRoute(attributes?.route),
      status_code: this.toLabelValue(attributes?.statusCode),
      provider: this.toLabelValue(attributes?.provider),
      event_type: this.toLabelValue(attributes?.eventType),
      error_code: this.toLabelValue(attributes?.errorCode),
      retryable: this.toLabelValue(attributes?.retryable),
      dead_letter: this.toLabelValue(attributes?.deadLetter),
      result: this.toLabelValue(attributes?.result),
      currency: this.toLabelValue(attributes?.currency),
      dependency: this.toLabelValue(attributes?.dependency),
    };
  }

  private toLabelValue(value: unknown): string {
    if (value === undefined || value === null || value === '') {
      return DEFAULT_LABEL_VALUE;
    }

    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }

    const rendered = String(value).trim();

    if (!rendered) {
      return DEFAULT_LABEL_VALUE;
    }

    return rendered.slice(0, 120);
  }

  private normalizeRoute(value: unknown): string {
    const rendered = this.toLabelValue(value);

    if (rendered === DEFAULT_LABEL_VALUE) {
      return rendered;
    }

    const withoutQuery = rendered.split('?')[0] ?? rendered;
    const withLeadingSlash = withoutQuery.startsWith('/')
      ? withoutQuery
      : `/${withoutQuery}`;

    return withLeadingSlash
      .replace(
        /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
        '/:id',
      )
      .replace(/\/\d+(?=\/|$)/g, '/:id')
      .replace(/\/+/g, '/');
  }
}