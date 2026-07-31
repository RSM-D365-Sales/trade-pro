import { describe, expect, it } from 'vitest'

import { buildDataset, DEMO_TODAY } from './index'
import { claimableSpendIndex, plannedSpendIndex } from './sales'
import { addWeeks } from '../../lib/fiscal'

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
