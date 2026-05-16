import { Injectable } from '@nestjs/common';
import { RollbackHealthStatus } from '../health.types';

@Injectable()
export class RollbackHealthCheck {
  check(): RollbackHealthStatus {
    return {
      status: 'ok',
    };
  }
}