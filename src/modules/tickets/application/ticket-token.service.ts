import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class TicketTokenService {
  generateTicketNumber(): string {
    return `GV-${randomBytes(10).toString('hex').toUpperCase()}`;
  }

  generateAdmissionToken(): { token: string; hash: string; version: number } {
    const token = randomBytes(32).toString('base64url');

    return {
      token,
      hash: this.hashToken(token),
      version: 1,
    };
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}