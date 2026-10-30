import { eventsDtoSchema } from '../../api/dto/events';
import type { HttpClient } from '../../api/httpClient';
import { logger as appLogger, type Logger } from '../../services/logger';
import { mapEvents } from './mapEvents';
import type { Event } from './types';

/**
 * EventRepository (Story 7.5, AD-1, api-contract «E18 (LIVE)»): the only
 * caller of E18. The HttpClient is the active session's, passed in by the
 * caller (never a singleton). Features read it through the `['events']`
 * query.
 */

/**
 * E18 path, with no params: paging is unverified (no cursor was ever seen),
 * so no paging parameter is guessed.
 */
export const EVENTS_PATH = '/v1/notification/standalone/event/';

/**
 * E18, one request: the shown events, newest first. Sent once: no AD-6
 * retry (`retry: false`); a failure shows the error with «Повторить».
 * Rejects with the HttpClient's `AppError` (`Parse` when the list is
 * missing). No read or unread mutation exists here.
 */
async function list(http: HttpClient, logger: Logger = appLogger): Promise<Event[]> {
  const { body } = await http.request({ path: EVENTS_PATH, schema: eventsDtoSchema, retry: false });
  return mapEvents(body.data.notificationStandalone.events, logger);
}

export const EventRepository = { list } as const;
