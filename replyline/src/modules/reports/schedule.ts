import { DateTime } from "luxon";
import type { OrgSettings } from "@/lib/db/schema";

/** The next time (after `after`) the weekly report is due: weekday 1=Mon..7=Sun, at `hour` local. */
export function nextReportTime(after: Date, report: OrgSettings["report"], tz: string): Date {
  let dt = DateTime.fromJSDate(after, { zone: tz }).set({ hour: report.hour, minute: 0, second: 0, millisecond: 0 });
  const diff = (report.weekday - dt.weekday + 7) % 7;
  dt = dt.plus({ days: diff });
  if (dt.toJSDate() <= after) dt = dt.plus({ weeks: 1 });
  return dt.toJSDate();
}
