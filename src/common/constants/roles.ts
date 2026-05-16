export const AppRole = {
  CUSTOMER: 'CUSTOMER',
  ORGANIZER: 'ORGANIZER',
  GATE_STAFF: 'GATE_STAFF',
  ADMIN: 'ADMIN',
} as const;

export type AppRole = (typeof AppRole)[keyof typeof AppRole];