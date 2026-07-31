/**
 * Gross-to-net waterfall — the money view every CFO asks for.
 *
 *   Gross Sales
 *     − Off-invoice allowances       (applied at order entry)
 *     = Net Invoice Sales
 *     − Bill-backs / scan-backs      (claimed after the fact)
 *     − Fixed funds / MDF / slotting
 *     − Other deductions & write-offs
 *     = Net Sales
 *     − COGS
 *     = Gross Margin
 *
 * Steps are emitted with running start/end values so the chart is a pure
 * render of this array — no layout math in the component.
 */

import { n4, safeDiv } from './money'

export type WaterfallKind = 'total' | 'subtotal' | 'decrease' | 'increase'

export interface WaterfallStep {
  key: string
  label: string
  /** Signed contribution. Negative for deductions from revenue. */
  value: number
  kind: WaterfallKind
  /** Running value before this step. */
  start: number
  /** Running value after this step. */
  end: number
  /** Share of gross sales — the % a CFO actually benchmarks. */
  pctOfGross: number | null
  hint: string
}

export interface WaterfallInput {
  grossSales: number
  offInvoice: number
  billBackScanBack: number
  fixedFunds: number
  otherDeductions: number
  cogs: number
}

export interface WaterfallResult {
  steps: WaterfallStep[]
  netInvoiceSales: number
  netSales: number
  grossMargin: number
  grossMarginPct: number | null
  totalTradeSpend: number
  tradeRate: number | null
}

export function buildWaterfall(input: WaterfallInput): WaterfallResult {
  const g = n4(input.grossSales)
  const steps: WaterfallStep[] = []
  let running = g

  const push = (
    key: string,
    label: string,
    value: number,
    kind: WaterfallKind,
    hint: string,
  ) => {
    const start = running
    const end = kind === 'total' || kind === 'subtotal' ? running : n4(running + value)
    steps.push({
      key,
      label,
      value: kind === 'total' || kind === 'subtotal' ? running : n4(value),
      kind,
      start: kind === 'total' || kind === 'subtotal' ? 0 : start,
      end,
      pctOfGross: safeDiv(kind === 'total' || kind === 'subtotal' ? running : value, g),
      hint,
    })
    running = end
  }

  push('gross', 'Gross Sales', g, 'total', 'List price × shipped cases, before any allowance.')
  push(
    'off_invoice',
    'Off-Invoice',
    -n4(input.offInvoice),
    'decrease',
    'Taken off the invoice at order entry. Never becomes a deduction.',
  )
  push('net_invoice', 'Net Invoice Sales', 0, 'subtotal', 'What the invoice actually said.')
  push(
    'bill_scan',
    'Bill-back / Scan-back',
    -n4(input.billBackScanBack),
    'decrease',
    'Claimed after the fact — this is what comes back as chargebacks.',
  )
  push(
    'fixed',
    'Fixed funds / MDF / Slotting',
    -n4(input.fixedFunds),
    'decrease',
    'Lump-sum commitments not tied to volume.',
  )
  push(
    'other',
    'Other deductions & write-offs',
    -n4(input.otherDeductions),
    'decrease',
    'Shortages, damages, compliance fines, unrecovered invalid deductions.',
  )
  push('net_sales', 'Net Sales', 0, 'subtotal', 'The revenue line finance reports.')
  push('cogs', 'COGS', -n4(input.cogs), 'decrease', 'Cost of goods on shipped cases.')
  push('margin', 'Gross Margin', 0, 'total', 'What is left to cover everything else.')

  const netInvoiceSales = steps.find((s) => s.key === 'net_invoice')!.value
  const netSales = steps.find((s) => s.key === 'net_sales')!.value
  const grossMargin = steps.find((s) => s.key === 'margin')!.value
  const totalTradeSpend = n4(
    input.offInvoice + input.billBackScanBack + input.fixedFunds + input.otherDeductions,
  )

  return {
    steps,
    netInvoiceSales,
    netSales,
    grossMargin,
    grossMarginPct: safeDiv(grossMargin, netSales),
    totalTradeSpend,
    tradeRate: safeDiv(totalTradeSpend, g),
  }
}
