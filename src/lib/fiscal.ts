/**
 * Fiscal calendar math. CPG rarely uses calendar months — a 4-4-5 year is
 * 52 weeks in twelve periods of 4, 4 and 5 weeks. Never do native Date month
 * arithmetic on these; a "month" here is not a month.
 *
 * Pure. No I/O. Unit tested in fiscal.test.ts.
 */

import type { FiscalWeek, ISODate } from '../data/types'

const DAY_MS = 86_400_000

export function toISO(d: Date): ISODate {
  return d.toISOString().slice(0, 10)
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(s: ISODate, n: number): ISODate {
  return toISO(new Date(parseISO(s).getTime() + n * DAY_MS))
}

export function addWeeks(s: ISODate, n: number): ISODate {
  return addDays(s, n * 7)
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS)
}

export function diffWeeks(a: ISODate, b: ISODate): number {
  return Math.round(diffDays(a, b) / 7)
}

/** Monday-anchored week start, which is what retail weeks use here. */
export function weekStartOf(s: ISODate): ISODate {
  const d = parseISO(s)
  const dow = (d.getUTCDay() + 6) % 7 // Mon = 0
  return addDays(s, -dow)
}

export function isBetween(d: ISODate, start: ISODate, end: ISODate): boolean {
  return d >= start && d <= end
}

export function rangesOverlap(
  aStart: ISODate,
  aEnd: ISODate,
  bStart: ISODate,
  bEnd: ISODate,
): boolean {
  return aStart <= bEnd && bStart <= aEnd
}

const PATTERNS: Record<string, number[]> = {
  '4-4-5': [4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5],
  '4-5-4': [4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5, 4],
  '13-period': [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
}

/**
 * Build a fiscal calendar of `weeks` weeks starting at `yearStart`.
 * Period lengths cycle through the pattern; the year rolls when the pattern
 * is exhausted, which is exactly how a 52-week retail year behaves.
 */
export function buildFiscalCalendar(
  yearStart: ISODate,
  weeks: number,
  pattern: '4-4-5' | '4-5-4' | '13-period' = '4-4-5',
  startFiscalYear = 2025,
): FiscalWeek[] {
  const lengths = PATTERNS[pattern]
  const out: FiscalWeek[] = []

  let cursor = weekStartOf(yearStart)
  let fy = startFiscalYear
  let periodIdx = 0
  let weekInPeriod = 1
  let weekInYear = 1

  for (let i = 0; i < weeks; i++) {
    out.push({
      weekStart: cursor,
      fiscalYear: fy,
      period: periodIdx + 1,
      weekOfPeriod: weekInPeriod,
      weekOfYear: weekInYear,
      label: `FY${String(fy).slice(2)} P${String(periodIdx + 1).padStart(2, '0')} W${weekInPeriod}`,
    })

    cursor = addWeeks(cursor, 1)
    weekInYear++
    weekInPeriod++

    if (weekInPeriod > lengths[periodIdx]) {
      weekInPeriod = 1
      periodIdx++
      if (periodIdx >= lengths.length) {
        periodIdx = 0
        fy++
        weekInYear = 1
      }
    }
  }

  return out
}

export function fiscalWeekFor(
  calendar: FiscalWeek[],
  date: ISODate,
): FiscalWeek | undefined {
  const ws = weekStartOf(date)
  return calendar.find((w) => w.weekStart === ws)
}

/** 'FY26 P03' — the grain most trade reporting rolls up to. */
export function periodKey(w: FiscalWeek): string {
  return `FY${String(w.fiscalYear).slice(2)} P${String(w.period).padStart(2, '0')}`
}

export function quarterKey(w: FiscalWeek): string {
  return `FY${String(w.fiscalYear).slice(2)} Q${Math.ceil(w.period / 3)}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatShortDate(s: ISODate): string {
  const d = parseISO(s)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export function formatDate(s: ISODate): string {
  const d = parseISO(s)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

/** Age in days from a date to "today" as the demo defines it. */
export function ageInDays(from: ISODate, today: ISODate): number {
  return Math.max(0, diffDays(from, today))
}

export type AgeBucket = '0-30' | '31-60' | '61-90' | '91-120' | '120+'

export const AGE_BUCKETS: AgeBucket[] = ['0-30', '31-60', '61-90', '91-120', '120+']

export function ageBucket(days: number): AgeBucket {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  if (days <= 90) return '61-90'
  if (days <= 120) return '91-120'
  return '120+'
}
