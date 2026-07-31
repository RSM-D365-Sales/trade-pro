/**
 * Deduction auto-matching engine.
 *
 * This is the product's commercial wedge, so it is a real scoring algorithm
 * rather than a lookup. A retailer sends a chargeback with a cryptic code, a
 * partial reference and an amount that rarely equals any single promotion.
 * The engine proposes candidate promotions with a confidence score and — this
 * matters more than the score — the REASONS behind it, so an analyst can
 * accept or reject in one glance instead of opening four systems.
 *
 * Scoring is weighted-additive over five independent signals. Weighted-additive
 * beats a decision tree here because analysts need to see *which* signal is
 * weak; a tree only tells you the leaf it landed on.
 */

import type {
  Customer,
  Deduction,
  Promotion,
  ReasonCode,
  TacticCode,
} from '../../data/types'
import { TACTIC_BY_CODE } from '../../data/tactics'
import { diffDays, isBetween } from '../fiscal'
import { n4 } from './money'

export type MatchWarningCode =
  | 'unmapped_reason'
  | 'non_trade_reason'
  | 'off_invoice_only'
  | 'over_claim'

/**
 * `invalidates` is the field that matters commercially. An unmapped reason
 * code is a data-hygiene problem — annoying, but the money may still be owed.
 * The other three are assertions that this deduction should not be paid at
 * all, which is what turns a queue item into a recoverable dollar.
 */
export interface MatchWarning {
  code: MatchWarningCode
  message: string
  invalidates: boolean
}

export interface MatchCandidate {
  promotionId: string
  promotionCode: string
  promotionName: string
  confidence: number
  amount: number
  reasons: string[]
  warnings: MatchWarning[]
  signals: {
    customer: number
    dateWindow: number
    amount: number
    reasonCode: number
    brand: number
    reference: number
  }
}

/** Display metadata for the signal breakdown in the match review panel. */
export const SIGNAL_META: { key: keyof MatchCandidate['signals']; label: string; weight: number }[] = [
  { key: 'customer', label: 'Customer', weight: 0.22 },
  { key: 'dateWindow', label: 'Date window', weight: 0.26 },
  { key: 'amount', label: 'Amount', weight: 0.22 },
  { key: 'reasonCode', label: 'Reason code', weight: 0.15 },
  { key: 'brand', label: 'Product scope', weight: 0.15 },
  { key: 'reference', label: 'Promo reference', weight: 0.08 },
]

export interface MatchOptions {
  /** Fractional tolerance on the amount signal, e.g. 0.05 = ±5%. */
  amountTolerance: number
  /** Days either side of the perform window still considered plausible. */
  dateGraceDays: number
  /** Candidates below this confidence are not proposed at all. */
  minConfidence: number
  /** At or above this, the demo auto-accepts without human review. */
  autoAcceptThreshold: number
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  amountTolerance: 0.08,
  dateGraceDays: 21,
  // Below this, the only things agreeing are customer and date — which with a
  // full promotion calendar is true of almost everything. Proposing those
  // wastes the analyst's attention, so they are reported as no match.
  minConfidence: 0.62,
  autoAcceptThreshold: 0.88,
}

/**
 * Signal weights.
 *
 * The four CORE signals sum to 1.0, so confidence reads as a percentage.
 * Reference is deliberately NOT one of them — most retailers never cite the
 * promotion code, so folding it into the base would cap every ordinary clean
 * deduction below the auto-accept threshold and leave the queue permanently
 * full. It is a bonus on top instead: present, it adds confidence; absent, it
 * costs nothing.
 */
const W = {
  customer: 0.22,
  dateWindow: 0.26,
  amount: 0.22,
  reasonCode: 0.15,
  brand: 0.15,
}

/**
 * A quoted promotion code closes part of the REMAINING gap to certainty rather
 * than adding a flat bonus. Additive bonuses clamp at 1.0, which silently turns
 * a degraded match into a perfect-looking one — the confidence stops meaning
 * anything precisely when it matters. Proportional lift is monotonic: it can
 * never mask a weak core signal.
 */
const REFERENCE_LIFT = 0.35

/** 1.0 inside the window, decaying linearly across the grace period. */
function dateScore(
  deduction: Deduction,
  promo: Promotion,
  graceDays: number,
): { score: number; note: string } {
  const d = deduction.receivedDate

  // Deductions arrive AFTER performance, so the plausible arrival window runs
  // from the start of the perform window to ~90 days past its end.
  if (isBetween(d, promo.performStart, promo.performEnd)) {
    return { score: 1, note: 'Received during the performance window' }
  }

  const daysAfter = diffDays(promo.performEnd, d)
  if (daysAfter > 0) {
    // Typical retailer lag is 2–8 weeks. Decay past that.
    if (daysAfter <= 60) return { score: 1, note: `Received ${daysAfter}d after event — typical lag` }
    if (daysAfter <= 120) {
      return { score: n4(1 - (daysAfter - 60) / 60), note: `Received ${daysAfter}d after event — late` }
    }
    return { score: 0, note: `Received ${daysAfter}d after event — outside window` }
  }

  // Reaching here means the deduction predates the performance window.
  // `diffDays(d, performStart)` is positive by construction; negating it (as an
  // earlier version did) made the score grow without bound the EARLIER the
  // deduction arrived, which is precisely backwards.
  const daysBefore = diffDays(d, promo.performStart)
  if (daysBefore <= graceDays) {
    return {
      score: n4(0.6 * (1 - daysBefore / graceDays)),
      note: `Received ${daysBefore}d before the event started`,
    }
  }
  return { score: 0, note: `Received ${daysBefore}d before the event was live` }
}

/** Full credit inside tolerance, decaying to zero at 4× tolerance. */
function amountScore(
  deductionAmount: number,
  expectedSpend: number,
  tolerance: number,
): { score: number; note: string } {
  if (expectedSpend <= 0) return { score: 0, note: 'Promotion has no planned spend' }
  const ratio = deductionAmount / expectedSpend
  const drift = Math.abs(ratio - 1)

  if (drift <= tolerance) {
    return { score: 1, note: `Amount within ${(tolerance * 100).toFixed(0)}% of planned spend` }
  }
  if (ratio > 1 + tolerance * 4) {
    return { score: 0, note: `Deduction is ${ratio.toFixed(1)}× planned spend` }
  }
  const decayed = Math.max(0, 1 - (drift - tolerance) / (tolerance * 3))
  return {
    score: n4(decayed),
    note:
      ratio < 1
        ? `Partial claim — ${(ratio * 100).toFixed(0)}% of planned spend`
        : `Over-claim — ${(ratio * 100).toFixed(0)}% of planned spend`,
  }
}

/**
 * A trade-promotion reason code is the strongest cheap signal there is; a
 * shortage or damages code against a promotion is actively evidence AGAINST
 * the match, so it scores zero and raises a warning.
 */
function reasonScore(
  deduction: Deduction,
  reasonCodes: ReasonCode[],
): { score: number; note: string; warning?: MatchWarning } {
  const rc = reasonCodes.find(
    (r) =>
      r.customerId === deduction.customerId &&
      r.externalCode === deduction.externalReasonCode,
  )
  if (!rc) {
    return {
      score: 0.25,
      note: `Reason code "${deduction.externalReasonCode}" is not mapped`,
      warning: {
        code: 'unmapped_reason',
        message: `Unmapped reason code "${deduction.externalReasonCode}" — map it to stop this recurring`,
        invalidates: false,
      },
    }
  }
  if (rc.canonical === 'trade_promotion') {
    return { score: 1, note: `Reason code ${rc.externalCode} → Trade promotion` }
  }
  if (rc.canonical === 'unknown') {
    return { score: 0.3, note: `Reason code ${rc.externalCode} → Unclassified` }
  }
  const label = rc.canonical.replace('_', ' ')
  return {
    score: 0,
    note: `Reason code ${rc.externalCode} → ${label}`,
    warning: {
      code: 'non_trade_reason',
      message: `Coded as ${label}, not trade — likely an invalid deduction`,
      invalidates: true,
    },
  }
}

/**
 * Product-scope agreement.
 *
 * This is the signal that stops the engine matching on coincidence. With a
 * dozen-plus live promotions per retailer, some promotion's planned spend will
 * almost always land within tolerance of any given deduction amount — so
 * customer + date + amount alone will happily produce a confident wrong answer.
 * Brand agreement is what separates the real event from the lookalike.
 *
 * An ABSENT hint scores neutral rather than zero: most remittances don't carry
 * one, and punishing their absence would bury every clean deduction.
 */
function brandScore(
  deduction: Deduction,
  promotionBrands: string[],
): { score: number; note: string } {
  if (!deduction.brandHint) {
    return { score: 0.6, note: 'Remittance names no brand — scope unconfirmed' }
  }
  if (promotionBrands.length === 0) {
    return { score: 0.6, note: 'Promotion has no product scope to compare' }
  }
  if (promotionBrands.includes(deduction.brandHint)) {
    return { score: 1, note: `Remittance names ${deduction.brandHint}, which is on this promotion` }
  }
  return {
    score: 0,
    note: `Remittance names ${deduction.brandHint}; this promotion covers ${promotionBrands.join(', ')}`,
  }
}

/**
 * Retailers sometimes echo the promo code, usually with their own separators
 * ("PRM KR 26012", "prmkr26012"). Normalising both sides catches that.
 *
 * Deliberately NOT fuzzy: an earlier version scored a 4-character tail match,
 * which matched the digits of any invoice reference by chance and manufactured
 * false positives at scale. A reference signal that fires on coincidence is
 * worse than no reference signal, because it fires hardest on exactly the
 * ambiguous cases where an analyst is relying on it.
 */
function referenceScore(
  deduction: Deduction,
  promo: Promotion,
): { score: number; note: string } {
  const normalise = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const hay = normalise(`${deduction.description} ${deduction.invoiceRef ?? ''}`)
  const code = normalise(promo.code)

  if (code.length >= 6 && hay.includes(code)) {
    return { score: 1, note: `Deduction cites ${promo.code}` }
  }
  return { score: 0, note: 'No promotion reference on the deduction' }
}

/**
 * Score one deduction against the promotions available to it.
 *
 * Hard gate: a promotion belonging to a different customer branch is never a
 * candidate at any confidence. Matching a Kroger chargeback to an Albertsons
 * promotion is not a low-confidence match, it is a wrong one.
 */
export function matchDeduction(
  deduction: Deduction,
  promotions: Promotion[],
  context: {
    customers: Customer[]
    reasonCodes: ReasonCode[]
    /**
     * Spend that can legitimately be charged back, by promotion id.
     * NOT total planned spend: off-invoice money already came off the invoice,
     * so comparing a chargeback against it overstates what is owed.
     */
    claimableSpendByPromotion: Map<string, number>
    /** Tactic codes present on each promotion, for the settlement filter. */
    tacticsByPromotion: Map<string, string[]>
    /** Brands each promotion's lines cover, for the product-scope signal. */
    brandsByPromotion: Map<string, string[]>
  },
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchCandidate[] {
  const family = customerFamily(deduction.customerId, context.customers)
  const reason = reasonScore(deduction, context.reasonCodes)

  const candidates: MatchCandidate[] = []

  for (const promo of promotions) {
    if (!family.has(promo.customerId)) continue // hard gate
    if (promo.status === 'draft' || promo.status === 'cancelled') continue

    // Off-invoice money already came off the invoice; it cannot legitimately
    // return as a chargeback. Excluding it here is what surfaces duplicates.
    const tactics = context.tacticsByPromotion.get(promo.id) ?? []
    const claimable = tactics.filter(
      (t) => TACTIC_BY_CODE[t as TacticCode]?.settlement !== 'off_invoice',
    )
    const offInvoiceOnly = tactics.length > 0 && claimable.length === 0

    const date = dateScore(deduction, promo, options.dateGraceDays)
    if (date.score === 0) continue

    const planned = context.claimableSpendByPromotion.get(promo.id) ?? 0
    const amt = amountScore(deduction.amount, planned, options.amountTolerance)
    const ref = referenceScore(deduction, promo)
    const brand = brandScore(deduction, context.brandsByPromotion.get(promo.id) ?? [])

    // Exact customer node scores 1; a parent/child in the same family scores
    // 0.8 — plausible, but worth telling the analyst about.
    const exact = promo.customerId === deduction.customerId
    const cust = exact ? 1 : 0.8

    const base =
      cust * W.customer +
      date.score * W.dateWindow +
      amt.score * W.amount +
      reason.score * W.reasonCode +
      brand.score * W.brand

    const confidence = n4(base + (1 - base) * ref.score * REFERENCE_LIFT)

    if (confidence < options.minConfidence) continue

    // Every signal reports, including the ones that found nothing — an analyst
    // deciding on a 0.78 needs to see WHICH evidence is missing, not just that
    // some is.
    const reasons = [date.note, amt.note, reason.note, brand.note, ref.note]
    if (!exact) reasons.push('Matched via customer hierarchy, not the exact ship-to')

    const warnings: MatchWarning[] = []
    if (reason.warning) warnings.push(reason.warning)
    if (offInvoiceOnly) {
      warnings.push({
        code: 'off_invoice_only',
        message: 'Promotion is off-invoice only — this money was already deducted at invoice',
        invalidates: true,
      })
    }
    // An over-claim warning is an accusation, so it only fires when the rest of
    // the evidence says this genuinely IS the event and the retailer took more
    // than the deal allowed. If the amount is wildly off, the likelier story is
    // simply that this is the wrong promotion — that belongs in the confidence
    // score, not in a claim that the customer deducted money they weren't owed.
    const ratio = planned > 0 ? deduction.amount / planned : 0
    const otherEvidenceStrong =
      date.score >= 0.9 && brand.score >= 0.6 && reason.score >= 0.9
    if (otherEvidenceStrong && ratio > 1.15 && ratio <= 2.2) {
      warnings.push({
        code: 'over_claim',
        message: `Claim is ${(ratio * 100).toFixed(0)}% of planned spend — check for a duplicate or inflated claim`,
        invalidates: true,
      })
    }

    candidates.push({
      promotionId: promo.id,
      promotionCode: promo.code,
      promotionName: promo.name,
      confidence,
      // Never propose settling more than the event can legitimately owe. A
      // promotion with nothing claimable settles NOTHING — offering to accept
      // the full deduction against it would be the exact error the engine
      // exists to prevent.
      amount: n4(Math.max(0, Math.min(deduction.amount, planned))),
      reasons,
      warnings,
      signals: {
        customer: cust,
        dateWindow: date.score,
        amount: amt.score,
        reasonCode: reason.score,
        brand: brand.score,
        reference: ref.score,
      },
    })
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5)
}

/** The customer plus every ancestor and descendant — one retailer's whole tree. */
export function customerFamily(customerId: string, customers: Customer[]): Set<string> {
  const byId = new Map(customers.map((c) => [c.id, c]))
  const family = new Set<string>([customerId])

  let cur = byId.get(customerId)
  while (cur?.parentId) {
    family.add(cur.parentId)
    cur = byId.get(cur.parentId)
  }
  let grew = true
  while (grew) {
    grew = false
    for (const c of customers) {
      if (c.parentId && family.has(c.parentId) && !family.has(c.id)) {
        family.add(c.id)
        grew = true
      }
    }
  }
  return family
}

export type MatchDisposition =
  /** High confidence, clean signals — the system settles this without a human. */
  | 'auto_matched'
  /** A credible promotion, but something needs a person to decide. */
  | 'needs_review'
  /** Matched, but the engine believes it should not be paid. The money bucket. */
  | 'likely_invalid'
  /** Nothing credible to match against. Dispute candidate. */
  | 'no_match'

export const DISPOSITIONS: MatchDisposition[] = [
  'auto_matched', 'needs_review', 'likely_invalid', 'no_match',
]

export const DISPOSITION_LABEL: Record<MatchDisposition, string> = {
  auto_matched: 'Auto-matched',
  needs_review: 'Needs review',
  likely_invalid: 'Likely invalid',
  no_match: 'No match',
}

export function disposition(
  candidates: MatchCandidate[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchDisposition {
  if (candidates.length === 0) return 'no_match'
  const top = candidates[0]
  if (top.warnings.some((w) => w.invalidates)) return 'likely_invalid'
  if (top.confidence >= options.autoAcceptThreshold && top.warnings.length === 0) {
    return 'auto_matched'
  }
  return 'needs_review'
}

export function confidenceBand(c: number): {
  label: string
  tone: 'good' | 'warning' | 'serious' | 'critical'
} {
  if (c >= 0.88) return { label: 'High', tone: 'good' }
  if (c >= 0.7) return { label: 'Medium', tone: 'warning' }
  if (c >= 0.5) return { label: 'Low', tone: 'serious' }
  return { label: 'Very low', tone: 'critical' }
}

// ── Recovery economics — the number that leads the sales motion ─────────────

export interface RecoverySummary {
  totalDeducted: number
  matchedAmount: number
  unmatchedAmount: number
  disputedAmount: number
  recoveredAmount: number
  writtenOffAmount: number
  openAmount: number
  /** Deductions with no valid promotion behind them, as a share of the total. */
  invalidRate: number | null
  /** Recovered ÷ disputed. Analysts are judged on this. */
  winRate: number | null
  /** What's still on the table at the current win rate. */
  recoverableEstimate: number
}

export function summariseRecovery(
  deductions: Deduction[],
  disputes: { deductionId: string; claimedAmount: number; recoveredAmount: number; status: string }[],
  matchedIds: Set<string>,
): RecoverySummary {
  const total = deductions.reduce((a, d) => a + d.amount, 0)
  const matched = deductions.filter((d) => matchedIds.has(d.id)).reduce((a, d) => a + d.amount, 0)
  const unmatched = n4(total - matched)

  const disputed = disputes.reduce((a, d) => a + d.claimedAmount, 0)
  const recovered = disputes.reduce((a, d) => a + d.recoveredAmount, 0)

  const writtenOff = deductions
    .filter((d) => d.status === 'written_off')
    .reduce((a, d) => a + d.amount, 0)
  const open = deductions
    .filter((d) => d.status === 'open' || d.status === 'review')
    .reduce((a, d) => a + d.amount, 0)

  const winRate = disputed > 0 ? n4(recovered / disputed) : null

  return {
    totalDeducted: n4(total),
    matchedAmount: n4(matched),
    unmatchedAmount: unmatched,
    disputedAmount: n4(disputed),
    recoveredAmount: n4(recovered),
    writtenOffAmount: n4(writtenOff),
    openAmount: n4(open),
    invalidRate: total > 0 ? n4(unmatched / total) : null,
    winRate,
    recoverableEstimate: n4(open * (winRate ?? 0.5)),
  }
}
