import { DateTime } from "luxon";
import type { BusinessHours } from "./db/schema";

/*
 * All scheduling arithmetic happens here, in the business's own timezone, via
 * Luxon. Calendar units (days) keep the wall-clock time across daylight-saving
 * changes; minute/hour units are exact elapsed time.
 */

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Weekday = (typeof WEEKDAYS)[number];

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  mon: { open: "08:00", close: "18:00" },
  tue: { open: "08:00", close: "18:00" },
  wed: { open: "08:00", close: "18:00" },
  thu: { open: "08:00", close: "18:00" },
  fri: { open: "08:00", close: "18:00" },
  sat: null,
  sun: null,
};

const weekdayKey = (dt: DateTime): Weekday => WEEKDAYS[dt.weekday - 1];

function at(dt: DateTime, hhmm: string): DateTime {
  const [h, m] = hhmm.split(":").map(Number);
  return dt.set({ hour: h, minute: m, second: 0, millisecond: 0 });
}

function hasAnyWorkingDay(hours: BusinessHours) {
  return WEEKDAYS.some((d) => hours[d]);
}

export function isWithinBusinessHours(when: Date, hours: BusinessHours, tz: string): boolean {
  const dt = DateTime.fromJSDate(when, { zone: tz });
  const day = hours[weekdayKey(dt)];
  if (!day) return false;
  return dt >= at(dt, day.open) && dt < at(dt, day.close);
}

/** `when` itself if the business is open, otherwise the next opening time. */
export function nextBusinessMoment(when: Date, hours: BusinessHours, tz: string): Date {
  if (!hasAnyWorkingDay(hours)) return when;
  let dt = DateTime.fromJSDate(when, { zone: tz });
  for (let i = 0; i < 8; i++) {
    const day = hours[weekdayKey(dt)];
    if (day) {
      const open = at(dt, day.open);
      const close = at(dt, day.close);
      if (dt < open) return open.toJSDate();
      if (dt < close) return dt.toJSDate();
    }
    dt = dt.plus({ days: 1 }).startOf("day");
  }
  return when;
}

/** Move forward `n` working days, keeping the local time of day, then snap into opening hours. */
export function addBusinessDays(from: Date, n: number, hours: BusinessHours, tz: string): Date {
  if (!hasAnyWorkingDay(hours)) return DateTime.fromJSDate(from, { zone: tz }).plus({ days: n }).toJSDate();
  let dt = DateTime.fromJSDate(from, { zone: tz });
  let remaining = n;
  while (remaining > 0) {
    dt = dt.plus({ days: 1 });
    if (hours[weekdayKey(dt)]) remaining--;
  }
  return nextBusinessMoment(dt.toJSDate(), hours, tz);
}

export type Delay = { amount: number; unit: "minutes" | "hours" | "business_days" };

export function applyDelay(from: Date, delay: Delay, hours: BusinessHours, tz: string, businessHoursOnly: boolean): Date {
  let due: Date;
  if (delay.unit === "business_days") due = addBusinessDays(from, delay.amount, hours, tz);
  else due = new Date(from.getTime() + delay.amount * (delay.unit === "hours" ? 3_600_000 : 60_000));
  return businessHoursOnly ? nextBusinessMoment(due, hours, tz) : due;
}

/**
 * When to send a reminder `offsetMinutes` before `startsAt`. Whole-day offsets
 * are calendar days ("24 hours before" a 10:00 appointment is 10:00 the day
 * before, even across a clock change); anything else is exact elapsed time.
 */
export function reminderTime(startsAt: Date, offsetMinutes: number, tz: string): Date {
  const start = DateTime.fromJSDate(startsAt, { zone: tz });
  if (offsetMinutes % 1440 === 0) return start.minus({ days: offsetMinutes / 1440 }).toJSDate();
  return start.minus({ minutes: offsetMinutes }).toJSDate();
}

/**
 * Parse a local date and time typed by a user in timezone `tz`.
 * Rejects times that do not exist (the hour skipped when clocks go forward).
 */
export function parseLocalDateTime(date: string, time: string, tz: string): Date {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  if (!dt.isValid) throw new Error("Invalid date or time");
  if (dt.toFormat("yyyy-MM-dd'T'HH:mm") !== `${date}T${time.slice(0, 5)}`) {
    throw new Error("That time does not exist in this timezone (the clocks change then). Choose another time.");
  }
  return dt.toJSDate();
}

export function formatInZone(when: Date, tz: string, fmt: "date" | "time" | "datetime" | "short" = "datetime"): string {
  const dt = DateTime.fromJSDate(when, { zone: tz }).setLocale("en-GB");
  switch (fmt) {
    case "date":
      return dt.toFormat("cccc d LLLL yyyy");
    case "time":
      return dt.toFormat("HH:mm");
    case "short":
      return dt.toFormat("d LLL, HH:mm");
    default:
      return dt.toFormat("ccc d LLL yyyy, HH:mm");
  }
}

/** Monday 00:00 local of the week containing `when`. */
export function startOfLocalWeek(when: Date, tz: string): Date {
  return DateTime.fromJSDate(when, { zone: tz }).startOf("week").toJSDate();
}

export function usagePeriod(when = new Date()): string {
  return when.toISOString().slice(0, 7);
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function relativeDays(from: Date, to = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
