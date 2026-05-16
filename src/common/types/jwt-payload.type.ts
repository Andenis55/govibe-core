import { AppRole } from '../constants/roles';

export type JwtPayload = {
  sub: string;
  email: string;
  role: AppRole;
  sessionId: string;
  jti: string;
  type: 'access' | 'refresh';
};