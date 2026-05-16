export interface TicketReferenceGenerator {
  generateSerial(): string;
  generatePublicReference(): string;
}