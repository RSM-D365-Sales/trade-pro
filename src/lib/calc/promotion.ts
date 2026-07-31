/**
 * Promotion economics — the formulas from TPM_BUILD_PLAN.md §3.
 *
 * Pure functions. No React, no data access, no dates beyond what's handed in.
 * Everything the planning grid shows while a KAM types comes from here, and so
 * does the nightly recompute in the real build. One implementation, two callers.
 */

import type { Product, PromotionLine, RateType } from '../../data/types'
import { n4, safeDiv, sum4 } from './money'

export interface LineEconomics {
  lineId: string
  productId: string
  baselineUnits: number
  liftUnits: number
  totalUnits: number
  /** What we pay per case under this tactic & rate type. */
  spendPerCase: number
  spend: number
  grossRevenue: number
  /** Revenue after off-invoice money is taken off at order entry. */
  netInvoiceRevenue: number
  cogs: number
  /** Margin on the incremental cases only — the number that justifies spend. */
  incrementalMargin: number
  totalMargin: number
  roi: number | null
  liftPct: number | null
  spendPerIncrementalCase: number | null
}

export interface PromotionEconomics extends Omit<LineEconomics, 'lineId' | 'productId'> {
  lineCount: number
  lines: LineEconomics[]
  /** Margin % of net revenue. */
  marginPct: number | null
  /** Spend as a share of gross revenue — the "trade rate" a CFO tracks. */
  spendRate: number | null
}

/**
 * Spend for one case under a given rate type.
 * `lumpSum` is flat for the whole line, so it has no per-case rate; callers
 * get the amortised figure but the line total uses the flat amount.
 */
export function spendPerCase(
  rateType: RateType,
  rate: number,
  product: Pick<Product, 'listPrice' | 'casePack'>,
  totalUnits: number,
): number {
  switch (rateType) {
    case 'per_case':
      return n4(rate)
    case 'pct_of_list':
      return n4(rate * product.listPrice)
    case 'per_unit':
      return n4(rate * product.casePack)
    case 'lump_sum':
      return totalUnits > 0 ? n4(rate / totalUnits) : 0
  }
}

export function lineSpend(
  rateType: RateType,
  rate: number,
  product: Pick<Product, 'listPrice' | 'casePack'>,
  totalUnits: number,
): number {
  if (rateType === 'lump_sum') return n4(rate)
  return n4(spendPerCase(rateType, rate, product, totalUnits) * totalUnits)
}

/**
 * Off-invoice and EDLP money comes off the invoice at order entry, so it
 * reduces net invoice revenue directly. Bill-back / scan-back / lump-sum money
 * leaves later and shows up further down the gross-to-net waterfall. Both hit
 * margin; only the first hits the invoice.
 */
const OFF_INVOICE_RATE_SETTLEMENT = new Set(['off_invoice', 'edlp'])

export function isOffInvoiceTactic(tactic: string): boolean {
  return OFF_INVOICE_RATE_SETTLEMENT.has(tactic)
}

export function computeLine(
  line: PromotionLine,
  product: Pick<Product, 'listPrice' | 'cogs' | 'casePack'>,
): LineEconomics {
  const baselineUnits = n4(line.plannedBaselineUnits)
  const liftUnits = n4(line.plannedLiftUnits)
  const totalUnits = n4(baselineUnits + liftUnits)

  const perCase = spendPerCase(line.rateType, line.rate, product, totalUnits)
  const spend = lineSpend(line.rateType, line.rate, product, totalUnits)

  const grossRevenue = n4(totalUnits * product.listPrice)
  const offInvoicePortion = isOffInvoiceTactic(line.tactic) ? spend : 0
  const netInvoiceRevenue = n4(grossRevenue - offInvoicePortion)

  const cogs = n4(totalUnits * product.cogs)

  // Incremental margin uses the promoted net price — what we actually keep on
  // the extra cases after every allowance, not the list-price fantasy.
  const netPricePerCase = totalUnits > 0 ? n4((grossRevenue - spend) / totalUnits) : 0
  const incrementalMargin = n4(liftUnits * (netPricePerCase - product.cogs))
  const totalMargin = n4(grossRevenue - spend - cogs)

  return {
    lineId: line.id,
    productId: line.productId,
    baselineUnits,
    liftUnits,
    totalUnits,
    spendPerCase: perCase,
    spend,
    grossRevenue,
    netInvoiceRevenue,
    cogs,
    incrementalMargin,
    totalMargin,
    roi: safeDiv(incrementalMargin - spend, spend),
    liftPct: safeDiv(liftUnits, baselineUnits),
    spendPerIncrementalCase: safeDiv(spend, liftUnits),
  }
}

export function computePromotion(
  lines: PromotionLine[],
  productById: Map<string, Product>,
): PromotionEconomics {
  const computed = lines
    .map((l) => {
      const p = productById.get(l.productId)
      return p ? computeLine(l, p) : null
    })
    .filter((x): x is LineEconomics => x !== null)

  const spend = sum4(computed.map((l) => l.spend))
  const grossRevenue = sum4(computed.map((l) => l.grossRevenue))
  const netInvoiceRevenue = sum4(computed.map((l) => l.netInvoiceRevenue))
  const cogs = sum4(computed.map((l) => l.cogs))
  const baselineUnits = sum4(computed.map((l) => l.baselineUnits))
  const liftUnits = sum4(computed.map((l) => l.liftUnits))
  const totalUnits = n4(baselineUnits + liftUnits)
  const incrementalMargin = sum4(computed.map((l) => l.incrementalMargin))
  const totalMargin = sum4(computed.map((l) => l.totalMargin))
  const netRevenue = n4(grossRevenue - spend)

  return {
    lineCount: computed.length,
    lines: computed,
    baselineUnits,
    liftUnits,
    totalUnits,
    spendPerCase: totalUnits > 0 ? n4(spend / totalUnits) : 0,
    spend,
    grossRevenue,
    netInvoiceRevenue,
    cogs,
    incrementalMargin,
    totalMargin,
    roi: safeDiv(incrementalMargin - spend, spend),
    liftPct: safeDiv(liftUnits, baselineUnits),
    spendPerIncrementalCase: safeDiv(spend, liftUnits),
    marginPct: safeDiv(totalMargin, netRevenue),
    spendRate: safeDiv(spend, grossRevenue),
  }
}

// ── The honest bit ──────────────────────────────────────────────────────────

export interface TruePerformance {
  reportedLiftUnits: number
  cannibalizedUnits: number
  pantryLoadUnits: number
  /** Lift that survives cannibalization and the post-promo trough. */
  trueIncrementalUnits: number
  reportedRoi: number | null
  trueRoi: number | null
  /** How much of the headline lift was real. 1.0 = all of it. */
  qualityOfLift: number | null
}

/**
 * Most mid-market tools report gross lift because it flatters the buyer.
 * A promotion that reads +40% and is followed by a −35% trough is not a win.
 * Reporting this honestly is the product's stated differentiator, so the calc
 * engine models it as a first-class output rather than a footnote.
 */
export function computeTruePerformance(
  reportedLiftUnits: number,
  cannibalizedUnits: number,
  pantryLoadUnits: number,
  spend: number,
  marginPerCase: number,
): TruePerformance {
  const trueIncrementalUnits = n4(
    reportedLiftUnits - cannibalizedUnits - pantryLoadUnits,
  )
  const reportedMargin = n4(reportedLiftUnits * marginPerCase)
  const trueMargin = n4(trueIncrementalUnits * marginPerCase)

  return {
    reportedLiftUnits,
    cannibalizedUnits,
    pantryLoadUnits,
    trueIncrementalUnits,
    reportedRoi: safeDiv(reportedMargin - spend, spend),
    trueRoi: safeDiv(trueMargin - spend, spend),
    qualityOfLift: safeDiv(trueIncrementalUnits, reportedLiftUnits),
  }
}
