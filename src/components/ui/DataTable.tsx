/**
 * Read-only data grid: sortable, sticky-headed, keyboard reachable.
 *
 * Deliberately not virtualised — the largest list the app shows is a few
 * hundred rows and virtualisation would cost more in scroll-anchoring bugs
 * than it saves. The editable planning grid is a separate component with
 * different requirements entirely.
 */

import { clsx } from 'clsx'
import { ArrowDown, ArrowUp, ChevronsUpDown, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { EmptyState } from './index'

export interface Column<T> {
  key: string
  header: ReactNode
  /** Right-align and tabular-figure numeric columns. */
  numeric?: boolean
  width?: string
  sortable?: boolean
  /** Value used for sorting; falls back to the rendered cell when omitted. */
  sortValue?: (row: T) => string | number
  render: (row: T) => ReactNode
  /** Hide below this breakpoint to keep dense tables usable on narrow screens. */
  hideBelow?: 'sm' | 'md' | 'lg'
}

interface DataTableProps<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  selectedKey?: string
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyHint?: string
  emptyAction?: ReactNode
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  maxHeight?: string
  dense?: boolean
  /** Optional row-level tint, e.g. to flag an exception. */
  rowTone?: (row: T) => string | undefined
}

const HIDE_CLASS = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
} as const

export function DataTable<T>({
  rows, columns, rowKey, onRowClick, selectedKey, emptyIcon, emptyTitle, emptyHint,
  emptyAction, initialSort, maxHeight, dense = false, rowTone,
}: DataTableProps<T>) {
  const [sort, setSort] = useState(initialSort ?? null)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sortValue) return rows
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
      return String(av).localeCompare(String(bv)) * dir
    })
  }, [rows, columns, sort])

  const toggleSort = (key: string) => {
    setSort((cur) =>
      cur?.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    )
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={emptyIcon} title={emptyTitle} hint={emptyHint} action={emptyAction} />
    )
  }

  return (
    <div className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key
              const Icon = !active ? ChevronsUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown
              return (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={clsx(
                    'whitespace-nowrap border-b border-hairline bg-surface px-2.5 py-2 text-2xs font-semibold uppercase tracking-wide text-ink-muted',
                    c.numeric ? 'text-right' : 'text-left',
                    c.hideBelow && HIDE_CLASS[c.hideBelow],
                  )}
                >
                  {c.sortable ? (
                    <button
                      onClick={() => toggleSort(c.key)}
                      className={clsx(
                        'inline-flex items-center gap-1 hover:text-ink-secondary',
                        c.numeric && 'flex-row-reverse',
                        active && 'text-ink-secondary',
                      )}
                    >
                      {c.header}
                      <Icon size={11} strokeWidth={2} className={active ? '' : 'opacity-40'} />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row)
            const tone = rowTone?.(row)
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                className={clsx(
                  'border-b border-hairline/60 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-sunken',
                  selectedKey === key && 'bg-accent-soft hover:bg-accent-soft',
                )}
                style={tone ? { boxShadow: `inset 3px 0 0 ${tone}` } : undefined}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={clsx(
                      'px-2.5 align-middle text-ink',
                      dense ? 'py-1.5' : 'py-2',
                      c.numeric && 'text-right tnum',
                      c.hideBelow && HIDE_CLASS[c.hideBelow],
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
