/**
 * Promotion planning workspace: the grid plus a live P&L that recalculates on
 * every keystroke, a real-time fund balance check, and conflict detection
 * against the rest of the customer's calendar.
 */

import { AlertTriangle, ArrowLeft, Check, Copy, Send } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PageBody, PageHeader } from '../components/PageHeader'
import { PlanningGrid } from '../components/planning/PlanningGrid'
import {
  Button, Card, Divider, EmptyState, KeyValue, Meter, SectionHeader, StatusBadge,
} from '../components/ui'
import { tacticColor, tacticName } from '../data/tactics'
import type { Promotion, PromotionLine } from '../data/types'
import { money, pct } from '../lib/calc/money'
import { computeFundBalance, utilizationBand } from '../lib/calc/funds'
import { computePromotion } from '../lib/calc/promotion'
import { formatDate, rangesOverlap } from '../lib/fiscal'
import { useStore } from '../store'
import { useLookups } from '../store/selectors'

export function PlanningPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const dataset = useStore((s) => s.dataset)
  const today = useStore((s) => s.today)
  const replaceLines = useStore((s) => s.replaceLines)
  const addLine = useStore((s) => s.addLine)
  const setPromotionStatus = useStore((s) => s.setPromotionStatus)
  const showToast = useStore((s) => s.showToast)
  const { customersById, productsById, fundsById, usersById } = useLookups()

  const promotion = dataset.promotions.find((p) => p.id === id)
  const lines = useMemo(
    () => dataset.promotionLines.filter((l) => l.promotionId === id),
    [dataset.promotionLines, id],
  )

  const economics = useMemo(
    () => computePromotion(lines, productsById),
    [lines, productsById],
  )

  const fund = promotion ? fundsById.get(promotion.fundId) : undefined
  const fundBalance = useMemo(
    () => (fund ? computeFundBalance(fund, dataset.fundTransactions) : null),
    [fund, dataset.fundTransactions],
  )

  /** Two promotions, same customer, same SKU, overlapping weeks. */
  const conflicts = useMemo(() => {
    if (!promotion) return []
    const mySkus = new Set(lines.map((l) => l.productId))
    return dataset.promotions
      .filter(
        (p) =>
          p.id !== promotion.id &&
          p.customerId === promotion.customerId &&
          p.status !== 'cancelled' &&
          p.status !== 'draft' &&
          rangesOverlap(p.performStart, p.performEnd, promotion.performStart, promotion.performEnd),
      )
      .map((p) => {
        const overlapping = dataset.promotionLines
          .filter((l) => l.promotionId === p.id && mySkus.has(l.productId))
          .map((l) => productsById.get(l.productId)?.sku)
          .filter(Boolean) as string[]
        return { promotion: p, skus: overlapping }
      })
      .filter((c) => c.skus.length > 0)
  }, [promotion, lines, dataset, productsById])

  const availableProducts = useMemo(() => {
    if (!promotion) return []
    const used = new Set(lines.map((l) => l.productId))
    const brands = new Set(
      lines.map((l) => productsById.get(l.productId)?.brand).filter(Boolean) as string[],
    )
    return dataset.products.filter(
      (p) => !used.has(p.id) && (brands.size === 0 || brands.has(p.brand)),
    )
  }, [promotion, lines, dataset.products, productsById])

  if (!promotion) {
    return (
      <PageBody>
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="That promotion no longer exists"
            hint="It may have been removed, or the link is stale."
            action={<Button onClick={() => navigate('/promotions')}>Back to promotions</Button>}
          />
        </Card>
      </PageBody>
    )
  }

  const customer = customersById.get(promotion.customerId)
  const owner = usersById.get(promotion.ownerId)
  const overCommit = fundBalance ? economics.spend > fundBalance.remaining : false
  const canSubmit = promotion.status === 'draft'
  const canApprove = promotion.status === 'submitted'

  const onChange = (next: PromotionLine[]) => replaceLines(promotion.id, next)

  return (
    <>
      <PageHeader
        title={`${promotion.code} — ${promotion.name}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link to="/promotions" className="inline-flex items-center gap-1 text-accent hover:underline">
              <ArrowLeft size={11} /> All promotions
            </Link>
            <span aria-hidden>·</span>
            <span>{customer?.name}</span>
            <span aria-hidden>·</span>
            <span>Owner {owner?.name}</span>
            <span aria-hidden>·</span>
            <StatusBadge
              tone={promotion.status === 'active' ? 'good' : promotion.status === 'cancelled' ? 'critical' : 'neutral'}
              label={promotion.status}
            />
          </span>
        }
        actions={
          <>
            <Button
              size="sm"
              icon={Copy}
              onClick={() => showToast('Cloned to a new draft for next year — planners rebuild last year’s plan constantly')}
            >
              Clone
            </Button>
            {canSubmit && (
              <Button
                size="sm"
                variant="primary"
                icon={Send}
                onClick={() => setPromotionStatus(promotion.id, 'submitted', 'Submitted for approval')}
              >
                Submit for approval
              </Button>
            )}
            {canApprove && (
              <Button
                size="sm"
                variant="primary"
                icon={Check}
                onClick={() =>
                  setPromotionStatus(promotion.id, 'approved', 'Within fund balance and ROI threshold')
                }
              >
                Approve
              </Button>
            )}
          </>
        }
      />

      <PageBody>
        <DateTimeline promotion={promotion} />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_312px]">
          <Card padded={false} className="overflow-hidden">
            {lines.length === 0 ? (
              <EmptyState
                icon={AlertTriangle}
                title="No products on this promotion yet"
                hint="Add the SKUs this event covers. Rates and volumes can be pasted straight from a spreadsheet once the first line exists."
                action={
                  availableProducts[0] && (
                    <Button size="sm" onClick={() => addLine(promotion.id, availableProducts[0].id)}>
                      Add first product
                    </Button>
                  )
                }
              />
            ) : (
              <PlanningGrid
                lines={lines}
                productById={productsById}
                availableProducts={availableProducts}
                onChange={onChange}
                onAddLine={(productId) => addLine(promotion.id, productId)}
              />
            )}
          </Card>

          <div className="space-y-4">
            {/* ── Live P&L ─────────────────────────────────────────────── */}
            <Card>
              <SectionHeader
                title="Live P&L"
                subtitle="Recalculates as you type, from the same functions the nightly job uses"
              />
              <dl className="mt-3">
                <KeyValue label="Total cases" mono>
                  {economics.totalUnits.toLocaleString('en-US')}
                </KeyValue>
                <KeyValue label="Incremental cases" mono>
                  {economics.liftUnits.toLocaleString('en-US')}
                </KeyValue>
                <KeyValue label="Lift" mono>
                  {economics.liftPct !== null ? pct(economics.liftPct) : '—'}
                </KeyValue>
                <Divider />
                <KeyValue label="Gross revenue" mono>{money(economics.grossRevenue)}</KeyValue>
                <KeyValue label="Trade spend" mono>
                  <span className="text-critical">−{money(economics.spend)}</span>
                </KeyValue>
                <KeyValue label="COGS" mono>
                  <span className="text-critical">−{money(economics.cogs)}</span>
                </KeyValue>
                <Divider />
                <KeyValue label="Gross margin" mono>
                  <strong>{money(economics.totalMargin)}</strong>
                </KeyValue>
                <KeyValue label="Incremental margin" mono>{money(economics.incrementalMargin)}</KeyValue>
                <KeyValue label="Spend rate" mono>
                  {economics.spendRate !== null ? pct(economics.spendRate) : '—'}
                </KeyValue>
                <KeyValue label="Spend / incremental case" mono>
                  {economics.spendPerIncrementalCase !== null
                    ? `$${economics.spendPerIncrementalCase.toFixed(2)}`
                    : '—'}
                </KeyValue>
              </dl>

              <div
                className="mt-3 rounded-md p-2.5 ring-1 ring-inset"
                style={{
                  background:
                    (economics.roi ?? 0) < 0 ? 'rgb(208 59 59 / 0.08)' : 'rgb(12 163 12 / 0.08)',
                  borderColor: 'transparent',
                }}
              >
                <p className="text-2xs uppercase tracking-wide text-ink-muted">Promotion ROI</p>
                <p
                  className={`mt-0.5 text-2xl font-semibold tracking-tight tnum ${
                    (economics.roi ?? 0) < 0 ? 'text-critical' : 'text-good'
                  }`}
                >
                  {economics.roi !== null ? pct(economics.roi) : '—'}
                </p>
                <p className="mt-0.5 text-2xs leading-relaxed text-ink-secondary">
                  {(economics.roi ?? 0) < 0
                    ? 'This event destroys margin as planned. Cut the rate, shorten the window, or drop the weakest SKUs.'
                    : 'Incremental margin covers the spend. Post-event actuals will also net out cannibalization and pantry loading.'}
                </p>
              </div>
            </Card>

            {/* ── Fund check ───────────────────────────────────────────── */}
            {fund && fundBalance && (
              <Card>
                <SectionHeader
                  title="Fund balance"
                  subtitle={fund.name}
                  actions={
                    // An accrual fund whose period is still in the future has
                    // legitimately earned nothing yet. Reporting that as
                    // "Unfunded" reads as a data error rather than a calendar fact.
                    fund.periodStart > today ? (
                      <StatusBadge tone="neutral" label="Period not started" />
                    ) : (
                      <StatusBadge
                        tone={utilizationBand(fundBalance.utilization).tone}
                        label={utilizationBand(fundBalance.utilization).label}
                      />
                    )
                  }
                />
                {fund.periodStart > today && (
                  <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
                    This event sits in {formatDate(fund.periodStart)}–{formatDate(fund.periodEnd)}.
                    An accrual fund earns against shipments, so it carries no balance until the
                    period opens — plan against the forecast, not the current figure.
                  </p>
                )}
                <div className="mt-3 space-y-2">
                  <Meter
                    value={fundBalance.utilization ?? 0}
                    tone={utilizationBand(fundBalance.utilization).tone}
                    label={fundBalance.utilization !== null ? pct(fundBalance.utilization, 0) : '—'}
                  />
                  <dl>
                    <KeyValue label="Funded" mono>{money(fundBalance.funded)}</KeyValue>
                    <KeyValue label="Committed" mono>{money(fundBalance.committed)}</KeyValue>
                    <KeyValue label="Settled" mono>{money(fundBalance.actual)}</KeyValue>
                    <KeyValue label="Remaining" mono>
                      <strong className={fundBalance.remaining < 0 ? 'text-critical' : ''}>
                        {money(fundBalance.remaining)}
                      </strong>
                    </KeyValue>
                  </dl>
                </div>
                {overCommit && (
                  <p className="mt-2 flex items-start gap-1.5 rounded bg-critical/8 px-2 py-1.5 text-2xs leading-relaxed text-critical ring-1 ring-inset ring-critical/20">
                    <AlertTriangle size={11} className="mt-px shrink-0" />
                    This promotion’s {money(economics.spend)} exceeds the{' '}
                    {money(fundBalance.remaining)} left in the fund. Approval will route to finance.
                  </p>
                )}
              </Card>
            )}

            {/* ── Conflicts ────────────────────────────────────────────── */}
            <Card>
              <SectionHeader
                title="Calendar conflicts"
                subtitle="Same customer, same SKU, overlapping weeks"
              />
              {conflicts.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  No other event at {customer?.name} touches these SKUs in this window.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {conflicts.map((c) => (
                    <li key={c.promotion.id} className="rounded-md bg-warning/8 p-2 ring-1 ring-inset ring-warning/20">
                      <Link
                        to={`/promotions/${c.promotion.id}`}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        {c.promotion.code}
                      </Link>
                      <p className="mt-0.5 text-2xs leading-relaxed text-ink-secondary">
                        {formatDate(c.promotion.performStart)} – {formatDate(c.promotion.performEnd)} ·{' '}
                        overlaps on {c.skus.slice(0, 4).join(', ')}
                        {c.skus.length > 4 && ` +${c.skus.length - 4}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* ── Tactic mix ───────────────────────────────────────────── */}
            <Card>
              <SectionHeader title="Tactic mix" />
              <ul className="mt-2 space-y-1">
                {[...new Set(lines.map((l) => l.tactic))].map((t) => {
                  const spend = economics.lines
                    .filter((le) => lines.find((l) => l.id === le.lineId)?.tactic === t)
                    .reduce((a, le) => a + le.spend, 0)
                  return (
                    <li key={t} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          aria-hidden
                          className="h-2 w-2 shrink-0 rounded-[2px]"
                          style={{ background: tacticColor(t) }}
                        />
                        <span className="truncate text-ink-secondary">{tacticName(t)}</span>
                      </span>
                      <span className="shrink-0 tnum text-ink">{money(spend)}</span>
                    </li>
                  )
                })}
              </ul>
            </Card>
          </div>
        </div>
      </PageBody>
    </>
  )
}

/**
 * The six dates, drawn to scale. Buy, ship and perform windows are genuinely
 * different periods and planners get them wrong constantly — showing them
 * stacked makes the offsets obvious at a glance.
 */
function DateTimeline({ promotion }: { promotion: Promotion }) {
  const rows = [
    { label: 'Buy', start: promotion.buyStart, end: promotion.buyEnd, color: 'var(--series-3)' },
    { label: 'Ship', start: promotion.shipStart, end: promotion.shipEnd, color: 'var(--series-4)' },
    { label: 'Perform', start: promotion.performStart, end: promotion.performEnd, color: 'var(--series-1)' },
  ]
  const min = rows.reduce((a, r) => (r.start < a ? r.start : a), rows[0].start)
  const max = rows.reduce((a, r) => (r.end > a ? r.end : a), rows[0].end)
  const span = Math.max(1, (Date.parse(max) - Date.parse(min)) / 86_400_000)
  const at = (d: string) => ((Date.parse(d) - Date.parse(min)) / 86_400_000 / span) * 100

  return (
    <Card>
      <SectionHeader
        title="Event windows"
        subtitle="Buy, ship and perform are three different periods — deduction matching keys off the perform window"
      />
      <div className="mt-3 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-2xs font-medium uppercase tracking-wide text-ink-muted">
              {r.label}
            </span>
            <div className="relative h-4 flex-1 rounded bg-sunken">
              <span
                className="absolute inset-y-0 rounded"
                style={{
                  left: `${at(r.start)}%`,
                  width: `${Math.max(1.5, at(r.end) - at(r.start))}%`,
                  background: r.color,
                }}
              />
            </div>
            <span className="w-40 shrink-0 text-right text-2xs tnum text-ink-secondary">
              {formatDate(r.start)} – {formatDate(r.end)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
