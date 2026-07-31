/**
 * Hierarchical forecast grid.
 *
 * Rows are a planning tree — customer → product group by default, but the
 * dimension list is a prop, so the same grid re-pivots to brand → customer or
 * channel → customer → product group without any other change.
 *
 * Drivers only appear on a node that resolves to a SINGLE leaf line. A store
 * count averaged across three retailers is not a number anyone can act on, and
 * exposing it invites an edit that silently fans out across the roll-up.
 */

import { clsx } from 'clsx'
import {
  Building2, ChevronRight, Layers, Package, Store, TrendingUp,
} from 'lucide-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'

import {
  lineUnits,
  type DriverField, type ForecastLine, type ForecastNode, type ForecastPeriod,
} from '../../lib/calc/forecast'
import { units as fmtUnits } from '../../lib/calc/money'
import { Sparkline } from '../charts/LineChart'

const DIM_ICON: Record<string, typeof Store> = {
  customer: Building2,
  banner: Store,
  channel: Layers,
  brand: Layers,
  productGroup: Package,
}

const DRIVERS: { field: DriverField; label: string; hint: string; step: number; decimals: number }[] = [
  {
    field: 'seasonality',
    label: 'Seasonality',
    hint: 'Index vs. this line’s own average week. Measured from de-promoted history.',
    step: 0.01,
    decimals: 2,
  },
  {
    field: 'baseVelocityWeekly',
    label: 'Base velocity (weekly)',
    hint: 'Cases per selling store per week, promotions excluded.',
    step: 0.1,
    decimals: 2,
  },
  {
    field: 'storesSelling',
    label: 'Stores selling',
    hint: 'Outlets actually carrying this group — distribution, not chain size.',
    step: 1,
    decimals: 0,
  },
]

interface Props {
  nodes: ForecastNode[]
  periods: ForecastPeriod[]
  linesById: Map<string, ForecastLine>
  totals: Record<string, number>
  grandTotal: number
  onDriverChange: (lineId: string, periodKey: string, field: DriverField, value: number) => void
  selectedLineIds: Set<string>
  onToggleSelect: (lineIds: string[]) => void
  /** Node ids carrying an open recommendation, for the row marker. */
  flaggedLineIds: Set<string>
}

export function ForecastGrid({
  nodes, periods, linesById, totals, grandTotal, onDriverChange,
  selectedLineIds, onToggleSelect, flaggedLineIds,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(nodes.slice(0, 2).map((n) => n.id)))

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Flatten the tree to the rows that are currently visible. */
  const rows = useMemo(() => {
    const out: { node: ForecastNode; isOpen: boolean }[] = []
    const walk = (list: ForecastNode[], parentOpen: boolean) => {
      for (const n of list) {
        if (!parentOpen) continue
        const isOpen = expanded.has(n.id)
        out.push({ node: n, isOpen })
        if (n.children.length > 0) walk(n.children, isOpen)
      }
    }
    walk(nodes, true)
    return out
  }, [nodes, expanded])

  const colWidth = 108

  return (
    <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-20">
          <tr>
            <th
              className="sticky left-0 z-30 min-w-[280px] border-b border-r border-hairline bg-surface px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Planning group
            </th>
            {periods.map((p) => (
              <th
                key={p.key}
                style={{ minWidth: colWidth }}
                className={clsx(
                  'whitespace-nowrap border-b border-hairline bg-surface px-2 py-2 text-right text-2xs font-semibold uppercase tracking-wide',
                  p.isPast ? 'text-ink-muted/60' : 'text-ink-muted',
                )}
              >
                <div>{p.label} {p.isPast ? 'ACT' : 'FCST'}</div>
                <div className="font-normal normal-case tracking-normal text-ink-muted/70">
                  {p.sublabel} · {p.weeks}w
                </div>
              </th>
            ))}
            <th
              style={{ minWidth: colWidth }}
              className="sticky right-0 z-30 whitespace-nowrap border-b border-l border-hairline bg-surface px-2 py-2 text-right text-2xs font-semibold uppercase tracking-wide text-ink-muted"
            >
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map(({ node, isOpen }) => {
            const line = node.driverLineId ? linesById.get(node.driverLineId) : undefined
            const Icon = DIM_ICON[node.dimension] ?? Package
            const selected = !!node.driverLineId && selectedLineIds.has(node.driverLineId)
            const flagged = !!node.driverLineId && flaggedLineIds.has(node.driverLineId)
            const hasChildren = node.children.length > 0 || !!line

            return (
              // Keyed Fragment: a node renders one summary row plus up to three
              // driver rows, so the key belongs on the wrapper, not the <tr>.
              <Fragment key={node.id}>
                <tr
                  className={clsx(
                    'border-b border-hairline/60 transition-colors hover:bg-sunken/60',
                    node.depth === 0 && 'font-medium',
                    selected && 'bg-accent-soft',
                  )}
                >
                  <td
                    className={clsx(
                      'sticky left-0 z-10 border-r border-hairline px-3 py-1.5',
                      selected ? 'bg-accent-soft' : 'bg-surface',
                    )}
                    style={{ boxShadow: flagged ? 'inset 3px 0 0 var(--status-warning)' : undefined }}
                  >
                    <div
                      className="flex items-center gap-1.5"
                      style={{ paddingLeft: node.depth * 16 }}
                    >
                      {hasChildren ? (
                        <button
                          onClick={() => toggle(node.id)}
                          aria-expanded={isOpen}
                          aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
                          className="rounded p-0.5 text-ink-muted transition-transform hover:text-ink"
                          style={{ transform: isOpen ? 'rotate(90deg)' : undefined }}
                        >
                          <ChevronRight size={13} />
                        </button>
                      ) : (
                        <span className="w-[18px]" />
                      )}
                      <Icon size={13} className="shrink-0 text-ink-muted" />
                      <span className="truncate text-ink">{node.label}</span>
                      {node.driverLineId && (
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => onToggleSelect([node.driverLineId!])}
                          aria-label={`Select ${node.label} for bulk update`}
                          className="ml-1 h-3 w-3 shrink-0 accent-[color:var(--accent)]"
                        />
                      )}
                    </div>
                  </td>

                  {periods.map((p) => (
                    <td
                      key={p.key}
                      className={clsx(
                        'px-2 py-1.5 text-right tnum',
                        p.isPast ? 'text-ink-muted' : 'text-ink',
                      )}
                    >
                      {fmtUnits(node.units[p.key] ?? 0)}
                    </td>
                  ))}

                  <td
                    className={clsx(
                      'sticky right-0 z-10 border-l border-hairline px-2 py-1.5 text-right font-medium tnum text-ink',
                      selected ? 'bg-accent-soft' : 'bg-surface',
                    )}
                  >
                    {fmtUnits(node.total)}
                  </td>
                </tr>

                {/* Driver rows — only where the node is a single real line. */}
                {isOpen && line &&
                  DRIVERS.map((driver) => (
                    <tr key={`${node.id}:${driver.field}`} className="border-b border-hairline/40">
                      <td className="sticky left-0 z-10 border-r border-hairline bg-sunken/40 px-3 py-1">
                        <div
                          className="flex items-center gap-1.5"
                          style={{ paddingLeft: (node.depth + 1) * 16 + 18 }}
                          title={driver.hint}
                        >
                          <span className="truncate text-2xs text-ink-secondary">{driver.label}</span>
                        </div>
                      </td>

                      {periods.map((p) => {
                        const d = line.periods[p.key]
                        const overridden = !!line.overrides[p.key]?.[driver.field]
                        return (
                          <td key={p.key} className="bg-sunken/40 px-1 py-1">
                            <input
                              type="number"
                              step={driver.step}
                              min={0}
                              disabled={p.isPast}
                              value={d ? Number(d[driver.field].toFixed(driver.decimals)) : 0}
                              onChange={(e) =>
                                onDriverChange(line.id, p.key, driver.field, Number(e.target.value))
                              }
                              aria-label={`${driver.label} for ${node.label} in ${p.label}`}
                              className={clsx(
                                'h-6 w-full rounded bg-raised px-1.5 text-right text-2xs tnum text-ink ring-1 transition-colors',
                                'focus:ring-accent disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-muted disabled:ring-transparent',
                                overridden ? 'ring-accent/60' : 'ring-hairline',
                              )}
                            />
                          </td>
                        )
                      })}

                      <td className="sticky right-0 z-10 border-l border-hairline bg-sunken/40 px-2 py-1">
                        <div className="flex justify-end">
                          <Sparkline
                            values={periods.map((p) => line.periods[p.key]?.[driver.field] ?? 0)}
                            color={
                              driver.field === 'storesSelling'
                                ? 'var(--series-3)'
                                : driver.field === 'seasonality'
                                  ? 'var(--series-4)'
                                  : 'var(--series-1)'
                            }
                            width={64}
                            height={16}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </tbody>

        <tfoot className="sticky bottom-0 z-20">
          <tr>
            <td className="sticky left-0 z-30 border-r border-t border-hairline bg-raised px-3 py-2 text-[13px] font-semibold text-ink">
              Total forecast
            </td>
            {periods.map((p) => (
              <td
                key={p.key}
                className={clsx(
                  'border-t border-hairline bg-raised px-2 py-2 text-right font-semibold tnum',
                  p.isPast ? 'text-ink-muted' : 'text-ink',
                )}
              >
                {fmtUnits(totals[p.key] ?? 0)}
              </td>
            ))}
            <td className="sticky right-0 z-30 border-l border-t border-hairline bg-raised px-2 py-2 text-right font-semibold tnum text-ink">
              {fmtUnits(grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

/** Compact stat used above the grid. */
export function ForecastLegend({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-ink-muted">
      <span className="flex items-center gap-1.5">
        <TrendingUp size={11} /> units = stores × velocity × seasonality × weeks in period
      </span>
      {children}
    </div>
  )
}

export { lineUnits }
