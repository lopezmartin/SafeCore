//
// TypeScript types used by SafeCore
//

/**
 * State representation used by the runtime model checker.
 */
export interface State {
  name: string;
  isAccident?: boolean;
  labels?: string[];
}

/**
 * Transition representation used in the runtime model.
 */
export interface Transition {
  from: string;
  to: string;
  probability?: number| undefined;
  guard?: any[] | undefined;
  resets?: string[] | undefined;
}

/**
 * Full PTA model shape used inside Automata and ModelChecker.
 */
export interface PTAModel {
  states: State[];
  transitions: Transition[];
  clocks?: { name: string }[];
  initial: string;
}

/**
 * Simple LTL property (string formula).
 */
export interface LTLProperty {
  name?: string;
  formula: string;
}

/**
 * Simple PCTL property (string formula).
 */
export interface PCTLProperty {
  name?: string;
  formula: string;
}

/**
* Strongly typed AST (discriminated union)
*/
export type AST =
  | { op: "G_NOT"; p: string }
  | { op: "G"; p: string }
  | { op: "F"; p: string }
  | { op: "X"; p: string }
  | { op: "U"; p: string; q: string } // q guaranteed present here
  | { op: "NOT"; p: string }
  | { op: "ATOM"; p: string }


/**
 * Options controlling diagram rendering and saving.
 */
export interface DiagramOptions {
  highlightInitial?: boolean;
  showProbabilities?: boolean;
  showGuards?: boolean;
  accidentColor?: { fill?: string; stroke?: string; font?: string };
}

/**
 * Represents a sparse row.
 *
 * @template {number} T - The type of the elements in the row.
 */
export type SparseRow = Array<{ j: number; p: number }>;


