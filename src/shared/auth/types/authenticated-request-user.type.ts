export type AuthenticatedRequestUser = {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  organizerId?: string | null;
  deviceId?: string | null;
};