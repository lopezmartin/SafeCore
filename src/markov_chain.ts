import type { PTAModel, State, Transition, SparseRow } from "./types/safecore.js";

/**
 * MarkovChain
 *
 * - Builds a normalized sparse transition matrix P from a PTAModel
 * - Provides bounded first-hit and unbounded reachability routines
 *
 * Safe with strictNullChecks: all internal arrays are pre-initialized to avoid `undefined`.
 */
export class MarkovChain {
  public readonly n: number;
  public readonly indexOf: Map<string, number>;
  public readonly nameOf: string[];
  public readonly P: SparseRow[]; // P[i] = outgoing distribution from state i
  public readonly initialIndex: number;

  constructor(model: PTAModel) {
    // build name/index mapping
    this.nameOf = model.states.map((s: State) => s.name);
    this.indexOf = new Map<string, number>();
    this.nameOf.forEach((name, i) => this.indexOf.set(name, i));
    this.n = this.nameOf.length;

    // initialize P as an array of empty rows so this.P[i] is always defined
    this.P = Array.from({ length: this.n }, () => [] as SparseRow);

    // accumulate raw probabilities per source state using an array of Maps (never undefined)
    const accum: Array<Map<number, number>> = Array.from({ length: this.n }, () => new Map<number, number>());

    for (const t of model.transitions as Transition[]) {
      const i = this.indexOf.get(t.from);
      const j = this.indexOf.get(t.to);
      if (i === undefined || j === undefined) continue;
      const p = typeof t.probability === "number" ? t.probability : 0;
      const rowMap = accum[i];
      rowMap!.set(j, (rowMap!.get(j) || 0) + p);
    }

    // normalize each row and populate this.P
    for (let i = 0; i < this.n; i++) {
      const rowMap = accum[i];
      let sum = 0;
      for (const v of rowMap!.values()) sum += v;
      if (sum <= 0) continue; // dead-end or no probabilistic outgoing transitions
      for (const [j, v] of rowMap!.entries()) {
        this.P[i]!.push({ j, p: v / sum });
      }
    }

    this.initialIndex = this.indexOf.get(model.initial) ?? 0;
  }

  /**
   * reachBoundedFirstHit
   *
   * Returns the probability to reach any index in `targets` within <= k steps,
   * counting only first hits (mass is removed once a target is hit).
   */
  public reachBoundedFirstHit(startIndex: number, targets: Set<number>, k: number): number {
    const n = this.n;
    if (targets.has(startIndex)) return 1;

    let cur = new Array<number>(n).fill(0);
    cur[startIndex] = 1;
    let cumulative = 0;

    for (let step = 1; step <= k; step++) {
      const next = new Array<number>(n).fill(0);
      // propagate current mass
      for (let i = 0; i < n; i++) {
        const pi = cur[i];
        if (pi === 0) continue;
        const row = this.P[i];
        if (!row || row.length === 0) continue;
        for (const { j, p } of row) next[j]! += pi! * p;
      }
      // collect hits (first-hit semantics) and remove them from propagation
      let hit = 0;
      for (const t of targets) {
        hit += next[t] || 0;
        next[t] = 0;
      }
      cumulative += hit;

      // check for remaining mass
      let massLeft = 0;
      for (let i = 0; i < n; i++) massLeft += next[i]!;
      if (massLeft <= 0) break;
      cur = next;
    }

    return cumulative;
  }

  /**
   * reachUnbounded
   *
   * Returns an array x of length n where x[i] = P_i(eventually reach targets).
   * Uses Gauss-Seidel iterations; tolerances and max iterations configurable.
   */
  public reachUnbounded(targets: Set<number>, tol = 1e-12, maxIter = 20000): number[] {
    const n = this.n;
    const isTarget = new Array<boolean>(n).fill(false);
    for (const t of targets) isTarget[t] = true;

    // if all states are targets return 1s
    if (isTarget.every(Boolean)) return new Array<number>(n).fill(1);

    // transient states (non-target)
    const transient: number[] = [];
    for (let i = 0; i < n; i++) if (!isTarget[i]) transient.push(i);

    // initialize x: targets = 1, others = 0
    const x = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) if (isTarget[i]) x[i] = 1;

    // Gauss-Seidel iteration: x[s] = sum_j P[s][j] * x[j]
    for (let iter = 0; iter < maxIter; iter++) {
      let maxDelta = 0;
      for (const s of transient) {
        const row = this.P[s];
        if (!row || row.length === 0) {
          // no outgoing transitions => cannot reach target (stay 0)
          continue;
        }
        let rhs = 0;
        for (const { j, p } of row) rhs += p * x[j]!; // x[target]=1 already set
        const delta = Math.abs(rhs - x[s]!);
        if (delta > maxDelta) maxDelta = delta;
        x[s] = rhs; // GS update (in-place)
      }
      if (maxDelta < tol) break;
    }

    return x;
  }
}