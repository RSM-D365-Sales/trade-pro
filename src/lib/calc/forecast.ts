/**
 * Driver-based sales forecasting.
 *
 * The forecast is never typed in as a number. It is BUILT from three drivers
 * that a demand planner can defend in a meeting:
 *
 *     units = storesSelling × baseVelocityWeekly × seasonality × weeksInPeriod
 *
 * That decomposition is the whole point. When a forecast is wrong, "the number
 * is too high" is unactionable; "we assumed 189 stores and we only got 164" is
 * a conversation with the buyer. Every cell in the grid can be traced to the
 * driver that produced it.
 *
 * `weeksInPeriod` is load-bearing and is why this uses the FISCAL calendar
 * rather than calendar months: in a 4-4-5 year a five-week period sells ~25%
 * more than a four-week one for identical velocity. Forecasting in calendar
 * months quietly smears that across the year and every period looks off.
 *
 * The hierarchy is deliberately not baked in. Drivers live at leaf level and
 * roll up through whatever grouping the planner chooses — customer → product
 * group, brand → customer, channel → customer → SKU. See `buildForecastTree`.
 */

import type { FiscalWeek, ISODate } from '../../data/types'
import { addDays } from '../fiscal'
import { n4, safeDiv } from './money'

// ── Periods ────────────────────────────────────────────────────────────────

export interface ForecastPeriod {
  key: string
  /** 'P08' */
  label: string
  /** 'Aug 2026' — the calendar month the period mostly sits in. */
  sublabel: string
  fiscalYear: number
  period: number
  /** 4 or 5 in a 4-4-5 year. The reason this is fiscal, not monthly. */
  weeks: number
  start: ISODate
  end: ISODate
  isPast: boolean
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function buildForecastPeriods(
  calendar: FiscalWeek[],
  today: ISODate,
): ForecastPeriod[] {
  const byKey = new Map<string, FiscalWeek[]>()
  for (const w of calendar) {
    const key = `FY${String(w.fiscalYear).slice(2)} P${String(w.period).padStart(2, '0')}`
    const arr = byKey.get(key)
    if (arr) arr.push(w)
    else byKey.set(key, [w])
  }

  return [...byKey.entries()]
    .map(([key, weeks]) => {
      const start = weeks[0].weekStart
      const end = addDays(weeks[weeks.length - 1].weekStart, 6)
      // Label with the month holding the midpoint, so a period straddling two
      // months reads as the one it mostly belongs to.
      const mid = weeks[Math.floor(weeks.length / 2)].weekStart
      const midDate = new Date(`${mid}T00:00:00Z`)
      return {
        key,
        label: `P${String(weeks[0].period).padStart(2, '0')}`,
        sublabel: `${MONTHS[midDate.getUTCMonth()]} ${midDate.getUTCFullYear()}`,
        fiscalYear: weeks[0].fiscalYear,
        period: weeks[0].period,
        weeks: weeks.length,
        start,
        end,
        isPast: end < today,
      }
    })
    // A calendar that does not divide evenly into whole fiscal years leaves a
    // stub at the end (157 weeks = three years plus one). A one-week period
    // is not a planning period — it would render as a column nobody can
    // forecast into and would skew any per-period average.
    .filter((p) => p.weeks >= 4)
    .sort((a, b) => a.start.localeCompare(b.start))
}

// ── Drivers ────────────────────────────────────────────────────────────────

export type DriverField = 'storesSelling' | 'baseVelocityWeekly' | 'seasonality'

export interface PeriodDrivers {
  /** Outlets actually carrying this product group. Distribution, not chain size. */
  storesSelling: number
  /** Units per selling store per week, de-promoted. */
  baseVelocityWeekly: number
  /** Index around 1.0. Derived from clean history, overridable by the planner. */
  seasonality: number
}

/**
 * A leaf forecast line. `customerId` and `productGroupId` are the finest grain
 * drivers are authored at; everything coarser is a roll-up.
 */
export interface ForecastLine {
  id: string
  orgId: string
  customerId: string
  productGroupId: string
  /** Keyed by ForecastPeriod.key. */
  periods: Record<string, PeriodDrivers>
  /** Set once a planner touches a cell, so overrides survive a recompute. */
  overrides: Record<string, Partial<Record<DriverField, true>>>
}

export const EMPTY_DRIVERS: PeriodDrivers = {
  storesSelling: 0,
  baseVelocityWeekly: 0,
  seasonality: 1,
}

/** The one formula. Everything else in this file arranges inputs for it. */
export function forecastUnits(d: PeriodDrivers, weeksInPeriod: number): number {
  return n4(d.storesSelling * d.baseVelocityWeekly * d.seasonality * weeksInPeriod)
}

export function lineUnits(
  line: ForecastLine,
  period: ForecastPeriod,
): number {
  const d = line.periods[period.key]
  return d ? forecastUnits(d, period.weeks) : 0
}

// ── Hierarchy ──────────────────────────────────────────────────────────────

export type GroupDimension = 'customer' | 'banner' | 'brand' | 'productGroup' | 'channel'

export interface ForecastNode {
  id: string
  label: string
  /** Which dimension produced this level — drives the row icon and indent. */
  dimension: GroupDimension | 'line'
  depth: number
  children: ForecastNode[]
  /** Leaf lines under this node, including its own if it is a leaf. */
  lineIds: string[]
  /** Forecast units by period key. */
  units: Record<string, number>
  total: number
  /**
   * Drivers are only shown when a node resolves to exactly one leaf line —
   * a store count averaged across three customers is not a number anyone can
   * act on, and showing it invites edits that silently fan out.
   */
  driverLineId?: string
}

export interface TreeContext {
  customerName: (id: string) => string
  customerParent: (id: string) => string | null
  channelOf: (id: string) => string
  productGroupName: (id: string) => string
  brandOfGroup: (id: string) => string
}

function dimensionKey(
  line: ForecastLine,
  dim: GroupDimension,
  ctx: TreeContext,
): { id: string; label: string } {
  switch (dim) {
    case 'customer': {
      const parent = ctx.customerParent(line.customerId) ?? line.customerId
      return { id: parent, label: ctx.customerName(parent) }
    }
    case 'banner':
      return { id: line.customerId, label: ctx.customerName(line.customerId) }
    case 'channel': {
      const ch = ctx.channelOf(line.customerId)
      return { id: `channel:${ch}`, label: ch.charAt(0).toUpperCase() + ch.slice(1) }
    }
    case 'brand': {
      const b = ctx.brandOfGroup(line.productGroupId)
      return { id: `brand:${b}`, label: b }
    }
    case 'productGroup':
      return { id: line.productGroupId, label: ctx.productGroupName(line.productGroupId) }
  }
}

/**
 * Group lines into a tree along the requested dimensions, summing forecast
 * units up every level. The dimension list is the "level" control — swapping
 * ['customer','productGroup'] for ['brand','customer'] re-pivots the whole
 * grid without touching a driver.
 */
export function buildForecastTree(
  lines: ForecastLine[],
  periods: ForecastPeriod[],
  dimensions: GroupDimension[],
  ctx: TreeContext,
): ForecastNode[] {
  const roots: ForecastNode[] = []
  const index = new Map<string, ForecastNode>()

  const blankUnits = () => Object.fromEntries(periods.map((p) => [p.key, 0]))

  for (const line of lines) {
    let siblings = roots
    let path = ''

    dimensions.forEach((dim, depth) => {
      const { id, label } = dimensionKey(line, dim, ctx)
      path = path ? `${path}/${id}` : id

      let node = index.get(path)
      if (!node) {
        node = {
          id: path,
          label,
          dimension: dim,
          depth,
          children: [],
          lineIds: [],
          units: blankUnits(),
          total: 0,
        }
        index.set(path, node)
        siblings.push(node)
      }

      node.lineIds.push(line.id)
      for (const p of periods) {
        const u = lineUnits(line, p)
        node.units[p.key] = n4(node.units[p.key] + u)
        node.total = n4(node.total + u)
      }
      siblings = node.children
    })
  }

  // A node backed by exactly one line can expose that line's drivers.
  const byId = new Map(lines.map((l) => [l.id, l]))
  const assign = (nodes: ForecastNode[]) => {
    for (const n of nodes) {
      const unique = [...new Set(n.lineIds)]
      if (unique.length === 1 && byId.has(unique[0])) n.driverLineId = unique[0]
      assign(n.children)
    }
  }
  assign(roots)

  const sortTree = (nodes: ForecastNode[]) => {
    nodes.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
    for (const n of nodes) sortTree(n.children)
  }
  sortTree(roots)

  return roots
}

export function totalsByPeriod(
  nodes: ForecastNode[],
  periods: ForecastPeriod[],
): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(periods.map((p) => [p.key, 0]))
  for (const n of nodes) {
    for (const p of periods) out[p.key] = n4(out[p.key] + n.units[p.key])
  }
  return out
}

// ── Editing ────────────────────────────────────────────────────────────────

/**
 * Apply a driver edit to one leaf line.
 *
 * The edit is recorded in `overrides` so a later recompute from history does
 * not silently discard a planner's judgement — the single most common way a
 * forecasting tool loses its users' trust.
 */
export function setDriver(
  line: ForecastLine,
  periodKey: string,
  field: DriverField,
  value: number,
): ForecastLine {
  const current = line.periods[periodKey] ?? { ...EMPTY_DRIVERS }
  const clamped =
    field === 'seasonality'
      ? Math.max(0, Math.min(5, value))
      : Math.max(0, value)

  return {
    ...line,
    periods: { ...line.periods, [periodKey]: { ...current, [field]: n4(clamped) } },
    overrides: {
      ...line.overrides,
      [periodKey]: { ...(line.overrides[periodKey] ?? {}), [field]: true },
    },
  }
}

/**
 * Scale a driver across many lines and periods by a factor — the "bulk update"
 * a planner reaches for after a range review ("take Q3 velocity up 5%").
 */
export function bulkScaleDriver(
  lines: ForecastLine[],
  lineIds: Set<string>,
  periodKeys: string[],
  field: DriverField,
  factor: number,
): ForecastLine[] {
  return lines.map((line) => {
    if (!lineIds.has(line.id)) return line
    let next = line
    for (const key of periodKeys) {
      const d = next.periods[key]
      if (!d) continue
      next = setDriver(next, key, field, d[field] * factor)
    }
    return next
  })
}

// ── Recommendations ────────────────────────────────────────────────────────

export type RecommendationKind =
  | 'velocity_below_actual'
  | 'velocity_above_actual'
  | 'distribution_gain'

export type Urgency = 'high' | 'medium' | 'low'

export interface ForecastRecommendation {
  id: string
  lineId: string
  customerId: string
  productGroupId: string
  periodKey: string
  kind: RecommendationKind
  urgency: Urgency
  field: DriverField
  currentValue: number
  suggestedValue: number
  /** Units the forecast moves if accepted. Signed. */
  impactUnits: number
  message: string
}

export interface ActualSignal {
  lineId: string
  /** De-promoted units per selling store per week over the recent window. */
  actualVelocityWeekly: number
  /** Stores that actually shipped in the recent window. */
  actualStores: number
  /** Weeks of clean history behind the signal. Low counts are less trustworthy. */
  sampleWeeks: number
}

const VELOCITY_HIGH = 0.2
const VELOCITY_MED = 0.08
const DISTRIBUTION_MED = 0.1

/**
 * Compare the forecast's assumptions against what actually happened and
 * propose specific driver changes.
 *
 * Deliberately conservative: it reports a variance and a suggested value, and
 * never rewrites a driver on its own. A forecasting tool that silently
 * overwrites a planner's number is one they stop using.
 */
export function buildRecommendations(
  lines: ForecastLine[],
  periods: ForecastPeriod[],
  signals: Map<string, ActualSignal>,
): ForecastRecommendation[] {
  const out: ForecastRecommendation[] = []
  const future = periods.filter((p) => !p.isPast)
  if (future.length === 0) return out

  for (const line of lines) {
    const signal = signals.get(line.id)
    if (!signal || signal.sampleWeeks < 6) continue

    // Only critique the next few open periods — a variance eleven periods out
    // is noise, and flooding the queue trains people to ignore it.
    for (const period of future.slice(0, 3)) {
      const d = line.periods[period.key]
      if (!d || d.storesSelling <= 0) continue
      const overridden = line.overrides[period.key] ?? {}

      // ── Velocity drift ──
      if (!overridden.baseVelocityWeekly && signal.actualVelocityWeekly > 0) {
        const drift = safeDiv(
          d.baseVelocityWeekly - signal.actualVelocityWeekly,
          signal.actualVelocityWeekly,
        )
        if (drift !== null && Math.abs(drift) >= VELOCITY_MED) {
          const urgency: Urgency = Math.abs(drift) >= VELOCITY_HIGH ? 'high' : 'medium'
          const suggested = n4(signal.actualVelocityWeekly)
          const impact = n4(
            (suggested - d.baseVelocityWeekly) * d.storesSelling * d.seasonality * period.weeks,
          )
          out.push({
            id: `${line.id}|${period.key}|velocity`,
            lineId: line.id,
            customerId: line.customerId,
            productGroupId: line.productGroupId,
            periodKey: period.key,
            kind: drift > 0 ? 'velocity_above_actual' : 'velocity_below_actual',
            urgency,
            field: 'baseVelocityWeekly',
            currentValue: d.baseVelocityWeekly,
            suggestedValue: suggested,
            impactUnits: impact,
            message:
              drift > 0
                ? `Forecast velocity is ${(drift * 100).toFixed(0)}% above the last ${signal.sampleWeeks} clean weeks`
                : `Forecast velocity is ${(Math.abs(drift) * 100).toFixed(0)}% below the last ${signal.sampleWeeks} clean weeks`,
          })
        }
      }

      // ── Distribution drift ──
      if (!overridden.storesSelling && signal.actualStores > 0) {
        const drift = safeDiv(d.storesSelling - signal.actualStores, signal.actualStores)
        if (drift !== null && Math.abs(drift) >= DISTRIBUTION_MED) {
          const suggested = Math.round(signal.actualStores)
          const impact = n4(
            (suggested - d.storesSelling) * d.baseVelocityWeekly * d.seasonality * period.weeks,
          )
          out.push({
            id: `${line.id}|${period.key}|stores`,
            lineId: line.id,
            customerId: line.customerId,
            productGroupId: line.productGroupId,
            periodKey: period.key,
            kind: 'distribution_gain',
            urgency: Math.abs(drift) >= 0.25 ? 'high' : 'medium',
            field: 'storesSelling',
            currentValue: d.storesSelling,
            suggestedValue: suggested,
            impactUnits: impact,
            message:
              drift > 0
                ? `Assumes ${Math.round(d.storesSelling)} stores; only ${suggested} have shipped recently`
                : `Distribution grew to ${suggested} stores but the forecast still assumes ${Math.round(d.storesSelling)}`,
          })
        }
      }

      // NOTE: there is deliberately no "a promotion runs here but the forecast
      // shows no uplift" rule. This is a BASE forecast — the history behind it
      // is de-promoted on purpose, and promotional lift is owned by the
      // promotion plan. Flagging the engine's own correct behaviour as a
      // defect is exactly how a tool teaches people to ignore its warnings.
    }
  }

  const rank: Record<Urgency, number> = { high: 0, medium: 1, low: 2 }
  const sorted = out.sort(
    (a, b) => rank[a.urgency] - rank[b.urgency] || Math.abs(b.impactUnits) - Math.abs(a.impactUnits),
  )

  /*
   * One finding per line per driver — the highest-impact period only.
   *
   * A drifting velocity is drifting in every open period, so reporting each
   * one separately triples the queue while saying the same thing three times.
   * A planner reads "this line is drifting" once and fixes it; a queue that
   * repeats itself is a queue people stop opening. The impact figure already
   * points at the period worth starting with.
   */
  const seen = new Set<string>()
  return sorted.filter((r) => {
    const key = `${r.lineId}|${r.field}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function summariseRecommendations(recs: ForecastRecommendation[]) {
  return {
    high: recs.filter((r) => r.urgency === 'high').length,
    medium: recs.filter((r) => r.urgency === 'medium').length,
    low: recs.filter((r) => r.urgency === 'low').length,
    netImpactUnits: n4(recs.reduce((a, r) => a + r.impactUnits, 0)),
  }
}

export function applyRecommendation(
  lines: ForecastLine[],
  rec: ForecastRecommendation,
): ForecastLine[] {
  return lines.map((l) =>
    l.id === rec.lineId ? setDriver(l, rec.periodKey, rec.field, rec.suggestedValue) : l,
  )
}
