export {
  PrismaEventRepository as EventsRepository,
} from '../modules/events/infrastructure/repositories/prisma-event.repository';
export { EVENT_REPOSITORY } from '../modules/events/events.tokens';
export type { EventRepository, OwnedEventRecord } from '../modules/events/domain/repositories/event.repository.interface';