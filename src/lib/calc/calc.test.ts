import { describe, expect, it } from 'vitest'

import { n4, safeDiv, sum4 } from './money'
import { computeLine, computePromotion, computeTruePerformance, spendPerCase } from './promotion'
import { computeFundBalance, accrualAmount, carryoverAmount, utilizationBand } from './funds'
import { computeBaselines } from './baseline'
import { buildWaterfall } from './waterfall'
import {
  customerFamily, disposition, matchDeduction, summariseRecovery, DEFAULT_MATCH_OPTIONS,
} from './matching'
import { buildFiscalCalendar, ageBucket, rangesOverlap, weekStartOf } from '../fiscal'
import type { Customer, Deduction, Fund, Product, Promotion, PromotionLine, ReasonCode } from '../../data/types'

const PRODUCT: Product = {
  id: 'p1', orgId: 'o', sku: 'X1', name: 'Test', category: 'Snacks', brand: 'B', subbrand: 'S',
  casePack: 12, baseUom: 'CS', listPrice: 40, cogs: 22, netWeightLb: 6, status: 'active',
}

function line(over: Partial<PromotionLine> = {}): PromotionLine {
  return {
    id: 'l1', orgId: 'o', promotionId: 'pr1', productId: 'p1', tactic: 'tpr',
    rateType: 'per_case', rate: 4, plannedBaselineUnits: 1000, plannedLiftUnits: 500, ...over,
  }
}

describe('money', () => {
  it('snaps to numeric(18,4)', () => {
    expect(n4(1 / 3)).toBe(0.3333)
    expect(n4(2.00005)).toBe(2.0001)
  })

  it('sums 300 fractional values without drift', () => {
    const vals = Array.from({ length: 300 }, () => 0.1)
    expect(sum4(vals)).toBe(30)
  })

  it('guards division by zero', () => {
    expect(safeDiv(5, 0)).toBeNull()
    expect(safeDiv(5, 2)).toBe(2.5)
  })
})

describe('promotion economics', () => {
  it('computes per-case spend for every rate type', () => {
    expect(spendPerCase('per_case', 4, PRODUCT, 1500)).toBe(4)
    expect(spendPerCase('pct_of_list', 0.15, PRODUCT, 1500)).toBe(6)
    expect(spendPerCase('per_unit', 0.5, PRODUCT, 1500)).toBe(6) // 0.50 x 12 per case
    expect(spendPerCase('lump_sum', 3000, PRODUCT, 1500)).toBe(2)
  })

  it('matches the worked example in the calc spec', () => {
    // 1000 baseline + 500 lift = 1500 cases at $40 list, $22 COGS, $4/case deal.
    const e = computeLine(line(), PRODUCT)
    expect(e.totalUnits).toBe(1500)
    expect(e.spend).toBe(6000) // 1500 x $4
    expect(e.grossRevenue).toBe(60_000) // 1500 x $40
    // net price = (60000 - 6000) / 1500 = $36; margin/case = 36 - 22 = $14
    expect(e.incrementalMargin).toBe(7000) // 500 x $14
    expect(e.roi).toBeCloseTo((7000 - 6000) / 6000, 6)
    expect(e.liftPct).toBeCloseTo(0.5, 6)
    expect(e.spendPerIncrementalCase).toBe(12)
  })

  it('takes off-invoice money off net invoice revenue but bill-back does not', () => {
    const off = computeLine(line({ tactic: 'off_invoice' }), PRODUCT)
    const bill = computeLine(line({ tactic: 'bill_back' }), PRODUCT)
    expect(off.netInvoiceRevenue).toBe(54_000)
    expect(bill.netInvoiceRevenue).toBe(60_000)
    // Both still cost the same money overall.
    expect(off.spend).toBe(bill.spend)
    expect(off.totalMargin).toBe(bill.totalMargin)
  })

  it('flags a lump-sum line with no volume instead of dividing by zero', () => {
    const e = computeLine(
      line({ rateType: 'lump_sum', rate: 5000, plannedBaselineUnits: 0, plannedLiftUnits: 0 }),
      PRODUCT,
    )
    expect(e.spend).toBe(5000)
    expect(e.spendPerIncrementalCase).toBeNull()
    expect(e.liftPct).toBeNull()
  })

  it('aggregates lines into a promotion', () => {
    const p = computePromotion([line(), line({ id: 'l2', rate: 2 })], new Map([['p1', PRODUCT]]))
    expect(p.lineCount).toBe(2)
    expect(p.spend).toBe(6000 + 3000)
    expect(p.totalUnits).toBe(3000)
  })

  it('reports true ROI below reported ROI once cannibalization and pantry load are netted out', () => {
    const t = computeTruePerformance(500, 120, 90, 6000, 14)
    expect(t.trueIncrementalUnits).toBe(290)
    expect(t.reportedRoi).toBeGreaterThan(t.trueRoi!)
    expect(t.qualityOfLift).toBeCloseTo(0.58, 6)
  })
})

describe('fund ledger', () => {
  const fund: Fund = {
    id: 'f1', orgId: 'o', code: 'F1', name: 'F', type: 'accrual', accrualBasis: 'net_sales',
    accrualRate: 0.05, customerId: 'c1', productGroupId: null, periodStart: '2026-01-01',
    periodEnd: '2026-12-31', currency: 'USD', carryoverPolicy: 'capped', carryoverCap: 10_000,
  }

  it('derives balance from the ledger, never from a stored column', () => {
    const b = computeFundBalance(fund, [
      { id: '1', orgId: 'o', fundId: 'f1', type: 'accrual', amount: 100_000, postedAt: '2026-01-31', actorId: 's' },
      { id: '2', orgId: 'o', fundId: 'f1', type: 'commitment', amount: -30_000, postedAt: '2026-02-01', actorId: 's' },
      { id: '3', orgId: 'o', fundId: 'f1', type: 'actual', amount: -25_000, postedAt: '2026-03-01', actorId: 's' },
      { id: '4', orgId: 'o', fundId: 'f1', type: 'adjustment', amount: 5_000, postedAt: '2026-03-02', actorId: 's' },
    ])
    expect(b.funded).toBe(105_000)
    expect(b.committed).toBe(30_000)
    expect(b.actual).toBe(25_000)
    expect(b.remaining).toBe(50_000)
    expect(b.overCommitted).toBe(false)
  })

  it('detects over-commitment', () => {
    const b = computeFundBalance(fund, [
      { id: '1', orgId: 'o', fundId: 'f1', type: 'accrual', amount: 10_000, postedAt: '2026-01-31', actorId: 's' },
      { id: '2', orgId: 'o', fundId: 'f1', type: 'commitment', amount: -18_000, postedAt: '2026-02-01', actorId: 's' },
    ])
    expect(b.overCommitted).toBe(true)
    expect(utilizationBand(b.utilization).tone).toBe('critical')
  })

  it('accrues on the configured basis', () => {
    const fact = { grossSales: 1000, offInvoiceDiscount: 100, units: 25 }
    expect(accrualAmount({ accrualBasis: 'gross_sales', accrualRate: 0.05 }, fact)).toBe(50)
    expect(accrualAmount({ accrualBasis: 'net_sales', accrualRate: 0.05 }, fact)).toBe(45)
    expect(accrualAmount({ accrualBasis: 'volume', accrualRate: 2 }, fact)).toBe(50)
  })

  it('caps carryover per policy', () => {
    expect(carryoverAmount(fund, 40_000)).toBe(10_000)
    expect(carryoverAmount({ ...fund, carryoverPolicy: 'full' }, 40_000)).toBe(40_000)
    expect(carryoverAmount({ ...fund, carryoverPolicy: 'none' }, 40_000)).toBe(0)
  })
})

describe('baseline engine', () => {
  it('excludes promoted weeks so the baseline does not chase the promotion', () => {
    const history = Array.from({ length: 80 }, (_, i) => ({
      weekStart: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`,
      units: i >= 60 && i < 64 ? 3000 : 1000, // a big promo in weeks 60-63
      promoted: i >= 60 && i < 64,
    }))
    const points = computeBaselines(history)
    const duringPromo = points[62]
    // Baseline stays near the un-promoted level rather than being dragged up.
    expect(duringPromo.baselineUnits).toBeLessThan(1400)
    expect(duringPromo.incrementalUnits).toBeGreaterThan(1600)
    expect(duringPromo.method).toBe('52w_moving_avg')
  })

  it('says so when it lacks clean history instead of pretending', () => {
    const points = computeBaselines([{ weekStart: '2025-01-01', units: 900, promoted: false }])
    expect(points[0].method).toBe('seasonal_index')
  })
})

describe('gross-to-net waterfall', () => {
  it('walks gross sales down to gross margin', () => {
    const w = buildWaterfall({
      grossSales: 1_000_000, offInvoice: 90_000, billBackScanBack: 60_000,
      fixedFunds: 25_000, otherDeductions: 15_000, cogs: 480_000,
    })
    expect(w.netInvoiceSales).toBe(910_000)
    expect(w.netSales).toBe(810_000)
    expect(w.grossMargin).toBe(330_000)
    expect(w.totalTradeSpend).toBe(190_000)
    expect(w.tradeRate).toBeCloseTo(0.19, 6)
    // Every decrease step must join up with the next step's start.
    for (let i = 1; i < w.steps.length; i++) {
      if (w.steps[i].kind === 'decrease') expect(w.steps[i].start).toBe(w.steps[i - 1].end)
    }
  })
})

describe('deduction matching', () => {
  const customers: Customer[] = [
    { id: 'chain', orgId: 'o', parentId: null, level: 'chain', name: 'Chain', code: 'CH', channel: 'grocery', externalIds: {} },
    { id: 'banner', orgId: 'o', parentId: 'chain', level: 'banner', name: 'Banner', code: 'BN', channel: 'grocery', externalIds: {} },
    { id: 'other', orgId: 'o', parentId: null, level: 'chain', name: 'Other', code: 'OT', channel: 'grocery', externalIds: {} },
  ]
  // Real catalog stores one row per node in the family, so the fixture does too.
  const reasonCodes: ReasonCode[] = ['chain', 'banner'].flatMap((customerId, i) => [
    { id: `r${i}a`, orgId: 'o', customerId, externalCode: '501', externalLabel: 'Promo', canonical: 'trade_promotion' as const },
    { id: `r${i}b`, orgId: 'o', customerId, externalCode: '240', externalLabel: 'Shortage', canonical: 'shortage' as const },
  ])
  const promo: Promotion = {
    id: 'pr1', orgId: 'o', code: 'PRM-CH-0001', name: 'Test promo', customerId: 'chain',
    status: 'closed', buyStart: '2026-04-01', buyEnd: '2026-04-20', shipStart: '2026-04-15',
    shipEnd: '2026-05-05', performStart: '2026-05-01', performEnd: '2026-05-28',
    fundId: 'f1', ownerId: 'u1', createdAt: '2026-03-01',
  }
  const ctx = {
    customers, reasonCodes,
    claimableSpendByPromotion: new Map([['pr1', 10_000]]),
    tacticsByPromotion: new Map([['pr1', ['scan_back']]]),
    brandsByPromotion: new Map([['pr1', ['B']]]),
  }
  const base: Deduction = {
    id: 'd1', orgId: 'o', docNumber: 'CH-CB-001', customerId: 'banner', amount: 10_000,
    receivedDate: '2026-06-20', externalReasonCode: '501', brandHint: 'B',
    description: 'Promotional allowance', status: 'open',
  }

  it('scores a clean trade deduction as high confidence', () => {
    const [top] = matchDeduction(base, [promo], ctx)
    expect(top.confidence).toBeGreaterThan(0.88)
    expect(top.warnings).toHaveLength(0)
  })

  it('does not penalise the common case of no promotion reference', () => {
    // Most retailers never cite our promo code. A clean deduction must still
    // clear auto-accept without it, or the review queue never empties.
    const withoutRef = matchDeduction(base, [promo], ctx)[0]
    const withRef = matchDeduction(
      { ...base, description: 'Settlement for PRM-CH-0001' }, [promo], ctx,
    )[0]
    expect(withoutRef.confidence).toBeGreaterThanOrEqual(DEFAULT_MATCH_OPTIONS.autoAcceptThreshold)
    expect(withRef.confidence).toBeGreaterThan(withoutRef.confidence)
    expect(withRef.confidence).toBeLessThanOrEqual(1)
  })

  it('gives an exact customer match full credit and flags a hierarchy match', () => {
    const exact = matchDeduction({ ...base, customerId: 'chain' }, [promo], ctx)[0]
    const viaHierarchy = matchDeduction(base, [promo], ctx)[0]
    expect(exact.confidence).toBe(1)
    expect(exact.confidence).toBeGreaterThan(viaHierarchy.confidence)
    expect(viaHierarchy.reasons.join(' ')).toContain('customer hierarchy')
  })

  it('never proposes a promotion from a different customer family', () => {
    const wrong = matchDeduction({ ...base, customerId: 'other' }, [promo], ctx)
    expect(wrong).toHaveLength(0)
  })

  it('drops confidence and explains itself on a partial claim', () => {
    const [top] = matchDeduction({ ...base, amount: 4_000 }, [promo], ctx)
    expect(top.confidence).toBeLessThan(0.88)
    expect(top.reasons.join(' ')).toContain('Partial claim')
  })

  it('calls a non-trade reason code likely invalid, not merely uncertain', () => {
    const candidates = matchDeduction({ ...base, externalReasonCode: '240' }, [promo], ctx)
    const [top] = candidates
    expect(top.warnings.map((w) => w.code)).toContain('non_trade_reason')
    expect(top.warnings.find((w) => w.code === 'non_trade_reason')!.invalidates).toBe(true)
    expect(disposition(candidates)).toBe('likely_invalid')
  })

  it('treats an unmapped reason code as hygiene, not invalidity', () => {
    const candidates = matchDeduction({ ...base, externalReasonCode: 'ZZZ' }, [promo], ctx)
    const [top] = candidates
    expect(top.warnings.map((w) => w.code)).toContain('unmapped_reason')
    expect(top.warnings.every((w) => !w.invalidates)).toBe(true)
    // Still needs a human, but it is not a recovery claim on its own.
    expect(disposition(candidates)).toBe('needs_review')
  })

  it('flags a plausible over-claim on an otherwise well-evidenced event', () => {
    const candidates = matchDeduction({ ...base, amount: 15_000 }, [promo], ctx)
    expect(candidates[0].warnings.map((w) => w.code)).toContain('over_claim')
    expect(disposition(candidates)).toBe('likely_invalid')
  })

  it('does not accuse the customer when the amount is simply nowhere near', () => {
    // 9x the planned spend is far likelier to be the wrong promotion than a
    // duplicate claim, so it lowers confidence rather than raising an accusation.
    const candidates = matchDeduction({ ...base, amount: 90_000 }, [promo], ctx)
    expect(candidates[0]?.warnings.map((w) => w.code) ?? []).not.toContain('over_claim')
    expect(candidates[0]?.confidence ?? 0).toBeLessThan(0.88)
  })

  it('flags a chargeback against an off-invoice-only promotion', () => {
    const candidates = matchDeduction(base, [promo], {
      ...ctx,
      tacticsByPromotion: new Map([['pr1', ['off_invoice']]]),
    })
    expect(candidates[0].warnings.map((w) => w.code)).toContain('off_invoice_only')
    expect(disposition(candidates)).toBe('likely_invalid')
  })

  it('never offers to settle more than the event can owe', () => {
    // Over-claim: settle at most the claimable spend, not the full deduction.
    const over = matchDeduction({ ...base, amount: 15_000 }, [promo], ctx)[0]
    expect(over.amount).toBe(10_000)

    // Nothing claimable means nothing to settle — not "accept the lot".
    const nothingClaimable = matchDeduction(base, [promo], {
      ...ctx,
      claimableSpendByPromotion: new Map([['pr1', 0]]),
      tacticsByPromotion: new Map([['pr1', ['off_invoice']]]),
    })
    for (const c of nothingClaimable) expect(c.amount).toBe(0)
  })

  it('dispositions a clean deduction as auto-matched', () => {
    expect(disposition(matchDeduction(base, [promo], ctx))).toBe('auto_matched')
  })

  it('dispositions an out-of-window deduction as no match', () => {
    expect(disposition(matchDeduction({ ...base, receivedDate: '2027-06-20' }, [promo], ctx)))
      .toBe('no_match')
  })

  it('finds nothing for a deduction arriving a year late', () => {
    expect(matchDeduction({ ...base, receivedDate: '2027-06-20' }, [promo], ctx)).toHaveLength(0)
  })

  it('scores a deduction that predates the event lower the earlier it arrives', () => {
    // Regression: the before-window branch once negated its day count, so the
    // score grew without bound the earlier the deduction landed.
    const justBefore = matchDeduction({ ...base, receivedDate: '2026-04-25' }, [promo], ctx)
    const wellBefore = matchDeduction({ ...base, receivedDate: '2026-01-10' }, [promo], ctx)
    expect(justBefore[0].confidence).toBeLessThan(1)
    expect(wellBefore).toHaveLength(0) // outside the grace period entirely
  })

  it('never returns a confidence above 1 for any input', () => {
    const dates = ['2025-06-01', '2026-01-10', '2026-04-25', '2026-05-14', '2026-06-20', '2026-09-01']
    const amounts = [1, 500, 9_800, 10_000, 10_400, 25_000, 900_000]
    for (const receivedDate of dates) {
      for (const amount of amounts) {
        for (const description of ['Promotional allowance', 'Settlement PRM-CH-0001']) {
          for (const c of matchDeduction({ ...base, receivedDate, amount, description }, [promo], ctx)) {
            expect(c.confidence).toBeLessThanOrEqual(1)
            expect(c.confidence).toBeGreaterThanOrEqual(0)
          }
        }
      }
    }
  })

  it('does not treat digits inside an invoice number as a promotion reference', () => {
    // Regression: a 4-character tail match hit random invoice digits and
    // manufactured confident false positives.
    const coincidental = matchDeduction(
      { ...base, invoiceRef: 'INV-40001', description: 'Promotional allowance' }, [promo], ctx,
    )[0]
    const plain = matchDeduction({ ...base, invoiceRef: undefined }, [promo], ctx)[0]
    expect(coincidental.confidence).toBe(plain.confidence)
    expect(coincidental.reasons.join(' ')).toContain('No promotion reference')
  })

  it('uses product scope to separate a real event from a lookalike', () => {
    // Two promotions identical on customer, date and amount — only the brand differs.
    const lookalike: Promotion = { ...promo, id: 'pr2', code: 'PRM-CH-0002', name: 'Lookalike' }
    const ctx2 = {
      ...ctx,
      claimableSpendByPromotion: new Map([['pr1', 10_000], ['pr2', 10_000]]),
      tacticsByPromotion: new Map([['pr1', ['scan_back']], ['pr2', ['scan_back']]]),
      brandsByPromotion: new Map([['pr1', ['B']], ['pr2', ['Other Brand']]]),
    }
    const [first, second] = matchDeduction(base, [promo, lookalike], ctx2)
    expect(first.promotionId).toBe('pr1')
    expect(first.confidence).toBeGreaterThan(second?.confidence ?? 0)
  })

  it('walks the customer hierarchy in both directions', () => {
    const fam = customerFamily('banner', customers)
    expect([...fam].sort()).toEqual(['banner', 'chain'])
    expect(customerFamily('chain', customers).has('banner')).toBe(true)
  })

  it('respects a tightened amount tolerance', () => {
    const loose = matchDeduction({ ...base, amount: 9_300 }, [promo], ctx)[0]
    const tight = matchDeduction({ ...base, amount: 9_300 }, [promo], ctx, {
      ...DEFAULT_MATCH_OPTIONS, amountTolerance: 0.01,
    })[0]
    expect(tight.confidence).toBeLessThan(loose.confidence)
  })

  it('summarises recovery economics', () => {
    const r = summariseRecovery(
      [
        { ...base, id: 'a', amount: 1000, status: 'settled' },
        { ...base, id: 'b', amount: 500, status: 'open' },
      ],
      [{ deductionId: 'a', claimedAmount: 1000, recoveredAmount: 600, status: 'partial' }],
      new Set(['a']),
    )
    expect(r.totalDeducted).toBe(1500)
    expect(r.unmatchedAmount).toBe(500)
    expect(r.winRate).toBe(0.6)
    expect(r.invalidRate).toBeCloseTo(1 / 3, 4)
  })
})

describe('fiscal calendar', () => {
  it('builds a 4-4-5 year with 52 weeks in twelve periods', () => {
    const cal = buildFiscalCalendar('2024-01-01', 52, '4-4-5', 2024)
    expect(cal).toHaveLength(52)
    expect(cal[0].label).toBe('FY24 P01 W1')
    expect(cal[3].period).toBe(1)
    expect(cal[4].period).toBe(2) // 5th week starts period 2
    expect(cal[8].period).toBe(3)
    expect(cal[12].period).toBe(3) // period 3 is five weeks long, so week 13 is still P3
    expect(cal[13].period).toBe(4)
    expect(cal[51].period).toBe(12)
  })

  it('rolls into the next fiscal year', () => {
    const cal = buildFiscalCalendar('2024-01-01', 60, '4-4-5', 2024)
    expect(cal[52].fiscalYear).toBe(2025)
    expect(cal[52].label).toBe('FY25 P01 W1')
  })

  it('supports 13-period calendars', () => {
    const cal = buildFiscalCalendar('2024-01-01', 52, '13-period', 2024)
    expect(cal[51].period).toBe(13)
  })

  it('anchors weeks to Monday', () => {
    expect(weekStartOf('2026-07-30')).toBe('2026-07-27') // a Thursday → that Monday
    expect(weekStartOf('2026-07-27')).toBe('2026-07-27')
  })

  it('detects overlapping ranges for conflict detection', () => {
    expect(rangesOverlap('2026-01-01', '2026-01-14', '2026-01-10', '2026-01-20')).toBe(true)
    expect(rangesOverlap('2026-01-01', '2026-01-09', '2026-01-10', '2026-01-20')).toBe(false)
  })

  it('buckets deduction age', () => {
    expect(ageBucket(0)).toBe('0-30')
    expect(ageBucket(31)).toBe('31-60')
    expect(ageBucket(200)).toBe('120+')
  })
})
