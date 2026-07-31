/**
 * Settings.
 *
 * The matcher tuning panel is here because it is the best proof the engine is
 * real: move a tolerance and every confidence score in the app recomputes
 * live. It also mirrors what a real implementation looks like — every customer
 * tunes these, and the reason-code mapping table is the single highest-value
 * piece of configuration in the product.
 */

import { RotateCcw, Sparkles } from 'lucide-react'
import { useMemo } from 'react'

import { PageBody, PageHeader } from '../components/PageHeader'
import {
  Badge, Button, Card, Divider, KeyValue, SectionHeader, StatTile,
} from '../components/ui'
import { Column, DataTable } from '../components/ui/DataTable'
import { CHAIN_CUSTOMERS } from '../data/catalog'
import type { ReasonCode } from '../data/types'
import {
  DEFAULT_MATCH_OPTIONS, DISPOSITIONS, DISPOSITION_LABEL, SIGNAL_META,
} from '../lib/calc/matching'
import { pct } from '../lib/calc/money'
import { useStore } from '../store'
import { useEnrichedDeductions } from '../store/selectors'

const CANONICAL_TONE: Record<ReasonCode['canonical'], 'good' | 'warning' | 'critical' | 'neutral'> = {
  trade_promotion: 'good',
  unknown: 'warning',
  shortage: 'critical',
  damages: 'critical',
  pricing: 'critical',
  compliance_fine: 'critical',
  freight: 'critical',
  returns: 'critical',
}

export function SettingsPage() {
  const options = useStore((s) => s.matchOptions)
  const setMatchOptions = useStore((s) => s.setMatchOptions)
  const resetDemo = useStore((s) => s.resetDemo)
  const dataset = useStore((s) => s.dataset)
  const rows = useEnrichedDeductions()

  const distribution = useMemo(() => {
    const counts: Record<string, number> = {
      auto_matched: 0, needs_review: 0, likely_invalid: 0, no_match: 0,
    }
    for (const r of rows) counts[r.match.disposition] += 1
    return counts
  }, [rows])

  /** One row per distinct code, collapsed across the customer family. */
  const reasonRows = useMemo(() => {
    const seen = new Map<string, { code: ReasonCode; chains: Set<string> }>()
    for (const rc of dataset.reasonCodes) {
      const chain = CHAIN_CUSTOMERS.find(
        (c) => c.id === rc.customerId || dataset.customers.find((x) => x.id === rc.customerId)?.parentId === c.id,
      )
      const key = `${chain?.id ?? rc.customerId}|${rc.externalCode}`
      const hit = seen.get(key)
      if (hit) hit.chains.add(chain?.name ?? '')
      else seen.set(key, { code: rc, chains: new Set([chain?.name ?? '']) })
    }
    return [...seen.values()].map((v) => ({
      id: `${v.code.customerId}-${v.code.externalCode}`,
      code: v.code,
      customer: [...v.chains].filter(Boolean).join(', '),
    }))
  }, [dataset.reasonCodes, dataset.customers])

  const reasonColumns: Column<(typeof reasonRows)[number]>[] = [
    {
      key: 'customer', header: 'Customer', sortable: true, sortValue: (r) => r.customer,
      render: (r) => <span className="truncate text-ink">{r.customer}</span>,
    },
    {
      key: 'code', header: 'Their code', width: '110px', sortable: true,
      sortValue: (r) => r.code.externalCode,
      render: (r) => <span className="tnum font-medium text-ink">{r.code.externalCode}</span>,
    },
    {
      key: 'label', header: 'Their label',
      render: (r) => <span className="text-ink-secondary">{r.code.externalLabel}</span>,
    },
    {
      key: 'canonical', header: 'Maps to', width: '160px', sortable: true,
      sortValue: (r) => r.code.canonical,
      render: (r) => (
        <Badge tone={CANONICAL_TONE[r.code.canonical]}>
          {r.code.canonical.replace('_', ' ')}
        </Badge>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Settings"
        description="Matching tolerances and reason-code mapping. Changing a tolerance re-scores every deduction in the app immediately — nothing here is pre-baked."
        actions={
          <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetDemo}>
            Reset demo data
          </Button>
        }
      />

      <PageBody>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <SectionHeader
              title="Deduction matching"
              subtitle="Tune the engine and watch the queue redistribute"
              actions={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setMatchOptions(DEFAULT_MATCH_OPTIONS)}
                >
                  Restore defaults
                </Button>
              }
            />

            <div className="mt-4 space-y-4">
              <Slider
                label="Amount tolerance"
                hint="How far a claim can sit from planned spend and still score a full amount match."
                value={options.amountTolerance}
                min={0.01} max={0.3} step={0.01}
                format={(v) => pct(v, 0)}
                onChange={(amountTolerance) => setMatchOptions({ amountTolerance })}
              />
              <Slider
                label="Date grace period"
                hint="Days before a performance window a deduction can arrive and still be considered."
                value={options.dateGraceDays}
                min={0} max={60} step={1}
                format={(v) => `${v} days`}
                onChange={(dateGraceDays) => setMatchOptions({ dateGraceDays })}
              />
              <Slider
                label="Minimum confidence to propose"
                hint="Below this the engine stays quiet rather than wasting an analyst's attention."
                value={options.minConfidence}
                min={0.3} max={0.9} step={0.01}
                format={(v) => pct(v, 0)}
                onChange={(minConfidence) => setMatchOptions({ minConfidence })}
              />
              <Slider
                label="Auto-accept threshold"
                hint="At or above this, with no warnings, the deduction settles without review."
                value={options.autoAcceptThreshold}
                min={0.7} max={1} step={0.01}
                format={(v) => pct(v, 0)}
                onChange={(autoAcceptThreshold) => setMatchOptions({ autoAcceptThreshold })}
              />
            </div>

            <Divider label="Result" />
            <div className="grid grid-cols-2 gap-2">
              {DISPOSITIONS.map((d) => (
                <div key={d} className="rounded-md bg-sunken px-2.5 py-2">
                  <p className="text-2xs text-ink-muted">{DISPOSITION_LABEL[d]}</p>
                  <p className="mt-0.5 text-lg font-semibold tnum text-ink">{distribution[d]}</p>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-4">
            <Card>
              <SectionHeader
                title="Signal weights"
                subtitle="The four core signals sum to 100%; a quoted promotion code adds a proportional lift on top"
              />
              <ul className="mt-3 space-y-2">
                {SIGNAL_META.map((s) => (
                  <li key={s.key} className="flex items-center gap-2.5">
                    <span className="w-[104px] shrink-0 text-xs text-ink-secondary">{s.label}</span>
                    <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${(s.weight / 0.31) * 100}%`,
                          background: s.key === 'reference' ? 'var(--text-muted)' : 'var(--accent)',
                        }}
                      />
                    </span>
                    <span className="w-9 shrink-0 text-right text-xs tnum text-ink-muted">
                      {pct(s.weight, 0)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-2xs leading-relaxed text-ink-muted">
                Product scope carries real weight because with a dozen live promotions per retailer,
                some event's planned spend will land within tolerance of almost any deduction
                amount. Customer, date and amount alone will confidently return the wrong answer.
              </p>
            </Card>

            <Card>
              <SectionHeader title="Organisation" />
              <dl className="mt-2">
                <KeyValue label="Tenant">{dataset.org.name}</KeyValue>
                <KeyValue label="Base currency">{dataset.org.baseCurrency}</KeyValue>
                <KeyValue label="Fiscal calendar">{dataset.org.fiscalCalendar}</KeyValue>
                <KeyValue label="Accrual GL account">{dataset.org.accrualGlAccount}</KeyValue>
                <KeyValue label="Customers" mono>{dataset.customers.length}</KeyValue>
                <KeyValue label="Products" mono>{dataset.products.length}</KeyValue>
                <KeyValue label="Promotions" mono>{dataset.promotions.length}</KeyValue>
                <KeyValue label="Weekly sales facts" mono>
                  {dataset.salesFacts.length.toLocaleString('en-US')}
                </KeyValue>
              </dl>
            </Card>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile
            label="Mapped reason codes"
            value={String(reasonRows.length)}
            hint="across all customers"
          />
          <StatTile
            label="Mapped to trade"
            value={String(reasonRows.filter((r) => r.code.canonical === 'trade_promotion').length)}
            hint="legitimately promotion-related"
          />
          <StatTile
            label="Unclassified"
            value={String(reasonRows.filter((r) => r.code.canonical === 'unknown').length)}
            hint="every one of these costs an analyst time"
            accent="var(--status-warning)"
          />
        </div>

        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <SectionHeader
              title="Reason code mapping"
              subtitle="Every retailer uses different codes for the same thing. This table is what stops an analyst translating by hand."
            />
            <Badge tone="accent" icon={Sparkles}>Per-customer</Badge>
          </div>
          <DataTable
            rows={reasonRows}
            columns={reasonColumns}
            rowKey={(r) => r.id}
            initialSort={{ key: 'customer', dir: 'asc' }}
            maxHeight="420px"
            dense
            emptyIcon={Sparkles}
            emptyTitle="No reason codes mapped"
            emptyHint="Map each retailer's chargeback codes to your own taxonomy so the engine can tell trade spend from a shortage claim."
          />
        </Card>
      </PageBody>
    </>
  )
}

function Slider({
  label, hint, value, min, max, step, format, onChange,
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[13px] font-medium text-ink">{label}</label>
        <span className="text-[13px] tnum text-accent">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-sunken accent-accent"
      />
      <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{hint}</p>
    </div>
  )
}
