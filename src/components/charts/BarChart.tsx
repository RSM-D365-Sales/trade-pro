/**
 * Horizontal bar chart for ranked magnitude (leaderboards, spend by tactic),
 * and a stacked variant for composition.
 *
 * Horizontal because the category labels are names, not dates — vertical
 * columns would need rotated labels, which is the anti-pattern this avoids.
 * Marks are thin with 4px rounded data-ends anchored to a shared baseline.
 */

import { clsx } from 'clsx'
import type { ReactNode } from 'react'

import { ChartFrame, ChartTooltip, TipRow, useChartSize, useChartTooltip } from './frame'

export interface BarDatum {
  key: string
  label: string
  value: number
  color?: string
  /** Extra rows shown in the hover tooltip. */
  detail?: { label: string; value: string }[]
  sublabel?: string
}

export function BarChart({
  data, title, subtitle, format, labelWidth = 150, barHeight = 14, rowHeight = 26,
  legend, actions, onSelect, selectedKey, tableValueHead = 'Value', className,
  diverging = false,
}: {
  data: BarDatum[]
  title: ReactNode
  subtitle?: ReactNode
  format: (v: number) => string
  labelWidth?: number
  barHeight?: number
  rowHeight?: number
  legend?: { label: string; color: string }[]
  actions?: ReactNode
  onSelect?: (key: string) => void
  selectedKey?: string
  tableValueHead?: string
  className?: string
  /** When values can be negative, anchor the baseline at zero mid-plot. */
  diverging?: boolean
}) {
  const { ref: sizeRef, width } = useChartSize(560)
  const { ref: hoverRef, tip, show, hide } = useChartTooltip()

  const plotW = Math.max(120, width - labelWidth - 64)
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.value)))
  const min = Math.min(0, ...data.map((d) => d.value))
  const hasNegative = diverging || min < 0

  // With negatives the zero line sits proportionally inside the plot.
  const zeroX = hasNegative
    ? labelWidth + (Math.abs(min) / (maxAbs + Math.abs(min))) * plotW
    : labelWidth
  const scale = hasNegative
    ? (v: number) => (Math.abs(v) / (maxAbs + Math.abs(min))) * plotW
    : (v: number) => (Math.abs(v) / maxAbs) * plotW

  const height = data.length * rowHeight + 6

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={legend}
      actions={actions}
      className={className}
      tableHead={['Item', tableValueHead]}
      tableRows={data.map((d) => [d.label, format(d.value)])}
    >
      <div ref={hoverRef} className="relative">
        <div ref={sizeRef}>
          <svg width="100%" height={height} role="img" aria-label={typeof title === 'string' ? title : 'Bar chart'}>
            {hasNegative && (
              <line
                x1={zeroX} x2={zeroX} y1={0} y2={height}
                stroke="var(--baseline)" strokeWidth={1} shapeRendering="crispEdges"
              />
            )}
            {data.map((d, i) => {
              const y = i * rowHeight + 4
              const w = Math.max(2, scale(d.value))
              const negative = d.value < 0
              const barX = negative ? zeroX - w : zeroX
              const color = d.color ?? 'var(--series-1)'
              const selected = selectedKey === d.key

              return (
                <g
                  key={d.key}
                  onMouseMove={(e) =>
                    show(
                      e,
                      <div>
                        <p className="mb-1 font-semibold text-ink">{d.label}</p>
                        <TipRow label={tableValueHead} value={format(d.value)} color={color} strong />
                        {d.detail?.map((x) => (
                          <TipRow key={x.label} label={x.label} value={x.value} />
                        ))}
                      </div>,
                    )
                  }
                  onMouseLeave={hide}
                  onClick={onSelect ? () => onSelect(d.key) : undefined}
                  className={clsx(onSelect && 'cursor-pointer')}
                >
                  <rect x={0} y={y - 3} width={width} height={rowHeight} fill="transparent" />
                  {selected && (
                    <rect
                      x={0} y={y - 3} width={width} height={rowHeight}
                      fill="var(--accent-soft)" rx={3}
                    />
                  )}

                  <text
                    x={labelWidth - 10}
                    y={y + barHeight / 2}
                    dy="0.32em"
                    textAnchor="end"
                    fontSize={11}
                    fill="var(--text-secondary)"
                  >
                    {truncate(d.label, Math.floor(labelWidth / 6))}
                  </text>

                  <rect
                    x={barX} y={y} width={w} height={barHeight} rx={3}
                    fill={color}
                    // 2px surface ring keeps adjacent/overlapping fills separable.
                    stroke="var(--surface-1)"
                    strokeWidth={selected ? 0 : 1}
                  />

                  <text
                    x={negative ? barX - 7 : barX + w + 7}
                    y={y + barHeight / 2}
                    dy="0.32em"
                    textAnchor={negative ? 'end' : 'start'}
                    fontSize={10.5}
                    className="tnum"
                    fill="var(--text-secondary)"
                  >
                    {format(d.value)}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
        <ChartTooltip tip={tip} width={220} />
      </div>
    </ChartFrame>
  )
}

// ── Stacked composition bar ────────────────────────────────────────────────

export interface StackSegment {
  key: string
  label: string
  value: number
  color: string
}

/**
 * Single stacked bar for share-of-total. Segments carry a 2px surface gap so
 * adjacent fills never blend into one another.
 */
export function StackedBar({
  segments, format, height = 22, onSelect, selectedKey,
}: {
  segments: StackSegment[]
  format: (v: number) => string
  height?: number
  onSelect?: (key: string) => void
  selectedKey?: string
}) {
  const total = segments.reduce((a, s) => a + Math.abs(s.value), 0) || 1
  const { ref, tip, show, hide } = useChartTooltip()

  return (
    <div ref={ref} className="relative">
      <div className="flex w-full gap-[2px] overflow-hidden rounded" style={{ height }}>
        {segments.map((s) => {
          const share = Math.abs(s.value) / total
          if (share <= 0) return null
          return (
            <button
              key={s.key}
              onMouseMove={(e) =>
                show(
                  e,
                  <div>
                    <TipRow label={s.label} value={format(s.value)} color={s.color} strong />
                    <TipRow label="Share" value={`${(share * 100).toFixed(1)}%`} />
                  </div>,
                )
              }
              onMouseLeave={hide}
              onClick={onSelect ? () => onSelect(s.key) : undefined}
              aria-label={`${s.label}: ${format(s.value)}`}
              className={clsx(
                'h-full shrink-0 transition-opacity first:rounded-l last:rounded-r',
                selectedKey && selectedKey !== s.key ? 'opacity-35' : 'opacity-100',
                onSelect && 'cursor-pointer',
              )}
              style={{ width: `${share * 100}%`, background: s.color }}
            />
          )
        })}
      </div>
      <ChartTooltip tip={tip} width={200} />
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
