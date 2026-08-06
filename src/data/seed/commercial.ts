/**
 * The commercial layer: sales plan, service performance and receivables.
 *
 * Two rules shape everything here.
 *
 * 1. SEED THE RATE, DERIVE THE COUNT. Fill rate, drop size and DSO are seeded
 *    because nothing in the shipment history implies them. Cases ordered, order
 *    counts, invoice lines and AR balances are NOT seeded — they are derived at
 *    read time from actual shipped volume at those rates, so when a promotion
 *    moves in the planning grid the service and working-capital numbers move
 *    with it instead of going stale.
 *
 * 2. THE PLAN IS FIXED AND BACKWARD-LOOKING. It is last year's actual for the
 *    same fiscal period, grown at the rate that account actually grew, times an
 *    ambition factor. That is how a real annual operating plan is built, and it
 *    means attainment is an honest measurement rather than a number tuned to
 *    look good. Crucially the plan does NOT move when a promotion is edited —
 *    which is exactly why editing one changes attainment on this screen.
 *
 * This module runs on its own RNG stream. Threading it through the main seed
 * would shift every downstream random draw and change every existing figure in
 * the demo, including the ones the economics tests pin.
 */

import { CHAIN_CUSTOMERS } from '../catalog'
import { makeRng } from '../rng'
import type { Customer, FiscalWeek, ID, ISODate, Product, Promotion, PromotionLine, SalesFact } from '../types'
import { buildForecastPeriods, type ForecastPeriod } from '../../lib/calc/forecast'
import {
  buildCommercialFacts, claimedSpendByCell, rollupBy, type CommercialFact,
} from '../../lib/calc/commercial'
import { n4, safeDiv } from '../../lib/calc/money'
import { computePromotion } from '../../lib/calc/promotion'
import { addWeeks } from '../../lib/fiscal'

// ── Slice ──────────────────────────────────────────────────────────────────

export interface PeriodPlan {
  periodKey: string
  customerId: ID
  /** Net sales the annual operating plan committed to for this account. */
  netSales: number
}

export interface ServiceRates {
  periodKey: string
  customerId: ID
  /** Cases shipped ÷ cases ordered. */
  fillRate: number
  /** Orders delivered complete, on the requested day. Always below fill rate. */
  otifRate: number
  /** Average cases on a drop — turns shipped volume into an order count. */
  casesPerOrder: number
  linesPerOrder: number
}

export interface ReceivableTerms {
  customerId: ID
  /** Days sales outstanding this account actually runs at. */
  dsoDays: number
  /** Share of the balance sitting past 60 days. */
  pastDue60Share: number
}

export interface CommercialSlice {
  plan: PeriodPlan[]
  service: ServiceRates[]
  receivables: ReceivableTerms[]
  /** Finished-goods days of supply, company-wide, by period. */
  daysOfSupply: { periodKey: string; days: number }[]
  /** Periods with real shipment history, oldest first. */
  periodKeys: string[]
}

// ── Channel behaviour ──────────────────────────────────────────────────────

/**
 * Service and payment behaviour by channel. Club orders pallets and pays
 * quickly; distributors order deep assortments on long terms. These spreads are
 * what make the service panel say something rather than show one flat number
 * repeated per account.
 */
const CHANNEL_PROFILE: Record<
  Customer['channel'],
  { fill: number; otifGap: number; casesPerOrder: number; linesPerOrder: number; dso: number }
> = {
  club: { fill: 0.981, otifGap: 0.021, casesPerOrder: 640, linesPerOrder: 3.4, dso: 23 },
  mass: { fill: 0.958, otifGap: 0.035, casesPerOrder: 240, linesPerOrder: 9.2, dso: 32 },
  grocery: { fill: 0.966, otifGap: 0.028, casesPerOrder: 118, linesPerOrder: 13.6, dso: 35 },
  natural: { fill: 0.972, otifGap: 0.024, casesPerOrder: 46, linesPerOrder: 16.4, dso: 38 },
  distributor: { fill: 0.949, otifGap: 0.041, casesPerOrder: 380, linesPerOrder: 24.0, dso: 44 },
  convenience: { fill: 0.955, otifGap: 0.03, casesPerOrder: 72, linesPerOrder: 8.0, dso: 36 },
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * How much of last year's realised growth the plan carries forward.
 *
 * Not 1.0, for a reason that shows up the moment you measure it: the brand
 * trends in this data are linear, so the *percentage* growth rate decays year
 * on year. Extrapolating last year's rate at full strength sets a plan the
 * business cannot hit, and the demo ends up with twelve consecutive misses —
 * which reads as a broken plan rather than an interesting book of business.
 * Real annual planning damps momentum for the same reason.
 */
const GROWTH_CARRY = 0.5

/** Plans are set a little above where the business is heading. */
const AMBITION_MEAN = 1.02
const AMBITION_SD = 0.038

// ── Build ──────────────────────────────────────────────────────────────────

export function buildCommercial(opts: {
  seed: number
  calendar: FiscalWeek[]
  today: ISODate
  salesFacts: SalesFact[]
  promotions: Promotion[]
  promotionLines: PromotionLine[]
  products: Product[]
  customers: Customer[]
}): CommercialSlice {
  const rng = makeRng(opts.seed)

  const customersById = new Map(opts.customers.map((c) => [c.id, c]))
  const rootOf = (id: ID): ID => {
    let cur = customersById.get(id)
    while (cur?.parentId) cur = customersById.get(cur.parentId)
    return cur?.id ?? id
  }

  // Net sales history at the same definition the sales screen reports, so the
  // plan is measured against like with like.
  const facts = historicalFacts(opts, rootOf)
  const periods = buildForecastPeriods(opts.calendar, opts.today)
  const periodOfWeek = weekToPeriod(periods)
  const weeksByPeriod = new Map<string, ISODate[]>()
  for (const [week, key] of periodOfWeek) {
    const arr = weeksByPeriod.get(key)
    if (arr) arr.push(week)
    else weeksByPeriod.set(key, [week])
  }
  const weeksOf = (p: ForecastPeriod) => weeksByPeriod.get(p.key)

  const netByChainPeriod = rollupBy(facts, (f) => {
    const p = periodOfWeek.get(f.weekStart)
    return p ? `${f.chainId}|${p}` : null
  })

  const tradedWeeks = new Set(facts.map((f) => f.weekStart))
  const periodKeys = periods
    .filter((p) => (weeksOf(p) ?? []).some((w) => tradedWeeks.has(w)))
    .map((p) => p.key)

  // A period only anchors a plan if the business actually traded every week of
  // it. History starts mid-period and ends mid-period; anchoring next year's
  // plan on a stub would hand that account a plan it beats by 40% for no reason.
  const completeKeys = new Set(
    periods.filter((p) => (weeksOf(p) ?? []).every((w) => tradedWeeks.has(w))).map((p) => p.key),
  )

  const plan = buildPlan(rng, { periods, periodKeys, completeKeys, netByChainPeriod })

  const service: ServiceRates[] = []
  for (const chain of CHAIN_CUSTOMERS) {
    const profile = CHANNEL_PROFILE[chain.channel]
    // A persistent per-account bias on top of the channel norm — one retailer
    // is chronically harder to serve than its peers, which is what a service
    // review is actually about.
    const bias = rng.normal(0, 0.008)
    for (const key of periodKeys) {
      const fillRate = clamp(profile.fill + bias + rng.normal(0, 0.009), 0.9, 0.995)
      // OTIF is a strictly harder test than fill rate — complete AND on the
      // requested day — so the gap has a floor. Drawing it from a normal and
      // taking the absolute value lets it round to zero, and an OTIF equal to
      // fill rate is a number no supply chain manager would believe.
      const otifGap = Math.max(0.004, rng.normal(profile.otifGap, 0.008))
      service.push({
        periodKey: key,
        customerId: chain.id,
        fillRate: n4(fillRate),
        otifRate: n4(clamp(fillRate - otifGap, 0.82, 0.99)),
        casesPerOrder: n4(profile.casesPerOrder * rng.normal(1, 0.07)),
        linesPerOrder: n4(profile.linesPerOrder * rng.normal(1, 0.08)),
      })
    }
  }

  const receivables: ReceivableTerms[] = CHAIN_CUSTOMERS.map((chain) => ({
    customerId: chain.id,
    dsoDays: n4(clamp(CHANNEL_PROFILE[chain.channel].dso * rng.normal(1, 0.08), 14, 62)),
    pastDue60Share: n4(clamp(rng.normal(0.032, 0.016), 0.004, 0.085)),
  }))

  const daysOfSupply = periodKeys.map((periodKey) => ({
    periodKey,
    days: n4(clamp(rng.normal(41, 3.6), 28, 56)),
  }))

  return { plan, service, receivables, daysOfSupply, periodKeys }
}

/** Shipments joined to allocated trade spend — the seed's own view of history. */
function historicalFacts(
  opts: {
    salesFacts: SalesFact[]
    promotions: Promotion[]
    promotionLines: PromotionLine[]
    products: Product[]
    today: ISODate
  },
  rootOf: (id: ID) => ID,
): CommercialFact[] {
  const productsById = new Map(opts.products.map((p) => [p.id, p]))
  const linesByPromotion = new Map<string, PromotionLine[]>()
  for (const l of opts.promotionLines) {
    const arr = linesByPromotion.get(l.promotionId)
    if (arr) arr.push(l)
    else linesByPromotion.set(l.promotionId, [l])
  }

  const economics = new Map(
    opts.promotions.map((p) => [
      p.id,
      computePromotion(linesByPromotion.get(p.id) ?? [], productsById),
    ]),
  )

  return buildCommercialFacts(
    opts.salesFacts,
    claimedSpendByCell(opts.promotions, linesByPromotion, economics, rootOf, opts.today),
    rootOf,
  )
}

/** Week start → fiscal period key. */
function weekToPeriod(periods: ForecastPeriod[]): Map<ISODate, string> {
  const out = new Map<ISODate, string>()
  for (const p of periods) {
    let w = p.start
    // Periods are whole weeks by construction; walk them rather than scanning
    // the whole calendar per fact.
    while (w <= p.end) {
      out.set(w, p.key)
      w = addWeeks(w, 1)
    }
  }
  return out
}

/**
 * Last year's actual, grown at the rate the account actually grew, times an
 * ambition factor centred just above 1.
 *
 * Deriving growth from the data rather than hardcoding it is what keeps
 * attainment sane: change the seed's brand trends tomorrow and the plan follows,
 * instead of the whole company suddenly running at 140% of plan.
 */
function buildPlan(
  rng: ReturnType<typeof makeRng>,
  ctx: {
    periods: ForecastPeriod[]
    periodKeys: string[]
    /** Periods where every week traded — the only ones fit to anchor a plan. */
    completeKeys: Set<string>
    netByChainPeriod: Map<string, { netSales: number }>
  },
): PeriodPlan[] {
  const periodByKey = new Map(ctx.periods.map((p) => [p.key, p]))

  // Prior fiscal year, same period number — the like-for-like comparison a
  // 4-4-5 calendar exists to make possible.
  const priorKey = (key: string): string | undefined => {
    const p = periodByKey.get(key)
    if (!p) return undefined
    return `FY${String(p.fiscalYear - 1).slice(2)} P${String(p.period).padStart(2, '0')}`
  }

  const net = (chainId: string, key: string): number | undefined =>
    ctx.netByChainPeriod.get(`${chainId}|${key}`)?.netSales

  /** Anchor pairs: a complete period whose prior year is also complete. */
  const growthPairs = ctx.periodKeys.filter((k) => {
    const prev = priorKey(k)
    return ctx.completeKeys.has(k) && prev !== undefined && ctx.completeKeys.has(prev)
  })
  const firstComplete = ctx.periodKeys.find((k) => ctx.completeKeys.has(k))

  const out: PeriodPlan[] = []

  for (const chain of CHAIN_CUSTOMERS) {
    // Realised growth: the most recent full year against the one before it.
    let recent = 0
    let base = 0
    for (const k of growthPairs) {
      recent += net(chain.id, k) ?? 0
      base += net(chain.id, priorKey(k)!) ?? 0
    }
    const growth = clamp(safeDiv(recent - base, base) ?? 0.03, -0.1, 0.2)

    // Fallback for the earliest periods, which have no prior year to grow from.
    const weeklyAverage = firstComplete
      ? (net(chain.id, firstComplete) ?? 0)
        / Math.max(1, periodByKey.get(firstComplete)?.weeks ?? 4)
      : 0

    for (const key of ctx.periodKeys) {
      const prev = priorKey(key)
      const priorActual = prev && ctx.completeKeys.has(prev) ? net(chain.id, prev) : undefined
      const period = periodByKey.get(key)
      const fallback = weeklyAverage * (period?.weeks ?? 4)
      const anchor = priorActual ?? fallback
      if (anchor <= 0) continue

      const ambition = clamp(rng.normal(AMBITION_MEAN, AMBITION_SD), 0.94, 1.16)
      out.push({
        periodKey: key,
        customerId: chain.id,
        netSales: n4(anchor * (1 + growth * GROWTH_CARRY) * ambition),
      })
    }
  }

  return out
}
