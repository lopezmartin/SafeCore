import { PTA } from "./schemas/zod_structures.js";
import type { PTAModel, State, Transition } from "./types/safecore.js";

//
// Automata class: model construction + structural & probability validation
//

/**
 * Automata encapsulates a PTA model and provides construction helpers
 * and runtime validations (Zod structure + probability rules).
 */
export class Automata {
  public model: PTAModel;

  /**
   * Create an Automata instance. Optionally initialize with a partial PTAModel.
   * @param model Partial initial model.
   */
  constructor(model?: Partial<PTAModel>) {
    this.model = {
      states: [],
      transitions: [],
      clocks: [],
      initial: "",
      ...model,
    } as PTAModel;
  }

  /**
   * Add a state if a state with the same name does not already exist.
   * @param s State to add.
   */
  addState(s: State): void {
    if (!this.model.states.find((x) => x.name === s.name)) {
      this.model.states.push(s);
    }
  }

  /**
   * Add a transition from -> to with optional parameters.
   * @param from Source state name.
   * @param to Target state name.
   * @param opts Optional transition fields (probability, guard, resets).
   */
  addTransition(from: string, to: string, opts?: Partial<Transition>): void {
    const t: Transition = {
      from,
      to,
      probability: opts?.probability,
      guard: opts?.guard,
      resets: opts?.resets,
    };
    this.model.transitions.push(t);
  }

  /**
   * Validate the model structure using the PTA Zod schema.
   * Returns a success object or a failure with the Zod error.
   */
  validateStructure():
    | { success: true }
    | { success: false; error: unknown } {
    const zodForm = {
      states: this.model.states.map((s) => s.name),
      clocks: this.model.clocks ?? [],
      transitions: this.model.transitions.map((t) => ({
        from: t.from,
        to: t.to,
        guard: t.guard,
        resets: t.resets,
        probability: t.probability,
      })),
      initial: this.model.initial,
    };
    const res = PTA.safeParse(zodForm);
    if (res.success) return { success: true };
    return { success: false, error: res.error };
  }

  /**
   * Validate probabilities:
   * - each probability (if present) must be a number in [0,1]
   * - optionally: for each source state, if all outgoing transitions have a defined probability,
   *   their sum must be approximately 1 (tolerance parameter)
   *
   * @param tolerance Numerical tolerance for sum-to-1 checks (default = 1e-9).
   * @returns { ok: boolean, errors: string[] } with collected errors (empty if ok).
   */
  validateProbabilities(
    tolerance = 1e-6
  ): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    // Individual probability validity
    for (const t of this.model.transitions) {
      if (t.probability !== undefined) {
        if (
          typeof t.probability !== "number" ||
          Number.isNaN(t.probability) ||
          t.probability < 0 ||
          t.probability > 1
        ) {
          errors.push(
            `Invalid probability on transition ${t.from} -> ${t.to}: ${t.probability}`
          );
        }
      }
    }

    // Group by source state
    const byFrom = new Map<string, number[]>();
    for (const t of this.model.transitions) {
      const arr = byFrom.get(t.from) ?? [];
      arr.push(t.probability === undefined ? NaN : t.probability);
      byFrom.set(t.from, arr);
    }

    // If all outgoing transitions from a state have defined probabilities, verify the sum == 1 (within tolerance)
    for (const [from, probs] of byFrom.entries()) {
      if (probs.some((v) => Number.isNaN(v))) {
        // skip strict sum check if information missing (optional control)
        continue;
      }
      const sum = probs.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > tolerance) {
        errors.push(
          `Probability sum from "${from}" = ${sum} (expected ≈ 1, tol=${tolerance})`
        );
      }
    }

    return { ok: errors.length === 0, errors };
  }

/**
 * Validate the probabilities of the transitions in the automaton.
 *
 * This function validates the probabilities of the transitions in the given PTAModel.
 * It performs detailed checks on the probabilities, including sum checks and normalization.
 *
 * @param model - The PTAModel to validate.
 * @param options - Optional options for the validation.
 * @param options.tolerance - The tolerance for the probability sum check. Default is 1e-6.
 * @param options.autoNormalize - Flag indicating whether to automatically normalize the probabilities. Default is false.
 * @returns The validation result.
 * @returns.ok - True if the validation passed, false otherwise.
 * @returns.errors - An array of error messages.
 * @returns.warnings - An array of warning messages.
 */
  validateProbabilitiesDetailed(
    model: PTAModel,
    { tolerance = 1e-6, autoNormalize = false } = {}
  ): { ok: boolean; errors: string[]; warnings: string[] } {
    const errors: string[] = []
    const warnings: string[] = []

    // group transitions and keep references for potential normalization
    const byFrom = new Map<string, { probs: number[]; trans: Transition[] }>()
    for (const t of model.transitions) {
      const entry = byFrom.get(t.from) ?? { probs: [], trans: [] }
      entry.probs.push(t.probability === undefined ? NaN : t.probability)
      entry.trans.push(t)
      byFrom.set(t.from, entry)
    }

    for (const [from, { probs, trans }] of byFrom.entries()) {
      const undef = probs.some(v => Number.isNaN(v))
      const sum = probs.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0)
      if (undef) {
        warnings.push(`From ${from}: some outgoing probabilities are undefined, skipping strict sum check`)
        // still log exact values for diagnosis
        console.log(`DEBUG ${from} probs=[${probs.map(p => (Number.isNaN(p) ? "undef" : p)).join(", ")}] sum=${sum}`)
        continue
      }

      // log full precision to see floating errors
      console.log(`DEBUG ${from} probs=[${probs.map(p => p.toPrecision(15)).join(", ")}] sum=${sum.toPrecision(15)}`)

      if (Math.abs(sum - 1) > tolerance) {
        // try detect obvious duplicates (same 'to' repeated)
        const seen = new Set<string>()
        for (const t of trans) {
          if (seen.has(t.to)) warnings.push(`Duplicate outgoing transition detected from ${from} to ${t.to}`)
          seen.add(t.to)
        }

        if (autoNormalize && Math.abs(sum - 1) < 0.02) {
          // normalize in-place
          for (const t of trans) {
            if (typeof t.probability === "number") t.probability = t.probability / sum
          }
          warnings.push(`Normalized probabilities from ${from} (sum=${sum})`)
        } else {
          errors.push(`Probability sum from "${from}" = ${sum} (expected ≈ 1, tol=${tolerance})`)
        }
      }
    }

    return { ok: errors.length === 0, errors, warnings }
  }

}