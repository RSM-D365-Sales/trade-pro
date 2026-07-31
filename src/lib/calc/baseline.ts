/**
 * Baseline engine.
 *
 * Default method: 52-week moving average with promoted weeks EXCLUDED, then a
 * seasonality index applied. Excluding promoted weeks is the whole trick — if
 * you average promoted weeks into the baseline, the baseline chases the promo
 * and every event scores near-zero lift. Planners lose trust immediately.
 *
 * Every returned row carries its `method` so any number is explainable.
 */

import type { Baseline, SalesFact } from '../../data/types'
import { n4, safeDiv } from './money'

export interface BaselineInput {
  weekStart: string
  units: number
  /** True when this week sat inside a promotion's perform window. */
  promoted: boolean
}

export interface BaselinePoint {
  weekStart: string
  actualUnits: number
  baselineUnits: number
  incrementalUnits: number
  promoted: boolean
  method: Baseline['method']
  seasonalityIndex: number
}

const WINDOW = 52

/**
 * Seasonality index per week-of-year, computed from clean (non-promoted)
 * weeks only and normalised so the mean index is 1.0.
 */
export function seasonalityIndices(history: BaselineInput[]): Map<number, number> {
  const buckets = new Map<number, number[]>()

  history.forEach((h, i) => {
    if (h.promoted) return
    const woy = i % 52
    const arr = buckets.get(woy)
    if (arr) arr.push(h.units)
    else buckets.set(woy, [h.units])
  })

  const means = new Map<number, number>()
  for (const [woy, vals] of buckets) {
    means.set(woy, vals.reduce((a, b) => a + b, 0) / vals.length)
  }

  const grand =
    [...means.values()].reduce((a, b) => a + b, 0) / Math.max(1, means.size)

  const idx = new Map<number, number>()
  for (const [woy, m] of means) {
    // Clamp: a single freak week should not swing a baseline 3×.
    idx.set(woy, grand > 0 ? Math.min(1.6, Math.max(0.6, m / grand)) : 1)
  }
  return idx
}

export function computeBaselines(history: BaselineInput[]): BaselinePoint[] {
  const season = seasonalityIndices(history)

  return history.map((row, i) => {
    // Trailing window, promoted weeks dropped.
    const from = Math.max(0, i - WINDOW)
    const clean: number[] = []
    for (let j = from; j < i; j++) {
      if (!history[j].promoted) clean.push(history[j].units)
    }

    const seasonalityIndex = n4(season.get(i % 52) ?? 1)

    let baselineUnits: number
    let method: Baseline['method']

    if (clean.length >= 8) {
      const mean = clean.reduce((a, b) => a + b, 0) / clean.length
      baselineUnits = n4(mean * seasonalityIndex)
      method = '52w_moving_avg'
    } else if (clean.length > 0) {
      // Not enough clean history yet — fall back to the flat mean and say so.
      baselineUnits = n4(clean.reduce((a, b) => a + b, 0) / clean.length)
      method = 'seasonal_index'
    } else {
      // Cold start: the un-promoted read of this very week is the best guess.
      baselineUnits = n4(row.promoted ? row.units / 1.4 : row.units)
      method = 'seasonal_index'
    }

    return {
      weekStart: row.weekStart,
      actualUnits: n4(row.units),
      baselineUnits,
      incrementalUnits: n4(row.units - baselineUnits),
      promoted: row.promoted,
      method,
      seasonalityIndex,
    }
  })
}

/** Roll weekly sales facts into the shape the baseline engine wants. */
export function toBaselineInput(
  facts: SalesFact[],
  promotedWeeks: Set<string>,
): BaselineInput[] {
  const byWeek = new Map<string, number>()
  for (const f of facts) {
    byWeek.set(f.weekStart, (byWeek.get(f.weekStart) ?? 0) + f.units)
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, u]) => ({
      weekStart,
      units: n4(u),
      promoted: promotedWeeks.has(weekStart),
    }))
}

export interface LiftSummary {
  actualUnits: number
  baselineUnits: number
  incrementalUnits: number
  liftPct: number | null
}

export function summariseLift(points: BaselinePoint[]): LiftSummary {
  const actualUnits = n4(points.reduce((a, p) => a + p.actualUnits, 0))
  const baselineUnits = n4(points.reduce((a, p) => a + p.baselineUnits, 0))
  const incrementalUnits = n4(actualUnits - baselineUnits)
  return {
    actualUnits,
    baselineUnits,
    incrementalUnits,
    liftPct: safeDiv(incrementalUnits, baselineUnits),
  }
}
