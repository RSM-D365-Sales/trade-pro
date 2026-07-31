/**
 * Executive dashboard.
 *
 * Ordered as the argument, not as an org chart: the money at risk in
 * deductions comes first, then fund pressure, then what the plan is actually
 * returning. Every tile is a link into the screen that can do something about
 * it — a dashboard that only reports is a screensaver.
 */

import { ArrowRight, CalendarClock, Gavel, ReceiptText, TrendingDown, Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { BarChart } from '../components/charts/BarChart'
import { seriesColor } from '../components/charts/frame'
import { LineChart } from '../components/charts/LineChart'
import { PageBody, PageHeader } from '../components/PageHeader'
import { Badge, Button, Card, SectionHeader, StatTile, StatusBadge } from '../components/ui'
import { DataTable } from '../components/ui/DataTable'
import { summariseRecovery, DISPOSITION_LABEL } from '../lib/calc/matching'
import { utilizationBand } from '../lib/calc/funds'
import { money, pct, units as fmtUnits } from '../lib/calc/money'
import { addWeeks, formatShortDate } from '../lib/fiscal'
import { useStore } from '../store'
import {
  useEnrichedDeductions, useFundBalances, useLookups, usePromotionPerformance,
  useSalesIndex, useWaterfall,
} from '../store/selectors'

export function DashboardPage() {
  const navigate = useNavigate()
  const today = useStore((s) => s.today)
  const dataset = useStore((s) => s.dataset)
  const deductions = useEnrichedDeductions()
  const balances = useFundBalances()
  const performance = usePromotionPerformance()
  const { customersById } = useLookups()

  const fromWeek = useMemo(() => addWeeks(today, -52), [today])
  const waterfall = useWaterfall({ fromWeek, toWeek: today })
  const sales = useSalesIndex(fromWeek, today)

  const recovery = useMemo(() => {
    const matchedIds = new Set(
      deductions
        .filter((r) => r.match.disposition === 'auto_matched' || r.match.resolved === 'accepted')
        .map((r) => r.deduction.id),
    )
    return summariseRecovery(
      deductions.map((r) => r.deduction),
      dataset.disputes,
      matchedIds,
    )
  }, [deductions, dataset.disputes])

  const atRisk = useMemo(
    () =>
      deductions.filter(
        (r) => r.match.disposition === 'likely_invalid' || r.match.disposition === 'no_match',
      ),
    [deductions],
  )
  const atRiskValue = atRisk.reduce((a, r) => a + r.deduction.amount, 0)

  const queue = useMemo(
    () =>
      [...deductions]
        .filter((r) => !r.match.resolved && r.match.disposition !== 'auto_matched')
        .sort((a, b) => b.deduction.amount - a.deduction.amount)
        .slice(0, 8),
    [deductions],
  )

  const fundPressure = useMemo(() => {
    const currentYear = today.slice(0, 4)
    return [...balances.entries()]
      .map(([id, b]) => ({ fund: dataset.funds.find((f) => f.id === id)!, balance: b }))
      .filter((r) => r.fund && r.fund.periodStart.slice(0, 4) === currentYear)
      .filter((r) => (r.balance.utilization ?? 0) > 0.85)
      .sort((a, b) => (b.balance.utilization ?? 0) - (a.balance.utilization ?? 0))
      .slice(0, 6)
  }, [balances, dataset.funds, today])

  const upcoming = useMemo(
    () =>
      performance
        .filter((p) => p.promotion.performStart > today && p.promotion.status !== 'cancelled')
        .sort((a, b) => a.promotion.performStart.localeCompare(b.promotion.performStart))
        .slice(0, 6),
    [performance, today],
  )

  const losers = useMemo(
    () =>
      performance
        .filter((p) => p.actual && (p.actual.trueRoi ?? 0) < 0)
        .sort((a, b) => a.actual!.trueRoi! - b.actual!.trueRoi!)
        .slice(0, 6),
    [performance],
  )

  const trend = useMemo(() => {
    const weeks = sales.weeks.slice(-52)
    return {
      weeks,
      gross: weeks.map((w) => sales.byWeek.get(w)?.grossSales ?? 0),
      units: weeks.map((w) => sales.byWeek.get(w)?.units ?? 0),
    }
  }, [sales])

  return (
    <>
      <PageHeader
        title={`Good morning, Priya`}
        description={`${dataset.org.name} · trailing 52 weeks to ${today} · ${dataset.org.fiscalCalendar} fiscal calendar`}
        actions={
          <Button
            size="sm"
            variant="primary"
            icon={ReceiptText}
            onClick={() => navigate('/deductions?')}
          >
            Work the deduction queue
          </Button>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Deductions at risk"
            value={money(atRiskValue, { compact: true })}
            delta={`${atRisk.length} chargebacks`}
            deltaTone="critical"
            hint="likely invalid or unmatched"
            accent="var(--status-critical)"
            onClick={() => navigate('/deductions')}
          />
          <StatTile
            label="Recovered to date"
            value={money(recovery.recoveredAmount, { compact: true })}
            delta={recovery.winRate !== null ? `${pct(recovery.winRate, 0)} win rate` : undefined}
            deltaTone="good"
            accent="var(--status-good)"
            onClick={() => navigate('/deductions')}
          />
          <StatTile
            label="Trade spend rate"
            value={waterfall.tradeRate !== null ? pct(waterfall.tradeRate) : '—'}
            hint={`${money(waterfall.totalTradeSpend, { compact: true })} on ${money(waterfall.steps[0].value, { compact: true })} gross`}
            accent={seriesColor(1)}
            onClick={() => navigate('/analytics')}
          />
          <StatTile
            label="Gross margin"
            value={money(waterfall.grossMargin, { compact: true })}
            delta={waterfall.grossMarginPct !== null ? pct(waterfall.grossMarginPct) : undefined}
            deltaTone="good"
            hint="of net sales"
            accent={seriesColor(2)}
            onClick={() => navigate('/analytics')}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <LineChart
            title="Gross sales by week"
            subtitle="Trailing 52 weeks, all customers"
            labels={trend.weeks.map(formatShortDate)}
            series={[
              { key: 'gross', label: 'Gross sales', color: seriesColor(0), values: trend.gross, area: true },
            ]}
            format={(v) => money(v, { compact: true })}
            height={230}
          />

          <Card padded={false} className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title="Deduction queue"
                subtitle="Biggest unresolved chargebacks"
              />
              <Link
                to="/deductions"
                className="inline-flex items-center gap-1 text-2xs font-medium text-accent hover:underline"
              >
                Open queue <ArrowRight size={11} />
              </Link>
            </div>
            <DataTable
              rows={queue}
              columns={[
                {
                  key: 'doc', header: 'Document',
                  render: (r) => (
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink">{r.deduction.docNumber}</p>
                      <p className="truncate text-2xs text-ink-muted">{r.customerName}</p>
                    </div>
                  ),
                },
                {
                  key: 'verdict', header: 'Verdict', width: '128px',
                  render: (r) => (
                    <StatusBadge
                      tone={
                        r.match.disposition === 'likely_invalid' ? 'critical'
                          : r.match.disposition === 'no_match' ? 'serious' : 'warning'
                      }
                      label={DISPOSITION_LABEL[r.match.disposition]}
                    />
                  ),
                },
                {
                  key: 'amount', header: 'Amount', numeric: true, width: '92px',
                  render: (r) => money(r.deduction.amount),
                },
              ]}
              rowKey={(r) => r.deduction.id}
              onRowClick={(r) => navigate(`/deductions?open=${r.deduction.id}`)}
              dense
              maxHeight="268px"
              emptyIcon={Gavel}
              emptyTitle="Queue is clear"
              emptyHint="Every deduction has been matched or resolved. Nothing needs a human right now."
            />
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title="Funds under pressure"
                subtitle="Over 85% committed this fiscal year"
              />
            </div>
            {fundPressure.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-ink-muted">
                No fund is above 85% committed. There is headroom across the board.
              </div>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {fundPressure.map((r) => {
                  const band = utilizationBand(r.balance.utilization)
                  return (
                    <li key={r.fund.id}>
                      <Link
                        to="/funds"
                        className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-sunken"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[13px] text-ink">
                            {customersById.get(r.fund.customerId)?.name}
                          </p>
                          <p className="truncate text-2xs text-ink-muted">{r.fund.code}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="text-[13px] tnum text-ink">
                            {r.balance.utilization !== null ? pct(r.balance.utilization, 0) : '—'}
                          </span>
                          <StatusBadge tone={band.tone} label={band.label} />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title="Coming up"
                subtitle="Next events to go on shelf"
              />
            </div>
            {upcoming.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-ink-muted">
                Nothing is scheduled beyond today. Time to build next quarter’s plan.
              </div>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {upcoming.map((p) => (
                  <li key={p.promotion.id}>
                    <Link
                      to={`/promotions/${p.promotion.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-sunken"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-ink">{p.promotion.code}</p>
                        <p className="truncate text-2xs text-ink-muted">
                          {p.customerName} · {formatShortDate(p.promotion.performStart)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-[13px] tnum text-ink">
                          {money(p.economics.spend, { compact: true })}
                        </span>
                        <Badge tone={p.promotion.status === 'approved' ? 'accent' : 'neutral'}>
                          {p.promotion.status}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title="Worst performers"
                subtitle="Closed events by true ROI"
              />
            </div>
            {losers.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-ink-muted">
                Every closed event returned positive margin. Enjoy it while it lasts.
              </div>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {losers.map((p) => (
                  <li key={p.promotion.id}>
                    <Link
                      to={`/promotions/${p.promotion.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-sunken"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] text-ink">{p.promotion.code}</p>
                        <p className="truncate text-2xs text-ink-muted">
                          {p.customerName} · {money(p.actual!.actualSpend, { compact: true })} spent
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <TrendingDown size={12} className="text-critical" />
                        <span className="text-[13px] font-medium tnum text-critical">
                          {pct(p.actual!.trueRoi ?? 0, 0)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <BarChart
          title="Gross sales by customer"
          subtitle="Trailing 52 weeks"
          data={[...sales.byChain.entries()]
            .map(([id, r]) => ({ id, value: r.grossSales }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 8)
            .map((e, i) => ({
              key: e.id,
              label: customersById.get(e.id)?.name ?? e.id,
              value: e.value,
              color: seriesColor(i),
              detail: [
                { label: 'Cases shipped', value: fmtUnits(sales.byChain.get(e.id)?.units ?? 0, true) },
                { label: 'Off-invoice', value: money(sales.byChain.get(e.id)?.offInvoice ?? 0, { compact: true }) },
              ],
            }))}
          format={(v) => money(v, { compact: true })}
          labelWidth={160}
          tableValueHead="Gross sales"
          onSelect={(k) => navigate(`/analytics?customer=${k}`)}
        />
      </PageBody>
    </>
  )
}

export { CalendarClock, Wallet }
