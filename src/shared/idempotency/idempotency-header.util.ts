import { BadRequestException } from '@nestjs/common';

export function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('Missing or invalid Idempotency-Key header.');
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > 128) {
    throw new BadRequestException('Missing or invalid Idempotency-Key header.');
  }

  return normalized;
}