/**
 * Market structure: who carries what, how fast it moves, and when.
 *
 * Everything downstream (sales, promotions, funds, deductions) is derived from
 * these three things, which is why a Costco promotion is naturally big and
 * lumpy while a Sprouts one is small and frequent — the shape falls out of the
 * data rather than being hand-written per screen.
 */

import { CHAIN_CUSTOMERS, PRODUCTS } from '../catalog'
import type { Product } from '../types'
import { parseISO } from '../../lib/fiscal'
import type { Rng } from '../rng'

/** Relative size of each retailer's business with us. Sums to ~1. */
export const CHAIN_SCALE: Record<string, number> = {
  cust_WMT: 0.185,
  cust_KR: 0.165,
  cust_ACI: 0.11,
  cust_CST: 0.105,
  cust_AD: 0.085,
  cust_PUB: 0.075,
  cust_HEB: 0.06,
  cust_TGT: 0.06,
  cust_UNFI: 0.055,
  cust_KEHE: 0.045,
  cust_SFM: 0.032,
  cust_WFM: 0.023,
}

/**
 * Club and mass carry a narrow assortment of big sellers; natural and
 * distributor channels carry the long tail. This is the single biggest driver
 * of why the same promotion performs differently by retailer.
 */
const ASSORTMENT_DEPTH: Record<string, number> = {
  club: 0.22,
  mass: 0.55,
  grocery: 0.78,
  natural: 0.68,
  distributor: 0.92,
  convenience: 0.3,
}

export interface MarketCell {
  customerId: string
  productId: string
  /** Cases per week at no promotion, before seasonality. */
  baseVelocity: number
  /** How responsive this cell is to a deal. */
  promoResponsiveness: number
}

export function buildAssortment(rng: Rng): MarketCell[] {
  const cells: MarketCell[] = []

  for (const chain of CHAIN_CUSTOMERS) {
    const scale = CHAIN_SCALE[chain.id] ?? 0.05
    const depth = ASSORTMENT_DEPTH[chain.channel] ?? 0.6

    // Club buys pallets of a few items; grocery buys cases of many.
    const caseMultiplier = chain.channel === 'club' ? 6.5 : chain.channel === 'mass' ? 2.2 : 1

    for (const product of PRODUCTS) {
      // Club skews to large formats; natural skews to premium subbrands.
      let carryChance = depth
      if (chain.channel === 'club' && product.casePack > 8) carryChance *= 0.35
      if (chain.channel === 'natural' && product.brand === 'Golden Hour') carryChance *= 1.25
      if (chain.channel === 'mass' && product.listPrice > 48) carryChance *= 0.6
      if (!rng.chance(Math.min(0.97, carryChance))) continue

      const brandStrength = product.brand === 'Summit Trail' ? 1.25 : product.brand === 'Golden Hour' ? 1.05 : 0.85
      // Calibrated so the tenant lands around $180M gross a year — squarely in
      // the $10M–$500M mid-market band the product targets, rather than the
      // half-billion an unscaled velocity produced.
      const base = rng.normal(1, 0.32) * scale * 2000 * brandStrength * caseMultiplier

      cells.push({
        customerId: chain.id,
        productId: product.id,
        baseVelocity: Math.max(4, Math.round(base * 10) / 10),
        promoResponsiveness: Math.max(0.55, rng.normal(1, 0.22)),
      })
    }
  }

  return cells
}

/**
 * Category seasonality by calendar month (index 0 = January), normalised so a
 * year averages 1.0. Soup sells in February; sparkling water sells in July.
 * Getting this right is what makes the baseline engine's seasonality index
 * visibly do something in the demo.
 */
const SEASONALITY: Record<string, number[]> = {
  //         Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
  Meals: [1.34, 1.36, 1.2, 1.02, 0.86, 0.72, 0.68, 0.76, 0.96, 1.12, 1.24, 1.28],
  Beverages: [0.78, 0.8, 0.9, 1.02, 1.18, 1.32, 1.4, 1.34, 1.1, 0.94, 0.86, 0.8],
  Snacks: [0.92, 0.9, 0.96, 1.0, 1.04, 1.06, 1.02, 1.18, 1.16, 1.04, 0.98, 1.1],
}

export function seasonalFactor(category: string, weekStart: string): number {
  const month = parseISO(weekStart).getUTCMonth()
  return SEASONALITY[category]?.[month] ?? 1
}

/**
 * Everyday off-invoice allowance by channel — the standing discount that comes
 * off EVERY case at order entry, before any promotion.
 *
 * Without this the model understates trade spend badly: event-driven money
 * alone is only ~4% of gross, whereas real CPG trade rates run 12–20%. Most of
 * that gap is exactly this — base allowances, EDLP support and distributor
 * margin that never appear on a promotion calendar but absolutely appear in
 * gross-to-net. Club and distributor carry the most; natural the least.
 */
const EVERYDAY_ALLOWANCE: Record<string, number> = {
  mass: 0.09,
  club: 0.11,
  grocery: 0.065,
  natural: 0.035,
  distributor: 0.1,
  convenience: 0.05,
}

export function everydayAllowanceRate(channel: string): number {
  return EVERYDAY_ALLOWANCE[channel] ?? 0.05
}

/**
 * Year-over-year trend. Summit Trail is growing, Harvest Table is flat to
 * declining — which gives the analytics screens something true to say rather
 * than a uniformly rosy picture.
 */
const BRAND_TREND: Record<string, number> = {
  'Summit Trail': 0.0022,
  'Golden Hour': 0.0035,
  'Harvest Table': -0.0008,
}

export function trendFactor(brand: string, weekIndex: number): number {
  return 1 + (BRAND_TREND[brand] ?? 0) * weekIndex
}

export const PRODUCT_BY_ID = new Map<string, Product>(PRODUCTS.map((p) => [p.id, p]))
