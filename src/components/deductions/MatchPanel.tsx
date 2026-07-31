/**
 * Deduction detail + match review.
 *
 * The design bet: an analyst does not want a confidence number, they want to
 * know WHY. So each candidate shows its signal breakdown, the plain-English
 * reason behind every signal, and any warning that says "do not pay this" —
 * and the accept button sits next to that evidence, not on a separate screen.
 */

import { clsx } from 'clsx'
import {
  AlertTriangle, ArrowUpRight, Check, FileText, Gavel, Link2, Scale, X,
} from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { money, pct } from '../../lib/calc/money'
import {
  SIGNAL_META, confidenceBand, DISPOSITION_LABEL,
  type MatchCandidate,
} from '../../lib/calc/matching'
import { formatDate } from '../../lib/fiscal'
import { useStore } from '../../store'
import { useLookups, type EnrichedDeduction } from '../../store/selectors'
import { Badge, Button, Divider, Drawer, EmptyState, KeyValue, StatusBadge } from '../ui'

const DISPOSITION_TONE = {
  auto_matched: 'good',
  needs_review: 'warning',
  likely_invalid: 'critical',
  no_match: 'serious',
} as const

export function MatchPanel({
  row, onClose,
}: {
  row: EnrichedDeduction | null
  onClose: () => void
}) {
  if (!row) return null
  return (
    <Drawer
      open
      onClose={onClose}
      width="xl"
      title={
        <span className="flex items-center gap-2">
          {row.deduction.docNumber}
          <StatusBadge
            tone={DISPOSITION_TONE[row.match.disposition]}
            label={DISPOSITION_LABEL[row.match.disposition]}
          />
        </span>
      }
      subtitle={`${row.customerName} · received ${formatDate(row.deduction.receivedDate)} · ${row.ageDays} days old`}
    >
      <MatchPanelBody row={row} />
    </Drawer>
  )
}

function MatchPanelBody({ row }: { row: EnrichedDeduction }) {
  const { deduction, match } = row
  const acceptMatch = useStore((s) => s.acceptMatch)
  const rejectMatch = useStore((s) => s.rejectMatch)
  const openDispute = useStore((s) => s.openDispute)
  const dataset = useStore((s) => s.dataset)
  const { customersById } = useLookups()

  const dispute = dataset.disputes.find((d) => d.deductionId === deduction.id)
  const reasonCode = dataset.reasonCodes.find(
    (r) => r.customerId === deduction.customerId && r.externalCode === deduction.externalReasonCode,
  )

  return (
    <div className="space-y-4">
      {/* ── The claim ───────────────────────────────────────────────────── */}
      <section className="rounded-lg bg-surface p-3.5 ring-1 ring-hairline">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-2xs uppercase tracking-wide text-ink-muted">Amount deducted</p>
            <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink tnum">
              {money(deduction.amount, { cents: true })}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xs uppercase tracking-wide text-ink-muted">Status</p>
            <p className="mt-1 text-[13px] font-medium capitalize text-ink">
              {deduction.status.replace('_', ' ')}
            </p>
          </div>
        </div>

        <Divider />

        <dl className="grid gap-x-6 sm:grid-cols-2">
          <KeyValue label="Customer">{row.customerName}</KeyValue>
          <KeyValue label="Chain">{row.chainName}</KeyValue>
          <KeyValue label="Reason code" mono>
            {deduction.externalReasonCode}
            {reasonCode ? (
              <span className="ml-1.5 text-ink-muted">
                {reasonCode.externalLabel} → {reasonCode.canonical.replace('_', ' ')}
              </span>
            ) : (
              <Badge tone="warning" className="ml-1.5">Unmapped</Badge>
            )}
          </KeyValue>
          <KeyValue label="Invoice reference" mono>{deduction.invoiceRef ?? '—'}</KeyValue>
          <KeyValue label="Brand named">{deduction.brandHint ?? '—'}</KeyValue>
          <KeyValue label="Age">{row.ageDays} days ({row.bucket})</KeyValue>
          <KeyValue label="Description">{deduction.description}</KeyValue>
          <KeyValue label="Backup document">
            {deduction.backupDocUrl ? (
              <span className="inline-flex items-center gap-1 text-accent">
                <FileText size={11} /> attached
              </span>
            ) : (
              <span className="text-ink-muted">none provided</span>
            )}
          </KeyValue>
        </dl>
      </section>

      {/* ── Candidates ──────────────────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold tracking-tight text-ink">
            Candidate promotions
          </h3>
          {match.resolved && (
            <Badge tone={match.resolved === 'accepted' ? 'good' : 'neutral'}>
              {match.resolved === 'accepted' ? 'Match accepted' : 'Match rejected'}
            </Badge>
          )}
        </div>

        {match.candidates.length === 0 ? (
          <div className="rounded-lg bg-surface ring-1 ring-hairline">
            <EmptyState
              icon={Link2}
              title="No promotion credibly matches this deduction"
              hint="Nothing in this customer's promotion calendar lines up on date, amount and product scope. That usually means the deduction is unauthorised — open a dispute and ask the retailer for backup."
              action={
                !dispute && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={Gavel}
                    onClick={() =>
                      openDispute(
                        deduction.id,
                        'No promotion authorised for this customer in the deduction period',
                      )
                    }
                  >
                    Open dispute
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <ul className="space-y-2">
            {match.candidates.map((c, i) => (
              <CandidateCard
                key={c.promotionId}
                candidate={c}
                rank={i}
                accepted={match.acceptedPromotionId === c.promotionId}
                disabled={!!match.resolved}
                onAccept={() => acceptMatch(deduction.id, c.promotionId)}
                onReject={() => rejectMatch(deduction.id)}
                customerName={customersById.get(
                  dataset.promotions.find((p) => p.id === c.promotionId)?.customerId ?? '',
                )?.name}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ── Dispute ─────────────────────────────────────────────────────── */}
      {dispute ? (
        <section className="rounded-lg bg-surface p-3.5 ring-1 ring-hairline">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                <Scale size={13} /> Dispute
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{dispute.reason}</p>
            </div>
            <Badge
              tone={
                dispute.status === 'won' ? 'good'
                  : dispute.status === 'partial' ? 'warning'
                    : dispute.status === 'lost' ? 'critical' : 'neutral'
              }
            >
              {dispute.status}
            </Badge>
          </div>

          <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
            <KeyValue label="Claimed" mono>{money(dispute.claimedAmount, { cents: true })}</KeyValue>
            <KeyValue label="Recovered" mono>
              <span className={dispute.recoveredAmount > 0 ? 'text-good' : 'text-ink-muted'}>
                {money(dispute.recoveredAmount, { cents: true })}
              </span>
            </KeyValue>
            <KeyValue label="Opened">{formatDate(dispute.openedAt)}</KeyValue>
            <KeyValue label="Closed">{dispute.closedAt ? formatDate(dispute.closedAt) : '—'}</KeyValue>
          </dl>

          <Divider label="Correspondence" />
          <ol className="space-y-2">
            {dispute.correspondence.map((c, i) => (
              <li key={i} className="flex gap-2.5">
                <div className="flex flex-col items-center pt-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                  {i < dispute.correspondence.length - 1 && (
                    <span className="mt-1 w-px flex-1 bg-hairline" />
                  )}
                </div>
                <div className="pb-1">
                  <p className="text-2xs text-ink-muted">
                    {formatDate(c.at)} · {c.author}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{c.note}</p>
                </div>
              </li>
            ))}
          </ol>

          {(dispute.status === 'open' || dispute.status === 'submitted') && (
            <ResolveDispute disputeId={dispute.id} claimed={dispute.claimedAmount} />
          )}
        </section>
      ) : (
        match.candidates.length > 0 && (
          <DisputeLauncher deductionId={deduction.id} candidates={match.candidates} />
        )
      )}
    </div>
  )
}

// ── Candidate card ─────────────────────────────────────────────────────────

function CandidateCard({
  candidate, rank, accepted, disabled, onAccept, onReject, customerName,
}: {
  candidate: MatchCandidate
  rank: number
  accepted: boolean
  disabled: boolean
  onAccept: () => void
  onReject: () => void
  customerName?: string
}) {
  const band = confidenceBand(candidate.confidence)
  const invalidating = candidate.warnings.filter((w) => w.invalidates)

  return (
    <li
      className={clsx(
        'rounded-lg bg-surface p-3 ring-1 transition-colors',
        accepted ? 'ring-good' : rank === 0 ? 'ring-hairline' : 'ring-hairline opacity-95',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link
              to={`/promotions/${candidate.promotionId}`}
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline"
            >
              {candidate.promotionCode}
              <ArrowUpRight size={12} />
            </Link>
            {rank === 0 && <Badge tone="accent">Best match</Badge>}
            <StatusBadge tone={band.tone} label={`${band.label} · ${pct(candidate.confidence, 0)}`} />
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-secondary">{candidate.promotionName}</p>
          {customerName && <p className="text-2xs text-ink-muted">{customerName}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {!disabled && (
            <>
              <Button size="sm" variant="ghost" icon={X} onClick={onReject}>Reject</Button>
              {candidate.amount > 0 ? (
                <Button size="sm" variant="primary" icon={Check} onClick={onAccept}>
                  Accept {money(candidate.amount, { compact: true })}
                </Button>
              ) : (
                // Nothing claimable on this event, so there is nothing to settle
                // against it — showing an Accept button here would invite the
                // exact mistake the engine exists to prevent.
                <Badge tone="critical" icon={AlertTriangle}>Nothing to settle</Badge>
              )}
            </>
          )}
          {accepted && <Badge tone="good" icon={Check}>Matched</Badge>}
        </div>
      </div>

      {/* Signal breakdown — this is the "why", and it is the whole point. */}
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {SIGNAL_META.map((s) => {
          const score = candidate.signals[s.key]
          return (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="w-[86px] shrink-0 text-2xs text-ink-muted">{s.label}</span>
              <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-sunken">
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(1, score) * 100}%`,
                    background:
                      score >= 0.9 ? 'var(--status-good)'
                        : score >= 0.5 ? 'var(--status-warning)'
                          : 'var(--status-critical)',
                  }}
                />
              </span>
              <span className="w-6 shrink-0 text-right text-2xs tnum text-ink-muted">
                {Math.round(score * 100)}
              </span>
            </div>
          )
        })}
      </div>

      <ul className="mt-2 space-y-0.5 border-t border-hairline pt-2">
        {candidate.reasons.map((r, i) => (
          <li key={i} className="flex gap-1.5 text-2xs leading-relaxed text-ink-secondary">
            <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-baseline" />
            {r}
          </li>
        ))}
      </ul>

      {candidate.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {candidate.warnings.map((w) => (
            <li
              key={w.code}
              className={clsx(
                'flex items-start gap-1.5 rounded px-2 py-1.5 text-2xs leading-relaxed ring-1 ring-inset',
                w.invalidates
                  ? 'bg-critical/8 text-critical ring-critical/20'
                  : 'bg-warning/10 text-warning ring-warning/25',
              )}
            >
              <AlertTriangle size={11} strokeWidth={2.2} className="mt-px shrink-0" />
              {w.message}
            </li>
          ))}
        </ul>
      )}

      {invalidating.length > 0 && !disabled && (
        <p className="mt-2 text-2xs text-ink-muted">
          The engine believes this money is not owed. Reject the match and open a dispute rather
          than accepting it.
        </p>
      )}
    </li>
  )
}

// ── Dispute actions ────────────────────────────────────────────────────────

function DisputeLauncher({
  deductionId, candidates,
}: {
  deductionId: string
  candidates: MatchCandidate[]
}) {
  const openDispute = useStore((s) => s.openDispute)
  const invalidating = candidates[0]?.warnings.filter((w) => w.invalidates) ?? []
  const suggested = invalidating[0]?.message ?? 'Unsubstantiated deduction — backup requested'
  const [reason, setReason] = useState(suggested)

  return (
    <section className="rounded-lg bg-surface p-3.5 ring-1 ring-hairline">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
        <Scale size={13} /> Dispute this deduction
      </h3>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
        {invalidating.length > 0
          ? 'The engine flagged this as likely invalid. Disputing it starts the recovery clock and builds the correspondence trail.'
          : 'If the claim is not substantiated, dispute it before the retailer’s window closes.'}
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mt-2 w-full resize-none rounded-md bg-raised p-2 text-xs text-ink ring-1 ring-hairline focus:ring-accent"
      />
      <div className="mt-2 flex justify-end">
        <Button
          variant="primary"
          size="sm"
          icon={Gavel}
          disabled={!reason.trim()}
          onClick={() => openDispute(deductionId, reason.trim())}
        >
          Open dispute
        </Button>
      </div>
    </section>
  )
}

function ResolveDispute({ disputeId, claimed }: { disputeId: string; claimed: number }) {
  const resolveDispute = useStore((s) => s.resolveDispute)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
      <span className="text-2xs text-ink-muted">Record outcome:</span>
      <Button size="sm" variant="primary" onClick={() => resolveDispute(disputeId, 'won', claimed)}>
        Recovered in full
      </Button>
      <Button size="sm" onClick={() => resolveDispute(disputeId, 'partial', Math.round(claimed * 0.5))}>
        Partial (50%)
      </Button>
      <Button size="sm" variant="ghost" onClick={() => resolveDispute(disputeId, 'lost', 0)}>
        Write off
      </Button>
    </div>
  )
}
