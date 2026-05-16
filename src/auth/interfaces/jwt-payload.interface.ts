import { AppRole } from '../../common/constants/roles';

export interface JwtPayload {
  sub: string;
  email: string;
  role: AppRole;
  sessionId: string;
  jti: string;
  type: 'access' | 'refresh';
}