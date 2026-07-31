/**
 * Deterministic PRNG (mulberry32).
 *
 * The demo must produce byte-identical data on every load — a presenter who
 * refreshes mid-demo cannot have the numbers move under them, and verify.mjs
 * asserts against fixed anchor values. Never use Math.random() in seed code.
 */
export function makeRng(seed: number) {
  let a = seed >>> 0

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  return {
    /** [0,1) */
    next,
    /** [min,max) float */
    float: (min: number, max: number) => min + next() * (max - min),
    /** [min,max] integer */
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    /** Uniform pick. */
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)],
    /** Weighted pick — weights need not sum to 1. */
    weighted: <T>(entries: readonly (readonly [T, number])[]): T => {
      const total = entries.reduce((a2, [, w]) => a2 + w, 0)
      let r = next() * total
      for (const [v, w] of entries) {
        r -= w
        if (r <= 0) return v
      }
      return entries[entries.length - 1][0]
    },
    /** True with probability p. */
    chance: (p: number) => next() < p,
    /** Box–Muller normal, clamped to ±3σ so demo data has no absurd outliers. */
    normal: (mean: number, sd: number) => {
      const u = Math.max(1e-9, next())
      const v = next()
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      return mean + Math.max(-3, Math.min(3, z)) * sd
    },
    shuffle: <T>(arr: T[]): T[] => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return out
    },
  }
}

export type Rng = ReturnType<typeof makeRng>
