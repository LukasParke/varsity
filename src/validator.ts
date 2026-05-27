import Ajv from "ajv";
import type { JSONSchemaType } from "ajv";
import addFormats from "ajv-formats";
import type {
  ValidationResult,
  ValidationError,
  ValidationOptions,
  OpenAPIVersion,
  OpenAPISpec,
} from "./types.js";

import { allSchemas } from "oas-types/schemas";
import type { OpenAPI3_1, OpenAPI3_2, OpenAPI3, OpenAPI2 } from "oas-types";
import { log } from "./logger.js";

// Initialize AJV instance
const createAjvInstance = (customSchemas?: Record<string, JSONSchemaType<any>>): Ajv => {
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);
  if (customSchemas) {
    for (const [key, schema] of Object.entries(customSchemas)) {
      ajv.addSchema(schema as object, key);
    }
  }
  return ajv;
};

// Global instances
const ajv = createAjvInstance();

// Create schemas map from oas-types
const schemas = new Map<OpenAPIVersion, any>();
schemas.set("2.0", allSchemas["2.0"].specification);
schemas.set("3.0", allSchemas["3.0"].specification);
schemas.set("3.1", allSchemas["3.1"].specification);
schemas.set("3.2", allSchemas["3.2"].specification);

/**
 * Normalize OpenAPI version to the base version for schema lookup
 */
const normalizeVersion = (version: OpenAPIVersion): OpenAPIVersion => {
  if (version.startsWith("3.0")) {
    return "3.0";
  } else if (version.startsWith("3.1")) {
    return "3.1";
  } else if (version.startsWith("3.2")) {
    return "3.2";
  }
  return version;
};

/**
 * Find all $ref references in the specification
 */
const findReferences = (
  obj: OpenAPISpec,
  path = ""
): Array<{ path: string; value: string }> => {
  log.validationStep("Finding references in specification");

  const refs: Array<{ path: string; value: string }> = [];

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (key === "$ref" && typeof value === "string") {
        log.referenceStep("Found reference", value, `at ${currentPath}`);
        refs.push({ path: currentPath, value });
      } else if (typeof value === "object") {
        refs.push(...findReferences(value, currentPath));
      }
    }
  }

  log.validationStep(
    "Reference search completed",
    `Found ${refs.length} references`
  );
  return refs;
};

/**
 * Resolve a reference to check if it's valid
 */
const resolveReference = (
  spec: OpenAPISpec,
  ref: { path: string; value: string }
): boolean => {
  log.referenceStep("Resolving reference", ref.value, `from ${ref.path}`);

  // Simple reference resolution - in a real implementation, this would be more comprehensive
  if (ref.value.startsWith("#/")) {
    const path = ref.value.substring(2).split("/");
    let current = spec;

    for (const segment of path) {
      if (current && typeof current === "object" && segment in current) {
        current = (current as any)[segment];
        log.referenceStep(
          "Traversing path segment",
          segment,
          `current type: ${typeof current}`
        );
      } else {
        log.referenceStep(
          "Reference resolution failed",
          `segment '${segment}' not found`
        );
        return false;
      }
    }

    const isValid = current !== undefined;
    log.referenceStep(
      "Reference resolution completed",
      ref.value,
      `Valid: ${isValid}`
    );
    return isValid;
  }

  log.referenceStep("External reference not supported", ref.value);
  return false; // External references not supported in this simple implementation
};

/**
 * Perform strict validation checks
 */
const performStrictValidation = (
  spec: OpenAPISpec,
  version: OpenAPIVersion,
  errors: ValidationError[],
  warnings: ValidationError[]
): void => {
  log.validationStep("Performing strict validation checks");

  // Check for required fields based on version
  if (version === "2.0") {
    log.validationStep("Validating Swagger 2.0 strict requirements");
    const swaggerSpec = spec as OpenAPI2.Specification;
    if (!swaggerSpec.host) {
      log.validationStep("Missing host field in Swagger 2.0");
      errors.push({
        path: "/",
        message: 'Either "host" or "servers" must be specified in Swagger 2.0',
      });
    } else {
      log.validationStep("Host field found in Swagger 2.0", swaggerSpec.host);
    }
  } else {
    log.validationStep("Validating OpenAPI 3.x strict requirements");
    const openapiSpec = spec as
      | OpenAPI3.Specification
      | OpenAPI3_1.Specification
      | OpenAPI3_2.Specification;
    if (!openapiSpec.servers || openapiSpec.servers.length === 0) {
      log.validationStep("No servers specified in OpenAPI 3.x");
      warnings.push({
        path: "/",
        message: "No servers specified. Consider adding at least one server.",
      });
    } else {
      log.validationStep(
        "Servers found in OpenAPI 3.x",
        `${openapiSpec.servers.length} servers`
      );
    }
  }

  // Check for security definitions
  log.validationStep("Validating security definitions");
  if (version === "2.0") {
    const swaggerSpec = spec as OpenAPI2.Specification;
    if (
      swaggerSpec.security &&
      swaggerSpec.security.length > 0 &&
      !swaggerSpec.securityDefinitions
    ) {
      log.validationStep("Security used without definitions in Swagger 2.0");
      errors.push({
        path: "/",
        message: "Security schemes must be defined when using security",
      });
    } else if (swaggerSpec.securityDefinitions) {
      log.validationStep(
        "Security definitions found in Swagger 2.0",
        `${Object.keys(swaggerSpec.securityDefinitions).length} schemes`
      );
    }
  } else {
    const openapiSpec = spec as
      | OpenAPI3.Specification
      | OpenAPI3_1.Specification
      | OpenAPI3_2.Specification;
    if (
      openapiSpec.security &&
      openapiSpec.security.length > 0 &&
      !openapiSpec.components?.securitySchemes
    ) {
      log.validationStep("Security used without schemes in OpenAPI 3.x");
      errors.push({
        path: "/",
        message: "Security schemes must be defined when using security",
      });
    } else if (openapiSpec.components?.securitySchemes) {
      log.validationStep(
        "Security schemes found in OpenAPI 3.x",
        `${Object.keys(openapiSpec.components.securitySchemes).length} schemes`
      );
    }
  }

  log.validationStep(
    "Strict validation completed",
    `Errors: ${errors.length}, Warnings: ${warnings.length}`
  );
};

/**
 * Validate `example` / `examples` values against their declared `schema`.
 *
 * Walks the entire spec tree looking for objects that carry both a `schema`
 * and one or more `example` / `examples` siblings (the canonical OpenAPI
 * shape for parameters, headers, request bodies' media types, response
 * media types, etc.). Compiles each schema with AJV and validates every
 * example value, recording AJV errors as validation errors and warnings.
 *
 * Schemas that contain `$ref` are skipped (we don't resolve refs here);
 * those are validated indirectly via the recursive validator.
 */
const validateExamples = (
  spec: OpenAPISpec,
  _version: OpenAPIVersion,
  errors: ValidationError[],
  warnings: ValidationError[]
): void => {
  log.validationStep("Validating examples in specification");

  let exampleCount = 0;
  let invalidCount = 0;

  const containsRef = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(containsRef);
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === "$ref") return true;
        if (containsRef(v)) return true;
      }
    }
    return false;
  };

  const validateOne = (
    schema: unknown,
    example: unknown,
    pathStr: string
  ): void => {
    exampleCount++;
    if (containsRef(schema)) {
      // Skip schemas containing $ref; AJV would need a fully-resolved
      // schema for those. Recursive validation handles that path.
      return;
    }
    try {
      const validateFn = ajv.compile(schema as object);
      const ok = validateFn(example);
      if (!ok && validateFn.errors) {
        for (const err of validateFn.errors) {
          invalidCount++;
          warnings.push({
            path: `${pathStr}${err.instancePath || ""}`,
            message: `Example does not match schema: ${err.message ?? "unknown error"}`,
            data: err.data,
            schemaPath: err.schemaPath,
          });
        }
      }
    } catch (e) {
      warnings.push({
        path: pathStr,
        message: `Could not compile schema for example check: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      });
    }
  };

  const walk = (value: unknown, currentPath: string): void => {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${currentPath}[${i}]`);
      }
      return;
    }
    if (!value || typeof value !== "object") return;

    const node = value as Record<string, unknown>;
    const schema = node.schema;

    if (schema !== undefined && typeof schema === "object") {
      if (node.example !== undefined) {
        validateOne(schema, node.example, `${currentPath}.example`);
      }
      if (node.examples && typeof node.examples === "object") {
        for (const [name, ex] of Object.entries(
          node.examples as Record<string, unknown>
        )) {
          // OpenAPI 3.x Example Object wraps the value under .value
          const value =
            ex && typeof ex === "object" && "value" in (ex as object)
              ? (ex as { value: unknown }).value
              : ex;
          validateOne(schema, value, `${currentPath}.examples.${name}`);
        }
      }
    }

    for (const [k, v] of Object.entries(node)) {
      walk(v, currentPath ? `${currentPath}.${k}` : k);
    }
  };

  walk(spec, "");

  log.validationStep(
    "Example validation completed",
    `Checked ${exampleCount} example(s), ${invalidCount} did not match their schema`
  );

  // Note: example mismatches are recorded as warnings (not errors) so they
  // don't fail otherwise-valid specs. They appear in `result.warnings`.
  void errors;
};

/**
 * Validate references in the specification.
 *
 * This shallow check only verifies that internal pointers (`#/...`) resolve
 * inside the document. External file/URL refs cannot be resolved without
 * fetching, so they are skipped here — use the `--recursive` option (which
 * routes through `validateRecursively`) for full reference validation.
 */
const validateReferences = (
  spec: OpenAPISpec,
  version: OpenAPIVersion,
  errors: ValidationError[],
  warnings: ValidationError[]
): void => {
  log.validationStep("Validating references in specification");

  const refs = findReferences(spec);
  let validRefs = 0;
  let brokenRefs = 0;
  let skippedExternal = 0;

  for (const ref of refs) {
    if (!ref.value.startsWith("#/")) {
      // External or URL ref — not in scope for the shallow check.
      skippedExternal++;
      warnings.push({
        path: ref.path,
        message: `External reference skipped by shallow validation: ${ref.value}. Use recursive validation to resolve it.`,
      });
      continue;
    }
    if (!resolveReference(spec, ref)) {
      log.referenceStep("Broken reference found", ref.value, `at ${ref.path}`);
      errors.push({
        path: ref.path,
        message: `Broken reference: ${ref.value}`,
      });
      brokenRefs++;
    } else {
      validRefs++;
    }
  }

  log.validationStep(
    "Reference validation completed",
    `Valid: ${validRefs}, Broken: ${brokenRefs}, External (skipped): ${skippedExternal}`
  );
};

/**
 * Validate an OpenAPI specification
 */
export const validateOpenAPISpec = (
  spec: OpenAPISpec,
  version: OpenAPIVersion,
  options: ValidationOptions = {}
): ValidationResult => {
  log.startOperation("Validating OpenAPI specification");
  log.validationStep("Initializing validation", `Version: ${version}`);

  const normalizedVersion = normalizeVersion(version);
  log.validationStep("Normalized version", normalizedVersion);

  const schema = schemas.get(normalizedVersion);
  if (!schema) {
    log.error("No schema available for version", {
      version,
      normalizedVersion,
    });
    throw new Error(
      `No schema available for OpenAPI version: ${version} (normalized to ${normalizedVersion})`
    );
  }

  log.validationStep("Compiling schema for validation");
  const validationAjv = options.customSchemas
    ? createAjvInstance(options.customSchemas)
    : ajv;
  const validate = validationAjv.compile(schema);
  log.validationStep("Running schema validation");
  const valid = validate(spec);

  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  if (!valid && validate.errors) {
    log.validationStep(
      "Schema validation found errors",
      `${validate.errors.length} errors`
    );
    for (const error of validate.errors) {
      const validationError: ValidationError = {
        path: error.instancePath || error.schemaPath || "/",
        message: error.message || "Validation error",
        data: error.data,
        schemaPath: error.schemaPath,
      };

      if (
        options.strictSchema !== false ||
        error.keyword === "required" ||
        error.keyword === "type"
      ) {
        log.validationStep(
          "Schema validation error",
          `${error.keyword}: ${validationError.message}`
        );
        errors.push(validationError);
      } else {
        log.validationStep(
          "Schema validation warning",
          `${error.keyword}: ${validationError.message}`
        );
        warnings.push(validationError);
      }
    }
  } else {
    log.validationStep("Schema validation passed");
  }

  // Additional custom validations
  if (options.strict) {
    log.validationStep("Running strict validation");
    performStrictValidation(spec, version, errors, warnings);
  }

  if (options.validateExamples) {
    log.validationStep("Running example validation");
    validateExamples(spec, version, errors, warnings);
  }

  if (options.validateReferences) {
    log.validationStep("Running reference validation");
    validateReferences(spec, version, errors, warnings);
  }

  const result = {
    valid: errors.length === 0,
    errors,
    warnings,
    spec,
    version,
  };

  log.endOperation("Validating OpenAPI specification", result.valid);
  log.validationStep(
    "Validation completed",
    `Valid: ${result.valid}, Errors: ${errors.length}, Warnings: ${warnings.length}`
  );

  return result;
};
