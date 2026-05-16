import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';

@Injectable()
@WebSocketGateway({ namespace: '/organizer-dashboard' })
export class OrganizerDashboardGateway {
  getOrganizerRoom(organizerId: string): string {
    return `organizer:${organizerId}`;
  }

  publishRevenueCounter(_organizerId: string, _payload: unknown): void {
    return;
  }

  publishAttendanceSummary(_organizerId: string, _payload: unknown): void {
    return;
  }

  publishOperationalSignal(_organizerId: string, _payload: unknown): void {
    return;
  }

  publish(_event: string, _payload: unknown): void {
    return;
  }
}
