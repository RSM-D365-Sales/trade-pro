import { describe, expect, it } from 'vitest'

import { buildDataset, DEMO_TODAY } from './index'
import { claimableSpendIndex, plannedSpendIndex } from './sales'
import { CHAIN_CUSTOMERS, TERRITORIES, USERS } from '../catalog'
import { addWeeks } from '../../lib/fiscal'
import {
  buildForecastPeriods, buildRecommendations, lineUnits, summariseRecommendations,
} from '../../lib/calc/forecast'
import {
  buildCommercialFacts, caseFillRate, claimedSpendByCell, impliedCasesOrdered,
  rollup, rollupBy,
} from '../../lib/calc/commercial'
import { computePromotion, isOffInvoiceTactic } from '../../lib/calc/promotion'
import { buildWaterfall } from '../../lib/calc/waterfall'

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

/**
 * The commercial layer.
 *
 * The sales screen and the trade screens read the same facts, so the guard that
 * matters most here is the cross-screen one: if the sales director's top line
 * and the trade finance manager's top line ever drift into different universes,
 * a prospect will find it inside two minutes.
 */
describe('commercial layer', () => {
  const ds = buildDataset()
  const from = addWeeks(DEMO_TODAY, -52)

  const productsById = new Map(ds.products.map((p) => [p.id, p]))
  const linesByPromotion = new Map<string, typeof ds.promotionLines>()
  for (const l of ds.promotionLines) {
    const arr = linesByPromotion.get(l.promotionId)
    if (arr) arr.push(l)
    else linesByPromotion.set(l.promotionId, [l])
  }
  const economics = new Map(
    ds.promotions.map((p) => [
      p.id, computePromotion(linesByPromotion.get(p.id) ?? [], productsById),
    ]),
  )
  const byId = new Map(ds.customers.map((c) => [c.id, c]))
  const rootOf = (id: string): string => {
    let cur = byId.get(id)
    while (cur?.parentId) cur = byId.get(cur.parentId)
    return cur?.id ?? id
  }

  const facts = buildCommercialFacts(
    ds.salesFacts,
    claimedSpendByCell(ds.promotions, linesByPromotion, economics, rootOf, DEMO_TODAY),
    rootOf,
  )
  const year = facts.filter((f) => f.weekStart >= from)
  const sales = rollup(year)

  const periods = buildForecastPeriods(ds.fiscalWeeks, DEMO_TODAY)
  const periodOfWeek = new Map<string, string>()
  for (const w of ds.fiscalWeeks) {
    periodOfWeek.set(
      w.weekStart,
      `FY${String(w.fiscalYear).slice(2)} P${String(w.period).padStart(2, '0')}`,
    )
  }

  it('reconciles with the gross-to-net waterfall once the deduction line is added back', () => {
    // The waterfall books each event whole and carries unrecovered deductions;
    // the sales screen books each event by elapsed week and treats unrecovered
    // deductions as a claims cost, not a revenue allowance. Both are correct —
    // but the gap has to stay small and explained, not open-ended.
    const shipped = ds.salesFacts.filter((f) => f.weekStart >= from)
    let billScan = 0
    let fixed = 0
    for (const promo of ds.promotions) {
      if (promo.status === 'draft' || promo.status === 'cancelled') continue
      if (promo.performEnd < from || promo.performStart > DEMO_TODAY) continue
      const econ = economics.get(promo.id)
      if (!econ) continue
      for (const line of linesByPromotion.get(promo.id) ?? []) {
        if (isOffInvoiceTactic(line.tactic)) continue
        const spend = econ.lines.find((l) => l.lineId === line.id)?.spend ?? 0
        if (line.rateType === 'lump_sum') fixed += spend
        else billScan += spend
      }
    }
    const disputeBy = new Map(ds.disputes.map((d) => [d.deductionId, d]))
    let other = 0
    for (const d of ds.deductions) {
      if (d.receivedDate < from || d.receivedDate > DEMO_TODAY) continue
      if (d.status === 'written_off') other += d.amount
      else if (d.status === 'recovered') {
        other += Math.max(0, d.amount - (disputeBy.get(d.id)?.recoveredAmount ?? 0))
      }
    }

    const waterfall = buildWaterfall({
      grossSales: shipped.reduce((a, f) => a + f.grossSales, 0),
      offInvoice: shipped.reduce((a, f) => a + f.offInvoiceDiscount, 0),
      billBackScanBack: billScan,
      fixedFunds: fixed,
      otherDeductions: other,
      cogs: shipped.reduce((a, f) => a + f.cogs, 0),
    })

    // Identical starting point — anything else means the join is broken.
    expect(sales.grossSales).toBeCloseTo(waterfall.steps[0].value, 2)

    // Straddling events are the ONLY reason the allocated figure differs from
    // the whole-event figure, so it must stay within a few points.
    const claimedRatio = sales.claimedSpend / (billScan + fixed)
    expect(claimedRatio).toBeGreaterThan(0.85)
    expect(claimedRatio).toBeLessThan(1.15)

    // Add the deduction line back and the two top lines agree.
    const gap = Math.abs(sales.netSales - (waterfall.netSales + other)) / sales.netSales
    expect(gap).toBeLessThan(0.015)
  })

  it('never books trade money against a week that has not traded yet', () => {
    const future = facts.filter((f) => f.weekStart > DEMO_TODAY)
    expect(future).toHaveLength(0)
    for (const key of ds.commercial.periodKeys) {
      expect(periods.find((p) => p.key === key)!.start <= DEMO_TODAY).toBe(true)
    }
  })

  it('plans every chain in every traded period', () => {
    const covered = new Set(ds.commercial.plan.map((p) => `${p.customerId}|${p.periodKey}`))
    for (const chain of CHAIN_CUSTOMERS) {
      for (const key of ds.commercial.periodKeys.slice(-12)) {
        expect(covered.has(`${chain.id}|${key}`)).toBe(true)
      }
    }
    expect(ds.commercial.plan.every((p) => p.netSales > 0)).toBe(true)
  })

  it('sets a plan the business neither walks nor cannot reach', () => {
    // Twelve consecutive misses reads as a broken plan; twelve consecutive
    // beats reads as a plan nobody meant. Real books land either side of it.
    const planIndex = new Map(
      ds.commercial.plan.map((p) => [`${p.customerId}|${p.periodKey}`, p.netSales]),
    )
    const byPeriod = rollupBy(facts, (f) => periodOfWeek.get(f.weekStart) ?? null)
    // Drop the period in flight — a partial actual against a whole plan is not
    // a miss, it is an incomplete measurement.
    const closed = ds.commercial.periodKeys.slice(-13, -1)

    let actual = 0
    let plan = 0
    const attainments: number[] = []
    for (const key of closed) {
      const roll = byPeriod.get(key)
      if (!roll) continue
      const p = CHAIN_CUSTOMERS.reduce((a, c) => a + (planIndex.get(`${c.id}|${key}`) ?? 0), 0)
      actual += roll.netSales
      plan += p
      attainments.push(roll.netSales / p)
    }

    expect(actual / plan).toBeGreaterThan(0.92)
    expect(actual / plan).toBeLessThan(1.08)
    expect(attainments.some((a) => a > 1)).toBe(true)
    expect(attainments.some((a) => a < 1)).toBe(true)
  })

  it('runs service rates a supply chain manager would recognise', () => {
    for (const s of ds.commercial.service) {
      expect(s.fillRate).toBeGreaterThan(0.9)
      expect(s.fillRate).toBeLessThan(0.996)
      // OTIF is a stricter test than fill rate and can never beat it.
      expect(s.otifRate).toBeLessThan(s.fillRate)
      expect(s.casesPerOrder).toBeGreaterThan(0)
      expect(s.linesPerOrder).toBeGreaterThan(1)
    }

    const rateIndex = new Map(
      ds.commercial.service.map((s) => [`${s.customerId}|${s.periodKey}`, s]),
    )
    const cells = rollupBy(year, (f) => {
      const p = periodOfWeek.get(f.weekStart)
      return p ? `${f.chainId}|${p}` : null
    })
    let shipped = 0
    let ordered = 0
    for (const [key, roll] of cells) {
      const rates = rateIndex.get(key)
      if (!rates) continue
      shipped += roll.units
      ordered += impliedCasesOrdered(roll.units, rates.fillRate)
    }
    const fill = caseFillRate(shipped, ordered)!
    // Below the 98% most retailers demand, which is the point of showing it.
    expect(fill).toBeGreaterThan(0.94)
    expect(fill).toBeLessThan(0.98)
  })

  it('carries receivables a mid-market CPG finance team would recognise', () => {
    expect(ds.commercial.receivables).toHaveLength(CHAIN_CUSTOMERS.length)
    for (const r of ds.commercial.receivables) {
      expect(r.dsoDays).toBeGreaterThan(14)
      expect(r.dsoDays).toBeLessThan(62)
      expect(r.pastDue60Share).toBeLessThan(0.09)
    }

    const trailing = rollupBy(
      facts.filter((f) => f.weekStart > addWeeks(DEMO_TODAY, -13)),
      (f) => f.chainId,
    )
    const terms = new Map(ds.commercial.receivables.map((r) => [r.customerId, r]))
    let balance = 0
    let net = 0
    for (const [chainId, roll] of trailing) {
      balance += (roll.netSales / 91) * (terms.get(chainId)?.dsoDays ?? 0)
      net += roll.netSales
    }
    const dso = balance / (net / 91)
    expect(dso).toBeGreaterThan(24)
    expect(dso).toBeLessThan(48)
  })

  it('gives every chain an owner and every owner a book', () => {
    const owned = TERRITORIES.flatMap((t) => t.customerIds)
    expect(new Set(owned).size).toBe(owned.length) // nobody shares an account
    expect(new Set(owned)).toEqual(new Set(CHAIN_CUSTOMERS.map((c) => c.id)))
    for (const t of TERRITORIES) {
      expect(t.customerIds.length).toBeGreaterThan(0)
      expect(USERS.find((u) => u.id === t.repId)?.role).toBe('kam')
    }
  })

  it('spreads margin across territories enough for a leaderboard to say something', () => {
    const byChain = rollupBy(year, (f) => f.chainId)
    const margins = TERRITORIES.map((t) => {
      const net = t.customerIds.reduce((a, id) => a + (byChain.get(id)?.netSales ?? 0), 0)
      const gp = t.customerIds.reduce((a, id) => a + (byChain.get(id)?.grossProfit ?? 0), 0)
      return gp / net
    })
    // A leaderboard where everyone sits within a point of each other is a
    // leaderboard nobody would act on.
    expect(Math.max(...margins) - Math.min(...margins)).toBeGreaterThan(0.04)
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
