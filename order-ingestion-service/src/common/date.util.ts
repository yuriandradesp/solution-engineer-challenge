import { NormalizationError } from './errors';

/**
 * Parse a Brazilian-style local timestamp ("dd/mm/yyyy HH:mm", e.g.
 * "20/06/2026 10:40") and return an ISO-8601 UTC string.
 *
 * The feed carries no timezone, so the customer's offset (e.g. "-03:00" for
 * America/Sao_Paulo) comes from per-customer config. NOTE: a fixed offset
 * ignores DST; production would resolve a real IANA zone with a tz library.
 */
export function isoFromBrazilianDate(input: string, utcOffset: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})/.exec(
    String(input).trim(),
  );
  if (!m) {
    throw new NormalizationError(`Unparseable BR date: "${input}"`);
  }
  const [, dd, mm, yyyy, HH, MM] = m;
  const date = new Date(`${yyyy}-${mm}-${dd}T${HH}:${MM}:00${utcOffset}`);
  if (Number.isNaN(date.getTime())) {
    throw new NormalizationError(`Invalid BR date: "${input}"`);
  }
  return date.toISOString();
}

/**
 * Parse a US-style 12h local timestamp ("MM-DD-YYYY hh:mm AM/PM", e.g.
 * "06-20-2026 08:50 AM") and return an ISO-8601 UTC string, using the
 * customer's configured offset (e.g. "-06:00" for America/Mexico_City).
 */
export function isoFromUsDate(input: string, utcOffset: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})[ T](\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(
    String(input).trim(),
  );
  if (!m) {
    throw new NormalizationError(`Unparseable US date: "${input}"`);
  }
  const [, mm, dd, yyyy, hhRaw, MM, meridiem] = m;
  let hh = parseInt(hhRaw, 10);
  const isPm = meridiem.toUpperCase() === 'PM';
  if (isPm && hh !== 12) hh += 12;
  if (!isPm && hh === 12) hh = 0;
  const hhStr = String(hh).padStart(2, '0');
  const date = new Date(`${yyyy}-${mm}-${dd}T${hhStr}:${MM}:00${utcOffset}`);
  if (Number.isNaN(date.getTime())) {
    throw new NormalizationError(`Invalid US date: "${input}"`);
  }
  return date.toISOString();
}

/**
 * Validate an already-ISO-ish timestamp (Customer A sends clean ISO-8601)
 * and re-emit it normalized to UTC.
 */
export function isoFromIso(input: string): string {
  const date = new Date(String(input));
  if (Number.isNaN(date.getTime())) {
    throw new NormalizationError(`Invalid ISO date: "${input}"`);
  }
  return date.toISOString();
}
