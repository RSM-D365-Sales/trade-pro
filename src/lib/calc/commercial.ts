/**
 * Commercial performance — the sales-leadership read of the same facts the
 * trade screens report.
 *
 * The rule this module exists to enforce: NET SALES HAS ONE DEFINITION.
 * Gross, less allowances taken at invoice, less claimed trade money
 * straight-lined across the weeks the event was on shelf. Gross profit is that
 * figure less COGS. Every tile, chart and leaderboard on the sales screen is a
 * rollup of the same per-cell facts, so a sales director and a trade finance
 * manager reading two different screens cannot arrive at two different numbers.
 *
 * Straight-lining claimed spend is a choice, not an accident: bill-back and
 * scan-back money is earned while the event is on shelf and settles months
 * later, so attributing it to the settlement week would make a good period look
 * great and the period after it look terrible. Accrual accounting does the same
 * thing for the same reason.
 *
 * Pure. No React, no I/O. Unit tested in commercial.test.ts.
 */

import type {
  ISODate, Product, Promotion, PromotionLine, SalesFact,
} from '../../data/types'
import { addWeeks, weekStartOf } from '../fiscal'
import { n4, safeDiv } from './money'
import { isOffInvoiceTactic, type PromotionEconomics } from './promotion'

// ── Cells ──────────────────────────────────────────────────────────────────

export interface CommercialCell {
  units: number
  /** Cases that shipped while a promotion was on shelf. */
  promotedUnits: number
  grossSales: number
  /** Allowances already off the invoice when it prints. */
  offInvoice: number
  /** Bill-back / scan-back / lump-sum money, straight-lined over performance. */
  claimedSpend: number
  cogs: number
}

/** One (customer × product × week) commercial fact. The grain everything rolls from. */
export interface CommercialFact extends CommercialCell {
  chainId: string
  productId: string
  weekStart: ISODate
}

export interface CommercialRollup extends CommercialCell {
  /** Everything the retailer takes, however it is settled. */
  tradeSpend: number
  netSales: number
  grossProfit: number
  grossMarginPct: number | null
  /** Trade spend as a share of gross — the rate a CFO tracks. */
  tradeRate: number | null
  netPricePerCase: number | null
  gpPerCase: number | null
  /** Share of cases that shipped on deal. */
  dealShare: number | null
}

export function emptyCell(): CommercialCell {
  return { units: 0, promotedUnits: 0, grossSales: 0, offInvoice: 0, claimedSpend: 0, cogs: 0 }
}

export function addCell(target: CommercialCell, source: CommercialCell): void {
  target.units += source.units
  target.promotedUnits += source.promotedUnits
  target.grossSales += source.grossSales
  target.offInvoice += source.offInvoice
  target.claimedSpend += source.claimedSpend
  target.cogs += source.cogs
}

export function finalise(cell: CommercialCell): CommercialRollup {
  const tradeSpend = n4(cell.offInvoice + cell.claimedSpend)
  const netSales = n4(cell.grossSales - tradeSpend)
  const grossProfit = n4(netSales - cell.cogs)
  return {
    units: n4(cell.units),
    promotedUnits: n4(cell.promotedUnits),
    grossSales: n4(cell.grossSales),
    offInvoice: n4(cell.offInvoice),
    claimedSpend: n4(cell.claimedSpend),
    cogs: n4(cell.cogs),
    tradeSpend,
    netSales,
    grossProfit,
    grossMarginPct: safeDiv(grossProfit, netSales),
    tradeRate: safeDiv(tradeSpend, cell.grossSales),
    netPricePerCase: safeDiv(netSales, cell.units),
    gpPerCase: safeDiv(grossProfit, cell.units),
    dealShare: safeDiv(cell.promotedUnits, cell.units),
  }
}

export function rollup(facts: CommercialFact[]): CommercialRollup {
  const acc = emptyCell()
  for (const f of facts) addCell(acc, f)
  return finalise(acc)
}

/** Group and roll up in one pass — the shape every chart on the page wants. */
export function rollupBy<K>(
  facts: CommercialFact[],
  key: (f: CommercialFact) => K | null,
): Map<K, CommercialRollup> {
  const cells = new Map<K, CommercialCell>()
  for (const f of facts) {
    const k = key(f)
    if (k === null) continue
    let cell = cells.get(k)
    if (!cell) cells.set(k, (cell = emptyCell()))
    addCell(cell, f)
  }
  const out = new Map<K, CommercialRollup>()
  for (const [k, cell] of cells) out.set(k, finalise(cell))
  return out
}

// ── Claimed-spend allocation ───────────────────────────────────────────────

/** A promotion's runaway guard — no real event runs longer than a year. */
const MAX_EVENT_WEEKS = 60

export interface SpendEvent {
  /** Whatever grain the caller is attributing to. */
  key: string
  start: ISODate
  end: ISODate
  spend: number
}

/**
 * Straight-line an event's spend across the weeks it was on shelf.
 * Returns `${key}|${weekStart}` → spend.
 *
 * `throughWeek` stops the allocation at a point in time. The per-week rate is
 * still the full event divided by its full length — only the weeks that have
 * not happened yet are dropped. Without this, an approved promotion running
 * into next quarter would post its whole cost against periods that have not
 * traded, and every forward period would report negative net sales. Trade money
 * is EARNED while the event is on shelf; before that it is a commitment, and
 * commitments live in the fund ledger, not in the P&L.
 */
export function spreadSpendByWeek(
  events: SpendEvent[],
  throughWeek?: ISODate,
): Map<string, number> {
  const out = new Map<string, number>()

  for (const e of events) {
    if (!e.spend) continue
    const last = weekStartOf(e.end)
    const weeks: ISODate[] = []
    let w = weekStartOf(e.start)
    while (w <= last && weeks.length < MAX_EVENT_WEEKS) {
      weeks.push(w)
      w = addWeeks(w, 1)
    }
    // An end date before the start date is bad data, not zero spend — put the
    // money in the first week rather than silently dropping it.
    if (weeks.length === 0) weeks.push(weekStartOf(e.start))

    const per = e.spend / weeks.length
    for (const week of weeks) {
      if (throughWeek && week > throughWeek) break
      const k = `${e.key}|${week}`
      out.set(k, n4((out.get(k) ?? 0) + per))
    }
  }

  return out
}

/**
 * Claimed (non-off-invoice) trade spend by chain × product × week.
 *
 * Off-invoice money is excluded on purpose: it is already sitting in each
 * sales fact's `offInvoiceDiscount`, and counting it twice would understate
 * net sales by the single largest line in the waterfall.
 */
export function claimedSpendByCell(
  promotions: Promotion[],
  linesByPromotion: Map<string, PromotionLine[]>,
  economics: Map<string, PromotionEconomics>,
  rootOf: (customerId: string) => string,
  /** Stop at "today" — weeks an event has not yet traded are a commitment. */
  throughWeek?: ISODate,
): Map<string, number> {
  const events: SpendEvent[] = []

  for (const promo of promotions) {
    if (promo.status === 'draft' || promo.status === 'cancelled') continue
    const econ = economics.get(promo.id)
    if (!econ) continue
    const chainId = rootOf(promo.customerId)

    for (const line of linesByPromotion.get(promo.id) ?? []) {
      if (isOffInvoiceTactic(line.tactic)) continue
      const lineEcon = econ.lines.find((l) => l.lineId === line.id)
      if (!lineEcon || !lineEcon.spend) continue
      events.push({
        key: `${chainId}|${line.productId}`,
        start: promo.performStart,
        end: promo.performEnd,
        spend: lineEcon.spend,
      })
    }
  }

  return spreadSpendByWeek(events, throughWeek)
}

/**
 * Join shipment facts to allocated trade spend.
 *
 * Spend can land on a week where nothing shipped (a deal that failed to sell
 * through). Those cells are emitted with zero volume rather than dropped —
 * money that left the business has to appear somewhere or net sales overstates.
 */
export function buildCommercialFacts(
  salesFacts: SalesFact[],
  claimedByCell: Map<string, number>,
  rootOf: (customerId: string) => string,
): CommercialFact[] {
  const byKey = new Map<string, CommercialFact>()

  for (const f of salesFacts) {
    const chainId = rootOf(f.customerId)
    const key = `${chainId}|${f.productId}|${f.weekStart}`
    let cell = byKey.get(key)
    if (!cell) {
      byKey.set(key, (cell = {
        chainId, productId: f.productId, weekStart: f.weekStart, ...emptyCell(),
      }))
    }
    cell.units += f.units
    if (f.promotionId) cell.promotedUnits += f.units
    cell.grossSales += f.grossSales
    cell.offInvoice += f.offInvoiceDiscount
    cell.cogs += f.cogs
  }

  for (const [key, spend] of claimedByCell) {
    const [chainId, productId, weekStart] = key.split('|')
    const cellKey = `${chainId}|${productId}|${weekStart}`
    let cell = byKey.get(cellKey)
    if (!cell) {
      byKey.set(cellKey, (cell = { chainId, productId, weekStart, ...emptyCell() }))
    }
    cell.claimedSpend += spend
  }

  return [...byKey.values()]
}

// ── Service & working capital ──────────────────────────────────────────────

/** Cases shipped ÷ cases ordered. The number a retailer's supply chain scores us on. */
export function caseFillRate(shipped: number, ordered: number): number | null {
  return safeDiv(shipped, ordered)
}

/** Cases ordered implied by what shipped at a given fill rate. */
export function impliedCasesOrdered(shipped: number, fillRate: number): number {
  if (fillRate <= 0) return n4(shipped)
  return n4(shipped / fillRate)
}

export function daysSalesOutstanding(
  receivables: number,
  netSales: number,
  daysInWindow: number,
): number | null {
  const perDay = safeDiv(netSales, daysInWindow)
  if (perDay === null || perDay <= 0) return null
  return n4(receivables / perDay)
}

/** Attainment as a ratio — 0.97 is three points behind plan. */
export function attainment(actual: number, plan: number): number | null {
  return safeDiv(actual, plan)
}

// ── Accounts needing attention ─────────────────────────────────────────────

export type AccountSignalKind =
  | 'volume_decline'
  | 'margin_below_floor'
  | 'plan_shortfall'
  | 'deduction_exposure'
  | 'assortment_gap'

export interface AccountInput {
  customerId: string
  name: string
  /** Net sales in the window under review. */
  netSales: number
  /** The same window a year ago — what "down 12%" is measured against. */
  netSalesComparable: number
  /**
   * Trailing-year net sales. Deduction exposure is a STOCK that has built up
   * over months; dividing it by a five-week window's sales produces figures
   * like "147% of net sales" and flags every account on the book. A stock is
   * only meaningful against an annual flow.
   */
  netSalesAnnual: number
  grossMarginPct: number | null
  planNetSales: number
  /**
   * Deduction value genuinely at risk — what the engine could not tie to an
   * event, or believes is invalid. NOT the whole unresolved queue: most of
   * that will settle normally and flagging it says nothing.
   */
  openDeductions: number
  productGroupsBought: number
  productGroupsAvailable: number
}

export interface AttentionOptions {
  /** Company gross margin. The floor sits `marginFloorGap` below it. */
  companyMarginPct: number
  /**
   * Company-wide at-risk deductions as a share of trailing-year net sales.
   *
   * Both this and `companyMarginPct` exist for the same reason: the thresholds
   * that matter are RELATIVE to the book, not absolute. In a business where
   * every account runs ~4% exposure, flagging everything over 1% flags the
   * whole customer list and tells a sales director nothing they did not
   * already know.
   */
  companyDeductionRate: number
  volumeDrop: number
  marginFloorGap: number
  planShortfall: number
  /** Points of exposure above the company rate before an account is flagged. */
  deductionGap: number
  /** Below this share of the range, the account is under-assorted. */
  assortmentCoverage: number
  maxRows: number
}

export const DEFAULT_ATTENTION: AttentionOptions = {
  companyMarginPct: 0.45,
  companyDeductionRate: 0.03,
  volumeDrop: 0.08,
  marginFloorGap: 0.04,
  planShortfall: 0.06,
  deductionGap: 0.012,
  assortmentCoverage: 0.62,
  maxRows: 6,
}

export interface AccountSignal {
  customerId: string
  name: string
  kind: AccountSignalKind
  /** 0.15..1 — how far past its threshold this sits. Drives order and tone. */
  severity: number
  /** The measured figure, in the unit the kind implies. */
  value: number
  /** What it was measured against. */
  reference: number
}

/** How far past a threshold something sits, normalised so kinds are comparable. */
function severityOf(excess: number, span: number): number {
  return Math.max(0.15, Math.min(1, 0.15 + (excess / span) * 0.85))
}

/**
 * At most ONE finding per account — the highest-severity one.
 *
 * This is the same lesson the forecast recommendation queue learned: an account
 * that is losing volume is usually also behind plan and usually also carrying
 * deductions, and listing all three says the same thing three times. A panel
 * that repeats itself is a panel people stop reading.
 */
export function findAccountSignals(
  inputs: AccountInput[],
  opts: AttentionOptions = DEFAULT_ATTENTION,
): AccountSignal[] {
  const out: AccountSignal[] = []

  for (const a of inputs) {
    const candidates: AccountSignal[] = []
    const base = { customerId: a.customerId, name: a.name }

    // ── Volume going backwards ──
    const drop = safeDiv(a.netSalesComparable - a.netSales, a.netSalesComparable)
    if (drop !== null && drop >= opts.volumeDrop) {
      candidates.push({
        ...base,
        kind: 'volume_decline',
        severity: severityOf(drop - opts.volumeDrop, 0.3),
        value: -drop,
        reference: a.netSalesComparable,
      })
    }

    // ── Margin under the floor ──
    const floor = opts.companyMarginPct - opts.marginFloorGap
    if (a.grossMarginPct !== null && a.grossMarginPct < floor) {
      candidates.push({
        ...base,
        kind: 'margin_below_floor',
        severity: severityOf(floor - a.grossMarginPct, 0.1),
        value: a.grossMarginPct,
        reference: floor,
      })
    }

    // ── Behind plan ──
    const att = attainment(a.netSales, a.planNetSales)
    if (att !== null && att < 1 - opts.planShortfall) {
      candidates.push({
        ...base,
        kind: 'plan_shortfall',
        severity: severityOf(1 - opts.planShortfall - att, 0.2),
        value: att,
        reference: a.planNetSales,
      })
    }

    // ── Deduction exposure, measured against the book's own rate ──
    const exposure = safeDiv(a.openDeductions, a.netSalesAnnual)
    const exposureCeiling = opts.companyDeductionRate + opts.deductionGap
    if (exposure !== null && exposure >= exposureCeiling) {
      candidates.push({
        ...base,
        kind: 'deduction_exposure',
        severity: severityOf(exposure - exposureCeiling, 0.03),
        value: a.openDeductions,
        reference: exposure,
      })
    }

    // ── Range gap: an opportunity, not a failure ──
    const coverage = safeDiv(a.productGroupsBought, a.productGroupsAvailable)
    if (coverage !== null && coverage < opts.assortmentCoverage) {
      candidates.push({
        ...base,
        kind: 'assortment_gap',
        // Deliberately damped: a cross-sell gap should never outrank a real
        // problem in the same list.
        severity: severityOf(opts.assortmentCoverage - coverage, 0.9) * 0.7,
        value: a.productGroupsBought,
        reference: a.productGroupsAvailable,
      })
    }

    if (candidates.length === 0) continue
    candidates.sort((x, y) => y.severity - x.severity)
    out.push(candidates[0])
  }

  return out.sort((a, b) => b.severity - a.severity).slice(0, opts.maxRows)
}

// ── Rep territory rollup ───────────────────────────────────────────────────

export interface RepPerformance {
  repId: string
  name: string
  initials: string
  customerIds: string[]
  rollup: CommercialRollup
  planNetSales: number
  attainment: number | null
}

export function rankReps(
  reps: { id: string; name: string; initials: string; customerIds: string[] }[],
  byChain: Map<string, CommercialRollup>,
  planByChain: Map<string, number>,
): RepPerformance[] {
  return reps
    .map((rep) => {
      const acc = emptyCell()
      let planNetSales = 0
      for (const id of rep.customerIds) {
        const r = byChain.get(id)
        if (r) addCell(acc, r)
        planNetSales += planByChain.get(id) ?? 0
      }
      const roll = finalise(acc)
      return {
        repId: rep.id,
        name: rep.name,
        initials: rep.initials,
        customerIds: rep.customerIds,
        rollup: roll,
        planNetSales: n4(planNetSales),
        attainment: attainment(roll.netSales, planNetSales),
      }
    })
    .sort((a, b) => b.rollup.grossProfit - a.rollup.grossProfit)
}

/** Median of a numeric list — the honest centre for a rep leaderboard. */
export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  return clean.length % 2 === 0 ? n4((clean[mid - 1] + clean[mid]) / 2) : clean[mid]
}

export type { Product }
