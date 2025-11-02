import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import type { PTAModel, Transition } from "../types/safecore.js"; // adjust import path to your project
import type { DiagramOptions } from "../types/safecore.js"; // adjust import path to your project

/**
 * DiagramHelper
 *
 * Responsibilities:
 * - render a PTAModel to Mermaid or DOT source
 * - save the generated source into ./img_graph
 * - render a PNG from a Mermaid source using `mmdc` or fallback to `npx @mermaid-js/mermaid-cli`
 *
 * API decisions:
 * - renderDiagram is a pure function that returns the source string
 * - saveMermaidSource writes the Mermaid source (.mmd) and returns its path
 * - renderPngFromSource ensures the .mmd is saved (calls saveMermaidSource) and then generates the PNG
 */
export class DiagramHelper {
  private static defaultAccidentColor = { fill: "#ffcccc", stroke: "#cc0000", font: "#800000" };

  /**
   * Render a PTAModel to a diagram source string (Mermaid or DOT).
   * This method is pure and does not perform I/O.
   */
  public static renderDiagram(
    model: PTAModel,
    format: "mermaid" | "dot" = "mermaid",
    options: DiagramOptions = {}
  ): string {
    const { highlightInitial = true, showProbabilities = true, showGuards = true, accidentColor } = options;
    const accCol = { ...DiagramHelper.defaultAccidentColor, ...(accidentColor ?? {}) };
    const nodes = model.states.map((s) => s.name);
    const initial = model.initial;

    const labelForTransition = (t: Transition) => {
      const parts: string[] = [];
      if (showProbabilities && typeof t.probability === "number") parts.push(`p=${t.probability}`);
      if (showGuards && Array.isArray(t.guard) && t.guard.length > 0) {
        const g = t.guard.map((gg: any) => `${gg.clock}${gg.op}${gg.value}`).join(" & ");
        parts.push(g);
      }
      if (showGuards && Array.isArray(t.resets) && t.resets.length > 0) {
        parts.push(`reset=${t.resets.join(",")}`);
      }
      return parts.length ? parts.join(" | ") : "";
    };

    const isAccident = (name: string) => {
      const s = model.states.find((st) => st.name === name);
      return !!(s && s.isAccident);
    };

    if (format === "mermaid") {
      const lines: string[] = ["flowchart LR"];
      for (const n of nodes) {
        const id = DiagramHelper._id(n);
        const label = DiagramHelper._escape(n);
        if (isAccident(n)) {
          lines.push(`  ${id}([\"${label}\"]):::accident`);
        } else if (highlightInitial && n === initial) {
          lines.push(`  ${id}([\"${label}\"]):::initial`);
        } else {
          lines.push(`  ${id}("${label}")`);
        }
      }
      for (const t of model.transitions) {
        const fromId = DiagramHelper._id(t.from);
        const toId = DiagramHelper._id(t.to);
        const lbl = labelForTransition(t);
        const edge = lbl ? `${fromId} -->|${DiagramHelper._escape(lbl)}| ${toId}` : `${fromId} --> ${toId}`;
        lines.push(`  ${edge}`);
      }
      if (highlightInitial) {
        lines.push(`  classDef initial fill:#ffeeaa,stroke:#333,stroke-width:2px;`);
      }
      lines.push(
        `  classDef accident fill:${accCol.fill},stroke:${accCol.stroke},stroke-width:2px,color:${accCol.font};`
      );
      return lines.join("\n");
    } else {
      const lines: string[] = ["digraph Automaton {", "  rankdir=LR;", '  node [shape=ellipse, fontsize=12];'];
      for (const n of nodes) {
        const nameEsc = DiagramHelper._escape(n);
        if (isAccident(n)) {
          lines.push(
            `  "${nameEsc}" [style=filled, fillcolor="${accCol.fill}", color="${accCol.stroke}", fontcolor="${accCol.font}", penwidth=2];`
          );
        } else if (highlightInitial && n === initial) {
          lines.push(`  "${nameEsc}" [style=filled, fillcolor="#ffeeaa", penwidth=2];`);
        } else {
          lines.push(`  "${nameEsc}";`);
        }
      }
      for (const t of model.transitions) {
        const lbl = labelForTransition(t);
        const attr = lbl ? ` [label="${DiagramHelper._escape(lbl)}"]` : "";
        lines.push(`  "${DiagramHelper._escape(t.from)}" -> "${DiagramHelper._escape(t.to)}"${attr};`);
      }
      lines.push("}");
      return lines.join("\n");
    }
  }

  /**
   * Save Mermaid source generated from the model into ./img_graph and return the absolute .mmd path.
   * If a filename base is provided it will be sanitized; otherwise a timestamped name is used.
   */
  public static saveMermaidSource(model: PTAModel, filenameBase?: string, options: DiagramOptions = {}): string {
    const outDir = path.resolve(process.cwd(), "img_graph");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const base = filenameBase ? filenameBase.replace(/[^a-zA-Z0-9-_]/g, "_") : `automata_${Date.now()}`;
    const srcPath = path.join(outDir, `${base}.mmd`);

    // Render Mermaid source and write it
    const src = DiagramHelper.renderDiagram(model, "mermaid", options);
    fs.writeFileSync(srcPath, src, "utf8");
    return srcPath;
  }

    /**
     * Replace the existing renderPngFromSource method in DiagramHelper with this version.
     *
     * This variant:
     * - ensures the Mermaid source is saved (calls saveMermaidSource)
     * - prefers global `mmdc` and falls back to `npx @mermaid-js/mermaid-cli`
     * - injects environment variables so Puppeteer uses a system Chromium binary
     *   (PUPPETEER_EXECUTABLE_PATH) and skips downloading the embedded Chromium
     *   (PUPPETEER_SKIP_CHROMIUM_DOWNLOAD)
     * - returns the absolute PNG path or throws an Error containing stdout/stderr
     *
     * Before running, ensure you have Chromium installed (e.g. `sudo apt install -y chromium`)
     * and adjust `SYSTEM_CHROMIUM_PATH` below if your chromium binary is at a different path.
     */
    public static renderPngFromSource(
    model: PTAModel,
    options: DiagramOptions = {},
    filenameBase?: string
    ): string {
    // 1) ensure .mmd exists
    const mmdPath = DiagramHelper.saveMermaidSource(model, filenameBase, options);

    const outDir = path.dirname(path.resolve(mmdPath));
    const baseOut = filenameBase && filenameBase.trim().length
        ? filenameBase.replace(/[^a-zA-Z0-9-_]/g, "_")
        : path.basename(mmdPath, path.extname(mmdPath));
    const pngPath = path.join(outDir, `${baseOut}.png`);

    // Path to system Chromium - adjust if necessary
    const SYSTEM_CHROMIUM_PATH = "/usr/bin/chromium"; // or "/usr/bin/chromium-browser"

    // Build env for spawned processes so Puppeteer (used by mmdc) uses system Chromium
    const childEnv = {
        ...process.env,
        PUPPETEER_EXECUTABLE_PATH: SYSTEM_CHROMIUM_PATH,
        PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "1"
    };

    const run = (cmd: string, args: string[]) => {
        const res = spawnSync(cmd, args, { encoding: "utf8", env: childEnv });
        if (res.status !== 0) {
        const out = (res.stdout || "").trim();
        const err = (res.stderr || "").trim();
        throw new Error(
            `Command failed: ${cmd} ${args.join(" ")}\nexit=${res.status}\nstdout:\n${out}\nstderr:\n${err}`
        );
        }
    };

    const whichCmd = process.platform === "win32" ? "where" : "which";

    // 2) try mmdc first (global installation)
    const whichMmdc = spawnSync(whichCmd, ["mmdc"], { encoding: "utf8", env: childEnv });
    if (whichMmdc.status === 0) {
        run("mmdc", ["-i", mmdPath, "-o", pngPath]);
        return pngPath;
    }

    // 3) fallback to npx @mermaid-js/mermaid-cli
    const whichNpx = spawnSync(whichCmd, ["npx"], { encoding: "utf8", env: childEnv });
    if (whichNpx.status === 0) {
        run("npx", ["@mermaid-js/mermaid-cli", "-i", mmdPath, "-o", pngPath]);
        return pngPath;
    }

    throw new Error(
        "Mermaid rendering tool not found: install mermaid-cli globally (`npm i -g @mermaid-js/mermaid-cli`) or ensure `npx` is available. " +
        `Also ensure Chromium is installed and accessible at ${SYSTEM_CHROMIUM_PATH}.`
    );
    }

    /** Helper: create a safe mermaid node id from a state name */
    private static _id(name: string): string {
        const n = name.replace(/[^a-zA-Z0-9_]/g, "_");
        return /^[a-zA-Z]/.test(n) ? `n${n}` : `n_${n}`;
    }

    /** Helper: escape quotes for labels */
    private static _escape(s: string): string {
        return String(s).replace(/"/g, '\\"');
    }
}