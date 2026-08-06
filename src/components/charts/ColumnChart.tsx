/**
 * Vertical columns against a per-column target, with an optional rate strip
 * underneath.
 *
 * Vertical because the categories are ordered time periods — the one case where
 * columns beat the horizontal bars used everywhere else in this app.
 *
 * The target is drawn as a tick per column rather than a connected line: plan
 * is set period by period and does not interpolate between them, and a line
 * implies a continuity that is not there.
 *
 * The rate strip (gross margin %) gets its OWN plot band and its own axis
 * labels rather than a second y-scale on the columns. A dual axis lets you make
 * any two series look correlated by choosing the scales, which is exactly the
 * kind of chart this app does not ship.
 */

import { useMemo, useState, type ReactNode } from 'react'

import {
  AxisLabels, ChartFrame, ChartTooltip, GridLines, TipRow, niceTicks,
  useChartSize, useChartTooltip,
} from './frame'

export interface ColumnDatum {
  key: string
  label: string
  /** Second line under the axis label — the week count, in fiscal reporting. */
  sublabel?: string
  value: number
  target?: number
  detail?: { label: string; value: string }[]
}

export interface RateStrip {
  label: string
  values: (number | null)[]
  format: (v: number) => string
  color?: string
  height?: number
}

const PAD = { top: 10, right: 12, bottom: 26, left: 50 }
const STRIP_GAP = 10

export function ColumnChart({
  data, title, subtitle, format, height = 250, valueLabel = 'Actual',
  targetLabel = 'Plan', color = 'var(--series-1)', strip, actions, className,
  onSelect, selectedKey,
}: {
  data: ColumnDatum[]
  title: ReactNode
  subtitle?: ReactNode
  format: (v: number) => string
  height?: number
  valueLabel?: string
  targetLabel?: string
  color?: string
  strip?: RateStrip
  actions?: ReactNode
  className?: string
  onSelect?: (key: string) => void
  selectedKey?: string
}) {
  const { ref: sizeRef, width } = useChartSize(700)
  const { ref: hoverRef, tip, show, hide } = useChartTooltip()
  const [active, setActive] = useState<number | null>(null)

  const stripH = strip ? (strip.height ?? 46) : 0
  const plotW = Math.max(120, width - PAD.left - PAD.right)
  const plotH = Math.max(60, height - PAD.top - PAD.bottom - stripH - (strip ? STRIP_GAP : 0))

  const max = useMemo(() => {
    const all = data.flatMap((d) => [d.value, d.target ?? 0])
    return Math.max(1, ...all) * 1.08
  }, [data])

  const ticks = useMemo(() => niceTicks(0, max, 4), [max])
  const yScale = (v: number) => PAD.top + plotH - (v / max) * plotH

  const band = plotW / Math.max(1, data.length)
  const barW = Math.min(34, band * 0.56)
  const bandX = (i: number) => PAD.left + i * band
  const barX = (i: number) => bandX(i) + (band - barW) / 2

  // ── Rate strip scale (its own band, its own extent) ──
  const stripTop = PAD.top + plotH + STRIP_GAP
  const stripValues = (strip?.values ?? []).filter((v): v is number => v !== null)
  const sMin = stripValues.length ? Math.min(...stripValues) : 0
  const sMax = stripValues.length ? Math.max(...stripValues) : 1
  const sPad = (sMax - sMin) * 0.25 || Math.abs(sMax) * 0.1 || 0.01
  const sLo = sMin - sPad
  const sHi = sMax + sPad
  const sScale = (v: number) => stripTop + stripH - ((v - sLo) / (sHi - sLo || 1)) * stripH

  // A dozen points at most — cheaper to rebuild than to memoise correctly
  // against six derived scale values.
  let stripPath = ''
  if (strip) {
    let pen = false
    strip.values.forEach((v, i) => {
      if (v === null) {
        pen = false
        return
      }
      stripPath += `${pen ? 'L' : 'M'}${(bandX(i) + band / 2).toFixed(2)} ${sScale(v).toFixed(2)} `
      pen = true
    })
    stripPath = stripPath.trim()
  }

  const tipFor = (i: number) => {
    const d = data[i]
    const variance = d.target ? d.value - d.target : null
    return (
      <div>
        <p className="mb-1 font-semibold text-ink">
          {d.label}
          {d.sublabel && <span className="ml-1 font-normal text-ink-muted">{d.sublabel}</span>}
        </p>
        <TipRow label={valueLabel} value={format(d.value)} color={color} strong />
        {d.target !== undefined && (
          <>
            <TipRow label={targetLabel} value={format(d.target)} color="var(--text-muted)" />
            <TipRow
              label="Variance"
              value={`${variance! >= 0 ? '+' : '−'}${format(Math.abs(variance!))} · ${((d.value / d.target) * 100).toFixed(1)}%`}
            />
          </>
        )}
        {strip && strip.values[i] !== null && (
          <TipRow label={strip.label} value={strip.format(strip.values[i]!)} color={strip.color ?? 'var(--series-2)'} />
        )}
        {d.detail?.map((x) => <TipRow key={x.label} label={x.label} value={x.value} />)}
      </div>
    )
  }

  const legend = [
    { label: valueLabel, color },
    ...(data.some((d) => d.target !== undefined)
      ? [{ label: targetLabel, color: 'var(--text-muted)' }]
      : []),
    ...(strip ? [{ label: strip.label, color: strip.color ?? 'var(--series-2)' }] : []),
  ]

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle}
      legend={legend}
      actions={actions}
      className={className}
      tableHead={[
        'Period', valueLabel, targetLabel, 'vs plan', ...(strip ? [strip.label] : []),
      ]}
      tableRows={data.map((d, i) => [
        `${d.label}${d.sublabel ? ` (${d.sublabel})` : ''}`,
        format(d.value),
        d.target !== undefined ? format(d.target) : '—',
        d.target ? `${((d.value / d.target) * 100).toFixed(1)}%` : '—',
        ...(strip ? [strip.values[i] === null ? '—' : strip.format(strip.values[i]!)] : []),
      ])}
    >
      <div ref={hoverRef} className="relative">
        <div ref={sizeRef}>
          <svg
            width="100%"
            height={height}
            role="img"
            aria-label={typeof title === 'string' ? title : 'Column chart'}
            onMouseLeave={() => {
              hide()
              setActive(null)
            }}
          >
            <GridLines ticks={ticks} scale={yScale} width={PAD.left + plotW} x0={PAD.left} />
            <AxisLabels ticks={ticks} scale={yScale} format={format} x={PAD.left - 7} />

            {data.map((d, i) => {
              const y = yScale(d.value)
              const isActive = active === i || selectedKey === d.key
              return (
                <g
                  key={d.key}
                  onMouseMove={(e) => {
                    setActive(i)
                    show(e, tipFor(i))
                  }}
                  onClick={onSelect ? () => onSelect(d.key) : undefined}
                  className={onSelect ? 'cursor-pointer' : undefined}
                >
                  <rect
                    x={bandX(i)} y={PAD.top} width={band} height={plotH}
                    fill={isActive ? 'var(--accent-soft)' : 'transparent'}
                  />
                  <rect
                    x={barX(i)} y={y} width={barW} height={Math.max(1, PAD.top + plotH - y)}
                    rx={3} fill={color}
                    stroke="var(--surface-1)" strokeWidth={1}
                  />
                  {d.target !== undefined && (
                    <line
                      x1={barX(i) - 4} x2={barX(i) + barW + 4}
                      y1={yScale(d.target)} y2={yScale(d.target)}
                      stroke="var(--text-muted)" strokeWidth={2} strokeLinecap="round"
                    />
                  )}
                </g>
              )
            })}

            {/* Rate strip — separate band, separate scale, labelled at both ends. */}
            {strip && (
              <g>
                <line
                  x1={PAD.left} x2={PAD.left + plotW}
                  y1={stripTop + stripH} y2={stripTop + stripH}
                  stroke="var(--gridline)" strokeWidth={1} shapeRendering="crispEdges"
                />
                <path
                  d={stripPath} fill="none" stroke={strip.color ?? 'var(--series-2)'}
                  strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                />
                {[sHi - sPad, sLo + sPad].map((v) => (
                  <text
                    key={v} x={PAD.left - 7} y={sScale(v)} dy="0.32em" textAnchor="end"
                    className="tnum" fill="var(--text-muted)" fontSize={9.5}
                  >
                    {strip.format(v)}
                  </text>
                ))}
                {active !== null && strip.values[active] !== null && (
                  <circle
                    cx={bandX(active) + band / 2} cy={sScale(strip.values[active]!)} r={3.5}
                    fill={strip.color ?? 'var(--series-2)'} stroke="var(--surface-1)" strokeWidth={2}
                  />
                )}
              </g>
            )}

            <g aria-hidden>
              {data.map((d, i) => (
                <g key={d.key}>
                  <text
                    x={bandX(i) + band / 2} y={height - (d.sublabel ? 14 : 8)}
                    textAnchor="middle" fontSize={10} fill="var(--text-secondary)"
                  >
                    {d.label}
                  </text>
                  {d.sublabel && (
                    <text
                      x={bandX(i) + band / 2} y={height - 3}
                      textAnchor="middle" fontSize={9} fill="var(--text-muted)"
                    >
                      {d.sublabel}
                    </text>
                  )}
                </g>
              ))}
            </g>
          </svg>
        </div>
        <ChartTooltip tip={tip} width={236} />
      </div>
    </ChartFrame>
  )
}
