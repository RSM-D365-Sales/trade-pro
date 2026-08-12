/**
 * Forecast drivers, derived from the seeded sales history.
 *
 * Nothing here is invented independently of the rest of the demo: base
 * velocity comes from de-promoted actual shipments, seasonality is measured
 * from the same clean weeks, and distribution is implied by how many stores
 * the volume supports. That matters because the forecast screen and the
 * analytics screen have to agree — a prospect WILL cross-check them, and a
 * forecast that contradicts the shipment history is worse than no forecast.
 *
 * Forward periods carry the trailing year's seasonality with a small drift
 * applied, so the plan is not simply last year repeated.
 */

import { CHAIN_CUSTOMERS, PRODUCTS } from '../catalog'
import type { Dataset, FiscalWeek, SalesFact } from '../types'
import {
  EMPTY_DRIVERS, buildForecastPeriods, forecastUnits,
  type ActualSignal, type ForecastLine, type ForecastPeriod, type PeriodDrivers,
} from '../../lib/calc/forecast'
import { n4 } from '../../lib/calc/money'
import { makeRng, type Rng } from '../rng'

/**
 * Product groups are subbrands — "Chocolate", "Protein Bars". That is the
 * grain a planner forecasts at: nobody forecasts a single SKU by hand across
 * twelve retailers, and nobody negotiates distribution at brand level.
 */
export interface ProductGroupRef {
  id: string
  name: string
  brand: string
  category: string
  productIds: string[]
}

export function buildProductGroups(): ProductGroupRef[] {
  const bySub = new Map<string, ProductGroupRef>()
  for (const p of PRODUCTS) {
    const id = `pgrp_${p.subbrand.replace(/\s+/g, '_').toLowerCase()}`
    const hit = bySub.get(id)
    if (hit) hit.productIds.push(p.id)
    else {
      bySub.set(id, {
        id,
        name: p.subbrand,
        brand: p.brand,
        category: p.category,
        productIds: [p.id],
      })
    }
  }
  return [...bySub.values()]
}

/** Average units a single store moves in a week — the industry's unit of comparison. */
const TARGET_STORE_VELOCITY: Record<string, number> = {
  club: 9.5, // few outlets, enormous throughput each
  mass: 2.4,
  grocery: 1.6,
  natural: 1.1,
  distributor: 0.9,
  convenience: 0.7,
}

export interface ForecastSeedResult {
  productGroups: ProductGroupRef[]
  periods: ForecastPeriod[]
  lines: ForecastLine[]
  signals: Map<string, ActualSignal>
}

export function buildForecast(
  rng: Rng,
  opts: {
    orgId: string
    calendar: FiscalWeek[]
    today: string
    salesFacts: SalesFact[]
    promotions: Dataset['promotions']
    promotionLines: Dataset['promotionLines']
  },
): ForecastSeedResult {
  const productGroups = buildProductGroups()
  const periods = buildForecastPeriods(opts.calendar, opts.today)

  const groupOfProduct = new Map<string, string>()
  for (const g of productGroups) for (const pid of g.productIds) groupOfProduct.set(pid, g.id)

  const chainById = new Map(CHAIN_CUSTOMERS.map((c) => [c.id, c]))

  // Which fiscal period each week belongs to.
  const periodOfWeek = new Map<string, ForecastPeriod>()
  for (const p of periods) {
    for (const w of opts.calendar) {
      if (w.weekStart >= p.start && w.weekStart <= p.end) periodOfWeek.set(w.weekStart, p)
    }
  }

  // ── Aggregate history to customer × product group × week ──
  interface Cell {
    unitsByWeek: Map<string, number>
    promotedWeeks: Set<string>
  }
  const cells = new Map<string, Cell>()
  const key = (c: string, g: string) => `${c}|${g}`

  for (const f of opts.salesFacts) {
    const g = groupOfProduct.get(f.productId)
    if (!g) continue
    const k = key(f.customerId, g)
    let cell = cells.get(k)
    if (!cell) cells.set(k, (cell = { unitsByWeek: new Map(), promotedWeeks: new Set() }))
    cell.unitsByWeek.set(f.weekStart, (cell.unitsByWeek.get(f.weekStart) ?? 0) + f.units)
    if (f.promotionId) cell.promotedWeeks.add(f.weekStart)
  }

  const lines: ForecastLine[] = []
  const signals = new Map<string, ActualSignal>()

  /*
   * Locked-forecast noise comes from its OWN seeded stream, never the main
   * one. Splicing extra draws into the shared sequence would shift every
   * number generated after this file — including the recommendation counts
   * the demo script quotes — and verify.mjs asserts against fixed anchors.
   */
  const lockRng = makeRng(0x1f0c_a557)
  const closedPeriods = periods.filter((p) => p.isPast)
  // Common-cause misses (a heat wave, a shifted holiday) hit every line in a
  // period together. Without this shared term, independent line noise cancels
  // across a hundred lines and historic accuracy reads an implausible ~100%.
  const commonMiss = new Map(closedPeriods.map((p) => [p.key, lockRng.float(0.975, 1.025)]))

  for (const [k, cell] of cells) {
    const [customerId, groupId] = k.split('|')
    const chain = chainById.get(customerId)
    if (!chain) continue

    const cleanWeeks = [...cell.unitsByWeek.entries()]
      .filter(([w]) => !cell.promotedWeeks.has(w))
      .sort(([a], [b]) => a.localeCompare(b))
    if (cleanWeeks.length < 12) continue

    const meanClean =
      cleanWeeks.reduce((a, [, u]) => a + u, 0) / cleanWeeks.length

    // Distribution is inferred: how many stores does this volume support at a
    // channel-typical per-store rate, capped by the chain's actual footprint?
    const target = TARGET_STORE_VELOCITY[chain.channel] ?? 1.5
    const footprint = chain.storeCount ?? 500
    const storesSelling = Math.max(
      12,
      Math.min(Math.round(footprint * 0.96), Math.round(meanClean / target)),
    )
    // ── Seasonality measured from clean weeks, per fiscal period ──
    const periodMeans = new Map<number, { sum: number; n: number }>()
    for (const [week, units] of cleanWeeks) {
      const p = periodOfWeek.get(week)
      if (!p) continue
      const cur = periodMeans.get(p.period) ?? { sum: 0, n: 0 }
      cur.sum += units
      cur.n += 1
      periodMeans.set(p.period, cur)
    }
    const seasonalityByPeriod = new Map<number, number>()
    for (const [period, { sum, n }] of periodMeans) {
      const idx = meanClean > 0 ? sum / n / meanClean : 1
      // Clamp: one freak week must not swing a whole period 3x.
      seasonalityByPeriod.set(period, n4(Math.min(1.8, Math.max(0.55, idx))))
    }

    /*
     * Base velocity comes from the RECENT de-seasonalised run rate, not the
     * two-year mean.
     *
     * A planner forecasts forward from where the business is now. Anchoring on
     * a long-run average bakes in every point of trend as a permanent error —
     * for a brand growing 0.3%/week that is a 15% understatement by the end of
     * the year, and the recommendation engine would then flag every single line
     * as drifting. A signal that fires on everything is noise.
     */
    const recentWindow = cleanWeeks.slice(-13)
    const deseasonalise = ([week, u]: [string, number]) => {
      const per = periodOfWeek.get(week)
      const index = (per ? seasonalityByPeriod.get(per.period) : 1) ?? 1
      return index > 0 ? u / index : u
    }
    const recentRate = recentWindow.length
      ? recentWindow.map(deseasonalise).reduce((a, u) => a + u, 0) / recentWindow.length
      : meanClean
    const baseVelocityWeekly = n4(recentRate / storesSelling)

    // ── Build a driver set for every period ──
    const drivers: Record<string, PeriodDrivers> = {}
    periods.forEach((p, i) => {
      const seasonality = seasonalityByPeriod.get(p.period) ?? 1
      // Forward periods drift slightly so the plan is not last year repeated.
      const drift = p.isPast ? 1 : 1 + (i - periods.length / 2) * 0.0015
      const storeDrift = p.isPast ? 1 : rng.float(0.99, 1.05)
      drivers[p.key] = {
        ...EMPTY_DRIVERS,
        // Clamp AFTER drift: a distribution gain can never take a product into
        // more stores than the retailer operates, and a forecast that assumes
        // otherwise is indefensible the moment a buyer looks at it.
        storesSelling: Math.min(footprint, Math.round(storesSelling * storeDrift)),
        baseVelocityWeekly: n4(baseVelocityWeekly * drift * rng.float(0.97, 1.03)),
        seasonality,
      }
    })

    // ── The actual signal the recommendation engine compares against ──
    //
    // Most of a real plan is fine. Only a minority of lines have genuinely
    // drifted, and making every line drift produces a queue of hundreds that
    // no planner would ever work — "if everything is urgent, nothing is".
    // So ~20% of lines drift materially and the rest sit within noise.
    // Both sides of the comparison are now the same de-seasonalised measure,
    // so a finding means a genuine change in rate of sale — never the calendar
    // or the trend doing its job.
    const velocityDrifts = rng.chance(0.18)
    const distributionDrifts = rng.chance(0.14)

    const actualVelocityWeekly = n4(
      baseVelocityWeekly *
        (velocityDrifts ? rng.pick([rng.float(0.68, 0.85), rng.float(1.15, 1.34)]) : rng.float(0.99, 1.01)),
    )
    const actualStores = Math.min(
      footprint,
      Math.round(
        storesSelling *
          (distributionDrifts ? rng.pick([rng.float(0.7, 0.86), rng.float(1.14, 1.3)]) : rng.float(0.995, 1.005)),
      ),
    )

    /*
     * ── The forecast as it was LOCKED, for closed periods ──
     *
     * Accuracy cannot be scored against today's drivers — those were fitted
     * from the very actuals being scored, and the plan would grade itself
     * perfect. What gets kept is the number the plan showed when the period
     * locked, reconstructed from the same drift the recommendation engine
     * measures: a line whose velocity ran away from the plan was mis-forecast
     * by exactly that gap while the drift emerged. So the accuracy chart dips
     * in recent periods on the very lines the queue is flagging — one story,
     * told twice.
     */
    const planToActual =
      (actualVelocityWeekly > 0 ? baseVelocityWeekly / actualVelocityWeekly : 1) *
      (actualStores > 0 ? storesSelling / actualStores : 1)
    const lockedUnits: Record<string, number> = {}
    closedPeriods.forEach((p, i) => {
      // Drift emerged over the last quarter: full effect in the newest closed
      // period, fading to nothing four periods back.
      const fromEnd = closedPeriods.length - 1 - i
      const ramp = fromEnd === 0 ? 1 : fromEnd === 1 ? 0.6 : fromEnd === 2 ? 0.25 : 0
      const actual = forecastUnits(drivers[p.key], p.weeks)
      lockedUnits[p.key] = Math.max(0, Math.round(
        actual *
          (1 + (planToActual - 1) * ramp) *
          (commonMiss.get(p.key) ?? 1) *
          lockRng.float(0.93, 1.07),
      ))
    })

    const lineId = `fl_${lines.length}`
    lines.push({
      id: lineId,
      orgId: opts.orgId,
      customerId,
      productGroupId: groupId,
      periods: drivers,
      overrides: {},
      lockedUnits,
    })

    signals.set(lineId, {
      lineId,
      actualVelocityWeekly,
      actualStores,
      sampleWeeks: recentWindow.length,
    })
  }

  return { productGroups, periods, lines, signals }
}
