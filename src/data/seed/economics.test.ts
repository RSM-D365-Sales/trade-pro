import { describe, expect, it } from 'vitest'

import { buildDataset, DEMO_TODAY } from './index'
import { claimableSpendIndex, plannedSpendIndex } from './sales'
import { addWeeks } from '../../lib/fiscal'
import {
  buildRecommendations, lineUnits, summariseRecommendations,
} from '../../lib/calc/forecast'

/**
 * Economic plausibility guards.
 *
 * A demo dataset can be internally consistent and still be nonsense to anyone
 * who knows the industry — half a billion in revenue for a "mid-market"
 * prospect, or a 3% trade rate when the real range is 12–20%. A CPG trade
 * finance person reads these numbers in the first thirty seconds, and getting
 * them wrong costs more credibility than a missing feature would.
 */
describe('demo tenant economics', () => {
  const ds = buildDataset()
  const from = addWeeks(DEMO_TODAY, -52)
  const f52 = ds.salesFacts.filter((f) => f.weekStart >= from)

  const gross = f52.reduce((a, x) => a + x.grossSales, 0)
  const cogs = f52.reduce((a, x) => a + x.cogs, 0)
  const offInvoice = f52.reduce((a, x) => a + x.offInvoiceDiscount, 0)

  const planned = plannedSpendIndex(ds.promotionLines)
  const promoIn52 = ds.promotions.filter(
    (p) =>
      p.performEnd >= from && p.performStart <= DEMO_TODAY &&
      p.status !== 'draft' && p.status !== 'cancelled',
  )
  const promoSpend = promoIn52.reduce((a, p) => a + (planned.get(p.id) ?? 0), 0)

  it('sits inside the $10M–$500M mid-market band the product targets', () => {
    expect(gross).toBeGreaterThan(100_000_000)
    expect(gross).toBeLessThan(300_000_000)
  })

  it('runs a trade spend rate in the real 10–20% range', () => {
    const tradeRate = (promoSpend + offInvoice) / gross
    expect(tradeRate).toBeGreaterThan(0.1)
    expect(tradeRate).toBeLessThan(0.2)
  })

  it('keeps gross margin in a credible CPG range', () => {
    const grossMarginPct = (gross - cogs) / gross
    expect(grossMarginPct).toBeGreaterThan(0.4)
    expect(grossMarginPct).toBeLessThan(0.55)
  })

  it('sells a realistic share of volume on deal', () => {
    const promoted = f52.filter((f) => f.promotionId).reduce((a, f) => a + f.units, 0)
    const all = f52.reduce((a, f) => a + f.units, 0)
    const share = promoted / all
    expect(share).toBeGreaterThan(0.12)
    expect(share).toBeLessThan(0.45)
  })

  it('deducts slightly MORE than it legitimately owes — which is the whole pitch', () => {
    const claimable = [...claimableSpendIndex(ds.promotionLines).values()]
      .reduce((a, b) => a + b, 0)
    const deducted = ds.deductions.reduce((a, d) => a + d.amount, 0)
    const ratio = deducted / claimable
    // Under 1.0 would mean retailers are under-claiming, which never happens.
    // Far over 1.0 would mean the seed invented money that was never at stake.
    expect(ratio).toBeGreaterThan(1.02)
    expect(ratio).toBeLessThan(1.45)
  })

  it('never lets off-invoice money return as a claimable chargeback', () => {
    const claimable = claimableSpendIndex(ds.promotionLines)
    const planned2 = plannedSpendIndex(ds.promotionLines)
    for (const [id, c] of claimable) {
      expect(c).toBeLessThanOrEqual((planned2.get(id) ?? 0) + 0.01)
    }
  })
})

describe('forecast grounding', () => {
  const ds = buildDataset()
  const { forecast } = ds

  it('produces planning lines across customers and product groups', () => {
    expect(forecast.lines.length).toBeGreaterThan(40)
    expect(forecast.productGroups.length).toBe(9)
    expect(new Set(forecast.lines.map((l) => l.customerId)).size).toBeGreaterThan(8)
  })

  it('uses fiscal periods of four and five weeks, not calendar months', () => {
    const weeks = new Set(forecast.periods.map((p) => p.weeks))
    expect([...weeks].sort()).toEqual([4, 5])
  })

  it('every line carries all three drivers for every period', () => {
    for (const line of forecast.lines.slice(0, 20)) {
      for (const p of forecast.periods) {
        const d = line.periods[p.key]
        expect(d).toBeDefined()
        expect(d.storesSelling).toBeGreaterThan(0)
        expect(d.baseVelocityWeekly).toBeGreaterThan(0)
        expect(d.seasonality).toBeGreaterThan(0)
      }
    }
  })

  it('never assumes more selling stores than the retailer operates', () => {
    const byId = new Map(ds.customers.map((c) => [c.id, c]))
    for (const line of forecast.lines) {
      const footprint = byId.get(line.customerId)?.storeCount ?? Infinity
      for (const p of forecast.periods) {
        expect(line.periods[p.key].storesSelling).toBeLessThanOrEqual(footprint)
      }
    }
  })

  it('does NOT contradict the shipment history it was derived from', () => {
    // The single most damaging thing a demo can do is show a forecast screen
    // and an analytics screen that disagree — a prospect will cross-check.
    const closed = forecast.periods.filter((p) => p.isPast).slice(-6)
    expect(closed.length).toBeGreaterThan(0)

    const from = closed[0].start
    const to = closed[closed.length - 1].end
    const actual = ds.salesFacts
      .filter((f) => f.weekStart >= from && f.weekStart <= to)
      .reduce((a, f) => a + f.units, 0)

    const forecastUnitsTotal = forecast.lines.reduce(
      (a, l) => a + closed.reduce((b, p) => b + lineUnits(l, p), 0),
      0,
    )

    // Drivers are de-promoted, so the forecast is a BASE volume and must sit
    // below shipments — but within sight of them, not a different universe.
    const ratio = forecastUnitsTotal / actual
    expect(ratio).toBeGreaterThan(0.6)
    expect(ratio).toBeLessThan(1.05)
  })

  it('gives the recommendation queue a workable, non-empty spread', () => {
    const recs = buildRecommendations(forecast.lines, forecast.periods, forecast.signals)
    const summary = summariseRecommendations(recs)
    // Populated enough to demo, small enough that a planner would actually work it.
    expect(summary.high + summary.medium).toBeGreaterThan(3)
    expect(recs.length).toBeLessThan(400)
    expect(new Set(recs.map((r) => r.kind)).size).toBeGreaterThan(1)
  })
})
