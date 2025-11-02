import { z } from "zod";
import { PTA } from "./schemas/zod_structures.js";
import type { PTAModel, State, Transition, LTLProperty, PCTLProperty, AST } from "./types/safecore.js";
import { MarkovChain } from "./markov_chain.js";
//
// ModelChecker class: LTL / PCTL simple checking and utilities
//

/**
 * ModelChecker contains sets of LTL and PCTL properties and provides
 * utilities and simple validators for those properties.
 *
 * Note: The LTL/PCTL checks here are structural approximations:
 * - guards, clocks and timing semantics are ignored
 * - probabilities are used only in a simple PCTL approximation
 * For full formal power, integrate a dedicated model checker engine.
 */
export class ModelChecker {
  /** Registered LTL properties. */
  public LTLProperties: Set<LTLProperty> = new Set();

  /** Registered PCTL properties. */
  public PCTLProperties: Set<PCTLProperty> = new Set();

  /**
   * Add an LTL property to the checker set.
   * @param p LTL property
   */
  addLTL(p: LTLProperty): void {
    this.LTLProperties.add(p);
  }

  /**
   * Add a PCTL property to the checker set.
   * @param p PCTL property
   */
  addPCTL(p: PCTLProperty): void {
    this.PCTLProperties.add(p);
  }

  /**
   * Build a name -> State map from a model that can be either:
   * - the PTAModel with states: State[]
   * - the minimal Zod shape (states: string[])
   *
   * Heuristics: when only names are provided, states whose name contains "accident"
   * are marked isAccident = true.
   *
   * @param model PTAModel or PTA Zod shape
   */
  buildStateMap(
    model: PTAModel | z.infer<typeof PTA>
  ): Map<string, State> {
    const m = new Map<string, State>();
    const first = (model as any).states?.[0];

    // If states are objects (PTAModel form)
    if (first && typeof first === "object") {
      for (const s of (model as PTAModel).states) {
        m.set(s.name, {
          name: s.name,
          isAccident: !!s.isAccident,
          labels: s.labels ?? [],
        });
      }
      return m;
    }

    // Otherwise, Zod minimal form: states: string[]
    for (const name of (model as any).states as string[]) {
      m.set(name, {
        name,
        isAccident: name.toLowerCase().includes("accident"),
        labels: [],
      });
    }
    return m;
  }

  /**
   * Return direct successors of a state name in the model.
   * @param model PTAModel or PTA Zod shape
   * @param name state name
   */
  successors(
    model: PTAModel | z.infer<typeof PTA>,
    name: string
  ): string[] {
    return ((model as any).transitions as Transition[] || [])
      .filter((t) => t.from === name)
      .map((t) => t.to);
  }

  /**
   * Evaluate whether a State satisfies a simple atomic proposition.
   * Supports:
   * - "Accident" -> uses isAccident flag
   * - labels array
   * - name equality
   *
   * @param s State
   * @param prop atomic proposition string
   */
  stateSatisfies(s: State, prop: string): boolean {
    const p = prop.trim();
    if (p === "Accident") return !!s.isAccident;
    if (s.labels && s.labels.includes(p)) return true;
    return s.name === p;
  }

/**
 * Parses a given formula string into an Abstract Syntax Tree (AST) object.
 *
 * @param formula - The formula string to parse.
 * @returns An AST object representing the parsed formula.
 *
 * @example
 * parseFormula("G !p") // Returns { op: "G_NOT", p: "p" }
 * parseFormula("G p") // Returns { op: "G", p: "p" }
 * parseFormula("F p") // Returns { op: "F", p: "p" }
 * parseFormula("X p") // Returns { op: "X", p: "p" }
 * parseFormula("p U q") // Returns { op: "U", p: "p", q: "q" }
 * parseFormula("!p") // Returns { op: "NOT", p: "p" }
 * parseFormula("p") // Returns { op: "ATOM", p: "p" }
 */
parseFormula(formula: string): AST {
  const f = formula.trim()
  if (f.startsWith("G !")) return { op: "G_NOT", p: f.slice(3).trim() }
  if (f.startsWith("G ")) return { op: "G", p: f.slice(2).trim() }
  if (f.startsWith("F ")) return { op: "F", p: f.slice(2).trim() }
  if (f.startsWith("X ")) return { op: "X", p: f.slice(2).trim() }
  if (f.includes(" U ")) {
    const parts = f.split(" U ").map((s) => s.trim())
    const p = parts[0] ?? ""
    const q = parts[1] ?? ""
    // ensure q is a string (could choose to throw if missing)
    return { op: "U", p, q }
  }
  if (f.startsWith("!")) return { op: "NOT", p: f.slice(1).trim() }
  return { op: "ATOM", p: f }
}


  /**
   * Validate a simple LTL property against the model.
   * Supported formulas: G !p, G p, F p, X p (universal), p U q, p, !p.
   *
   * The check is structural: it uses graph reachability over transitions and
   * ignores timing guards and probabilities.
   *
   * @param prop LTL property
   * @param anyModel PTAModel or PTA Zod shape
   * @returns true if property is satisfied (under these approximations)
   */
  validateLTL(
    prop: LTLProperty,
    anyModel: PTAModel | z.infer<typeof PTA>
  ): boolean {
    const ast = this.parseFormula(prop.formula);
    const stateMap = this.buildStateMap(anyModel as any);
    const initial = (anyModel as any).initial;
    if (!initial || !stateMap.has(initial)) return false;

    // G !p : no reachable state satisfies p
    if (ast.op === "G_NOT") {
      const visited = new Set<string>();
      const stack = [initial];
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const s = stateMap.get(cur)!;
        if (this.stateSatisfies(s, ast.p)) return false;
        for (const nx of this.successors(anyModel as any, cur))
          if (!visited.has(nx)) stack.push(nx);
      }
      return true;
    }

    // G p : all reachable states satisfy p
    if (ast.op === "G") {
      const visited = new Set<string>();
      const stack = [initial];
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const s = stateMap.get(cur)!;
        if (!this.stateSatisfies(s, ast.p)) return false;
        for (const nx of this.successors(anyModel as any, cur))
          if (!visited.has(nx)) stack.push(nx);
      }
      return true;
    }

    // F p : exists reachable state that satisfies p
    if (ast.op === "F") {
      const visited = new Set<string>();
      const stack = [initial];
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const s = stateMap.get(cur)!;
        if (this.stateSatisfies(s, ast.p)) return true;
        for (const nx of this.successors(anyModel as any, cur))
          if (!visited.has(nx)) stack.push(nx);
      }
      return false;
    }

    // X p : universal next (all direct successors satisfy p)
    if (ast.op === "X") {
      const succ = this.successors(anyModel as any, initial);
      if (succ.length === 0) return false;
      for (const name of succ) {
        const s = stateMap.get(name);
        if (!s || !this.stateSatisfies(s, ast.p)) return false;
      }
      return true;
    }

    /**
   * If the parsed formula is of the form "p U q", this block of code checks if the
   * initial state satisfies the formula. It does so by performing a depth-first
   * search from the initial state, keeping track of visited states using a Set.
   * If the current state satisfies the quantified formula `q`, the function
   * returns `true`. If the current state does not satisfy the predicate `p`,
   * the function continues to the next state. If none of the reachable states
   * satisfy the formula `q`, the function returns `false`.
   */
    if (ast.op === "U") {
      const queue: string[] = [initial]
      const seen = new Set<string>()
      while (queue.length) {
        const cur = queue.shift()!
        if (seen.has(cur)) continue
        seen.add(cur)
        const s = stateMap.get(cur)!
        // ast.q is typed string here
        if (this.stateSatisfies(s, ast.q)) return true
        if (!this.stateSatisfies(s, ast.p)) continue
        for (const nx of this.successors(anyModel as any, cur)) queue.push(nx)
      }
      return false
    }


    // NOT p : p false in initial
    if (ast.op === "NOT") {
      const s = stateMap.get(initial)!;
      return !this.stateSatisfies(s, ast.p);
    }

    // ATOM p : p true in initial
    if (ast.op === "ATOM") {
      const s = stateMap.get(initial)!;
      return this.stateSatisfies(s, ast.p);
    }

    return false;
  }

/**
 * Replace the existing validatePCTL implementation in ModelChecker with this method.
 *
 * - Supports the concrete pattern accepted previously: "P <= 0 [ F Accident ]"
 * - Uses MarkovChain to compute unbounded reachability probability to any Accident state
 * - Returns true when the probability to ever reach an Accident from the initial state
 *   satisfies the property (here <= 0). If the property string is different, returns false.
 *
 * Notes:
 * - If model is provided in the minimal Zod shape (PTA), buildStateMap already handles it.
 * - MarkovChain normalizes outgoing probabilities per state. If transitions use weights
 *   instead of probabilities, normalize input before calling this method.
 */
  public validatePCTL(prop: PCTLProperty, model: PTAModel | z.infer<typeof PTA>): boolean {
    // Only support the exact simple syntactic property we used before
    if (prop.formula.trim() !== "P <= 0 [ F Accident ]") return false;

    // Build state map and detect accident states (reuse existing helper)
    const stateMap = this.buildStateMap(model as any);
    const accidentNames = new Set(
      Array.from(stateMap.values()).filter((s) => s.isAccident).map((s) => s.name)
    );

    // If there are no accident states, property trivially holds
    if (accidentNames.size === 0) return true;

    // Build Markov chain and target set = indices of accident states
    const mc = new MarkovChain(model as PTAModel);
    const targets = new Set<number>();
    for (const name of accidentNames) {
      const idx = mc.indexOf.get(name);
      if (idx !== undefined) targets.add(idx);
    }

    // If none of the accident names map to states in the MarkovChain, treat as safe
    if (targets.size === 0) return true;

    // Compute unbounded reachability probabilities (P[eventually reach targets])
    const probs = mc.reachUnbounded(targets);
    const pInit = probs[mc.initialIndex] ?? 0;

    // The property is P <= 0 [ F Accident ] -> holds iff pInit <= 0 (numerically near zero)
    // Use a small tolerance to account for floating point iterations
    const tol = 1e-12;
    return pInit <= tol;
  }
}