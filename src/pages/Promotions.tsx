import { CalendarPlus, Search, Table2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageBody, PageHeader } from '../components/PageHeader'
import { Badge, Button, Card, Input, Segmented, Select, StatTile, StatusBadge } from '../components/ui'
import { Column, DataTable } from '../components/ui/DataTable'
import { CHAIN_CUSTOMERS } from '../data/catalog'
import { tacticColor, tacticName } from '../data/tactics'
import type { PromotionStatus } from '../data/types'
import { money, pct } from '../lib/calc/money'
import { formatShortDate } from '../lib/fiscal'
import { useStore } from '../store'
import { usePromotionPerformance, type PromotionPerformance } from '../store/selectors'

const STATUS_TONE: Record<PromotionStatus, 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent'> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'accent',
  active: 'good',
  closed: 'neutral',
  cancelled: 'critical',
}

type Scope = 'all' | 'live' | 'planned' | 'closed' | 'attention'

export function PromotionsPage() {
  const navigate = useNavigate()
  const today = useStore((s) => s.today)
  const all = usePromotionPerformance()

  const [scope, setScope] = useState<Scope>('all')
  const [chain, setChain] = useState('all')
  const [query, setQuery] = useState('')

  const scoped = useMemo(
    () => all.filter((p) => (chain === 'all' ? true : p.promotion.customerId === chain)),
    [all, chain],
  )

  const counts = useMemo(() => {
    const c = { all: scoped.length, live: 0, planned: 0, closed: 0, attention: 0 }
    for (const p of scoped) {
      if (p.promotion.status === 'active') c.live += 1
      if (p.promotion.status === 'draft' || p.promotion.status === 'submitted' || p.promotion.status === 'approved') c.planned += 1
      if (p.promotion.status === 'closed') c.closed += 1
      if (needsAttention(p)) c.attention += 1
    }
    return c
  }, [scoped])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((p) => {
      const s = p.promotion.status
      if (scope === 'live' && s !== 'active') return false
      if (scope === 'planned' && !['draft', 'submitted', 'approved'].includes(s)) return false
      if (scope === 'closed' && s !== 'closed') return false
      if (scope === 'attention' && !needsAttention(p)) return false
      if (!needle) return true
      return `${p.promotion.code} ${p.promotion.name} ${p.customerName} ${p.brands.join(' ')}`
        .toLowerCase()
        .includes(needle)
    })
  }, [scoped, scope, query])

  const totals = useMemo(() => {
    const plannedSpend = scoped
      .filter((p) => p.promotion.status !== 'cancelled' && p.promotion.status !== 'draft')
      .reduce((a, p) => a + p.economics.spend, 0)
    const closed = scoped.filter((p) => p.actual)
    const avgRoi = closed.length
      ? closed.reduce((a, p) => a + (p.actual!.trueRoi ?? 0), 0) / closed.length
      : null
    const losing = closed.filter((p) => (p.actual!.trueRoi ?? 0) < 0).length
    return { plannedSpend, avgRoi, losing, closedCount: closed.length }
  }, [scoped])

  const columns: Column<PromotionPerformance>[] = [
    {
      key: 'code', header: 'Promotion', sortable: true, sortValue: (p) => p.promotion.code,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{p.promotion.code}</p>
          <p className="truncate text-2xs text-ink-muted">{p.promotion.name}</p>
        </div>
      ),
    },
    {
      key: 'customer', header: 'Customer', sortable: true, hideBelow: 'md', width: '150px',
      sortValue: (p) => p.customerName,
      render: (p) => <span className="truncate text-ink">{p.customerName}</span>,
    },
    {
      key: 'tactics', header: 'Tactics', hideBelow: 'lg', width: '150px',
      render: (p) => (
        <div className="flex flex-wrap gap-1">
          {p.tactics.slice(0, 2).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 text-2xs text-ink-secondary">
              <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: tacticColor(t) }} />
              {tacticName(t)}
            </span>
          ))}
          {p.tactics.length > 2 && (
            <span className="text-2xs text-ink-muted">+{p.tactics.length - 2}</span>
          )}
        </div>
      ),
    },
    {
      key: 'window', header: 'On shelf', numeric: true, sortable: true, width: '116px',
      sortValue: (p) => p.promotion.performStart,
      render: (p) => (
        <div>
          <p className="text-ink">
            {formatShortDate(p.promotion.performStart)} – {formatShortDate(p.promotion.performEnd)}
          </p>
          <p className="text-2xs text-ink-muted">
            {p.promotion.performStart.slice(0, 4)}
          </p>
        </div>
      ),
    },
    {
      key: 'spend', header: 'Spend', numeric: true, sortable: true, width: '92px',
      sortValue: (p) => p.economics.spend,
      render: (p) => money(p.economics.spend),
    },
    {
      key: 'lift', header: 'Lift', numeric: true, sortable: true, width: '76px',
      sortValue: (p) => p.economics.liftPct ?? -1,
      render: (p) => (p.economics.liftPct !== null ? pct(p.economics.liftPct, 0) : '—'),
    },
    {
      key: 'roi', header: 'ROI', numeric: true, sortable: true, width: '110px',
      sortValue: (p) => p.actual?.trueRoi ?? p.economics.roi ?? -99,
      render: (p) => {
        const planned = p.economics.roi
        const actual = p.actual?.trueRoi
        const value = actual ?? planned
        if (value === null || value === undefined) return <span className="text-ink-muted">—</span>
        return (
          <div className="flex flex-col items-end">
            <span className={value < 0 ? 'font-medium text-critical' : 'font-medium text-ink'}>
              {pct(value, 0)}
            </span>
            <span className="text-2xs text-ink-muted">{actual !== undefined ? 'actual, true' : 'planned'}</span>
          </div>
        )
      },
    },
    {
      key: 'status', header: 'Status', width: '112px', sortable: true,
      sortValue: (p) => p.promotion.status,
      render: (p) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={STATUS_TONE[p.promotion.status]} label={p.promotion.status} />
          {needsAttention(p) && <Badge tone="critical">Losing money</Badge>}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Every event across the plan. ROI on closed events is the TRUE figure — cannibalization and post-promo dip already netted out — not the flattering headline number."
        actions={
          <Button icon={CalendarPlus} size="sm" variant="primary" onClick={() => navigate('/calendar')}>
            Plan in calendar
          </Button>
        }
        filters={
          <>
            <Segmented<Scope>
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'All', count: counts.all },
                { value: 'live', label: 'Live', count: counts.live },
                { value: 'planned', label: 'Planned', count: counts.planned },
                { value: 'closed', label: 'Closed', count: counts.closed },
                { value: 'attention', label: 'Losing money', count: counts.attention },
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
            <div className="relative w-56">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search code, name, brand…"
                className="pl-7"
              />
            </div>
          </>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Committed trade spend"
            value={money(totals.plannedSpend, { compact: true })}
            hint={`${counts.all} promotions`}
          />
          <StatTile
            label="Average true ROI"
            value={totals.avgRoi !== null ? pct(totals.avgRoi, 0) : '—'}
            hint={`across ${totals.closedCount} closed events`}
            deltaTone={totals.avgRoi !== null && totals.avgRoi < 0 ? 'critical' : 'good'}
          />
          <StatTile
            label="Events that lost money"
            value={String(totals.losing)}
            delta={totals.closedCount ? pct(totals.losing / totals.closedCount, 0) : undefined}
            deltaTone="critical"
            hint="of closed events"
            onClick={() => setScope('attention')}
            active={scope === 'attention'}
          />
          <StatTile label="Live right now" value={String(counts.live)} hint={`as at ${today}`} />
        </div>

        <Card padded={false} className="overflow-hidden">
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(p) => p.promotion.id}
            onRowClick={(p) => navigate(`/promotions/${p.promotion.id}`)}
            initialSort={{ key: 'window', dir: 'desc' }}
            maxHeight="calc(100vh - 380px)"
            dense
            emptyIcon={Table2}
            emptyTitle="No promotions in this view"
            emptyHint="Nothing matches the current filters. Try widening the customer filter or clearing the search."
            emptyAction={
              <Button size="sm" onClick={() => { setScope('all'); setChain('all'); setQuery('') }}>
                Clear filters
              </Button>
            }
            rowTone={(p) => (needsAttention(p) ? 'var(--status-critical)' : undefined)}
          />
        </Card>
      </PageBody>
    </>
  )
}

/** A closed event whose honest ROI is negative — the thing nobody wants to look at. */
function needsAttention(p: PromotionPerformance): boolean {
  return p.actual !== undefined && (p.actual.trueRoi ?? 0) < 0
}
