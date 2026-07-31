import type { Tactic, TacticCode } from './types'

/**
 * Tactic reference data. `settlement` is the field that actually matters
 * operationally: off-invoice money never becomes a deduction (it came off the
 * invoice at order entry), while bill-back and scan-back money comes back at
 * you weeks later as a chargeback you have to match. That distinction drives
 * the whole deduction module.
 */
export const TACTICS: Tactic[] = [
  { code: 'off_invoice', name: 'Off-Invoice', settlement: 'off_invoice', typicalLift: 1.35, isDisplayVehicle: false },
  { code: 'bill_back', name: 'Bill-Back', settlement: 'bill_back', typicalLift: 1.3, isDisplayVehicle: false },
  { code: 'scan_back', name: 'Scan-Back', settlement: 'scan_back', typicalLift: 1.45, isDisplayVehicle: false },
  { code: 'tpr', name: 'Temp. Price Reduction', settlement: 'scan_back', typicalLift: 1.55, isDisplayVehicle: false },
  { code: 'display', name: 'Display', settlement: 'bill_back', typicalLift: 2.1, isDisplayVehicle: true },
  { code: 'feature', name: 'Feature Ad', settlement: 'bill_back', typicalLift: 2.4, isDisplayVehicle: true },
  { code: 'feature_display', name: 'Feature + Display', settlement: 'bill_back', typicalLift: 3.6, isDisplayVehicle: true },
  { code: 'bogo', name: 'BOGO', settlement: 'scan_back', typicalLift: 2.8, isDisplayVehicle: false },
  { code: 'coupon', name: 'Coupon', settlement: 'bill_back', typicalLift: 1.25, isDisplayVehicle: false },
  { code: 'slotting', name: 'Slotting', settlement: 'lump_sum', typicalLift: 1.0, isDisplayVehicle: false },
  { code: 'listing', name: 'Listing Fee', settlement: 'lump_sum', typicalLift: 1.0, isDisplayVehicle: false },
  { code: 'mdf', name: 'Marketing Dev. Fund', settlement: 'lump_sum', typicalLift: 1.15, isDisplayVehicle: false },
  { code: 'sampling', name: 'In-Store Sampling', settlement: 'lump_sum', typicalLift: 1.3, isDisplayVehicle: true },
  { code: 'rebate', name: 'Volume Rebate', settlement: 'bill_back', typicalLift: 1.1, isDisplayVehicle: false },
  { code: 'edlp', name: 'EDLP Allowance', settlement: 'off_invoice', typicalLift: 1.12, isDisplayVehicle: false },
]

export const TACTIC_BY_CODE: Record<TacticCode, Tactic> = Object.fromEntries(
  TACTICS.map((t) => [t.code, t]),
) as Record<TacticCode, Tactic>

/**
 * Fixed categorical slot per tactic — color follows the entity, never its rank,
 * so filtering the calendar never repaints the survivors. Slots 1-8 only;
 * anything past the top eight tactics shares the neutral "other" treatment.
 */
export const TACTIC_SERIES_SLOT: Partial<Record<TacticCode, number>> = {
  feature_display: 1,
  display: 2,
  feature: 3,
  tpr: 4,
  scan_back: 5,
  off_invoice: 6,
  bill_back: 7,
  bogo: 8,
}

export function tacticColor(code: TacticCode): string {
  const slot = TACTIC_SERIES_SLOT[code]
  return slot ? `var(--series-${slot})` : 'var(--text-muted)'
}

export function tacticName(code: TacticCode): string {
  return TACTIC_BY_CODE[code]?.name ?? code
}
