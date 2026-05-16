export enum AppPermission {
  AUTHENTICATED = 'auth.authenticated',

  CUSTOMER_ACCESS = 'customer.access',
  ORGANIZER_ACCESS = 'organizer.access',
  GATE_STAFF_ACCESS = 'gate_staff.access',
  ADMIN_ACCESS = 'admin.access',
  ADMIN_SUPPORT_READ_USERS = 'admin:support:read_users',
  ADMIN_SUPPORT_READ_ORGANIZERS = 'admin:support:read_organizers',
  ADMIN_SUPPORT_READ_EVENTS = 'admin:support:read_events',
  ADMIN_SUPPORT_READ_PAYMENTS = 'admin:support:read_payments',
  ADMIN_SUPPORT_READ_TICKETS = 'admin:support:read_tickets',
  ADMIN_SUPPORT_READ_ADMISSIONS = 'admin:support:read_admissions',
  ADMIN_SUPPORT_READ_AUDIT_LOGS = 'admin:support:read_audit_logs',

  SESSION_REVOKE_OWN = 'session:revoke:own',
  SESSION_REVOKE_ANY = 'session:revoke:any',
  USER_READ_SELF = 'user:read:self',

  ORGANIZER_CREATE = 'organizer:create',
  ORGANIZER_READ_OWN = 'organizer:read:own',
  ORGANIZER_UPDATE_OWN = 'organizer:update:own',
  ORGANIZER_SUBMIT_OWN = 'organizer:submit:own',

  EVENT_CREATE_OWN = 'event:create:own',
  EVENT_READ_OWN = 'event:read:own',
  EVENT_UPDATE_OWN = 'event:update:own',
  EVENT_PUBLISH_OWN = 'event:publish:own',
  EVENT_CANCEL_OWN = 'event:cancel:own',

  TABLE_MANAGE_ORGANIZER = 'table:manage:organizer',
  TABLE_READ_ORGANIZER = 'table:read:organizer',
  TABLE_READ_PUBLIC = 'table:read:public',
  TABLE_HOLD_OWN = 'table:hold:own',
  TABLE_READ_OWN_RESERVATION = 'table:read:own_reservation',

  PAYMENT_INITIATE_OWN = 'payment:initiate:own',
  PAYMENT_READ_OWN = 'payment:read:own',
  TICKET_READ_OWN = 'ticket:read:own',
  ADMISSION_SCAN_EVENT = 'admission:scan:event',
}
