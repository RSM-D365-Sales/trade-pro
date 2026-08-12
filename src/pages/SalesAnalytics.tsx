/**
 * Sales analytics — the commercial leadership screen.
 *
 * Everything here is a rollup of the same customer × product × week facts the
 * trade screens use, taken to ONE definition of net sales: gross, less
 * allowances taken at invoice, less claimed trade money straight-lined across
 * the weeks the event was on shelf.
 *
 * It reconciles to the gross-to-net waterfall on Trade analytics with exactly
 * two named differences, both guarded by a test in seed/economics.test.ts:
 *   1. The waterfall carries unrecovered invalid deductions inside net sales,
 *      because that screen is arguing about cash. Here they are a claims cost
 *      reported separately — they have no product to land on, and forcing them
 *      into a product rollup would break the additivity every chart depends on.
 *   2. The waterfall books each event whole; this page books it by elapsed
 *      week, so an event straddling the window edge splits.
 * A prospect WILL cross-check these two screens. Being able to name the
 * difference in one sentence is the difference between rigour and a bug.
 *
 * Periods are FISCAL, not calendar. A 5-week period sells roughly 25% more than
 * a 4-week one at identical velocity, so the week count prints under every
 * column and the plan is phased by elapsed weeks rather than elapsed days.
 */

import { ArrowRight, Gauge } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { BarChart } from '../components/charts/BarChart'
import { ColumnChart, type ColumnDatum } from '../components/charts/ColumnChart'
import { seriesColor } from '../components/charts/frame'
import { PageBody, PageHeader } from '../components/PageHeader'
import {
  Badge, Card, InfoTip, Meter, SectionHeader, Segmented, Select, StatTile, type Tone,
} from '../components/ui'
import { CHAIN_CUSTOMERS, TERRITORIES } from '../data/catalog'
import {
  DEFAULT_ATTENTION, findAccountSignals, impliedCasesOrdered, daysSalesOutstanding,
  median, rankReps, rollup, rollupBy, type AccountInput, type AccountSignalKind,
} from '../lib/calc/commercial'
import { delta, money, pct, units as fmtUnits } from '../lib/calc/money'
import { addWeeks, formatDate } from '../lib/fiscal'
import { useStore } from '../store'
import {
  useCommercialFacts, useEnrichedDeductions, useLookups, usePeriodOfWeek, useSalesPeriods,
} from '../store/selectors'

type Scope = 'ptd' | 'last' | 'qtd' | 'fytd'

const SCOPE_LABEL: Record<Scope, string> = {
  ptd: 'Period to date',
  last: 'Last period',
  qtd: 'Quarter to date',
  fytd: 'Fiscal YTD',
}

/** Receivables are a point-in-time measure — always the trailing quarter. */
const DSO_WEEKS = 13

export function SalesAnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const today = useStore((s) => s.today)
  const dataset = useStore((s) => s.dataset)
  const { productsById, usersById } = useLookups()

  const facts = useCommercialFacts()
  const periods = useSalesPeriods()
  const periodOfWeek = usePeriodOfWeek()
  const deductions = useEnrichedDeductions()

  // Quarter to date by default: the demo's "today" sits in week one of a
  // period, and a one-week window is all noise — a single soft week reads as an
  // account in trouble. The quarter has enough weeks to mean something and
  // still includes the period in flight.
  const [scope, setScope] = useState<Scope>('qtd')
  const chain = params.get('customer') ?? 'all'
  const group = params.get('group') ?? 'all'
  const setParam = (key: 'customer' | 'group', v: string) => {
    const next = new URLSearchParams(params)
    if (v === 'all') next.delete(key)
    else next.set(key, v)
    setParams(next, { replace: true })
  }
  const setChain = (v: string) => setParam('customer', v)
  const setGroup = (v: string) => setParam('group', v)
  const scopeChain = chain === 'all' ? undefined : chain
  /** Product-group lens — set by clicking a bar in "Gross profit by product group". */
  const scopeGroup = group === 'all' ? undefined : group

  const groupOptions = useMemo(
    () => [...new Set(dataset.products.map((p) => p.subbrand))].sort(),
    [dataset.products],
  )
  const groupProducts = useMemo(
    () => (scopeGroup
      ? new Set(dataset.products.filter((p) => p.subbrand === scopeGroup).map((p) => p.id))
      : null),
    [dataset.products, scopeGroup],
  )

  // ── Fiscal scaffolding ──────────────────────────────────────────────────
  const weeksByPeriod = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [week, key] of periodOfWeek) {
      const arr = m.get(key)
      if (arr) arr.push(week)
      else m.set(key, [week])
    }
    for (const arr of m.values()) arr.sort()
    return m
  }, [periodOfWeek])

  const currentPeriod = useMemo(() => {
    const past = periods.filter((p) => p.start <= today)
    return past[past.length - 1]
  }, [periods, today])

  const scopeWindow = useMemo(() => {
    if (!currentPeriod) return { periods: [], weeks: [] as string[] }
    const idx = periods.findIndex((p) => p.key === currentPeriod.key)
    const collect = (ps: typeof periods, capToToday: boolean) => {
      const out: string[] = []
      for (const p of ps) {
        for (const w of weeksByPeriod.get(p.key) ?? []) {
          if (capToToday && w > today) continue
          out.push(w)
        }
      }
      return out.sort()
    }

    if (scope === 'last') {
      const prev = periods[idx - 1]
      const ps = prev ? [prev] : [currentPeriod]
      return { periods: ps, weeks: collect(ps, false) }
    }
    if (scope === 'qtd') {
      const q = Math.ceil(currentPeriod.period / 3)
      const ps = periods.filter(
        (p) => p.fiscalYear === currentPeriod.fiscalYear
          && Math.ceil(p.period / 3) === q && p.start <= today,
      )
      return { periods: ps, weeks: collect(ps, true) }
    }
    if (scope === 'fytd') {
      const ps = periods.filter((p) => p.fiscalYear === currentPeriod.fiscalYear && p.start <= today)
      return { periods: ps, weeks: collect(ps, true) }
    }
    return { periods: [currentPeriod], weeks: collect([currentPeriod], true) }
  }, [scope, periods, currentPeriod, weeksByPeriod, today])

  const weekSet = useMemo(() => new Set(scopeWindow.weeks), [scopeWindow.weeks])
  const lyWeekSet = useMemo(
    () => new Set(scopeWindow.weeks.map((w) => addWeeks(w, -52))),
    [scopeWindow.weeks],
  )

  // ── Facts in scope ──────────────────────────────────────────────────────
  /*
   * Two bases on purpose. Product-additive measures (sales, profit, cases,
   * deal share) follow the product-group lens; account-level measures (plan,
   * deductions, receivables, service rates) have no product to land on, so
   * they stay on the customer-only base and their cards say so. Allocating
   * them to a product would be the same lie the waterfall note warns about.
   */
  const inChain = useMemo(
    () => (scopeChain ? facts.filter((f) => f.chainId === scopeChain) : facts),
    [facts, scopeChain],
  )
  const inScope = useMemo(
    () => (groupProducts ? inChain.filter((f) => groupProducts.has(f.productId)) : inChain),
    [inChain, groupProducts],
  )
  /** Customer-scoped, all products — the base for account-level cards and the group chart. */
  const scopedAllGroups = useMemo(
    () => inChain.filter((f) => weekSet.has(f.weekStart)),
    [inChain, weekSet],
  )
  const scoped = useMemo(
    () => (groupProducts ? scopedAllGroups.filter((f) => groupProducts.has(f.productId)) : scopedAllGroups),
    [scopedAllGroups, groupProducts],
  )
  const lastYear = useMemo(
    () => inScope.filter((f) => lyWeekSet.has(f.weekStart)), [inScope, lyWeekSet],
  )

  const current = useMemo(() => rollup(scoped), [scoped])
  const prior = useMemo(() => rollup(lastYear), [lastYear])
  const byChain = useMemo(() => rollupBy(scoped, (f) => f.chainId), [scoped])
  /** Whole-account rollup for the window — denominator for account-level rates. */
  const accountRoll = useMemo(
    () => (scopeGroup ? rollup(scopedAllGroups) : current),
    [scopeGroup, scopedAllGroups, current],
  )

  // ── Plan, phased by elapsed weeks ───────────────────────────────────────
  const planIndex = useMemo(
    () => new Map(dataset.commercial.plan.map((p) => [`${p.customerId}|${p.periodKey}`, p.netSales])),
    [dataset.commercial.plan],
  )

  const planByChain = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of scopeWindow.periods) {
      const all = weeksByPeriod.get(p.key) ?? []
      const elapsed = all.filter((w) => weekSet.has(w)).length
      const share = all.length > 0 ? elapsed / all.length : 0
      for (const c of CHAIN_CUSTOMERS) {
        m.set(c.id, (m.get(c.id) ?? 0) + (planIndex.get(`${c.id}|${p.key}`) ?? 0) * share)
      }
    }
    return m
  }, [scopeWindow.periods, weeksByPeriod, weekSet, planIndex])

  const planTotal = useMemo(() => {
    // Plan is authored at customer × period. There is no product-group plan to
    // compare a product lens against, so attainment simply goes quiet.
    if (scopeGroup) return 0
    const ids = scopeChain ? [scopeChain] : CHAIN_CUSTOMERS.map((c) => c.id)
    return ids.reduce((a, id) => a + (planByChain.get(id) ?? 0), 0)
  }, [planByChain, scopeChain, scopeGroup])

  // ── Rolling eight periods ───────────────────────────────────────────────
  const rolling = useMemo(() => {
    const recent = periods.slice(-8)
    const byPeriod = rollupBy(inScope, (f) => periodOfWeek.get(f.weekStart) ?? null)
    const chains = scopeChain ? [scopeChain] : CHAIN_CUSTOMERS.map((c) => c.id)

    const columns: ColumnDatum[] = []
    const margins: (number | null)[] = []

    for (const p of recent) {
      const roll = byPeriod.get(p.key)
      if (!roll) continue
      const all = weeksByPeriod.get(p.key) ?? []
      const elapsed = all.filter((w) => w <= today).length
      const inProgress = elapsed < all.length
      const share = all.length > 0 ? elapsed / all.length : 1
      // No plan ticks under a product lens — plan is customer-level.
      const plan = scopeGroup
        ? 0
        : chains.reduce((a, id) => a + (planIndex.get(`${id}|${p.key}`) ?? 0), 0) * share

      columns.push({
        key: p.key,
        label: p.label,
        sublabel: inProgress ? `${elapsed} of ${all.length}w` : `${all.length}w`,
        value: roll.netSales,
        target: plan > 0 ? plan : undefined,
        detail: [
          { label: 'Gross sales', value: money(roll.grossSales, { compact: true }) },
          { label: 'Trade spend', value: money(roll.tradeSpend, { compact: true }) },
          { label: 'Cases', value: fmtUnits(roll.units, true) },
          ...(inProgress ? [{ label: 'Status', value: 'Period in progress' }] : []),
        ],
      })
      margins.push(roll.grossMarginPct)
    }

    return { columns, margins }
  }, [periods, inScope, periodOfWeek, weeksByPeriod, planIndex, scopeChain, scopeGroup, today])

  // ── Gross profit by product group ───────────────────────────────────────
  // Built from ALL groups even when one is selected — the chart is the filter
  // control, and a filter that hides its own alternatives cannot be undone.
  const groupMix = useMemo(() => {
    const byGroup = rollupBy(scopedAllGroups, (f) => productsById.get(f.productId)?.subbrand ?? null)
    return [...byGroup.entries()]
      .map(([name, r]) => ({ name, roll: r }))
      .sort((a, b) => b.roll.grossProfit - a.roll.grossProfit)
      .map((e, i) => ({
        key: e.name,
        label: e.name,
        value: e.roll.grossProfit,
        color: seriesColor(i),
        detail: [
          { label: 'Net sales', value: money(e.roll.netSales, { compact: true }) },
          { label: 'Margin', value: e.roll.grossMarginPct !== null ? pct(e.roll.grossMarginPct) : '—' },
          { label: 'GP / case', value: e.roll.gpPerCase !== null ? `$${e.roll.gpPerCase.toFixed(2)}` : '—' },
        ],
      }))
  }, [scopedAllGroups, productsById])

  // ── Rep leaderboard ─────────────────────────────────────────────────────
  const reps = useMemo(() => {
    const roster = TERRITORIES.map((t) => {
      const u = usersById.get(t.repId)
      return {
        id: t.repId,
        name: u?.name ?? t.repId,
        initials: u?.initials ?? '—',
        customerIds: scopeChain ? t.customerIds.filter((c) => c === scopeChain) : t.customerIds,
      }
    }).filter((r) => r.customerIds.length > 0)
    // Under a product lens the rollups are group-sliced but plan is not, so
    // attainment is withheld rather than compared against the wrong base.
    return rankReps(roster, byChain, scopeGroup ? new Map() : planByChain)
  }, [byChain, planByChain, usersById, scopeChain, scopeGroup])

  const marginFloor = useMemo(() => {
    const company = current.grossMarginPct ?? DEFAULT_ATTENTION.companyMarginPct
    return company - DEFAULT_ATTENTION.marginFloorGap
  }, [current.grossMarginPct])

  const repMedian = useMemo(
    () => median(reps.map((r) => r.rollup.grossMarginPct).filter((v): v is number => v !== null)),
    [reps],
  )
  const belowFloorCount = reps.filter((r) => (r.rollup.grossMarginPct ?? 1) < marginFloor).length

  // ── Service & quality ───────────────────────────────────────────────────
  // Orders, fill and OTIF are how a retailer scores the ACCOUNT — an order
  // carries every product on the truck, so these stay on the all-products
  // base and the card is labelled when a product lens is active.
  const service = useMemo(() => {
    const rateIndex = new Map(
      dataset.commercial.service.map((s) => [`${s.customerId}|${s.periodKey}`, s]),
    )
    const casesByCell = rollupBy(scopedAllGroups, (f) => {
      const p = periodOfWeek.get(f.weekStart)
      return p ? `${f.chainId}|${p}` : null
    })

    let shipped = 0
    let ordered = 0
    let orders = 0
    let onTimeOrders = 0
    let lines = 0

    for (const [key, roll] of casesByCell) {
      const rates = rateIndex.get(key)
      if (!rates || roll.units <= 0) continue
      shipped += roll.units
      ordered += impliedCasesOrdered(roll.units, rates.fillRate)
      const cellOrders = rates.casesPerOrder > 0 ? roll.units / rates.casesPerOrder : 0
      orders += cellOrders
      onTimeOrders += cellOrders * rates.otifRate
      lines += cellOrders * rates.linesPerOrder
    }

    return {
      fillRate: ordered > 0 ? shipped / ordered : null,
      otif: orders > 0 ? onTimeOrders / orders : null,
      orders,
      linesPerOrder: orders > 0 ? lines / orders : null,
      dropSize: orders > 0 ? accountRoll.netSales / orders : null,
      daysOfSupply: median(
        scopeWindow.periods
          .map((p) => dataset.commercial.daysOfSupply.find((d) => d.periodKey === p.key)?.days)
          .filter((v): v is number => v !== undefined),
      ),
    }
  }, [dataset.commercial, scopedAllGroups, periodOfWeek, accountRoll.netSales, scopeWindow.periods])

  // ── Receivables (trailing quarter, point in time) ───────────────────────
  const receivables = useMemo(() => {
    const from = addWeeks(today, -DSO_WEEKS)
    const trailing = rollupBy(
      inChain.filter((f) => f.weekStart > from && f.weekStart <= today),
      (f) => f.chainId,
    )
    const terms = new Map(dataset.commercial.receivables.map((r) => [r.customerId, r]))

    let balance = 0
    let pastDue = 0
    let netSales = 0
    for (const [chainId, roll] of trailing) {
      const t = terms.get(chainId)
      if (!t) continue
      const ar = (roll.netSales / (DSO_WEEKS * 7)) * t.dsoDays
      balance += ar
      pastDue += ar * t.pastDue60Share
      netSales += roll.netSales
    }
    return {
      balance,
      pastDue,
      days: daysSalesOutstanding(balance, netSales, DSO_WEEKS * 7),
    }
  }, [inChain, dataset.commercial.receivables, today])

  // ── Deductions & credits landing in the window ──────────────────────────
  const credits = useMemo(() => {
    const from = scopeWindow.weeks[0]
    const to = scopeWindow.weeks.length ? addWeeks(scopeWindow.weeks[scopeWindow.weeks.length - 1], 1) : undefined
    if (!from || !to) return { value: 0, count: 0, rate: null as number | null, unresolved: 0 }
    const rows = deductions.filter(
      (r) => r.deduction.receivedDate >= from && r.deduction.receivedDate < to
        && (!scopeChain || r.chainId === scopeChain),
    )
    const value = rows.reduce((a, r) => a + r.deduction.amount, 0)
    return {
      value,
      count: rows.length,
      // A chargeback arrives against the account, not a product — the rate is
      // read against whole-account net sales even under a product lens.
      rate: accountRoll.netSales > 0 ? value / accountRoll.netSales : null,
      unresolved: rows.filter((r) => !r.match.resolved && r.match.disposition !== 'auto_matched').length,
    }
  }, [deductions, scopeWindow.weeks, scopeChain, accountRoll.netSales])

  // ── Accounts needing attention ──────────────────────────────────────────
  /**
   * Money genuinely at risk, not the whole review queue. A chargeback the
   * engine matched but a human has not yet clicked through is not a problem;
   * one it cannot tie to any event, or believes is invalid, is.
   */
  const atRiskByChain = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of deductions) {
      if (r.match.resolved) continue
      if (r.match.disposition !== 'likely_invalid' && r.match.disposition !== 'no_match') continue
      m.set(r.chainId, (m.get(r.chainId) ?? 0) + r.deduction.amount)
    }
    return m
  }, [deductions])

  /** Trailing-year net sales per chain — the denominator a stock is read against. */
  const annualByChain = useMemo(() => {
    const from = addWeeks(today, -52)
    return rollupBy(inChain.filter((f) => f.weekStart > from), (f) => f.chainId)
  }, [inChain, today])

  const groupCount = useMemo(
    () => new Set(dataset.products.map((p) => p.subbrand)).size,
    [dataset.products],
  )

  const signals = useMemo(() => {
    const lyByChain = rollupBy(lastYear, (f) => f.chainId)
    const groupsByChain = new Map<string, Set<string>>()
    for (const f of scoped) {
      if (f.units <= 0) continue
      const group = productsById.get(f.productId)?.subbrand
      if (!group) continue
      const set = groupsByChain.get(f.chainId)
      if (set) set.add(group)
      else groupsByChain.set(f.chainId, new Set([group]))
    }

    /*
     * Under a product lens, volume and margin are checked within the lens —
     * "Albertsons' Cold Brew is down 12%" is a real finding. Plan, deduction
     * and assortment checks apply to the whole account, so their inputs are
     * neutralised rather than compared against a product-sized denominator.
     */
    const inputs: AccountInput[] = CHAIN_CUSTOMERS
      .filter((c) => !scopeChain || c.id === scopeChain)
      .map((c) => {
        const roll = byChain.get(c.id)
        return {
          customerId: c.id,
          name: c.name,
          netSales: roll?.netSales ?? 0,
          netSalesComparable: lyByChain.get(c.id)?.netSales ?? 0,
          netSalesAnnual: annualByChain.get(c.id)?.netSales ?? 0,
          grossMarginPct: roll?.grossMarginPct ?? null,
          planNetSales: scopeGroup ? 0 : planByChain.get(c.id) ?? 0,
          openDeductions: scopeGroup ? 0 : atRiskByChain.get(c.id) ?? 0,
          productGroupsBought: scopeGroup ? groupCount : groupsByChain.get(c.id)?.size ?? 0,
          productGroupsAvailable: groupCount,
        }
      })

    const annualTotal = inputs.reduce((a, x) => a + x.netSalesAnnual, 0)
    const atRiskTotal = inputs.reduce((a, x) => a + x.openDeductions, 0)

    return findAccountSignals(inputs, {
      ...DEFAULT_ATTENTION,
      companyMarginPct: current.grossMarginPct ?? DEFAULT_ATTENTION.companyMarginPct,
      companyDeductionRate: annualTotal > 0
        ? atRiskTotal / annualTotal
        : DEFAULT_ATTENTION.companyDeductionRate,
    })
  }, [
    byChain, lastYear, scoped, planByChain, atRiskByChain, annualByChain, productsById,
    groupCount, scopeChain, scopeGroup, current.grossMarginPct,
  ])

  // ── Header copy ─────────────────────────────────────────────────────────
  const elapsed = currentPeriod
    ? (weeksByPeriod.get(currentPeriod.key) ?? []).filter((w) => w <= today).length
    : 0
  const totalWeeks = currentPeriod ? (weeksByPeriod.get(currentPeriod.key) ?? []).length : 0
  const attainment = planTotal > 0 ? current.netSales / planTotal : null

  const yoy = (now: number, before: number) => (before > 0 ? (now - before) / before : null)
  const netYoy = yoy(current.netSales, prior.netSales)
  const gpYoy = yoy(current.grossProfit, prior.grossProfit)
  const caseYoy = yoy(current.units, prior.units)
  const marginBps =
    current.grossMarginPct !== null && prior.grossMarginPct !== null
      ? Math.round((current.grossMarginPct - prior.grossMarginPct) * 10_000)
      : null

  return (
    <>
      <PageHeader
        title="Sales analytics"
        description={
          currentPeriod
            ? `${dataset.org.name} · ${currentPeriod.key} (${currentPeriod.sublabel}) · week ${elapsed} of ${totalWeeks} · ${SCOPE_LABEL[scope].toLowerCase()} through ${formatDate(today)}${scopeGroup ? ` · focused on ${scopeGroup}` : ''}`
            : dataset.org.name
        }
        filters={
          <>
            <Segmented<Scope>
              value={scope}
              onChange={setScope}
              options={(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => ({
                value: s, label: SCOPE_LABEL[s],
              }))}
            />
            <Select
              ariaLabel="Filter by customer"
              className="w-52"
              value={chain}
              onChange={setChain}
              options={[
                { value: 'all', label: 'All customers' },
                ...CHAIN_CUSTOMERS.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              ariaLabel="Filter by product group"
              className="w-44"
              value={group}
              onChange={setGroup}
              options={[
                { value: 'all', label: 'All product groups' },
                ...groupOptions.map((g) => ({ value: g, label: g })),
              ]}
            />
          </>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Net sales"
            value={money(current.netSales, { compact: true })}
            delta={netYoy !== null ? `${delta(netYoy)} vs LY` : undefined}
            deltaTone={(netYoy ?? 0) >= 0 ? 'good' : 'critical'}
            hint={attainment !== null ? `${pct(attainment, 0)} of plan` : undefined}
            accent={seriesColor(0)}
          />
          <StatTile
            label="Gross profit"
            value={money(current.grossProfit, { compact: true })}
            delta={gpYoy !== null ? `${delta(gpYoy)} vs LY` : undefined}
            deltaTone={(gpYoy ?? 0) >= 0 ? 'good' : 'critical'}
            hint={current.gpPerCase !== null ? `$${current.gpPerCase.toFixed(2)} per case` : undefined}
            accent="var(--status-good)"
          />
          <StatTile
            label="Gross margin"
            value={current.grossMarginPct !== null ? pct(current.grossMarginPct) : '—'}
            delta={marginBps !== null ? `${marginBps >= 0 ? '+' : '−'}${Math.abs(marginBps)} bps` : undefined}
            deltaTone={(marginBps ?? 0) >= 0 ? 'good' : 'critical'}
            hint="vs LY"
            accent={seriesColor(2)}
          />
          <StatTile
            label="Cases shipped"
            value={fmtUnits(current.units, true)}
            delta={caseYoy !== null ? `${delta(caseYoy)} vs LY` : undefined}
            deltaTone={(caseYoy ?? 0) >= 0 ? 'good' : 'critical'}
            hint={current.netPricePerCase !== null ? `$${current.netPricePerCase.toFixed(2)} net per case` : undefined}
            accent={seriesColor(6)}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {/*
            Deal share moves with the event calendar, so it is neither good nor
            bad on its own — it is only readable next to the margin tile above
            it. Colouring a mix shift green or red asserts a verdict the number
            does not support.
          */}
          <StatTile
            label="Volume on deal"
            value={current.dealShare !== null ? pct(current.dealShare) : '—'}
            delta={prior.dealShare !== null && current.dealShare !== null
              ? `${delta(current.dealShare - prior.dealShare, 1).replace('%', ' pts')} vs LY`
              : undefined}
            deltaTone="neutral"
            hint={current.tradeRate !== null ? `${pct(current.tradeRate)} trade rate` : undefined}
            accent={seriesColor(1)}
          />
          <StatTile
            label="Case fill rate"
            value={service.fillRate !== null ? pct(service.fillRate) : '—'}
            delta={service.otif !== null ? `${pct(service.otif)} OTIF` : undefined}
            deltaTone={(service.fillRate ?? 0) >= 0.97 ? 'good' : 'warning'}
            hint={scopeGroup ? 'target 98.0% · whole account' : 'target 98.0%'}
            accent={(service.fillRate ?? 0) >= 0.97 ? 'var(--status-good)' : 'var(--status-warning)'}
          />
          <StatTile
            label="Deductions & credits"
            value={credits.rate !== null ? pct(credits.rate) : '—'}
            delta={`${credits.count} received`}
            deltaTone="neutral"
            hint={scopeGroup
              ? `${money(credits.value, { compact: true })} · whole account`
              : `${money(credits.value, { compact: true })} of net sales`}
            accent="var(--status-serious)"
          />
          <StatTile
            label="DSO"
            value={receivables.days !== null ? `${receivables.days.toFixed(1)} days` : '—'}
            delta={`${money(receivables.pastDue, { compact: true })} past 60 days`}
            deltaTone={receivables.pastDue / Math.max(1, receivables.balance) > 0.05 ? 'warning' : 'neutral'}
            hint={scopeGroup ? 'trailing 13 weeks · whole account' : 'trailing 13 weeks'}
            accent={seriesColor(4)}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <ColumnChart
            title={scopeGroup
              ? `Net sales — rolling eight fiscal periods · ${scopeGroup}`
              : 'Net sales vs plan — rolling eight fiscal periods'}
            subtitle={scopeGroup
              ? 'Plan ticks are hidden under a product lens — the plan is set per customer and has no product-group slice to compare against.'
              : 'Plan is phased by elapsed weeks, so an in-progress period is compared like for like. Gross margin runs underneath on its own scale — never a second axis.'}
            data={rolling.columns}
            format={(v) => money(v, { compact: true })}
            valueLabel="Net sales"
            targetLabel="Plan"
            height={272}
            strip={{
              label: 'Gross margin %',
              values: rolling.margins,
              format: (v) => pct(v, 1),
              color: seriesColor(1),
            }}
          />

          <BarChart
            title="Gross profit by product group"
            subtitle={scopeGroup
              ? `Focused on ${scopeGroup} — click it again (or set the filter to all) to release the page`
              : 'Where the margin actually comes from — net of every allowance, not list price. Click a group to focus the whole page on it.'}
            data={groupMix}
            format={(v) => money(v, { compact: true })}
            labelWidth={128}
            tableValueHead="Gross profit"
            onSelect={(key) => setGroup(key === group ? 'all' : key)}
            selectedKey={scopeGroup}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <Card padded={false} className="overflow-hidden">
            <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title={
                  <span className="flex items-center gap-1.5">
                    Territory leaderboard — gross profit
                    <InfoTip>
                      Ranked on gross profit, not net sales. A rep can top the revenue table and
                      still be the reason margin is down; ranking on the top line is how that
                      goes unnoticed for a year.
                    </InfoTip>
                  </span>
                }
                subtitle={
                  repMedian !== null
                    ? `Median territory margin ${pct(repMedian)} · floor ${pct(marginFloor)}`
                    : 'No shipments in this window'
                }
              />
              <Badge tone="neutral">{SCOPE_LABEL[scope]}</Badge>
            </div>

            {reps.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-ink-muted">
                No territory has shipments in this window.
              </div>
            ) : (
              <ul className="divide-y divide-hairline/60">
                {reps.map((rep) => {
                  const best = reps[0].rollup.grossProfit || 1
                  const belowFloor = (rep.rollup.grossMarginPct ?? 1) < marginFloor
                  return (
                    <li key={rep.repId} className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span
                          aria-hidden
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sunken text-2xs font-semibold text-ink-secondary"
                        >
                          {rep.initials}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate text-[13px] font-medium text-ink">{rep.name}</p>
                            <span className="shrink-0 text-[13px] tnum text-ink">
                              {money(rep.rollup.grossProfit, { compact: true })}
                            </span>
                          </div>
                          <div className="mt-1">
                            <Meter
                              value={rep.rollup.grossProfit / best}
                              tone={belowFloor ? 'warning' : 'accent'}
                              showOverflow={false}
                            />
                          </div>
                          <p className="mt-1 truncate text-2xs text-ink-muted">
                            {rep.customerIds
                              .map((id) => CHAIN_CUSTOMERS.find((c) => c.id === id)?.name)
                              .filter(Boolean)
                              .join(' · ')}
                            {' · '}
                            <span className={belowFloor ? 'text-warning' : undefined}>
                              {rep.rollup.grossMarginPct !== null
                                ? `${pct(rep.rollup.grossMarginPct)} margin`
                                : '—'}
                            </span>
                            {rep.attainment !== null && ` · ${pct(rep.attainment, 0)} of plan`}
                          </p>
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="border-t border-hairline px-4 py-2 text-2xs text-ink-muted">
              {belowFloorCount > 0 ? (
                <>
                  {belowFloorCount} of {reps.length} territories sit below the margin floor. Club
                  and distributor books carry the heaviest everyday allowances, so check the
                  channel before reading it as a performance verdict.
                </>
              ) : (
                <>
                  Every territory is above the {pct(marginFloor)} margin floor this window.
                  Compare against a longer scope before calling it — the spread between a club
                  book and a natural one is structural, and a short window hides it.
                </>
              )}
            </div>
          </Card>

          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title="Service and quality"
                subtitle={scopeGroup
                  ? 'Whole account — an order carries every product on the truck, so service is not sliced by product'
                  : "What the retailer's supply chain scores us on"}
              />
            </div>
            <ul className="divide-y divide-hairline/60">
              <MetricRow
                label="Case fill rate"
                value={service.fillRate !== null ? pct(service.fillRate) : '—'}
                tone={(service.fillRate ?? 0) >= 0.98 ? 'good' : (service.fillRate ?? 0) >= 0.95 ? 'warning' : 'critical'}
                status={(service.fillRate ?? 0) >= 0.98 ? 'On target' : 'Below 98%'}
              />
              <MetricRow
                label="On time in full"
                value={service.otif !== null ? pct(service.otif) : '—'}
                tone={(service.otif ?? 0) >= 0.95 ? 'good' : 'warning'}
                status={(service.otif ?? 0) >= 0.95 ? 'On target' : 'Fine risk'}
              />
              <MetricRow
                label="Orders shipped"
                value={service.orders > 0 ? fmtUnits(service.orders, true) : '—'}
                tone="neutral"
                status={SCOPE_LABEL[scope]}
              />
              <MetricRow
                label="Average drop size"
                value={service.dropSize !== null ? money(service.dropSize) : '—'}
                tone="neutral"
                status="net of allowances"
              />
              <MetricRow
                label="Lines per order"
                value={service.linesPerOrder !== null ? service.linesPerOrder.toFixed(1) : '—'}
                tone="neutral"
                status="assortment depth"
              />
              <MetricRow
                label="Deductions per 100 invoices"
                value={service.orders > 0 ? ((credits.count / service.orders) * 100).toFixed(1) : '—'}
                tone={credits.unresolved > 0 ? 'warning' : 'good'}
                status={`${credits.unresolved} unresolved`}
              />
              <MetricRow
                label="Finished goods days of supply"
                value={service.daysOfSupply !== null ? `${service.daysOfSupply.toFixed(0)} days` : '—'}
                tone={(service.daysOfSupply ?? 0) > 50 ? 'warning' : 'good'}
                status={(service.daysOfSupply ?? 0) > 50 ? 'Heavy' : 'Healthy'}
              />
            </ul>
          </Card>
        </div>

        <Card padded={false} className="overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-2.5">
            <SectionHeader
              title={scopeGroup ? `Accounts needing attention · ${scopeGroup}` : 'Accounts needing attention'}
              subtitle={scopeGroup
                ? `Volume and margin are checked within ${scopeGroup}. Plan, deduction and assortment checks are account-level and pause under a product lens.`
                : 'One finding per account — the most serious one. A panel that says the same thing three ways is a panel people stop reading.'}
            />
            <Badge tone={signals.length > 0 ? 'warning' : 'good'}>
              {signals.length} flagged
            </Badge>
          </div>

          {signals.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-ink">Nothing is off track</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-muted">
                Every account is within tolerance on volume, margin, plan and deduction exposure
                for this window. Widen the scope or clear the customer filter to look further back.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {signals.map((s) => {
                const copy = SIGNAL_COPY[s.kind]
                const tone: Tone =
                  s.kind === 'assortment_gap' ? 'accent'
                    : s.severity >= 0.66 ? 'critical'
                      : s.severity >= 0.35 ? 'serious' : 'warning'
                return (
                  <li key={`${s.customerId}-${s.kind}`}>
                    <button
                      onClick={() => setChain(s.customerId === chain ? 'all' : s.customerId)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-sunken"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{s.name}</p>
                        <p className="truncate text-2xs text-ink-muted">{copy.action}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2.5">
                        <span className="text-xs tnum text-ink-secondary">
                          {copy.describe(s.value, s.reference)}
                        </span>
                        <Badge tone={tone}>{copy.label}</Badge>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2">
            <p className="text-2xs leading-relaxed text-ink-muted">
              Thresholds are relative to this book, not absolute: volume −
              {pct(DEFAULT_ATTENTION.volumeDrop, 0)} vs last year, margin{' '}
              {pct(DEFAULT_ATTENTION.marginFloorGap, 0)} below the company rate, plan −
              {pct(DEFAULT_ATTENTION.planShortfall, 0)}, at-risk deductions{' '}
              {pct(DEFAULT_ATTENTION.deductionGap, 1)} above the company's own exposure rate.
            </p>
            <Link
              to="/deductions"
              className="inline-flex shrink-0 items-center gap-1 text-2xs font-medium text-accent hover:underline"
            >
              Work the deduction queue <ArrowRight size={11} />
            </Link>
          </div>
        </Card>

        <div className="flex flex-wrap items-start gap-2.5 rounded-lg bg-surface px-4 py-3 ring-1 ring-hairline">
          <Gauge size={14} className="mt-0.5 shrink-0 text-ink-muted" />
          <p className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-muted">
            <span className="font-medium text-ink-secondary">How these numbers are built.</span>{' '}
            Net sales is gross less allowances taken at invoice less claimed trade money
            straight-lined across each event's on-shelf weeks. It reconciles to the gross-to-net
            waterfall on{' '}
            <Link to="/analytics" className="text-accent hover:underline">Trade analytics</Link>{' '}
            with two differences we can name: that screen also carries unrecovered invalid
            deductions inside net sales (here they are reported separately, above), and it books
            each event whole rather than by elapsed week. Volume on deal counts only cases that
            shipped inside a promotion window, which is why it sits so far below the trade rate
            beside it — most trade money here is everyday off-invoice allowance that never appears
            on a promotion calendar. Fill rate, drop size and payment terms are seeded assumptions;
            the order counts, receivables and margins derived from them move when the underlying
            volume moves. Clicking a product group focuses everything additive — sales, profit,
            cases, the leaderboard, the attention checks on volume and margin — while plan,
            deductions, receivables and service stay at account level and say so, because none of
            them lands on a single product. Every figure on this page is synthetic sample data for
            a fictional manufacturer — nothing here is a real commercial record.
          </p>
        </div>
      </PageBody>
    </>
  )
}

// ── Row primitives ─────────────────────────────────────────────────────────

function MetricRow({
  label, value, tone, status,
}: {
  label: string
  value: string
  tone: Tone
  status: string
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="min-w-0 truncate text-[13px] text-ink-secondary">{label}</span>
      <span className="flex shrink-0 items-center gap-2.5">
        <span className="text-[13px] tnum text-ink">{value}</span>
        <Badge tone={tone}>{status}</Badge>
      </span>
    </li>
  )
}

const SIGNAL_COPY: Record<
  AccountSignalKind,
  { label: string; action: string; describe: (value: number, reference: number) => string }
> = {
  volume_decline: {
    label: 'Volume',
    action: 'Book a business review — find out what changed on shelf',
    describe: (v) => `${delta(v)} vs last year`,
  },
  margin_below_floor: {
    label: 'Margin',
    action: 'Reprice or re-mix — the trade rate here is running ahead of the value back',
    describe: (v, ref) => `${pct(v)} · ${((ref - v) * 100).toFixed(1)} pts below floor`,
  },
  plan_shortfall: {
    label: 'Plan',
    action: 'Recovery plan for the balance of the period',
    describe: (v, ref) => `${pct(v, 0)} of plan · ${money(ref * (1 - v), { compact: true })} behind`,
  },
  deduction_exposure: {
    label: 'Deductions',
    action: 'Chargebacks the engine cannot tie to an event — recover or write off',
    describe: (v, ref) => `${money(v, { compact: true })} at risk · ${pct(ref, 1)} of annual sales`,
  },
  assortment_gap: {
    label: 'Cross-sell',
    action: 'Buying a narrow slice of the range — the gap is the pitch',
    describe: (v, ref) => `${Math.round(v)} of ${Math.round(ref)} product groups`,
  },
}
