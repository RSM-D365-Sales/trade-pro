/**
 * UI primitives.
 *
 * Everything here reads its colour from the token layer in index.css — no
 * ad-hoc hex values anywhere in the app. Status tones always ship an icon or a
 * label alongside the colour, never colour alone.
 */

import { clsx } from 'clsx'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle, type LucideIcon,
} from 'lucide-react'
import {
  createContext, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
} from 'react'

export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'accent'

const TONE_ICON: Record<Exclude<Tone, 'neutral' | 'accent'>, LucideIcon> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  serious: AlertTriangle,
  critical: XCircle,
}

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-good',
  warning: 'text-warning',
  serious: 'text-serious',
  critical: 'text-critical',
  neutral: 'text-ink-secondary',
  accent: 'text-accent',
}

const TONE_CHIP: Record<Tone, string> = {
  good: 'bg-good/10 text-good ring-good/25',
  warning: 'bg-warning/15 text-warning ring-warning/30',
  serious: 'bg-serious/12 text-serious ring-serious/30',
  critical: 'bg-critical/10 text-critical ring-critical/25',
  neutral: 'bg-sunken text-ink-secondary ring-hairline',
  accent: 'bg-accent-soft text-accent-ink ring-accent/20',
}

// ── Button ─────────────────────────────────────────────────────────────────

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  icon?: LucideIcon
}

export function Button({
  variant = 'secondary', size = 'md', icon: Icon, className, children, ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-ink',
        variant === 'secondary' &&
          'bg-raised text-ink ring-1 ring-hairline hover:bg-sunken',
        variant === 'ghost' && 'text-ink-secondary hover:bg-sunken hover:text-ink',
        variant === 'danger' && 'bg-critical text-white hover:brightness-95',
        className,
      )}
    >
      {Icon && <Icon size={size === 'sm' ? 13 : 14} strokeWidth={2} />}
      {children}
    </button>
  )
}

// ── Badge / status ─────────────────────────────────────────────────────────

export function Badge({
  tone = 'neutral', children, icon: Icon, className,
}: {
  tone?: Tone
  children: ReactNode
  icon?: LucideIcon
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset whitespace-nowrap',
        TONE_CHIP[tone], className,
      )}
    >
      {Icon && <Icon size={11} strokeWidth={2.2} />}
      {children}
    </span>
  )
}

/** Status colour always paired with its icon and label — never colour alone. */
export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  const Icon = tone === 'neutral' || tone === 'accent' ? Info : TONE_ICON[tone]
  return <Badge tone={tone} icon={Icon}>{label}</Badge>
}

// ── Surfaces ───────────────────────────────────────────────────────────────

export function Card({
  className, children, padded = true,
}: {
  className?: string
  children: ReactNode
  padded?: boolean
}) {
  return (
    <section
      className={clsx(
        'rounded-lg bg-surface ring-1 ring-hairline shadow-card',
        padded && 'p-4',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function SectionHeader({
  title, subtitle, actions, className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}

/**
 * Empty states are first-class, not an afterthought: every one says what would
 * be here and what to do about it.
 */
export function EmptyState({
  icon: Icon, title, hint, action,
}: {
  icon: LucideIcon
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-sunken p-2.5 text-ink-muted">
        <Icon size={18} strokeWidth={1.7} />
      </div>
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-ink-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

// ── Stat tile ──────────────────────────────────────────────────────────────

export function StatTile({
  label, value, delta, deltaTone = 'neutral', hint, accent, onClick, active,
}: {
  label: string
  value: ReactNode
  delta?: string
  deltaTone?: Tone
  hint?: string
  accent?: string
  onClick?: () => void
  active?: boolean
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={clsx(
        'relative overflow-hidden rounded-lg bg-surface p-3.5 text-left ring-1 shadow-card transition-colors',
        onClick && 'hover:bg-raised',
        active ? 'ring-accent' : 'ring-hairline',
      )}
    >
      {accent && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] rounded-r"
          style={{ background: accent }}
        />
      )}
      <p className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink">{value}</p>
      <div className="mt-1.5 flex items-center gap-1.5">
        {delta && (
          <span className={clsx('text-2xs font-medium tnum', TONE_TEXT[deltaTone])}>{delta}</span>
        )}
        {hint && <span className="text-2xs text-ink-muted">{hint}</span>}
      </div>
    </Wrapper>
  )
}

// ── Meters ─────────────────────────────────────────────────────────────────

export function Meter({
  value, tone = 'accent', label, showOverflow = true,
}: {
  /** 0..1+, values over 1 render an overflow segment. */
  value: number
  tone?: Tone
  label?: string
  showOverflow?: boolean
}) {
  const pct = Math.max(0, Math.min(1, value))
  const over = Math.max(0, value - 1)
  const fill =
    tone === 'critical' ? 'var(--status-critical)'
      : tone === 'warning' ? 'var(--status-warning)'
        : tone === 'good' ? 'var(--status-good)'
          : tone === 'serious' ? 'var(--status-serious)'
            : 'var(--accent)'

  return (
    <div className="flex items-center gap-2">
      <div
        className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-sunken"
        role="meter"
        aria-valuenow={Math.round(value * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct * 100}%`, background: fill }}
        />
        {showOverflow && over > 0 && (
          // 2px surface gap keeps the overflow segment legible against the fill.
          <span
            className="absolute inset-y-0 rounded-full"
            style={{
              left: `calc(${pct * 100}% + 2px)`,
              width: `${Math.min(1, over) * 30}%`,
              background: 'var(--status-critical)',
            }}
          />
        )}
      </div>
      {label && <span className="w-10 shrink-0 text-right text-2xs tnum text-ink-muted">{label}</span>}
    </div>
  )
}

// ── Form controls ──────────────────────────────────────────────────────────

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={clsx(
        'h-8 w-full rounded-md bg-raised px-2.5 text-[13px] text-ink ring-1 ring-hairline',
        'placeholder:text-ink-muted focus:ring-accent',
        className,
      )}
    />
  )
}

export function Select<T extends string>({
  value, onChange, options, className, ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={clsx('relative', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 w-full appearance-none rounded-md bg-raised pl-2.5 pr-7 text-[13px] text-ink ring-1 ring-hairline focus:ring-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-muted"
      />
    </div>
  )
}

export function Toggle({
  checked, onChange, label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-secondary">
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-baseline/60',
        )}
        style={!checked ? { background: 'var(--baseline)' } : undefined}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5',
          )}
        />
      </button>
      {label}
    </label>
  )
}

/** Segmented control — the filter pattern used above every chart. */
export function Segmented<T extends string>({
  value, onChange, options, size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  size?: 'sm' | 'md'
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-sunken p-0.5 ring-1 ring-hairline">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded px-2 font-medium transition-colors',
            size === 'sm' ? 'h-6 text-2xs' : 'h-7 text-xs',
            value === o.value
              ? 'bg-surface text-ink shadow-card ring-1 ring-hairline'
              : 'text-ink-muted hover:text-ink-secondary',
          )}
        >
          {o.label}
          {o.count !== undefined && (
            <span className={clsx('tnum', value === o.value ? 'text-ink-muted' : 'text-ink-muted/70')}>
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ── Tooltip ────────────────────────────────────────────────────────────────

export function InfoTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        aria-label="More information"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-ink-muted hover:text-ink-secondary"
      >
        <Info size={12} strokeWidth={2} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-md bg-surface p-2 text-2xs leading-relaxed text-ink-secondary shadow-pop ring-1 ring-hairline"
        >
          {children}
        </span>
      )}
    </span>
  )
}

// ── Drawer ─────────────────────────────────────────────────────────────────

const DrawerCtx = createContext<() => void>(() => {})
export const useCloseDrawer = () => useContext(DrawerCtx)

export function Drawer({
  open, onClose, title, subtitle, children, footer, width = 'lg',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg' | 'xl'
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <DrawerCtx.Provider value={onClose}>
      <div className="fixed inset-0 z-40 flex justify-end">
        <div
          className="absolute inset-0 bg-black/25 animate-fade-in"
          onClick={onClose}
          aria-hidden
        />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={typeof title === 'string' ? title : 'Details'}
          className={clsx(
            'relative flex h-full flex-col bg-plane shadow-pop ring-1 ring-hairline animate-slide-up outline-none',
            width === 'md' && 'w-full max-w-md',
            width === 'lg' && 'w-full max-w-2xl',
            width === 'xl' && 'w-full max-w-4xl',
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-hairline px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold tracking-tight text-ink">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && (
            <footer className="border-t border-hairline bg-surface px-4 py-3">{footer}</footer>
          )}
        </div>
      </div>
    </DrawerCtx.Provider>
  )
}

// ── Misc ───────────────────────────────────────────────────────────────────

export function KeyValue({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="shrink-0 text-xs text-ink-muted">{label}</dt>
      <dd className={clsx('min-w-0 truncate text-right text-[13px] text-ink', mono && 'tnum')}>
        {children}
      </dd>
    </div>
  )
}

export function Divider({ label }: { label?: string }) {
  if (!label) return <hr className="my-3 border-hairline" />
  return (
    <div className="my-3 flex items-center gap-2">
      <hr className="flex-1 border-hairline" />
      <span className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</span>
      <hr className="flex-1 border-hairline" />
    </div>
  )
}

export { TONE_TEXT, TONE_CHIP }
