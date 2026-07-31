/**
 * Analytics.
 *
 * The honest-reporting screen. The promotion leaderboard ranks on TRUE ROI —
 * cannibalization and post-promo dip already netted out — and shows the gap to
 * the reported figure explicitly. Most tools in this category quietly report
 * gross lift because it flatters the buyer; being straight about it is the
 * durable trust advantage.
 */

import { BarChart3, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { BarChart, StackedBar } from '../components/charts/BarChart'
import { seriesColor } from '../components/charts/frame'
import { LineChart } from '../components/charts/LineChart'
import { Waterfall } from '../components/charts/Waterfall'
import { PageBody, PageHeader } from '../components/PageHeader'
import { Badge, Card, InfoTip, SectionHeader, Segmented, Select, StatTile } from '../components/ui'
import { Column, DataTable } from '../components/ui/DataTable'
import { CHAIN_CUSTOMERS } from '../data/catalog'
import { tacticColor } from '../data/tactics'
import { money, pct, units as fmtUnits } from '../lib/calc/money'
import { addWeeks, formatShortDate } from '../lib/fiscal'
import { useStore } from '../store'
import {
  usePromotionPerformance, useSalesIndex, useSpendByTactic, useWaterfall,
  type PromotionPerformance,
} from '../store/selectors'

type Range = '13w' | '26w' | '52w' | 'all'

const RANGE_WEEKS: Record<Range, number | null> = { '13w': 13, '26w': 26, '52w': 52, all: null }

export function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const today = useStore((s) => s.today)

  const [range, setRange] = useState<Range>('52w')
  const chain = params.get('customer') ?? 'all'
  const setChain = (v: string) => {
    const next = new URLSearchParams(params)
    if (v === 'all') next.delete('customer')
    else next.set('customer', v)
    setParams(next, { replace: true })
  }

  const fromWeek = useMemo(() => {
    const w = RANGE_WEEKS[range]
    return w ? addWeeks(today, -w) : undefined
  }, [range, today])

  const scopeChain = chain === 'all' ? undefined : chain
  const waterfall = useWaterfall({ fromWeek, toWeek: today, chainId: scopeChain })
  const sales = useSalesIndex(fromWeek, today)
  const byTactic = useSpendByTactic(scopeChain)
  const performance = usePromotionPerformance()

  // ── Closed events in scope, ranked on the honest number ────────────────
  const closed = useMemo(
    () =>
      performance
        .filter((p) => p.actual)
        .filter((p) => (scopeChain ? p.promotion.customerId === scopeChain : true))
        .filter((p) => (fromWeek ? p.promotion.performEnd >= fromWeek : true)),
    [performance, scopeChain, fromWeek],
  )

  const leaderboard = useMemo(
    () => [...closed].sort((a, b) => (b.actual!.trueRoi ?? -99) - (a.actual!.trueRoi ?? -99)),
    [closed],
  )

  const honesty = useMemo(() => {
    const reportedLift = closed.reduce((a, p) => a + p.actual!.reportedLiftUnits, 0)
    const cannibal = closed.reduce((a, p) => a + p.actual!.cannibalizedUnits, 0)
    const pantry = closed.reduce((a, p) => a + p.actual!.pantryLoadUnits, 0)
    const trueLift = Math.max(0, reportedLift - cannibal - pantry)
    return { reportedLift, cannibal, pantry, trueLift }
  }, [closed])

  // ── Revenue vs trade spend over time ───────────────────────────────────
  const trend = useMemo(() => {
    const weeks = sales.weeks
    const gross = weeks.map((w) => {
      const key = scopeChain ? `${scopeChain}|${w}` : null
      const cell = key ? sales.byChainWeek.get(key) : sales.byWeek.get(w)
      return cell?.grossSales ?? 0
    })
    const offInvoice = weeks.map((w) => {
      const key = scopeChain ? `${scopeChain}|${w}` : null
      const cell = key ? sales.byChainWeek.get(key) : sales.byWeek.get(w)
      return cell?.offInvoice ?? 0
    })
    return { weeks, gross, offInvoice }
  }, [sales, scopeChain])

  const customerMix = useMemo(() => {
    const entries = [...sales.byChain.entries()]
      .map(([id, r]) => ({
        key: id,
        label: CHAIN_CUSTOMERS.find((c) => c.id === id)?.name ?? id,
        value: r.grossSales,
      }))
      .sort((a, b) => b.value - a.value)
    // Fixed slot order, top seven then Other — hues are never generated.
    const top = entries.slice(0, 7).map((e, i) => ({ ...e, color: seriesColor(i) }))
    const rest = entries.slice(7)
    if (rest.length > 0) {
      top.push({
        key: 'other',
        label: `Other (${rest.length})`,
        value: rest.reduce((a, e) => a + e.value, 0),
        color: 'var(--text-muted)',
      })
    }
    return top
  }, [sales.byChain])

  const columns: Column<PromotionPerformance>[] = [
    {
      key: 'code', header: 'Promotion', sortable: true, sortValue: (p) => p.promotion.code,
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{p.promotion.code}</p>
          <p className="truncate text-2xs text-ink-muted">{p.customerName}</p>
        </div>
      ),
    },
    {
      key: 'spend', header: 'Spend', numeric: true, sortable: true, width: '96px',
      sortValue: (p) => p.actual!.actualSpend,
      render: (p) => money(p.actual!.actualSpend),
    },
    {
      key: 'reportedLift', header: 'Reported lift', numeric: true, sortable: true, width: '104px', hideBelow: 'md',
      sortValue: (p) => p.actual!.reportedLiftUnits,
      render: (p) => fmtUnits(p.actual!.reportedLiftUnits, true),
    },
    {
      key: 'leakage', header: 'Cannibal. + dip', numeric: true, sortable: true, width: '116px', hideBelow: 'lg',
      sortValue: (p) => p.actual!.cannibalizedUnits + p.actual!.pantryLoadUnits,
      render: (p) => (
        <span className="text-critical">
          −{fmtUnits(p.actual!.cannibalizedUnits + p.actual!.pantryLoadUnits, true)}
        </span>
      ),
    },
    {
      key: 'trueLift', header: 'True lift', numeric: true, sortable: true, width: '96px',
      sortValue: (p) => p.actual!.trueIncrementalUnits,
      render: (p) => fmtUnits(p.actual!.trueIncrementalUnits, true),
    },
    {
      key: 'quality', header: 'Quality of lift', numeric: true, sortable: true, width: '110px', hideBelow: 'md',
      sortValue: (p) => p.actual!.qualityOfLift ?? 0,
      render: (p) => (p.actual!.qualityOfLift !== null ? pct(p.actual!.qualityOfLift, 0) : '—'),
    },
    {
      key: 'roiGap', header: 'Reported → true ROI', numeric: true, sortable: true, width: '154px',
      sortValue: (p) => p.actual!.trueRoi ?? -99,
      render: (p) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-ink-muted line-through">
            {p.actual!.reportedRoi !== null ? pct(p.actual!.reportedRoi, 0) : '—'}
          </span>
          <span
            className={
              (p.actual!.trueRoi ?? 0) < 0 ? 'font-semibold text-critical' : 'font-semibold text-ink'
            }
          >
            {p.actual!.trueRoi !== null ? pct(p.actual!.trueRoi, 0) : '—'}
          </span>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Gross-to-net, promotion effectiveness and spend efficiency. ROI here is the honest figure — what survived cannibalization and the post-promotion trough."
        filters={
          <>
            <Segmented<Range>
              value={range}
              onChange={setRange}
              options={[
                { value: '13w', label: '13 weeks' },
                { value: '26w', label: '26 weeks' },
                { value: '52w', label: '52 weeks' },
                { value: 'all', label: 'All history' },
              ]}
            />
            <Select
              ariaLabel="Filter by customer" className="w-52" value={chain} onChange={setChain}
              options={[
                { value: 'all', label: 'All customers' },
                ...CHAIN_CUSTOMERS.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Gross sales"
            value={money(waterfall.steps[0].value, { compact: true })}
            accent={seriesColor(0)}
          />
          <StatTile
            label="Total trade spend"
            value={money(waterfall.totalTradeSpend, { compact: true })}
            delta={waterfall.tradeRate !== null ? pct(waterfall.tradeRate) : undefined}
            deltaTone="neutral"
            hint="of gross sales"
            accent={seriesColor(7)}
          />
          <StatTile
            label="Net sales"
            value={money(waterfall.netSales, { compact: true })}
            accent={seriesColor(2)}
          />
          <StatTile
            label="Gross margin"
            value={money(waterfall.grossMargin, { compact: true })}
            delta={waterfall.grossMarginPct !== null ? pct(waterfall.grossMarginPct) : undefined}
            deltaTone="good"
            hint="of net sales"
            accent="var(--status-good)"
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Waterfall result={waterfall} />

          <div className="space-y-4">
            <Card>
              <SectionHeader
                title={
                  <span className="flex items-center gap-1.5">
                    Quality of lift
                    <InfoTip>
                      Reported lift minus the volume stolen from sibling SKUs and the volume the
                      post-promotion trough gives back. A promotion that reads +40% and is followed
                      by a −35% dip is not a win.
                    </InfoTip>
                  </span>
                }
                subtitle={`${closed.length} closed events in scope`}
              />
              <div className="mt-3">
                <StackedBar
                  segments={[
                    { key: 'true', label: 'True incremental', value: honesty.trueLift, color: 'var(--series-3)' },
                    { key: 'cannibal', label: 'Cannibalised from siblings', value: honesty.cannibal, color: 'var(--series-4)' },
                    { key: 'pantry', label: 'Given back in the dip', value: honesty.pantry, color: 'var(--series-8)' },
                  ]}
                  format={(v) => `${fmtUnits(v, true)} cs`}
                />
                <ul className="mt-2.5 space-y-1">
                  {[
                    { label: 'True incremental', value: honesty.trueLift, color: 'var(--series-3)' },
                    { label: 'Cannibalised from siblings', value: honesty.cannibal, color: 'var(--series-4)' },
                    { label: 'Given back in the dip', value: honesty.pantry, color: 'var(--series-8)' },
                  ].map((s) => (
                    <li key={s.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                        <span className="text-ink-secondary">{s.label}</span>
                      </span>
                      <span className="tnum text-ink">
                        {fmtUnits(s.value, true)} cs
                        <span className="ml-1.5 text-ink-muted">
                          {honesty.reportedLift > 0 ? pct(s.value / honesty.reportedLift, 0) : '—'}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2.5 border-t border-hairline pt-2 text-2xs leading-relaxed text-ink-muted">
                  Only{' '}
                  <strong className="text-ink">
                    {honesty.reportedLift > 0 ? pct(honesty.trueLift / honesty.reportedLift, 0) : '—'}
                  </strong>{' '}
                  of the headline lift was genuinely incremental. Every tool in this category can
                  show you the top number; showing you this one is the point.
                </p>
              </div>
            </Card>

            <BarChart
              title="Spend by tactic"
              subtitle="Cost per incremental case is the efficiency measure that matters"
              data={byTactic.slice(0, 8).map((t) => ({
                key: t.tactic,
                label: t.name,
                value: t.spend,
                color: tacticColor(t.tactic),
                detail: [
                  { label: 'Promotions', value: String(t.promotionCount) },
                  { label: 'Incremental cases', value: fmtUnits(t.liftUnits, true) },
                  {
                    label: 'Spend / incr. case',
                    value: t.spendPerIncrementalCase !== null
                      ? `$${t.spendPerIncrementalCase.toFixed(2)}`
                      : '—',
                  },
                ],
              }))}
              format={(v) => money(v, { compact: true })}
              labelWidth={126}
              tableValueHead="Spend"
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <LineChart
            title="Gross sales and off-invoice spend by week"
            subtitle="Two measures on one scale — off-invoice money is a direct subtraction from the line above it"
            labels={trend.weeks.map(formatShortDate)}
            series={[
              { key: 'gross', label: 'Gross sales', color: seriesColor(0), values: trend.gross, area: true },
              { key: 'oi', label: 'Off-invoice', color: seriesColor(1), values: trend.offInvoice },
            ]}
            format={(v) => money(v, { compact: true })}
            height={240}
          />

          <BarChart
            title="Gross sales by customer"
            subtitle="Top seven, remainder folded into Other"
            data={customerMix.map((c) => ({ key: c.key, label: c.label, value: c.value, color: c.color }))}
            format={(v) => money(v, { compact: true })}
            labelWidth={150}
            tableValueHead="Gross sales"
            onSelect={(k) => setChain(k === 'other' ? 'all' : k === chain ? 'all' : k)}
            selectedKey={chain === 'all' ? undefined : chain}
          />
        </div>

        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <SectionHeader
              title="Promotion effectiveness"
              subtitle="Ranked on true ROI. Struck-through figures are what a conventional TPM tool would have reported."
            />
            <Badge tone="critical">
              {leaderboard.filter((p) => (p.actual!.trueRoi ?? 0) < 0).length} lost money
            </Badge>
          </div>
          <DataTable
            rows={leaderboard}
            columns={columns}
            rowKey={(p) => p.promotion.id}
            initialSort={{ key: 'roiGap', dir: 'desc' }}
            maxHeight="440px"
            dense
            emptyIcon={BarChart3}
            emptyTitle="No closed events in this window"
            emptyHint="Widen the date range or clear the customer filter — effectiveness can only be measured once an event has closed and actuals have posted."
            rowTone={(p) => ((p.actual!.trueRoi ?? 0) < 0 ? 'var(--status-critical)' : undefined)}
          />
        </Card>

        {leaderboard.filter((p) => (p.actual!.trueRoi ?? 0) < 0).length > 0 && (
          <Card>
            <div className="flex items-start gap-2.5">
              <TrendingDown size={15} className="mt-0.5 shrink-0 text-critical" />
              <div>
                <h3 className="text-[13px] font-semibold text-ink">
                  Where the money went
                </h3>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-secondary">
                  {leaderboard.filter((p) => (p.actual!.trueRoi ?? 0) < 0).length} of{' '}
                  {leaderboard.length} closed events destroyed margin once cannibalization and the
                  post-promotion dip were netted out —{' '}
                  {money(
                    leaderboard
                      .filter((p) => (p.actual!.trueRoi ?? 0) < 0)
                      .reduce((a, p) => a + p.actual!.actualSpend, 0),
                    { compact: true },
                  )}{' '}
                  of trade spend. Several of them still look positive on reported lift, which is why
                  they keep getting repeated year after year.
                </p>
              </div>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  )
}
