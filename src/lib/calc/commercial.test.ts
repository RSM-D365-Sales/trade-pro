import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ATTENTION, buildCommercialFacts, caseFillRate, claimedSpendByCell,
  daysSalesOutstanding, findAccountSignals, impliedCasesOrdered, median, rankReps,
  rollup, rollupBy, spreadSpendByWeek, type AccountInput, type CommercialFact,
} from './commercial'
import type { Product, Promotion, PromotionLine, SalesFact } from '../../data/types'
import { computePromotion } from './promotion'

const fact = (over: Partial<CommercialFact> = {}): CommercialFact => ({
  chainId: 'c1', productId: 'p1', weekStart: '2026-01-05',
  units: 100, promotedUnits: 0, grossSales: 4000, offInvoice: 260,
  claimedSpend: 0, cogs: 2200, ...over,
})

describe('net sales has exactly one definition', () => {
  it('takes both invoice allowances and claimed money off gross', () => {
    const r = rollup([fact({ claimedSpend: 340 })])
    expect(r.tradeSpend).toBe(600)
    expect(r.netSales).toBe(3400)
    expect(r.grossProfit).toBe(1200)
    expect(r.grossMarginPct).toBeCloseTo(1200 / 3400, 6)
    expect(r.tradeRate).toBeCloseTo(600 / 4000, 6)
  })

  it('reports per-case economics and deal share off the same cells', () => {
    const r = rollup([
      fact({ units: 100, promotedUnits: 30 }),
      fact({ units: 100, promotedUnits: 0, weekStart: '2026-01-12' }),
    ])
    expect(r.units).toBe(200)
    expect(r.dealShare).toBeCloseTo(0.15, 6)
    expect(r.netPricePerCase).toBeCloseTo(r.netSales / 200, 6)
    expect(r.gpPerCase).toBeCloseTo(r.grossProfit / 200, 6)
  })

  it('never divides by zero on an empty scope', () => {
    const r = rollup([])
    expect(r.netSales).toBe(0)
    expect(r.grossMarginPct).toBeNull()
    expect(r.dealShare).toBeNull()
  })

  it('rolls up by any key without losing money', () => {
    const facts = [
      fact({ chainId: 'c1' }), fact({ chainId: 'c2' }), fact({ chainId: 'c2' }),
    ]
    const byChain = rollupBy(facts, (f) => f.chainId)
    expect(byChain.size).toBe(2)
    const total = [...byChain.values()].reduce((a, r) => a + r.netSales, 0)
    expect(total).toBeCloseTo(rollup(facts).netSales, 4)
  })

  it('skips rows whose key does not resolve rather than bucketing them as null', () => {
    const byKey = rollupBy([fact(), fact({ productId: 'p2' })], (f) =>
      f.productId === 'p1' ? 'known' : null,
    )
    expect([...byKey.keys()]).toEqual(['known'])
  })
})

describe('straight-lining claimed spend', () => {
  it('splits an event evenly across the weeks it was on shelf', () => {
    const m = spreadSpendByWeek([
      { key: 'k', start: '2026-01-05', end: '2026-01-25', spend: 3000 },
    ])
    expect(m.size).toBe(3)
    expect(m.get('k|2026-01-05')).toBeCloseTo(1000, 4)
    expect(m.get('k|2026-01-19')).toBeCloseTo(1000, 4)
  })

  it('conserves the total no matter how the window falls', () => {
    const events = [
      { key: 'a', start: '2026-02-03', end: '2026-03-01', spend: 1234.56 },
      { key: 'b', start: '2026-02-10', end: '2026-02-11', spend: 800 },
      { key: 'a', start: '2026-02-10', end: '2026-02-16', spend: 500 },
    ]
    const total = [...spreadSpendByWeek(events).values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(2534.56, 2)
  })

  it('puts money in the first week when the dates are inverted, never nowhere', () => {
    const m = spreadSpendByWeek([{ key: 'k', start: '2026-03-09', end: '2026-03-02', spend: 900 }])
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(900, 4)
  })

  it('ignores zero-spend events instead of emitting empty cells', () => {
    expect(spreadSpendByWeek([{ key: 'k', start: '2026-01-05', end: '2026-01-11', spend: 0 }]).size)
      .toBe(0)
  })
})

describe('joining shipments to allocated spend', () => {
  const product: Product = {
    id: 'p1', orgId: 'o', sku: 'S1', name: 'Thing', category: 'Snacks', brand: 'B',
    subbrand: 'SB', casePack: 12, baseUom: 'CS', listPrice: 40, cogs: 22,
    netWeightLb: 6, status: 'active',
  }
  const promo: Promotion = {
    id: 'pr1', orgId: 'o', code: 'PR1', name: 'Deal', customerId: 'banner1',
    status: 'closed', buyStart: '2026-01-01', buyEnd: '2026-01-10',
    shipStart: '2026-01-01', shipEnd: '2026-01-10',
    performStart: '2026-01-05', performEnd: '2026-01-18',
    fundId: 'f1', ownerId: 'u1', createdAt: '2025-12-01',
  }
  const lines: PromotionLine[] = [
    {
      id: 'l1', orgId: 'o', promotionId: 'pr1', productId: 'p1', tactic: 'bill_back',
      rateType: 'per_case', rate: 3, plannedBaselineUnits: 400, plannedLiftUnits: 200,
    },
    {
      id: 'l2', orgId: 'o', promotionId: 'pr1', productId: 'p1', tactic: 'off_invoice',
      rateType: 'per_case', rate: 2, plannedBaselineUnits: 400, plannedLiftUnits: 200,
    },
  ]
  const rootOf = () => 'chain1'
  const economics = new Map([['pr1', computePromotion(lines, new Map([['p1', product]]))]])

  it('allocates claimed money and leaves off-invoice money alone', () => {
    const m = claimedSpendByCell([promo], new Map([['pr1', lines]]), economics, rootOf)
    // 600 cases × $3 bill-back = $1,800 over two on-shelf weeks. The $1,200 of
    // off-invoice money is already in the sales facts and must not reappear.
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1800, 4)
    expect(m.get('chain1|p1|2026-01-05')).toBeCloseTo(900, 4)
  })

  it('drops draft and cancelled events — unapproved money is not spent', () => {
    for (const status of ['draft', 'cancelled'] as const) {
      const m = claimedSpendByCell(
        [{ ...promo, status }], new Map([['pr1', lines]]), economics, rootOf,
      )
      expect(m.size).toBe(0)
    }
  })

  it('emits a cell for spend that landed on a week with no shipments', () => {
    const shipments: SalesFact[] = [{
      id: 'sf1', orgId: 'o', customerId: 'banner1', productId: 'p1',
      weekStart: '2026-01-05', units: 500, grossSales: 20000,
      offInvoiceDiscount: 1000, cogs: 11000, promotionId: 'pr1',
    }]
    const claimed = new Map([
      ['chain1|p1|2026-01-05', 900],
      ['chain1|p1|2026-01-12', 900], // sold in, never sold through
    ])
    const facts = buildCommercialFacts(shipments, claimed, rootOf)
    expect(facts.length).toBe(2)
    const orphan = facts.find((f) => f.weekStart === '2026-01-12')!
    expect(orphan.units).toBe(0)
    expect(orphan.claimedSpend).toBe(900)
    // Money that left the business still comes off net sales.
    expect(rollup(facts).netSales).toBeCloseTo(20000 - 1000 - 1800, 4)
  })

  it('counts promoted cases only where a promotion is named', () => {
    const shipments: SalesFact[] = [
      {
        id: 'a', orgId: 'o', customerId: 'b', productId: 'p1', weekStart: '2026-01-05',
        units: 300, grossSales: 12000, offInvoiceDiscount: 0, cogs: 6600, promotionId: 'pr1',
      },
      {
        id: 'b', orgId: 'o', customerId: 'b', productId: 'p2', weekStart: '2026-01-05',
        units: 700, grossSales: 28000, offInvoiceDiscount: 0, cogs: 15400,
      },
    ]
    expect(rollup(buildCommercialFacts(shipments, new Map(), rootOf)).dealShare)
      .toBeCloseTo(0.3, 6)
  })
})

describe('service and working capital', () => {
  it('scores fill rate and reverses it back to cases ordered', () => {
    expect(caseFillRate(964, 1000)).toBeCloseTo(0.964, 6)
    expect(caseFillRate(10, 0)).toBeNull()
    expect(impliedCasesOrdered(964, 0.964)).toBeCloseTo(1000, 2)
    expect(impliedCasesOrdered(500, 0)).toBe(500)
  })

  it('computes DSO from a window rather than assuming a month', () => {
    // $3.65M a year is $10k a day; $274k of receivables is 27.4 days.
    expect(daysSalesOutstanding(274_000, 3_650_000, 365)).toBeCloseTo(27.4, 1)
    expect(daysSalesOutstanding(100, 0, 365)).toBeNull()
  })
})

describe('accounts needing attention', () => {
  const healthy: AccountInput = {
    customerId: 'c1', name: 'Healthy Co', netSales: 1_000_000,
    netSalesComparable: 980_000, netSalesAnnual: 13_000_000, grossMarginPct: 0.47,
    planNetSales: 990_000, openDeductions: 40_000,
    productGroupsBought: 8, productGroupsAvailable: 9,
  }

  it('stays silent when nothing is wrong', () => {
    expect(findAccountSignals([healthy])).toEqual([])
  })

  it('raises at most one finding per account — the worst one', () => {
    // Down hard, behind plan, thin margin and carrying deductions all at once.
    const bad: AccountInput = {
      ...healthy, customerId: 'c2', name: 'Struggling',
      netSales: 600_000, netSalesComparable: 1_000_000,
      grossMarginPct: 0.3, planNetSales: 1_000_000, openDeductions: 900_000,
    }
    const signals = findAccountSignals([bad])
    expect(signals.length).toBe(1)
    expect(signals[0].customerId).toBe('c2')
  })

  it('ranks a real problem above a cross-sell opportunity', () => {
    const gap: AccountInput = {
      ...healthy, customerId: 'gap', name: 'Narrow', productGroupsBought: 2,
    }
    // Plan tracks the lower run rate, so the only thing wrong here is the
    // year-on-year decline — otherwise this account would trip two rules and
    // the test would be measuring the wrong comparison.
    const decline: AccountInput = {
      ...healthy, customerId: 'down', name: 'Falling',
      netSales: 800_000, netSalesComparable: 1_000_000, planNetSales: 800_000,
    }
    const kinds = findAccountSignals([gap, decline]).map((s) => s.kind)
    expect(kinds[0]).toBe('volume_decline')
    expect(kinds).toContain('assortment_gap')
  })

  it('measures margin against the floor, not against zero', () => {
    const floorBreach = {
      ...healthy, customerId: 'thin', grossMarginPct: DEFAULT_ATTENTION.companyMarginPct - 0.09,
    }
    const justAbove = {
      ...healthy, customerId: 'ok', grossMarginPct: DEFAULT_ATTENTION.companyMarginPct - 0.02,
    }
    const signals = findAccountSignals([floorBreach, justAbove])
    expect(signals.map((s) => s.customerId)).toEqual(['thin'])
    expect(signals[0].kind).toBe('margin_below_floor')
  })

  it('reads deduction exposure against the year, not the window it is viewed in', () => {
    // A balance that built up over months divided by five weeks of sales
    // produces figures like "147% of net sales" and flags every account on the
    // book — one finding type, repeated, which is the failure this panel is
    // supposed to avoid.
    const heavy: AccountInput = {
      ...healthy, customerId: 'heavy', name: 'Carrying claims',
      netSales: 500_000, netSalesComparable: 500_000, planNetSales: 500_000,
      netSalesAnnual: 13_000_000, openDeductions: 700_000,
    }
    const signals = findAccountSignals([heavy])
    expect(signals).toHaveLength(1)
    expect(signals[0].kind).toBe('deduction_exposure')
    expect(signals[0].reference).toBeCloseTo(700_000 / 13_000_000, 6)
    expect(signals[0].reference).toBeLessThan(1) // never a nonsense percentage
  })

  it('flags exposure that is high FOR THIS BOOK, not exposure that merely exists', () => {
    // Every account in a real CPG book carries deductions. Ranking them by
    // absolute exposure just re-sorts the customer list by size.
    const book: AccountInput[] = [3.6, 3.9, 4.1, 7.2].map((rate, i) => ({
      ...healthy,
      customerId: `c${i}`,
      name: `Account ${i}`,
      netSalesAnnual: 10_000_000,
      openDeductions: 10_000_000 * (rate / 100),
    }))
    const companyRate = book.reduce((a, x) => a + x.openDeductions, 0)
      / book.reduce((a, x) => a + x.netSalesAnnual, 0)

    const signals = findAccountSignals([...book], { ...DEFAULT_ATTENTION, companyDeductionRate: companyRate })
    expect(signals.map((s) => s.customerId)).toEqual(['c3'])
  })

  it('caps the list so the panel stays readable', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...healthy, customerId: `c${i}`, name: `Account ${i}`,
      netSales: 500_000, netSalesComparable: 1_000_000,
    }))
    expect(findAccountSignals(many).length).toBe(DEFAULT_ATTENTION.maxRows)
  })

  it('handles a brand-new account with no comparable without crashing', () => {
    const brandNew: AccountInput = {
      ...healthy, customerId: 'new', netSalesComparable: 0, netSalesAnnual: 0, planNetSales: 0,
    }
    expect(() => findAccountSignals([brandNew])).not.toThrow()
  })
})

describe('rep leaderboard', () => {
  const byChain = new Map([
    ['c1', rollup([fact({ chainId: 'c1', grossSales: 10_000, cogs: 4_000, offInvoice: 1_000 })])],
    ['c2', rollup([fact({ chainId: 'c2', grossSales: 30_000, cogs: 12_000, offInvoice: 3_000 })])],
  ])
  const plan = new Map([['c1', 8_000], ['c2', 30_000]])

  it('sums a territory and ranks on gross profit', () => {
    const reps = rankReps(
      [
        { id: 'r1', name: 'One', initials: 'ON', customerIds: ['c1'] },
        { id: 'r2', name: 'Two', initials: 'TW', customerIds: ['c2'] },
        { id: 'r3', name: 'Three', initials: 'TH', customerIds: ['c1', 'c2'] },
      ],
      byChain, plan,
    )
    expect(reps.map((r) => r.repId)).toEqual(['r3', 'r2', 'r1'])
    expect(reps[0].rollup.netSales).toBeCloseTo(36_000, 4)
    expect(reps[2].attainment).toBeCloseTo(9_000 / 8_000, 4)
  })

  it('gives a rep with no plan a null attainment rather than Infinity', () => {
    const reps = rankReps(
      [{ id: 'r1', name: 'One', initials: 'ON', customerIds: ['c1'] }], byChain, new Map(),
    )
    expect(reps[0].attainment).toBeNull()
  })

  it('takes a median that is not skewed by one big territory', () => {
    expect(median([0.1, 0.2, 0.9])).toBeCloseTo(0.2, 6)
    expect(median([0.1, 0.2, 0.3, 0.4])).toBeCloseTo(0.25, 6)
    expect(median([])).toBeNull()
  })
})
