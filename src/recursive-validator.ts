import { parseOpenAPISpec } from "./parser.js";
import { validateOpenAPISpec } from "./validator.js";
import { validatePartialDocument } from "./partial-validator.js";
import { resolveAllReferences, findReferences } from "./ref-resolver.js";
import type {
  ValidationResult,
  ValidationError,
  ValidationOptions,
  OpenAPIVersion,
  OpenAPISpec,
} from "./types.js";
import { log } from "./logger.js";

export interface RecursiveValidationResult extends ValidationResult {
  partialValidations: Array<{
    path: string;
    result: ValidationResult;
    isCircular: boolean;
  }>;
  circularReferences: string[];
  totalDocuments: number;
  validDocuments: number;
}

/**
 * Recursively validate an OpenAPI specification and all its references
 */
export const validateRecursively = async (
  source: string,
  options: ValidationOptions = {}
): Promise<RecursiveValidationResult> => {
  // Parse the root document
  const rootParsed = await parseOpenAPISpec(source);

  // Validate the root document
  const rootValidation = validateOpenAPISpec(
    rootParsed.spec,
    rootParsed.version,
    options
  );

  // Resolve all references
  const { resolvedRefs, circularRefs } = await resolveAllReferences(
    rootParsed.spec,
    source,
    options.maxRefDepth || 10
  );

  log.info(`🔗 Following ${resolvedRefs.length} references...`);

  // Validate each resolved reference
  const partialValidations: Array<{
    path: string;
    result: ValidationResult;
    isCircular: boolean;
  }> = [];

  let validDocuments = rootValidation.valid ? 1 : 0;

  for (let i = 0; i < resolvedRefs.length; i++) {
    const ref = resolvedRefs[i];
    if (!ref) continue;

    if (ref.isCircular) {
      log.info(`🔄 Circular reference: ${ref.path}`);
      partialValidations.push({
        path: ref.path,
        result: {
          valid: false,
          errors: [
            {
              path: "/",
              message: "Circular reference detected",
            },
          ],
          warnings: [],
          spec: {} as OpenAPISpec,
          version: ref.version || "3.0",
        },
        isCircular: true,
      });
      continue;
    }

    if (ref.content === null) {
      continue;
    }

    // Determine the version for this partial document
    const version = ref.version || rootParsed.version;

    // Validate the partial document
    const partialResult = validatePartialDocument(
      ref.content,
      version,
      ref.path
    );

    partialValidations.push({
      path: ref.path,
      result: partialResult,
      isCircular: false,
    });

    if (partialResult.valid) {
      validDocuments++;
      log.info(`✅ Reference: ${ref.path}`);
    } else {
      log.info(
        `❌ Reference: ${ref.path} (${partialResult.errors.length} errors)`
      );
    }
  }

  // Combine all errors and warnings
  const allErrors: ValidationError[] = [...rootValidation.errors];
  const allWarnings: ValidationError[] = [...rootValidation.warnings];

  for (const partial of partialValidations) {
    allErrors.push(...partial.result.errors);
    allWarnings.push(...partial.result.warnings);
  }

  const result = {
    valid:
      rootValidation.valid && partialValidations.every((p) => p.result.valid),
    errors: allErrors,
    warnings: allWarnings,
    spec: rootParsed.spec,
    version: rootParsed.version,
    partialValidations,
    circularReferences: circularRefs,
    totalDocuments: 1 + partialValidations.length,
    validDocuments,
  };

  return result;
};

/**
 * Validate multiple OpenAPI specifications recursively
 */
export const validateMultipleRecursively = async (
  sources: string[],
  options: ValidationOptions = {}
): Promise<RecursiveValidationResult[]> => {
  log.startOperation("Multiple recursive validation");
  log.validationStep(
    "Starting batch validation",
    `${sources.length} specifications`
  );

  const results: RecursiveValidationResult[] = [];

  log.startProgress(sources.length, "Validating specifications");

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source) continue;

    log.updateProgress(i);
    log.fileOperation(
      "Processing specification",
      source,
      `${i + 1}/${sources.length}`
    );

    try {
      const result = await validateRecursively(source, options);
      results.push(result);
      log.validationStep("Specification validated", `Valid: ${result.valid}`);
    } catch (error) {
      log.error("Specification validation failed", {
        source,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Create error result for failed parsing
      const errorResult: RecursiveValidationResult = {
        valid: false,
        errors: [
          {
            path: "/",
            message: `Failed to parse specification: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
        ],
        warnings: [],
        spec: {} as OpenAPISpec,
        version: "3.0",
        partialValidations: [],
        circularReferences: [],
        totalDocuments: 0,
        validDocuments: 0,
      };
      results.push(errorResult);
    }
  }

  log.endProgress();
  log.endOperation("Multiple recursive validation", true);

  const validCount = results.filter((r) => r.valid).length;
  const invalidCount = results.length - validCount;
  log.validationStep(
    "Batch validation completed",
    `Valid: ${validCount}, Invalid: ${invalidCount}`
  );

  return results;
};

/**
 * Find all references in a document without resolving them. Internal refs
 * (`#/...`) are also analyzed for true cycles in the reference graph.
 *
 * "Circular" here means the proper definition: a $ref reachable from itself
 * via a chain of intermediate $refs (A -> B -> A). A component that is simply
 * referenced from multiple places is NOT circular.
 */
export const analyzeReferences = async (
  source: string
): Promise<{
  references: Array<{ path: string; value: string }>;
  circularReferences: string[];
  totalReferences: number;
}> => {
  log.startOperation("Analyzing references");
  log.fileOperation("Analyzing references", source);

  const parsed = await parseOpenAPISpec(source);
  log.validationStep("Parsing completed for reference analysis");

  const references = findReferences(parsed.spec);
  log.validationStep("References found", `${references.length} total`);

  log.validationStep("Detecting circular references");
  const circularReferences = detectCircularInternalRefs(
    parsed.spec as unknown,
    references
  );

  const result = {
    references,
    circularReferences,
    totalReferences: references.length,
  };

  log.endOperation("Analyzing references", true);
  log.validationStep(
    "Reference analysis completed",
    `Total: ${result.totalReferences}, Circular: ${result.circularReferences.length}`
  );

  return result;
};

/**
 * Walk the reference graph for INTERNAL ($ref starting with `#/`) refs and
 * return every node that participates in a cycle (DFS with stack tracking).
 */
const detectCircularInternalRefs = (
  rootDoc: unknown,
  references: Array<{ path: string; value: string }>
): string[] => {
  // Build adjacency: for each internal $ref target, find the refs reachable
  // from inside that target's resolved value.
  const adjacency = new Map<string, Set<string>>();

  const internalRefValues = new Set(
    references
      .map((r) => r.value)
      .filter((v) => typeof v === "string" && v.startsWith("#/"))
  );

  const resolvePointer = (ref: string): unknown => {
    const parts = ref
      .substring(2)
      .split("/")
      .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
    let current: unknown = rootDoc;
    for (const part of parts) {
      if (current && typeof current === "object") {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  };

  const collectChildRefs = (value: unknown, out: Set<string>): void => {
    if (Array.isArray(value)) {
      for (const v of value) collectChildRefs(v, out);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === "$ref" && typeof v === "string" && v.startsWith("#/")) {
          out.add(v);
        } else {
          collectChildRefs(v, out);
        }
      }
    }
  };

  for (const ref of internalRefValues) {
    const target = resolvePointer(ref);
    const children = new Set<string>();
    if (target !== undefined) collectChildRefs(target, children);
    adjacency.set(ref, children);
  }

  // Tarjan-style DFS to find any ref that participates in a cycle.
  const onStack = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();

  const dfs = (node: string, stack: string[]): void => {
    visited.add(node);
    onStack.add(node);
    stack.push(node);

    for (const next of adjacency.get(node) ?? []) {
      if (onStack.has(next)) {
        // Found a cycle; every node from `next` to the top of the stack is on it.
        const cycleStartIndex = stack.indexOf(next);
        if (cycleStartIndex >= 0) {
          for (let i = cycleStartIndex; i < stack.length; i++) {
            const member = stack[i];
            if (member) cyclic.add(member);
          }
        }
      } else if (!visited.has(next)) {
        dfs(next, stack);
      }
    }

    stack.pop();
    onStack.delete(node);
  };

  for (const node of internalRefValues) {
    if (!visited.has(node)) dfs(node, []);
  }

  return [...cyclic].sort();
};
