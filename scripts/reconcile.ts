/**
 * Reconciliation summary for the seeded Bluestem tenant.
 *
 *   npm run reconcile
 *
 * Builds the dataset exactly as the browser does and prints the headline
 * figures the demo script and README quote — gross, trade rate, margin, the
 * deduction book and its bucket split, the forecast queue — so the numbers can
 * be defended when someone interrogates them, and refreshed whenever the seed
 * changes. Everything here is derived; nothing is typed in.
 */

import { buildDataset, DEMO_TODAY, SEED_CONFIG } from '../src/data/seed'
import { claimableSpendIndex, plannedSpendIndex, tacticIndex, brandIndex } from '../src/data/seed/sales'
import { CHAIN_CUSTOMERS, ORG, TERRITORIES, USER_BY_ID } from '../src/data/catalog'
import { addWeeks } from '../src/lib/fiscal'
import { DEFAULT_MATCH_OPTIONS, disposition, matchDeduction } from '../src/lib/calc/matching'
import { buildRecommendations, summariseRecommendations } from '../src/lib/calc/forecast'
import { computeAllFundBalances } from '../src/lib/calc/funds'

const ds = buildDataset()
const from = addWeeks(DEMO_TODAY, -52)
const f52 = ds.salesFacts.filter((f) => f.weekStart >= from)

const sum = <T,>(xs: T[], pick: (x: T) => number) => xs.reduce((a, x) => a + pick(x), 0)
const usd = (n: number) => `$${(n / 1e6).toFixed(1)}M`
const pct = (n: number) => `${(n * 100).toFixed(1)}%`

const gross = sum(f52, (f) => f.grossSales)
const cogs = sum(f52, (f) => f.cogs)
const offInvoice = sum(f52, (f) => f.offInvoiceDiscount)

const planned = plannedSpendIndex(ds.promotionLines)
const claimable = claimableSpendIndex(ds.promotionLines)
const promoIn52 = ds.promotions.filter(
  (p) => p.performEnd >= from && p.performStart <= DEMO_TODAY && p.status !== 'draft' && p.status !== 'cancelled',
)
const promoSpend = sum(promoIn52, (p) => planned.get(p.id) ?? 0)
const tradeSpend = promoSpend + offInvoice

const onDeal = sum(f52.filter((f) => f.promotionId), (f) => f.units) / sum(f52, (f) => f.units)

// ── Deductions through the live matcher ──
const ctx = {
  customers: ds.customers,
  reasonCodes: ds.reasonCodes,
  claimableSpendByPromotion: claimable,
  tacticsByPromotion: tacticIndex(ds.promotionLines),
  brandsByPromotion: brandIndex(ds.promotionLines),
}
const buckets: Record<string, { n: number; value: number }> = {
  auto_matched: { n: 0, value: 0 }, needs_review: { n: 0, value: 0 },
  likely_invalid: { n: 0, value: 0 }, no_match: { n: 0, value: 0 },
}
for (const d of ds.deductions) {
  const bucket = disposition(matchDeduction(d, ds.promotions, ctx, DEFAULT_MATCH_OPTIONS), DEFAULT_MATCH_OPTIONS)
  buckets[bucket].n += 1
  buckets[bucket].value += d.amount
}
const deducted = sum(ds.deductions, (d) => d.amount)
const claimableTotal = [...claimable.values()].reduce((a, b) => a + b, 0)
const atRisk = buckets.likely_invalid.value + buckets.no_match.value
const recovered = sum(ds.disputes, (d) => d.recoveredAmount)
const won = ds.disputes.filter((d) => d.status === 'won' || d.status === 'partial').length
const decided = ds.disputes.filter((d) => d.status === 'won' || d.status === 'partial' || d.status === 'lost').length

// ── Forecast queue ──
const recs = buildRecommendations(ds.forecast.lines, ds.forecast.periods, ds.forecast.signals)
const recSummary = summariseRecommendations(recs)

// ── Funds ──
const balances = computeAllFundBalances(ds.funds, ds.fundTransactions)
const overCommitted = [...balances.values()].filter((b) => b.overCommitted).length

const rows: [string, string][] = [
  ['Tenant', `${ORG.name} · as of ${DEMO_TODAY} · seed ${SEED_CONFIG.seed}`],
  ['Customers', `${CHAIN_CUSTOMERS.length} chains → ${ds.customers.length - CHAIN_CUSTOMERS.length} banners`],
  ['Products', `${ds.products.length} SKUs · ${new Set(ds.products.map((p) => p.brand)).size} labels · ${ds.forecast.productGroups.length} product groups`],
  ['History', `${SEED_CONFIG.historyWeeks} weeks · ${ds.salesFacts.length.toLocaleString('en-US')} shipment facts`],
  ['Gross sales (T52W)', usd(gross)],
  ['Gross margin', pct((gross - cogs) / gross)],
  ['Trade spend', `${usd(tradeSpend)} · ${pct(tradeSpend / gross)} of gross (${usd(offInvoice)} everyday off-invoice + ${usd(promoSpend)} events)`],
  ['Volume on deal', pct(onDeal)],
  ['Promotions', `${ds.promotions.length} events · ${(ds.promotionLines.length / ds.promotions.length).toFixed(1)} lines each · ${ds.promotions.filter((p) => p.performStart > DEMO_TODAY).length} forward`],
  ['Funds', `${ds.funds.length} funds · ${ds.fundTransactions.length.toLocaleString('en-US')} ledger postings · ${overCommitted} over-committed`],
  ['Deductions', `${ds.deductions.length} chargebacks · ${usd(deducted)} · ${pct(deducted / claimableTotal)} of claimable spend (${usd(claimableTotal)})`],
  ['  auto-matched', `${buckets.auto_matched.n} · ${usd(buckets.auto_matched.value)}`],
  ['  needs review', `${buckets.needs_review.n} · ${usd(buckets.needs_review.value)}`],
  ['  likely invalid', `${buckets.likely_invalid.n} · ${usd(buckets.likely_invalid.value)}`],
  ['  no match', `${buckets.no_match.n} · ${usd(buckets.no_match.value)}`],
  ['At risk (invalid + unmatched)', `${usd(atRisk)} · ${pct(atRisk / deducted)} of everything deducted`],
  ['Disputes', `${ds.disputes.length} · ${usd(recovered)} recovered · win rate ${decided ? pct(won / decided) : 'n/a'}`],
  ['Forecast', `${ds.forecast.lines.length} lines × ${ds.forecast.periods.length} periods · ${recs.length} findings (${recSummary.high} high · ${recSummary.medium} medium)`],
  ['Territories', TERRITORIES.map((t) => `${USER_BY_ID.get(t.repId)?.name.split(' ')[0]} ${t.customerIds.length}`).join(' · ')],
]

const width = Math.max(...rows.map(([k]) => k.length))
console.log(`\n${ORG.name} — seeded tenant reconciliation\n`)
for (const [k, v] of rows) console.log(`  ${k.padEnd(width)}  ${v}`)
console.log('')
