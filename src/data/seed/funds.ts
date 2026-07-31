/**
 * Trade funds and their ledger.
 *
 * Two funds per retailer per fiscal year: an ACCRUAL fund that earns a rate on
 * shipments, and a fixed MDF pot that finance budgets up front. Lump-sum
 * tactics (slotting, listing, MDF, sampling) draw on the fixed pot; volume
 * tactics draw on the accrual fund. That split is how real trade finance works
 * and it is what makes the fund dashboard's over-commitment warnings meaningful.
 */

import { CHAIN_CUSTOMERS, ORG } from '../catalog'
import type {
  FiscalWeek, Fund, FundTransaction, Promotion, SalesFact, TacticCode,
} from '../types'
import { accrualAmount } from '../../lib/calc/funds'
import { n4 } from '../../lib/calc/money'
import { addDays } from '../../lib/fiscal'
import type { Rng } from '../rng'
import { CHAIN_SCALE } from './market'

const ACCRUAL_RATE_BY_CHANNEL: Record<string, number> = {
  mass: 0.092, club: 0.115, grocery: 0.078, natural: 0.058, distributor: 0.064, convenience: 0.05,
}

/** Tactics whose money comes out of the fixed pot rather than the accrual. */
const FIXED_FUND_TACTICS = new Set<TacticCode>(['slotting', 'listing', 'mdf', 'sampling'])

export interface FiscalYearWindow {
  fiscalYear: number
  start: string
  end: string
}

export function fiscalYearWindows(calendar: FiscalWeek[]): FiscalYearWindow[] {
  const byYear = new Map<number, FiscalWeek[]>()
  for (const w of calendar) {
    const arr = byYear.get(w.fiscalYear)
    if (arr) arr.push(w)
    else byYear.set(w.fiscalYear, [w])
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([fiscalYear, weeks]) => ({
      fiscalYear,
      start: weeks[0].weekStart,
      end: addDays(weeks[weeks.length - 1].weekStart, 6),
    }))
}

export function buildFunds(rng: Rng, years: FiscalYearWindow[]): Fund[] {
  const funds: Fund[] = []

  for (const fy of years) {
    for (const chain of CHAIN_CUSTOMERS) {
      const scale = CHAIN_SCALE[chain.id] ?? 0.05
      const fyShort = `FY${String(fy.fiscalYear).slice(2)}`

      funds.push({
        id: `fund_${chain.code}_${fy.fiscalYear}_ACC`,
        orgId: ORG.id,
        code: `${chain.code}-${fyShort}-ACC`,
        name: `${chain.name} — ${fyShort} Trade Accrual`,
        type: 'accrual',
        accrualBasis: chain.channel === 'club' ? 'gross_sales' : 'net_sales',
        accrualRate: n4((ACCRUAL_RATE_BY_CHANNEL[chain.channel] ?? 0.07) * rng.float(0.92, 1.08)),
        customerId: chain.id,
        productGroupId: null,
        periodStart: fy.start,
        periodEnd: fy.end,
        currency: 'USD',
        carryoverPolicy: rng.weighted([['capped', 5], ['none', 3], ['full', 2]]),
        carryoverCap: Math.round(scale * 180_000),
      })

      funds.push({
        id: `fund_${chain.code}_${fy.fiscalYear}_MDF`,
        orgId: ORG.id,
        code: `${chain.code}-${fyShort}-MDF`,
        name: `${chain.name} — ${fyShort} Fixed & MDF`,
        type: chain.channel === 'distributor' ? 'fixed' : 'mdf',
        customerId: chain.id,
        productGroupId: null,
        periodStart: fy.start,
        periodEnd: fy.end,
        currency: 'USD',
        budget: Math.round((scale * 2_400_000 * rng.float(0.8, 1.25)) / 1000) * 1000,
        carryoverPolicy: 'none',
      })
    }
  }

  return funds
}

/** Resolver handed to the promotion generator so every promo lands on a real fund. */
export function makeFundResolver(funds: Fund[]) {
  const byKey = new Map<string, Fund[]>()
  for (const f of funds) {
    const key = `${f.customerId}|${f.type === 'accrual' ? 'ACC' : 'FIX'}`
    const arr = byKey.get(key)
    if (arr) arr.push(f)
    else byKey.set(key, [f])
  }

  return (customerId: string, date: string, tactic: TacticCode): string => {
    const kind = FIXED_FUND_TACTICS.has(tactic) ? 'FIX' : 'ACC'
    const pool = byKey.get(`${customerId}|${kind}`) ?? []
    const hit = pool.find((f) => date >= f.periodStart && date <= f.periodEnd)
    return (hit ?? pool[pool.length - 1] ?? funds[0]).id
  }
}

/**
 * Build the immutable ledger.
 *
 * Accruals post weekly off shipments (this is the entry that hits the GL).
 * Commitments post when a promotion is approved. Actuals post when money
 * actually settles. Balance is derived from these rows and nowhere else.
 */
export function buildFundTransactions(
  rng: Rng,
  opts: {
    funds: Fund[]
    facts: SalesFact[]
    promotions: Promotion[]
    plannedSpendByPromotion: Map<string, number>
    today: string
  },
): FundTransaction[] {
  const txns: FundTransaction[] = []
  const accrualFunds = opts.funds.filter((f) => f.type === 'accrual')

  // ── Weekly accrual postings, aggregated per fund per fiscal period week ──
  const accrualByFundWeek = new Map<string, number>()
  const fundLookup = new Map<string, Fund[]>()
  for (const f of accrualFunds) {
    const arr = fundLookup.get(f.customerId)
    if (arr) arr.push(f)
    else fundLookup.set(f.customerId, [f])
  }

  for (const fact of opts.facts) {
    const candidates = fundLookup.get(fact.customerId) ?? []
    const fund = candidates.find(
      (f) => fact.weekStart >= f.periodStart && fact.weekStart <= f.periodEnd,
    )
    if (!fund) continue
    const amt = accrualAmount(fund, fact)
    if (amt <= 0) continue
    const key = `${fund.id}|${fact.weekStart}`
    accrualByFundWeek.set(key, n4((accrualByFundWeek.get(key) ?? 0) + amt))
  }

  for (const [key, amount] of accrualByFundWeek) {
    const [fundId, weekStart] = key.split('|')
    txns.push({
      id: `ftx_acc_${txns.length}`,
      orgId: ORG.id,
      fundId,
      type: 'accrual',
      amount,
      postedAt: addDays(weekStart, 6),
      reason: 'Nightly accrual posting',
      actorId: 'system',
    })
  }

  // ── Commitments & actuals per promotion ──
  for (const promo of opts.promotions) {
    const planned = opts.plannedSpendByPromotion.get(promo.id) ?? 0
    if (planned <= 0) continue
    if (promo.status === 'draft' || promo.status === 'cancelled') continue

    if (promo.approvedAt) {
      txns.push({
        id: `ftx_com_${txns.length}`,
        orgId: ORG.id,
        fundId: promo.fundId,
        type: 'commitment',
        amount: -planned,
        postedAt: promo.approvedAt,
        promotionId: promo.id,
        reason: `Committed on approval of ${promo.code}`,
        actorId: promo.approvedBy ?? 'u_marcus',
      })
    }

    // Closed events convert commitment → actual, usually not at plan.
    if (promo.status === 'closed') {
      const settledAt = addDays(promo.performEnd, rng.int(21, 75))
      if (settledAt > opts.today) continue

      const actual = n4(planned * rng.normal(0.97, 0.14))
      txns.push({
        id: `ftx_rev_${txns.length}`,
        orgId: ORG.id,
        fundId: promo.fundId,
        type: 'reversal',
        amount: planned,
        postedAt: settledAt,
        promotionId: promo.id,
        reason: `Reversal of commitment for ${promo.code}`,
        actorId: 'system',
      })
      txns.push({
        id: `ftx_act_${txns.length}`,
        orgId: ORG.id,
        fundId: promo.fundId,
        type: 'actual',
        amount: -Math.max(0, actual),
        postedAt: settledAt,
        promotionId: promo.id,
        reason: `Settled actuals for ${promo.code}`,
        actorId: 'system',
      })
    }
  }

  // ── A handful of manual adjustments, each with a mandatory reason ──
  const adjustable = opts.funds.filter((f) => f.type === 'accrual')
  for (let i = 0; i < 14; i++) {
    const fund = rng.pick(adjustable)
    txns.push({
      id: `ftx_adj_${i}`,
      orgId: ORG.id,
      fundId: fund.id,
      type: 'adjustment',
      amount: n4(rng.float(-40_000, 90_000)),
      postedAt: addDays(fund.periodStart, rng.int(30, 300)),
      reason: rng.pick([
        'Q2 true-up against actual settlements',
        'Correction — accrual basis applied to gross in error',
        'Negotiated incremental support agreed with buyer',
        'Reclass from MDF per finance review',
        'Prior-year over-accrual released',
      ]),
      actorId: rng.pick(['u_marcus', 'u_carol']),
    })
  }

  return txns
}
