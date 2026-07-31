import { clsx } from 'clsx'
import type { ReactNode } from 'react'

export function PageHeader({
  title, description, actions, filters, className,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Filters live in one row directly above the content they affect. */
  filters?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx('border-b border-hairline bg-surface px-5 py-3.5', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-ink">{title}</h1>
          {description && (
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-ink-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {filters && <div className="mt-3 flex flex-wrap items-center gap-2">{filters}</div>}
    </div>
  )
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('space-y-4 p-5', className)}>{children}</div>
}
