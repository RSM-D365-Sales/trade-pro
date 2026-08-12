/**
 * Sales forecasting.
 *
 * Driver-based and multi-level: the same drivers roll up through whichever
 * hierarchy the planner picks, so a demand planner works at customer × product
 * group while a brand manager looks at brand → customer without either of them
 * maintaining a separate number.
 */

import { AlertTriangle, Check, LineChart as LineChartIcon, Sparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { ColumnChart } from '../components/charts/ColumnChart'
import { LineChart } from '../components/charts/LineChart'
import { seriesColor } from '../components/charts/frame'
import { ForecastGrid, ForecastLegend } from '../components/forecast/ForecastGrid'
import { PageBody, PageHeader } from '../components/PageHeader'
import {
  Badge, Button, Card, Divider, EmptyState, InfoTip, SectionHeader, Segmented, Select,
  StatTile, StatusBadge,
} from '../components/ui'
import {
  buildForecastAccuracy, buildForecastTree, summariseRecommendations, totalsByPeriod,
  type DriverField, type GroupDimension, type TreeContext,
} from '../lib/calc/forecast'
import { units as fmtUnits, pct } from '../lib/calc/money'
import { useStore } from '../store'
import { useLookups } from '../store/selectors'

/** The "different levels" control. Each preset is an ordered dimension list. */
const LEVEL_PRESETS: { value: string; label: string; dims: GroupDimension[] }[] = [
  { value: 'cust_group', label: 'Customer → Product group', dims: ['customer', 'productGroup'] },
  { value: 'cust_brand_group', label: 'Customer → Brand → Group', dims: ['customer', 'brand', 'productGroup'] },
  { value: 'brand_cust', label: 'Brand → Customer', dims: ['brand', 'customer'] },
  { value: 'channel_cust_group', label: 'Channel → Customer → Group', dims: ['channel', 'customer', 'productGroup'] },
  { value: 'group_cust', label: 'Product group → Customer', dims: ['productGroup', 'customer'] },
]

type Horizon = '6' | '12' | '18' | 'all'

export function ForecastPage() {
  const dataset = useStore((s) => s.dataset)
  const today = useStore((s) => s.today)
  const recommendations = useStore((s) => s.recommendations)
  const dismissed = useStore((s) => s.dismissedRecommendations)
  const setForecastDriver = useStore((s) => s.setForecastDriver)
  const bulkScaleForecast = useStore((s) => s.bulkScaleForecast)
  const acceptRecommendation = useStore((s) => s.acceptRecommendation)
  const dismissRecommendation = useStore((s) => s.dismissRecommendation)
  const { customersById } = useLookups()

  const [preset, setPreset] = useState('cust_group')
  const [horizon, setHorizon] = useState<Horizon>('12')
  const [chain, setChain] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showRecs, setShowRecs] = useState(false)
  const [chartView, setChartView] = useState<'accuracy' | 'plan'>('accuracy')

  const { forecast } = dataset
  const groupById = useMemo(
    () => new Map(forecast.productGroups.map((g) => [g.id, g])),
    [forecast.productGroups],
  )
  const linesById = useMemo(
    () => new Map(forecast.lines.map((l) => [l.id, l])),
    [forecast.lines],
  )

  // Periods: everything still open, plus a little history for context.
  const periods = useMemo(() => {
    const all = forecast.periods
    const firstOpen = Math.max(0, all.findIndex((p) => !p.isPast))
    const from = Math.max(0, firstOpen - 2)
    const count = horizon === 'all' ? all.length : Number(horizon) + 2
    return all.slice(from, from + count)
  }, [forecast.periods, horizon])

  const lines = useMemo(
    () => forecast.lines.filter((l) => (chain === 'all' ? true : l.customerId === chain)),
    [forecast.lines, chain],
  )

  const ctx: TreeContext = useMemo(
    () => ({
      customerName: (id) => customersById.get(id)?.name ?? id,
      customerParent: (id) => customersById.get(id)?.parentId ?? null,
      channelOf: (id) => customersById.get(id)?.channel ?? 'grocery',
      productGroupName: (id) => groupById.get(id)?.name ?? id,
      brandOfGroup: (id) => groupById.get(id)?.brand ?? '—',
    }),
    [customersById, groupById],
  )

  const dims = LEVEL_PRESETS.find((p) => p.value === preset)!.dims
  const nodes = useMemo(
    () => buildForecastTree(lines, periods, dims, ctx),
    [lines, periods, dims, ctx],
  )
  const totals = useMemo(() => totalsByPeriod(nodes, periods), [nodes, periods])
  const grandTotal = useMemo(
    () => Object.values(totals).reduce((a, b) => a + b, 0),
    [totals],
  )

  // ── Recommendations in scope ──
  const openRecs = useMemo(() => {
    const inScope = new Set(lines.map((l) => l.id))
    return recommendations.filter((r) => inScope.has(r.lineId) && !dismissed.has(r.id))
  }, [recommendations, lines, dismissed])
  const recSummary = useMemo(() => summariseRecommendations(openRecs), [openRecs])
  const flaggedLineIds = useMemo(() => new Set(openRecs.map((r) => r.lineId)), [openRecs])

  // ── Forecast vs. the year before, for the trend chart ──
  const trend = useMemo(() => {
    const openTotal = periods.map((p) => totals[p.key] ?? 0)
    return {
      labels: periods.map((p) => `${p.label} ${p.sublabel.slice(0, 3)}`),
      values: openTotal,
      firstOpenIndex: periods.findIndex((p) => !p.isPast),
    }
  }, [periods, totals])

  // ── Forecast vs actual — the horizon control mirrored backwards ──
  //
  // Scored on the same lines the grid shows, so the customer filter applies
  // here too. The window is trailing CLOSED periods: 12 forward ⇒ 12 back.
  const accuracy = useMemo(() => {
    const closed = forecast.periods.filter((p) => p.isPast)
    const back = horizon === 'all' ? closed.length : Number(horizon)
    return buildForecastAccuracy(lines, closed.slice(-back))
  }, [forecast.periods, lines, horizon])

  const onDriverChange = (
    lineId: string, periodKey: string, field: DriverField, value: number,
  ) => setForecastDriver(lineId, periodKey, field, value)

  const openPeriodKeys = periods.filter((p) => !p.isPast).map((p) => p.key)
  const canBulk = selected.size > 0 && openPeriodKeys.length > 0

  return (
    <>
      <PageHeader
        title="Forecast"
        description="Built from drivers, not typed in. Every cell is stores × base velocity × seasonality × weeks in the fiscal period — so when the number is wrong you can see which assumption broke."
        filters={
          <>
            <Select
              ariaLabel="Planning level"
              className="w-64"
              value={preset}
              onChange={setPreset}
              options={LEVEL_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            />
            <Select
              ariaLabel="Filter by customer"
              className="w-48"
              value={chain}
              onChange={setChain}
              options={[
                { value: 'all', label: 'All customers' },
                ...dataset.customers
                  .filter((c) => c.level === 'chain')
                  .map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Segmented<Horizon>
              value={horizon}
              onChange={setHorizon}
              options={[
                { value: '6', label: '6 periods' },
                { value: '12', label: '12' },
                { value: '18', label: '18' },
                { value: 'all', label: 'All' },
              ]}
            />
          </>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Forecast in view"
            value={`${fmtUnits(grandTotal, true)} cs`}
            hint={`${periods.length} fiscal periods`}
            accent={seriesColor(0)}
          />
          <StatTile
            label="Planning lines"
            value={String(lines.length)}
            hint={`${forecast.productGroups.length} product groups`}
          />
          <StatTile
            label="Needs attention"
            value={String(recSummary.high + recSummary.medium)}
            delta={recSummary.high > 0 ? `${recSummary.high} high urgency` : undefined}
            deltaTone={recSummary.high > 0 ? 'critical' : 'good'}
            hint="driver assumptions drifting from actuals"
            accent={recSummary.high > 0 ? 'var(--status-warning)' : 'var(--status-good)'}
            onClick={() => setShowRecs(true)}
            active={showRecs}
          />
          <StatTile
            label="Unapplied impact"
            value={`${recSummary.netImpactUnits >= 0 ? '+' : ''}${fmtUnits(recSummary.netImpactUnits, true)} cs`}
            hint="if every recommendation were accepted"
            accent={seriesColor(3)}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Card padded={false} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2.5">
              <ForecastLegend>
                <span>{lines.length} lines · {periods.filter((p) => !p.isPast).length} open periods</span>
              </ForecastLegend>
              <div className="flex items-center gap-1.5">
                <BulkUpdate
                  disabled={!canBulk}
                  selectionCount={selected.size}
                  periodCount={openPeriodKeys.length}
                  onApply={(field, factor) => {
                    bulkScaleForecast([...selected], openPeriodKeys, field, factor)
                  }}
                />
                {selected.size > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear {selected.size}
                  </Button>
                )}
              </div>
            </div>

            {lines.length === 0 ? (
              <EmptyState
                icon={LineChartIcon}
                title="No planning lines for this customer"
                hint="A line appears once there are at least twelve clean, un-promoted weeks of shipment history to derive a base velocity from."
                action={<Button size="sm" onClick={() => setChain('all')}>Show all customers</Button>}
              />
            ) : (
              <ForecastGrid
                nodes={nodes}
                periods={periods}
                linesById={linesById}
                totals={totals}
                grandTotal={grandTotal}
                onDriverChange={onDriverChange}
                selectedLineIds={selected}
                onToggleSelect={(ids) =>
                  setSelected((prev) => {
                    const next = new Set(prev)
                    for (const id of ids) {
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                    }
                    return next
                  })
                }
                flaggedLineIds={flaggedLineIds}
              />
            )}
          </Card>

          <div className="space-y-4">
            <Card>
              <SectionHeader
                title={
                  <span className="flex items-center gap-1.5">
                    Forecast recommendations
                    <InfoTip>
                      The engine compares each driver against the last thirteen clean weeks of
                      actuals and proposes a specific value. It never rewrites a driver on its
                      own — a forecasting tool that silently overwrites a planner's number is one
                      they stop using.
                    </InfoTip>
                  </span>
                }
                subtitle={
                  openRecs.length === 0
                    ? 'Every driver agrees with recent actuals'
                    : `${recSummary.high} high · ${recSummary.medium} medium urgency`
                }
              />
              {openRecs.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-ink-muted">
                  Nothing is drifting. Recommendations reappear as actuals move away from the
                  assumptions behind the plan.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex gap-2">
                    <Badge tone="critical" icon={AlertTriangle}>
                      High urgency: {recSummary.high}
                    </Badge>
                    <Badge tone="warning">Medium: {recSummary.medium}</Badge>
                  </div>
                  <Button
                    className="mt-3 w-full"
                    variant="primary"
                    size="sm"
                    icon={Sparkles}
                    onClick={() => setShowRecs((v) => !v)}
                  >
                    {showRecs ? 'Hide recommendations' : 'View recommendations'}
                  </Button>
                </>
              )}

              {showRecs && openRecs.length > 0 && (
                <>
                  <Divider />
                  <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                    {openRecs.slice(0, 40).map((r) => {
                      const line = linesById.get(r.lineId)
                      return (
                        <li
                          key={r.id}
                          className="rounded-md bg-sunken px-2.5 py-2 ring-1 ring-inset ring-hairline"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-2xs font-medium text-ink">
                                {customersById.get(line?.customerId ?? '')?.name}
                                {' · '}
                                {groupById.get(line?.productGroupId ?? '')?.name}
                              </p>
                              <p className="text-2xs text-ink-muted">{r.periodKey}</p>
                            </div>
                            <StatusBadge
                              tone={r.urgency === 'high' ? 'critical' : 'warning'}
                              label={r.urgency}
                            />
                          </div>
                          <p className="mt-1 text-2xs leading-relaxed text-ink-secondary">
                            {r.message}
                          </p>
                          <p className="mt-1 text-2xs tnum text-ink-muted">
                            {r.currentValue.toFixed(2)} → <strong className="text-ink">{r.suggestedValue.toFixed(2)}</strong>
                            {'  ·  '}
                            <span className={r.impactUnits >= 0 ? 'text-good' : 'text-critical'}>
                              {r.impactUnits >= 0 ? '+' : ''}{fmtUnits(r.impactUnits)} cs
                            </span>
                          </p>
                          <div className="mt-1.5 flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              icon={X}
                              onClick={() => dismissRecommendation(r.id)}
                            >
                              Dismiss
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              icon={Check}
                              onClick={() => acceptRecommendation(r.id)}
                            >
                              Apply
                            </Button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </Card>

            {chartView === 'accuracy' ? (
              <ColumnChart
                title={
                  <span className="flex items-center gap-1.5">
                    Forecast vs actual
                    <InfoTip>
                      Each closed period is scored against the plan as it stood when the period
                      locked — never against today's drivers, which have already been corrected
                      with hindsight. Accuracy is accumulated line by line, so an over-forecast
                      at one customer cannot cancel an under-forecast at another. Bias is the
                      netted miss: positive means the plan runs hot.
                    </InfoTip>
                  </span>
                }
                subtitle={
                  accuracy.weightedAccuracy === null
                    ? 'No closed periods with a locked plan in view'
                    : `${accuracy.periods.length} closed periods · accuracy ${pct(accuracy.weightedAccuracy, 1)} · bias ${accuracy.bias! >= 0 ? '+' : ''}${pct(accuracy.bias!, 1)}`
                }
                data={accuracy.periods.map((r) => ({
                  key: r.key,
                  label: r.label,
                  sublabel: `${r.sublabel.slice(0, 3)} ${r.sublabel.slice(-2)}`,
                  value: r.actualUnits,
                  target: r.forecastUnits,
                }))}
                valueLabel="Actual"
                targetLabel="Locked forecast"
                color={seriesColor(0)}
                strip={{
                  label: 'Accuracy',
                  values: accuracy.periods.map((r) => r.accuracy),
                  format: (v) => pct(v, 1),
                }}
                format={(v) => `${fmtUnits(v, true)}`}
                height={256}
                labelEvery={Math.max(1, Math.ceil(accuracy.periods.length / 6))}
                actions={
                  <Segmented<'accuracy' | 'plan'>
                    size="sm"
                    value={chartView}
                    onChange={setChartView}
                    options={[
                      { value: 'accuracy', label: 'vs actual' },
                      { value: 'plan', label: 'Plan' },
                    ]}
                  />
                }
              />
            ) : (
              <LineChart
                title="Forecast by period"
                subtitle={`Shaded periods are closed actuals · as at ${today}`}
                labels={trend.labels}
                series={[
                  {
                    key: 'fcst',
                    label: 'Total cases',
                    color: seriesColor(0),
                    values: trend.values,
                    area: true,
                  },
                ]}
                format={(v) => `${fmtUnits(v, true)}`}
                height={200}
                bands={
                  trend.firstOpenIndex > 0
                    ? [{ from: 0, to: trend.firstOpenIndex - 1, label: 'Closed actuals' }]
                    : undefined
                }
                actions={
                  <Segmented<'accuracy' | 'plan'>
                    size="sm"
                    value={chartView}
                    onChange={setChartView}
                    options={[
                      { value: 'accuracy', label: 'vs actual' },
                      { value: 'plan', label: 'Plan' },
                    ]}
                  />
                }
              />
            )}

            <Card>
              <SectionHeader
                title="Why fiscal periods"
                subtitle="Not calendar months"
              />
              <p className="mt-2 text-xs leading-relaxed text-ink-secondary">
                This tenant runs a {dataset.org.fiscalCalendar} calendar, so periods are four or
                five weeks long. A five-week period sells roughly{' '}
                <strong className="text-ink">{pct(0.25, 0)}</strong> more than a four-week one at
                identical velocity. Forecasting in calendar months smears that across the year and
                every period reads as a miss.
              </p>
              <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
                The week count sits under each column header for exactly this reason.
              </p>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}

// ── Bulk update ────────────────────────────────────────────────────────────

function BulkUpdate({
  disabled, selectionCount, periodCount, onApply,
}: {
  disabled: boolean
  selectionCount: number
  periodCount: number
  onApply: (field: DriverField, factor: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState<DriverField>('baseVelocityWeekly')
  const [percent, setPercent] = useState('5')

  return (
    <div className="relative">
      <Button size="sm" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        Bulk update{selectionCount > 0 ? ` (${selectionCount})` : ''}
      </Button>
      {open && !disabled && (
        <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-lg bg-surface p-3 shadow-pop ring-1 ring-hairline">
          <p className="text-2xs text-ink-muted">
            Applies to {selectionCount} selected line{selectionCount === 1 ? '' : 's'} across{' '}
            {periodCount} open period{periodCount === 1 ? '' : 's'}. Closed periods are never
            touched.
          </p>
          <div className="mt-2 space-y-2">
            <Select
              ariaLabel="Driver to adjust"
              value={field}
              onChange={setField}
              options={[
                { value: 'baseVelocityWeekly', label: 'Base velocity (weekly)' },
                { value: 'storesSelling', label: 'Stores selling' },
                { value: 'seasonality', label: 'Seasonality' },
              ]}
            />
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.5"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                aria-label="Percent change"
                className="h-8 w-24 rounded-md bg-raised px-2 text-right text-[13px] tnum text-ink ring-1 ring-hairline focus:ring-accent"
              />
              <span className="text-xs text-ink-muted">% change</span>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const p = Number(percent)
                if (Number.isFinite(p)) onApply(field, 1 + p / 100)
                setOpen(false)
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
