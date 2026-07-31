/**
 * Deductions, disputes and settlements — the demo's centre of gravity.
 *
 * The mix below is deliberate. A deduction file that is 100% clean matches
 * perfectly and proves nothing; a real retailer file is roughly half clean,
 * with the rest split between partial claims, duplicates, miscoded non-trade
 * charges and outright orphans. Those last three categories are where the
 * recoverable money lives, so the seed manufactures each of them explicitly.
 */

import { CUSTOMERS, ORG, REASON_CODES, UNMAPPED_CODES, USERS } from '../catalog'
import type {
  Deduction, DeductionStatus, Dispute, Promotion, Settlement,
} from '../types'
import { n4 } from '../../lib/calc/money'
import { addDays, ageInDays } from '../../lib/fiscal'
import type { Rng } from '../rng'

export type DeductionFlavor =
  | 'clean'
  | 'partial'
  | 'duplicate'
  | 'overclaim'
  | 'unmapped'
  | 'non_trade'
  | 'orphan'

const FLAVOR_MIX: [DeductionFlavor, number][] = [
  ['clean', 40],
  ['partial', 13],
  ['duplicate', 8],
  ['overclaim', 8],
  ['unmapped', 8],
  ['non_trade', 12],
  ['orphan', 12],
]

const ANALYSTS = USERS.filter((u) => u.role === 'finance' || u.role === 'kam').map((u) => u.id)

const NON_TRADE_DESCRIPTIONS: Record<string, string[]> = {
  shortage: ['Concealed shortage claim', 'Receiving shortage — 4 cases', 'Short ship on PO'],
  damages: ['Unsaleable product credit', 'Damage allowance — pallet', 'Spoilage credit'],
  compliance_fine: ['OTIF penalty — late delivery', 'ASN accuracy fine', 'Vendor compliance penalty'],
  pricing: ['Price discrepancy vs. contract', 'Invoice priced above deal sheet'],
  freight: ['Freight adjustment — collect', 'Detention charge'],
  returns: ['Return to vendor authorisation'],
}

export interface DeductionSeedResult {
  deductions: Deduction[]
  disputes: Dispute[]
  settlements: Settlement[]
}

export function buildDeductions(
  rng: Rng,
  opts: {
    count: number
    today: string
    promotions: Promotion[]
    plannedSpendByPromotion: Map<string, number>
    /** Spend that can legitimately return as a chargeback. */
    claimableSpendByPromotion: Map<string, number>
    brandsByPromotion: Map<string, string[]>
    allBrands: string[]
  },
): DeductionSeedResult {
  const deductions: Deduction[] = []
  const disputes: Dispute[] = []
  const settlements: Settlement[] = []

  // Only promotions that have performed AND carry claimable money can generate
  // a chargeback. An off-invoice-only event has nothing left to claim.
  const settled = opts.promotions.filter(
    (p) =>
      (p.status === 'closed' || p.status === 'active') &&
      p.performStart <= opts.today &&
      (opts.claimableSpendByPromotion.get(p.id) ?? 0) > 0,
  )

  /**
   * Running total already claimed against each promotion.
   *
   * Without this the seeded book of deductions drifts to multiples of the spend
   * it is supposedly settling — 300 chargebacks each sized at ~100% of a
   * randomly chosen event. Bounding by remaining headroom makes the legitimate
   * deductions add up to roughly the claimable spend, which in turn makes the
   * duplicates and over-claims genuinely excess rather than just more of the same.
   */
  const claimedByPromo = new Map<string, number>()
  const remainingOn = (id: string) =>
    (opts.claimableSpendByPromotion.get(id) ?? 0) - (claimedByPromo.get(id) ?? 0)

  /** Find an event with headroom left to claim against. */
  const pickWithHeadroom = (): Promotion | null => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = rng.pick(settled)
      if (remainingOn(candidate.id) > 750) return candidate
    }
    return null
  }

  /** Fully-settled events are what a duplicate claim lands on. */
  const pickExhausted = (): Promotion | null => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const candidate = rng.pick(settled)
      if ((claimedByPromo.get(candidate.id) ?? 0) > 0 && remainingOn(candidate.id) <= 750) {
        return candidate
      }
    }
    return null
  }
  if (settled.length === 0) return { deductions, disputes, settlements }

  const bannersByChain = new Map<string, string[]>()
  for (const c of CUSTOMERS) {
    if (!c.parentId) continue
    const arr = bannersByChain.get(c.parentId)
    if (arr) arr.push(c.id)
    else bannersByChain.set(c.parentId, [c.id])
  }

  const tradeCodeFor = (customerId: string): string => {
    const pool = REASON_CODES.filter(
      (r) => r.customerId === customerId && r.canonical === 'trade_promotion',
    )
    return pool.length > 0 ? rng.pick(pool).externalCode : 'PROMO'
  }

  const usedForDuplicate: Promotion[] = []

  for (let i = 0; i < opts.count; i++) {
    const flavor = rng.weighted(FLAVOR_MIX)

    // Legitimate flavours need an event with money still owed on it; duplicates
    // deliberately target one that has already been settled in full.
    const promo =
      flavor === 'duplicate'
        ? (pickExhausted() ?? (usedForDuplicate.length > 0 ? rng.pick(usedForDuplicate) : rng.pick(settled)))
        : flavor === 'clean' || flavor === 'partial'
          ? pickWithHeadroom()
          : rng.pick(settled)
    if (!promo) continue

    const claimable = opts.claimableSpendByPromotion.get(promo.id) ?? 0
    const remaining = Math.max(0, remainingOn(promo.id))
    if (claimable <= 0) continue

    // ~35% of chargebacks arrive against a banner, not the chain we planned at.
    const banners = bannersByChain.get(promo.customerId) ?? []
    const customerId =
      banners.length > 0 && rng.chance(0.35) ? rng.pick(banners) : promo.customerId
    const chainCode = CUSTOMERS.find((c) => c.id === promo.customerId)?.code ?? 'XX'

    const promoBrands = opts.brandsByPromotion.get(promo.id) ?? []
    /** A brand that is NOT on this promotion — how an orphan gives itself away. */
    const wrongBrand = () => {
      const others = opts.allBrands.filter((b) => !promoBrands.includes(b))
      return others.length > 0 ? rng.pick(others) : undefined
    }
    const rightBrand = () => (promoBrands.length > 0 ? rng.pick(promoBrands) : undefined)

    let amount = remaining
    let externalReasonCode = tradeCodeFor(customerId)
    let description = `Promotional allowance — ${promo.performStart.slice(0, 7)}`
    let receivedDate = addDays(promo.performEnd, rng.int(14, 70))
    let brandHint: string | undefined = rng.chance(0.68) ? rightBrand() : undefined
    let invoiceRef: string | undefined = rng.chance(0.55)
      ? `INV-${rng.int(400000, 499999)}`
      : undefined

    switch (flavor) {
      case 'clean':
        // Settles what is still owed on the event, near enough to the penny.
        amount = n4(remaining * rng.float(0.96, 1.03))
        claimedByPromo.set(promo.id, (claimedByPromo.get(promo.id) ?? 0) + amount)
        if (rng.chance(0.4)) description = `${promo.code} settlement`
        break

      case 'partial':
        // Retailer settles store-by-store or region-by-region.
        amount = n4(remaining * rng.float(0.28, 0.72))
        claimedByPromo.set(promo.id, (claimedByPromo.get(promo.id) ?? 0) + amount)
        description = `Partial settlement — ${rng.pick(['region 4', 'div 12', 'stores 001-118', 'week 1 of 3'])}`
        break

      case 'duplicate':
        // A second full claim against an event already settled in full. The
        // amount keys off total claimable, not remaining — remaining is zero,
        // which is precisely what makes it a duplicate.
        amount = n4(claimable * rng.float(0.9, 1.05))
        description = `Promotional allowance — ${promo.performStart.slice(0, 7)}`
        receivedDate = addDays(promo.performEnd, rng.int(70, 130))
        break

      case 'overclaim':
        amount = n4(claimable * rng.float(1.35, 2.1))
        description = `Deal settlement — ${promo.code.slice(-4)}`
        break

      case 'unmapped':
        externalReasonCode = rng.pick(UNMAPPED_CODES)
        amount = n4(Math.max(remaining, claimable * 0.35) * rng.float(0.6, 1.1))
        description = rng.pick(['Allowance', 'Trade adjustment', 'Deal support', 'Misc allowance'])
        brandHint = rng.chance(0.4) ? rightBrand() : undefined
        invoiceRef = undefined
        break

      case 'non_trade': {
        const rc = rng.pick(
          REASON_CODES.filter(
            (r) => r.customerId === customerId && r.canonical !== 'trade_promotion' && r.canonical !== 'unknown',
          ),
        )
        if (rc) {
          externalReasonCode = rc.externalCode
          description = rng.pick(NON_TRADE_DESCRIPTIONS[rc.canonical] ?? ['Adjustment'])
        }
        // Sized against a real event: retailers miscode genuine trade money as
        // shortages and damages constantly, and a chargeback the engine CAN tie
        // to an event but that is coded as non-trade is a far stronger recovery
        // case than one it simply cannot place.
        amount = n4(claimable * rng.float(0.3, 0.9))
        // A shortage or damage claim rarely names a brand.
        brandHint = rng.chance(0.22) ? rightBrand() : undefined
        break
      }

      case 'orphan':
        // Arrives far outside any performance window, references nothing, and
        // when it does name a brand it is one we never promoted with them.
        amount = n4(rng.float(800, 26_000))
        receivedDate = addDays(promo.performEnd, rng.int(150, 320))
        description = rng.pick([
          'Allowance per agreement',
          'Trade support',
          'Deal — see backup',
          'Adjustment per buyer',
        ])
        brandHint = rng.chance(0.55) ? wrongBrand() : undefined
        invoiceRef = undefined
        break
    }

    if (amount < 100) continue
    if (receivedDate > opts.today) receivedDate = addDays(opts.today, -rng.int(1, 20))
    if (flavor === 'clean' && usedForDuplicate.length < 40) usedForDuplicate.push(promo)

    const age = ageInDays(receivedDate, opts.today)
    const status = statusForAge(rng, flavor, age)

    const deduction: Deduction = {
      id: `ded_${i}`,
      orgId: ORG.id,
      docNumber: `${chainCode}-CB-${receivedDate.slice(2, 4)}${String(100000 + i).slice(1)}`,
      customerId,
      invoiceRef,
      amount: Math.round(amount * 100) / 100,
      receivedDate,
      externalReasonCode,
      brandHint,
      description,
      status,
      assignedToId: status === 'open' ? undefined : rng.pick(ANALYSTS),
      backupDocUrl: rng.chance(0.35) ? `backup/${chainCode}-${i}.pdf` : undefined,
    }
    deductions.push(deduction)

    // ── Disputes on the categories worth fighting ──
    const worthDisputing =
      flavor === 'duplicate' || flavor === 'overclaim' || flavor === 'non_trade' || flavor === 'orphan'
    if (worthDisputing && (status === 'disputed' || status === 'recovered' || status === 'written_off')) {
      disputes.push(buildDispute(rng, deduction, flavor, status, opts.today))
    }

    if (status === 'settled' || status === 'recovered' || status === 'written_off') {
      settlements.push({
        id: `stl_${settlements.length}`,
        orgId: ORG.id,
        deductionId: deduction.id,
        type: status === 'written_off' ? 'write_off' : rng.chance(0.75) ? 'credit_memo' : 'check_request',
        amount: deduction.amount,
        postedAt: addDays(receivedDate, rng.int(20, 70)),
        erpReference: `CM-${rng.int(70000, 79999)}`,
      })
    }
  }

  return { deductions, disputes, settlements }
}

/**
 * Status follows age, which is what makes the aging report tell a story:
 * fresh deductions are open, mid-age ones are in review or dispute, and old
 * ones have resolved one way or the other.
 */
function statusForAge(rng: Rng, flavor: DeductionFlavor, age: number): DeductionStatus {
  const disputable = flavor === 'duplicate' || flavor === 'overclaim' || flavor === 'non_trade' || flavor === 'orphan'

  if (age <= 20) return rng.weighted<DeductionStatus>([['open', 7], ['review', 3]])
  if (age <= 55) {
    return disputable
      ? rng.weighted<DeductionStatus>([['review', 4], ['disputed', 4], ['open', 2]])
      : rng.weighted<DeductionStatus>([['matched', 6], ['review', 2], ['settled', 2]])
  }
  if (age <= 110) {
    return disputable
      ? rng.weighted<DeductionStatus>([['disputed', 4], ['recovered', 3], ['written_off', 2], ['review', 1]])
      : rng.weighted<DeductionStatus>([['settled', 6], ['matched', 3], ['disputed', 1]])
  }
  return disputable
    ? rng.weighted<DeductionStatus>([['recovered', 4], ['written_off', 4], ['settled', 2]])
    : rng.weighted<DeductionStatus>([['settled', 8], ['recovered', 1], ['written_off', 1]])
}

const DISPUTE_REASONS: Record<string, string[]> = {
  duplicate: [
    'Duplicate claim — this event was already settled in full',
    'Second deduction taken against the same promotion and period',
  ],
  overclaim: [
    'Claim exceeds the agreed allowance on the signed deal sheet',
    'Rate applied above contracted per-case allowance',
  ],
  non_trade: [
    'Coded as a shortage but the POD confirms full delivery',
    'Compliance fine assessed outside the contractual window',
    'Damage claim without supporting backup documentation',
  ],
  orphan: [
    'No promotion authorised for this customer in the deduction period',
    'No deal sheet or backup provided to substantiate the claim',
  ],
}

function buildDispute(
  rng: Rng,
  d: Deduction,
  flavor: DeductionFlavor,
  status: DeductionStatus,
  today: string,
): Dispute {
  const openedAt = addDays(d.receivedDate, rng.int(5, 25))
  const reason = rng.pick(DISPUTE_REASONS[flavor] ?? ['Unsubstantiated deduction'])

  let disputeStatus: Dispute['status']
  let recovered = 0
  if (status === 'recovered') {
    disputeStatus = rng.chance(0.72) ? 'won' : 'partial'
    recovered = disputeStatus === 'won' ? d.amount : n4(d.amount * rng.float(0.35, 0.8))
  } else if (status === 'written_off') {
    disputeStatus = 'lost'
  } else {
    disputeStatus = rng.chance(0.5) ? 'submitted' : 'open'
  }

  const correspondence: Dispute['correspondence'] = [
    { at: openedAt, author: 'Cascade Pantry', note: `Dispute opened. ${reason}` },
  ]
  if (disputeStatus !== 'open') {
    correspondence.push({
      at: addDays(openedAt, rng.int(4, 18)),
      author: 'Cascade Pantry',
      note: 'Backup submitted via the retailer vendor portal — deal sheet, POD and settlement history attached.',
    })
  }
  if (disputeStatus === 'won' || disputeStatus === 'partial' || disputeStatus === 'lost') {
    const closedNote =
      disputeStatus === 'won'
        ? 'Retailer accepted the dispute in full. Credit issued on the next remittance.'
        : disputeStatus === 'partial'
          ? 'Retailer accepted part of the claim; balance stands pending further backup.'
          : 'Retailer declined. Written off after review — outside the 90-day dispute window.'
    correspondence.push({
      at: addDays(openedAt, rng.int(25, 70)),
      author: 'Retailer AP',
      note: closedNote,
    })
  }

  const closedAt =
    disputeStatus === 'open' || disputeStatus === 'submitted'
      ? undefined
      : correspondence[correspondence.length - 1].at

  return {
    id: `dsp_${d.id}`,
    orgId: ORG.id,
    deductionId: d.id,
    reason,
    openedAt,
    openedById: d.assignedToId ?? 'u_carol',
    status: disputeStatus,
    claimedAmount: d.amount,
    recoveredAmount: Math.round(recovered * 100) / 100,
    closedAt: closedAt && closedAt <= today ? closedAt : undefined,
    correspondence,
  }
}
