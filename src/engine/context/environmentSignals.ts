/**
 * Environment signal (C4, 1.6.0).
 *
 * Trivial but useful: current time / weekday / timezone. Lets the engine
 * ground time-sensitive prompts ("send this email tomorrow" / "what's
 * happening this week") without the user having to type the date.
 *
 * Pure-JS, no I/O, never fails. Always returns a populated signal.
 */

export interface EnvironmentSignal {
  /** ISO 8601 timestamp (UTC). e.g. '2026-04-28T18:33:00.000Z'. */
  nowIso: string;
  /** 'Mon' | 'Tue' | ... | 'Sun'. Locale-independent (English abbreviations). */
  weekday: string;
  /** IANA timezone (e.g. 'America/New_York', 'Europe/London') from the host. */
  timezone: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function collectEnvironmentSignal(): EnvironmentSignal {
  const now = new Date();
  let timezone: string;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    timezone = 'UTC';
  }
  return {
    nowIso: now.toISOString(),
    weekday: WEEKDAYS[now.getUTCDay()],
    timezone,
  };
}
