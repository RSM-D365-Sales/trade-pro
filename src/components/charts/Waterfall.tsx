/**
 * Gross-to-net waterfall.
 *
 * Horizontal rather than the conventional column form: the step labels are
 * phrases ("Fixed funds / MDF / Slotting"), and rotated column labels are the
 * single most common way a waterfall becomes unreadable.
 *
 * Colour is DIVERGING, not categorical — the encoding is polarity (money
 * arriving vs money leaving), so it uses the palette's blue↔red pair. Status
 * colours are deliberately not reused here.
 */

import { useMemo } from 'react'

import type { WaterfallResult, WaterfallStep } from '../../lib/calc/waterfall'
import { money, pct } from '../../lib/calc/money'
import { ChartFrame, ChartTooltip, TipRow, useChartSize, useChartTooltip } from './frame'

const POSITIVE = 'var(--series-1)' // blue pole — value retained
const NEGATIVE = 'var(--series-8)' // red pole — value leaving
const LABEL_W = 168
const ROW_H = 30
const BAR_H = 15

export function Waterfall({
  result, title = 'Gross-to-net waterfall', subtitle,
}: {
  result: WaterfallResult
  title?: string
  subtitle?: string
}) {
  const { ref: sizeRef, width } = useChartSize(720)
  const { ref: hoverRef, tip, show, hide } = useChartTooltip()

  const steps = result.steps
  const max = useMemo(
    () => Math.max(...steps.map((s) => Math.max(s.start, s.end, s.value))),
    [steps],
  )

  const plotW = Math.max(180, width - LABEL_W - 76)
  const x = (v: number) => (max > 0 ? (v / max) * plotW : 0)
  const height = steps.length * ROW_H + 8

  return (
    <ChartFrame
      title={title}
      subtitle={subtitle ?? `Trade rate ${result.tradeRate ? pct(result.tradeRate) : '—'} of gross · margin ${result.grossMarginPct ? pct(result.grossMarginPct) : '—'} of net`}
      legend={[
        { label: 'Retained', color: POSITIVE },
        { label: 'Deducted', color: NEGATIVE },
      ]}
      tableHead={['Step', 'Amount', '% of gross']}
      tableRows={steps.map((s) => [
        s.label,
        money(s.value, { compact: false }),
        s.pctOfGross !== null ? pct(s.pctOfGross) : '—',
      ])}
    >
      <div ref={hoverRef} className="relative">
        <div ref={sizeRef}>
          <svg width="100%" height={height} role="img" aria-label={title}>
            {steps.map((s, i) => {
              const y = i * ROW_H + 6
              const isSummary = s.kind === 'total' || s.kind === 'subtotal'
              const barStart = isSummary ? 0 : Math.min(s.start, s.end)
              const barEnd = isSummary ? s.value : Math.max(s.start, s.end)
              const w = Math.max(2, x(barEnd) - x(barStart))
              const fill = isSummary ? POSITIVE : NEGATIVE

              return (
                <g
                  key={s.key}
                  onMouseMove={(e) => show(e, <StepTip step={s} />)}
                  onMouseLeave={hide}
                  className="cursor-default"
                >
                  {/* Generous hit target, larger than the mark itself. */}
                  <rect x={0} y={y - 4} width={width} height={ROW_H} fill="transparent" />

                  <text
                    x={LABEL_W - 10}
                    y={y + BAR_H / 2}
                    dy="0.32em"
                    textAnchor="end"
                    fontSize={11}
                    fill={isSummary ? 'var(--text-primary)' : 'var(--text-secondary)'}
                    fontWeight={isSummary ? 600 : 400}
                  >
                    {s.label}
                  </text>

                  <rect
                    x={LABEL_W + x(barStart)}
                    y={y}
                    width={w}
                    height={BAR_H}
                    rx={3}
                    fill={fill}
                    opacity={isSummary ? 1 : 0.9}
                  />

                  {/* Direct value label — also the relief for light-mode contrast. */}
                  <text
                    x={LABEL_W + x(barEnd) + 7}
                    y={y + BAR_H / 2}
                    dy="0.32em"
                    fontSize={10.5}
                    className="tnum"
                    fill={isSummary ? 'var(--text-primary)' : 'var(--text-secondary)'}
                    fontWeight={isSummary ? 600 : 400}
                  >
                    {money(s.value, { compact: true })}
                  </text>

                  {/* Connector to the next step's starting edge. */}
                  {i < steps.length - 1 && (
                    <line
                      x1={LABEL_W + x(isSummary ? s.value : Math.min(s.start, s.end))}
                      x2={LABEL_W + x(isSummary ? s.value : Math.min(s.start, s.end))}
                      y1={y + BAR_H}
                      y2={y + ROW_H}
                      stroke="var(--baseline)"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                      shapeRendering="crispEdges"
                    />
                  )}
                </g>
              )
            })}
          </svg>
        </div>
        <ChartTooltip tip={tip} width={230} />
      </div>
    </ChartFrame>
  )
}

function StepTip({ step }: { step: WaterfallStep }) {
  return (
    <div>
      <p className="mb-1 font-semibold text-ink">{step.label}</p>
      <TipRow
        label={step.kind === 'decrease' ? 'Deducted' : 'Running total'}
        value={money(step.value)}
        strong
      />
      {step.pctOfGross !== null && (
        <TipRow label="% of gross sales" value={pct(step.pctOfGross)} />
      )}
      <p className="mt-1 border-t border-hairline pt-1 leading-relaxed text-ink-muted">
        {step.hint}
      </p>
    </div>
  )
}
