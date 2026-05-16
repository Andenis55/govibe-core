import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';

@Injectable()
@WebSocketGateway({ namespace: '/events' })
export class EventsGateway {
  getEventRoom(eventId: string): string {
    return `event:${eventId}`;
  }

  publishEventStatusChange(_eventId: string, _payload: unknown): void {
    return;
  }

  publishTicketSaleMilestone(_eventId: string, _payload: unknown): void {
    return;
  }

  publishPublicationUpdate(_eventId: string, _payload: unknown): void {
    return;
  }

  publish(_event: string, _payload: unknown): void {
    return;
  }
}
