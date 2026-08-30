const DEFAULT_IMPORT_TIME_ZONE = "Asia/Tbilisi";
const TIME_ZONE_SUFFIX = /(?:z|[+-]\d{2}:?\d{2})$/i;
const LOCAL_ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/;

const timeZoneFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_IMPORT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

function invalidDate(): Date {
  return new Date(Number.NaN);
}

function isValidDateParts(parts: DateParts): boolean {
  if (
    parts.month < 1 ||
    parts.month > 12 ||
    parts.day < 1 ||
    parts.hour > 23 ||
    parts.minute > 59 ||
    parts.second > 59 ||
    parts.millisecond > 999
  ) {
    return false;
  }

  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );

  return (
    date.getUTCFullYear() === parts.year &&
    date.getUTCMonth() === parts.month - 1 &&
    date.getUTCDate() === parts.day
  );
}

function timeZoneOffsetAt(timestamp: number): number {
  const values = Object.fromEntries(
    timeZoneFormatter
      .formatToParts(new Date(timestamp))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );

  const withoutMilliseconds = timestamp - new Date(timestamp).getUTCMilliseconds();
  return (
    Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second) -
    withoutMilliseconds
  );
}

function dateFromTimeZoneParts(parts: DateParts): Date {
  const wallTimeAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let timestamp = wallTimeAsUtc - timeZoneOffsetAt(wallTimeAsUtc);

  // A second lookup also handles historical daylight-saving changes in the selected timezone.
  timestamp = wallTimeAsUtc - timeZoneOffsetAt(timestamp);
  return new Date(timestamp);
}

function parseLocalIsoDate(value: string): DateParts | undefined {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2})(?::(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?)?$/.exec(value);
  if (!match) return undefined;

  const parts: DateParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? "").slice(0, 3).padEnd(3, "0")),
  };

  return isValidDateParts(parts) ? parts : undefined;
}

function localPartsFromDate(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    millisecond: date.getMilliseconds(),
  };
}

/**
 * Parses an imported date as an instant. Values with `Z` or a numeric offset retain the instant
 * declared by the CSV. Bare values represent a wall-clock date/time in Asia/Tbilisi instead of the
 * browser's timezone.
 */
export function parseImportDate(raw: string): Date {
  const value = raw.trim();
  if (!value) return invalidDate();

  if (TIME_ZONE_SUFFIX.test(value)) return new Date(value);

  const isoParts = parseLocalIsoDate(value);
  if (isoParts) return dateFromTimeZoneParts(isoParts);
  if (LOCAL_ISO_DATE_PREFIX.test(value)) return invalidDate();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return parsed;

  // TODO: Let the import explicitly select a timezone for values that do not declare one.
  return dateFromTimeZoneParts(localPartsFromDate(parsed));
}
