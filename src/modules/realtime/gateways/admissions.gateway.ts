import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';

@Injectable()
@WebSocketGateway({ namespace: '/admissions' })
export class AdmissionsGateway {
  private getEventRoom(eventId: string): string {
    return `event:${eventId}`;
  }

  private getGateRoom(gateId: string): string {
    return `gate:${gateId}`;
  }

  publishEntryExitUpdate(_eventId: string, _payload: unknown): void {
    return;
  }

  publishOccupancyDelta(_eventId: string, _payload: unknown): void {
    return;
  }

  publishGateScanEvent(_gateId: string, _payload: unknown): void {
    return;
  }

  describeRooms(eventId: string, gateId: string): string[] {
    return [this.getEventRoom(eventId), this.getGateRoom(gateId)];
  }

  publish(_event: string, _payload: unknown): void {
    return;
  }
}
