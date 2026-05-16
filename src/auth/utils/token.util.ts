import { randomBytes } from 'node:crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
} from '../auth.constants';

export { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS };

export function createOpaqueRefreshToken(size = 48): string {
  return randomBytes(size).toString('base64url');
}