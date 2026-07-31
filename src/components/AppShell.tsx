/**
 * Application shell: sidebar, top bar, command palette, toast host.
 *
 * The sidebar order is the demo order — Deductions sits directly under the
 * dashboard because that is the screen the sales motion leads with.
 */

import { clsx } from 'clsx'
import {
  BadgeDollarSign, BarChart3, CalendarRange, Command, LayoutDashboard, LineChart, Moon,
  ReceiptText, Search, Settings2, Sun, Table2, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'

import { useStore } from '../store'
import { Badge, Button } from './ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/deductions', label: 'Deductions', icon: ReceiptText, badge: 'queue' as const },
  { to: '/promotions', label: 'Promotions', icon: Table2 },
  { to: '/calendar', label: 'Trade calendar', icon: CalendarRange },
  { to: '/forecast', label: 'Forecast', icon: LineChart },
  { to: '/funds', label: 'Trade funds', icon: BadgeDollarSign },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/settings', label: 'Settings', icon: Settings2 },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const org = useStore((s) => s.dataset.org)

  const queueCount = useStore((s) => {
    let n = 0
    for (const m of s.matchesByDeduction.values()) {
      if (m.resolved) continue
      if (m.disposition === 'needs_review' || m.disposition === 'likely_invalid') n++
    }
    return n
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full">
      <aside className="flex w-[212px] shrink-0 flex-col border-r border-hairline bg-surface">
        <div className="flex h-12 items-center gap-2 border-b border-hairline px-3.5">
          <Logo />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-tight tracking-tight text-ink">
              Tradewind
            </p>
            <p className="truncate text-2xs leading-tight text-ink-muted">Trade Promotion Mgmt</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-accent-soft text-accent-ink'
                    : 'text-ink-secondary hover:bg-sunken hover:text-ink',
                )
              }
            >
              <item.icon size={15} strokeWidth={1.9} />
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge === 'queue' && queueCount > 0 && (
                <Badge tone="warning">{queueCount}</Badge>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-hairline p-2.5">
          <div className="rounded-md bg-sunken px-2.5 py-2">
            <p className="truncate text-2xs font-medium text-ink">{org.name}</p>
            <p className="mt-0.5 text-2xs text-ink-muted">
              {org.fiscalCalendar} · {org.baseCurrency}
            </p>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-hairline bg-surface px-4">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-7 w-full max-w-sm items-center gap-2 rounded-md bg-sunken px-2.5 text-xs text-ink-muted ring-1 ring-hairline transition-colors hover:text-ink-secondary"
          >
            <Search size={13} />
            <span className="flex-1 text-left">Search promotions, customers, deductions…</span>
            <kbd className="flex items-center gap-0.5 rounded bg-raised px-1 py-0.5 text-2xs text-ink-muted ring-1 ring-hairline">
              <Command size={9} />K
            </kbd>
          </button>

          <div className="flex shrink-0 items-center gap-2">
            <Badge tone="accent">Demo data</Badge>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="rounded p-1.5 text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <div
              className="grid h-7 w-7 place-items-center rounded-full bg-accent text-2xs font-semibold text-white"
              title="Priya Nadkarni — Key Account Manager"
            >
              PN
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto bg-plane">{children}</main>
      </div>

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      <ToastHost />
    </div>
  )
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <rect width="24" height="24" rx="6" fill="var(--accent)" />
      <path
        d="M5.5 15.5c2.6 0 2.6-3.4 5.2-3.4s2.6 3.4 5.2 3.4 2.6-3.4 2.6-3.4"
        stroke="#fff" strokeWidth="1.7" strokeLinecap="round" fill="none"
      />
      <path
        d="M5.5 10.2c2.6 0 2.6-2.6 5.2-2.6s2.6 2.6 5.2 2.6 2.6-2.6 2.6-2.6"
        stroke="#fff" strokeWidth="1.7" strokeLinecap="round" fill="none" opacity="0.55"
      />
    </svg>
  )
}

// ── Command palette ────────────────────────────────────────────────────────

interface PaletteItem {
  id: string
  label: string
  hint: string
  group: string
  to: string
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [cursor, setCursor] = useState(0)

  const dataset = useStore((s) => s.dataset)

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = NAV.map((n) => ({
      id: `nav-${n.to}`, label: n.label, hint: 'Navigate', group: 'Pages', to: n.to,
    }))
    const promos: PaletteItem[] = dataset.promotions.slice(0, 400).map((p) => ({
      id: p.id,
      label: `${p.code} — ${p.name}`,
      hint: dataset.customers.find((c) => c.id === p.customerId)?.name ?? '',
      group: 'Promotions',
      to: `/promotions/${p.id}`,
    }))
    const deds: PaletteItem[] = dataset.deductions.slice(0, 400).map((d) => ({
      id: d.id,
      label: d.docNumber,
      hint: `${d.description} · $${d.amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`,
      group: 'Deductions',
      to: `/deductions?open=${d.id}`,
    }))
    const custs: PaletteItem[] = dataset.customers
      .filter((c) => c.level === 'chain')
      .map((c) => ({
        id: c.id, label: c.name, hint: `${c.channel} · ${c.code}`, group: 'Customers',
        to: `/analytics?customer=${c.id}`,
      }))
    return [...nav, ...custs, ...promos, ...deds]
  }, [dataset])

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items.filter((i) => i.group === 'Pages')
    return items
      .filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(needle))
      .slice(0, 24)
  }, [items, q])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => setCursor(0), [q])

  const go = (item: PaletteItem) => {
    navigate(item.to)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl overflow-hidden rounded-xl bg-surface shadow-pop ring-1 ring-hairline animate-slide-up"
      >
        <div className="flex items-center gap-2 border-b border-hairline px-3">
          <Search size={14} className="text-ink-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(results.length - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter' && results[cursor]) {
                go(results[cursor])
              } else if (e.key === 'Escape') {
                onClose()
              }
            }}
            placeholder="Search promotions, deductions, customers…"
            className="h-11 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          <button onClick={onClose} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X size={14} />
          </button>
        </div>

        <ul className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-ink-muted">
              Nothing matches “{q}”. Try a promotion code, a chargeback number, or a customer.
            </li>
          )}
          {results.map((r, i) => (
            <li key={r.id}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left',
                  i === cursor ? 'bg-accent-soft' : 'hover:bg-sunken',
                )}
              >
                <span className="w-[72px] shrink-0 text-2xs uppercase tracking-wide text-ink-muted">
                  {r.group}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{r.label}</span>
                <span className="hidden max-w-[38%] shrink-0 truncate text-2xs text-ink-muted sm:block">
                  {r.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ── Toasts ─────────────────────────────────────────────────────────────────

function ToastHost() {
  const toast = useStore((s) => s.toast)
  const dismiss = useStore((s) => s.dismissToast)
  if (!toast) return null

  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] -translate-x-1/2">
      <div
        role="status"
        className={clsx(
          'pointer-events-auto flex items-center gap-2.5 rounded-lg px-3.5 py-2 text-[13px] shadow-pop ring-1 animate-slide-up',
          toast.tone === 'good' && 'bg-surface text-ink ring-good/30',
          toast.tone === 'critical' && 'bg-surface text-ink ring-critical/30',
          toast.tone === 'neutral' && 'bg-surface text-ink ring-hairline',
        )}
      >
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background:
              toast.tone === 'good' ? 'var(--status-good)'
                : toast.tone === 'critical' ? 'var(--status-critical)'
                  : 'var(--text-muted)',
          }}
        />
        {toast.message}
        <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss">✕</Button>
      </div>
    </div>
  )
}
