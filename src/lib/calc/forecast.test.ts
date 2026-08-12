import { describe, expect, it } from 'vitest'

import {
  applyRecommendation, bulkScaleDriver, buildForecastAccuracy, buildForecastPeriods,
  buildForecastTree, buildRecommendations, forecastUnits, lineUnits, setDriver,
  summariseRecommendations, totalsByPeriod,
  type ActualSignal, type ForecastLine, type ForecastPeriod, type TreeContext,
} from './forecast'
import { buildFiscalCalendar } from '../fiscal'

const CTX: TreeContext = {
  customerName: (id) => ({ chainA: 'Chain A', chainB: 'Chain B', bannerA: 'Banner A' }[id] ?? id),
  customerParent: (id) => (id === 'bannerA' ? 'chainA' : null),
  channelOf: (id) => (id === 'chainB' ? 'club' : 'grocery'),
  productGroupName: (id) => ({ g1: 'Chocolate', g2: 'Bars' }[id] ?? id),
  brandOfGroup: (id) => (id === 'g1' ? 'Summit Trail' : 'Golden Hour'),
}

function period(key: string, weeks: number, isPast = false): ForecastPeriod {
  return {
    key, label: key, sublabel: 'Jan 2026', fiscalYear: 2026, period: 1,
    weeks, start: '2026-01-05', end: '2026-02-01', isPast,
  }
}

function line(id: string, over: Partial<ForecastLine> = {}): ForecastLine {
  return {
    id, orgId: 'o', customerId: 'chainA', productGroupId: 'g1',
    periods: {
      P1: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 },
      P2: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1.2 },
    },
    overrides: {},
    ...over,
  }
}

describe('forecast periods', () => {
  it('carries the week count, because 4-4-5 periods are not equal length', () => {
    const cal = buildFiscalCalendar('2026-01-05', 52, '4-4-5', 2026)
    const periods = buildForecastPeriods(cal, '2026-06-01')
    expect(periods).toHaveLength(12)
    expect(periods.map((p) => p.weeks)).toEqual([4, 4, 5, 4, 4, 5, 4, 4, 5, 4, 4, 5])
    expect(periods[0].key).toBe('FY26 P01')
  })

  it('marks periods that have already closed', () => {
    const cal = buildFiscalCalendar('2026-01-05', 52, '4-4-5', 2026)
    const periods = buildForecastPeriods(cal, '2026-06-01')
    expect(periods[0].isPast).toBe(true)
    expect(periods[11].isPast).toBe(false)
  })
})

describe('the forecast formula', () => {
  it('multiplies stores × velocity × seasonality × weeks', () => {
    expect(forecastUnits({ storesSelling: 164, baseVelocityWeekly: 4.5, seasonality: 1 }, 4))
      .toBe(2952)
  })

  it('scales with the week count — a 5-week period sells 25% more', () => {
    const d = { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 }
    expect(forecastUnits(d, 5) / forecastUnits(d, 4)).toBeCloseTo(1.25, 6)
  })

  it('applies seasonality multiplicatively', () => {
    const base = { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 }
    const peak = { ...base, seasonality: 1.4 }
    expect(forecastUnits(peak, 4)).toBeCloseTo(forecastUnits(base, 4) * 1.4, 6)
  })

  it('returns zero for a line with no drivers in that period', () => {
    expect(lineUnits(line('a'), period('P9', 4))).toBe(0)
  })
})

describe('hierarchy roll-up', () => {
  const lines = [
    line('a', { customerId: 'chainA', productGroupId: 'g1' }),
    line('b', { customerId: 'chainA', productGroupId: 'g2' }),
    line('c', { customerId: 'chainB', productGroupId: 'g1' }),
  ]
  const periods = [period('P1', 4), period('P2', 5)]

  it('sums children into every parent level', () => {
    const tree = buildForecastTree(lines, periods, ['customer', 'productGroup'], CTX)
    const chainA = tree.find((n) => n.label === 'Chain A')!
    expect(chainA.children).toHaveLength(2)
    const childSum = chainA.children.reduce((a, c) => a + c.units.P1, 0)
    expect(chainA.units.P1).toBeCloseTo(childSum, 6)
    // 100 stores x 2 cs x 1.0 x 4 weeks = 800 per line, two lines
    expect(chainA.units.P1).toBe(1600)
  })

  it('re-pivots to a different level order without touching drivers', () => {
    const byCustomer = buildForecastTree(lines, periods, ['customer', 'productGroup'], CTX)
    const byBrand = buildForecastTree(lines, periods, ['brand', 'customer'], CTX)
    const totalA = byCustomer.reduce((a, n) => a + n.total, 0)
    const totalB = byBrand.reduce((a, n) => a + n.total, 0)
    // Same underlying lines, so the grand total is invariant to the pivot.
    expect(totalA).toBeCloseTo(totalB, 6)
    expect(byBrand.map((n) => n.label).sort()).toEqual(['Golden Hour', 'Summit Trail'])
  })

  it('groups by channel when asked', () => {
    const tree = buildForecastTree(lines, periods, ['channel', 'customer'], CTX)
    expect(tree.map((n) => n.label).sort()).toEqual(['Club', 'Grocery'])
  })

  it('exposes drivers only where a node resolves to exactly one line', () => {
    const tree = buildForecastTree(lines, periods, ['customer', 'productGroup'], CTX)
    const chainA = tree.find((n) => n.label === 'Chain A')!
    // Two product groups roll into Chain A, so its drivers are ambiguous.
    expect(chainA.driverLineId).toBeUndefined()
    // Each leaf is a single line and can be edited.
    expect(chainA.children.every((c) => c.driverLineId)).toBe(true)
  })

  it('rolls a banner up under its parent chain', () => {
    const withBanner = [...lines, line('d', { customerId: 'bannerA', productGroupId: 'g1' })]
    const tree = buildForecastTree(withBanner, periods, ['customer'], CTX)
    const chainA = tree.find((n) => n.label === 'Chain A')!
    // a + b + d all resolve to chainA.
    expect(chainA.lineIds.length).toBe(3)
  })

  it('totals every period across the roots', () => {
    const tree = buildForecastTree(lines, periods, ['customer', 'productGroup'], CTX)
    const totals = totalsByPeriod(tree, periods)
    expect(totals.P1).toBe(2400) // 3 lines x 800
    expect(totals.P2).toBe(3600) // 3 x 100 x 2 x 1.2 x 5
  })
})

describe('editing drivers', () => {
  it('records an override so a recompute cannot silently discard planner judgement', () => {
    const edited = setDriver(line('a'), 'P1', 'baseVelocityWeekly', 3)
    expect(edited.periods.P1.baseVelocityWeekly).toBe(3)
    expect(edited.overrides.P1.baseVelocityWeekly).toBe(true)
    expect(edited.overrides.P2).toBeUndefined()
  })

  it('never lets a driver go negative', () => {
    expect(setDriver(line('a'), 'P1', 'storesSelling', -50).periods.P1.storesSelling).toBe(0)
  })

  it('clamps seasonality to a sane band', () => {
    expect(setDriver(line('a'), 'P1', 'seasonality', 99).periods.P1.seasonality).toBe(5)
  })

  it('does not mutate the original line', () => {
    const original = line('a')
    setDriver(original, 'P1', 'baseVelocityWeekly', 9)
    expect(original.periods.P1.baseVelocityWeekly).toBe(2)
  })

  it('bulk-scales only the selected lines and periods', () => {
    const lines = [line('a'), line('b')]
    const out = bulkScaleDriver(lines, new Set(['a']), ['P1'], 'baseVelocityWeekly', 1.1)
    expect(out[0].periods.P1.baseVelocityWeekly).toBeCloseTo(2.2, 4)
    expect(out[0].periods.P2.baseVelocityWeekly).toBe(2) // untouched period
    expect(out[1].periods.P1.baseVelocityWeekly).toBe(2) // untouched line
  })
})

describe('forecast accuracy', () => {
  // line() defaults: P1 = 100 stores × 2 cs × 1.0 → 800 units over 4 weeks,
  // P2 = 100 × 2 × 1.2 → 1200 units over 5 weeks.
  const p1 = period('P1', 4, true)
  const p2 = period('P2', 5, true)

  it('scores a perfect lock as 100% with zero bias', () => {
    const a = buildForecastAccuracy([line('a', { lockedUnits: { P1: 800 } })], [p1])
    expect(a.periods[0].forecastUnits).toBe(800)
    expect(a.periods[0].actualUnits).toBe(800)
    expect(a.periods[0].accuracy).toBe(1)
    expect(a.weightedAccuracy).toBe(1)
    expect(a.bias).toBe(0)
  })

  it('scores a 10% over-forecast as 90% accuracy and +10% bias', () => {
    const a = buildForecastAccuracy([line('a', { lockedUnits: { P1: 880 } })], [p1])
    expect(a.periods[0].accuracy).toBeCloseTo(0.9, 6)
    expect(a.bias).toBeCloseTo(0.1, 6)
  })

  it('does NOT let opposite misses cancel — accuracy is accumulated per line', () => {
    const a = buildForecastAccuracy(
      [
        line('a', { lockedUnits: { P1: 880 } }), // +10%
        line('b', { lockedUnits: { P1: 720 } }), // −10%
      ],
      [p1],
    )
    // Netted, the plan looks perfect; measured line by line it missed by 10%.
    expect(a.periods[0].forecastUnits).toBe(1600)
    expect(a.periods[0].actualUnits).toBe(1600)
    expect(a.periods[0].accuracy).toBeCloseTo(0.9, 6)
    expect(a.bias).toBeCloseTo(0, 6)
  })

  it('excludes lines that carry no locked snapshot for the period', () => {
    const a = buildForecastAccuracy(
      [line('a', { lockedUnits: { P1: 800 } }), line('b')],
      [p1],
    )
    // Line b never had a locked plan — scoring it would invent a miss.
    expect(a.periods[0].actualUnits).toBe(800)
    expect(a.periods[0].accuracy).toBe(1)
  })

  it('skips open periods entirely — there is nothing to score yet', () => {
    const a = buildForecastAccuracy(
      [line('a', { lockedUnits: { P1: 800, P2: 1200 } })],
      [p1, { ...p2, isPast: false }],
    )
    expect(a.periods).toHaveLength(1)
    expect(a.periods[0].key).toBe('P1')
  })

  it('returns null accuracy when no line was locked for the period', () => {
    const a = buildForecastAccuracy([line('a')], [p1])
    expect(a.periods[0].accuracy).toBeNull()
    expect(a.weightedAccuracy).toBeNull()
    expect(a.bias).toBeNull()
  })

  it('floors accuracy at zero rather than reporting a negative percentage', () => {
    const a = buildForecastAccuracy([line('a', { lockedUnits: { P1: 2000 } })], [p1])
    expect(a.periods[0].accuracy).toBe(0)
  })

  it('weights the summary by actual volume, not by period count', () => {
    const a = buildForecastAccuracy(
      [line('a', { lockedUnits: { P1: 720, P2: 1200 } })], // P1 misses 10%, P2 perfect
      [p1, p2],
    )
    // 80 units missed of 2,000 actual — not the unweighted mean of 90% and 100%.
    expect(a.weightedAccuracy).toBeCloseTo(1 - 80 / 2000, 6)
    expect(a.bias).toBeCloseTo(-80 / 2000, 6)
  })
})

describe('recommendations', () => {
  const periods = [period('P1', 4, true), period('P2', 4), period('P3', 4)]
  const base = line('a', {
    periods: {
      P1: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 },
      P2: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 },
      P3: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 },
    },
  })

  const signal = (over: Partial<ActualSignal> = {}): Map<string, ActualSignal> =>
    new Map([['a', {
      lineId: 'a', actualVelocityWeekly: 2, actualStores: 100,
      sampleWeeks: 13, ...over,
    }]])

  it('stays quiet when the drivers agree with actuals', () => {
    expect(buildRecommendations([base], periods, signal())).toHaveLength(0)
  })

  it('flags a forecast running above recent actuals', () => {
    const recs = buildRecommendations([base], periods, signal({ actualVelocityWeekly: 1.5 }))
    const velocity = recs.filter((r) => r.field === 'baseVelocityWeekly')
    expect(velocity.length).toBeGreaterThan(0)
    expect(velocity[0].kind).toBe('velocity_above_actual')
    expect(velocity[0].urgency).toBe('high') // 33% drift
    expect(velocity[0].suggestedValue).toBe(1.5)
    expect(velocity[0].impactUnits).toBeLessThan(0) // forecast comes down
  })

  it('grades a small drift as medium rather than high', () => {
    const recs = buildRecommendations([base], periods, signal({ actualVelocityWeekly: 1.8 }))
    expect(recs.find((r) => r.field === 'baseVelocityWeekly')?.urgency).toBe('medium')
  })

  it('never critiques a closed period', () => {
    const recs = buildRecommendations([base], periods, signal({ actualVelocityWeekly: 1 }))
    expect(recs.every((r) => r.periodKey !== 'P1')).toBe(true)
  })

  it('respects a planner override instead of nagging about it', () => {
    const overridden = { ...base, overrides: { P2: { baseVelocityWeekly: true as const } } }
    const recs = buildRecommendations([overridden], periods, signal({ actualVelocityWeekly: 1 }))
    expect(recs.some((r) => r.periodKey === 'P2' && r.field === 'baseVelocityWeekly')).toBe(false)
    expect(recs.some((r) => r.periodKey === 'P3' && r.field === 'baseVelocityWeekly')).toBe(true)
  })

  it('will not act on a thin sample', () => {
    expect(buildRecommendations([base], periods, signal({
      actualVelocityWeekly: 1, sampleWeeks: 3,
    }))).toHaveLength(0)
  })

  it('flags distribution drift', () => {
    const recs = buildRecommendations([base], periods, signal({ actualStores: 130 }))
    const stores = recs.find((r) => r.field === 'storesSelling')
    expect(stores?.kind).toBe('distribution_gain')
    expect(stores?.suggestedValue).toBe(130)
    expect(stores?.impactUnits).toBeGreaterThan(0)
  })

  it('reports each drifting driver ONCE per line, not once per open period', () => {
    // A drifting velocity drifts in every open period. Reporting all of them
    // triples the queue while saying the same thing three times.
    const recs = buildRecommendations([base], periods, signal({ actualVelocityWeekly: 1.4 }))
    const velocity = recs.filter((r) => r.lineId === 'a' && r.field === 'baseVelocityWeekly')
    expect(velocity).toHaveLength(1)
  })

  it('keeps the highest-impact period when collapsing duplicates', () => {
    const uneven = line('a', {
      periods: {
        P1: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 },
        P2: { storesSelling: 100, baseVelocityWeekly: 2, seasonality: 1 },
        P3: { storesSelling: 400, baseVelocityWeekly: 2, seasonality: 1 },
      },
    })
    const recs = buildRecommendations([uneven], periods, signal({ actualVelocityWeekly: 1.4 }))
    // P3 carries 4x the stores, so it is the period worth starting with.
    expect(recs.find((r) => r.field === 'baseVelocityWeekly')?.periodKey).toBe('P3')
  })

  it('sorts high urgency first, then by impact', () => {
    const recs = buildRecommendations([base], periods, signal({
      actualVelocityWeekly: 1.4, actualStores: 112,
    }))
    for (let i = 1; i < recs.length; i++) {
      const rank = { high: 0, medium: 1, low: 2 }
      expect(rank[recs[i - 1].urgency]).toBeLessThanOrEqual(rank[recs[i].urgency])
    }
  })

  it('applying a recommendation moves the driver and clears the finding', () => {
    const recs = buildRecommendations([base], periods, signal({ actualVelocityWeekly: 1.5 }))
    const target = recs.find((r) => r.field === 'baseVelocityWeekly')!
    const after = applyRecommendation([base], target)
    expect(after[0].periods[target.periodKey].baseVelocityWeekly).toBe(1.5)
    // Recomputing against the same signal no longer raises it for that period.
    const again = buildRecommendations(after, periods, signal({ actualVelocityWeekly: 1.5 }))
    expect(again.some((r) => r.id === target.id)).toBe(false)
  })

  it('summarises the queue', () => {
    const recs = buildRecommendations([base], periods, signal({ actualVelocityWeekly: 1.5 }))
    const s = summariseRecommendations(recs)
    expect(s.high + s.medium + s.low).toBe(recs.length)
    expect(s.netImpactUnits).toBeLessThan(0)
  })
})
