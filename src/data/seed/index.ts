/**
 * Seed orchestrator.
 *
 * Build order matters and is not arbitrary — funds must exist before
 * promotions can be assigned to them, promotions must exist before sales facts
 * can carry their lift, and both must exist before a deduction can plausibly
 * reference one. Change the order and the data stops hanging together.
 */

import {
  BANNER_CUSTOMERS, CHAIN_CUSTOMERS, CURRENT_USER_ID, CUSTOMERS, ORG,
  PRODUCTS, REASON_CODES, USERS,
} from '../catalog'
import { makeRng } from '../rng'
import type {
  ApprovalRule, Approval, AuditEntry, Baseline, CustomerGroup, Dataset,
  ProductGroup,
} from '../types'
import { buildFiscalCalendar } from '../../lib/fiscal'
import { buildAssortment, everydayAllowanceRate, type MarketCell } from './market'
import { buildFunds, buildFundTransactions, fiscalYearWindows, makeFundResolver } from './funds'
import { buildPromotions } from './promotions'
import {
  brandIndex, buildSalesFacts, claimableSpendIndex, plannedSpendIndex,
} from './sales'
import { buildDeductions } from './deductions'

/** The demo's "today". Fixed so screenshots and verify.mjs stay reproducible. */
export const DEMO_TODAY = '2026-07-30'

export const SEED_CONFIG = {
  seed: 20260730,
  calendarStart: '2024-01-01',
  calendarWeeks: 157,
  /** Sales facts start here; earlier weeks exist only for fiscal labelling. */
  historyWeeks: 110,
  promotionCount: 200,
  deductionCount: 300,
}

let cached: Dataset | null = null

export function getDataset(): Dataset {
  if (!cached) cached = buildDataset()
  return cached
}

export function buildDataset(): Dataset {
  const rng = makeRng(SEED_CONFIG.seed)

  // 1. Calendar
  const fiscalWeeks = buildFiscalCalendar(
    SEED_CONFIG.calendarStart,
    SEED_CONFIG.calendarWeeks,
    ORG.fiscalCalendar,
    2024,
  )
  const allWeekStarts = fiscalWeeks.map((w) => w.weekStart)
  const historyWeeks = allWeekStarts.filter(
    (w) => w <= DEMO_TODAY,
  ).slice(-SEED_CONFIG.historyWeeks)

  // 2. Assortment & velocity
  const cells = buildAssortment(rng)
  const cellsByCustomer = new Map<string, MarketCell[]>()
  for (const c of cells) {
    const arr = cellsByCustomer.get(c.customerId)
    if (arr) arr.push(c)
    else cellsByCustomer.set(c.customerId, [c])
  }

  // 3. Funds (before promotions — promotions need somewhere to draw from)
  const years = fiscalYearWindows(fiscalWeeks)
  const funds = buildFunds(rng, years)
  const fundIdFor = makeFundResolver(funds)

  // 4. Promotions
  const { promotions, lines, statusEvents } = buildPromotions(rng, {
    count: SEED_CONFIG.promotionCount,
    weekStarts: allWeekStarts.filter((w) => w >= historyWeeks[0]),
    today: DEMO_TODAY,
    cellsByCustomer,
    fundIdFor,
  })
  const plannedSpendByPromotion = plannedSpendIndex(lines)

  // 5. Sales facts (need promotions for lift, dip and cannibalization)
  const allowanceByCustomer = new Map(
    CHAIN_CUSTOMERS.map((c) => [c.id, everydayAllowanceRate(c.channel)]),
  )
  const { facts, eventResults, promotedWeeksByCell } = buildSalesFacts(rng, {
    cells,
    weekStarts: historyWeeks,
    promotions,
    lines,
    allowanceByCustomer,
  })

  // 6. Fund ledger (needs facts for accruals, promotions for commitments)
  const fundTransactions = buildFundTransactions(rng, {
    funds,
    facts,
    promotions,
    plannedSpendByPromotion,
    today: DEMO_TODAY,
  })

  // 7. Deductions, disputes, settlements
  const { deductions, disputes, settlements } = buildDeductions(rng, {
    count: SEED_CONFIG.deductionCount,
    today: DEMO_TODAY,
    promotions,
    plannedSpendByPromotion,
    claimableSpendByPromotion: claimableSpendIndex(lines),
    brandsByPromotion: brandIndex(lines),
    allBrands: [...new Set(PRODUCTS.map((p) => p.brand))],
  })

  // 8. Approvals & groups & audit
  const approvalRules = buildApprovalRules()
  const approvals = buildApprovals(promotions, approvalRules, plannedSpendByPromotion)
  const { customerGroups, productGroups } = buildGroups()
  const auditLog = buildAuditLog(statusEvents, fundTransactions)

  return {
    org: ORG,
    users: USERS,
    customers: CUSTOMERS,
    products: PRODUCTS,
    customerGroups,
    productGroups,
    fiscalWeeks,
    funds,
    fundTransactions,
    promotions,
    promotionLines: lines,
    statusEvents,
    approvalRules,
    approvals,
    baselines: buildBaselineStubs(promotedWeeksByCell),
    eventResults,
    salesFacts: facts,
    reasonCodes: REASON_CODES,
    deductions,
    matches: [], // produced live by the matching engine — see store.ts
    disputes,
    settlements,
    auditLog,
  }
}

function buildApprovalRules(): ApprovalRule[] {
  return [
    { id: 'ar_1', orgId: ORG.id, name: 'KAM self-approve under $10K', minSpend: 0, approverRole: 'kam', step: 1 },
    { id: 'ar_2', orgId: ORG.id, name: 'Finance review at $25K+', minSpend: 25_000, approverRole: 'finance', step: 2 },
    { id: 'ar_3', orgId: ORG.id, name: 'Admin sign-off at $100K+', minSpend: 100_000, approverRole: 'admin', step: 3 },
    { id: 'ar_4', orgId: ORG.id, name: 'Finance review when ROI below 0%', minSpend: 0, maxRoi: 0, approverRole: 'finance', step: 2 },
    { id: 'ar_5', orgId: ORG.id, name: 'Admin sign-off on fixed & MDF funds', minSpend: 15_000, fundTypes: ['fixed', 'mdf'], approverRole: 'admin', step: 2 },
  ]
}

function buildApprovals(
  promotions: Dataset['promotions'],
  rules: ApprovalRule[],
  spend: Map<string, number>,
): Approval[] {
  const out: Approval[] = []
  const approverFor: Record<string, string> = { kam: 'u_priya', finance: 'u_marcus', admin: 'u_dana', demand_planner: 'u_ben', viewer: 'u_ben' }

  for (const p of promotions) {
    if (p.status === 'draft' || p.status === 'cancelled') continue
    const s = spend.get(p.id) ?? 0
    const fired = rules.filter((r) => s >= r.minSpend && r.maxRoi === undefined)

    for (const rule of fired) {
      const decided = p.status !== 'submitted'
      out.push({
        id: `apr_${out.length}`,
        orgId: ORG.id,
        promotionId: p.id,
        ruleId: rule.id,
        step: rule.step,
        approverId: approverFor[rule.approverRole],
        status: decided ? 'approved' : 'pending',
        decidedAt: decided && p.approvedAt ? `${p.approvedAt}T14:30:00Z` : undefined,
        comment: decided ? undefined : 'Awaiting review',
      })
    }
  }
  return out
}

function buildGroups(): { customerGroups: CustomerGroup[]; productGroups: ProductGroup[] } {
  const customerGroups: CustomerGroup[] = [
    { id: 'cg_national', orgId: ORG.id, name: 'National Accounts', customerIds: ['cust_WMT', 'cust_KR', 'cust_ACI', 'cust_TGT', 'cust_CST'] },
    { id: 'cg_natural', orgId: ORG.id, name: 'Natural & Specialty', customerIds: ['cust_SFM', 'cust_WFM', 'cust_UNFI', 'cust_KEHE'] },
    { id: 'cg_east', orgId: ORG.id, name: 'East Region', customerIds: ['cust_AD', 'cust_PUB'] },
    { id: 'cg_club', orgId: ORG.id, name: 'Club Channel', customerIds: ['cust_CST'] },
  ]

  const productGroups: ProductGroup[] = [
    { id: 'pg_summit', orgId: ORG.id, name: 'Summit Trail — All', rule: { brand: 'Summit Trail' }, productIds: PRODUCTS.filter((p) => p.brand === 'Summit Trail').map((p) => p.id) },
    { id: 'pg_golden', orgId: ORG.id, name: 'Golden Hour — All', rule: { brand: 'Golden Hour' }, productIds: PRODUCTS.filter((p) => p.brand === 'Golden Hour').map((p) => p.id) },
    { id: 'pg_harvest', orgId: ORG.id, name: 'Harvest Table — All', rule: { brand: 'Harvest Table' }, productIds: PRODUCTS.filter((p) => p.brand === 'Harvest Table').map((p) => p.id) },
    { id: 'pg_bars', orgId: ORG.id, name: 'Protein Bars', rule: { subbrand: 'Protein Bars' }, productIds: PRODUCTS.filter((p) => p.subbrand === 'Protein Bars').map((p) => p.id) },
    { id: 'pg_sparkling', orgId: ORG.id, name: 'Sparkling Water', rule: { subbrand: 'Sparkling Water' }, productIds: PRODUCTS.filter((p) => p.subbrand === 'Sparkling Water').map((p) => p.id) },
    { id: 'pg_soup', orgId: ORG.id, name: 'Soups & Broths', rule: { category: 'Meals' }, productIds: PRODUCTS.filter((p) => p.subbrand === 'Soups' || p.subbrand === 'Broths').map((p) => p.id) },
  ]

  return { customerGroups, productGroups }
}

/**
 * Baselines are computed on demand by the calc engine rather than stored —
 * this array only records which cells have an override, which is the one part
 * a planner actually authors.
 */
function buildBaselineStubs(promotedWeeksByCell: Map<string, Set<string>>): Baseline[] {
  const out: Baseline[] = []
  let i = 0
  for (const [key, weeks] of promotedWeeksByCell) {
    if (i++ % 47 !== 0) continue // a sparse handful of manual overrides
    const [customerId, productId] = key.split('|')
    const weekStart = [...weeks][0]
    out.push({
      id: `bl_${i}`,
      orgId: ORG.id,
      customerId,
      productId,
      weekStart,
      baselineUnits: 0, // resolved at read time by the engine
      method: 'manual_override',
      seasonalityIndex: 1,
      computedAt: `${DEMO_TODAY}T02:00:00Z`,
      overriddenBy: 'u_ben',
    })
  }
  return out
}

function buildAuditLog(
  statusEvents: Dataset['statusEvents'],
  fundTransactions: Dataset['fundTransactions'],
): AuditEntry[] {
  const out: AuditEntry[] = []

  for (const e of statusEvents.slice(-260)) {
    out.push({
      id: `au_${out.length}`,
      orgId: ORG.id,
      entity: 'trade.promotions',
      entityId: e.promotionId,
      action: 'status_change',
      field: 'status',
      oldValue: e.from ?? undefined,
      newValue: e.to,
      actorId: e.actorId,
      at: e.at,
      reason: e.note,
    })
  }

  for (const t of fundTransactions.filter((t) => t.type === 'adjustment')) {
    out.push({
      id: `au_${out.length}`,
      orgId: ORG.id,
      entity: 'trade.fund_transactions',
      entityId: t.id,
      action: 'create',
      field: 'amount',
      newValue: String(t.amount),
      actorId: t.actorId,
      at: `${t.postedAt}T11:15:00Z`,
      reason: t.reason,
    })
  }

  return out.sort((a, b) => b.at.localeCompare(a.at))
}

export { CURRENT_USER_ID, CHAIN_CUSTOMERS, BANNER_CUSTOMERS }
