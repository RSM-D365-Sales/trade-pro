/**
 * Derived data.
 *
 * Every aggregate the UI shows is computed here from the raw dataset and
 * memoised on dataset identity, so no component does business math and no
 * number is stored twice. Rolling 34k weekly facts is fast enough to redo on
 * mutation, and keeping it derived means an edit in the planning grid shows up
 * everywhere at once without a cache to invalidate.
 */

import { useMemo } from 'react'

import { TACTIC_BY_CODE } from '../data/tactics'
import type {
  Customer, Dataset, Deduction, Fund, Product, Promotion, TacticCode,
} from '../data/types'
import { computeAllFundBalances, type FundBalance } from '../lib/calc/funds'
import { n4, safeDiv } from '../lib/calc/money'
import { computePromotion, isOffInvoiceTactic, type PromotionEconomics } from '../lib/calc/promotion'
import { computeTruePerformance } from '../lib/calc/promotion'
import { buildWaterfall, type WaterfallResult } from '../lib/calc/waterfall'
import { ageBucket, ageInDays, type AgeBucket } from '../lib/fiscal'
import { useStore, type MatchState } from './index'

// ── Lookups ────────────────────────────────────────────────────────────────

export function useLookups() {
  const dataset = useStore((s) => s.dataset)
  return useMemo(() => {
    const customersById = new Map<string, Customer>(dataset.customers.map((c) => [c.id, c]))
    const productsById = new Map<string, Product>(dataset.products.map((p) => [p.id, p]))
    const fundsById = new Map<string, Fund>(dataset.funds.map((f) => [f.id, f]))
    const promotionsById = new Map<string, Promotion>(dataset.promotions.map((p) => [p.id, p]))
    const usersById = new Map(dataset.users.map((u) => [u.id, u]))

    /** Every customer's root chain — the grain planning and reporting use. */
    const rootOf = (id: string): string => {
      let cur = customersById.get(id)
      while (cur?.parentId) cur = customersById.get(cur.parentId)
      return cur?.id ?? id
    }

    return { customersById, productsById, fundsById, promotionsById, usersById, rootOf, dataset }
  }, [dataset])
}

// ── Promotion economics ────────────────────────────────────────────────────

export function usePromotionEconomics(): Map<string, PromotionEconomics> {
  const dataset = useStore((s) => s.dataset)
  return useMemo(() => {
    const productsById = new Map(dataset.products.map((p) => [p.id, p]))
    const byPromo = new Map<string, typeof dataset.promotionLines>()
    for (const l of dataset.promotionLines) {
      const arr = byPromo.get(l.promotionId)
      if (arr) arr.push(l)
      else byPromo.set(l.promotionId, [l])
    }
    const out = new Map<string, PromotionEconomics>()
    for (const p of dataset.promotions) {
      out.set(p.id, computePromotion(byPromo.get(p.id) ?? [], productsById))
    }
    return out
  }, [dataset])
}

export interface PromotionPerformance {
  promotion: Promotion
  economics: PromotionEconomics
  customerName: string
  brands: string[]
  tactics: TacticCode[]
  /** Post-event actuals, present only once an event has closed. */
  actual?: {
    shippedUnits: number
    baselineUnits: number
    actualSpend: number
    reportedLiftUnits: number
    cannibalizedUnits: number
    pantryLoadUnits: number
    trueIncrementalUnits: number
    reportedRoi: number | null
    trueRoi: number | null
    qualityOfLift: number | null
  }
}

export function usePromotionPerformance(): PromotionPerformance[] {
  const dataset = useStore((s) => s.dataset)
  const economics = usePromotionEconomics()
  const { customersById, productsById } = useLookups()

  return useMemo(() => {
    const resultsByPromo = new Map(dataset.eventResults.map((r) => [r.promotionId, r]))
    const linesByPromo = new Map<string, typeof dataset.promotionLines>()
    for (const l of dataset.promotionLines) {
      const arr = linesByPromo.get(l.promotionId)
      if (arr) arr.push(l)
      else linesByPromo.set(l.promotionId, [l])
    }

    return dataset.promotions.map((promotion) => {
      const econ = economics.get(promotion.id)!
      const lines = linesByPromo.get(promotion.id) ?? []
      const brands = [...new Set(lines.map((l) => productsById.get(l.productId)?.brand).filter(Boolean))] as string[]
      const tactics = [...new Set(lines.map((l) => l.tactic))]

      const er = resultsByPromo.get(promotion.id)
      let actual: PromotionPerformance['actual']
      if (er) {
        const reportedLift = Math.max(0, er.shippedUnits - er.baselineUnits)
        // Margin per case on the promoted product mix.
        const marginPerCase =
          econ.totalUnits > 0
            ? n4((econ.grossRevenue - econ.spend - econ.cogs) / econ.totalUnits)
            : 0
        const t = computeTruePerformance(
          reportedLift, er.cannibalizedUnits, er.pantryLoadUnits, er.actualSpend, marginPerCase,
        )
        actual = {
          shippedUnits: er.shippedUnits,
          baselineUnits: er.baselineUnits,
          actualSpend: er.actualSpend,
          reportedLiftUnits: reportedLift,
          cannibalizedUnits: er.cannibalizedUnits,
          pantryLoadUnits: er.pantryLoadUnits,
          trueIncrementalUnits: t.trueIncrementalUnits,
          reportedRoi: t.reportedRoi,
          trueRoi: t.trueRoi,
          qualityOfLift: t.qualityOfLift,
        }
      }

      return {
        promotion,
        economics: econ,
        customerName: customersById.get(promotion.customerId)?.name ?? '—',
        brands,
        tactics,
        actual,
      }
    })
  }, [dataset, economics, customersById, productsById])
}

// ── Deductions ─────────────────────────────────────────────────────────────

export interface EnrichedDeduction {
  deduction: Deduction
  customerName: string
  chainId: string
  chainName: string
  ageDays: number
  bucket: AgeBucket
  match: MatchState
  /** True when a dispute exists on this deduction. */
  hasDispute: boolean
  recovered: number
}

export function useEnrichedDeductions(): EnrichedDeduction[] {
  const dataset = useStore((s) => s.dataset)
  const matches = useStore((s) => s.matchesByDeduction)
  const today = useStore((s) => s.today)
  const { customersById, rootOf } = useLookups()

  return useMemo(() => {
    const disputeByDeduction = new Map(dataset.disputes.map((d) => [d.deductionId, d]))
    return dataset.deductions.map((deduction) => {
      const chainId = rootOf(deduction.customerId)
      const dispute = disputeByDeduction.get(deduction.id)
      const ageDays = ageInDays(deduction.receivedDate, today)
      return {
        deduction,
        customerName: customersById.get(deduction.customerId)?.name ?? '—',
        chainId,
        chainName: customersById.get(chainId)?.name ?? '—',
        ageDays,
        bucket: ageBucket(ageDays),
        match: matches.get(deduction.id) ?? { candidates: [], disposition: 'no_match' },
        hasDispute: !!dispute,
        recovered: dispute?.recoveredAmount ?? 0,
      }
    })
  }, [dataset, matches, today, customersById, rootOf])
}

// ── Funds ──────────────────────────────────────────────────────────────────

export function useFundBalances(): Map<string, FundBalance> {
  const dataset = useStore((s) => s.dataset)
  return useMemo(
    () => computeAllFundBalances(dataset.funds, dataset.fundTransactions),
    [dataset],
  )
}

/** The fiscal year the demo's "today" falls inside. */
export function useCurrentFiscalYear(): number {
  const dataset = useStore((s) => s.dataset)
  const today = useStore((s) => s.today)
  return useMemo(() => {
    const hit = dataset.fiscalWeeks.find((w) => w.weekStart <= today)
      && [...dataset.fiscalWeeks].reverse().find((w) => w.weekStart <= today)
    return hit?.fiscalYear ?? 2026
  }, [dataset, today])
}

// ── Sales rollups ──────────────────────────────────────────────────────────

export interface SalesRollup {
  units: number
  grossSales: number
  offInvoice: number
  cogs: number
}

const EMPTY_ROLLUP: SalesRollup = { units: 0, grossSales: 0, offInvoice: 0, cogs: 0 }

export interface SalesIndex {
  byChain: Map<string, SalesRollup>
  byBrand: Map<string, SalesRollup>
  byWeek: Map<string, SalesRollup>
  byChainWeek: Map<string, SalesRollup>
  total: SalesRollup
  weeks: string[]
}

export function useSalesIndex(fromWeek?: string, toWeek?: string): SalesIndex {
  const dataset = useStore((s) => s.dataset)
  const { productsById } = useLookups()

  return useMemo(() => {
    const byChain = new Map<string, SalesRollup>()
    const byBrand = new Map<string, SalesRollup>()
    const byWeek = new Map<string, SalesRollup>()
    const byChainWeek = new Map<string, SalesRollup>()
    const total: SalesRollup = { ...EMPTY_ROLLUP }
    const weeks = new Set<string>()

    const add = (m: Map<string, SalesRollup>, key: string, f: (typeof dataset.salesFacts)[number]) => {
      const cur = m.get(key)
      if (cur) {
        cur.units += f.units
        cur.grossSales += f.grossSales
        cur.offInvoice += f.offInvoiceDiscount
        cur.cogs += f.cogs
      } else {
        m.set(key, {
          units: f.units, grossSales: f.grossSales,
          offInvoice: f.offInvoiceDiscount, cogs: f.cogs,
        })
      }
    }

    for (const f of dataset.salesFacts) {
      if (fromWeek && f.weekStart < fromWeek) continue
      if (toWeek && f.weekStart > toWeek) continue
      weeks.add(f.weekStart)
      add(byChain, f.customerId, f)
      const brand = productsById.get(f.productId)?.brand
      if (brand) add(byBrand, brand, f)
      add(byWeek, f.weekStart, f)
      add(byChainWeek, `${f.customerId}|${f.weekStart}`, f)
      total.units += f.units
      total.grossSales += f.grossSales
      total.offInvoice += f.offInvoiceDiscount
      total.cogs += f.cogs
    }

    return {
      byChain, byBrand, byWeek, byChainWeek, total,
      weeks: [...weeks].sort(),
    }
  }, [dataset, productsById, fromWeek, toWeek])
}

// ── Gross-to-net ───────────────────────────────────────────────────────────

/**
 * Assembles the waterfall from the same primitives the P&L uses: off-invoice
 * money comes off shipments, claimed money comes from promotion spend by
 * settlement type, and unrecovered invalid deductions land in "other".
 */
export function useWaterfall(opts: {
  fromWeek?: string
  toWeek?: string
  chainId?: string
} = {}): WaterfallResult {
  const dataset = useStore((s) => s.dataset)
  const economics = usePromotionEconomics()
  const sales = useSalesIndex(opts.fromWeek, opts.toWeek)
  const { rootOf, productsById } = useLookups()

  return useMemo(() => {
    const scope = opts.chainId
    const base = scope
      ? (sales.byChain.get(scope) ?? EMPTY_ROLLUP)
      : sales.total

    let billScan = 0
    let fixed = 0

    const linesByPromo = new Map<string, typeof dataset.promotionLines>()
    for (const l of dataset.promotionLines) {
      const arr = linesByPromo.get(l.promotionId)
      if (arr) arr.push(l)
      else linesByPromo.set(l.promotionId, [l])
    }

    for (const promo of dataset.promotions) {
      if (promo.status === 'draft' || promo.status === 'cancelled') continue
      if (scope && rootOf(promo.customerId) !== scope) continue
      if (opts.fromWeek && promo.performEnd < opts.fromWeek) continue
      if (opts.toWeek && promo.performStart > opts.toWeek) continue

      const econ = economics.get(promo.id)
      if (!econ) continue

      for (const line of linesByPromo.get(promo.id) ?? []) {
        const product = productsById.get(line.productId)
        if (!product) continue
        const lineEcon = econ.lines.find((l) => l.lineId === line.id)
        if (!lineEcon) continue
        if (isOffInvoiceTactic(line.tactic)) continue // already in base.offInvoice

        const settlement = TACTIC_BY_CODE[line.tactic]?.settlement
        if (settlement === 'lump_sum') fixed += lineEcon.spend
        else billScan += lineEcon.spend
      }
    }

    // Deductions we could not tie to a promotion and did not recover are a
    // real cost of doing business, so they belong in the waterfall.
    const disputeByDeduction = new Map(dataset.disputes.map((d) => [d.deductionId, d]))
    let other = 0
    for (const d of dataset.deductions) {
      if (scope && rootOf(d.customerId) !== scope) continue
      if (opts.fromWeek && d.receivedDate < opts.fromWeek) continue
      if (opts.toWeek && d.receivedDate > opts.toWeek) continue
      if (d.status === 'written_off') other += d.amount
      else if (d.status === 'recovered') {
        const rec = disputeByDeduction.get(d.id)?.recoveredAmount ?? 0
        other += Math.max(0, d.amount - rec)
      }
    }

    return buildWaterfall({
      grossSales: base.grossSales,
      offInvoice: base.offInvoice,
      billBackScanBack: billScan,
      fixedFunds: fixed,
      otherDeductions: other,
      cogs: base.cogs,
    })
  }, [dataset, economics, sales, opts.chainId, opts.fromWeek, opts.toWeek, rootOf, productsById])
}

// ── Spend by tactic ────────────────────────────────────────────────────────

export function useSpendByTactic(chainId?: string) {
  const dataset = useStore((s) => s.dataset)
  const economics = usePromotionEconomics()
  const { rootOf } = useLookups()

  return useMemo(() => {
    const spend = new Map<TacticCode, { spend: number; lift: number; promos: Set<string> }>()
    const promoById = new Map(dataset.promotions.map((p) => [p.id, p]))

    for (const line of dataset.promotionLines) {
      const promo = promoById.get(line.promotionId)
      if (!promo || promo.status === 'draft' || promo.status === 'cancelled') continue
      if (chainId && rootOf(promo.customerId) !== chainId) continue

      const econ = economics.get(promo.id)?.lines.find((l) => l.lineId === line.id)
      if (!econ) continue

      const cur = spend.get(line.tactic) ?? { spend: 0, lift: 0, promos: new Set<string>() }
      cur.spend += econ.spend
      cur.lift += econ.liftUnits
      cur.promos.add(promo.id)
      spend.set(line.tactic, cur)
    }

    return [...spend.entries()]
      .map(([tactic, v]) => ({
        tactic,
        name: TACTIC_BY_CODE[tactic]?.name ?? tactic,
        spend: n4(v.spend),
        liftUnits: n4(v.lift),
        promotionCount: v.promos.size,
        spendPerIncrementalCase: safeDiv(v.spend, v.lift),
      }))
      .sort((a, b) => b.spend - a.spend)
  }, [dataset, economics, chainId, rootOf])
}

export type { Dataset }
