import { TicketResponseDto } from './ticket-response.dto';

export class IssuedTicketResponseDto {
  ticket!: TicketResponseDto;
  qrPayload!: {
    ticketId: string;
    token: string;
  } | null;
}