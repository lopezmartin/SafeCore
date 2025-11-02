import { z } from "zod";

//
// Zod schema for a minimal Probabilistic Timed Automaton (PTA)
//

const Clock = z.object({ name: z.string() });

const Guard = z.object({
  clock: z.string(),
  op: z.enum(["<", "<=", ">", ">="]),
  value: z.number(),
});

const TransitionZ = z.object({
  from: z.string(),
  to: z.string(),
  guard: z.array(Guard).optional(),
  resets: z.array(z.string()).optional(),
  probability: z.number().optional(),
});

export const PTA = z.object({
  states: z.array(z.string()),
  clocks: z.array(Clock),
  transitions: z.array(TransitionZ),
  initial: z.string(),
});