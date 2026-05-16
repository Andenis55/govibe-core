import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TicketReferenceGenerator } from '../../domain/services/ticket-reference-generator.interface';

@Injectable()
export class RandomTicketReferenceGeneratorService
  implements TicketReferenceGenerator
{
  generateSerial(): string {
    return `TKT-${randomBytes(10).toString('hex').toUpperCase()}`;
  }

  generatePublicReference(): string {
    return `GV-${randomBytes(6).toString('hex').toUpperCase()}`;
  }
}