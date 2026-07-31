/**
 * Chart chrome shared by every visualisation.
 *
 * Three rules are enforced here rather than left to each chart:
 *  1. A legend is present whenever there are ≥2 series (one series needs none —
 *     the title names it), so identity is never carried by colour alone.
 *  2. Every chart ships a TABLE VIEW. Three light-mode series slots sit below
 *     3:1 against the surface, and the palette's relief rule requires either
 *     visible labels or a table. This is that table.
 *  3. Hover is on by default. An SVG chart in a browser is interactive; a
 *     static one is a screenshot that happens to be markup.
 */

import { clsx } from 'clsx'
import { Table2, TrendingUp } from 'lucide-react'
import {
  useCallback, useLayoutEffect, useRef, useState, type ReactNode,
} from 'react'

export const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
] as const

/** Categorical hues are assigned in fixed order and never cycled. */
export function seriesColor(index: number): string {
  return SERIES[index] ?? 'var(--text-muted)'
}

export const SEQ = [
  'var(--seq-100)', 'var(--seq-200)', 'var(--seq-300)', 'var(--seq-400)',
  'var(--seq-500)', 'var(--seq-600)', 'var(--seq-700)',
] as const

/** Single-hue sequential ramp for continuous magnitude. */
export function sequentialColor(t: number): string {
  const i = Math.max(0, Math.min(SEQ.length - 1, Math.round(t * (SEQ.length - 1))))
  return SEQ[i]
}

export interface LegendItem {
  label: string
  color: string
  value?: string
}

interface ChartFrameProps {
  title: ReactNode
  subtitle?: ReactNode
  legend?: LegendItem[]
  actions?: ReactNode
  children: ReactNode
  /** Rows rendered when the viewer switches to the table view. */
  tableHead: string[]
  tableRows: (string | number)[][]
  className?: string
  height?: number
}

export function ChartFrame({
  title, subtitle, legend, actions, children, tableHead, tableRows, className, height,
}: ChartFrameProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')

  return (
    <section className={clsx('rounded-lg bg-surface p-4 ring-1 ring-hairline shadow-card', className)}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          <button
            onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
            aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'}
            title={view === 'chart' ? 'Show as table' : 'Show as chart'}
            className="rounded p-1 text-ink-muted transition-colors hover:bg-sunken hover:text-ink-secondary"
          >
            {view === 'chart' ? <Table2 size={13} /> : <TrendingUp size={13} />}
          </button>
        </div>
      </header>

      {/* Legend only for ≥2 series — a single series is named by the title. */}
      {view === 'chart' && legend && legend.length >= 2 && (
        <ul className="mb-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
          {legend.map((l) => (
            <li key={l.label} className="flex items-center gap-1.5 text-2xs text-ink-secondary">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: l.color }}
              />
              {l.label}
              {l.value && <span className="tnum text-ink-muted">{l.value}</span>}
            </li>
          ))}
        </ul>
      )}

      {view === 'chart' ? (
        <div style={height ? { height } : undefined}>{children}</div>
      ) : (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0">
              <tr>
                {tableHead.map((h, i) => (
                  <th
                    key={h}
                    className={clsx(
                      'whitespace-nowrap border-b border-hairline bg-surface px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted',
                      i === 0 ? 'text-left' : 'text-right',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r, ri) => (
                <tr key={ri} className="border-b border-hairline/60">
                  {r.map((c, ci) => (
                    <td
                      key={ci}
                      className={clsx(
                        'px-2 py-1.5 text-ink',
                        ci === 0 ? 'text-left' : 'text-right tnum',
                      )}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ── Hover layer ────────────────────────────────────────────────────────────

export interface TooltipState {
  x: number
  y: number
  content: ReactNode
}

export function useChartTooltip() {
  const ref = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TooltipState | null>(null)

  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content })
  }, [])

  const hide = useCallback(() => setTip(null), [])

  return { ref, tip, show, hide }
}

export function ChartTooltip({ tip, width = 210 }: { tip: TooltipState | null; width?: number }) {
  if (!tip) return null
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-30 rounded-md bg-surface p-2 text-2xs shadow-pop ring-1 ring-hairline"
      style={{
        left: Math.max(4, tip.x - width / 2),
        top: Math.max(4, tip.y - 12),
        width,
        transform: 'translateY(-100%)',
      }}
    >
      {tip.content}
    </div>
  )
}

export function TipRow({
  label, value, color, strong,
}: {
  label: string
  value: ReactNode
  color?: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-px">
      <span className="flex min-w-0 items-center gap-1.5">
        {color && (
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: color }} />
        )}
        <span className="truncate text-ink-secondary">{label}</span>
      </span>
      <span className={clsx('shrink-0 tnum', strong ? 'font-semibold text-ink' : 'text-ink')}>
        {value}
      </span>
    </div>
  )
}

// ── Layout helper ──────────────────────────────────────────────────────────

/** Measures the container so charts can be laid out in real pixels. */
export function useChartSize(fallbackWidth = 640) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallbackWidth)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return { ref, width }
}

// ── Axis primitives ────────────────────────────────────────────────────────

/** "Nice" tick values — the axis should read 0/25/50, never 0/23.7/47.4. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  const span = max - min
  const rawStep = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.001; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}

export function GridLines({
  ticks, scale, width, x0 = 0,
}: {
  ticks: number[]
  scale: (v: number) => number
  width: number
  x0?: number
}) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <line
          key={t}
          x1={x0}
          x2={width}
          y1={scale(t)}
          y2={scale(t)}
          stroke="var(--gridline)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  )
}

export function AxisLabels({
  ticks, scale, format, x = 0,
}: {
  ticks: number[]
  scale: (v: number) => number
  format: (v: number) => string
  x?: number
}) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <text
          key={t}
          x={x}
          y={scale(t)}
          dy="0.32em"
          textAnchor="end"
          className="tnum"
          fill="var(--text-muted)"
          fontSize={10}
        >
          {format(t)}
        </text>
      ))}
    </g>
  )
}
