import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class TicketReferenceGeneratorService {
  generateSerial(): string {
    return `GVS-${this.base32(randomBytes(10))}`;
  }

  generatePublicReference(): string {
    return `GV-${this.base32(randomBytes(6))}`;
  }

  private base32(buffer: Buffer): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = 0;
    let value = 0;
    let output = '';

    for (const byte of buffer) {
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        output += alphabet[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    if (bits > 0) {
      output += alphabet[(value << (5 - bits)) & 31];
    }

    return output;
  }
}