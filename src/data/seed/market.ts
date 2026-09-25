/**
 * Market structure: who carries what, how fast it moves, and when.
 *
 * Everything downstream (sales, promotions, funds, deductions) is derived from
 * these three things, which is why a Summit Club promotion is naturally big and
 * lumpy while a Green Cart one is small and frequent — the shape falls out of
 * the data rather than being hand-written per screen.
 */

import { CHAIN_CUSTOMERS, PRODUCTS } from '../catalog'
import type { Product } from '../types'
import { parseISO } from '../../lib/fiscal'
import type { Rng } from '../rng'

/** Relative size of each account's business with us. Sums to ~1. */
export const CHAIN_SCALE: Record<string, number> = {
  cust_NWF: 0.17,
  cust_GLG: 0.14,
  cust_VPM: 0.13,
  cust_SCS: 0.11,
  cust_MFS: 0.09,
  cust_RBS: 0.075,
  cust_PFM: 0.06,
  cust_MFM: 0.055,
  cust_EFD: 0.05,
  cust_CCG: 0.045,
  cust_LNF: 0.04,
  cust_GCC: 0.025,
}

/**
 * Club and mass carry a narrow assortment of big sellers; natural and
 * distributor channels carry the long tail. This is the single biggest driver
 * of why the same promotion performs differently by retailer.
 */
const ASSORTMENT_DEPTH: Record<string, number> = {
  club: 0.3,
  mass: 0.6,
  grocery: 0.82,
  natural: 0.7,
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

/**
 * Calibrated so the tenant lands near the $212M the Bluestem company profile
 * states — squarely in the mid-market band, and the same top line the sibling
 * Bluestem apps quote.
 */
const VELOCITY_SCALE = 4400

export function buildAssortment(rng: Rng): MarketCell[] {
  const cells: MarketCell[] = []

  for (const chain of CHAIN_CUSTOMERS) {
    const scale = CHAIN_SCALE[chain.id] ?? 0.05
    const depth = ASSORTMENT_DEPTH[chain.channel] ?? 0.6

    // Club buys pallets of a few items; grocery buys cases of many.
    const caseMultiplier = chain.channel === 'club' ? 6.5 : chain.channel === 'mass' ? 2.2 : 1

    for (const product of PRODUCTS) {
      // Club skews to large formats and bulk cartons; natural skews to
      // fresh-cut and salads; mass avoids the premium fresh-cut price points.
      let carryChance = depth
      if (chain.channel === 'club' && product.casePack > 8 && product.casePack < 80) carryChance *= 0.45
      if (chain.channel === 'natural' && product.brand === 'Bluestem Fresh Cuts') carryChance *= 1.25
      if (chain.channel === 'mass' && product.listPrice > 32) carryChance *= 0.6
      if (!rng.chance(Math.min(0.97, carryChance))) continue

      const brandStrength =
        product.brand === 'Bluestem Orchard' ? 1.15
          : product.brand === 'Bluestem Fields' ? 1.0
            : 0.85
      const base = rng.normal(1, 0.32) * scale * VELOCITY_SCALE * brandStrength * caseMultiplier

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
 * Seasonality by calendar month (index 0 = January), normalised so a year
 * averages 1.0, keyed by sub-brand because produce seasonality is a crop
 * property: Michigan asparagus is a May–June business, blueberries and cherries
 * peak in July, apples in the fall, and fresh-cut trays spike around the
 * holidays. Winter volume from partner growers in California, Arizona and
 * Mexico keeps every line trading all year. Getting this right is what makes
 * the baseline engine's seasonality index visibly do something in the demo.
 */
const SEASONALITY: Record<string, number[]> = {
  //                 Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
  'Apples':          [1.05, 0.95, 0.9, 0.85, 0.8, 0.75, 0.75, 0.9, 1.25, 1.35, 1.3, 1.15],
  'Berries':         [0.7, 0.7, 0.75, 0.85, 1.0, 1.3, 1.6, 1.5, 1.15, 0.9, 0.8, 0.75],
  'Cherries':        [0.6, 0.6, 0.65, 0.75, 0.95, 1.55, 2.05, 1.65, 1.05, 0.85, 0.7, 0.6],
  'Vegetables':      [0.8, 0.8, 0.85, 0.95, 1.1, 1.15, 1.2, 1.25, 1.2, 1.05, 0.85, 0.8],
  'Leafy Greens':    [0.9, 0.9, 0.95, 1.0, 1.1, 1.15, 1.15, 1.1, 1.0, 0.95, 0.9, 0.9],
  'Cut Apples':      [1.0, 1.0, 0.95, 0.9, 0.9, 0.85, 0.85, 1.15, 1.25, 1.15, 1.05, 0.95],
  'Vegetable Blends': [1.15, 1.1, 1.05, 0.95, 0.9, 0.85, 0.85, 0.9, 1.0, 1.1, 1.1, 1.05],
  'Salads':          [0.85, 0.9, 1.0, 1.1, 1.15, 1.15, 1.15, 1.1, 1.0, 0.9, 0.85, 0.85],
  'Fruit Cups':      [0.95, 0.95, 0.95, 0.95, 0.9, 0.85, 0.85, 1.15, 1.25, 1.15, 1.05, 1.0],
  'Trays':           [1.2, 1.25, 0.95, 0.9, 0.95, 1.0, 1.0, 0.9, 0.85, 0.9, 1.0, 1.1],
}

export function seasonalFactor(subbrand: string, weekStart: string): number {
  const month = parseISO(weekStart).getUTCMonth()
  return SEASONALITY[subbrand]?.[month] ?? 1
}

/**
 * Everyday off-invoice allowance by channel — the standing discount that comes
 * off EVERY case at order entry, before any promotion.
 *
 * Without this the model understates trade spend badly: event-driven money
 * alone is only a few points of gross, whereas a produce supplier's real
 * gross-to-net runs 8–15%. Most of that gap is exactly this — base allowances,
 * EDLP support and distributor margin that never appear on a promotion
 * calendar but absolutely appear in gross-to-net. Club and distributor carry
 * the most; natural the least.
 */
const EVERYDAY_ALLOWANCE: Record<string, number> = {
  mass: 0.085,
  club: 0.105,
  grocery: 0.06,
  natural: 0.035,
  distributor: 0.095,
  convenience: 0.05,
}

export function everydayAllowanceRate(channel: string): number {
  return EVERYDAY_ALLOWANCE[channel] ?? 0.05
}

/**
 * Year-over-year trend. Fresh Cuts is growing, Orchard is steady, Fields is
 * flat to declining — which gives the analytics screens something true to say
 * rather than a uniformly rosy picture.
 */
const BRAND_TREND: Record<string, number> = {
  'Bluestem Orchard': 0.0012,
  'Bluestem Fields': -0.0008,
  'Bluestem Fresh Cuts': 0.0035,
}

export function trendFactor(brand: string, weekIndex: number): number {
  return 1 + (BRAND_TREND[brand] ?? 0) * weekIndex
}

export const PRODUCT_BY_ID = new Map<string, Product>(PRODUCTS.map((p) => [p.id, p]))
