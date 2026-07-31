/**
 * Static master data for the demo tenant.
 *
 * The manufacturer ("Cascade Pantry Co.") is fictional — it is the prospect
 * stand-in. The retailers are real names because trade-promotion people think
 * in terms of Kroger and Albertsons; abstract names ("Retailer A") make a TPM
 * demo read as a toy. Nothing here is a real commercial record — it is
 * generated demo data and the app labels it as such.
 */

import type { Customer, Org, Product, ReasonCode, User } from './types'

export const ORG: Org = {
  id: 'org_cascade',
  name: 'Cascade Pantry Co.',
  baseCurrency: 'USD',
  fiscalCalendar: '4-4-5',
  fiscalYearStart: '2024-01-01',
  accrualGlAccount: '2140 — Trade Promotion Accrual',
}

export const USERS: User[] = [
  { id: 'u_dana', orgId: ORG.id, name: 'Dana Whitfield', email: 'dana.whitfield@cascadepantry.example', role: 'admin', initials: 'DW' },
  { id: 'u_marcus', orgId: ORG.id, name: 'Marcus Reyes', email: 'marcus.reyes@cascadepantry.example', role: 'finance', initials: 'MR' },
  { id: 'u_priya', orgId: ORG.id, name: 'Priya Nadkarni', email: 'priya.nadkarni@cascadepantry.example', role: 'kam', initials: 'PN' },
  { id: 'u_tom', orgId: ORG.id, name: 'Tom Beaulieu', email: 'tom.beaulieu@cascadepantry.example', role: 'kam', initials: 'TB' },
  { id: 'u_sasha', orgId: ORG.id, name: 'Sasha Lindqvist', email: 'sasha.lindqvist@cascadepantry.example', role: 'kam', initials: 'SL' },
  { id: 'u_ben', orgId: ORG.id, name: 'Ben Okonkwo', email: 'ben.okonkwo@cascadepantry.example', role: 'demand_planner', initials: 'BO' },
  { id: 'u_carol', orgId: ORG.id, name: 'Carol Zhu', email: 'carol.zhu@cascadepantry.example', role: 'finance', initials: 'CZ' },
]

export const CURRENT_USER_ID = 'u_priya'

type ChainSpec = {
  code: string
  name: string
  channel: Customer['channel']
  region: string
  banners: { code: string; name: string; region: string }[]
}

const CHAINS: ChainSpec[] = [
  {
    code: 'KR', name: 'Kroger Co.', channel: 'grocery', region: 'National',
    banners: [
      { code: 'KR-MKT', name: 'Kroger Marketplace', region: 'Midwest' },
      { code: 'KR-FM', name: 'Fred Meyer', region: 'Northwest' },
      { code: 'KR-KS', name: 'King Soopers', region: 'Mountain' },
      { code: 'KR-RA', name: 'Ralphs', region: 'West' },
    ],
  },
  {
    code: 'ACI', name: 'Albertsons Companies', channel: 'grocery', region: 'National',
    banners: [
      { code: 'ACI-SW', name: 'Safeway', region: 'West' },
      { code: 'ACI-JO', name: 'Jewel-Osco', region: 'Midwest' },
      { code: 'ACI-VN', name: 'Vons', region: 'Southwest' },
    ],
  },
  {
    code: 'AD', name: 'Ahold Delhaize USA', channel: 'grocery', region: 'East',
    banners: [
      { code: 'AD-SS', name: 'Stop & Shop', region: 'Northeast' },
      { code: 'AD-FL', name: 'Food Lion', region: 'Southeast' },
      { code: 'AD-GI', name: 'Giant Food', region: 'Mid-Atlantic' },
    ],
  },
  {
    code: 'WMT', name: 'Walmart Inc.', channel: 'mass', region: 'National',
    banners: [
      { code: 'WMT-SC', name: 'Walmart Supercenter', region: 'National' },
      { code: 'WMT-NM', name: 'Walmart Neighborhood Market', region: 'National' },
    ],
  },
  { code: 'PUB', name: 'Publix Super Markets', channel: 'grocery', region: 'Southeast', banners: [{ code: 'PUB-CORE', name: 'Publix', region: 'Southeast' }] },
  { code: 'HEB', name: 'H-E-B', channel: 'grocery', region: 'Texas', banners: [{ code: 'HEB-CORE', name: 'H-E-B', region: 'Texas' }, { code: 'HEB-CP', name: 'Central Market', region: 'Texas' }] },
  { code: 'TGT', name: 'Target Corp.', channel: 'mass', region: 'National', banners: [{ code: 'TGT-CORE', name: 'Target', region: 'National' }] },
  { code: 'CST', name: 'Costco Wholesale', channel: 'club', region: 'National', banners: [{ code: 'CST-CORE', name: 'Costco', region: 'National' }] },
  { code: 'SFM', name: 'Sprouts Farmers Market', channel: 'natural', region: 'West', banners: [{ code: 'SFM-CORE', name: 'Sprouts', region: 'West' }] },
  { code: 'WFM', name: 'Whole Foods Market', channel: 'natural', region: 'National', banners: [{ code: 'WFM-CORE', name: 'Whole Foods', region: 'National' }] },
  { code: 'UNFI', name: 'UNFI', channel: 'distributor', region: 'National', banners: [{ code: 'UNFI-E', name: 'UNFI East', region: 'East' }, { code: 'UNFI-W', name: 'UNFI West', region: 'West' }] },
  { code: 'KEHE', name: 'KeHE Distributors', channel: 'distributor', region: 'National', banners: [{ code: 'KEHE-CORE', name: 'KeHE', region: 'National' }] },
]

function buildCustomers(): Customer[] {
  const out: Customer[] = []
  for (const chain of CHAINS) {
    const chainId = `cust_${chain.code}`
    out.push({
      id: chainId,
      orgId: ORG.id,
      parentId: null,
      level: 'chain',
      name: chain.name,
      code: chain.code,
      channel: chain.channel,
      region: chain.region,
      externalIds: { d365: `US-${chain.code}`, netsuite: `${chain.code}00` },
    })
    for (const b of chain.banners) {
      out.push({
        id: `cust_${b.code}`,
        orgId: ORG.id,
        parentId: chainId,
        level: 'banner',
        name: b.name,
        code: b.code,
        channel: chain.channel,
        region: b.region,
        externalIds: { d365: `US-${b.code}`, netsuite: `${b.code.replace('-', '')}` },
      })
    }
  }
  return out
}

export const CUSTOMERS: Customer[] = buildCustomers()

/** The 12 chains — the grain most planning and reporting happens at. */
export const CHAIN_CUSTOMERS = CUSTOMERS.filter((c) => c.level === 'chain')
export const BANNER_CUSTOMERS = CUSTOMERS.filter((c) => c.level === 'banner')

type SkuSpec = [name: string, casePack: number, listPrice: number, cogsPct: number, weight: number]

const PRODUCT_LINES: {
  category: string
  brand: string
  subbrand: string
  skus: SkuSpec[]
}[] = [
  {
    category: 'Snacks', brand: 'Summit Trail', subbrand: 'Trail Mix',
    skus: [
      ['Summit Trail Original Trail Mix 8oz', 12, 34.2, 0.58, 6.0],
      ['Summit Trail Dark Chocolate Trail Mix 8oz', 12, 36.6, 0.6, 6.0],
      ['Summit Trail Tropical Trail Mix 8oz', 12, 35.4, 0.59, 6.0],
      ['Summit Trail Original Trail Mix 22oz', 8, 51.2, 0.56, 11.0],
      ['Summit Trail Cranberry Almond 8oz', 12, 36.0, 0.61, 6.0],
    ],
  },
  {
    category: 'Snacks', brand: 'Summit Trail', subbrand: 'Protein Bars',
    skus: [
      ['Summit Trail Peanut Butter Bar 12ct', 6, 41.4, 0.52, 5.6],
      ['Summit Trail Chocolate Sea Salt Bar 12ct', 6, 41.4, 0.52, 5.6],
      ['Summit Trail Almond Honey Bar 12ct', 6, 41.4, 0.53, 5.6],
      ['Summit Trail Berry Oat Bar 12ct', 6, 40.2, 0.54, 5.6],
      ['Summit Trail Variety Bar 24ct', 4, 55.6, 0.5, 7.4],
    ],
  },
  {
    category: 'Snacks', brand: 'Summit Trail', subbrand: 'Nut Butter Cups',
    skus: [
      ['Summit Trail PB Cups Dark 4.2oz', 12, 38.9, 0.55, 3.4],
      ['Summit Trail PB Cups Milk 4.2oz', 12, 38.9, 0.55, 3.4],
      ['Summit Trail Almond Butter Cups 4.2oz', 12, 42.1, 0.57, 3.4],
      ['Summit Trail PB Cups Minis 8oz', 10, 44.5, 0.56, 5.4],
    ],
  },
  {
    category: 'Beverages', brand: 'Golden Hour', subbrand: 'Sparkling Water',
    skus: [
      ['Golden Hour Sparkling Grapefruit 12pk', 2, 23.8, 0.47, 18.0],
      ['Golden Hour Sparkling Lime 12pk', 2, 23.8, 0.47, 18.0],
      ['Golden Hour Sparkling Black Cherry 12pk', 2, 23.8, 0.47, 18.0],
      ['Golden Hour Sparkling Peach 12pk', 2, 23.8, 0.48, 18.0],
      ['Golden Hour Sparkling Variety 24pk', 1, 21.4, 0.46, 18.0],
    ],
  },
  {
    category: 'Beverages', brand: 'Golden Hour', subbrand: 'Cold Brew',
    skus: [
      ['Golden Hour Cold Brew Black 11oz', 12, 46.8, 0.51, 9.2],
      ['Golden Hour Cold Brew Oat Latte 11oz', 12, 49.2, 0.53, 9.4],
      ['Golden Hour Cold Brew Vanilla 11oz', 12, 49.2, 0.53, 9.4],
      ['Golden Hour Cold Brew Concentrate 32oz', 6, 53.4, 0.49, 13.5],
    ],
  },
  {
    category: 'Beverages', brand: 'Golden Hour', subbrand: 'Botanical Soda',
    skus: [
      ['Golden Hour Ginger Botanical 4pk', 6, 31.2, 0.5, 8.4],
      ['Golden Hour Hibiscus Botanical 4pk', 6, 31.2, 0.5, 8.4],
      ['Golden Hour Yuzu Botanical 4pk', 6, 32.4, 0.51, 8.4],
      ['Golden Hour Botanical Variety 8pk', 3, 33.6, 0.49, 8.6],
    ],
  },
  {
    category: 'Meals', brand: 'Harvest Table', subbrand: 'Soups',
    skus: [
      ['Harvest Table Tomato Basil Soup 16oz', 12, 39.6, 0.55, 12.6],
      ['Harvest Table Butternut Squash Soup 16oz', 12, 41.4, 0.56, 12.6],
      ['Harvest Table Chicken Wild Rice Soup 16oz', 12, 43.8, 0.58, 12.6],
      ['Harvest Table Lentil Soup 16oz', 12, 38.4, 0.54, 12.6],
      ['Harvest Table Corn Chowder 16oz', 12, 41.4, 0.57, 12.6],
    ],
  },
  {
    category: 'Meals', brand: 'Harvest Table', subbrand: 'Pasta Sauce',
    skus: [
      ['Harvest Table Marinara 24oz', 12, 36.6, 0.52, 19.2],
      ['Harvest Table Vodka Sauce 24oz', 12, 43.2, 0.55, 19.2],
      ['Harvest Table Arrabbiata 24oz', 12, 39.0, 0.53, 19.2],
      ['Harvest Table Roasted Garlic 24oz', 12, 38.4, 0.53, 19.2],
      ['Harvest Table Basil Pesto 8oz', 12, 52.8, 0.6, 7.2],
    ],
  },
  {
    category: 'Meals', brand: 'Harvest Table', subbrand: 'Broths',
    skus: [
      ['Harvest Table Chicken Broth 32oz', 12, 32.4, 0.5, 25.5],
      ['Harvest Table Vegetable Broth 32oz', 12, 30.6, 0.49, 25.5],
      ['Harvest Table Bone Broth 32oz', 12, 51.6, 0.58, 25.5],
    ],
  },
]

function buildProducts(): Product[] {
  const out: Product[] = []
  let n = 100
  for (const line of PRODUCT_LINES) {
    for (const [name, casePack, listPrice, cogsPct, weight] of line.skus) {
      n += 1
      const sku = `${line.brand.split(' ').map((w) => w[0]).join('')}${n}`
      out.push({
        id: `prod_${sku}`,
        orgId: ORG.id,
        sku,
        name,
        category: line.category,
        brand: line.brand,
        subbrand: line.subbrand,
        casePack,
        baseUom: 'CS',
        listPrice,
        cogs: Math.round(listPrice * cogsPct * 100) / 100,
        netWeightLb: weight,
        status: 'active',
      })
    }
  }
  return out
}

export const PRODUCTS: Product[] = buildProducts()
export const BRANDS = [...new Set(PRODUCTS.map((p) => p.brand))]
export const CATEGORIES = [...new Set(PRODUCTS.map((p) => p.category))]

/**
 * Per-customer reason code mapping. Every retailer uses different codes for
 * the same thing — this table is why an analyst can stop translating by hand,
 * and the unmapped codes below are deliberate: they drive the "map this code"
 * moment in the demo.
 */
const RAW_REASON_CODES: [chain: string, code: string, label: string, canonical: ReasonCode['canonical']][] = [
  ['KR', '501', 'Promotional Allowance', 'trade_promotion'],
  ['KR', '512', 'Ad Fee / Feature', 'trade_promotion'],
  ['KR', '533', 'Scan Deal Settlement', 'trade_promotion'],
  ['KR', '240', 'Shortage — Case', 'shortage'],
  ['KR', '260', 'Unsaleable / Damage', 'damages'],
  ['KR', '810', 'Vendor Compliance — ASN', 'compliance_fine'],
  ['ACI', 'PA-01', 'Promotion Allowance', 'trade_promotion'],
  ['ACI', 'PA-07', 'Display Support', 'trade_promotion'],
  ['ACI', 'SH-12', 'Receiving Shortage', 'shortage'],
  ['ACI', 'PR-04', 'Price Discrepancy', 'pricing'],
  ['ACI', 'FR-02', 'Freight Adjustment', 'freight'],
  ['AD', 'TPR', 'Temporary Price Reduction', 'trade_promotion'],
  ['AD', 'MKT', 'Marketing Support', 'trade_promotion'],
  ['AD', 'SHT', 'Short Ship', 'shortage'],
  ['AD', 'RTV', 'Return to Vendor', 'returns'],
  ['WMT', '25', 'Promotional Allowance', 'trade_promotion'],
  ['WMT', '22', 'Billback Deal', 'trade_promotion'],
  ['WMT', '10', 'Concealed Shortage', 'shortage'],
  ['WMT', '92', 'OTIF Fine', 'compliance_fine'],
  ['PUB', 'AD1', 'Ad Allowance', 'trade_promotion'],
  ['PUB', 'DSP', 'Display Allowance', 'trade_promotion'],
  ['PUB', 'SHG', 'Shortage', 'shortage'],
  ['HEB', 'TP', 'Trade Promo Settlement', 'trade_promotion'],
  ['HEB', 'DM', 'Damage Allowance', 'damages'],
  ['TGT', 'MKD', 'Markdown Support', 'trade_promotion'],
  ['TGT', 'VCP', 'Vendor Compliance Penalty', 'compliance_fine'],
  ['CST', 'MVM', 'MVM Promotion', 'trade_promotion'],
  ['CST', 'RB', 'Instant Rebate', 'trade_promotion'],
  ['SFM', 'PRM', 'Promotion', 'trade_promotion'],
  ['WFM', 'WFP', 'Whole Foods Promo', 'trade_promotion'],
  ['UNFI', 'DA', 'Deal Allowance', 'trade_promotion'],
  ['UNFI', 'SPL', 'Spoilage', 'damages'],
  ['KEHE', 'PROMO', 'Promotional Deal', 'trade_promotion'],
  // Deliberately ambiguous — these drive the "unclassified code" queue.
  ['KR', '599', 'Misc Allowance', 'unknown'],
  ['WMT', '99', 'Other Adjustment', 'unknown'],
]

export const REASON_CODES: ReasonCode[] = RAW_REASON_CODES.flatMap(
  ([chain, code, label, canonical], i) => {
    const chainCustomer = CUSTOMERS.find((c) => c.code === chain)!
    const banners = CUSTOMERS.filter((c) => c.parentId === chainCustomer.id)
    // Codes apply across the whole family; store one row per node so the
    // per-customer mapping table looks like the real thing.
    return [chainCustomer, ...banners].map((c, j) => ({
      id: `rc_${i}_${j}`,
      orgId: ORG.id,
      customerId: c.id,
      externalCode: code,
      externalLabel: label,
      canonical,
    }))
  },
)

/**
 * Codes that appear on deductions but are NOT in REASON_CODES — the matcher
 * flags these as unmapped, which is the single most common real-world cause
 * of an unmatchable chargeback.
 */
export const UNMAPPED_CODES = ['DEDA', 'ALW-X', 'TRD99', 'MISC', 'CHG-07']
