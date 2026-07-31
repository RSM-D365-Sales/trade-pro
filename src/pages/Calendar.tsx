/**
 * Trade calendar — customer × week Gantt.
 *
 * Bars are draggable to move an event and have a resize handle on the trailing
 * edge to extend it. Both snap to whole weeks, because retail promotions do.
 * Overlap detection runs live: two events on the same customer touching the
 * same SKU in the same week get flagged as you drag, not at approval time.
 */

import { clsx } from 'clsx'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { PageBody, PageHeader } from '../components/PageHeader'
import { Badge, Button, Card, EmptyState, Segmented, Select, StatusBadge } from '../components/ui'
import { TACTICS, tacticColor, tacticName } from '../data/tactics'
import type { Promotion, TacticCode } from '../data/types'
import { money } from '../lib/calc/money'
import { addWeeks, diffWeeks, formatShortDate, rangesOverlap, weekStartOf } from '../lib/fiscal'
import { useStore } from '../store'
import { useLookups, usePromotionEconomics } from '../store/selectors'

const ROW_H = 30
const LABEL_W = 168
const MIN_WEEK_W = 26

type Density = 16 | 26 | 40

export function CalendarPage() {
  const navigate = useNavigate()
  const dataset = useStore((s) => s.dataset)
  const today = useStore((s) => s.today)
  const movePromotion = useStore((s) => s.movePromotion)
  const resizePromotion = useStore((s) => s.resizePromotion)
  const { customersById, productsById } = useLookups()
  const economics = usePromotionEconomics()

  const [weekWidth, setWeekWidth] = useState<Density>(26)
  const [brand, setBrand] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [anchorWeek, setAnchorWeek] = useState(() => weekStartOf(addWeeks(today, -6)))
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'resize'; startX: number; delta: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const weeksShown = 34
  const weeks = useMemo(
    () => Array.from({ length: weeksShown }, (_, i) => addWeeks(anchorWeek, i)),
    [anchorWeek],
  )
  const windowStart = weeks[0]
  const windowEnd = addWeeks(weeks[weeks.length - 1], 1)

  const brands = useMemo(
    () => [...new Set(dataset.products.map((p) => p.brand))],
    [dataset.products],
  )

  const linesByPromo = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const l of dataset.promotionLines) {
      const arr = m.get(l.promotionId)
      if (arr) arr.push(l.productId)
      else m.set(l.promotionId, [l.productId])
    }
    return m
  }, [dataset.promotionLines])

  const visible = useMemo(() => {
    return dataset.promotions.filter((p) => {
      if (p.status === 'cancelled') return false
      if (!rangesOverlap(p.performStart, p.performEnd, windowStart, windowEnd)) return false
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (brand !== 'all') {
        const ids = linesByPromo.get(p.id) ?? []
        if (!ids.some((pid) => productsById.get(pid)?.brand === brand)) return false
      }
      return true
    })
  }, [dataset.promotions, windowStart, windowEnd, statusFilter, brand, linesByPromo, productsById])

  /** One lane per customer, with rows split when bars would collide. */
  const lanes = useMemo(() => {
    const byCustomer = new Map<string, Promotion[]>()
    for (const p of visible) {
      const arr = byCustomer.get(p.customerId)
      if (arr) arr.push(p)
      else byCustomer.set(p.customerId, [p])
    }

    return [...byCustomer.entries()]
      .map(([customerId, promos]) => {
        const sorted = [...promos].sort((a, b) => a.performStart.localeCompare(b.performStart))
        const rows: Promotion[][] = []
        for (const p of sorted) {
          const row = rows.find(
            (r) => !r.some((q) => rangesOverlap(q.performStart, q.performEnd, p.performStart, p.performEnd)),
          )
          if (row) row.push(p)
          else rows.push([p])
        }
        return { customerId, name: customersById.get(customerId)?.name ?? '—', rows }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [visible, customersById])

  /** SKU-level collisions, computed live so a drag surfaces them immediately. */
  const conflicts = useMemo(() => {
    const flagged = new Set<string>()
    for (const lane of lanes) {
      const promos = lane.rows.flat()
      for (let i = 0; i < promos.length; i++) {
        for (let j = i + 1; j < promos.length; j++) {
          const a = promos[i]
          const b = promos[j]
          if (!rangesOverlap(a.performStart, a.performEnd, b.performStart, b.performEnd)) continue
          const aSkus = new Set(linesByPromo.get(a.id) ?? [])
          if ((linesByPromo.get(b.id) ?? []).some((s) => aSkus.has(s))) {
            flagged.add(a.id)
            flagged.add(b.id)
          }
        }
      }
    }
    return flagged
  }, [lanes, linesByPromo])

  const xOf = (date: string) => diffWeeks(windowStart, weekStartOf(date)) * weekWidth
  const totalW = weeksShown * weekWidth

  // ── Drag handling ──────────────────────────────────────────────────────
  const onPointerDown = (
    e: React.PointerEvent,
    promotionId: string,
    mode: 'move' | 'resize',
  ) => {
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    setDrag({ id: promotionId, mode, startX: e.clientX, delta: 0 })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const delta = Math.round((e.clientX - drag.startX) / weekWidth)
    if (delta !== drag.delta) setDrag({ ...drag, delta })
  }

  const onPointerUp = () => {
    if (!drag) return
    if (drag.delta !== 0) {
      if (drag.mode === 'move') movePromotion(drag.id, drag.delta)
      else resizePromotion(drag.id, drag.delta)
    }
    setDrag(null)
  }

  const todayX = xOf(today)

  return (
    <>
      <PageHeader
        title="Trade calendar"
        description="Drag a bar to move an event, drag its right edge to extend it. Both snap to whole retail weeks. Bars outlined in red share a SKU with an overlapping event on the same customer."
        filters={
          <>
            <div className="flex items-center gap-1">
              <Button
                size="sm" variant="ghost" icon={ChevronLeft}
                onClick={() => setAnchorWeek(addWeeks(anchorWeek, -8))}
                aria-label="Earlier"
              >
                Earlier
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => setAnchorWeek(weekStartOf(addWeeks(today, -6)))}
              >
                Today
              </Button>
              <Button
                size="sm" variant="ghost"
                onClick={() => setAnchorWeek(addWeeks(anchorWeek, 8))}
                aria-label="Later"
              >
                Later <ChevronRight size={13} />
              </Button>
            </div>
            <Select
              ariaLabel="Filter by brand" className="w-44" value={brand} onChange={setBrand}
              options={[{ value: 'all', label: 'All brands' }, ...brands.map((b) => ({ value: b, label: b }))]}
            />
            <Select
              ariaLabel="Filter by status" className="w-36" value={statusFilter} onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'Any status' },
                { value: 'draft', label: 'Draft' },
                { value: 'submitted', label: 'Submitted' },
                { value: 'approved', label: 'Approved' },
                { value: 'active', label: 'Active' },
                { value: 'closed', label: 'Closed' },
              ]}
            />
            <Segmented<string>
              size="sm"
              value={String(weekWidth)}
              onChange={(v) => setWeekWidth(Number(v) as Density)}
              options={[
                { value: '16', label: 'Year' },
                { value: '26', label: 'Quarter' },
                { value: '40', label: 'Weeks' },
              ]}
            />
          </>
        }
      />

      <PageBody>
        <Card padded={false} className="overflow-hidden">
          {/* Tactic legend — identity is never carried by colour alone. */}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-hairline px-4 py-2">
            {TACTICS.filter((t) => tacticColor(t.code) !== 'var(--text-muted)').map((t) => (
              <span key={t.code} className="flex items-center gap-1.5 text-2xs text-ink-secondary">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-[2px]"
                  style={{ background: tacticColor(t.code) }}
                />
                {t.name}
              </span>
            ))}
            <span className="flex items-center gap-1.5 text-2xs text-ink-secondary">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-ink-muted" />
              Other tactics
            </span>
          </div>

          {lanes.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title="No events in this window"
              hint="Nothing is planned for the selected weeks, brand and status. Move the window or clear a filter."
              action={
                <Button size="sm" onClick={() => { setBrand('all'); setStatusFilter('all') }}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div
              ref={scrollRef}
              className="overflow-auto"
              style={{ maxHeight: 'calc(100vh - 300px)' }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <div style={{ minWidth: LABEL_W + totalW }}>
                {/* Week ruler */}
                <div className="sticky top-0 z-20 flex border-b border-hairline bg-surface">
                  <div
                    style={{ width: LABEL_W }}
                    className="shrink-0 border-r border-hairline px-3 py-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted"
                  >
                    Customer
                  </div>
                  <div className="relative" style={{ width: totalW }}>
                    <div className="flex">
                      {weeks.map((w, i) => (
                        <div
                          key={w}
                          style={{ width: weekWidth }}
                          className={clsx(
                            'shrink-0 border-r border-hairline/50 py-1.5 text-center text-2xs text-ink-muted',
                            weekWidth < MIN_WEEK_W && i % 4 !== 0 && 'text-transparent',
                          )}
                        >
                          {weekWidth >= MIN_WEEK_W || i % 4 === 0 ? formatShortDate(w) : '·'}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Lanes */}
                <div className="relative">
                  {/* Today marker spans every lane. */}
                  {todayX >= 0 && todayX <= totalW && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute top-0 z-10 h-full w-px bg-accent"
                      style={{ left: LABEL_W + todayX }}
                    />
                  )}

                  {lanes.map((lane) => (
                    <div key={lane.customerId} className="flex border-b border-hairline/60">
                      <div
                        style={{ width: LABEL_W }}
                        className="shrink-0 border-r border-hairline px-3 py-2 text-[13px] text-ink"
                      >
                        <p className="truncate font-medium">{lane.name}</p>
                        <p className="text-2xs text-ink-muted">
                          {lane.rows.flat().length} event{lane.rows.flat().length === 1 ? '' : 's'}
                        </p>
                      </div>

                      <div
                        className="relative overflow-hidden"
                        style={{ width: totalW, minHeight: ROW_H }}
                      >
                        {/* Week gridlines */}
                        <div aria-hidden className="absolute inset-0 flex">
                          {weeks.map((w) => (
                            <div
                              key={w}
                              style={{ width: weekWidth }}
                              className="shrink-0 border-r border-hairline/30"
                            />
                          ))}
                        </div>

                        {lane.rows.map((row, ri) => (
                          <div key={ri} style={{ height: ROW_H }} className="relative">
                            {row.map((p) => {
                              const dragging = drag?.id === p.id
                              const shift = dragging && drag.mode === 'move' ? drag.delta * weekWidth : 0
                              const stretch = dragging && drag.mode === 'resize' ? drag.delta * weekWidth : 0
                              // An event that began before the visible window
                              // would otherwise render at a negative offset and
                              // escape the lane, covering the sticky customer
                              // label. Clip it to the window at both ends.
                              const rawX = xOf(p.performStart) + shift
                              const rawW = Math.max(
                                weekWidth,
                                xOf(p.performEnd) - xOf(p.performStart) + weekWidth + stretch,
                              )
                              const x = Math.max(0, rawX)
                              const clippedLeft = x - rawX
                              const w = Math.max(
                                6,
                                Math.min(rawW - clippedLeft, totalW - x),
                              )
                              const tactic = (dataset.promotionLines.find((l) => l.promotionId === p.id)?.tactic
                                ?? 'tpr') as TacticCode
                              const spend = economics.get(p.id)?.spend ?? 0
                              const conflicted = conflicts.has(p.id)

                              return (
                                <div
                                  key={p.id}
                                  role="button"
                                  tabIndex={0}
                                  onPointerDown={(e) => onPointerDown(e, p.id, 'move')}
                                  onDoubleClick={() => navigate(`/promotions/${p.id}`)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') navigate(`/promotions/${p.id}`)
                                    if (e.key === 'ArrowLeft' && e.shiftKey) movePromotion(p.id, -1)
                                    if (e.key === 'ArrowRight' && e.shiftKey) movePromotion(p.id, 1)
                                  }}
                                  title={`${p.code} — ${p.name}\n${formatShortDate(p.performStart)} – ${formatShortDate(p.performEnd)}\n${money(spend)} planned spend${conflicted ? '\n⚠ SKU conflict with an overlapping event' : ''}\nDouble-click to open`}
                                  className={clsx(
                                    'group absolute top-1 flex h-[22px] cursor-grab items-center gap-1 overflow-hidden rounded px-1.5 text-2xs font-medium text-white active:cursor-grabbing',
                                    dragging && 'z-30 opacity-90 shadow-pop',
                                    p.status === 'draft' && 'opacity-70',
                                  )}
                                  style={{
                                    left: x,
                                    width: w,
                                    background: tacticColor(tactic),
                                    // 2px surface ring separates adjacent bars.
                                    boxShadow: conflicted
                                      ? 'inset 0 0 0 2px var(--status-critical)'
                                      : '0 0 0 1px var(--surface-1)',
                                  }}
                                >
                                  <span className="truncate">
                                    {weekWidth >= MIN_WEEK_W ? p.code.replace(/^PRM-/, '') : ''}
                                  </span>
                                  {/* Resize handle on the trailing edge. */}
                                  <span
                                    onPointerDown={(e) => onPointerDown(e, p.id, 'resize')}
                                    className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/0 transition-colors group-hover:bg-black/20"
                                    aria-hidden
                                  />
                                </div>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>

        {conflicts.size > 0 && (
          <Card>
            <div className="flex items-start gap-2">
              <StatusBadge tone="critical" label={`${conflicts.size} conflicts`} />
              <p className="text-xs leading-relaxed text-ink-secondary">
                These events share at least one SKU with another promotion running at the same
                customer in the same weeks. Overlapping deals on the same item double-fund the
                retailer and make post-event lift impossible to attribute.
              </p>
            </div>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          {visible.slice(0, 6).map((p) => (
            <Badge key={p.id} tone={conflicts.has(p.id) ? 'critical' : 'neutral'}>
              {p.code} · {tacticName(
                (dataset.promotionLines.find((l) => l.promotionId === p.id)?.tactic ?? 'tpr') as TacticCode,
              )}
            </Badge>
          ))}
        </div>
      </PageBody>
    </>
  )
}
