/**
 * Static master data for the demo tenant.
 *
 * The tenant is **Bluestem Fresh Produce, Inc.** — the fictional Michigan
 * grower-packer-shipper and fresh-cut processor that fronts every RSM produce
 * demo. Customers, people and items come from the shared Bluestem demo-data
 * pack (`customers.csv`, `employees.csv`, `items.csv`); the IDs in
 * `externalIds.d365` are the pack's own keys, so this app joins to the same
 * records the sibling Bluestem apps show. Every customer is fictional and every
 * figure downstream of this file is generated.
 */

import type { Customer, ID, Org, Product, ReasonCode, User } from './types'

export const ORG: Org = {
  id: 'org_bluestem',
  name: 'Bluestem Fresh Produce',
  baseCurrency: 'USD',
  // The company plans on a calendar fiscal year, but trade and demand planning
  // run on 4-4-5 retail periods inside it — which is exactly the "a period is
  // not a month" point the forecast screen makes.
  fiscalCalendar: '4-4-5',
  fiscalYearStart: '2024-01-01',
  accrualGlAccount: '2140 — Trade Promotion Accrual',
}

/** People from the pack's `employees.csv`, one persona per role the app needs. */
export const USERS: User[] = [
  { id: 'u_nora', orgId: ORG.id, name: 'Nora Adeyemi', title: 'Trade Marketing Manager', email: 'nora.adeyemi@bluestemfresh.com', role: 'kam', initials: 'NA' },
  { id: 'u_priya', orgId: ORG.id, name: 'Priya Nair', title: 'VP Sales', email: 'priya.nair@bluestemfresh.com', role: 'admin', initials: 'PN' },
  { id: 'u_dana', orgId: ORG.id, name: 'Dana Okafor-Reyes', title: 'CEO', email: 'dana.okafor@bluestemfresh.com', role: 'admin', initials: 'DO' },
  { id: 'u_marcus', orgId: ORG.id, name: 'Marcus Lindqvist', title: 'CFO', email: 'marcus.lindqvist@bluestemfresh.com', role: 'finance', initials: 'ML' },
  { id: 'u_hannah', orgId: ORG.id, name: 'Hannah Whitfield', title: 'Controller', email: 'hannah.whitfield@bluestemfresh.com', role: 'finance', initials: 'HW' },
  { id: 'u_aisha', orgId: ORG.id, name: 'Aisha Rahman', title: 'AR Specialist', email: 'aisha.rahman@bluestemfresh.com', role: 'finance', initials: 'AR' },
  { id: 'u_tom', orgId: ORG.id, name: 'Tom Kowalski', title: 'Sales Rep — Retail East', email: 'tom.kowalski@bluestemfresh.com', role: 'kam', initials: 'TK' },
  { id: 'u_elena', orgId: ORG.id, name: 'Elena Petrov', title: 'Sales Rep — Retail Central', email: 'elena.petrov@bluestemfresh.com', role: 'kam', initials: 'EP' },
  { id: 'u_jamal', orgId: ORG.id, name: 'Jamal Greene', title: 'Sales Rep — Foodservice', email: 'jamal.greene@bluestemfresh.com', role: 'kam', initials: 'JG' },
  { id: 'u_kate', orgId: ORG.id, name: 'Kate Sullivan', title: 'Sales Rep — Club/Mass', email: 'kate.sullivan@bluestemfresh.com', role: 'kam', initials: 'KS' },
  { id: 'u_victor', orgId: ORG.id, name: 'Victor Huang', title: 'Sales Rep — Distributors', email: 'victor.huang@bluestemfresh.com', role: 'kam', initials: 'VH' },
  { id: 'u_ben', orgId: ORG.id, name: 'Ben Carter', title: 'Production Planner', email: 'ben.carter@bluestemfresh.com', role: 'demand_planner', initials: 'BC' },
]

/** The persona the demo is presented as — trade marketing owns the calendar. */
export const CURRENT_USER_ID = 'u_nora'
export const USER_BY_ID = new Map(USERS.map((u) => [u.id, u]))

/**
 * Territory book, taken from the `SalesRep` column of the pack's customer
 * list. Every account belongs to exactly one rep and every rep appears here —
 * that invariant is what lets the sales leaderboard be a genuine rollup of
 * shipment facts rather than a seeded scoreboard.
 *
 * The shape is deliberately lopsided: Retail East carries five accounts while
 * Club/Mass carries one, because that is what a regional produce sales team
 * looks like. It is also why the leaderboard's margin spread is real — club
 * and distributor territories carry much heavier everyday allowances.
 */
export const TERRITORIES: { repId: ID; customerIds: ID[] }[] = [
  { repId: 'u_tom', customerIds: ['cust_NWF', 'cust_PFM', 'cust_RBS', 'cust_MFM', 'cust_EFD'] },
  { repId: 'u_jamal', customerIds: ['cust_GLG', 'cust_LNF', 'cust_MFS'] },
  { repId: 'u_kate', customerIds: ['cust_SCS'] },
  { repId: 'u_elena', customerIds: ['cust_VPM'] },
  { repId: 'u_victor', customerIds: ['cust_CCG', 'cust_GCC'] },
]

/** Chain → owning rep. */
export const REP_BY_CUSTOMER: Record<string, ID> = Object.fromEntries(
  TERRITORIES.flatMap((t) => t.customerIds.map((c) => [c, t.repId])),
)

type ChainSpec = {
  code: string
  /** The pack's CustomerId — the D365 customer account. */
  d365: string
  name: string
  channel: Customer['channel']
  region: string
  /** Total selling outlets across the chain (served outlets for distributors). */
  storeCount: number
  banners: { code: string; name: string; region: string; storeCount: number }[]
}

/**
 * The twelve accounts that carry trade programs. The pack's other 28
 * customers (processors, institutional foodservice, e-commerce, farm stands)
 * buy on everyday terms and never generate a promotional chargeback, so they
 * stay out of a TPM demo. Banners are the divisions the retailer's remittances
 * actually arrive from.
 */
const CHAINS: ChainSpec[] = [
  {
    code: 'NWF', d365: 'C10002', name: 'Northwind Foods', channel: 'grocery', region: 'Ohio Valley', storeCount: 214,
    banners: [
      { code: 'NWF-MKT', name: 'Northwind Markets', region: 'Ohio', storeCount: 152 },
      { code: 'NWF-FRS', name: 'Northwind Fresh', region: 'Indiana / Kentucky', storeCount: 62 },
    ],
  },
  {
    code: 'GLG', d365: 'C10001', name: 'Great Lakes Grocers', channel: 'grocery', region: 'Michigan', storeCount: 138,
    banners: [
      { code: 'GLG-CORE', name: 'Great Lakes Grocers', region: 'West Michigan', storeCount: 96 },
      { code: 'GLG-LSM', name: 'Lakeshore Market', region: 'Northern Michigan', storeCount: 42 },
    ],
  },
  {
    code: 'VPM', d365: 'C10008', name: 'ValuePoint Mass Retail', channel: 'mass', region: 'Upper Midwest', storeCount: 326,
    banners: [
      { code: 'VPM-SC', name: 'ValuePoint Supercenter', region: 'Upper Midwest', storeCount: 238 },
      { code: 'VPM-EX', name: 'ValuePoint Express', region: 'Twin Cities', storeCount: 88 },
    ],
  },
  {
    code: 'SCS', d365: 'C10007', name: 'Summit Club Stores', channel: 'club', region: 'Midwest', storeCount: 41,
    banners: [{ code: 'SCS-CORE', name: 'Summit Club', region: 'Midwest', storeCount: 41 }],
  },
  {
    code: 'MFS', d365: 'C10011', name: 'Midwest Foodservice Supply', channel: 'distributor', region: 'Chicago', storeCount: 1450,
    banners: [
      { code: 'MFS-CHI', name: 'MFS Chicago', region: 'Illinois / Wisconsin', storeCount: 820 },
      { code: 'MFS-DET', name: 'MFS Detroit', region: 'Michigan / Ohio', storeCount: 630 },
    ],
  },
  {
    code: 'RBS', d365: 'C10006', name: 'Riverbend Supermarkets', channel: 'grocery', region: 'Western Pennsylvania', storeCount: 97,
    banners: [{ code: 'RBS-CORE', name: 'Riverbend', region: 'Western Pennsylvania', storeCount: 97 }],
  },
  {
    code: 'PFM', d365: 'C10004', name: 'Prairie Fresh Market', channel: 'grocery', region: 'Wisconsin', storeCount: 72,
    banners: [
      { code: 'PFM-CORE', name: 'Prairie Fresh', region: 'Wisconsin', storeCount: 58 },
      { code: 'PFM-NBH', name: 'Prairie Fresh Neighborhood', region: 'Madison metro', storeCount: 14 },
    ],
  },
  {
    code: 'MFM', d365: 'C10031', name: 'Metro Fresh Markets', channel: 'grocery', region: 'New England', storeCount: 63,
    banners: [{ code: 'MFM-CORE', name: 'Metro Fresh', region: 'New England', storeCount: 63 }],
  },
  {
    code: 'EFD', d365: 'C10015', name: 'Erie Fresh Distributors', channel: 'distributor', region: 'Upstate New York', storeCount: 640,
    banners: [
      { code: 'EFD-BUF', name: 'Erie Fresh Buffalo', region: 'Western New York', storeCount: 360 },
      { code: 'EFD-ROC', name: 'Erie Fresh Rochester', region: 'Finger Lakes', storeCount: 280 },
    ],
  },
  {
    code: 'CCG', d365: 'C10005', name: 'Copper Creek Grocery', channel: 'grocery', region: 'Indiana', storeCount: 46,
    banners: [{ code: 'CCG-CORE', name: 'Copper Creek', region: 'Indiana', storeCount: 46 }],
  },
  {
    code: 'LNF', d365: 'C10009', name: 'Lakeside Natural Foods', channel: 'natural', region: 'Southeast Michigan', storeCount: 24,
    banners: [{ code: 'LNF-CORE', name: 'Lakeside Natural', region: 'Southeast Michigan', storeCount: 24 }],
  },
  {
    code: 'GCC', d365: 'C10010', name: 'Green Cart Co-op', channel: 'natural', region: 'Detroit', storeCount: 11,
    banners: [{ code: 'GCC-CORE', name: 'Green Cart', region: 'Detroit', storeCount: 11 }],
  },
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
      storeCount: chain.storeCount,
      externalIds: { d365: chain.d365 },
    })
    chain.banners.forEach((b, i) => {
      out.push({
        id: `cust_${b.code}`,
        orgId: ORG.id,
        parentId: chainId,
        level: 'banner',
        name: b.name,
        code: b.code,
        channel: chain.channel,
        region: b.region,
        storeCount: b.storeCount,
        externalIds: { d365: `${chain.d365}-${String(i + 1).padStart(2, '0')}` },
      })
    })
  }
  return out
}

export const CUSTOMERS: Customer[] = buildCustomers()

/** The 12 chains — the grain most planning and reporting happens at. */
export const CHAIN_CUSTOMERS = CUSTOMERS.filter((c) => c.level === 'chain')
export const BANNER_CUSTOMERS = CUSTOMERS.filter((c) => c.level === 'banner')

/** [item id, name, case pack, list price / case, standard cost / case, lb / case] */
type SkuSpec = [sku: string, name: string, casePack: number, listPrice: number, cogs: number, weight: number]

/**
 * Finished goods from the pack's `items.csv` (the PK-* packed-fresh and FC-*
 * fresh-cut items; raw crops, packaging and ingredients are not sold). List
 * price and standard cost are the pack's figures to the cent, so a margin
 * shown here ties to the Product Cost Inquiry app.
 *
 * Bluestem sells under three labels, which play the role a brand plays in a
 * CPG trade plan: a planner promotes a label, and a retailer's chargeback
 * names one. Sub-brands are the pack's sub-categories — the grain a demand
 * planner forecasts at.
 */
const PRODUCT_LINES: {
  category: string
  brand: string
  subbrand: string
  skus: SkuSpec[]
}[] = [
  {
    category: 'Packed Fresh', brand: 'Bluestem Orchard', subbrand: 'Apples',
    skus: [
      ['PK-APL-HC-3LB', 'Honeycrisp Apples 3 lb pouch', 12, 22.5, 15.8, 36],
      ['PK-APL-GA-3LB', 'Gala Apples 3 lb pouch', 12, 18.75, 13.4, 36],
      ['PK-APL-HC-TRAY', 'Honeycrisp Apples 88 ct tray', 88, 42.0, 29.3, 40],
    ],
  },
  {
    category: 'Packed Fresh', brand: 'Bluestem Orchard', subbrand: 'Berries',
    skus: [
      ['PK-BLU-PINT', 'Blueberries pint clamshell', 12, 30.0, 21.0, 9],
      ['PK-BLU-18OZ', 'Blueberries 18 oz clamshell', 8, 27.2, 19.4, 9],
    ],
  },
  {
    category: 'Packed Fresh', brand: 'Bluestem Orchard', subbrand: 'Cherries',
    skus: [
      ['PK-CHR-TRAY', 'Tart Cherries 1 lb tray', 12, 36.0, 24.3, 12],
    ],
  },
  {
    category: 'Packed Fresh', brand: 'Bluestem Fields', subbrand: 'Vegetables',
    skus: [
      ['PK-ASP-1LB', 'Asparagus 1 lb bunch', 11, 33.0, 22.8, 11],
      ['PK-CUC-SLC', 'Slicer Cucumbers 24 ct', 24, 16.8, 11.9, 24],
      ['PK-CUC-MINI', 'Mini Cucumbers 1 lb bag', 12, 19.2, 13.4, 12],
      ['PK-ZUC-CTN', 'Zucchini 20 lb carton', 1, 19.0, 13.5, 20],
      ['PK-CRN-4PK', 'Sweet Corn 4-pack tray', 12, 16.8, 12.0, 14],
      ['PK-SQB-CTN', 'Butternut Squash 35 lb carton', 1, 21.0, 14.2, 35],
      ['PK-PEP-GRN', 'Green Bell Peppers 1-1/9 bu', 1, 24.0, 17.0, 28],
      ['PK-PEP-3PK', 'Tri-Color Peppers 3-pack', 12, 30.0, 19.6, 10],
    ],
  },
  {
    category: 'Packed Fresh', brand: 'Bluestem Fields', subbrand: 'Leafy Greens',
    skus: [
      ['PK-ROM-HRT', 'Romaine Hearts 3 ct', 12, 22.8, 16.4, 12],
    ],
  },
  {
    category: 'Fresh-Cut', brand: 'Bluestem Fresh Cuts', subbrand: 'Cut Apples',
    skus: [
      ['FC-APL-SLC-2OZ', 'Apple Slices 2 oz snack cup', 24, 27.6, 17.0, 3],
      ['FC-APL-SLC-14OZ', 'Apple Slices 14 oz family pack', 8, 30.4, 18.2, 7],
      ['FC-APL-DICE-5LB', 'Diced Apples 5 lb foodservice', 4, 37.0, 22.9, 20],
    ],
  },
  {
    category: 'Fresh-Cut', brand: 'Bluestem Fresh Cuts', subbrand: 'Vegetable Blends',
    skus: [
      ['FC-VEG-STIR-12OZ', 'Stir-Fry Vegetable Blend 12 oz', 8, 28.8, 17.5, 6],
      ['FC-VEG-SQB-DICE', 'Diced Butternut Squash 12 oz', 8, 24.0, 14.6, 6],
      ['FC-VEG-ZOODLE', 'Zucchini Noodles 10 oz', 8, 26.4, 14.7, 5],
      ['FC-CUC-SLC-5LB', 'Sliced Cucumbers 5 lb foodservice', 4, 24.0, 15.0, 20],
      ['FC-PEP-DICE-5LB', 'Diced Peppers 5 lb foodservice', 4, 33.6, 20.5, 20],
      ['FC-CRN-KERNEL', 'Cut Sweet Corn Kernels 2 lb', 6, 26.4, 15.9, 12],
    ],
  },
  {
    category: 'Fresh-Cut', brand: 'Bluestem Fresh Cuts', subbrand: 'Salads',
    skus: [
      ['FC-SAL-ROM-CHOP', 'Chopped Romaine 2 lb foodservice', 6, 26.4, 16.5, 12],
      ['FC-SAL-GARDEN', 'Garden Salad Kit 10 oz', 8, 29.6, 17.5, 5],
      ['FC-SAL-CAESAR', 'Caesar Salad Kit 10 oz', 8, 31.2, 18.6, 5],
    ],
  },
  {
    category: 'Fresh-Cut', brand: 'Bluestem Fresh Cuts', subbrand: 'Fruit Cups',
    skus: [
      ['FC-FRT-CUP-6OZ', 'Fruit Cup (apple/blueberry) 6 oz', 12, 32.4, 19.5, 4.5],
    ],
  },
  {
    category: 'Fresh-Cut', brand: 'Bluestem Fresh Cuts', subbrand: 'Trays',
    skus: [
      ['FC-VEG-TRAY', 'Veggie Tray w/ dip 24 oz', 4, 36.0, 21.7, 6],
    ],
  },
]

function buildProducts(): Product[] {
  const out: Product[] = []
  for (const line of PRODUCT_LINES) {
    for (const [sku, name, casePack, listPrice, cogs, weight] of line.skus) {
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
        cogs,
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
 * moment in the demo. The pack's own vocabulary (PROMO / AD / SHORT / DAMAGE /
 * PRICE) shows up where the retailer happens to use plain codes.
 */
const RAW_REASON_CODES: [chain: string, code: string, label: string, canonical: ReasonCode['canonical']][] = [
  ['NWF', 'PROMO', 'Promotional Allowance', 'trade_promotion'],
  ['NWF', 'AD', 'Ad Allowance', 'trade_promotion'],
  ['NWF', 'SCAN', 'Scan Settlement', 'trade_promotion'],
  ['NWF', 'SHORT', 'Receiving Shortage', 'shortage'],
  ['NWF', 'DAMAGE', 'Quality Reject / Unsaleable', 'damages'],
  ['NWF', 'PRICE', 'Price Discrepancy', 'pricing'],
  ['GLG', 'TP-01', 'Trade Promotion', 'trade_promotion'],
  ['GLG', 'TP-04', 'Display Support', 'trade_promotion'],
  ['GLG', 'QC', 'Quality Rejection at DC', 'damages'],
  ['GLG', 'SH', 'Short Ship', 'shortage'],
  ['GLG', 'FRT', 'Freight Adjustment', 'freight'],
  ['VPM', '25', 'Promotional Allowance', 'trade_promotion'],
  ['VPM', '22', 'Billback Deal', 'trade_promotion'],
  ['VPM', '10', 'Concealed Shortage', 'shortage'],
  ['VPM', '92', 'OTIF Fine', 'compliance_fine'],
  ['VPM', '61', 'Temperature Deviation', 'damages'],
  ['SCS', 'MVM', 'Member Value Promotion', 'trade_promotion'],
  ['SCS', 'IR', 'Instant Rebate', 'trade_promotion'],
  ['SCS', 'CS', 'Concealed Shortage', 'shortage'],
  ['SCS', 'VC', 'Vendor Compliance Fine', 'compliance_fine'],
  ['MFS', 'DA', 'Deal Allowance', 'trade_promotion'],
  ['MFS', 'GA', 'Growth Allowance', 'trade_promotion'],
  ['MFS', 'SPL', 'Spoilage', 'damages'],
  ['MFS', 'RTV', 'Return to Vendor', 'returns'],
  ['RBS', 'AD1', 'Ad Allowance', 'trade_promotion'],
  ['RBS', 'DSP', 'Display Allowance', 'trade_promotion'],
  ['RBS', 'SHG', 'Shortage', 'shortage'],
  ['RBS', 'PR', 'Pricing Adjustment', 'pricing'],
  ['PFM', 'TPR', 'Temporary Price Reduction', 'trade_promotion'],
  ['PFM', 'MKT', 'Marketing Support', 'trade_promotion'],
  ['PFM', 'SHT', 'Short Ship', 'shortage'],
  ['PFM', 'DMG', 'Damage Allowance', 'damages'],
  ['MFM', 'PA', 'Promotion Allowance', 'trade_promotion'],
  ['MFM', 'CD', 'Coupon / Demo Support', 'trade_promotion'],
  ['MFM', 'SH', 'Shortage', 'shortage'],
  ['MFM', 'CMP', 'Compliance Chargeback', 'compliance_fine'],
  ['EFD', 'DA', 'Deal Allowance', 'trade_promotion'],
  ['EFD', 'VR', 'Volume Rebate', 'trade_promotion'],
  ['EFD', 'FRT', 'Freight Adjustment', 'freight'],
  ['EFD', 'SPL', 'Spoilage', 'damages'],
  ['CCG', 'PROMO', 'Promotional Allowance', 'trade_promotion'],
  ['CCG', 'DEMO', 'In-Store Demo', 'trade_promotion'],
  ['CCG', 'DAMAGE', 'Damage Allowance', 'damages'],
  ['CCG', 'SHORT', 'Shortage', 'shortage'],
  ['LNF', 'PRM', 'Promotion', 'trade_promotion'],
  ['LNF', 'SMP', 'Sampling Support', 'trade_promotion'],
  ['LNF', 'SPL', 'Spoilage', 'damages'],
  ['GCC', 'COOP', 'Co-op Promotion', 'trade_promotion'],
  ['GCC', 'SHRT', 'Shortage', 'shortage'],
  // Deliberately ambiguous — these drive the "unclassified code" queue.
  ['NWF', '599', 'Misc Allowance', 'unknown'],
  ['VPM', '99', 'Other Adjustment', 'unknown'],
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
