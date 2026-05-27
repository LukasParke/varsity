#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import type { SerializationFormat } from "./serializer.js";
import { detectFormatFromPath } from "./serializer.js";
import type {
  RecursiveValidationResult,
  ReportOptions,
  ValidationOptions,
  ValidationResult,
} from "./types.js";
import {
  analyzeDocumentReferences,
  describePartitionPlan,
  generateSpecificationSummary,
  generateValidationReport,
  getSupportedVersions,
  log,
  parse,
  partitionSpecByTags,
  saveValidationReport,
  validate,
  validateMultipleWithReferences,
  validateWithReferences,
  writePartitionPlan,
} from "./varsity.js";
import pkg from "../package.json" with { type: "json" };

const program = new Command();

const stdout = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const stderr = (message = ""): void => {
  process.stderr.write(`${message}\n`);
};

const configureLogging = (options: {
  verbose?: boolean;
  progress?: boolean;
  colors?: boolean;
  json?: boolean;
}): void => {
  log.configure({
    verbose: !!options.verbose,
    level: options.verbose ? "INFO" : "WARN",
    showProgress:
      options.progress !== false && !options.json && Boolean(process.stderr.isTTY),
    useColors:
      options.colors !== false &&
      Boolean(process.stderr.isTTY) &&
      process.env.NO_COLOR === undefined,
  });
};

const parsePositiveInteger = (value: unknown, optionName: string): number => {
  const text = String(value);
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || String(parsed) !== text) {
    throw new Error(`${optionName} must be a positive integer (got '${text}').`);
  }
  return parsed;
};

const validationOptionsFrom = (options: any): ValidationOptions => ({
  strict: !!options.strict,
  validateExamples: !!options.examples,
  validateReferences: !!options.references,
  recursive: !!options.recursive,
  maxRefDepth: parsePositiveInteger(options.maxDepth ?? "10", "--max-depth"),
});

type AnyValidationResult = ValidationResult | RecursiveValidationResult;

const summarizeValidation = (
  sources: string[],
  results: AnyValidationResult[],
) => {
  const validCount = results.filter((result) => result.valid).length;
  const errors = results.reduce((sum, result) => sum + result.errors.length, 0);
  const warnings = results.reduce(
    (sum, result) => sum + result.warnings.length,
    0,
  );

  return {
    valid: validCount === results.length,
    summary: {
      total: sources.length,
      valid: validCount,
      invalid: results.length - validCount,
      errors,
      warnings,
    },
    results: results.map((result, index) => ({
      source: sources[index],
      valid: result.valid,
      version: result.version,
      errors: result.errors,
      warnings: result.warnings,
      ...("totalDocuments" in result
        ? {
            recursive: true,
            totalDocuments: result.totalDocuments,
            validDocuments: result.validDocuments,
            circularReferences: result.circularReferences,
            partialValidations: result.partialValidations,
          }
        : { recursive: false }),
    })),
  };
};

const printValidationHuman = (
  payload: ReturnType<typeof summarizeValidation>,
  verbose: boolean,
): void => {
  stderr("Validation Results");
  stderr("=".repeat(50));

  for (const result of payload.results) {
    stderr(`\n${result.source}`);
    stderr(result.valid ? "  Valid" : "  Invalid");
    stderr(`  Version: ${result.version}`);
    if ("totalDocuments" in result && result.totalDocuments !== undefined) {
      stderr(`  Documents: ${result.validDocuments}/${result.totalDocuments} valid`);
      if (result.circularReferences.length > 0) {
        stderr(`  Circular references: ${result.circularReferences.length}`);
      }
    }
    stderr(`  Errors: ${result.errors.length}`);
    stderr(`  Warnings: ${result.warnings.length}`);

    if (!result.valid || verbose) {
      for (const error of result.errors) {
        stderr(`    - ${error.path}: ${error.message}`);
      }
      if (verbose) {
        for (const warning of result.warnings) {
          stderr(`    - warning ${warning.path}: ${warning.message}`);
        }
      }
    }
  }

  stderr("\n" + "=".repeat(50));
  stderr(
    `Summary: ${payload.summary.valid} valid, ${payload.summary.invalid} invalid, ${payload.summary.errors} errors, ${payload.summary.warnings} warnings`,
  );
};

program
  .name("varsity")
  .description(
    "Comprehensive OpenAPI parsing and validation library (supports JSON and YAML)",
  )
  .version(pkg.version);

program
  .command("validate")
  .description("Validate one or more OpenAPI specifications")
  .argument(
    "<sources...>",
    "Path(s), URL(s), or '-' for stdin OpenAPI specification(s) (JSON or YAML)",
  )
  .option("-s, --strict", "Enable strict validation mode")
  .option("-e, --examples", "Validate examples in the specification")
  .option("-r, --references", "Validate internal references")
  .option("--recursive", "Recursively validate all $ref references")
  .option("--max-depth <depth>", "Maximum reference depth", "10")
  .option("-v, --verbose", "Show detailed output")
  .option("-j, --json", "Output as JSON")
  .option("--no-progress", "Disable progress indicators")
  .option("--no-colors", "Disable colored output")
  .action(async (sources: string[], options: any) => {
    configureLogging(options);
    try {
      const validationOptions = validationOptionsFrom(options);
      const results = options.recursive
        ? sources.length === 1
          ? [await validateWithReferences(sources[0]!, validationOptions)]
          : await validateMultipleWithReferences(sources, validationOptions)
        : await validate(
            sources.length === 1 ? sources[0]! : sources,
            validationOptions,
          );

      const resultArray = (Array.isArray(results) ? results : [results]) as
        AnyValidationResult[];
      const payload = summarizeValidation(sources, resultArray);

      if (options.json) {
        stdout(JSON.stringify(payload, null, 2));
      } else {
        printValidationHuman(payload, !!options.verbose);
      }

      if (!payload.valid) process.exit(1);
    } catch (error) {
      stderr(
        `Validation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      process.exit(1);
    }
  });

program
  .command("parse")
  .description("Parse an OpenAPI specification without validation")
  .argument("<source>", "Path, URL, or '-' for stdin OpenAPI specification")
  .option("-j, --json", "Output as JSON")
  .option("-v, --verbose", "Show detailed output")
  .option("--no-progress", "Disable progress indicators")
  .option("--no-colors", "Disable colored output")
  .action(async (source: string, options: any) => {
    configureLogging(options);
    try {
      const parsed = await parse(source);
      if (options.json) {
        stdout(JSON.stringify(parsed, null, 2));
      } else {
        stderr("Parsed OpenAPI Specification");
        stderr(`OpenAPI Version: ${parsed.version}`);
        stderr(`Source: ${parsed.source}`);
        stderr(`Title: ${parsed.metadata.title || "N/A"}`);
        stderr(`API Version: ${parsed.metadata.version || "N/A"}`);
      }
    } catch (error) {
      stderr(`Parsing failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("report")
  .description("Generate a validation report")
  .argument("<source>", "Path, URL, or '-' for stdin OpenAPI specification")
  .option("-f, --format <format>", "Report format (json, yaml, html, markdown)", "json")
  .option("-o, --output <file>", "Output file path")
  .option("-s, --strict", "Enable strict validation mode")
  .option("-e, --examples", "Validate examples in the specification")
  .option("-r, --references", "Validate internal references")
  .option("-w, --warnings", "Include warnings in report")
  .option("-m, --metadata", "Include metadata in report")
  .option("-v, --verbose", "Show detailed output")
  .option("--no-progress", "Disable progress indicators")
  .option("--no-colors", "Disable colored output")
  .action(async (source: string, options: any) => {
    configureLogging(options);
    try {
      const allowedFormats = ["json", "yaml", "html", "markdown"];
      if (!allowedFormats.includes(String(options.format))) {
        throw new Error(
          `Unsupported --format value: '${options.format}'. Use one of: ${allowedFormats.join(", ")}.`,
        );
      }

      const validationOptions: ValidationOptions = {
        strict: !!options.strict,
        validateExamples: !!options.examples,
        validateReferences: !!options.references,
      };
      const reportOptions: ReportOptions = {
        format: options.format,
        output: options.output,
        includeWarnings: !!options.warnings,
        includeMetadata: !!options.metadata,
      };

      if (options.output) {
        await saveValidationReport(source, reportOptions, validationOptions);
        stderr(`Report saved to: ${options.output}`);
      } else {
        stdout(await generateValidationReport(source, reportOptions, validationOptions));
      }
    } catch (error) {
      stderr(
        `Report generation failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      process.exit(1);
    }
  });

program
  .command("analyze")
  .description("Analyze references in an OpenAPI specification")
  .argument("<source>", "Path, URL, or '-' for stdin OpenAPI specification")
  .option("-j, --json", "Output as JSON")
  .option("-v, --verbose", "Show detailed output")
  .option("--no-progress", "Disable progress indicators")
  .option("--no-colors", "Disable colored output")
  .action(async (source: string, options: any) => {
    configureLogging(options);
    try {
      const analysis = await analyzeDocumentReferences(source);
      if (options.json) {
        stdout(JSON.stringify(analysis, null, 2));
      } else {
        stderr("Reference Analysis");
        stderr("=".repeat(40));
        stderr(`Total references: ${analysis.totalReferences}`);
        stderr(`Circular references: ${analysis.circularReferences.length}`);
        for (const ref of analysis.references) {
          stderr(`  - ${ref.path}: ${ref.value}`);
        }
      }
    } catch (error) {
      stderr(`Analysis failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("summary")
  .description("Generate a comprehensive summary of an OpenAPI specification")
  .argument("<source>", "Path, URL, or '-' for stdin OpenAPI specification")
  .option("-j, --json", "Output as JSON")
  .option("-d, --detailed", "Show detailed summary")
  .option("-s, --strict", "Enable strict validation mode")
  .option("-e, --examples", "Validate examples in the specification")
  .option("-r, --references", "Validate internal references")
  .option("-v, --verbose", "Show detailed output")
  .option("--no-progress", "Disable progress indicators")
  .option("--no-colors", "Disable colored output")
  .action(async (source: string, options: any) => {
    configureLogging(options);
    try {
      const validationOptions: ValidationOptions = {
        strict: !!options.strict,
        validateExamples: !!options.examples,
        validateReferences: !!options.references,
      };
      const { summary, detailedSummary, jsonSummary } =
        await generateSpecificationSummary(source, validationOptions);

      if (options.json) {
        stdout(jsonSummary);
      } else if (options.detailed) {
        stdout(detailedSummary);
      } else {
        stderr("OpenAPI Specification Summary");
        stderr("=".repeat(50));
        stderr(`Version: ${summary.version}`);
        stderr(`Title: ${summary.title || "N/A"}`);
        stderr(`Paths: ${summary.paths}`);
        stderr(`Endpoints: ${summary.endpoints}`);
        stderr(`Components: ${summary.components}`);
        stderr(`Schemas: ${summary.schemas}`);
        stderr(`Valid: ${summary.validationResults.valid ? "Yes" : "No"}`);
      }
    } catch (error) {
      stderr(`Summary generation failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

program
  .command("info")
  .description("Show information about supported OpenAPI versions")
  .action(() => {
    stdout("Supported OpenAPI Versions");
    stdout("=".repeat(40));
    for (const version of getSupportedVersions()) stdout(`  - ${version}`);
    stdout("\nFor more information, visit: https://spec.openapis.org/");
  });

program
  .command("split", { hidden: true })
  .description("Deprecated alias for partition")
  .action(() => {
    stderr("error: command 'split' was renamed to 'partition'");
    process.exit(1);
  });

program
  .command("partition")
  .description("Partition an OpenAPI specification into per-tag sub-specifications.")
  .argument("<source>", "Path, URL, or '-' for stdin OpenAPI specification")
  .option("-o, --output <dir>", "Output directory", "./partition")
  .option("-f, --format <fmt>", "Output format (json or yaml)")
  .option("--no-include-untagged", "Skip operations that have no tags")
  .option("--max-depth <depth>", "Maximum reference resolution depth", "25")
  .option("--dry-run", "Print the planned file tree without writing any files")
  .option("--clean", "Remove the output directory before writing")
  .option("-v, --verbose", "Show detailed output")
  .option("--no-progress", "Disable progress indicators")
  .option("--no-colors", "Disable colored output")
  .action(async (source: string, options: any) => {
    configureLogging(options);
    try {
      const requestedFormat = options.format
        ? (String(options.format).toLowerCase() as SerializationFormat)
        : undefined;
      if (
        requestedFormat &&
        requestedFormat !== "json" &&
        requestedFormat !== "yaml"
      ) {
        throw new Error(`Unsupported --format value: '${options.format}'. Use 'json' or 'yaml'.`);
      }

      const plan = await partitionSpecByTags(source, {
        format: requestedFormat ?? detectFormatFromPath(source) ?? "json",
        includeUntagged: options.includeUntagged !== false,
        maxRefDepth: parsePositiveInteger(options.maxDepth ?? "25", "--max-depth"),
      });

      if (plan.tags.length === 0) {
        stderr("No tags found and no untagged operations to emit.");
        process.exit(1);
      }

      if (options.dryRun) {
        stdout(describePartitionPlan(plan, options.output));
        return;
      }

      const result = writePartitionPlan(plan, options.output, {
        clean: !!options.clean,
      });
      stderr(
        `Partitioned into ${result.tagsWritten} tag folder(s) (${result.filesWritten} file(s)) at: ${result.outputDir}`,
      );
      if (options.verbose) {
        for (const tag of plan.tags) {
          stderr(`  - ${tag.name}/ (tag: ${tag.originalTag}, ${tag.files.length} file(s))`);
        }
      }
    } catch (error) {
      stderr(`Partition failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      process.exit(1);
    }
  });

const isDirectRun = (): boolean => {
  const meta = import.meta as ImportMeta & { main?: boolean };
  if (typeof meta.main === "boolean") return meta.main;

  const argvEntry = process.argv[1];
  if (!argvEntry) return false;

  try {
    return (
      pathToFileURL(realpathSync(argvEntry)).href ===
      pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href
    );
  } catch {
    return fileURLToPath(import.meta.url) === argvEntry;
  }
};

if (isDirectRun()) {
  await program.parseAsync(process.argv);
}
