/**
 * RH-187: Sentry beforeSend hook to scrub Authorization header from events.
 */

export function scrubAuthorizationHeader<T extends { request?: { headers?: Record<string, string> } }>(
  event: T,
): T {
  if (event.request?.headers) {
    for (const key of Object.keys(event.request.headers)) {
      if (key.toLowerCase() === 'authorization') {
        delete event.request.headers[key]
      }
    }
  }
  return event
}
