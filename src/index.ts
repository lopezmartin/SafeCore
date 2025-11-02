import { z } from "zod";
import { Automata } from "./automata.js";
import { ModelChecker } from "./modelchecker.js";
import type { LTLProperty, PCTLProperty } from "./types/safecore.js";  
import { DiagramHelper } from "./helpers/diagram_helper.js";
//
// Example usage with logs (executable as a script)
//
export function runExample() {
  // Build automata
  const automata = new Automata();

  /**
   * Add states to the automaton
   */
  automata.addState({ name: "Idle" });
  automata.addState({ name: "TramApproach" });
  automata.addState({ name: "PedestrianAndTramApproach" });
  automata.addState({ name: "PedestrianCrossingNoTram" });
  automata.addState({ name: "PedestrianCrossingTramApproach" });

  // Optional accident state
  automata.addState({ name: "Accident", isAccident: true });

  // Transitions (simplified)
  /**
   * Add transitions to the automaton
   */
  automata.addTransition("Idle", "TramApproach", { probability: 1 });
  automata.addTransition("TramApproach", "PedestrianAndTramApproach", {
    probability: 0.6,
  });
  automata.addTransition("TramApproach", "PedestrianCrossingTramApproach", {
    probability: 0.39,
  });
  automata.addTransition("TramApproach", "Accident", { probability: 0.01 });
  automata.addTransition("PedestrianAndTramApproach", "PedestrianCrossingNoTram", {
    probability: 0.7,
  });
  automata.addTransition(
    "PedestrianAndTramApproach",
    "PedestrianCrossingTramApproach",
    { probability: 0.3 }
  );
  automata.addTransition("PedestrianCrossingNoTram", "Idle", { probability: 1 });
  automata.addTransition("PedestrianCrossingTramApproach", "Idle", { probability: 1 });

  /**
   * Set the initial state and clocks of the automaton
   */
  automata.model.initial = "Idle";
  automata.model.clocks = [{ name: "t" }];

  // Structure validation
  /**
   * Validate the structure of the automaton
   */
  const struct = automata.validateStructure();
  console.log("Structure validation:", struct);

  // Probabilities validation
  /**
   * Validate the probabilities of the transitions in the automaton
   */
  const prob = automata.validateProbabilities();
  console.log("Probabilities check:", prob);
   /**
   * Validate in details the probabilities of the transitions in the automaton
   */
  const probDetailed = automata.validateProbabilitiesDetailed(automata.model);
  console.log("Probabilities detailed check:", probDetailed);

  // Model checking
  const checker = new ModelChecker();

  /**
   * Define an LTL property to check
   */
  const ltl: LTLProperty = { name: "NoAcc", formula: "G !Accident" };

  /**
   * Define a PCTL property to check
   */
  const pctl: PCTLProperty = { name: "P0Acc", formula: "P <= 0 [ F Accident ]" };


  /**
   * Validate the LTL property against the automaton model
   */
  console.log("validateLTL G !Accident ->", checker.validateLTL(ltl, automata.model));

  /**
   * Validate the PCTL property against the automaton model
   */
  console.log(
    "validatePCTL P <= 0 [ F Accident ] ->",
    checker.validatePCTL(pctl, automata.model)
  );

  async function generate() {
  try {
    // 1) Save Mermaid source to ./img_graph/tram_model.mmd
    const mmdPath = DiagramHelper.saveMermaidSource(automata.model, "tram_model", {
      highlightInitial: true,
      showProbabilities: true,
      showGuards: false
    });
    console.log("Mermaid source saved:", mmdPath);

    // 2) Generate PNG from the saved source (calls saveMermaidSource again to ensure file exists)
    const pngPath = DiagramHelper.renderPngFromSource(automata.model, {
      highlightInitial: true,
      showProbabilities: true,
      showGuards: false
    }, "tram_model");
    console.log("PNG generated at:", pngPath);
  } catch (err) {
    console.error("Diagram generation failed:", (err as Error).message);
    // For debugging you can log full error object
    console.error(err);
  }
}

generate();


}


runExample() 