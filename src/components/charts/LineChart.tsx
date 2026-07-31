/**
 * Time-series line chart with a crosshair hover layer.
 *
 * Built for the baseline-vs-actual view, so it supports shaded bands marking
 * the weeks a promotion was live — without that shading, a lift chart is just
 * a wiggly line and the viewer has to take the lift number on faith.
 *
 * One axis only. Two measures of different scale get two charts, never a
 * second y-scale.
 */

import { clsx } from 'clsx'
import { useMemo, useState, type ReactNode } from 'react'

import {
  AxisLabels, ChartFrame, ChartTooltip, GridLines, TipRow, niceTicks,
  useChartSize, useChartTooltip,
} from './frame'

export interface LineSeries {
  key: string
  label: string
  color: string
  values: (number | null)[]
  /** Dashed rendering for modelled/derived series such as a baseline. */
  dashed?: boolean
  /** Fill the area between this series and the one below it. */
  area?: boolean
}

export interface Band {
  from: number
  to: number
  label?: string
}

const PAD = { top: 8, right: 12, bottom: 20, left: 46 }

export function LineChart({
  labels, series, title, subtitle, format, height = 220, bands, actions, className,
  xTickEvery,
}: {
  labels: string[]
  series: LineSeries[]
  title: ReactNode
  subtitle?: ReactNode
  format: (v: number) => string
  height?: number
  bands?: Band[]
  actions?: ReactNode
  className?: string
  xTickEvery?: number
}) {
  const { ref: sizeRef, width } = useChartSize(680)
  const { ref: hoverRef, tip, show, hide } = useChartTooltip()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const plotW = Math.max(80, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom

  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null))
    if (all.length === 0) return { min: 0, max: 1 }
    const lo = Math.min(...all)
    const hi = Math.max(...all)
    // Volume charts read best anchored at zero; never truncate the axis to
    // exaggerate a difference.
    return { min: Math.min(0, lo), max: hi * 1.06 || 1 }
  }, [series])

  const ticks = useMemo(() => niceTicks(min, max, 4), [min, max])
  const yScale = (v: number) => PAD.top + plotH - ((v - min) / (max - min || 1)) * plotH
  const xScale = (i: number) =>
    PAD.left + (labels.length <= 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)

  const tickEvery = xTickEvery ?? Math.max(1, Math.ceil(labels.length / 8))

  const path = (s: LineSeries) => {
    let d = ''
    let pen = false
    s.values.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      d += `${pen ? 'L' : 'M'}${xScale(i).toFixed(2)} ${yScale(v).toFixed(2)} `
      pen = true
    })
    return d.trim()
  }

  const areaPath = (s: LineSeries) => {
    const pts = s.values
      .map((v, i) => (v === null ? null : [xScale(i), yScale(v)] as const))
      .filter((p): p is readonly [number, number] => p !== null)
    if (pts.length < 2) return ''
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
    return `${line} L${pts[pts.length - 1][0].toFixed(2)} ${yScale(min).toFixed(2)} L${pts[0][0].toFixed(2)} ${yScale(min).toFixed(2)} Z`
  }

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const rel = e.clientX - box.left - PAD.left
    const i = Math.round((rel / plotW) * (labels.length - 1))
    const idx = Math.max(0, Math.min(labels.length - 1, i))
    setActiveIndex(idx)
    show(
      e,
      <div>
        <p className="mb-1 font-semibold text-ink">{labels[idx]}</p>
        {series.map((s) => (
          <TipRow
            key={s.key}
            label={s.label}
            value={s.values[idx] === null ? '—' : format(s.values[idx]!)}
            color={s.color}
          />
        ))}
        {bands?.some((b) => idx >= b.from && idx <= b.to) && (
          <p className="mt-1 border-t border-hairline pt-1 text-ink-muted">
            {bands.find((b) => idx >= b.from && idx <= b.to)?.label ?? 'On promotion'}
          </p>
        )}
      </div>,
    )
  }

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={series.map((s) => ({ label: s.label, color: s.color }))}
      actions={actions}
      className={className}
      tableHead={['Week', ...series.map((s) => s.label)]}
      tableRows={labels.map((l, i) => [
        l,
        ...series.map((s) => (s.values[i] === null ? '—' : format(s.values[i]!))),
      ])}
    >
      <div ref={hoverRef} className="relative">
        <div ref={sizeRef}>
          <svg
            width="100%"
            height={height}
            role="img"
            aria-label={typeof title === 'string' ? title : 'Line chart'}
            onMouseMove={onMove}
            onMouseLeave={() => {
              hide()
              setActiveIndex(null)
            }}
          >
            {/* Promotion windows, behind everything. */}
            {bands?.map((b, i) => (
              <rect
                key={i}
                x={xScale(b.from)}
                y={PAD.top}
                width={Math.max(2, xScale(b.to) - xScale(b.from))}
                height={plotH}
                fill="var(--accent)"
                opacity={0.07}
              />
            ))}

            <GridLines ticks={ticks} scale={yScale} width={PAD.left + plotW} x0={PAD.left} />
            <AxisLabels ticks={ticks} scale={yScale} format={format} x={PAD.left - 7} />

            {series.filter((s) => s.area).map((s) => (
              <path key={`a-${s.key}`} d={areaPath(s)} fill={s.color} opacity={0.1} />
            ))}

            {series.map((s) => (
              <path
                key={s.key}
                d={path(s)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={s.dashed ? '5 3' : undefined}
              />
            ))}

            {activeIndex !== null && (
              <g>
                <line
                  x1={xScale(activeIndex)} x2={xScale(activeIndex)}
                  y1={PAD.top} y2={PAD.top + plotH}
                  stroke="var(--baseline)" strokeWidth={1}
                />
                {series.map((s) =>
                  s.values[activeIndex] === null ? null : (
                    <circle
                      key={s.key}
                      cx={xScale(activeIndex)}
                      cy={yScale(s.values[activeIndex]!)}
                      r={4}
                      fill={s.color}
                      stroke="var(--surface-1)"
                      strokeWidth={2}
                    />
                  ),
                )}
              </g>
            )}

            <g aria-hidden>
              {labels.map((l, i) =>
                i % tickEvery === 0 ? (
                  <text
                    key={l + i}
                    x={xScale(i)}
                    y={height - 5}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--text-muted)"
                  >
                    {l}
                  </text>
                ) : null,
              )}
            </g>
          </svg>
        </div>
        <ChartTooltip tip={tip} width={230} />
      </div>
    </ChartFrame>
  )
}

// ── Sparkline ──────────────────────────────────────────────────────────────

/** Trend glyph for a table cell or stat tile. No axes, no hover — a shape. */
export function Sparkline({
  values, color = 'var(--series-1)', width = 72, height = 20, className,
}: {
  values: number[]
  color?: string
  width?: number
  height?: number
  className?: string
}) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className={clsx('overflow-visible', className)} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
