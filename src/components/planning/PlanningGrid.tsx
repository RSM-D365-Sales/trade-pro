/**
 * The planning grid.
 *
 * Planners come from Excel. If this grid is worse than Excel they will export
 * to Excel, plan there, and paste back — and the product loses. So it supports
 * the muscle memory that actually matters: arrow-key navigation, type-to-edit,
 * Enter/Tab commit-and-move, shift-click range selection, Ctrl+C / Ctrl+V over
 * a range as TSV, Ctrl+D fill-down, Delete to clear, and Ctrl+Z / Ctrl+Shift+Z
 * undo across all of it.
 *
 * Computed columns recalculate through packages/calc on every keystroke — the
 * same functions the nightly job uses, so the preview cannot drift from the
 * posted number.
 */

import { clsx } from 'clsx'
import { Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import {
  useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent,
} from 'react'

import { TACTICS } from '../../data/tactics'
import type { Product, PromotionLine, RateType, TacticCode } from '../../data/types'
import { money, pct } from '../../lib/calc/money'
import { computeLine, type LineEconomics } from '../../lib/calc/promotion'
import { Button, Select } from '../ui'

type EditableKey = 'tactic' | 'rateType' | 'rate' | 'plannedBaselineUnits' | 'plannedLiftUnits'

interface ColumnSpec {
  key: EditableKey | string
  label: string
  width: number
  editable: boolean
  numeric: boolean
  kind?: 'number' | 'tactic' | 'rateType'
}

const COLUMNS: ColumnSpec[] = [
  { key: 'product', label: 'Product', width: 230, editable: false, numeric: false },
  { key: 'tactic', label: 'Tactic', width: 150, editable: true, numeric: false, kind: 'tactic' },
  { key: 'rateType', label: 'Rate type', width: 116, editable: true, numeric: false, kind: 'rateType' },
  { key: 'rate', label: 'Rate', width: 88, editable: true, numeric: true, kind: 'number' },
  { key: 'plannedBaselineUnits', label: 'Baseline cs', width: 96, editable: true, numeric: true, kind: 'number' },
  { key: 'plannedLiftUnits', label: 'Lift cs', width: 84, editable: true, numeric: true, kind: 'number' },
  { key: 'totalUnits', label: 'Total cs', width: 88, editable: false, numeric: true },
  { key: 'spend', label: 'Spend', width: 96, editable: false, numeric: true },
  { key: 'grossRevenue', label: 'Revenue', width: 104, editable: false, numeric: true },
  { key: 'totalMargin', label: 'Margin', width: 96, editable: false, numeric: true },
  { key: 'roi', label: 'ROI', width: 78, editable: false, numeric: true },
]

const RATE_TYPES: RateType[] = ['per_case', 'pct_of_list', 'lump_sum', 'per_unit']
const RATE_TYPE_LABEL: Record<RateType, string> = {
  per_case: '$ / case',
  pct_of_list: '% of list',
  lump_sum: 'Lump sum',
  per_unit: '$ / unit',
}

interface Cell {
  row: number
  col: number
}

export function PlanningGrid({
  lines, productById, availableProducts, onChange, onAddLine,
}: {
  lines: PromotionLine[]
  productById: Map<string, Product>
  availableProducts: Product[]
  onChange: (lines: PromotionLine[]) => void
  onAddLine: (productId: string) => void
}) {
  const [focus, setFocus] = useState<Cell>({ row: 0, col: 1 })
  const [anchor, setAnchor] = useState<Cell>({ row: 0, col: 1 })
  const [editing, setEditing] = useState<{ cell: Cell; draft: string } | null>(null)
  const [history, setHistory] = useState<PromotionLine[][]>([])
  const [future, setFuture] = useState<PromotionLine[][]>([])
  const [status, setStatus] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const economics = useMemo(() => {
    const out = new Map<string, LineEconomics>()
    for (const l of lines) {
      const p = productById.get(l.productId)
      if (p) out.set(l.id, computeLine(l, p))
    }
    return out
  }, [lines, productById])

  const commit = useCallback(
    (next: PromotionLine[], note?: string) => {
      setHistory((h) => [...h.slice(-49), lines])
      setFuture([])
      onChange(next)
      if (note) {
        setStatus(note)
        window.setTimeout(() => setStatus(null), 2200)
      }
    },
    [lines, onChange],
  )

  // onChange writes to the store, so it must NOT be called from inside a state
  // updater — those run during React's render phase, and updating another
  // component from there is the "Cannot update a component while rendering a
  // different component" warning. Read the stacks directly instead.
  const undo = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(history.slice(0, -1))
    setFuture([lines, ...future])
    onChange(prev)
  }, [history, future, lines, onChange])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[0]
    setFuture(future.slice(1))
    setHistory([...history, lines])
    onChange(next)
  }, [history, future, lines, onChange])

  // ── Cell value read / write ────────────────────────────────────────────

  const readCell = (line: PromotionLine, col: number): string => {
    const spec = COLUMNS[col]
    const econ = economics.get(line.id)
    switch (spec.key) {
      case 'product': return productById.get(line.productId)?.name ?? ''
      case 'tactic': return line.tactic
      case 'rateType': return line.rateType
      case 'rate': return String(line.rate)
      case 'plannedBaselineUnits': return String(line.plannedBaselineUnits)
      case 'plannedLiftUnits': return String(line.plannedLiftUnits)
      case 'totalUnits': return String(econ?.totalUnits ?? 0)
      case 'spend': return String(econ?.spend ?? 0)
      case 'grossRevenue': return String(econ?.grossRevenue ?? 0)
      case 'totalMargin': return String(econ?.totalMargin ?? 0)
      case 'roi': return econ?.roi === null || econ?.roi === undefined ? '' : String(econ.roi)
      default: return ''
    }
  }

  const writeCell = (line: PromotionLine, col: number, raw: string): PromotionLine => {
    const spec = COLUMNS[col]
    if (!spec.editable) return line
    const text = raw.trim()

    switch (spec.key) {
      case 'tactic': {
        const hit = TACTICS.find(
          (t) => t.code === text || t.name.toLowerCase() === text.toLowerCase(),
        )
        return hit ? { ...line, tactic: hit.code as TacticCode } : line
      }
      case 'rateType': {
        const hit = RATE_TYPES.find(
          (r) => r === text || RATE_TYPE_LABEL[r].toLowerCase() === text.toLowerCase(),
        )
        return hit ? { ...line, rateType: hit } : line
      }
      case 'rate': {
        // Accept "12%", "$1.50", "1,200" — planners paste all three.
        const isPct = text.includes('%')
        const n = Number(text.replace(/[$,%\s]/g, ''))
        if (!Number.isFinite(n)) return line
        const value = isPct && line.rateType === 'pct_of_list' ? n / 100 : n
        return { ...line, rate: Math.max(0, value) }
      }
      case 'plannedBaselineUnits':
      case 'plannedLiftUnits': {
        const n = Number(text.replace(/[,\s]/g, ''))
        if (!Number.isFinite(n)) return line
        return { ...line, [spec.key]: Math.max(0, Math.round(n)) } as PromotionLine
      }
      default:
        return line
    }
  }

  const formatCell = (line: PromotionLine, col: number): string => {
    const spec = COLUMNS[col]
    const econ = economics.get(line.id)
    switch (spec.key) {
      case 'tactic': return TACTICS.find((t) => t.code === line.tactic)?.name ?? line.tactic
      case 'rateType': return RATE_TYPE_LABEL[line.rateType]
      case 'rate':
        return line.rateType === 'pct_of_list'
          ? `${(line.rate * 100).toFixed(1)}%`
          : line.rateType === 'lump_sum'
            ? money(line.rate)
            : `$${line.rate.toFixed(2)}`
      case 'plannedBaselineUnits': return line.plannedBaselineUnits.toLocaleString('en-US')
      case 'plannedLiftUnits': return line.plannedLiftUnits.toLocaleString('en-US')
      case 'totalUnits': return (econ?.totalUnits ?? 0).toLocaleString('en-US')
      case 'spend': return money(econ?.spend ?? 0)
      case 'grossRevenue': return money(econ?.grossRevenue ?? 0)
      case 'totalMargin': return money(econ?.totalMargin ?? 0)
      case 'roi': return econ?.roi === null || econ?.roi === undefined ? '—' : pct(econ.roi, 0)
      default: return readCell(line, col)
    }
  }

  // ── Selection ──────────────────────────────────────────────────────────

  const range = useMemo(() => {
    const r1 = Math.min(anchor.row, focus.row)
    const r2 = Math.max(anchor.row, focus.row)
    const c1 = Math.min(anchor.col, focus.col)
    const c2 = Math.max(anchor.col, focus.col)
    return { r1, r2, c1, c2 }
  }, [anchor, focus])

  const inRange = (row: number, col: number) =>
    row >= range.r1 && row <= range.r2 && col >= range.c1 && col <= range.c2

  const move = (dRow: number, dCol: number, extend: boolean) => {
    const row = Math.max(0, Math.min(lines.length - 1, focus.row + dRow))
    let col = Math.max(0, Math.min(COLUMNS.length - 1, focus.col + dCol))
    // Skip the read-only product column when moving horizontally.
    if (dCol !== 0 && col === 0) col = 1
    const next = { row, col }
    setFocus(next)
    if (!extend) setAnchor(next)
  }

  // ── Clipboard ──────────────────────────────────────────────────────────

  const copyRange = useCallback(async () => {
    const tsv: string[] = []
    for (let r = range.r1; r <= range.r2; r++) {
      const cols: string[] = []
      for (let c = range.c1; c <= range.c2; c++) cols.push(formatCell(lines[r], c))
      tsv.push(cols.join('\t'))
    }
    const text = tsv.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setStatus(`Copied ${range.r2 - range.r1 + 1} × ${range.c2 - range.c1 + 1}`)
    } catch {
      setStatus('Clipboard blocked by the browser')
    }
    window.setTimeout(() => setStatus(null), 1800)
  }, [range, lines, formatCell])

  const pasteFrom = useCallback(
    (text: string) => {
      const matrix = text.replace(/\r/g, '').split('\n').filter(Boolean).map((r) => r.split('\t'))
      if (matrix.length === 0) return
      const next = [...lines]
      let applied = 0

      matrix.forEach((cells, ri) => {
        const rowIdx = focus.row + ri
        if (rowIdx >= next.length) return
        cells.forEach((value, ci) => {
          const colIdx = focus.col + ci
          if (colIdx >= COLUMNS.length || !COLUMNS[colIdx].editable) return
          const updated = writeCell(next[rowIdx], colIdx, value)
          if (updated !== next[rowIdx]) {
            next[rowIdx] = updated
            applied += 1
          }
        })
      })

      if (applied > 0) commit(next, `Pasted ${applied} cell${applied === 1 ? '' : 's'}`)
      else setStatus('Nothing pasted — those columns are calculated')
    },
    [lines, focus, commit],
  )

  const fillDown = useCallback(() => {
    if (range.r1 === range.r2) return
    const next = [...lines]
    let applied = 0
    for (let c = range.c1; c <= range.c2; c++) {
      if (!COLUMNS[c].editable) continue
      const source = readCell(next[range.r1], c)
      for (let r = range.r1 + 1; r <= range.r2; r++) {
        const updated = writeCell(next[r], c, source)
        if (updated !== next[r]) {
          next[r] = updated
          applied += 1
        }
      }
    }
    if (applied > 0) commit(next, `Filled ${applied} cell${applied === 1 ? '' : 's'} down`)
  }, [lines, range, commit])

  const clearRange = useCallback(() => {
    const next = [...lines]
    let applied = 0
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        if (!COLUMNS[c].editable || COLUMNS[c].kind !== 'number') continue
        const updated = writeCell(next[r], c, '0')
        if (updated !== next[r]) {
          next[r] = updated
          applied += 1
        }
      }
    }
    if (applied > 0) commit(next, `Cleared ${applied} cell${applied === 1 ? '' : 's'}`)
  }, [lines, range, commit])

  // ── Keyboard ───────────────────────────────────────────────────────────

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return
    const mod = e.metaKey || e.ctrlKey

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.shiftKey ? redo() : undo()
      return
    }
    if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault()
      void copyRange()
      return
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      fillDown()
      return
    }
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setAnchor({ row: 0, col: 1 })
      setFocus({ row: lines.length - 1, col: COLUMNS.length - 1 })
      return
    }

    switch (e.key) {
      case 'ArrowUp': e.preventDefault(); move(-1, 0, e.shiftKey); break
      case 'ArrowDown': e.preventDefault(); move(1, 0, e.shiftKey); break
      case 'ArrowLeft': e.preventDefault(); move(0, -1, e.shiftKey); break
      case 'ArrowRight': e.preventDefault(); move(0, 1, e.shiftKey); break
      case 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1, false); break
      case 'Enter':
        e.preventDefault()
        if (COLUMNS[focus.col].editable) {
          setEditing({ cell: focus, draft: readCell(lines[focus.row], focus.col) })
        } else {
          move(1, 0, false)
        }
        break
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        clearRange()
        break
      default:
        // Type-to-edit, exactly like a spreadsheet.
        if (!mod && e.key.length === 1 && COLUMNS[focus.col].editable) {
          setEditing({ cell: focus, draft: COLUMNS[focus.col].kind === 'number' ? e.key : '' })
        }
    }
  }

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const onPaste = (e: ClipboardEvent) => {
      if (!el.contains(document.activeElement)) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      pasteFrom(text)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [pasteFrom])

  const applyEdit = (value: string, then: 'down' | 'right' | 'stay') => {
    if (!editing) return
    const { cell } = editing
    const next = [...lines]
    next[cell.row] = writeCell(next[cell.row], cell.col, value)
    if (next[cell.row] !== lines[cell.row]) commit(next)
    setEditing(null)
    if (then === 'down') move(1, 0, false)
    if (then === 'right') move(0, 1, false)
    gridRef.current?.focus()
  }

  const totalWidth = COLUMNS.reduce((a, c) => a + c.width, 0)

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={Undo2} disabled={history.length === 0} onClick={undo}>
            Undo
          </Button>
          <Button size="sm" variant="ghost" icon={Redo2} disabled={future.length === 0} onClick={redo}>
            Redo
          </Button>
          <span className="mx-1 h-4 w-px bg-hairline" />
          <AddLineControl products={availableProducts} onAdd={onAddLine} />
        </div>
        <div className="flex items-center gap-3">
          {status && <span className="text-2xs text-accent">{status}</span>}
          <span className="hidden text-2xs text-ink-muted lg:block">
            Arrows move · type to edit · Ctrl+C/V · Ctrl+D fill down · Ctrl+Z undo
          </span>
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="grid"
        aria-label="Promotion planning grid"
        aria-rowcount={lines.length}
        className="overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <div style={{ minWidth: totalWidth }}>
          <div className="sticky top-0 z-10 flex border-b border-hairline bg-surface" role="row">
            {COLUMNS.map((c) => (
              <div
                key={c.key}
                role="columnheader"
                style={{ width: c.width }}
                className={clsx(
                  'shrink-0 px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted',
                  c.numeric && 'text-right',
                  !c.editable && c.key !== 'product' && 'bg-sunken/40',
                )}
              >
                {c.label}
              </div>
            ))}
          </div>

          {lines.map((line, r) => {
            const product = productById.get(line.productId)
            const econ = economics.get(line.id)
            const negative = econ?.roi !== null && econ?.roi !== undefined && econ.roi < 0

            return (
              <div key={line.id} role="row" className="flex border-b border-hairline/60">
                {COLUMNS.map((c, ci) => {
                  const selected = inRange(r, ci)
                  const isFocus = focus.row === r && focus.col === ci
                  const isEditing = editing?.cell.row === r && editing.cell.col === ci

                  return (
                    <div
                      key={c.key}
                      role="gridcell"
                      aria-selected={selected}
                      onMouseDown={(e) => {
                        if (e.shiftKey) setFocus({ row: r, col: ci })
                        else {
                          setFocus({ row: r, col: ci })
                          setAnchor({ row: r, col: ci })
                        }
                        gridRef.current?.focus()
                      }}
                      onDoubleClick={() => {
                        if (c.editable) setEditing({ cell: { row: r, col: ci }, draft: readCell(line, ci) })
                      }}
                      style={{ width: c.width }}
                      className={clsx(
                        'relative shrink-0 px-2 py-1 text-[13px]',
                        c.numeric && 'text-right tnum',
                        !c.editable && c.key !== 'product' && 'bg-sunken/30 text-ink-secondary',
                        selected && !isFocus && 'bg-accent-soft',
                        isFocus && 'z-[1] ring-1 ring-inset ring-accent',
                        c.editable ? 'cursor-cell' : 'cursor-default',
                        c.key === 'roi' && negative && 'text-critical',
                      )}
                    >
                      {isEditing ? (
                        <CellEditor
                          spec={c}
                          initial={editing.draft}
                          onCommit={applyEdit}
                          onCancel={() => {
                            setEditing(null)
                            gridRef.current?.focus()
                          }}
                        />
                      ) : c.key === 'product' ? (
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="shrink-0 text-2xs tnum text-ink-muted">{product?.sku}</span>
                          <span className="truncate text-ink">{product?.name}</span>
                        </div>
                      ) : (
                        formatCell(line, ci)
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {lines.length > 0 && (
        <div className="flex items-center justify-between border-t border-hairline px-3 py-1.5">
          <span className="text-2xs text-ink-muted">
            {lines.length} line{lines.length === 1 ? '' : 's'} · rows{' '}
            {range.r1 + 1}–{range.r2 + 1} selected
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={() => {
              const doomed = new Set(lines.slice(range.r1, range.r2 + 1).map((l) => l.id))
              commit(lines.filter((l) => !doomed.has(l.id)), `Removed ${doomed.size} line(s)`)
              setFocus({ row: 0, col: 1 })
              setAnchor({ row: 0, col: 1 })
            }}
          >
            Remove selected rows
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Cell editor ────────────────────────────────────────────────────────────

function CellEditor({
  spec, initial, onCommit, onCancel,
}: {
  spec: ColumnSpec
  initial: string
  onCommit: (value: string, then: 'down' | 'right' | 'stay') => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  if (spec.kind === 'tactic' || spec.kind === 'rateType') {
    const options =
      spec.kind === 'tactic'
        ? TACTICS.map((t) => ({ value: t.code as string, label: t.name }))
        : RATE_TYPES.map((r) => ({ value: r as string, label: RATE_TYPE_LABEL[r] }))
    return (
      <select
        autoFocus
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          onCommit(e.target.value, 'stay')
        }}
        onBlur={() => onCommit(value, 'stay')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
        className="absolute inset-0 h-full w-full bg-raised px-1.5 text-[13px] text-ink outline-none ring-1 ring-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onCommit(value, 'stay')}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(value, 'down')
        } else if (e.key === 'Tab') {
          e.preventDefault()
          onCommit(value, 'right')
        } else if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
        e.stopPropagation()
      }}
      className={clsx(
        'absolute inset-0 h-full w-full bg-raised px-2 text-[13px] text-ink outline-none ring-1 ring-accent',
        spec.numeric && 'text-right tnum',
      )}
    />
  )
}

function AddLineControl({
  products, onAdd,
}: {
  products: Product[]
  onAdd: (productId: string) => void
}) {
  const [value, setValue] = useState('')

  if (products.length === 0) {
    return <span className="text-2xs text-ink-muted">Every SKU in this brand is already on the plan</span>
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select
        ariaLabel="Add a product line"
        className="w-56"
        value={value}
        onChange={setValue}
        options={[
          { value: '', label: 'Add product…' },
          ...products.map((p) => ({ value: p.id, label: `${p.sku} — ${p.name}` })),
        ]}
      />
      <Button
        size="sm"
        icon={Plus}
        disabled={!value}
        onClick={() => {
          onAdd(value)
          setValue('')
        }}
      >
        Add
      </Button>
    </div>
  )
}
