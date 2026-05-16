export type RequiredHealthDependencyResult = {
  status: 'ok' | 'fail';
  required: true;
  latencyMs: number;
};

export type OptionalHealthDependencyResult =
  | {
      status: 'ok' | 'fail';
      required: false;
      latencyMs: number;
    }
  | {
      status: 'skipped';
      required: false;
      latencyMs: 0;
    };

export type HealthBuildMetadata = {
  version: string;
  commit: string;
  environment: string;
};

export type RollbackHealthStatus = {
  status: 'ok';
};

export type LivenessHealthResponse = {
  status: 'ok';
  service: string;
  check: 'liveness';
  timestamp: string;
  uptimeSeconds: number;
};

export type ReadinessHealthResponse = {
  status: 'ready' | 'degraded' | 'not_ready';
  service: string;
  check: 'readiness';
  timestamp: string;
  dependencies: {
    database: RequiredHealthDependencyResult;
    redis?: OptionalHealthDependencyResult;
  };
  rollback: RollbackHealthStatus;
  build: HealthBuildMetadata;
};

export type SummaryHealthResponse = {
  status: 'ok';
  service: string;
  check: 'summary';
  timestamp: string;
  uptimeSeconds: number;
  build: HealthBuildMetadata;
};