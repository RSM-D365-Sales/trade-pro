/**
 * Fund balances.
 *
 * The one rule: a fund's balance is DERIVED from its transaction ledger, never
 * stored as a mutable column. Every number below is a fold over transactions.
 * That is what makes "why is this fund short $40K?" answerable — you can always
 * drill from any figure here to the rows that produced it.
 */

import type { Fund, FundTransaction, FundTxnType } from '../../data/types'
import { n4, safeDiv, sum4 } from './money'

export interface FundBalance {
  fundId: ID
  /** Money made available: accruals earned + carryover in + adjustments. */
  funded: number
  /** Approved-but-unspent promotion money. */
  committed: number
  /** Settled money that has actually left. */
  actual: number
  /** funded − committed − actual */
  remaining: number
  /** (committed + actual) / funded */
  utilization: number | null
  overCommitted: boolean
  txnCount: number
  byType: Record<FundTxnType, number>
}

type ID = string

const EMPTY_BY_TYPE: Record<FundTxnType, number> = {
  accrual: 0,
  commitment: 0,
  actual: 0,
  adjustment: 0,
  carryover: 0,
  reversal: 0,
}

/** Which ledger types add to the pot vs. consume it. */
const FUNDING_TYPES: FundTxnType[] = ['accrual', 'carryover', 'adjustment', 'reversal']

export function computeFundBalance(
  fund: Fund,
  txns: FundTransaction[],
): FundBalance {
  const mine = txns.filter((t) => t.fundId === fund.id)
  const byType = { ...EMPTY_BY_TYPE }
  for (const t of mine) byType[t.type] = n4(byType[t.type] + t.amount)

  // Fixed and top-down funds are budgeted rather than earned, so their budget
  // seeds the pot; accrual funds earn theirs a penny at a time off shipments.
  const budgetSeed = fund.type === 'accrual' ? 0 : n4(fund.budget ?? 0)
  const funded = n4(budgetSeed + sum4(FUNDING_TYPES.map((t) => byType[t])))
  const committed = n4(Math.abs(byType.commitment))
  const actual = n4(Math.abs(byType.actual))
  const remaining = n4(funded - committed - actual)

  return {
    fundId: fund.id,
    funded,
    committed,
    actual,
    remaining,
    utilization: safeDiv(committed + actual, funded),
    overCommitted: remaining < 0,
    txnCount: mine.length,
    byType,
  }
}

export function computeAllFundBalances(
  funds: Fund[],
  txns: FundTransaction[],
): Map<ID, FundBalance> {
  const byFund = new Map<ID, FundTransaction[]>()
  for (const t of txns) {
    const arr = byFund.get(t.fundId)
    if (arr) arr.push(t)
    else byFund.set(t.fundId, [t])
  }
  return new Map(
    funds.map((f) => [f.id, computeFundBalance(f, byFund.get(f.id) ?? [])]),
  )
}

/**
 * Nightly accrual posting: rate × basis per invoice line.
 * This is the entry that lands in the customer's GL as an accrued liability,
 * which is exactly why it is derived from one formula in one place.
 */
export function accrualAmount(
  fund: Pick<Fund, 'accrualBasis' | 'accrualRate'>,
  fact: { grossSales: number; offInvoiceDiscount: number; units: number },
): number {
  const rate = fund.accrualRate ?? 0
  switch (fund.accrualBasis) {
    case 'gross_sales':
      return n4(fact.grossSales * rate)
    case 'net_sales':
      return n4((fact.grossSales - fact.offInvoiceDiscount) * rate)
    case 'volume':
      return n4(fact.units * rate)
    default:
      return 0
  }
}

/**
 * Carryover at period close. `capped` is the common real-world policy —
 * finance will not let an unspent fund roll forever.
 */
export function carryoverAmount(fund: Fund, remaining: number): number {
  if (remaining <= 0) return 0
  switch (fund.carryoverPolicy) {
    case 'full':
      return n4(remaining)
    case 'capped':
      return n4(Math.min(remaining, fund.carryoverCap ?? 0))
    case 'none':
    default:
      return 0
  }
}

export interface UtilizationBand {
  label: string
  tone: 'good' | 'warning' | 'serious' | 'critical'
}

/** Status colors are reserved and always ship with a label, never color alone. */
export function utilizationBand(u: number | null): UtilizationBand {
  if (u === null) return { label: 'Unfunded', tone: 'serious' }
  if (u > 1) return { label: 'Over-committed', tone: 'critical' }
  if (u >= 0.9) return { label: 'Fully committed', tone: 'warning' }
  if (u >= 0.4) return { label: 'On track', tone: 'good' }
  return { label: 'Under-utilised', tone: 'serious' }
}
