import type { FlowReport } from "./types.js";
import { formatAmount } from "../core/balance.js";

export function formatFlowReport(report: FlowReport): string {
  const lines: string[] = [];
  const { plan, stepResults, overallDiff, initialSnapshot } = report;

  // Header
  lines.push(`\u2550\u2550 ${plan.name} \u2014 Dry Run \u2550\u2550`);
  if (plan.description) lines.push(plan.description);
  lines.push("");

  // Starting balances
  lines.push("Starting Balances:");
  for (const token of plan.tokens) {
    const bal = initialSnapshot.balances.get(token.metadata) ?? 0n;
    lines.push(`  ${token.symbol.padEnd(6)} ${formatAmount(bal, token.decimals)}`);
  }
  lines.push("");

  // Per-step results
  for (let i = 0; i < stepResults.length; i++) {
    const step = stepResults[i];
    const status = step.success ? "OK" : "FAILED";
    lines.push(`Step ${i + 1}: ${step.description} [${status}]`);

    if (!step.success) {
      lines.push(`  VM Status: ${step.vmStatus}`);
    }

    // Show token deltas (only non-zero)
    for (const d of step.deltas) {
      if (d.delta !== 0n) {
        lines.push(`  ${d.token.symbol.padEnd(6)} ${d.deltaFormatted}`);
      }
    }

    // Show vault changes
    if (step.vaultAfter) {
      const vault = step.vaultAfter;
      if (!vault.exists) {
        lines.push("  Vault: CLOSED");
      } else {
        // Find the previous vault state for comparison
        const prevVault = i > 0
          ? stepResults[i - 1].vaultAfter
          : undefined;

        if (prevVault) {
          if (vault.debtPrincipal !== prevVault.debtPrincipal) {
            lines.push(`  Vault debt: ${prevVault.debtPrincipal} \u2192 ${vault.debtPrincipal}`);
          }
          if (vault.collateral !== prevVault.collateral) {
            lines.push(`  Vault collateral: ${prevVault.collateral} \u2192 ${vault.collateral}`);
          }
        } else {
          lines.push(`  Vault: collateral=${vault.collateral}, debt=${vault.debtPrincipal}`);
        }
      }
    }

    // Show expectation results
    for (const exp of step.expectationResults) {
      const icon = exp.passed ? "\u2713" : "\u2717";
      lines.push(`  ${icon} ${exp.description} (${exp.actual})`);
    }

    lines.push(`  Gas: ${step.gasCostApt.toFixed(6)} APT`);
    lines.push("");
  }

  // Final balances
  lines.push("Final Balances:");
  const lastStep = stepResults[stepResults.length - 1];
  if (lastStep) {
    for (const token of plan.tokens) {
      const bal = lastStep.balancesAfter.get(token.metadata) ?? 0n;
      lines.push(`  ${token.symbol.padEnd(6)} ${formatAmount(bal, token.decimals)}`);
    }
  }
  lines.push("");

  // Net changes
  const netParts: string[] = [];
  for (const d of overallDiff.deltas) {
    if (d.delta !== 0n) {
      netParts.push(`${d.token.symbol} ${d.deltaFormatted}`);
    }
  }
  if (netParts.length > 0) {
    lines.push(`Net: ${netParts.join(", ")}`);
  }

  lines.push(`Total Gas: ${report.totalGasCostApt.toFixed(6)} APT`);

  // Result
  if (report.success) {
    lines.push("Result: ALL STEPS PASSED");
  } else {
    lines.push(`Result: FAILED (${report.errors.length} error(s))`);
    for (const err of report.errors) {
      lines.push(`  [${err.code}] ${err.title}`);
      lines.push(`    ${err.suggestion}`);
    }
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push(`Warnings (${report.warnings.length}):`);
    for (const w of report.warnings) {
      lines.push(`  [${w.stepLabel}] ${w.title} \u2014 ${w.detail}`);
    }
  }

  // Caveat about sequential simulation
  if (stepResults.length > 1) {
    lines.push("");
    lines.push(
      "Note: Each step was simulated against current mainnet state independently.",
    );
    lines.push(
      "Steps 2+ may differ slightly from actual execution since prior steps haven't committed.",
    );
  }

  return lines.join("\n");
}
