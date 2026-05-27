# Varsity

Varsity is an OpenAPI parsing, validation, analysis, reporting, and partitioning toolkit for JavaScript and TypeScript projects. It can be used as a library or as a command-line tool.

The package accepts JSON and YAML OpenAPI documents from local files or remote URLs and includes TypeScript declarations for all public APIs.

## Features

- Parse OpenAPI specifications from JSON or YAML.
- Validate OpenAPI 2.0, OpenAPI 3.0.x, OpenAPI 3.1.x, and OpenAPI 3.2.x documents.
- Run strict validation checks for common publishing issues.
- Validate examples against adjacent schemas where schemas can be checked without additional reference resolution.
- Validate internal references and recursively follow external file references.
- Analyze `$ref` usage and detect true circular internal reference chains.
- Generate validation reports as JSON, YAML, HTML, or Markdown.
- Partition a central specification into per-tag sub-specifications with rewritten relative `$ref`s.
- Use the same functionality from the CLI or as a typed TypeScript library.

## Installation

```bash
npm install varsity
```

Other package managers are supported:

```bash
yarn add varsity
pnpm add varsity
bun add varsity
```

## CLI

```bash
varsity <command> [options]
```

### Commands

- `validate <sources...>`: validate one or more OpenAPI specifications.
- `parse <source>`: parse a specification and print basic metadata.
- `report <source>`: generate a validation report.
- `analyze <source>`: list references and circular internal references.
- `summary <source>`: print a structural summary of a specification.
- `info`: show supported OpenAPI versions.
- `partition <source>`: create per-tag sub-specifications from a central specification.

### Validation

```bash
# Basic validation
varsity validate spec.json

# Strict validation with example and shallow internal-reference checks
varsity validate spec.yaml --strict --examples --references

# Recursive validation that follows external file references
varsity validate spec.json --recursive --max-depth 25

# Machine-readable output for multi-spec validation
varsity validate spec-a.json spec-b.json --json
```

Validation options:

- `--strict`: enable additional strict checks.
- `--examples`: validate examples where a sibling schema can be compiled directly.
- `--references`: validate internal `#/...` references in the root document.
- `--recursive`: validate the root document and referenced external documents.
- `--max-depth <depth>`: maximum depth for recursive reference traversal.
- `--json`: output JSON for batch validation.
- `--verbose`: print detailed validation progress.

### Reports

```bash
# Generate a report to stdout
varsity report spec.json --format markdown

# Save a report to disk
varsity report spec.json --format html --output report.html

# Include warnings and metadata
varsity report spec.json --format json --warnings --metadata
```

Supported report formats are `json`, `yaml`, `html`, and `markdown`.

### Reference Analysis

```bash
varsity analyze spec.json
varsity analyze spec.json --json
```

The analyzer lists all `$ref` occurrences and detects circular internal reference chains. A schema referenced from multiple operations is not considered circular unless a reference path leads back to itself.

### Summaries

```bash
varsity summary spec.json
varsity summary spec.json --detailed
varsity summary spec.json --json
```

The summary command reports path, endpoint, component, schema, server, tag, security, webhook, and reference counts.

### Partition By Tags

`varsity partition` creates one self-contained folder per operation tag. Each folder contains a root `openapi` document plus sidecar folders such as `paths/`, `schemas/`, `parameters/`, `responses/`, and `request-bodies/`.

```bash
# Write JSON files to ./partition/<tag>/...
varsity partition spec.json

# Choose output directory and format
varsity partition spec.json --output ./out --format yaml

# Preview without writing
varsity partition spec.json --dry-run

# Remove stale files before writing
varsity partition spec.json --clean

# Skip operations without tags
varsity partition spec.json --no-include-untagged
```

Partition behavior:

- Operations are bucketed by their `tags` array.
- Operations with multiple tags are duplicated into each matching tag folder.
- Untagged operations are grouped into `untagged/` unless `--no-include-untagged` is used.
- Only transitively referenced files and components are emitted for each tag.
- Internal `#/components/...` references and local file references are rewritten to relative file references.
- Top-level PathItem `$ref`s are resolved before operations are bucketed.

Output layout:

```text
<output>/<tag>/
  openapi.{json|yaml}
  paths/<slug>.{json|yaml}
  schemas/<name>.{json|yaml}
  parameters/<name>.{json|yaml}
  responses/<name>.{json|yaml}
  request-bodies/<name>.{json|yaml}
```

The `split` command name is intentionally reserved for a future conventional OpenAPI command that breaks a single document into reusable component files.

## Library Usage

### Parse And Validate

```ts
import { parse, validate, validateWithReferences } from "varsity";

const parsed = await parse("spec.yaml");
console.log(parsed.version);
console.log(parsed.metadata.title);

const result = await validate("spec.yaml", {
  strict: true,
  validateExamples: true,
  validateReferences: true,
});

if (!result.valid) {
  console.error(result.errors);
}

const recursive = await validateWithReferences("spec.yaml", {
  maxRefDepth: 25,
});
```

### Reports

```ts
import { generateValidationReport, saveValidationReport } from "varsity";

const markdown = await generateValidationReport("spec.json", {
  format: "markdown",
  includeWarnings: true,
  includeMetadata: true,
});

await saveValidationReport("spec.json", {
  format: "html",
  output: "report.html",
  includeWarnings: true,
  includeMetadata: true,
});
```

### Reference Analysis

```ts
import { analyzeDocumentReferences } from "varsity";

const analysis = await analyzeDocumentReferences("spec.json");

console.log(analysis.totalReferences);
console.log(analysis.circularReferences);
```

### Partitioning

```ts
import { partitionSpecByTags, writePartitionPlan } from "varsity";

const plan = await partitionSpecByTags("spec.json", {
  format: "json",
  includeUntagged: true,
  maxRefDepth: 25,
});

writePartitionPlan(plan, "./partition", {
  clean: true,
});
```

### Configured Instance

```ts
import { createVarsity } from "varsity";

const varsity = createVarsity({
  defaultVersion: "3.0",
  strictMode: true,
  reportFormats: ["json", "html"],
});

const result = await varsity.validate("spec.json");
```

## API Reference

### Core Functions

- `parse(source)`: parse a local or remote OpenAPI specification.
- `validate(source, options?, config?)`: validate one or more specifications.
- `validateWithReferences(source, options?, config?)`: recursively validate a specification and referenced documents.
- `validateMultipleWithReferences(sources, options?, config?)`: recursively validate multiple specifications.
- `generateValidationReport(source, reportOptions, validationOptions?)`: return a report string.
- `saveValidationReport(source, reportOptions, validationOptions?)`: write a report to disk.
- `analyzeDocumentReferences(source)`: return reference analysis for a parsed document.
- `partitionSpecByTags(source, options?)`: create a partition plan from a source spec.
- `writePartitionPlan(plan, outputDir, options?)`: write a partition plan to disk.

### Validation Options

```ts
interface ValidationOptions {
  strict?: boolean;
  validateExamples?: boolean;
  validateReferences?: boolean;
  recursive?: boolean;
  maxRefDepth?: number;
  customRules?: Record<string, unknown>;
}
```

### Report Options

```ts
interface ReportOptions {
  format: "json" | "yaml" | "html" | "markdown";
  output?: string;
  includeWarnings?: boolean;
  includeMetadata?: boolean;
}
```

### Partition Options

```ts
interface PartitionOptions {
  format?: "json" | "yaml";
  includeUntagged?: boolean;
  maxRefDepth?: number;
}

interface WriteOptions {
  clean?: boolean;
}
```

## Supported OpenAPI Versions

- Swagger/OpenAPI 2.0
- OpenAPI 3.0.x
- OpenAPI 3.1.x
- OpenAPI 3.2.x

## Development

### Requirements

- Bun
- Node.js 24 or newer for the built CLI and npm Trusted Publishing workflow
- TypeScript 5

### Local Workflow

```bash
bun install
bun run lint
bun test
bun run build
npm pack --dry-run
```

The build writes publishable JavaScript and declaration files to `dist/`.

## Publishing

The package is configured for automated npm publishing from GitHub Actions using npm Trusted Publishing.

### Automatic Release Flow

1. Push or merge to `main`.
2. The `Test` workflow runs linting, tests, and a clean build.
3. After `Test` succeeds on `main`, the `Publish to npm` workflow checks out the tested commit.
4. The publish workflow bumps the patch version with `npm version patch --no-git-tag-version`.
5. The workflow updates `bun.lock`, runs linting, tests, a clean build, and `npm pack --dry-run`.
6. The workflow commits the version bump with `[skip ci]`, pushes `main`, creates a matching `vX.Y.Z` tag, publishes to npm with provenance, and creates a GitHub Release.

### Trusted Publishing Setup

Repository configuration alone is not enough to enable Trusted Publishing. The npm package must have a Trusted Publisher configured with:

- Provider: GitHub Actions
- Repository: `LukasParke/varsity`
- Workflow file: `.github/workflows/publish.yml`
- Environment: none, unless you later add a GitHub environment gate

Once npm Trusted Publishing is configured, no `NPM_TOKEN` repository secret is required for publishing.

The publish workflow uses Node.js 24 so npm includes Trusted Publishing support. npm 11.5.1 or newer is required for the OIDC publish flow.

For provenance verification, `package.json` `repository.url` must point to the same GitHub repository as the workflow: `https://github.com/LukasParke/varsity`. npm may normalize that value to `git+https://github.com/LukasParke/varsity.git`; the owner and repository slug are the important parts.

### Manual Publish Workflow

The `Publish to npm` workflow can also be run manually:

- `dry_run=true` runs `npm publish --dry-run`.
- `dry_run=false` publishes the current `package.json` version without auto-bumping.

Manual non-dry-run publishes still depend on npm Trusted Publishing accepting this workflow file and event context.

## License

Varsity is licensed under the MIT License. See [LICENSE](LICENSE) for details.