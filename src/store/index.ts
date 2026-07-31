/**
 * Application store.
 *
 * The dataset is seeded once and held in memory. Matching is NOT baked into
 * the seed — it runs through the real engine on load, so what the demo shows
 * is genuine algorithm output. Change a tolerance in the settings panel and
 * every confidence score moves, which is the point.
 */

import { create } from 'zustand'
import type {
  Deduction, DeductionMatch, Dispute, Promotion, PromotionLine, PromotionStatus,
} from '../data/types'
import { getDataset, DEMO_TODAY } from '../data/seed'
import {
  DEFAULT_MATCH_OPTIONS, disposition, matchDeduction,
  type MatchCandidate, type MatchDisposition, type MatchOptions,
} from '../lib/calc/matching'
import {
  brandIndex, claimableSpendIndex, plannedSpendIndex, tacticIndex,
} from '../data/seed/sales'
import {
  applyRecommendation, bulkScaleDriver, buildRecommendations, setDriver,
  type DriverField, type ForecastRecommendation,
} from '../lib/calc/forecast'
import { n4 } from '../lib/calc/money'
import { addDays } from '../lib/fiscal'

export type Theme = 'light' | 'dark'

interface MatchState {
  candidates: MatchCandidate[]
  disposition: MatchDisposition
  /** Set once a user accepts or rejects — this is what drives the queue. */
  resolved?: 'accepted' | 'rejected'
  acceptedPromotionId?: string
}

interface AppState {
  today: string
  dataset: ReturnType<typeof getDataset>
  matchOptions: MatchOptions
  matchesByDeduction: Map<string, MatchState>
  theme: Theme

  // derived indexes, rebuilt whenever promotion lines change
  plannedSpend: Map<string, number>
  claimableSpend: Map<string, number>
  tacticsByPromotion: Map<string, string[]>
  brandsByPromotion: Map<string, string[]>

  toast: { id: number; message: string; tone: 'good' | 'critical' | 'neutral' } | null

  /** Recomputed from the live forecast lines, never stored stale. */
  recommendations: ForecastRecommendation[]
  dismissedRecommendations: Set<string>

  // actions
  setTheme: (t: Theme) => void
  showToast: (message: string, tone?: 'good' | 'critical' | 'neutral') => void
  dismissToast: () => void
  setMatchOptions: (o: Partial<MatchOptions>) => void
  rerunMatching: () => void
  acceptMatch: (deductionId: string, promotionId: string) => void
  rejectMatch: (deductionId: string) => void
  openDispute: (deductionId: string, reason: string) => void
  resolveDispute: (disputeId: string, outcome: 'won' | 'partial' | 'lost', recovered: number) => void
  updateLine: (lineId: string, patch: Partial<PromotionLine>) => void
  /** Bulk swap for one promotion — what undo/redo and clipboard paste use. */
  replaceLines: (promotionId: string, lines: PromotionLine[]) => void
  addLine: (promotionId: string, productId: string) => void
  removeLine: (lineId: string) => void
  setPromotionStatus: (promotionId: string, status: PromotionStatus, note?: string) => void
  movePromotion: (promotionId: string, deltaWeeks: number) => void
  resizePromotion: (promotionId: string, deltaWeeks: number) => void

  // ── forecast ──
  /** Edit one driver on one leaf line for one period. */
  setForecastDriver: (lineId: string, periodKey: string, field: DriverField, value: number) => void
  /** Scale a driver across a selection — the post-range-review bulk move. */
  bulkScaleForecast: (
    lineIds: string[], periodKeys: string[], field: DriverField, factor: number,
  ) => void
  acceptRecommendation: (recommendationId: string) => void
  dismissRecommendation: (recommendationId: string) => void

  resetDemo: () => void
}

interface MatchIndexes {
  plannedSpend: Map<string, number>
  /** Spend that can legitimately be charged back — what the matcher scores against. */
  claimableSpend: Map<string, number>
  tacticsByPromotion: Map<string, string[]>
  brandsByPromotion: Map<string, string[]>
}

function runMatching(
  dataset: ReturnType<typeof getDataset>,
  options: MatchOptions,
  indexes: MatchIndexes,
  previous?: Map<string, MatchState>,
): Map<string, MatchState> {
  const out = new Map<string, MatchState>()
  const ctx = {
    customers: dataset.customers,
    reasonCodes: dataset.reasonCodes,
    claimableSpendByPromotion: indexes.claimableSpend,
    tacticsByPromotion: indexes.tacticsByPromotion,
    brandsByPromotion: indexes.brandsByPromotion,
  }

  for (const d of dataset.deductions) {
    const candidates = matchDeduction(d, dataset.promotions, ctx, options)
    const prior = previous?.get(d.id)
    out.set(d.id, {
      candidates,
      disposition: disposition(candidates, options),
      resolved: prior?.resolved,
      acceptedPromotionId: prior?.acceptedPromotionId,
    })
  }
  return out
}

function buildIndexes(lines: PromotionLine[]): MatchIndexes {
  return {
    plannedSpend: plannedSpendIndex(lines),
    claimableSpend: claimableSpendIndex(lines),
    tacticsByPromotion: tacticIndex(lines),
    brandsByPromotion: brandIndex(lines),
  }
}

function initialState() {
  const dataset = getDataset()
  const indexes = buildIndexes(dataset.promotionLines)
  return {
    dataset,
    ...indexes,
    matchesByDeduction: runMatching(dataset, DEFAULT_MATCH_OPTIONS, indexes),
    recommendations: buildRecommendations(
      dataset.forecast.lines, dataset.forecast.periods, dataset.forecast.signals,
    ),
    dismissedRecommendations: new Set<string>(),
  }
}

/**
 * Recommendations are always derived from the CURRENT lines. Recomputing on
 * every edit is what makes the queue drain visibly as a planner works — a
 * cached list would keep proposing changes that have already been made.
 */
function withForecastLines(
  s: AppState,
  lines: AppState['dataset']['forecast']['lines'],
) {
  const forecast = { ...s.dataset.forecast, lines }
  return {
    dataset: { ...s.dataset, forecast },
    recommendations: buildRecommendations(lines, forecast.periods, forecast.signals),
  }
}

let toastId = 0

export const useStore = create<AppState>((set, get) => ({
  today: DEMO_TODAY,
  ...initialState(),
  matchOptions: DEFAULT_MATCH_OPTIONS,
  theme: (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light',
  toast: null,

  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    try {
      localStorage.setItem('tw.theme', theme)
    } catch {
      /* private browsing — the demo still works, it just won't remember */
    }
    set({ theme })
  },

  showToast: (message, tone = 'neutral') => {
    const id = ++toastId
    set({ toast: { id, message, tone } })
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null })
    }, 4200)
  },
  dismissToast: () => set({ toast: null }),

  setMatchOptions: (o) => {
    const matchOptions = { ...get().matchOptions, ...o }
    set({ matchOptions })
    get().rerunMatching()
  },

  rerunMatching: () => {
    const s = get()
    set({
      matchesByDeduction: runMatching(
        s.dataset,
        s.matchOptions,
        {
          plannedSpend: s.plannedSpend,
          claimableSpend: s.claimableSpend,
          tacticsByPromotion: s.tacticsByPromotion,
          brandsByPromotion: s.brandsByPromotion,
        },
        s.matchesByDeduction,
      ),
    })
  },

  acceptMatch: (deductionId, promotionId) => {
    const s = get()
    const state = s.matchesByDeduction.get(deductionId)
    const candidate = state?.candidates.find((c) => c.promotionId === promotionId)
    if (!candidate) return

    const match: DeductionMatch = {
      id: `dm_${deductionId}_${promotionId}`,
      orgId: s.dataset.org.id,
      deductionId,
      promotionId,
      amount: candidate.amount,
      confidence: candidate.confidence,
      matchedBy: 'user',
      reasons: candidate.reasons,
      accepted: true,
    }

    const matches = [...s.dataset.matches.filter((m) => m.deductionId !== deductionId), match]
    const deductions = s.dataset.deductions.map((d) =>
      d.id === deductionId ? { ...d, status: 'matched' as const } : d,
    )

    const next = new Map(s.matchesByDeduction)
    next.set(deductionId, { ...state!, resolved: 'accepted', acceptedPromotionId: promotionId })

    set({
      dataset: { ...s.dataset, matches, deductions },
      matchesByDeduction: next,
    })
    s.showToast(`Matched to ${candidate.promotionCode}`, 'good')
  },

  rejectMatch: (deductionId) => {
    const s = get()
    const state = s.matchesByDeduction.get(deductionId)
    if (!state) return
    const next = new Map(s.matchesByDeduction)
    next.set(deductionId, { ...state, resolved: 'rejected', acceptedPromotionId: undefined })

    const deductions = s.dataset.deductions.map((d) =>
      d.id === deductionId ? { ...d, status: 'review' as const } : d,
    )
    set({ dataset: { ...s.dataset, deductions }, matchesByDeduction: next })
    s.showToast('Match rejected — deduction returned to the review queue')
  },

  openDispute: (deductionId, reason) => {
    const s = get()
    const d = s.dataset.deductions.find((x) => x.id === deductionId)
    if (!d) return
    if (s.dataset.disputes.some((x) => x.deductionId === deductionId)) {
      s.showToast('A dispute is already open on this deduction', 'critical')
      return
    }

    const dispute: Dispute = {
      id: `dsp_new_${deductionId}`,
      orgId: s.dataset.org.id,
      deductionId,
      reason,
      openedAt: s.today,
      openedById: 'u_priya',
      status: 'open',
      claimedAmount: d.amount,
      recoveredAmount: 0,
      correspondence: [{ at: s.today, author: 'Cascade Pantry', note: `Dispute opened. ${reason}` }],
    }

    set({
      dataset: {
        ...s.dataset,
        disputes: [...s.dataset.disputes, dispute],
        deductions: s.dataset.deductions.map((x) =>
          x.id === deductionId ? { ...x, status: 'disputed' as const } : x,
        ),
      },
    })
    s.showToast(`Dispute opened for ${d.docNumber}`, 'good')
  },

  resolveDispute: (disputeId, outcome, recovered) => {
    const s = get()
    const disputes = s.dataset.disputes.map((x) =>
      x.id === disputeId
        ? {
            ...x,
            status: outcome,
            recoveredAmount: n4(recovered),
            closedAt: s.today,
            correspondence: [
              ...x.correspondence,
              { at: s.today, author: 'Retailer AP', note: `Dispute resolved: ${outcome}.` },
            ],
          }
        : x,
    )
    const target = disputes.find((x) => x.id === disputeId)
    const deductions = target
      ? s.dataset.deductions.map((d) =>
          d.id === target.deductionId
            ? { ...d, status: (outcome === 'lost' ? 'written_off' : 'recovered') as Deduction['status'] }
            : d,
        )
      : s.dataset.deductions

    set({ dataset: { ...s.dataset, disputes, deductions } })
    s.showToast(
      outcome === 'lost' ? 'Dispute closed — written off' : `Recovered ${recovered.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`,
      outcome === 'lost' ? 'critical' : 'good',
    )
  },

  updateLine: (lineId, patch) => {
    const s = get()
    const promotionLines = s.dataset.promotionLines.map((l) =>
      l.id === lineId ? { ...l, ...patch } : l,
    )
    set({
      dataset: { ...s.dataset, promotionLines },
      ...buildIndexes(promotionLines),
    })
  },

  replaceLines: (promotionId, lines) => {
    const s = get()
    const promotionLines = [
      ...s.dataset.promotionLines.filter((l) => l.promotionId !== promotionId),
      ...lines,
    ]
    set({
      dataset: { ...s.dataset, promotionLines },
      ...buildIndexes(promotionLines),
    })
  },

  addLine: (promotionId, productId) => {
    const s = get()
    const sibling = s.dataset.promotionLines.find((l) => l.promotionId === promotionId)
    const line: PromotionLine = {
      id: `pl_new_${Date.now()}_${Math.round(performance.now())}`,
      orgId: s.dataset.org.id,
      promotionId,
      productId,
      tactic: sibling?.tactic ?? 'tpr',
      rateType: sibling?.rateType ?? 'per_case',
      rate: sibling?.rate ?? 2.5,
      plannedBaselineUnits: 0,
      plannedLiftUnits: 0,
    }
    const promotionLines = [...s.dataset.promotionLines, line]
    set({ dataset: { ...s.dataset, promotionLines }, ...buildIndexes(promotionLines) })
  },

  removeLine: (lineId) => {
    const s = get()
    const promotionLines = s.dataset.promotionLines.filter((l) => l.id !== lineId)
    set({ dataset: { ...s.dataset, promotionLines }, ...buildIndexes(promotionLines) })
  },

  setPromotionStatus: (promotionId, status, note) => {
    const s = get()
    const current = s.dataset.promotions.find((p) => p.id === promotionId)
    if (!current) return

    const promotions = s.dataset.promotions.map((p) =>
      p.id === promotionId
        ? {
            ...p,
            status,
            submittedAt: status === 'submitted' ? s.today : p.submittedAt,
            approvedAt: status === 'approved' ? s.today : p.approvedAt,
            approvedBy: status === 'approved' ? 'u_marcus' : p.approvedBy,
          }
        : p,
    )
    const statusEvents = [
      ...s.dataset.statusEvents,
      {
        id: `se_new_${promotionId}_${s.dataset.statusEvents.length}`,
        promotionId,
        from: current.status,
        to: status,
        at: `${s.today}T12:00:00Z`,
        actorId: 'u_priya',
        note,
      },
    ]
    const auditLog = [
      {
        id: `au_new_${s.dataset.auditLog.length}`,
        orgId: s.dataset.org.id,
        entity: 'trade.promotions',
        entityId: promotionId,
        action: 'status_change' as const,
        field: 'status',
        oldValue: current.status,
        newValue: status,
        actorId: 'u_priya',
        at: `${s.today}T12:00:00Z`,
        reason: note,
      },
      ...s.dataset.auditLog,
    ]

    set({ dataset: { ...s.dataset, promotions, statusEvents, auditLog } })
    s.showToast(`${current.code} → ${status}`, status === 'approved' ? 'good' : 'neutral')
  },

  movePromotion: (promotionId, deltaWeeks) => {
    const s = get()
    const days = deltaWeeks * 7
    const promotions = s.dataset.promotions.map((p) =>
      p.id === promotionId
        ? {
            ...p,
            buyStart: addDays(p.buyStart, days),
            buyEnd: addDays(p.buyEnd, days),
            shipStart: addDays(p.shipStart, days),
            shipEnd: addDays(p.shipEnd, days),
            performStart: addDays(p.performStart, days),
            performEnd: addDays(p.performEnd, days),
          }
        : p,
    )
    set({ dataset: { ...s.dataset, promotions } })
  },

  resizePromotion: (promotionId, deltaWeeks) => {
    const s = get()
    const promotions = s.dataset.promotions.map((p) => {
      if (p.id !== promotionId) return p
      const nextEnd = addDays(p.performEnd, deltaWeeks * 7)
      if (nextEnd < p.performStart) return p
      return { ...p, performEnd: nextEnd, shipEnd: addDays(p.shipEnd, deltaWeeks * 7) }
    })
    set({ dataset: { ...s.dataset, promotions } })
  },

  setForecastDriver: (lineId, periodKey, field, value) => {
    const s = get()
    const lines = s.dataset.forecast.lines.map((l) =>
      l.id === lineId ? setDriver(l, periodKey, field, value) : l,
    )
    set(withForecastLines(s, lines))
  },

  bulkScaleForecast: (lineIds, periodKeys, field, factor) => {
    const s = get()
    const lines = bulkScaleDriver(
      s.dataset.forecast.lines, new Set(lineIds), periodKeys, field, factor,
    )
    set(withForecastLines(s, lines))
    const pct = `${factor >= 1 ? '+' : ''}${((factor - 1) * 100).toFixed(1)}%`
    s.showToast(
      `${pct} applied to ${lineIds.length} line${lineIds.length === 1 ? '' : 's'} across ${periodKeys.length} period${periodKeys.length === 1 ? '' : 's'}`,
      'good',
    )
  },

  acceptRecommendation: (recommendationId) => {
    const s = get()
    const rec = s.recommendations.find((r) => r.id === recommendationId)
    if (!rec) return
    const lines = applyRecommendation(s.dataset.forecast.lines, rec)
    set(withForecastLines(s, lines))
    s.showToast(
      `Applied — forecast moves ${rec.impactUnits >= 0 ? '+' : ''}${Math.round(rec.impactUnits).toLocaleString('en-US')} cs`,
      'good',
    )
  },

  dismissRecommendation: (recommendationId) => {
    const s = get()
    const next = new Set(s.dismissedRecommendations)
    next.add(recommendationId)
    set({ dismissedRecommendations: next })
  },

  resetDemo: () => {
    set({ ...initialState(), matchOptions: DEFAULT_MATCH_OPTIONS })
    get().showToast('Demo data reset', 'good')
  },
}))

// ── Stable selector helpers ────────────────────────────────────────────────

export const selectPromotionById = (id: string) => (s: AppState) =>
  s.dataset.promotions.find((p) => p.id === id)

export const selectLinesFor = (promotionId: string) => (s: AppState) =>
  s.dataset.promotionLines.filter((l) => l.promotionId === promotionId)

export const selectDeductionById = (id: string) => (s: AppState) =>
  s.dataset.deductions.find((d) => d.id === id)

export function useToday() {
  return useStore((s) => s.today)
}

export type { Promotion, Deduction, MatchState }
