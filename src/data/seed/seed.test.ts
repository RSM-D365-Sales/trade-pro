import { describe, expect, it } from 'vitest'

import { buildDataset, DEMO_TODAY, SEED_CONFIG } from './index'
import { brandIndex, claimableSpendIndex, tacticIndex } from './sales'
import { computeAllFundBalances } from '../../lib/calc/funds'
import { disposition, matchDeduction, DEFAULT_MATCH_OPTIONS } from '../../lib/calc/matching'

const ds = buildDataset()

describe('seeded dataset', () => {
  it('is deterministic — two builds are identical', () => {
    const b = buildDataset()
    expect(b.promotions.length).toBe(ds.promotions.length)
    expect(b.deductions[0].docNumber).toBe(ds.deductions[0].docNumber)
    expect(b.deductions[0].amount).toBe(ds.deductions[0].amount)
    expect(b.salesFacts.length).toBe(ds.salesFacts.length)
  })

  it('hits the scale the build plan asks for', () => {
    expect(new Set(ds.products.map((p) => p.brand)).size).toBe(3)
    expect(ds.products.length).toBe(40)
    expect(ds.customers.filter((c) => c.level === 'chain').length).toBe(12)
    expect(ds.promotions.length).toBeGreaterThanOrEqual(190)
    expect(ds.deductions.length).toBeGreaterThanOrEqual(280)
    expect(ds.salesFacts.length).toBeGreaterThan(20_000)
  })

  it('covers roughly two years of weekly history and plans forward', () => {
    const weeks = [...new Set(ds.salesFacts.map((f) => f.weekStart))].sort()
    expect(weeks.length).toBe(SEED_CONFIG.historyWeeks)
    expect(weeks[weeks.length - 1] <= DEMO_TODAY).toBe(true)
    const future = ds.promotions.filter((p) => p.performStart > DEMO_TODAY)
    expect(future.length).toBeGreaterThan(10)
  })

  it('keeps referential integrity across every foreign key', () => {
    const customerIds = new Set(ds.customers.map((c) => c.id))
    const productIds = new Set(ds.products.map((p) => p.id))
    const promoIds = new Set(ds.promotions.map((p) => p.id))
    const fundIds = new Set(ds.funds.map((f) => f.id))
    const deductionIds = new Set(ds.deductions.map((d) => d.id))

    expect(ds.promotions.every((p) => customerIds.has(p.customerId))).toBe(true)
    expect(ds.promotions.every((p) => fundIds.has(p.fundId))).toBe(true)
    expect(ds.promotionLines.every((l) => promoIds.has(l.promotionId))).toBe(true)
    expect(ds.promotionLines.every((l) => productIds.has(l.productId))).toBe(true)
    expect(ds.salesFacts.every((f) => customerIds.has(f.customerId))).toBe(true)
    expect(ds.salesFacts.every((f) => !f.promotionId || promoIds.has(f.promotionId))).toBe(true)
    expect(ds.fundTransactions.every((t) => fundIds.has(t.fundId))).toBe(true)
    expect(ds.deductions.every((d) => customerIds.has(d.customerId))).toBe(true)
    expect(ds.disputes.every((d) => deductionIds.has(d.deductionId))).toBe(true)
    expect(ds.settlements.every((s) => deductionIds.has(s.deductionId))).toBe(true)
    expect(ds.eventResults.every((e) => promoIds.has(e.promotionId))).toBe(true)
  })

  it('orders each promotion’s six dates correctly', () => {
    for (const p of ds.promotions) {
      expect(p.buyStart <= p.buyEnd).toBe(true)
      expect(p.shipStart <= p.shipEnd).toBe(true)
      expect(p.performStart <= p.performEnd).toBe(true)
      expect(p.buyStart <= p.shipStart).toBe(true)
      expect(p.shipStart <= p.performStart).toBe(true)
    }
  })

  it('never lets a status contradict the calendar', () => {
    for (const p of ds.promotions) {
      if (p.status === 'closed') expect(p.performEnd < DEMO_TODAY).toBe(true)
      if (p.status === 'active') {
        expect(p.performStart <= DEMO_TODAY && p.performEnd >= DEMO_TODAY).toBe(true)
      }
      if (p.status === 'draft') expect(p.approvedAt).toBeUndefined()
    }
  })

  it('models lift, cannibalization and the post-promo dip', () => {
    const withCannibal = ds.eventResults.filter((e) => e.cannibalizedUnits > 0)
    const withDip = ds.eventResults.filter((e) => e.pantryLoadUnits > 0)
    expect(withCannibal.length).toBeGreaterThan(5)
    expect(withDip.length).toBeGreaterThan(20)
    // Honest reporting means true lift is below reported lift on those events.
    for (const e of withDip.slice(0, 25)) {
      const reported = e.shippedUnits - e.baselineUnits
      expect(reported - e.cannibalizedUnits - e.pantryLoadUnits).toBeLessThan(reported)
    }
  })

  it('produces fund balances that reconcile to the ledger', () => {
    const balances = computeAllFundBalances(ds.funds, ds.fundTransactions)
    expect(balances.size).toBe(ds.funds.length)
    for (const [fundId, b] of balances) {
      const fund = ds.funds.find((f) => f.id === fundId)!
      const seed = fund.type === 'accrual' ? 0 : (fund.budget ?? 0)
      const ledgerFunding =
        b.byType.accrual + b.byType.carryover + b.byType.adjustment + b.byType.reversal
      expect(b.funded).toBeCloseTo(seed + ledgerFunding, 2)
      expect(b.remaining).toBeCloseTo(b.funded - b.committed - b.actual, 2)
    }
    // At least some funds are genuinely under pressure, or the dashboard lies.
    expect([...balances.values()].some((b) => b.overCommitted)).toBe(true)
  })

  it('gives the matching engine a realistic spread of outcomes', () => {
    const tactics = tacticIndex(ds.promotionLines)
    const ctx = {
      customers: ds.customers,
      reasonCodes: ds.reasonCodes,
      claimableSpendByPromotion: claimableSpendIndex(ds.promotionLines),
      tacticsByPromotion: tactics,
      brandsByPromotion: brandIndex(ds.promotionLines),
    }

    const buckets: Record<string, number> = {
      auto_matched: 0, needs_review: 0, likely_invalid: 0, no_match: 0,
    }
    for (const d of ds.deductions) {
      const candidates = matchDeduction(d, ds.promotions, ctx, DEFAULT_MATCH_OPTIONS)
      buckets[disposition(candidates, DEFAULT_MATCH_OPTIONS)] += 1
    }

    // Every bucket must be populated — a demo where everything auto-matches
    // proves nothing, and one where nothing does is worse.
    expect(buckets.auto_matched).toBeGreaterThan(20)
    expect(buckets.needs_review).toBeGreaterThan(20)
    expect(buckets.likely_invalid).toBeGreaterThan(20)
    expect(buckets.no_match).toBeGreaterThan(5)
    expect(Object.values(buckets).reduce((a, b) => a + b, 0)).toBe(ds.deductions.length)
  })

  it('never proposes a match outside the deduction’s customer family', () => {
    const ctx = {
      customers: ds.customers,
      reasonCodes: ds.reasonCodes,
      claimableSpendByPromotion: claimableSpendIndex(ds.promotionLines),
      tacticsByPromotion: tacticIndex(ds.promotionLines),
      brandsByPromotion: brandIndex(ds.promotionLines),
    }
    const byId = new Map(ds.customers.map((c) => [c.id, c]))
    const rootOf = (id: string): string => {
      let cur = byId.get(id)
      while (cur?.parentId) cur = byId.get(cur.parentId)
      return cur?.id ?? id
    }

    for (const d of ds.deductions.slice(0, 120)) {
      for (const c of matchDeduction(d, ds.promotions, ctx)) {
        const promo = ds.promotions.find((p) => p.id === c.promotionId)!
        expect(rootOf(promo.customerId)).toBe(rootOf(d.customerId))
      }
    }
  })

  it('has money on the table — open deductions worth recovering', () => {
    const open = ds.deductions.filter((d) => d.status === 'open' || d.status === 'review')
    expect(open.length).toBeGreaterThan(20)
    const recovered = ds.disputes.reduce((a, x) => a + x.recoveredAmount, 0)
    expect(recovered).toBeGreaterThan(0)
  })
})
