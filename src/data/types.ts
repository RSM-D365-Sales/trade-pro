/**
 * Canonical domain model.
 *
 * These types mirror the Postgres schemas in TPM_BUILD_PLAN.md §2
 * (core / md / trade / sales / settle) so the demo's shapes lift straight
 * into `packages/db` when this becomes a real Supabase build. Every entity
 * carries `orgId` for the same reason the real tables carry `org_id`:
 * multi-tenancy is not retrofittable.
 *
 * Money and volume are `number` here only because this is an in-browser demo.
 * In the real build they are numeric(18,4) — see calc.ts, which rounds at
 * every boundary to keep the demo honest about that.
 */

export type ID = string
export type ISODate = string // 'YYYY-MM-DD'

// ── core ────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'finance' | 'kam' | 'demand_planner' | 'viewer'

export interface Org {
  id: ID
  name: string
  baseCurrency: string
  fiscalCalendar: '4-4-5' | '4-5-4' | '13-period'
  fiscalYearStart: ISODate
  accrualGlAccount: string
}

export interface User {
  id: ID
  orgId: ID
  name: string
  email: string
  role: Role
  initials: string
}

export interface AuditEntry {
  id: ID
  orgId: ID
  entity: string
  entityId: ID
  action: 'create' | 'update' | 'delete' | 'status_change' | 'approve' | 'reject'
  field?: string
  oldValue?: string
  newValue?: string
  actorId: ID
  at: string // ISO datetime
  reason?: string
}

// ── md (master data — mirrored from ERP, never authored here) ───────────────

/** chain → banner → division → ship-to */
export type CustomerLevel = 'chain' | 'banner' | 'division' | 'ship_to'

export interface Customer {
  id: ID
  orgId: ID
  parentId: ID | null
  level: CustomerLevel
  name: string
  code: string
  channel: 'grocery' | 'mass' | 'club' | 'natural' | 'convenience' | 'distributor'
  region?: string
  /**
   * Total selling outlets. The forecast driver is not this number but the
   * subset actually carrying a given product group - see `storesSelling`
   * in the forecast engine. Distributors report served outlets rather than
   * owned stores.
   */
  storeCount?: number
  /** Maps this customer into each connected ERP. Key = integration code. */
  externalIds: Record<string, string>
}

/** category → brand → subbrand → SKU */
export interface Product {
  id: ID
  orgId: ID
  sku: string
  name: string
  category: string
  brand: string
  subbrand: string
  casePack: number
  baseUom: 'EA' | 'CS' | 'LB'
  listPrice: number // per case
  cogs: number // per case
  netWeightLb: number
  status: 'active' | 'discontinued'
}

export interface CustomerGroup {
  id: ID
  orgId: ID
  name: string
  customerIds: ID[]
}

export interface ProductGroup {
  id: ID
  orgId: ID
  name: string
  /** Rule-based groups resolve at read time; manual groups list SKUs. */
  rule?: { brand?: string; subbrand?: string; category?: string }
  productIds: ID[]
}

export interface FiscalWeek {
  /** ISO week start (Monday) */
  weekStart: ISODate
  fiscalYear: number
  period: number // 1..12 or 1..13
  weekOfPeriod: number
  weekOfYear: number
  label: string // 'FY26 P03 W2'
}

// ── trade ───────────────────────────────────────────────────────────────────

export type FundType = 'accrual' | 'fixed' | 'top_down' | 'mdf'
export type AccrualBasis = 'gross_sales' | 'net_sales' | 'volume'

export interface Fund {
  id: ID
  orgId: ID
  code: string
  name: string
  type: FundType
  accrualBasis?: AccrualBasis
  /** rate as a decimal for %-based bases, $/case for volume */
  accrualRate?: number
  customerId: ID
  productGroupId: ID | null
  periodStart: ISODate
  periodEnd: ISODate
  currency: string
  /** Only meaningful for fixed / top_down funds. */
  budget?: number
  carryoverPolicy: 'none' | 'full' | 'capped'
  carryoverCap?: number
}

export type FundTxnType =
  | 'accrual'
  | 'commitment'
  | 'actual'
  | 'adjustment'
  | 'carryover'
  | 'reversal'

/**
 * Immutable ledger. Fund balance is ALWAYS derived from this — never stored
 * as a mutable column. See calc/funds.ts.
 */
export interface FundTransaction {
  id: ID
  orgId: ID
  fundId: ID
  type: FundTxnType
  amount: number // signed: accrual/carryover add, commitment/actual consume
  postedAt: ISODate
  promotionId?: ID
  deductionId?: ID
  reason?: string
  actorId: ID
}

export type TacticCode =
  | 'off_invoice'
  | 'bill_back'
  | 'scan_back'
  | 'tpr'
  | 'display'
  | 'feature'
  | 'feature_display'
  | 'bogo'
  | 'coupon'
  | 'slotting'
  | 'listing'
  | 'mdf'
  | 'sampling'
  | 'rebate'
  | 'edlp'

export interface Tactic {
  code: TacticCode
  name: string
  /** How the money leaves: at invoice, or claimed back afterwards. */
  settlement: 'off_invoice' | 'bill_back' | 'scan_back' | 'lump_sum'
  /** Typical lift multiplier vs. baseline; drives the demo's lift model. */
  typicalLift: number
  isDisplayVehicle: boolean
}

export type PromotionStatus =
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'active'
  | 'closed'
  | 'cancelled'

/**
 * Six dates, all different, all load-bearing:
 *  buy_*     — when the customer may order at promo terms
 *  ship_*    — when we ship it
 *  perform_* — when it is on shelf / scanning at retail
 */
export interface Promotion {
  id: ID
  orgId: ID
  code: string
  name: string
  customerId: ID
  status: PromotionStatus
  buyStart: ISODate
  buyEnd: ISODate
  shipStart: ISODate
  shipEnd: ISODate
  performStart: ISODate
  performEnd: ISODate
  fundId: ID
  ownerId: ID
  createdAt: ISODate
  submittedAt?: ISODate
  approvedAt?: ISODate
  approvedBy?: ID
  notes?: string
}

export type RateType = 'per_case' | 'pct_of_list' | 'lump_sum' | 'per_unit'

export interface PromotionLine {
  id: ID
  orgId: ID
  promotionId: ID
  productId: ID
  tactic: TacticCode
  rateType: RateType
  rate: number
  plannedBaselineUnits: number
  plannedLiftUnits: number
  /** Retailer's shelf price during the event; drives consumer takeaway. */
  promoRetailPrice?: number
}

export interface PromotionStatusEvent {
  id: ID
  promotionId: ID
  from: PromotionStatus | null
  to: PromotionStatus
  at: string
  actorId: ID
  note?: string
}

export interface ApprovalRule {
  id: ID
  orgId: ID
  name: string
  /** Fires when planned spend meets or exceeds this. */
  minSpend: number
  /** Fires when projected ROI falls below this (e.g. -0.1 = losing money). */
  maxRoi?: number
  fundTypes?: FundType[]
  approverRole: Role
  step: number
}

export interface Approval {
  id: ID
  orgId: ID
  promotionId: ID
  ruleId: ID
  step: number
  approverId: ID
  status: 'pending' | 'approved' | 'rejected'
  decidedAt?: string
  comment?: string
}

export interface Baseline {
  id: ID
  orgId: ID
  customerId: ID
  productId: ID
  weekStart: ISODate
  baselineUnits: number
  method: '52w_moving_avg' | 'seasonal_index' | 'manual_override'
  seasonalityIndex: number
  computedAt: string
  overriddenBy?: ID
}

export interface EventResult {
  id: ID
  orgId: ID
  promotionId: ID
  shippedUnits: number
  baselineUnits: number
  actualSpend: number
  /** Units the sibling SKUs lost to this promo — the honest number. */
  cannibalizedUnits: number
  /** Units the post-promo trough gave back. */
  pantryLoadUnits: number
}

// ── sales ───────────────────────────────────────────────────────────────────

export interface SalesFact {
  id: ID
  orgId: ID
  customerId: ID
  productId: ID
  weekStart: ISODate
  units: number
  grossSales: number
  offInvoiceDiscount: number
  cogs: number
  promotionId?: ID
}

// ── settle (the commercial wedge) ───────────────────────────────────────────

export type DeductionStatus =
  | 'open'
  | 'matched'
  | 'review'
  | 'disputed'
  | 'settled'
  | 'written_off'
  | 'recovered'

export interface ReasonCode {
  id: ID
  orgId: ID
  customerId: ID
  /** The retailer's own cryptic code, exactly as it lands on the remittance. */
  externalCode: string
  externalLabel: string
  /** Our taxonomy. */
  canonical:
    | 'trade_promotion'
    | 'shortage'
    | 'pricing'
    | 'damages'
    | 'returns'
    | 'compliance_fine'
    | 'freight'
    | 'unknown'
}

export interface Deduction {
  id: ID
  orgId: ID
  docNumber: string
  customerId: ID
  /** Customer's invoice reference, when they bother to give one. */
  invoiceRef?: string
  amount: number
  receivedDate: ISODate
  /** The deduction's own reference to the event, often missing or wrong. */
  externalReasonCode: string
  /**
   * Brand or category named on the remittance line. Present on roughly two
   * thirds of real chargebacks and absent on the rest — which is exactly why
   * it is a strong signal when you have it and must not be a penalty when you
   * don't.
   */
  brandHint?: string
  description: string
  status: DeductionStatus
  assignedToId?: ID
  backupDocUrl?: string
}

export interface DeductionMatch {
  id: ID
  orgId: ID
  deductionId: ID
  promotionId: ID
  amount: number
  /** 0..1 from the matching engine. */
  confidence: number
  matchedBy: 'auto' | 'user'
  reasons: string[]
  accepted: boolean
}

export interface Dispute {
  id: ID
  orgId: ID
  deductionId: ID
  reason: string
  openedAt: ISODate
  openedById: ID
  status: 'open' | 'submitted' | 'won' | 'lost' | 'partial'
  claimedAmount: number
  recoveredAmount: number
  closedAt?: ISODate
  correspondence: { at: ISODate; author: string; note: string }[]
}

export interface Settlement {
  id: ID
  orgId: ID
  deductionId: ID
  type: 'credit_memo' | 'check_request' | 'write_off'
  amount: number
  postedAt: ISODate
  erpReference?: string
}

// ── the whole seeded world ──────────────────────────────────────────────────

export interface Dataset {
  org: Org
  users: User[]
  customers: Customer[]
  products: Product[]
  customerGroups: CustomerGroup[]
  productGroups: ProductGroup[]
  fiscalWeeks: FiscalWeek[]
  funds: Fund[]
  fundTransactions: FundTransaction[]
  promotions: Promotion[]
  promotionLines: PromotionLine[]
  statusEvents: PromotionStatusEvent[]
  approvalRules: ApprovalRule[]
  approvals: Approval[]
  baselines: Baseline[]
  eventResults: EventResult[]
  salesFacts: SalesFact[]
  reasonCodes: ReasonCode[]
  deductions: Deduction[]
  matches: DeductionMatch[]
  disputes: Dispute[]
  settlements: Settlement[]
  auditLog: AuditEntry[]
  /** Driver-based forecast. See lib/calc/forecast.ts. */
  forecast: ForecastSlice
  /** Sales plan, service rates and payment terms. See seed/commercial.ts. */
  commercial: import('./seed/commercial').CommercialSlice
}

export interface ForecastSlice {
  productGroups: {
    id: ID
    name: string
    brand: string
    category: string
    productIds: ID[]
  }[]
  periods: import('../lib/calc/forecast').ForecastPeriod[]
  lines: import('../lib/calc/forecast').ForecastLine[]
  signals: Map<ID, import('../lib/calc/forecast').ActualSignal>
}

