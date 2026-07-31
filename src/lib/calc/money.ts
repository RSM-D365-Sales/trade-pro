/**
 * Money & volume primitives.
 *
 * The real schema stores these as numeric(18,4). JS floats are not that, so
 * every value that crosses a calculation boundary is snapped back to 4 decimal
 * places. This is not cosmetic: without it, summing 300 deduction lines drifts
 * by fractions of a cent and a finance user WILL notice the recon break.
 */

const SCALE = 10_000

/** Snap to numeric(18,4). Apply at every boundary, not just on display. */
export function n4(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.round(v * SCALE) / SCALE
}

/** Sum with per-step snapping so long ledgers stay exact to the 4th decimal. */
export function sum4(values: number[]): number {
  let acc = 0
  for (const v of values) acc = Math.round(acc * SCALE + Math.round(v * SCALE)) / SCALE
  return acc
}

export function sumBy<T>(items: T[], f: (t: T) => number): number {
  return sum4(items.map(f))
}

/** Guarded division — trade math divides by zero constantly (no baseline yet). */
export function safeDiv(numerator: number, denominator: number): number | null {
  if (!denominator || !Number.isFinite(denominator)) return null
  const r = numerator / denominator
  return Number.isFinite(r) ? r : null
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`
}

export function money(v: number, opts: { compact?: boolean; cents?: boolean } = {}): string {
  const { compact = false, cents = false } = opts
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''

  if (compact) {
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2)}M`
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
    return `${sign}$${abs.toFixed(0)}`
  }
  return `${sign}$${abs.toLocaleString('en-US', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`
}

export function units(v: number, compact = false): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (compact && abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (compact && abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(0)}K`
  return `${sign}${Math.round(abs).toLocaleString('en-US')}`
}

/** '+12.4%' / '−3.1%' with an explicit sign, for delta chips. */
export function delta(v: number, digits = 1): string {
  const s = (v * 100).toFixed(digits)
  return v >= 0 ? `+${s}%` : `${s.replace('-', '−')}%`
}
