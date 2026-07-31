/**
 * Promotion generation.
 *
 * Six dates per promotion, all different and all load-bearing — the buy window
 * (when the customer may order on deal), the ship window, and the perform
 * window (when it is on shelf). Deduction matching keys off the PERFORM window,
 * because that is when the retailer's scan data says the money was earned.
 */

import { CHAIN_CUSTOMERS, ORG, USERS } from '../catalog'
import { TACTICS } from '../tactics'
import type {
  Promotion,
  PromotionLine,
  PromotionStatus,
  PromotionStatusEvent,
  RateType,
  TacticCode,
} from '../types'
import { addDays, diffWeeks } from '../../lib/fiscal'
import type { Rng } from '../rng'
import { CHAIN_SCALE, PRODUCT_BY_ID, type MarketCell } from './market'

const KAM_BY_CHAIN: Record<string, string> = {
  cust_WMT: 'u_tom', cust_KR: 'u_priya', cust_ACI: 'u_priya', cust_CST: 'u_tom',
  cust_AD: 'u_sasha', cust_PUB: 'u_sasha', cust_HEB: 'u_priya', cust_TGT: 'u_tom',
  cust_UNFI: 'u_sasha', cust_KEHE: 'u_sasha', cust_SFM: 'u_priya', cust_WFM: 'u_priya',
}

/** Which tactics each channel actually runs. Costco does not run TPRs. */
const CHANNEL_TACTICS: Record<string, [TacticCode, number][]> = {
  mass: [['off_invoice', 3], ['bill_back', 3], ['tpr', 2], ['feature', 2], ['display', 2], ['rebate', 1], ['edlp', 2]],
  club: [['off_invoice', 4], ['bogo', 1], ['display', 3], ['mdf', 2], ['listing', 1], ['rebate', 2]],
  grocery: [['scan_back', 3], ['tpr', 4], ['feature', 3], ['display', 3], ['feature_display', 3], ['bill_back', 3], ['off_invoice', 2], ['coupon', 1], ['bogo', 1]],
  natural: [['tpr', 3], ['scan_back', 3], ['sampling', 2], ['feature', 2], ['mdf', 1], ['coupon', 1]],
  distributor: [['off_invoice', 4], ['bill_back', 3], ['slotting', 1], ['listing', 1], ['rebate', 2]],
  convenience: [['off_invoice', 3], ['tpr', 2]],
}

const RATE_TYPE_FOR: Record<string, [RateType, number][]> = {
  slotting: [['lump_sum', 1]],
  listing: [['lump_sum', 1]],
  mdf: [['lump_sum', 1]],
  sampling: [['lump_sum', 1]],
  display: [['lump_sum', 2], ['per_case', 3]],
  feature: [['lump_sum', 2], ['per_case', 3]],
  feature_display: [['lump_sum', 2], ['per_case', 3]],
}
const DEFAULT_RATE_TYPES: [RateType, number][] = [
  ['per_case', 5], ['pct_of_list', 3], ['per_unit', 1],
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export interface PromoSeedResult {
  promotions: Promotion[]
  lines: PromotionLine[]
  statusEvents: PromotionStatusEvent[]
}

export function buildPromotions(
  rng: Rng,
  opts: {
    count: number
    weekStarts: string[]
    today: string
    cellsByCustomer: Map<string, MarketCell[]>
    fundIdFor: (customerId: string, date: string, tactic: TacticCode) => string
  },
): PromoSeedResult {
  const promotions: Promotion[] = []
  const lines: PromotionLine[] = []
  const statusEvents: PromotionStatusEvent[] = []

  const chainWeights = CHAIN_CUSTOMERS.map(
    (c) => [c, CHAIN_SCALE[c.id] ?? 0.05] as const,
  )

  // Promotions cluster in the plannable window: the trailing two years of
  // history plus roughly two quarters forward.
  const plannable = opts.weekStarts.filter((w) => w >= opts.weekStarts[8])

  for (let i = 0; i < opts.count; i++) {
    const chain = rng.weighted(chainWeights)
    const cells = opts.cellsByCustomer.get(chain.id) ?? []
    if (cells.length === 0) continue

    const performStart = rng.pick(plannable)
    const durationWeeks = rng.weighted([[2, 3], [3, 4], [4, 4], [6, 2], [8, 1]])
    const performEnd = addDays(performStart, durationWeeks * 7 - 1)

    // Ship ahead of shelf; buy ahead of ship. Real windows, real overlap.
    const shipStart = addDays(performStart, -rng.int(10, 21))
    const shipEnd = addDays(performEnd, -rng.int(3, 10))
    const buyStart = addDays(shipStart, -rng.int(7, 21))
    const buyEnd = addDays(shipEnd, -rng.int(3, 10))

    const tacticPool = CHANNEL_TACTICS[chain.channel] ?? CHANNEL_TACTICS.grocery
    const primaryTactic = rng.weighted(tacticPool)

    const status = statusFor(rng, performStart, performEnd, opts.today)
    const owner = KAM_BY_CHAIN[chain.id] ?? 'u_priya'

    // Lines cluster on one brand — planners promote a brand, not a random SKU set.
    const brandCells = pickBrandCells(rng, cells)
    const lineCount = Math.min(brandCells.length, rng.weighted([[3, 2], [5, 4], [8, 6], [10, 5], [14, 3], [18, 1]]))
    if (lineCount === 0) continue

    const chosen = rng.shuffle(brandCells).slice(0, lineCount)
    const brand = PRODUCT_BY_ID.get(chosen[0].productId)?.brand ?? 'Summit Trail'
    const monthLabel = MONTHS[new Date(`${performStart}T00:00:00Z`).getUTCMonth()]
    const year = performStart.slice(2, 4)

    const code = `PRM-${chain.code}-${year}${String(i).padStart(3, '0')}`
    const tacticName = TACTICS.find((t) => t.code === primaryTactic)?.name ?? primaryTactic

    const promo: Promotion = {
      id: `promo_${i}`,
      orgId: ORG.id,
      code,
      name: `${brand} ${tacticName} — ${monthLabel} ${performStart.slice(0, 4)}`,
      customerId: chain.id,
      status,
      buyStart, buyEnd, shipStart, shipEnd, performStart, performEnd,
      fundId: opts.fundIdFor(chain.id, performStart, primaryTactic),
      ownerId: owner,
      createdAt: addDays(buyStart, -rng.int(14, 60)),
      notes: rng.chance(0.18) ? rng.pick(NOTES) : undefined,
    }

    if (status !== 'draft') promo.submittedAt = addDays(promo.createdAt, rng.int(1, 9))
    if (['approved', 'active', 'closed'].includes(status)) {
      promo.approvedAt = addDays(promo.submittedAt!, rng.int(1, 6))
      promo.approvedBy = rng.pick(['u_marcus', 'u_carol', 'u_dana'])
    }

    promotions.push(promo)
    statusEvents.push(...buildStatusEvents(promo))

    for (const cell of chosen) {
      const product = PRODUCT_BY_ID.get(cell.productId)!
      const tactic = rng.chance(0.75) ? primaryTactic : rng.weighted(tacticPool)
      const rateType = rng.weighted(RATE_TYPE_FOR[tactic] ?? DEFAULT_RATE_TYPES)

      const weeks = durationWeeks
      const baselineUnits = Math.round(cell.baseVelocity * weeks)
      const tacticLift = TACTICS.find((t) => t.code === tactic)?.typicalLift ?? 1.3
      const liftMultiplier = 1 + (tacticLift - 1) * cell.promoResponsiveness * rng.float(0.65, 1.35)
      const liftUnits = Math.round(baselineUnits * (liftMultiplier - 1))

      lines.push({
        id: `pl_${lines.length}`,
        orgId: ORG.id,
        promotionId: promo.id,
        productId: product.id,
        tactic,
        rateType,
        rate: rateFor(rng, rateType, product.listPrice, baselineUnits + liftUnits),
        plannedBaselineUnits: baselineUnits,
        plannedLiftUnits: Math.max(0, liftUnits),
        promoRetailPrice: Math.round((product.listPrice / product.casePack) * rng.float(1.18, 1.42) * 100) / 100,
      })
    }
  }

  return { promotions, lines, statusEvents }
}

const NOTES = [
  'Customer requested extension after the Q2 reset.',
  'Tied to the retailer summer merchandising event.',
  'Replaces the cancelled display program.',
  'Buyer confirmed ad placement in the weekly circular.',
  'Volume commitment agreed verbally — get it in writing before close.',
]

/** Cells sharing one brand, so a promotion reads like a real brand program. */
function pickBrandCells(rng: Rng, cells: MarketCell[]): MarketCell[] {
  const brands = [...new Set(cells.map((c) => PRODUCT_BY_ID.get(c.productId)?.brand).filter(Boolean))]
  if (brands.length === 0) return cells
  const brand = rng.pick(brands)
  const scoped = cells.filter((c) => PRODUCT_BY_ID.get(c.productId)?.brand === brand)
  return scoped.length > 0 ? scoped : cells
}

function rateFor(rng: Rng, rateType: RateType, listPrice: number, totalUnits: number): number {
  switch (rateType) {
    case 'per_case':
      return Math.round(listPrice * rng.float(0.12, 0.32) * 100) / 100
    case 'pct_of_list':
      return Math.round(rng.float(0.1, 0.28) * 1000) / 1000
    case 'per_unit':
      return Math.round(rng.float(0.15, 0.85) * 100) / 100
    case 'lump_sum':
      return Math.round(Math.max(1500, totalUnits * rng.float(0.9, 3.2)) / 50) * 50
  }
}

function statusFor(rng: Rng, performStart: string, performEnd: string, today: string): PromotionStatus {
  if (rng.chance(0.035)) return 'cancelled'
  if (performEnd < today) return 'closed'
  if (performStart <= today) return 'active'

  const weeksOut = diffWeeks(today, performStart)
  if (weeksOut <= 4) return rng.weighted([['approved', 7], ['submitted', 2], ['draft', 1]])
  if (weeksOut <= 10) return rng.weighted([['approved', 4], ['submitted', 4], ['draft', 3]])
  return rng.weighted([['draft', 6], ['submitted', 3], ['approved', 1]])
}

function buildStatusEvents(p: Promotion): PromotionStatusEvent[] {
  const evts: PromotionStatusEvent[] = []
  const push = (from: PromotionStatus | null, to: PromotionStatus, at: string, actorId: string, note?: string) =>
    evts.push({ id: `se_${p.id}_${evts.length}`, promotionId: p.id, from, to, at: `${at}T09:00:00Z`, actorId, note })

  push(null, 'draft', p.createdAt, p.ownerId, 'Created from last year’s plan')
  if (p.submittedAt) push('draft', 'submitted', p.submittedAt, p.ownerId)
  if (p.approvedAt) push('submitted', 'approved', p.approvedAt, p.approvedBy ?? 'u_marcus', 'Within fund balance and ROI threshold')
  if (p.status === 'active' || p.status === 'closed') push('approved', 'active', p.performStart, 'u_dana')
  if (p.status === 'closed') push('active', 'closed', addDays(p.performEnd, 7), 'u_marcus', 'Actuals posted; event settled')
  if (p.status === 'cancelled') push(p.approvedAt ? 'approved' : 'submitted', 'cancelled', addDays(p.createdAt, 21), p.ownerId, 'Buyer pulled the event')
  return evts
}

export const USER_BY_ID = new Map(USERS.map((u) => [u.id, u]))
