/**
 * Weekly shipment facts.
 *
 * Three effects are modelled on purpose, because the analytics screens claim to
 * report them honestly:
 *   1. LIFT during a promotion's perform window.
 *   2. PANTRY LOADING — the trough in the 1–2 weeks after, as the shopper works
 *      through what they stocked up on.
 *   3. CANNIBALIZATION — sibling SKUs in the same subbrand losing volume to the
 *      promoted one.
 * A tool that shows only #1 flatters the buyer. This one shows all three.
 */

import { ORG } from '../catalog'
import { TACTIC_BY_CODE } from '../tactics'
import type { EventResult, Promotion, PromotionLine, SalesFact, TacticCode } from '../types'
import { n4 } from '../../lib/calc/money'
import { isOffInvoiceTactic, spendPerCase } from '../../lib/calc/promotion'
import { addWeeks, weekStartOf } from '../../lib/fiscal'
import type { Rng } from '../rng'
import { PRODUCT_BY_ID, seasonalFactor, trendFactor, type MarketCell } from './market'

interface PromoWeek {
  promotionId: string
  liftMultiplier: number
  offInvoicePerCase: number
}

const cellKey = (customerId: string, productId: string) => `${customerId}|${productId}`

export interface SalesSeedResult {
  facts: SalesFact[]
  eventResults: EventResult[]
  promotedWeeksByCell: Map<string, Set<string>>
}

export function buildSalesFacts(
  rng: Rng,
  opts: {
    cells: MarketCell[]
    weekStarts: string[]
    promotions: Promotion[]
    lines: PromotionLine[]
    /** Everyday allowance rate per customer, applied to every case shipped. */
    allowanceByCustomer: Map<string, number>
  },
): SalesSeedResult {
  const promoById = new Map(opts.promotions.map((p) => [p.id, p]))

  // ── Index: which (customer, product, week) is on promotion, and how hard ──
  const promoWeeks = new Map<string, Map<string, PromoWeek>>()
  const dipWeeks = new Map<string, Map<string, number>>()
  const subbrandPromo = new Set<string>()
  const promotedWeeksByCell = new Map<string, Set<string>>()

  for (const line of opts.lines) {
    const promo = promoById.get(line.promotionId)
    if (!promo || promo.status === 'draft' || promo.status === 'cancelled') continue

    const product = PRODUCT_BY_ID.get(line.productId)
    if (!product) continue

    const key = cellKey(promo.customerId, line.productId)
    const totalUnits = line.plannedBaselineUnits + line.plannedLiftUnits
    const liftMultiplier =
      line.plannedBaselineUnits > 0 ? totalUnits / line.plannedBaselineUnits : 1

    const offInvoicePerCase = isOffInvoiceTactic(line.tactic)
      ? spendPerCase(line.rateType, line.rate, product, totalUnits)
      : 0

    let w = weekStartOf(promo.performStart)
    const end = weekStartOf(promo.performEnd)
    let guard = 0
    while (w <= end && guard++ < 60) {
      let m = promoWeeks.get(key)
      if (!m) promoWeeks.set(key, (m = new Map()))
      m.set(w, { promotionId: promo.id, liftMultiplier, offInvoicePerCase })

      let s = promotedWeeksByCell.get(key)
      if (!s) promotedWeeksByCell.set(key, (s = new Set()))
      s.add(w)

      subbrandPromo.add(`${promo.customerId}|${product.subbrand}|${w}`)
      w = addWeeks(w, 1)
    }

    // Pantry load: the deeper the deal, the deeper the trough that follows.
    const dipDepth = Math.min(0.34, (liftMultiplier - 1) * 0.3)
    let d = dipWeeks.get(key)
    if (!d) dipWeeks.set(key, (d = new Map()))
    d.set(addWeeks(end, 1), Math.max(d.get(addWeeks(end, 1)) ?? 0, dipDepth))
    d.set(addWeeks(end, 2), Math.max(d.get(addWeeks(end, 2)) ?? 0, dipDepth * 0.45))
  }

  // ── Generate the facts ──
  const facts: SalesFact[] = []
  const actualUnitsByPromo = new Map<string, number>()
  const baseUnitsByPromo = new Map<string, number>()
  const cannibalByPromo = new Map<string, number>()
  const dipUnitsByPromo = new Map<string, number>()

  for (const cell of opts.cells) {
    const product = PRODUCT_BY_ID.get(cell.productId)
    if (!product) continue
    const key = cellKey(cell.customerId, cell.productId)
    const cellPromos = promoWeeks.get(key)
    const cellDips = dipWeeks.get(key)

    opts.weekStarts.forEach((weekStart, i) => {
      const seasonal = seasonalFactor(product.category, weekStart)
      const trend = trendFactor(product.brand, i)
      const noise = rng.normal(1, 0.11)
      const baseUnits = cell.baseVelocity * seasonal * trend * noise

      const pw = cellPromos?.get(weekStart)
      const dip = cellDips?.get(weekStart) ?? 0

      // Sibling SKU promoted this week but not this one → we lose share.
      const siblingPromoted =
        !pw && subbrandPromo.has(`${cell.customerId}|${product.subbrand}|${weekStart}`)
      const cannibalDrag = siblingPromoted ? rng.float(0.06, 0.19) : 0

      let units = baseUnits
      if (pw) units *= pw.liftMultiplier * rng.float(0.82, 1.18)
      units *= 1 - dip
      units *= 1 - cannibalDrag
      units = Math.max(0, Math.round(units))
      if (units === 0) return

      const grossSales = n4(units * product.listPrice)
      // Everyday allowance applies to every case; promotion off-invoice money
      // stacks on top of it during the event.
      const everyday = n4(grossSales * (opts.allowanceByCustomer.get(cell.customerId) ?? 0))
      const offInvoiceDiscount = n4(everyday + (pw ? units * pw.offInvoicePerCase : 0))

      facts.push({
        id: `sf_${facts.length}`,
        orgId: ORG.id,
        customerId: cell.customerId,
        productId: cell.productId,
        weekStart,
        units,
        grossSales,
        offInvoiceDiscount,
        cogs: n4(units * product.cogs),
        promotionId: pw?.promotionId,
      })

      if (pw) {
        actualUnitsByPromo.set(pw.promotionId, (actualUnitsByPromo.get(pw.promotionId) ?? 0) + units)
        baseUnitsByPromo.set(
          pw.promotionId,
          (baseUnitsByPromo.get(pw.promotionId) ?? 0) + Math.round(baseUnits),
        )
      }
      if (dip > 0) {
        // Attribute the trough back to whichever promo caused it.
        const owner = findRecentPromo(cellPromos, weekStart)
        if (owner) {
          const lost = Math.round(baseUnits * dip)
          dipUnitsByPromo.set(owner, (dipUnitsByPromo.get(owner) ?? 0) + lost)
        }
      }
      if (cannibalDrag > 0) {
        const owner = findSubbrandPromo(promoWeeks, cell.customerId, product.subbrand, weekStart)
        if (owner) {
          const lost = Math.round(baseUnits * cannibalDrag)
          cannibalByPromo.set(owner, (cannibalByPromo.get(owner) ?? 0) + lost)
        }
      }
    })
  }

  // ── Post-event actuals for anything that has closed ──
  const eventResults: EventResult[] = []
  for (const promo of opts.promotions) {
    if (promo.status !== 'closed') continue
    const shipped = actualUnitsByPromo.get(promo.id)
    if (!shipped) continue

    const promoLines = opts.lines.filter((l) => l.promotionId === promo.id)
    const plannedSpend = promoLines.reduce((acc, l) => {
      const p = PRODUCT_BY_ID.get(l.productId)
      if (!p) return acc
      const total = l.plannedBaselineUnits + l.plannedLiftUnits
      return acc + (l.rateType === 'lump_sum' ? l.rate : spendPerCase(l.rateType, l.rate, p, total) * total)
    }, 0)

    eventResults.push({
      id: `er_${promo.id}`,
      orgId: ORG.id,
      promotionId: promo.id,
      shippedUnits: shipped,
      baselineUnits: baseUnitsByPromo.get(promo.id) ?? Math.round(shipped * 0.7),
      // Settlement rarely equals plan — usually a bit over.
      actualSpend: n4(plannedSpend * rng.normal(1.03, 0.11)),
      cannibalizedUnits: cannibalByPromo.get(promo.id) ?? 0,
      pantryLoadUnits: dipUnitsByPromo.get(promo.id) ?? 0,
    })
  }

  return { facts, eventResults, promotedWeeksByCell }
}

function findRecentPromo(
  cellPromos: Map<string, PromoWeek> | undefined,
  weekStart: string,
): string | undefined {
  if (!cellPromos) return undefined
  for (let back = 1; back <= 3; back++) {
    const hit = cellPromos.get(addWeeks(weekStart, -back))
    if (hit) return hit.promotionId
  }
  return undefined
}

function findSubbrandPromo(
  promoWeeks: Map<string, Map<string, PromoWeek>>,
  customerId: string,
  subbrand: string,
  weekStart: string,
): string | undefined {
  for (const [key, weeks] of promoWeeks) {
    if (!key.startsWith(`${customerId}|`)) continue
    const productId = key.split('|')[1]
    if (PRODUCT_BY_ID.get(productId)?.subbrand !== subbrand) continue
    const hit = weeks.get(weekStart)
    if (hit) return hit.promotionId
  }
  return undefined
}

/** Total planned spend per promotion — the figure the fund ledger commits. */
export function plannedSpendIndex(
  lines: PromotionLine[],
): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lines) {
    const p = PRODUCT_BY_ID.get(l.productId)
    if (!p) continue
    const total = l.plannedBaselineUnits + l.plannedLiftUnits
    const spend =
      l.rateType === 'lump_sum' ? l.rate : spendPerCase(l.rateType, l.rate, p, total) * total
    out.set(l.promotionId, n4((out.get(l.promotionId) ?? 0) + spend))
  }
  return out
}

/**
 * Spend that can legitimately return as a chargeback.
 *
 * Off-invoice money already came off the invoice at order entry, so a retailer
 * claiming it again is by definition a duplicate. Bounding deduction amounts by
 * this figure is what stops the seeded book of deductions exceeding the spend it
 * is supposedly settling.
 */
export function claimableSpendIndex(lines: PromotionLine[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const l of lines) {
    if (isOffInvoiceTactic(l.tactic)) continue
    const p = PRODUCT_BY_ID.get(l.productId)
    if (!p) continue
    const total = l.plannedBaselineUnits + l.plannedLiftUnits
    const spend =
      l.rateType === 'lump_sum' ? l.rate : spendPerCase(l.rateType, l.rate, p, total) * total
    out.set(l.promotionId, n4((out.get(l.promotionId) ?? 0) + spend))
  }
  return out
}

/** Which tactic codes each promotion carries — used by the deduction matcher. */
export function tacticIndex(lines: PromotionLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of lines) {
    const arr = out.get(l.promotionId)
    if (arr) {
      if (!arr.includes(l.tactic)) arr.push(l.tactic)
    } else out.set(l.promotionId, [l.tactic])
  }
  return out
}

/** Which brands each promotion covers — the matcher's product-scope signal. */
export function brandIndex(lines: PromotionLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of lines) {
    const brand = PRODUCT_BY_ID.get(l.productId)?.brand
    if (!brand) continue
    const arr = out.get(l.promotionId)
    if (arr) {
      if (!arr.includes(brand)) arr.push(brand)
    } else out.set(l.promotionId, [brand])
  }
  return out
}

export const SETTLEMENT_OF = (tactic: TacticCode) => TACTIC_BY_CODE[tactic]?.settlement
