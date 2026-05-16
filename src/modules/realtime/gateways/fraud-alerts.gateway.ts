import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';

@Injectable()
@WebSocketGateway({ namespace: '/fraud-alerts' })
export class FraudAlertsGateway {
  getFraudRoom(eventId: string): string {
    return `fraud:${eventId}`;
  }

  publishSuspiciousScanActivity(_eventId: string, _payload: unknown): void {
    return;
  }

  publishDuplicateAttempt(_eventId: string, _payload: unknown): void {
    return;
  }

  publishRiskAlert(_eventId: string, _payload: unknown): void {
    return;
  }

  publish(_event: string, _payload: unknown): void {
    return;
  }
}
