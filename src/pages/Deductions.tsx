/**
 * Deduction management — the screen the sales motion leads with.
 *
 * The order on the page is the order of the argument: here is what they took,
 * here is what our engine believes should never have been paid, here is what
 * you have recovered so far, and here is the queue that turns the second
 * number into the third.
 */

import { Inbox, ReceiptText, RotateCcw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { BarChart } from '../components/charts/BarChart'
import { seriesColor } from '../components/charts/frame'
import { MatchPanel } from '../components/deductions/MatchPanel'
import { PageBody, PageHeader } from '../components/PageHeader'
import { Badge, Button, Card, Input, InfoTip, Segmented, Select, StatTile, StatusBadge } from '../components/ui'
import { Column, DataTable } from '../components/ui/DataTable'
import { CHAIN_CUSTOMERS } from '../data/catalog'
import { money, pct } from '../lib/calc/money'
import {
  DISPOSITION_LABEL, confidenceBand, summariseRecovery,
  type MatchDisposition,
} from '../lib/calc/matching'
import { AGE_BUCKETS, formatShortDate } from '../lib/fiscal'
import { useStore } from '../store'
import { useEnrichedDeductions, type EnrichedDeduction } from '../store/selectors'

const DISPOSITION_TONE = {
  auto_matched: 'good',
  needs_review: 'warning',
  likely_invalid: 'critical',
  no_match: 'serious',
} as const

type Scope = 'all' | MatchDisposition

export function DeductionsPage() {
  const [params, setParams] = useSearchParams()
  const rows = useEnrichedDeductions()
  const dataset = useStore((s) => s.dataset)
  const resetDemo = useStore((s) => s.resetDemo)

  const [scope, setScope] = useState<Scope>('all')
  const [chain, setChain] = useState<string>('all')
  const [bucket, setBucket] = useState<string>('all')
  const [query, setQuery] = useState('')

  const openId = params.get('open')
  const openRow = rows.find((r) => r.deduction.id === openId) ?? null
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('open', id)
    else next.delete('open')
    setParams(next, { replace: true })
  }

  const scoped = useMemo(
    () => rows.filter((r) => (chain === 'all' ? true : r.chainId === chain)),
    [rows, chain],
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((r) => {
      if (scope !== 'all' && r.match.disposition !== scope) return false
      if (bucket !== 'all' && r.bucket !== bucket) return false
      if (!needle) return true
      return `${r.deduction.docNumber} ${r.deduction.description} ${r.customerName} ${r.deduction.externalReasonCode} ${r.deduction.brandHint ?? ''}`
        .toLowerCase()
        .includes(needle)
    })
  }, [scoped, scope, bucket, query])

  // ── Headline recovery economics ─────────────────────────────────────────
  const recovery = useMemo(() => {
    const deductions = scoped.map((r) => r.deduction)
    const ids = new Set(deductions.map((d) => d.id))
    const matchedIds = new Set(
      scoped.filter((r) => r.match.disposition === 'auto_matched' || r.match.resolved === 'accepted')
        .map((r) => r.deduction.id),
    )
    return summariseRecovery(
      deductions,
      dataset.disputes.filter((d) => ids.has(d.deductionId)),
      matchedIds,
    )
  }, [scoped, dataset.disputes])

  const invalidValue = useMemo(
    () =>
      scoped
        .filter((r) => r.match.disposition === 'likely_invalid' || r.match.disposition === 'no_match')
        .reduce((a, r) => a + r.deduction.amount, 0),
    [scoped],
  )

  const counts = useMemo(() => {
    const c: Record<Scope, number> = {
      all: scoped.length, auto_matched: 0, needs_review: 0, likely_invalid: 0, no_match: 0,
    }
    for (const r of scoped) c[r.match.disposition] += 1
    return c
  }, [scoped])

  const aging = useMemo(() => {
    const byBucket = new Map<string, { amount: number; count: number }>()
    for (const r of scoped) {
      if (r.deduction.status === 'settled' || r.deduction.status === 'recovered') continue
      const cur = byBucket.get(r.bucket) ?? { amount: 0, count: 0 }
      cur.amount += r.deduction.amount
      cur.count += 1
      byBucket.set(r.bucket, cur)
    }
    return AGE_BUCKETS.map((b, i) => ({
      key: b,
      label: `${b} days`,
      value: byBucket.get(b)?.amount ?? 0,
      // Sequential ramp: age IS magnitude, so one hue getting darker, not eight hues.
      color: `var(--seq-${[200, 300, 400, 500, 700][i]})`,
      detail: [{ label: 'Deductions', value: String(byBucket.get(b)?.count ?? 0) }],
    }))
  }, [scoped])

  const columns: Column<EnrichedDeduction>[] = [
    {
      key: 'doc', header: 'Document', sortable: true, width: '138px',
      sortValue: (r) => r.deduction.docNumber,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{r.deduction.docNumber}</p>
          <p className="truncate text-2xs text-ink-muted">{r.deduction.description}</p>
        </div>
      ),
    },
    {
      key: 'customer', header: 'Customer', sortable: true, hideBelow: 'md',
      sortValue: (r) => r.customerName,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-ink">{r.customerName}</p>
          {r.deduction.brandHint && (
            <p className="truncate text-2xs text-ink-muted">{r.deduction.brandHint}</p>
          )}
        </div>
      ),
    },
    {
      key: 'reason', header: 'Code', hideBelow: 'lg', width: '78px',
      render: (r) => <span className="tnum text-ink-secondary">{r.deduction.externalReasonCode}</span>,
    },
    {
      key: 'received', header: 'Received', numeric: true, sortable: true, width: '92px', hideBelow: 'sm',
      sortValue: (r) => r.deduction.receivedDate,
      render: (r) => (
        <div>
          <p className="text-ink">{formatShortDate(r.deduction.receivedDate)}</p>
          <p className="text-2xs text-ink-muted">{r.ageDays}d</p>
        </div>
      ),
    },
    {
      key: 'amount', header: 'Amount', numeric: true, sortable: true, width: '104px',
      sortValue: (r) => r.deduction.amount,
      render: (r) => <span className="font-medium">{money(r.deduction.amount)}</span>,
    },
    {
      key: 'match', header: 'Engine verdict', width: '210px', sortable: true,
      sortValue: (r) => r.match.candidates[0]?.confidence ?? -1,
      render: (r) => {
        const top = r.match.candidates[0]
        return (
          <div className="flex flex-col gap-0.5">
            <StatusBadge
              tone={DISPOSITION_TONE[r.match.disposition]}
              label={DISPOSITION_LABEL[r.match.disposition]}
            />
            {top && (
              <span className="truncate text-2xs text-ink-muted">
                {top.promotionCode} · {pct(top.confidence, 0)} {confidenceBand(top.confidence).label.toLowerCase()}
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'status', header: 'Status', width: '104px', sortable: true, hideBelow: 'lg',
      sortValue: (r) => r.deduction.status,
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <span className="text-2xs capitalize text-ink-secondary">
            {r.deduction.status.replace('_', ' ')}
          </span>
          {r.recovered > 0 && (
            <Badge tone="good">+{money(r.recovered, { compact: true })}</Badge>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Deductions"
        description="Every chargeback the retailers took, scored against your promotion calendar. The engine proposes a match and shows its evidence; you decide what to pay and what to fight."
        actions={
          <Button icon={RotateCcw} size="sm" variant="ghost" onClick={resetDemo}>
            Reset demo
          </Button>
        }
        filters={
          <>
            <Segmented<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'auto_matched', label: 'Auto-matched', count: counts.auto_matched },
                { value: 'needs_review', label: 'Needs review', count: counts.needs_review },
                { value: 'likely_invalid', label: 'Likely invalid', count: counts.likely_invalid },
                { value: 'no_match', label: 'No match', count: counts.no_match },
              ]}
            />
            <Select
              ariaLabel="Filter by customer"
              className="w-48"
              value={chain}
              onChange={setChain}
              options={[
                { value: 'all', label: 'All customers' },
                ...CHAIN_CUSTOMERS.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              ariaLabel="Filter by age"
              className="w-36"
              value={bucket}
              onChange={setBucket}
              options={[
                { value: 'all', label: 'Any age' },
                ...AGE_BUCKETS.map((b) => ({ value: b, label: `${b} days` })),
              ]}
            />
            <div className="relative w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search document, code, brand…"
                className="pl-7"
              />
            </div>
          </>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Total deducted"
            value={money(recovery.totalDeducted, { compact: true })}
            hint={`${scoped.length} chargebacks`}
            accent={seriesColor(0)}
          />
          <StatTile
            label="Likely invalid or unmatched"
            value={money(invalidValue, { compact: true })}
            delta={recovery.totalDeducted > 0 ? pct(invalidValue / recovery.totalDeducted) : '—'}
            deltaTone="critical"
            hint="of everything they took"
            accent="var(--status-critical)"
            onClick={() => setScope('likely_invalid')}
            active={scope === 'likely_invalid'}
          />
          <StatTile
            label="Recovered"
            value={money(recovery.recoveredAmount, { compact: true })}
            delta={recovery.winRate !== null ? `${pct(recovery.winRate, 0)} win rate` : undefined}
            deltaTone="good"
            hint={`on ${money(recovery.disputedAmount, { compact: true })} disputed`}
            accent="var(--status-good)"
          />
          <StatTile
            label="Still recoverable"
            value={money(recovery.recoverableEstimate, { compact: true })}
            hint="open value × your win rate"
            accent={seriesColor(3)}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Card padded={false} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <h2 className="text-[13px] font-semibold tracking-tight text-ink">
                {scope === 'all' ? 'All deductions' : DISPOSITION_LABEL[scope]}
                <span className="ml-1.5 font-normal text-ink-muted">{filtered.length}</span>
              </h2>
              <span className="flex items-center gap-1 text-2xs text-ink-muted">
                Sorted by engine verdict
                <InfoTip>
                  Confidence is a weighted score over customer, date window, amount, reason code and
                  product scope, with a bonus when the retailer quotes the promotion code. Open any
                  row to see the full breakdown.
                </InfoTip>
              </span>
            </div>
            <DataTable
              rows={filtered}
              columns={columns}
              rowKey={(r) => r.deduction.id}
              onRowClick={(r) => setOpen(r.deduction.id)}
              selectedKey={openId ?? undefined}
              initialSort={{ key: 'amount', dir: 'desc' }}
              maxHeight="640px"
              dense
              emptyIcon={Inbox}
              emptyTitle="Nothing in this view"
              emptyHint="No deduction matches the current filters. Clear the search or widen the customer and age filters."
              emptyAction={
                <Button
                  size="sm"
                  onClick={() => {
                    setScope('all'); setChain('all'); setBucket('all'); setQuery('')
                  }}
                >
                  Clear filters
                </Button>
              }
              rowTone={(r) =>
                r.match.disposition === 'likely_invalid' ? 'var(--status-critical)'
                  : r.match.disposition === 'no_match' ? 'var(--status-serious)'
                    : undefined
              }
            />
          </Card>

          <div className="space-y-4">
            <BarChart
              title="Open deductions by age"
              subtitle="Unsettled value. The retailer's dispute window usually closes at 90 days."
              data={aging}
              format={(v) => money(v, { compact: true })}
              labelWidth={78}
              tableValueHead="Open value"
              onSelect={(k) => setBucket(bucket === k ? 'all' : k)}
              selectedKey={bucket === 'all' ? undefined : bucket}
            />

            <Card>
              <h3 className="text-[13px] font-semibold tracking-tight text-ink">
                Why this pays for itself
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                Of {money(recovery.totalDeducted, { compact: true })} deducted,{' '}
                <strong className="text-ink">{money(invalidValue, { compact: true })}</strong> has no
                promotion behind it or is flagged as something other than trade spend. At your
                current {recovery.winRate !== null ? pct(recovery.winRate, 0) : '—'} win rate that
                is roughly{' '}
                <strong className="text-ink">
                  {money(recovery.recoverableEstimate, { compact: true })}
                </strong>{' '}
                still on the table.
              </p>
              <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
                Nobody researches these by hand because there is never time. That is the entire
                product thesis.
              </p>
            </Card>
          </div>
        </div>
      </PageBody>

      <MatchPanel row={openRow} onClose={() => setOpen(null)} />
    </>
  )
}

export { ReceiptText }
