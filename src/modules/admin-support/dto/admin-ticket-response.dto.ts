import { TicketStatus } from '@prisma/client';

export class AdminTicketResponseDto {
  id!: string;
  ticketNumber!: string | null;
  ownerUserId!: string;
  eventId!: string;
  organizerId!: string | null;
  paymentIntentId!: string | null;
  status!: TicketStatus;
  issuedAt!: Date;
  usedAt!: Date | null;
  voidedAt!: Date | null;
  expiresAt!: Date | null;
}
