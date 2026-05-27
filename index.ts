// Main functional exports
export {
  validate,
  parse,
  generateValidationReport,
  saveValidationReport,
  validateWithReferences,
  validateMultipleWithReferences,
  analyzeDocumentReferences,
  generateSpecificationSummary,
  analyzeSpecification,
  generateDetailedSummary,
  generateJSONSummary,
  getSupportedVersions,
  createVarsity,
  // Individual module exports
  parseOpenAPISpec,
  validateBasicStructure,
  validateOpenAPISpec,
  generateReport,
  saveReport,
  // Recursive validation exports
  validateRecursively,
  validateMultipleRecursively,
  analyzeReferences,
  // Reference resolver exports
  resolveReference,
  findReferences,
  resolveAllReferences,
  // Partial validation exports
  validatePartialDocument,
  // Partitioner exports
  partitionByTags,
  partitionSpecByTags,
  writePartitionPlan,
  describePartitionPlan,
  collectTagBuckets,
  slugify,
  slugifyPath,
  // Serializer exports
  serialize,
  extensionFor,
  detectFormatFromPath,
} from "./src/varsity.js";

// Type exports
export type {
  ParsedSpec,
  ValidationResult,
  ValidationError,
  ValidationOptions,
  ReportOptions,
  VarsityConfig,
  OpenAPIVersion,
  CLIResult,
  RecursiveValidationResult,
  DocumentInput,
} from "./src/types.js";

// Export types from other modules
export type {
  ResolvedReference,
  ReferenceContext,
} from "./src/ref-resolver.js";

export type {
  PartitionOptions,
  PartitionPlan,
  PartitionTag,
  PartitionFile,
  TagBucket,
  BucketedPathItem,
  WriteResult,
  WriteOptions,
} from "./src/partitioner.js";

export type { SerializationFormat } from "./src/serializer.js";

export type { SpecificationSummary } from "./src/summary-analyzer.js";

// Default export - functional instance
export { default } from "./src/varsity.js";
