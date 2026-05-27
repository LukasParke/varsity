import { log } from "./logger.js";
import { parseOpenAPISpec } from "./parser.js";
import {
	analyzeReferences,
	validateMultipleRecursively,
	validateRecursively,
} from "./recursive-validator.js";
import { generateReport, saveReport } from "./reporter.js";
import {
	analyzeSpecification,
	generateDetailedSummary,
	generateJSONSummary,
} from "./summary-analyzer.js";
import {
	partitionByTags,
	partitionSpecByTags,
	writePartitionPlan,
} from "./partitioner.js";
import type {
	DocumentInput,
	OpenAPISpec,
	ParsedSpec,
	RecursiveValidationResult,
	ReportOptions,
	ValidationOptions,
	ValidationResult,
	VarsityConfig,
} from "./types.js";
import { validateOpenAPISpec } from "./validator.js";

// Default configuration
const defaultConfig: VarsityConfig = {
	defaultVersion: "3.0",
	strictMode: false,
	customSchemas: {},
	reportFormats: ["json"],
};

const formatSource = (source: DocumentInput): string => {
	if (typeof source === "string") return source;
	if ("kind" in source) {
		if (source.kind === "path") return source.path;
		if (source.kind === "url") return source.url;
		return source.source ?? `<${source.kind}>`;
	}
	return "<object>";
};

const configureLibraryLogging = (
	config: VarsityConfig = defaultConfig,
	options: ValidationOptions = {},
): void => {
	if (config.silent || options.silent) {
		log.setLevel("SILENT");
	}
};

const buildValidationOptions = (
	options: ValidationOptions,
	config: VarsityConfig,
): ValidationOptions => ({
	strict: options.strict ?? config.strictMode,
	validateExamples: options.validateExamples ?? false,
	validateReferences: options.validateReferences ?? false,
	customSchemas: {
		...(config.customSchemas ?? {}),
		...(options.customSchemas ?? {}),
	},
	maxRefDepth: options.maxRefDepth,
	recursive: options.recursive,
	strictSchema: options.strictSchema,
	silent: options.silent ?? config.silent,
});

/**
 * Parse and validate an OpenAPI specification or multiple specifications
 */
export const validate = async (
	source: DocumentInput | DocumentInput[],
	options: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<ValidationResult | ValidationResult[]> => {
	const validationConfig = buildValidationOptions(options, config);
	configureLibraryLogging(config, options);

	// If source is an array, validate multiple specifications
	if (Array.isArray(source)) {
		const results: ValidationResult[] = [];

		for (let i = 0; i < source.length; i++) {
			const singleSource = source[i];
			if (!singleSource) continue;

			log.info(`📄 Parsing: ${formatSource(singleSource)}`);
			try {
				const result = await validateSingle(singleSource, validationConfig, config);
				results.push(result);
				log.info(
					`✅ Validated: ${formatSource(singleSource)} - ${
						result.valid ? "Valid" : "Invalid"
					}`,
				);
			} catch (error) {
				log.error(
					`❌ Failed: ${formatSource(singleSource)} - ${
						error instanceof Error ? error.message : "Unknown error"
					}`,
				);

				// Create error result for failed parsing
				const errorResult: ValidationResult = {
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
					version: config.defaultVersion!,
				};
				results.push(errorResult);
			}
		}

		const validCount = results.filter((r) => r.valid).length;
		const invalidCount = results.length - validCount;
		log.info(`📊 Summary: ${validCount} valid, ${invalidCount} invalid`);

		return results;
	}

	// Single specification validation
	log.info(`📄 Parsing: ${formatSource(source)}`);
	const result = await validateSingle(source, validationConfig, config);
	log.info(
		`✅ Validated: ${formatSource(source)} - ${result.valid ? "Valid" : "Invalid"}`,
	);

	return result;
};

/**
 * Internal function to validate a single OpenAPI specification
 */
const validateSingle = async (
	source: DocumentInput,
	options: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<ValidationResult> => {
	const parsed = await parseOpenAPISpec(source);

	// If recursive validation is requested, use the recursive validator
	if (options.recursive) {
		const recursiveResult = await validateRecursively(
			source,
			options,
		);

		return {
			valid: recursiveResult.valid,
			errors: recursiveResult.errors,
			warnings: recursiveResult.warnings,
			spec: recursiveResult.spec,
			version: recursiveResult.version,
		};
	}

	const result = validateOpenAPISpec(
		parsed.spec,
		parsed.version,
		options,
	);

	return result;
};

/**
 * Parse an OpenAPI specification without validation
 */
export const parse = async (source: DocumentInput): Promise<ParsedSpec> => {
	configureLibraryLogging(defaultConfig);
	log.startOperation("Parsing OpenAPI specification");
	log.fileOperation("Parsing specification", formatSource(source));

	const result = await parseOpenAPISpec(source);

	log.endOperation("Parsing OpenAPI specification", true);
	log.validationStep(
		"Parsing completed",
		`Version: ${result.version}, Title: ${
			result.metadata.title
		}, HasPaths: ${!!result.spec.paths}`,
	);

	return result;
};

/**
 * Generate a validation report
 */
export const generateValidationReport = async (
	source: DocumentInput,
	reportOptions: ReportOptions,
	validationOptions: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<string> => {
	log.startOperation("Generating validation report");
	log.fileOperation("Generating report", formatSource(source));

	const result = await validate(source, validationOptions, config);
	// Since source is a string, result will be ValidationResult, not ValidationResult[]
	const validationResult = result as ValidationResult;

	log.validationStep("Generating report", `Format: ${reportOptions.format}`);
	const report = generateReport(validationResult, reportOptions);

	log.endOperation("Generating validation report", true);
	log.validationStep(
		"Report generated",
		`Format: ${reportOptions.format}, Valid: ${validationResult.valid}, Errors: ${validationResult.errors.length}, Warnings: ${validationResult.warnings.length}`,
	);

	return report;
};

/**
 * Save a validation report to file
 */
export const saveValidationReport = async (
	source: DocumentInput,
	reportOptions: ReportOptions,
	validationOptions: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<void> => {
	const report = await generateValidationReport(
		source,
		reportOptions,
		validationOptions,
		config,
	);
	if (reportOptions.output) {
		saveReport(report, reportOptions.output);
	} else {
		log.info(report);
	}
};

/**
 * Recursively validate an OpenAPI specification and all its references
 */
export const validateWithReferences = async (
	source: DocumentInput,
	options: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<RecursiveValidationResult> => {
	configureLibraryLogging(config, options);
	return validateRecursively(source, {
		...buildValidationOptions(options, config),
		recursive: true,
	});
};

/**
 * Recursively validate multiple OpenAPI specifications
 */
export const validateMultipleWithReferences = async (
	sources: DocumentInput[],
	options: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<RecursiveValidationResult[]> => {
	configureLibraryLogging(config, options);
	return validateMultipleRecursively(sources, {
		...buildValidationOptions(options, config),
		recursive: true,
	});
};

/**
 * Analyze references in an OpenAPI specification
 */
export const analyzeDocumentReferences = async (source: DocumentInput) => {
	log.startOperation("Analyzing document references");
	log.fileOperation("Analyzing references", formatSource(source));

	const result = await analyzeReferences(source);

	log.endOperation("Analyzing document references", true);
	log.validationStep(
		"Reference analysis completed",
		`Total: ${result.totalReferences}, Circular: ${result.circularReferences.length}`,
	);

	return result;
};

/**
 * Generate a comprehensive summary of an OpenAPI specification
 */
export const generateSpecificationSummary = async (
	source: DocumentInput,
	validationOptions: ValidationOptions = {},
	config: VarsityConfig = defaultConfig,
): Promise<{
	summary: any;
	detailedSummary: string;
	jsonSummary: string;
}> => {
	log.startOperation("Generating specification summary");
	log.fileOperation("Generating summary", formatSource(source));

	// Parse the specification
	const parsed = await parseOpenAPISpec(source);
	log.validationStep(
		"Specification parsed for summary",
		`Version: ${parsed.version}`,
	);

	// Validate if requested
	let validationResults;
	if (
		validationOptions.strict ||
		validationOptions.validateExamples ||
		validationOptions.validateReferences
	) {
		log.validationStep("Running validation for summary");
		const validation = await validate(source, validationOptions, config);
		const result = Array.isArray(validation) ? validation[0] : validation;
		if (result) {
			validationResults = {
				valid: result.valid,
				errors: result.errors.length,
				warnings: result.warnings.length,
				processingTime: 0, // This would be calculated from actual timing
			};
		}
	}

	// Analyze the specification
	log.validationStep("Analyzing specification structure");
	const summary = analyzeSpecification(
		parsed.spec,
		parsed.version,
		validationResults,
	);

	// Generate detailed summary
	log.validationStep("Generating detailed summary");
	const detailedSummary = generateDetailedSummary(summary);

	// Generate JSON summary
	log.validationStep("Generating JSON summary");
	const jsonSummary = generateJSONSummary(summary);

	log.endOperation("Generating specification summary", true);
	log.validationStep(
		"Summary generation completed",
		`Version: ${summary.version}, Paths: ${summary.paths}, Endpoints: ${summary.endpoints}, Components: ${summary.components}, Valid: ${summary.validationResults.valid}`,
	);

	return {
		summary,
		detailedSummary,
		jsonSummary,
	};
};

/**
 * Get supported OpenAPI versions
 */
export const getSupportedVersions = (): string[] => {
	return [
		"2.0",
		"3.0.0",
		"3.0.1",
		"3.0.2",
		"3.0.3",
		"3.0.4",
		"3.1.0",
		"3.1.1",
		"3.2.0",
	];
};

/**
 * Create a Varsity instance with configuration
 */
export const createVarsity = (config: VarsityConfig = {}) => {
	const mergedConfig = { ...defaultConfig, ...config };

	return {
		validate: (
			source: DocumentInput | DocumentInput[],
			options: ValidationOptions = {},
		) =>
			validate(source, options, mergedConfig),
		validateWithReferences: (
			source: DocumentInput,
			options: ValidationOptions = {},
		) => validateWithReferences(source, options, mergedConfig),
		validateMultipleWithReferences: (
			sources: DocumentInput[],
			options: ValidationOptions = {},
		) => validateMultipleWithReferences(sources, options, mergedConfig),
		parse: (source: DocumentInput) => parse(source),
		analyze: (source: DocumentInput) => analyzeDocumentReferences(source),
		generateReport: (
			source: DocumentInput,
			reportOptions: ReportOptions,
			validationOptions: ValidationOptions = {},
		) =>
			generateValidationReport(
				source,
				reportOptions,
				validationOptions,
				mergedConfig,
			),
		summary: (source: DocumentInput, options: ValidationOptions = {}) =>
			generateSpecificationSummary(source, options, mergedConfig),
		partitionByTags,
		partitionSpecByTags,
		writePartitionPlan,
		getSupportedVersions,
		getConfig: () => ({ ...mergedConfig }),
		updateConfig: (newConfig: Partial<VarsityConfig>) => {
			Object.assign(mergedConfig, newConfig);
		},
	};
};

export { Logger, log } from "./logger.js";
// Export individual functions for direct use
export { parseOpenAPISpec, validateBasicStructure } from "./parser.js";
export { validatePartialDocument } from "./partial-validator.js";
export {
	analyzeReferences,
	validateMultipleRecursively,
	validateRecursively,
} from "./recursive-validator.js";
// Export types from other modules
export type { ReferenceContext, ResolvedReference } from "./ref-resolver.js";
export {
	findReferences,
	resolveAllReferences,
	resolveReference,
} from "./ref-resolver.js";
export { generateReport, saveReport } from "./reporter.js";
export type { SerializationFormat } from "./serializer.js";
export {
	detectFormatFromPath,
	extensionFor,
	serialize,
} from "./serializer.js";
export type {
	BucketedPathItem,
	PartitionFile,
	PartitionOptions,
	PartitionPlan,
	PartitionTag,
	TagBucket,
	WriteOptions,
	WriteResult,
} from "./partitioner.js";
export {
	collectTagBuckets,
	describePartitionPlan,
	slugify,
	slugifyPath,
	partitionByTags,
	partitionSpecByTags,
	writePartitionPlan,
} from "./partitioner.js";
export {
	analyzeSpecification,
	generateDetailedSummary,
	generateJSONSummary,
} from "./summary-analyzer.js";
export type {
	CLIResult,
	OpenAPIVersion,
	ParsedSpec,
	RecursiveValidationResult,
	ReportOptions,
	ValidationError,
	ValidationOptions,
	ValidationResult,
	VarsityConfig,
} from "./types.js";
export { validateOpenAPISpec } from "./validator.js";

// Default export - create a default instance
export default createVarsity();
