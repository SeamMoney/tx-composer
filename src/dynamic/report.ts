import type { SimulationResult } from "../types.js";
import type { BalanceDiff, DiagnosedError } from "../simulation/types.js";
import type { ValidationWarning } from "./validate.js";

export function formatComposedSummary(
  stepLabels: string[],
  simulation: SimulationResult,
  balanceDiff: BalanceDiff | undefined | null,
  errors: DiagnosedError[],
  warnings?: ValidationWarning[],
): string {
  const lines: string[] = [];

  lines.push(`== Composed Transaction (${stepLabels.length} steps) ==`);
  lines.push(`Steps: ${stepLabels.join(" \u2192 ")}`);
  lines.push("");

  const status = simulation.success ? "OK" : "FAILED";
  lines.push(`Status: ${status}`);

  if (!simulation.success) {
    lines.push(`VM Status: ${simulation.vmStatus}`);
  }

  lines.push(
    `Gas: ${simulation.gasCostApt.toFixed(6)} APT (${simulation.gasUsed} units)`,
  );
  lines.push("");

  if (balanceDiff && balanceDiff.deltas.length > 0) {
    const changed = balanceDiff.deltas.filter((d) => d.delta !== 0n);
    if (changed.length > 0) {
      lines.push("Balance Changes:");
      for (const d of changed) {
        lines.push(`  ${d.token.symbol.padEnd(8)} ${d.deltaFormatted}`);
      }
      lines.push("");
    }
  }

  if (simulation.events.length > 0) {
    lines.push(`Events (${simulation.events.length}):`);
    for (const evt of simulation.events.slice(0, 10)) {
      const amountStr = evt.amount ? ` amount=${evt.amount}` : "";
      lines.push(`  ${evt.shortType}${amountStr}`);
    }
    if (simulation.events.length > 10) {
      lines.push(`  ... and ${simulation.events.length - 10} more`);
    }
    lines.push("");
  }

  if (warnings && warnings.length > 0) {
    lines.push(`Warnings (${warnings.length}):`);
    for (const w of warnings) {
      lines.push(`  [${w.code}] ${w.message}`);
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push("Errors:");
    for (const err of errors) {
      lines.push(`  [${err.code}] ${err.title}`);
      lines.push(`    ${err.suggestion}`);
    }
    lines.push("");
  }

  if (simulation.success) {
    lines.push("Result: SIMULATION PASSED \u2014 safe to execute");
  } else {
    lines.push(`Result: SIMULATION FAILED (${errors.length} error(s))`);
  }

  return lines.join("\n");
}
