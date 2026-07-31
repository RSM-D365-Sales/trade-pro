/**
 * Trade funds.
 *
 * The point of this screen is that every figure is a fold over the ledger —
 * click any fund and you see the exact transactions that produced its balance.
 * Nothing here is a stored number that could have drifted.
 */

import { BadgeDollarSign, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'

import { BarChart } from '../components/charts/BarChart'
import { PageBody, PageHeader } from '../components/PageHeader'
import {
  Badge, Card, Divider, Drawer, KeyValue, Meter, SectionHeader, Segmented, Select, StatTile,
  StatusBadge,
} from '../components/ui'
import { Column, DataTable } from '../components/ui/DataTable'
import { CHAIN_CUSTOMERS } from '../data/catalog'
import type { Fund, FundTransaction } from '../data/types'
import { utilizationBand } from '../lib/calc/funds'
import { money, pct } from '../lib/calc/money'
import { formatDate } from '../lib/fiscal'
import { useStore } from '../store'
import { useFundBalances, useLookups } from '../store/selectors'

const TXN_TONE: Record<FundTransaction['type'], 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent'> = {
  accrual: 'good',
  carryover: 'accent',
  adjustment: 'warning',
  reversal: 'neutral',
  commitment: 'serious',
  actual: 'critical',
}

export function FundsPage() {
  const dataset = useStore((s) => s.dataset)
  const balances = useFundBalances()
  const { customersById, promotionsById, usersById } = useLookups()

  const [chain, setChain] = useState('all')
  const [typeScope, setTypeScope] = useState<'all' | 'accrual' | 'fixed'>('all')
  const [year, setYear] = useState<string>('all')
  const [openFundId, setOpenFundId] = useState<string | null>(null)

  const years = useMemo(
    () => [...new Set(dataset.funds.map((f) => f.periodStart.slice(0, 4)))].sort().reverse(),
    [dataset.funds],
  )

  const rows = useMemo(() => {
    return dataset.funds
      .filter((f) => (chain === 'all' ? true : f.customerId === chain))
      .filter((f) =>
        typeScope === 'all' ? true : typeScope === 'accrual' ? f.type === 'accrual' : f.type !== 'accrual',
      )
      .filter((f) => (year === 'all' ? true : f.periodStart.slice(0, 4) === year))
      .map((fund) => ({ fund, balance: balances.get(fund.id)! }))
      .filter((r) => r.balance.funded > 0 || r.balance.committed > 0)
  }, [dataset.funds, balances, chain, typeScope, year])

  const totals = useMemo(() => {
    const funded = rows.reduce((a, r) => a + r.balance.funded, 0)
    const committed = rows.reduce((a, r) => a + r.balance.committed, 0)
    const actual = rows.reduce((a, r) => a + r.balance.actual, 0)
    const remaining = rows.reduce((a, r) => a + r.balance.remaining, 0)
    const over = rows.filter((r) => r.balance.overCommitted)
    return { funded, committed, actual, remaining, over }
  }, [rows])

  const utilisationChart = useMemo(
    () =>
      [...rows]
        .sort((a, b) => (b.balance.utilization ?? 0) - (a.balance.utilization ?? 0))
        .slice(0, 12)
        .map((r) => ({
          key: r.fund.id,
          label: r.fund.name.replace(/ — .*/, ''),
          value: r.balance.utilization ?? 0,
          color:
            (r.balance.utilization ?? 0) > 1
              ? 'var(--status-critical)'
              : (r.balance.utilization ?? 0) >= 0.9
                ? 'var(--status-warning)'
                : 'var(--series-1)',
          detail: [
            { label: 'Funded', value: money(r.balance.funded) },
            { label: 'Committed', value: money(r.balance.committed) },
            { label: 'Remaining', value: money(r.balance.remaining) },
          ],
        })),
    [rows],
  )

  const columns: Column<{ fund: Fund; balance: NonNullable<ReturnType<typeof balances.get>> }>[] = [
    {
      key: 'fund', header: 'Fund', sortable: true, sortValue: (r) => r.fund.name,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{r.fund.name}</p>
          <p className="truncate text-2xs text-ink-muted">
            {r.fund.code} · {formatDate(r.fund.periodStart)} – {formatDate(r.fund.periodEnd)}
          </p>
        </div>
      ),
    },
    {
      key: 'type', header: 'Type', width: '118px', sortable: true, sortValue: (r) => r.fund.type,
      render: (r) => (
        <div className="flex flex-col items-start gap-0.5">
          <Badge tone={r.fund.type === 'accrual' ? 'accent' : 'neutral'}>
            {r.fund.type.replace('_', ' ')}
          </Badge>
          {r.fund.accrualRate !== undefined && (
            <span className="text-2xs text-ink-muted">
              {pct(r.fund.accrualRate, 1)} of {r.fund.accrualBasis?.replace('_', ' ')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'funded', header: 'Funded', numeric: true, sortable: true, width: '104px',
      sortValue: (r) => r.balance.funded,
      render: (r) => money(r.balance.funded),
    },
    {
      key: 'committed', header: 'Committed', numeric: true, sortable: true, width: '104px', hideBelow: 'md',
      sortValue: (r) => r.balance.committed,
      render: (r) => money(r.balance.committed),
    },
    {
      key: 'actual', header: 'Settled', numeric: true, sortable: true, width: '104px', hideBelow: 'lg',
      sortValue: (r) => r.balance.actual,
      render: (r) => money(r.balance.actual),
    },
    {
      key: 'remaining', header: 'Remaining', numeric: true, sortable: true, width: '110px',
      sortValue: (r) => r.balance.remaining,
      render: (r) => (
        <span className={r.balance.remaining < 0 ? 'font-medium text-critical' : 'font-medium'}>
          {money(r.balance.remaining)}
        </span>
      ),
    },
    {
      key: 'util', header: 'Utilisation', width: '170px', sortable: true,
      sortValue: (r) => r.balance.utilization ?? 0,
      render: (r) => {
        const band = utilizationBand(r.balance.utilization)
        return (
          <div className="flex flex-col gap-1">
            <Meter
              value={r.balance.utilization ?? 0}
              tone={band.tone}
              label={r.balance.utilization !== null ? pct(r.balance.utilization, 0) : '—'}
            />
            <StatusBadge tone={band.tone} label={band.label} />
          </div>
        )
      },
    },
  ]

  const openFund = openFundId ? dataset.funds.find((f) => f.id === openFundId) : null
  const openBalance = openFundId ? balances.get(openFundId) : null
  const openTxns = useMemo(
    () =>
      openFundId
        ? [...dataset.fundTransactions.filter((t) => t.fundId === openFundId)].sort((a, b) =>
            b.postedAt.localeCompare(a.postedAt),
          )
        : [],
    [dataset.fundTransactions, openFundId],
  )

  return (
    <>
      <PageHeader
        title="Trade funds"
        description="Balances are derived from the transaction ledger on every read — never stored. Open any fund to see the exact postings behind its number."
        filters={
          <>
            <Segmented<'all' | 'accrual' | 'fixed'>
              value={typeScope}
              onChange={setTypeScope}
              options={[
                { value: 'all', label: 'All funds' },
                { value: 'accrual', label: 'Accrual' },
                { value: 'fixed', label: 'Fixed & MDF' },
              ]}
            />
            <Select
              ariaLabel="Filter by customer" className="w-48" value={chain} onChange={setChain}
              options={[
                { value: 'all', label: 'All customers' },
                ...CHAIN_CUSTOMERS.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <Select
              ariaLabel="Filter by year" className="w-32" value={year} onChange={setYear}
              options={[
                { value: 'all', label: 'All years' },
                ...years.map((y) => ({ value: y, label: y })),
              ]}
            />
          </>
        }
      />

      <PageBody>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Funded" value={money(totals.funded, { compact: true })} hint={`${rows.length} funds`} />
          <StatTile label="Committed" value={money(totals.committed, { compact: true })} hint="approved, not yet settled" />
          <StatTile label="Settled" value={money(totals.actual, { compact: true })} hint="money that has left" />
          <StatTile
            label="Remaining"
            value={money(totals.remaining, { compact: true })}
            delta={totals.over.length > 0 ? `${totals.over.length} over-committed` : undefined}
            deltaTone="critical"
            accent={totals.remaining < 0 ? 'var(--status-critical)' : 'var(--status-good)'}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <Card padded={false} className="overflow-hidden">
            <div className="border-b border-hairline px-4 py-2.5">
              <SectionHeader
                title="Fund balances"
                subtitle="Click a fund to drill into its ledger"
              />
            </div>
            <DataTable
              rows={rows}
              columns={columns}
              rowKey={(r) => r.fund.id}
              onRowClick={(r) => setOpenFundId(r.fund.id)}
              selectedKey={openFundId ?? undefined}
              initialSort={{ key: 'funded', dir: 'desc' }}
              maxHeight="calc(100vh - 420px)"
              dense
              emptyIcon={Wallet}
              emptyTitle="No funds in this view"
              emptyHint="No fund matches the current customer, type and year filters."
              rowTone={(r) => (r.balance.overCommitted ? 'var(--status-critical)' : undefined)}
            />
          </Card>

          <BarChart
            title="Utilisation by fund"
            subtitle="Committed plus settled, as a share of what has been funded"
            data={utilisationChart}
            format={(v) => pct(v, 0)}
            labelWidth={130}
            tableValueHead="Utilisation"
            onSelect={setOpenFundId}
            selectedKey={openFundId ?? undefined}
            legend={[
              { label: 'On track', color: 'var(--series-1)' },
              { label: 'Fully committed', color: 'var(--status-warning)' },
              { label: 'Over-committed', color: 'var(--status-critical)' },
            ]}
          />
        </div>
      </PageBody>

      <Drawer
        open={!!openFund}
        onClose={() => setOpenFundId(null)}
        width="lg"
        title={openFund?.name ?? ''}
        subtitle={
          openFund
            ? `${openFund.code} · ${customersById.get(openFund.customerId)?.name} · ${formatDate(openFund.periodStart)} – ${formatDate(openFund.periodEnd)}`
            : ''
        }
      >
        {openFund && openBalance && (
          <div className="space-y-4">
            <Card>
              <SectionHeader
                title="Balance"
                subtitle="Every figure below is a fold over the ledger"
                actions={
                  <StatusBadge
                    tone={utilizationBand(openBalance.utilization).tone}
                    label={utilizationBand(openBalance.utilization).label}
                  />
                }
              />
              <div className="mt-3">
                <Meter
                  value={openBalance.utilization ?? 0}
                  tone={utilizationBand(openBalance.utilization).tone}
                  label={openBalance.utilization !== null ? pct(openBalance.utilization, 0) : '—'}
                />
              </div>
              <dl className="mt-3">
                {openFund.type !== 'accrual' && (
                  <KeyValue label="Budget" mono>{money(openFund.budget ?? 0)}</KeyValue>
                )}
                <KeyValue label="Accruals earned" mono>{money(openBalance.byType.accrual)}</KeyValue>
                <KeyValue label="Carryover in" mono>{money(openBalance.byType.carryover)}</KeyValue>
                <KeyValue label="Adjustments" mono>{money(openBalance.byType.adjustment)}</KeyValue>
                <KeyValue label="Commitment reversals" mono>{money(openBalance.byType.reversal)}</KeyValue>
                <Divider />
                <KeyValue label="Total funded" mono><strong>{money(openBalance.funded)}</strong></KeyValue>
                <KeyValue label="Committed" mono>−{money(openBalance.committed)}</KeyValue>
                <KeyValue label="Settled" mono>−{money(openBalance.actual)}</KeyValue>
                <Divider />
                <KeyValue label="Remaining" mono>
                  <strong className={openBalance.remaining < 0 ? 'text-critical' : ''}>
                    {money(openBalance.remaining)}
                  </strong>
                </KeyValue>
              </dl>
              <p className="mt-2 text-2xs leading-relaxed text-ink-muted">
                Carryover policy: {openFund.carryoverPolicy}
                {openFund.carryoverPolicy === 'capped' && ` at ${money(openFund.carryoverCap ?? 0)}`}
              </p>
            </Card>

            <Card padded={false} className="overflow-hidden">
              <div className="border-b border-hairline px-4 py-2.5">
                <SectionHeader title="Ledger" subtitle={`${openTxns.length} postings, newest first`} />
              </div>
              <DataTable
                rows={openTxns}
                columns={[
                  {
                    key: 'date', header: 'Posted', width: '104px', sortable: true,
                    sortValue: (t) => t.postedAt,
                    render: (t) => formatDate(t.postedAt),
                  },
                  {
                    key: 'type', header: 'Type', width: '112px',
                    render: (t) => <Badge tone={TXN_TONE[t.type]}>{t.type}</Badge>,
                  },
                  {
                    key: 'reason', header: 'Reason',
                    render: (t) => (
                      <div className="min-w-0">
                        <p className="truncate text-ink-secondary">{t.reason ?? '—'}</p>
                        {t.promotionId && (
                          <p className="truncate text-2xs text-ink-muted">
                            {promotionsById.get(t.promotionId)?.code} ·{' '}
                            {usersById.get(t.actorId)?.name ?? t.actorId}
                          </p>
                        )}
                      </div>
                    ),
                  },
                  {
                    key: 'amount', header: 'Amount', numeric: true, width: '108px', sortable: true,
                    sortValue: (t) => t.amount,
                    render: (t) => (
                      <span className={t.amount < 0 ? 'text-critical' : 'text-good'}>
                        {money(t.amount, { cents: true })}
                      </span>
                    ),
                  },
                ]}
                rowKey={(t) => t.id}
                maxHeight="380px"
                dense
                emptyIcon={BadgeDollarSign}
                emptyTitle="No postings yet"
                emptyHint="This fund has not accrued or committed anything in the selected period."
              />
            </Card>
          </div>
        )}
      </Drawer>
    </>
  )
}
