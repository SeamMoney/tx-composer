import type {
  Aptos,
  MoveFunction,
  MoveModule,
  MoveAbility,
} from "@aptos-labs/ts-sdk";
import type { ComposerStep } from "./types.js";

// ── Types ─────────────────────────────────────────────────────────

export interface StepValidation {
  label: string;
  function: string;
  abi: MoveFunction;
  signerCount: number;
  params: string[];
  returnTypes: string[];
  nonDroppableReturns: number[];
}

export interface ValidationWarning {
  stepLabel: string;
  code: string;
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────

function parseFunctionId(functionId: string): [string, string, string] {
  const parts = functionId.split("::");
  if (parts.length < 3) {
    throw new Error(
      `Invalid function ID "${functionId}" — expected "0xaddr::module::function"`,
    );
  }
  return [parts[0], parts[1], parts[2]];
}

function countSignerParams(params: string[]): number {
  let count = 0;
  for (const p of params) {
    if (p === "&signer" || p === "signer") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function isStructType(typeStr: string): boolean {
  return typeStr.includes("::");
}

function parseStructId(typeStr: string): [string, string, string] | null {
  const clean = typeStr.split("<")[0];
  const parts = clean.split("::");
  if (parts.length < 3) return null;
  return [parts[0], parts[1], parts[2]];
}

// ── Caches (per-process) ──────────────────────────────────────────

const functionAbiCache = new Map<string, MoveFunction | null>();
const moduleAbiCache = new Map<string, MoveModule | null>();

// ── ABI Fetching (public API) ─────────────────────────────────────

async function fetchFunction(
  aptos: Aptos,
  address: string,
  moduleName: string,
  functionName: string,
): Promise<MoveFunction | undefined> {
  const cacheKey = `${address}::${moduleName}::${functionName}`;
  if (functionAbiCache.has(cacheKey)) {
    return functionAbiCache.get(cacheKey) ?? undefined;
  }

  try {
    const mod = await aptos.getAccountModule({
      accountAddress: address,
      moduleName,
    });
    const abi = mod.abi;
    if (!abi) {
      functionAbiCache.set(cacheKey, null);
      return undefined;
    }
    // Cache all functions from this module
    for (const fn of abi.exposed_functions) {
      functionAbiCache.set(`${address}::${moduleName}::${fn.name}`, fn);
    }
    // Cache the module too
    moduleAbiCache.set(`${address}::${moduleName}`, abi);

    return functionAbiCache.get(cacheKey) ?? undefined;
  } catch {
    functionAbiCache.set(cacheKey, null);
    return undefined;
  }
}

async function fetchModuleAbi(
  aptos: Aptos,
  address: string,
  moduleName: string,
): Promise<MoveModule | undefined> {
  const cacheKey = `${address}::${moduleName}`;
  if (moduleAbiCache.has(cacheKey)) {
    return moduleAbiCache.get(cacheKey) ?? undefined;
  }

  try {
    const mod = await aptos.getAccountModule({
      accountAddress: address,
      moduleName,
    });
    const abi = mod.abi;
    if (abi) {
      moduleAbiCache.set(cacheKey, abi);
      for (const fn of abi.exposed_functions) {
        functionAbiCache.set(`${address}::${moduleName}::${fn.name}`, fn);
      }
    } else {
      moduleAbiCache.set(cacheKey, null);
    }
    return abi ?? undefined;
  } catch {
    moduleAbiCache.set(cacheKey, null);
    return undefined;
  }
}

async function checkDropAbility(
  aptos: Aptos,
  address: string,
  moduleName: string,
  structName: string,
): Promise<boolean | null> {
  const moduleAbi = await fetchModuleAbi(aptos, address, moduleName);
  if (!moduleAbi) return null;

  const struct = moduleAbi.structs.find((s) => s.name === structName);
  if (!struct) return null;

  return struct.abilities.includes("drop" as MoveAbility);
}

// ── Main Validation ───────────────────────────────────────────────

export async function validateSteps(
  aptos: Aptos,
  steps: Array<{ label: string; step: ComposerStep }>,
): Promise<{ validations: StepValidation[]; warnings: ValidationWarning[] }> {
  const warnings: ValidationWarning[] = [];
  const validations: StepValidation[] = [];

  // 1. Fetch all ABIs in parallel (deduped by module via cache)
  const abiPromises = steps.map(async ({ label, step }) => {
    const [addr, mod, fn] = parseFunctionId(step.function);
    const abi = await fetchFunction(aptos, addr, mod, fn);
    return { label, step, abi };
  });

  const results = await Promise.all(abiPromises);

  // 2. Validate each step
  for (const { label, step, abi } of results) {
    if (!abi) {
      warnings.push({
        stepLabel: label,
        code: "FUNCTION_NOT_FOUND_ERROR",
        message: `Function "${step.function}" not found on-chain`,
      });
      continue;
    }

    const signerCount = countSignerParams(abi.params);
    const nonSignerParams = abi.params.slice(signerCount);
    const returnTypes = abi.return ?? [];

    // Type argument count
    const expectedTypeArgs = abi.generic_type_params.length;
    const providedTypeArgs = step.typeArguments?.length ?? 0;
    if (providedTypeArgs !== expectedTypeArgs) {
      warnings.push({
        stepLabel: label,
        code: "TYPE_ARG_COUNT_ERROR",
        message: `Step "${label}": expected ${expectedTypeArgs} type argument(s), got ${providedTypeArgs}`,
      });
    }

    // Separate signer args from non-signer args
    const signerArgs = step.args.filter((a) => a.kind === "signer");
    const nonSignerArgs = step.args.filter((a) => a.kind !== "signer");

    // Signer count
    if (signerArgs.length !== signerCount) {
      warnings.push({
        stepLabel: label,
        code: "SIGNER_COUNT_ERROR",
        message: `Step "${label}": function expects ${signerCount} signer(s), but ${signerArgs.length} arg.signer() provided`,
      });
    }

    // Non-signer arg count
    if (nonSignerArgs.length !== nonSignerParams.length) {
      warnings.push({
        stepLabel: label,
        code: "ARG_COUNT_ERROR",
        message: `Step "${label}": expected ${nonSignerParams.length} non-signer argument(s), got ${nonSignerArgs.length}`,
      });
    }

    // Signer vs address mismatch check
    for (let i = 0; i < step.args.length; i++) {
      const arg = step.args[i];
      if (i < signerCount) {
        if (arg.kind !== "signer") {
          warnings.push({
            stepLabel: label,
            code: "SIGNER_MISMATCH",
            message: `Step "${label}" arg ${i}: expected arg.signer() for &signer parameter, got ${arg.kind}`,
          });
        }
      } else {
        if (arg.kind === "signer") {
          const paramType = nonSignerParams[i - signerCount] ?? "unknown";
          warnings.push({
            stepLabel: label,
            code: "SIGNER_MISMATCH",
            message: `Step "${label}" arg ${i}: used arg.signer() but parameter type is "${paramType}" — use arg.literal(address) instead`,
          });
        }
      }
    }

    // Detect non-droppable return types
    const nonDroppableReturns: number[] = [];
    for (let i = 0; i < returnTypes.length; i++) {
      const retType = returnTypes[i];
      if (isStructType(retType)) {
        const structId = parseStructId(retType);
        if (structId) {
          const hasDrop = await checkDropAbility(
            aptos,
            structId[0],
            structId[1],
            structId[2],
          );
          if (hasDrop === false) {
            nonDroppableReturns.push(i);
          }
        }
      }
    }

    validations.push({
      label,
      function: step.function,
      abi,
      signerCount,
      params: nonSignerParams,
      returnTypes,
      nonDroppableReturns,
    });
  }

  // 3. Cross-step analysis: unconsumed non-droppable returns
  const consumedRefs = new Set<string>();
  for (const { step } of steps) {
    for (const arg of step.args) {
      if (arg.kind === "ref") {
        consumedRefs.add(`${arg.step}:${arg.returnIndex}`);
      }
    }
  }

  for (const v of validations) {
    for (const idx of v.nonDroppableReturns) {
      if (!consumedRefs.has(`${v.label}:${idx}`)) {
        warnings.push({
          stepLabel: v.label,
          code: "UNCONSUMED_RESOURCE",
          message: `Step "${v.label}" return[${idx}] (${v.returnTypes[idx]}) is non-droppable but not consumed by any subsequent step — add a deposit or use step`,
        });
      }
    }
  }

  return { validations, warnings };
}
