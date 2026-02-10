import type { DiagnosedError, ErrorSeverity } from "./types.js";

interface ErrorPattern {
  pattern: RegExp;
  code: string;
  title: string;
  detail: string;
  suggestion: string;
  severity: ErrorSeverity;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    pattern: /INSUFFICIENT_BALANCE|65540/,
    code: "INSUFFICIENT_BALANCE",
    title: "Insufficient token balance",
    detail: "The account does not hold enough of the requested token for this operation.",
    suggestion: "Verify the wallet holds enough tokens. Check that prior steps produced sufficient output.",
    severity: "error",
  },
  {
    pattern: /ARITHMETIC_ERROR/i,
    code: "ARITHMETIC_OVERFLOW",
    title: "Arithmetic overflow in contract",
    detail: "A math operation overflowed. Common when repay amount exceeds debt or swap amounts exceed pool liquidity.",
    suggestion: "Check that repay amount <= outstanding debt. Verify swap amounts against pool liquidity.",
    severity: "error",
  },
  {
    pattern: /OUT_OF_GAS/i,
    code: "OUT_OF_GAS",
    title: "Transaction ran out of gas",
    detail: "The max gas limit was exceeded. Composed transactions with many steps use more gas.",
    suggestion: "Increase max_gas_amount or reduce the number of steps.",
    severity: "error",
  },
  {
    pattern: /SEQUENCE_NUMBER/i,
    code: "SEQUENCE_NUMBER_ERROR",
    title: "Sequence number mismatch",
    detail: "The transaction sequence number doesn't match the account state. Usually means concurrent transactions.",
    suggestion: "Wait for any pending transactions to finalize before retrying.",
    severity: "error",
  },
  {
    pattern: /REPAY.*EXCEED|repay_amount_exceeds/i,
    code: "REPAY_EXCEEDS_DEBT",
    title: "Repay amount exceeds outstanding debt",
    detail: "Attempting to repay more than the current debt amount. Use repay_all to handle exact amounts.",
    suggestion: "Use repay_all_fa instead, or reduce the repay amount to match the actual debt.",
    severity: "error",
  },
  {
    pattern: /INSUFFICIENT_SHARES|insufficient_shares/i,
    code: "INSUFFICIENT_SHARES",
    title: "Insufficient collateral shares",
    detail: "Attempting to withdraw more collateral than is deposited.",
    suggestion: "Reduce the withdrawal amount or use withdraw_all to withdraw everything.",
    severity: "error",
  },
  {
    pattern: /SQRT_PRICE_LIMIT|sqrt_price/i,
    code: "PRICE_LIMIT_ERROR",
    title: "Swap price limit exceeded",
    detail: "The swap would move the price beyond the specified limit.",
    suggestion: "Increase slippage tolerance or reduce swap amount.",
    severity: "error",
  },
  {
    pattern: /lending/i,
    code: "LENDING_ERROR",
    title: "Lending protocol error",
    detail: "The lending protocol rejected the operation.",
    suggestion: "Check: repay amount <= debt, withdrawal won't breach health factor, position exists.",
    severity: "error",
  },
  {
    pattern: /pool_v3|pool_v2/i,
    code: "DEX_POOL_ERROR",
    title: "DEX pool operation failed",
    detail: "The DEX pool rejected the swap operation.",
    suggestion: "Check slippage tolerance, pool liquidity, and that the pool address is correct.",
    severity: "error",
  },
  {
    pattern: /ABORTED/i,
    code: "MOVE_ABORT",
    title: "Move module aborted execution",
    detail: "A Move smart contract called abort(). The abort code indicates the specific failure.",
    suggestion: "Check the abort code against the protocol's documentation or source code.",
    severity: "error",
  },
];

export function diagnoseVmStatus(
  vmStatus: string,
  stepLabel?: string,
): DiagnosedError[] {
  if (!vmStatus || vmStatus === "Executed successfully") return [];

  const errors: DiagnosedError[] = [];

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.pattern.test(vmStatus)) {
      errors.push({
        severity: pattern.severity,
        code: pattern.code,
        title: pattern.title,
        detail: pattern.detail,
        suggestion: pattern.suggestion,
        stepLabel,
      });
      break; // first match wins (patterns are ordered by specificity)
    }
  }

  // If no pattern matched, add a generic error
  if (errors.length === 0 && vmStatus !== "Executed successfully") {
    errors.push({
      severity: "error",
      code: "UNKNOWN_ERROR",
      title: "Transaction failed",
      detail: `VM status: ${vmStatus}`,
      suggestion: "Inspect the raw vm_status for details.",
      stepLabel,
    });
  }

  return errors;
}
