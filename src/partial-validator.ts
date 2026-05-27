import Ajv from "ajv";
import addFormats from "ajv-formats";
import { allSchemas } from "oas-types/schemas";
import type {
  OpenAPIVersion,
  ValidationError,
  ValidationResult,
} from "./types.js";

// Initialize AJV instance for partial validation
const createPartialAjvInstance = (): Ajv => {
  const ajv = new Ajv({
    allErrors: true,
    verbose: true,
    strict: false,
    validateFormats: true,
  });
  addFormats(ajv);
  return ajv;
};

const partialAjv = createPartialAjvInstance();

// Schema map for partial documents
const partialSchemas = new Map<string, any>();

// Initialize partial schemas
partialSchemas.set("2.0.schema", allSchemas["2.0"].schema);
partialSchemas.set("2.0.parameter", allSchemas["2.0"].parameter);
partialSchemas.set("2.0.response", allSchemas["2.0"].response);
partialSchemas.set("2.0.pathitem", allSchemas["2.0"].pathitem);

partialSchemas.set("3.0.schema", allSchemas["3.0"].schema);
partialSchemas.set("3.0.parameter", allSchemas["3.0"].parameter);
partialSchemas.set("3.0.response", allSchemas["3.0"].response);
partialSchemas.set("3.0.pathitem", allSchemas["3.0"].pathitem);
partialSchemas.set("3.0.requestbody", allSchemas["3.0"].requestbody);
partialSchemas.set("3.0.header", allSchemas["3.0"].header);
partialSchemas.set("3.0.example", allSchemas["3.0"].example);
partialSchemas.set("3.0.link", allSchemas["3.0"].link);
partialSchemas.set("3.0.callback", allSchemas["3.0"].callback);
partialSchemas.set("3.0.securityscheme", allSchemas["3.0"].securityscheme);

partialSchemas.set("3.1.schema", allSchemas["3.1"].schema);
partialSchemas.set("3.1.parameter", allSchemas["3.1"].parameter);
partialSchemas.set("3.1.response", allSchemas["3.1"].response);
partialSchemas.set("3.1.pathitem", allSchemas["3.1"].pathitem);
partialSchemas.set("3.1.requestbody", allSchemas["3.1"].requestbody);
partialSchemas.set("3.1.header", allSchemas["3.1"].header);
partialSchemas.set("3.1.example", allSchemas["3.1"].example);
partialSchemas.set("3.1.link", allSchemas["3.1"].link);
partialSchemas.set("3.1.callback", allSchemas["3.1"].callback);
partialSchemas.set("3.1.securityscheme", allSchemas["3.1"].securityscheme);

partialSchemas.set("3.2.schema", allSchemas["3.2"].schema);
partialSchemas.set("3.2.parameter", allSchemas["3.2"].parameter);
partialSchemas.set("3.2.response", allSchemas["3.2"].response);
partialSchemas.set("3.2.pathitem", allSchemas["3.2"].pathitem);
partialSchemas.set("3.2.requestbody", allSchemas["3.2"].requestbody);
partialSchemas.set("3.2.header", allSchemas["3.2"].header);
partialSchemas.set("3.2.example", allSchemas["3.2"].example);
partialSchemas.set("3.2.link", allSchemas["3.2"].link);
partialSchemas.set("3.2.callback", allSchemas["3.2"].callback);
partialSchemas.set("3.2.securityscheme", allSchemas["3.2"].securityscheme);

/**
 * Detect the type of partial document based on its structure
 */
const detectPartialType = (
  doc: any,
  version: OpenAPIVersion
): string | null => {
  // Check for schema-like structure
  if (
    doc.type ||
    doc.properties ||
    doc.items ||
    doc.allOf ||
    doc.oneOf ||
    doc.anyOf
  ) {
    return "schema";
  }

  // Check for parameter-like structure
  if (doc.name && (doc.in || doc.parameter)) {
    return "parameter";
  }

  // Check for response-like structure
  if (doc.description && (doc.content || doc.schema || doc.headers)) {
    return "response";
  }

  // Check for path item-like structure
  if (
    doc.get ||
    doc.post ||
    doc.put ||
    doc.delete ||
    doc.patch ||
    doc.head ||
    doc.options
  ) {
    return "pathitem";
  }

  // Check for request body-like structure
  if (doc.content && !doc.description) {
    return "requestbody";
  }

  // Check for header-like structure
  if (doc.schema && !doc.name) {
    return "header";
  }

  // Check for example-like structure
  if (doc.summary || doc.description || doc.value !== undefined) {
    return "example";
  }

  // Check for link-like structure
  if (doc.operationRef || doc.operationId) {
    return "link";
  }

  // Check for callback-like structure
  if (doc.expression && typeof doc.expression === "string") {
    return "callback";
  }

  // Check for security scheme-like structure
  if (doc.type && (doc.flows || doc.openIdConnectUrl || doc.scheme)) {
    return "securityscheme";
  }

  return null;
};

/**
 * Normalize a patch-versioned OpenAPI version (e.g. `3.0.3`) into the base
 * version used to key partial schemas (`3.0`, `3.1`, `3.2`).
 */
const normalizePartialVersion = (version: OpenAPIVersion): string => {
  if (version.startsWith("3.0")) return "3.0";
  if (version.startsWith("3.1")) return "3.1";
  if (version.startsWith("3.2")) return "3.2";
  return version;
};

/**
 * Validate a partial OpenAPI document
 */
export const validatePartialDocument = (
  document: any,
  version: OpenAPIVersion,
  documentPath?: string
): ValidationResult => {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  // Detect the type of partial document
  const partialType = detectPartialType(document, version);

  if (!partialType) {
    errors.push({
      path: "/",
      message:
        "Unable to determine document type. This doesn't appear to be a valid OpenAPI partial document.",
    });

    return {
      valid: false,
      errors,
      warnings,
      spec: document,
      version,
    };
  }

  // Get the appropriate schema for this partial document type. Partial
  // schemas are keyed by the base version (3.0/3.1/3.2), so normalize first.
  const schemaKey = `${normalizePartialVersion(version)}.${partialType}`;
  const schema = partialSchemas.get(schemaKey);

  if (!schema) {
    errors.push({
      path: "/",
      message: `No validation schema available for ${partialType} in OpenAPI ${version}`,
    });

    return {
      valid: false,
      errors,
      warnings,
      spec: document,
      version,
    };
  }

  // Validate against the schema
  const validate = partialAjv.compile(schema);
  const valid = validate(document);

  if (!valid && validate.errors) {
    for (const error of validate.errors) {
      const validationError: ValidationError = {
        path: error.instancePath || error.schemaPath || "/",
        message: error.message || "Validation error",
        data: error.data,
        schemaPath: error.schemaPath,
      };

      if (error.keyword === "required" || error.keyword === "type") {
        errors.push(validationError);
      } else {
        warnings.push(validationError);
      }
    }
  }

  // Add document path information to errors if available
  if (documentPath) {
    errors.forEach((error) => {
      error.path = `${documentPath}${error.path}`;
    });
    warnings.forEach((warning) => {
      warning.path = `${documentPath}${warning.path}`;
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    spec: document,
    version,
  };
};
