# OpenAPI CLI Tooling Review

This document summarizes public OpenAPI CLI tooling across Redocly, Speakeasy, Scalar, and adjacent tools, then maps their deduplicated CLI capabilities to Varsity's current CLI surface.

Research date: 2026-05-27

## Executive Summary

Varsity is currently best understood as a focused OpenAPI parsing, validation, reporting, reference-analysis, summary, and partitioning toolkit. It has a compact CLI with strong support for OpenAPI schema validation across Swagger/OpenAPI 2.0, OpenAPI 3.0.x, OpenAPI 3.1.x, and OpenAPI 3.2.x, plus a distinctive `partition` command that creates per-tag sub-specifications with rewritten relative references.

The broader OpenAPI CLI ecosystem is much wider. Redocly, Scalar, Speakeasy, Spectral, Vacuum, OpenAPI Generator, oasdiff, Prism, Dredd, Bump.sh, Fern, Kiota, APIMatic, Orval, Kubb, Hey API, openapi-typescript, Portman, IBM OpenAPI Validator, and Optic collectively cover API governance, bundling, conventional splitting, joining, docs preview/build/publish, SDK generation, TypeScript type generation, mock servers, validation proxies, contract testing, OpenAPI overlays, diffing, breaking-change gates, platform publishing, registry integration, and CI-specific report formats.

Varsity maps directly to these ecosystem categories:

- Strong match: schema validation, batch validation, local/remote JSON/YAML input, reference analysis, circular reference detection, validation reports, structural summaries, and tag-based partitioning.
- Partial match: linting/governance through fixed strict/example/reference checks, report generation through JSON/YAML/HTML/Markdown, recursive external reference traversal, and machine-readable output.
- Missing: configurable lint rulesets, config files, ignore/suppression workflows, bundle/dereference, conventional split/join, docs preview/build, mock/proxy servers, contract tests, diff/breaking-change/changelog, overlays, API format conversion, OpenAPI version upgrades, SDK/code/type generation, Postman collection generation, registry/platform publishing, auth/login workflows, and CI-specific report formats like SARIF/JUnit/Checkstyle/GitHub annotations.

## Varsity CLI Baseline

Varsity exposes the `varsity` binary through `package.json`, with implementation in `src/cli.ts` and user documentation in `README.md`.

### Commands

| Command | Purpose | Key options | Ecosystem category |
| --- | --- | --- | --- |
| `validate <sources...>` | Validate one or more OpenAPI documents | `--strict`, `--examples`, `--references`, `--recursive`, `--max-depth`, `--json`, `--verbose`, `--no-progress`, `--no-colors` | Validation |
| `parse <source>` | Parse without validation and print metadata | `--json`, `--verbose`, `--no-progress`, `--no-colors` | Parsing/introspection |
| `report <source>` | Generate validation report | `--format json|yaml|html|markdown`, `--output`, `--strict`, `--examples`, `--references`, `--warnings`, `--metadata` | Reporting |
| `analyze <source>` | Analyze `$ref` usage and circular internal reference chains | `--json`, `--verbose`, `--no-progress`, `--no-colors` | Reference analysis |
| `summary <source>` | Print structural summary | `--json`, `--detailed`, `--strict`, `--examples`, `--references`, `--verbose`, `--no-progress`, `--no-colors` | Statistics/introspection |
| `info` | Show supported OpenAPI versions | None | Tool metadata |
| `partition <source>` | Create per-tag sub-specifications | `--output`, `--format json|yaml`, `--no-include-untagged`, `--max-depth`, `--dry-run`, `--clean`, `--verbose`, `--no-progress`, `--no-colors` | Spec decomposition |

### Current Strengths

- OpenAPI version coverage includes Swagger/OpenAPI 2.0, OpenAPI 3.0.x, OpenAPI 3.1.x, and OpenAPI 3.2.x.
- Inputs include local JSON, local YAML, remote JSON, and remote YAML sources.
- Validation can optionally run fixed strict checks, adjacent example checks, shallow internal reference checks, and recursive external-reference validation.
- Recursive validation tracks multiple documents and detects circular reference chains.
- Reports can be emitted as JSON, YAML, HTML, or Markdown.
- `summary` provides structural statistics across paths, endpoints, schemas, components, servers, tags, security, webhooks, HTTP methods, and references.
- `partition` is unusual compared with many ecosystem tools: it partitions by operation tags, duplicates multi-tag operations, emits only transitively referenced components, rewrites internal and local file references, and resolves top-level PathItem references before bucketing.

### Current Constraints And Discrepancies

- There is no CLI config file such as `.varsityrc`, `varsity.yaml`, `redocly.yaml`, `.spectral.yaml`, or `openapitools.json`.
- `customRules` appears in public TypeScript options, but the CLI does not expose a custom rules engine and the validation pipeline does not implement arbitrary custom rules.
- `--json` on `validate` is machine-readable for multi-source validation; single-source validation still prints human output.
- Multi-source validation uses recursive validation through `validateMultipleWithReferences` regardless of whether `--recursive` is supplied.
- `split` is intentionally reserved and exits as an unknown command; conventional OpenAPI splitting is not implemented.
- The CLI does not support stdin-oriented workflows.
- There are no CI-native report formats such as SARIF, JUnit XML, Checkstyle, GitHub annotations, or GitLab code-quality output.

## Tooling Scope

The comparison covers tools with public OpenAPI CLI surfaces or OpenAPI-centric command groups:

- Redocly CLI
- Speakeasy CLI
- Scalar CLI
- Stoplight Spectral CLI
- Vacuum
- APIDevTools Swagger CLI
- OpenAPI Generator CLI
- oasdiff
- Stoplight Prism
- Dredd
- Bump.sh CLI
- Fern CLI
- Microsoft Kiota
- APIMatic CLI
- openapi-typescript
- Hey API OpenAPI TypeScript
- Orval
- Kubb
- Portman
- IBM OpenAPI Validator
- Optic

This is not an endorsement ranking. The purpose is to deduplicate common capabilities and identify how each capability maps, or does not map, to Varsity.

## Feature Taxonomy

### 1. Parsing And Input Loading

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Local JSON input | Redocly, Scalar, Spectral, Vacuum, Swagger CLI, OpenAPI Generator, oasdiff, Prism, Dredd, Bump.sh, APIMatic, openapi-typescript | Supported | Varsity accepts local JSON paths in all source-taking commands. |
| Local YAML input | Redocly, Scalar, Spectral, Vacuum, Swagger CLI, OpenAPI Generator, oasdiff, Prism, Dredd, Bump.sh, APIMatic, openapi-typescript | Supported | Varsity accepts local YAML paths in all source-taking commands. |
| Remote URL input | Redocly, Scalar, Speakeasy, Swagger CLI-related parser ecosystem, OpenAPI Generator, oasdiff, Prism, Bump.sh, Kiota, APIMatic, openapi-typescript | Supported | Varsity parser accepts `http` and `https` URLs. |
| Stdin input | Vacuum report flows, many Unix-style tools | Not supported | Varsity requires path or URL arguments. |
| Multiple source files | Redocly, Spectral, Vacuum, IBM Validator, OpenAPI Generator batch, oasdiff collection comparison | Partially supported | Varsity supports multiple inputs for `validate`, but most other commands take one source. |
| Remote headers/auth for fetching specs | Speakeasy lint supports header/token flags; platform CLIs often support auth | Not supported | Varsity has no CLI flags for authenticated spec downloads. |
| Registry lookup/download | Kiota search/download; Speakeasy/Hey registry/platform workflows | Not supported | Varsity is file/URL oriented only. |

### 2. Schema Validation

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| OpenAPI schema validation | Redocly `lint`, Scalar `document validate`, Swagger CLI `validate`, OpenAPI Generator `validate`, Speakeasy `openapi lint`, IBM Validator `lint-openapi` | Supported | `varsity validate` validates OpenAPI documents with AJV and OpenAPI schemas. |
| Swagger/OpenAPI 2.0 support | Redocly, Spectral, Vacuum, Swagger CLI, OpenAPI Generator, Prism, Dredd, Bump.sh | Supported | Varsity lists Swagger/OpenAPI 2.0 as supported. |
| OpenAPI 3.0 support | Nearly all reviewed OpenAPI tools | Supported | Varsity supports OpenAPI 3.0.x. |
| OpenAPI 3.1 support | Redocly, Scalar, Spectral, Vacuum, Speakeasy, Prism, openapi-typescript, Kiota, many current generators | Supported | Varsity supports OpenAPI 3.1.x. |
| OpenAPI 3.2 support | Redocly and Vacuum advertise 3.2; ecosystem support varies | Supported | Varsity supports OpenAPI 3.2.x. |
| Batch validation | Redocly, Spectral, Vacuum, IBM Validator | Supported for `validate` | Varsity supports `validate <sources...>`. |
| Validation depth control | Recursive/bundling tools often expose resolver options | Supported for recursive validation | `--max-depth` controls recursive traversal depth. |
| Strict validation mode | OpenAPI Generator has strict-spec flags; linters use rulesets | Partially supported | Varsity strict mode is a fixed set of extra checks, not configurable governance. |
| Example validation | Redocly/Spectral/Speakeasy-style linting can evaluate examples; Prism/Scalar mocks use examples | Partially supported | Varsity checks examples adjacent to schemas where directly compilable; warnings rather than hard failures. |
| Internal reference validation | Redocly/Spectral/Vacuum/Swagger CLI/Scalar | Supported | `--references` validates internal `#/...` refs in the root document. |
| Recursive external reference validation | Redocly/Swagger CLI/Scalar bundling; Vacuum remote refs | Partially supported | Varsity has `--recursive`, but recursive resolver behavior is validation-focused, not bundling-focused. |

### 3. Governance Linting And Rulesets

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Configurable rulesets | Redocly `redocly.yaml`, Spectral `.spectral.yaml`, Vacuum `--ruleset`, Scalar `document lint --rule`, IBM `--ruleset`, Speakeasy `--ruleset` | Not supported | Varsity has fixed validation options only. |
| Built-in recommended style guide | Redocly recommended/minimal, Spectral `spectral:oas`, Vacuum default rules, IBM Cloud ruleset, Speakeasy recommended | Not supported | Varsity does not include a style/governance ruleset. |
| Custom JavaScript/YAML rules | Spectral rules/functions, Redocly rules/decorators/preprocessors, Vacuum Spectral-compatible functions | Not supported | `customRules` is not implemented in the current validation pipeline. |
| Rule severity configuration | Spectral, Redocly, Vacuum, IBM, oasdiff severity levels | Not supported | Varsity reports validation errors and warnings, but does not expose user-controlled severities. |
| Rule suppression / ignore files | Redocly ignore files, Vacuum ignore file, IBM ignore/config, Spectral ruleset suppression patterns | Not supported | No equivalent CLI feature. |
| Lint changed areas only | Vacuum change filtering, Optic forwards-only governance | Not supported | Varsity has no diff-aware lint mode. |
| Quality score | Redocly `score`, Vacuum score/min-score | Not supported | No scoring metric. |

### 4. Reporting And CI Output

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Human terminal output | All reviewed tools | Supported | Varsity prints human summaries and errors. |
| JSON output | Redocly, Spectral, Vacuum, oasdiff, IBM, OpenAPI Generator, many codegen tools | Partially supported | Varsity supports JSON for parse/analyze/summary/report and batch validation. |
| YAML output | Redocly bundle/reports, oasdiff, Varsity reports | Supported for reports | `varsity report --format yaml`; partition can emit YAML files. |
| HTML report | Redocly docs, Vacuum `html-report`, oasdiff HTML, Dredd HTML reporter, Varsity report | Supported for validation reports | `varsity report --format html`; not API reference docs. |
| Markdown report | Redocly/Spectral-related reports, Scalar markdown docs, oasdiff changelog/diff, IBM markdown report | Supported for validation reports | `varsity report --format markdown`; not API docs. |
| JUnit XML | Spectral, Vacuum, oasdiff, Dredd | Not supported | Useful CI target. |
| SARIF | Spectral | Not supported | Useful GitHub code scanning target. |
| Checkstyle | Redocly and other linters | Not supported | Useful legacy CI target. |
| GitHub annotations | oasdiff and some linters | Not supported | Useful PR UX target. |
| Report file output | Redocly, Spectral, Vacuum, oasdiff, Varsity | Supported for `report` | `--output` writes report files. |
| Metadata in reports | Many tools include source location, rule IDs, metadata | Partially supported | Varsity reports can include metadata through `--metadata`, but no rule IDs or source locations like linters. |

### 5. Reference Management, Bundling, Splitting, Joining

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Bundle referenced files into one spec | Redocly `bundle`, Scalar `document bundle`, Swagger CLI `bundle`, Vacuum `bundle` | Not supported | Varsity validates recursive refs but does not emit a bundled spec. |
| Fully dereference/inlining refs | Redocly `--dereferenced`, Swagger CLI `--dereference`, parser ecosystems | Not supported | Varsity does not emit dereferenced output. |
| Remove unused components while bundling | Redocly `--remove-unused-components` | Not supported | Varsity partition emits only transitively referenced components per tag, but not as a general bundle option. |
| Split a single spec into conventional multi-file structure | Redocly `split`, Scalar `document split` | Not supported | Varsity reserves `split` but does not implement it. |
| Join multiple independent specs | Redocly `join`, Scalar `document join` | Not supported | Varsity has no merge/join command. |
| Tag-based partitioning | Less common as a first-class standalone CLI feature | Supported | `varsity partition` is a notable differentiator. |
| Reference usage analysis | Redocly/Vacuum/Spectral as lint/ref checks; oasdiff as structural diff | Supported | `varsity analyze` lists references and circular internal refs. |
| Circular reference detection | Bundlers and parsers must handle cycles; linters can report some cycles | Supported | Varsity explicitly reports true circular internal reference chains. |
| Dry-run file tree preview | Some generators/platform CLIs support dry-run modes | Supported for partition | `varsity partition --dry-run` prints the planned tree without writing. |
| Clean output before generation | OpenAPI Generator/Orval/Kubb often support clean output; Varsity partition supports clean | Supported for partition | `varsity partition --clean`. |

### 6. Spec Transformation And Format Conversion

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Pretty-format OpenAPI files | Scalar `document format` | Not supported | Varsity parses and serializes reports/partitions, but has no formatter command. |
| Convert Postman to OpenAPI | Scalar `document convert`, APIMatic transform | Not supported | No format conversion. |
| Convert among OpenAPI/RAML/WSDL/Postman/API Blueprint | APIMatic `api transform` | Not supported | No transformer surface. |
| Upgrade OpenAPI version | Scalar `document upgrade` to 3.1 | Not supported | Varsity validates multiple versions but does not migrate versions. |
| Apply OpenAPI overlays | Speakeasy `overlay`, Bump `overlay`, Vacuum `apply-overlay` | Not supported | No overlay parser or application command. |
| Generate overlays from spec differences | Speakeasy `overlay compare` | Not supported | Requires diff/overlay support. |
| Enrich examples/extensions | Fern `api enrich`, Speakeasy overlays/studio workflows | Not supported | No enrichment/edit command. |

### 7. Documentation Workflows

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Local API reference preview server | Redocly `preview`, Scalar `document serve`, APIMatic `portal serve` | Not supported | Varsity has no docs server. |
| Static API docs build | Redocly `build-docs`, APIMatic `portal generate`, Fern `generate --docs` | Not supported | Varsity reports are validation reports, not API reference docs. |
| Hosted documentation preview URL | Bump `preview`, Scalar share, platform tools | Not supported | No hosted platform integration. |
| Documentation publish/deploy | Bump `deploy`, Fern docs, APIMatic portal publishing | Not supported | No deploy/publish commands. |
| Markdown API reference generation | Scalar `document markdown`, OpenAPI Generator docs | Not supported | Varsity Markdown output is validation reporting only. |
| Docs configuration/theme/customization | Redocly, Scalar API Reference config, APIMatic, Fern | Not supported | No docs renderer. |
| Translation key generation | Redocly `translate` for Realm/Reef/Revel | Not supported | Outside Varsity's current scope. |

### 8. Code Generation

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Multi-language client SDK generation | Speakeasy, OpenAPI Generator, Fern, Kiota, APIMatic | Not supported | No codegen surface. |
| Server stub generation | OpenAPI Generator, Fern/APIMatic workflows | Not supported | No server generation. |
| TypeScript type generation | openapi-typescript, Hey API, Orval, Kubb, OpenAPI Generator | Not supported | Varsity is written in TypeScript and exports typed APIs, but does not generate types from specs. |
| TypeScript SDK/client generation | Hey API, Orval, Kubb, Speakeasy, OpenAPI Generator, APIMatic, Fern | Not supported | No generated HTTP client. |
| TanStack Query/SWR/frontend hooks | Orval, Kubb, Hey API | Not supported | No frontend integration generation. |
| Runtime validators such as Zod/Valibot | Orval, Kubb, Hey API | Not supported | No runtime schema generation. |
| MSW handlers/mock files | Orval, Kubb | Not supported | Related to mocking, but generated as frontend test helpers. |
| Faker/mock data generators | Orval/Kubb plugin ecosystems | Not supported | No fake data generation. |
| Terraform provider generation | Speakeasy | Not supported | Outside current Varsity scope. |
| MCP server generation | Speakeasy, Hey API/Orval/Kubb ecosystems | Not supported | No MCP generation command. |
| Generate a CLI from OpenAPI | Speakeasy CLI generation | Not supported | Varsity validates OpenAPI, but does not generate consumer-facing CLIs from specs. |
| Custom generator authoring/templates | OpenAPI Generator `author template`, `meta`; Kubb plugin framework | Not supported | No template/plugin authoring surface. |
| Batch generation | OpenAPI Generator `batch`; Speakeasy `run`; Orval/Kubb config projects | Not supported | No generation workflow. |

### 9. Mocking, Proxying, And Contract Testing

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Mock HTTP server from OpenAPI | Scalar `document mock`, Prism `mock` | Not supported | No server runtime. |
| Dynamic mock response generation | Prism dynamic mode, Scalar mock server, Kubb/Orval faker/MSW | Not supported | No response generation. |
| Request validation in mock server | Prism mock, Scalar mock | Not supported | Varsity validates specs, not live HTTP requests. |
| Validation proxy | Prism `proxy`, Optic `capture` proxy mode | Not supported | No proxy mode. |
| Response validation against real backend | Prism `proxy`, Dredd, Optic capture | Not supported | No backend contract validation. |
| Contract testing generated from docs | Dredd, Portman, Prism proxy | Not supported | No test runner. |
| Postman collection generation | Portman, Speakeasy, APIMatic, Fern | Not supported | No Postman output. |
| Newman execution | Portman `--runNewman` | Not supported | No Postman/Newman integration. |
| Test hooks/setup/teardown | Dredd hooks | Not supported | No contract-test lifecycle. |
| Capture traffic and patch OpenAPI | Optic `capture --update` | Not supported | No traffic capture or spec update surface. |

### 10. Diff, Breaking Changes, And Change Management

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| Structural diff between two specs | oasdiff `diff`, Bump `diff`, Optic `diff` | Not supported | Varsity analyzes one document at a time. |
| Breaking-change detection | oasdiff `breaking`, Bump `--fail-on-breaking`, Optic `--check` | Not supported | No compatibility model. |
| Changelog generation | oasdiff `changelog`, Bump diff output | Not supported | No two-version input. |
| CI fail threshold for changes | oasdiff `--fail-on`, Optic `--check`, Bump `--fail-on-breaking`, Vacuum `--min-score` | Not supported | Varsity exits nonzero on validation failures, not change thresholds. |
| Compare local/URL/git revisions | oasdiff, Optic | Not supported | Varsity supports local/URL single sources, not git ref comparison. |
| Change fingerprints | oasdiff | Not supported | No stable change identity. |
| Filter diff by path/element | oasdiff filters/exclusions, Optic ruleset scopes | Not supported | No diff engine. |
| API stability/deprecation policy checks | oasdiff | Not supported | No lifecycle policy model. |

### 11. Platform, Registry, And Auth Workflows

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| CLI login/logout | Speakeasy, Fern, Kiota, APIMatic, Bump workflows | Not supported | Varsity is local/offline plus URL fetch. |
| Hosted registry integration | Scalar Registry, Speakeasy, Hey API Registry, Kiota registries | Not supported | No registry commands. |
| Publish documentation or SDKs | Bump, Fern, APIMatic, Speakeasy | Not supported | No platform publishing. |
| Configure workflow files | Speakeasy `configure`, Fern project config, OpenAPI Generator config | Not supported | No workflow/config initializer. |
| GitHub Actions setup | Speakeasy workflow support, Bump CI docs/actions, platform CLIs | Not supported | Varsity has no CLI command to scaffold CI. |
| Share a spec | Scalar `document share`, Bump preview | Not supported | No hosted sharing. |

### 12. Developer Experience And Tooling

| Feature | Public CLI examples | Varsity mapping | Notes |
| --- | --- | --- | --- |
| `--help` and `--version` | All standard CLIs | Supported | Provided by Commander. |
| Progress/color controls | Many tools | Supported | `--no-progress`, `--no-colors`. |
| Verbose logging | Many tools | Supported | `--verbose`. |
| Shell autocomplete | APIMatic autocomplete, some generated CLIs | Not supported | No completion generation. |
| Interactive quickstart/init | Speakeasy `quickstart`, Fern `init`, Kubb `init`, Dredd `init`, APIMatic `quickstart` | Not supported | Varsity has no initializer. |
| Language server | Vacuum `language-server`, Spectral editor ecosystem | Not supported | No editor/language-server process. |
| Dashboard UI | Vacuum dashboard, platform tools | Not supported | No UI. |

## Tool-By-Tool Notes

### Redocly CLI

Redocly CLI is one of the broadest OpenAPI lifecycle CLIs. It supports linting, bundling, splitting, joining, stats, scoring, docs preview, static docs builds, config validation, Arazzo-related commands, and project preview workflows.

Key commands and features:

- `lint` for ruleset-based validation and API governance.
- `bundle` to follow `$ref`s and emit a single JSON/YAML document, with options such as dereferencing and removing unused components.
- `split` to break a large OpenAPI description into a multi-file structure.
- `join` to merge multiple API descriptions.
- `stats` to gather document statistics.
- `score` to evaluate integration simplicity and AI readiness.
- `preview` to run a local docs/project preview.
- `build-docs` to generate a static HTML API reference.
- `check-config` to validate Redocly configuration.
- `respect` and `generate-arazzo` for Arazzo/workflow-related testing.
- `redocly.yaml` as the primary configuration file.

Varsity overlap:

- Strong overlap on schema validation and structural summary-style output.
- Partial overlap on reports.
- No overlap for Redocly's config/ruleset, bundle/dereference, conventional split/join, docs preview/build, score, Arazzo, or config validation features.

Sources:

- [Redocly CLI commands](https://redocly.com/docs/cli/commands)
- [Redocly bundle command](https://redocly.com/docs/cli/commands/bundle)
- [Redocly CLI npm package](https://www.npmjs.com/package/@redocly/cli)
- [Migrate from swagger-cli to Redocly CLI](https://redocly.com/docs/cli/guides/migrate-from-swagger-cli)

### Speakeasy CLI

Speakeasy is a platform-oriented OpenAPI native toolchain focused on SDK generation, Terraform providers, MCP servers, workflows, overlays, and OpenAPI preparation.

Key commands and features:

- `speakeasy openapi lint` for linting and validating OpenAPI documents.
- `speakeasy validate openapi` as a validation-oriented flow in some docs.
- `speakeasy overlay` for OpenAPI Overlay workflows, including comparing specs to generate overlays.
- `speakeasy configure sources` for configuring OpenAPI inputs and overlays.
- `speakeasy quickstart` for guided project setup.
- `speakeasy run` to execute workflows from workflow config.
- SDK generation in Go, Python, TypeScript, Java, PHP, C#, Ruby, and more.
- Terraform provider generation.
- MCP server generation.
- Generated CLI creation from OpenAPI, using generated Go SDKs and Cobra.
- GitHub Actions/workflow integration.
- Authentication and platform interactions.

Varsity overlap:

- Overlap on OpenAPI validation.
- No overlap for overlays, workflows, SDK generation, Terraform generation, MCP generation, generated CLIs, platform auth, or workflow configuration.

Sources:

- [Speakeasy CLI reference](https://www.speakeasy.com/docs/speakeasy-reference/cli)
- [Speakeasy OpenAPI command](https://www.speakeasy.com/docs/speakeasy-reference/cli/openapi)
- [Speakeasy OpenAPI lint](https://www.speakeasy.com/docs/speakeasy-reference/cli/openapi/lint)
- [Speakeasy overlays](https://www.speakeasy.com/docs/prep-openapi/overlays/create-overlays)
- [Generate a CLI from OpenAPI](https://www.speakeasy.com/docs/cli-generation/create-cli)
- [Generate SDKs from OpenAPI](https://www.speakeasy.com/docs/sdks/create-client-sdks)

### Scalar CLI

Scalar CLI is a document-oriented OpenAPI tool with a broad `scalar document` command group for local OpenAPI files and URLs.

Key commands and features:

- `scalar document validate` to validate an OpenAPI file.
- `scalar document lint` to lint using Spectral-compatible rules, including custom local or registry rules.
- `scalar document bundle` to bundle references and dependencies.
- `scalar document split` to split documents into smaller chunks.
- `scalar document join` to merge multiple documents.
- `scalar document format` to format an OpenAPI file.
- `scalar document convert` to convert Postman collections to OpenAPI.
- `scalar document markdown` to generate Markdown from OpenAPI.
- `scalar document mock` to start a mock API server.
- `scalar document serve` to serve an API Reference locally, with watch/port/once options.
- `scalar document share` to share an OpenAPI file.
- `scalar document upgrade` to upgrade to OpenAPI 3.1.
- `scalar document void` to boot a request-mirroring server.

Varsity overlap:

- Overlap on validation and local/remote JSON/YAML input.
- Partial conceptual overlap between Varsity reports and Scalar Markdown/docs output, but Scalar focuses on API reference/docs artifacts.
- No overlap for lint rulesets, bundle/split/join, format/convert/upgrade, mock server, docs server, share, or request mirroring.

Sources:

- [Scalar CLI commands](https://scalar.com/tools/cli/commands)
- [Scalar mock server guide](https://scalar.com/blog/posts/2025-08-19-how-to-set-up-an-openapi-mock-server)
- [Scalar registry rules](https://scalar.com/products/registry/rules)
- [Scalar CLI package README](https://github.com/scalar/scalar/blob/main/packages/cli/README.md)

### Stoplight Spectral CLI

Spectral is a flexible JSON/YAML linter with built-in OpenAPI, AsyncAPI, and Arazzo rulesets and custom ruleset support.

Key commands and features:

- `spectral lint <file-pattern>` to lint documents.
- Ruleset discovery through `.spectral.yaml`, `.spectral.yml`, `.spectral.json`, or `.spectral.js`.
- Custom rules and functions.
- Built-in OpenAPI rulesets.
- JSONPath-based targeting.
- Multiple output formats including stylish, JSON, JUnit, SARIF, and others.
- Multiple output files through repeated `-f` and `-o` flags.

Varsity overlap:

- Partial overlap on validation intent.
- Varsity does not implement configurable linting, rulesets, custom functions, SARIF, or JUnit output.

Sources:

- [Spectral GitHub repository](https://github.com/stoplightio/spectral)
- [Spectral CLI guide](https://github.com/stoplightio/spectral/blob/develop/docs/guides/2-cli.md)
- [Spectral npm package](https://registry.npmjs.org/@stoplight/spectral-cli)

### Vacuum

Vacuum is a high-performance OpenAPI linter and toolkit written in Go, with Spectral-compatible ruleset support and several reporting modes.

Key commands and features:

- `vacuum lint` for OpenAPI linting.
- `vacuum report` for replayable lint run data and JUnit XML output.
- `vacuum html-report` for interactive HTML reports.
- `vacuum spectral-report` for Spectral-compatible JSON output.
- `vacuum bundle` for bundling.
- `vacuum dashboard` for interactive review.
- `vacuum language-server` for editor integration.
- `vacuum apply-overlay`.
- Change detection and changed-area filtering.
- Ruleset and custom function support.
- Stdin/stdout support in report commands.

Varsity overlap:

- Partial overlap in validation and HTML report generation.
- No overlap for rulesets, lint dashboards, Spectral-compatible reports, JUnit, language server, bundle, overlay application, or change detection.

Sources:

- [Vacuum GitHub repository](https://github.com/daveshanley/vacuum)
- [Vacuum spectral-report command](https://quobix.com/vacuum/commands/spectral-report/)
- [Vacuum report command](https://quobix.com/vacuum/commands/report/)

### APIDevTools Swagger CLI

Swagger CLI is a legacy/deprecated tool for validation and bundling of Swagger/OpenAPI documents. Redocly now recommends migrating to Redocly CLI.

Key commands and features:

- `swagger-cli validate <file>` for Swagger/OpenAPI validation.
- `swagger-cli bundle <file>` for bundling multi-file definitions.
- `--dereference` to fully inline `$ref`s.
- `--outfile`, `--type json|yaml`, formatting, and YAML wrapping options.

Varsity overlap:

- Strong overlap on validation.
- No overlap for bundle/dereference output.

Sources:

- [swagger-cli npm package](https://www.npmjs.com/package/swagger-cli)
- [APIDevTools swagger-cli repository](https://github.com/BigstickCarpet/swagger-cli)
- [Redocly migration guide from swagger-cli](https://redocly.com/docs/cli/guides/migrate-from-swagger-cli)

### OpenAPI Generator CLI

OpenAPI Generator CLI is primarily a code generation tool for clients, servers, docs, and configuration artifacts.

Key commands and features:

- `generate` to generate code from an input specification.
- `validate` to validate an input specification and optionally provide recommendations.
- `list` to list available generators.
- `config-help` for generator-specific config.
- `batch` for external YAML/JSON generation configs.
- `author template` to extract templates for customization.
- `meta` to create a new generator/template set.
- Supports client SDKs, server stubs, documentation, many languages, templates, type/import mappings, global properties, and generator configs.

Varsity overlap:

- Overlap on validation.
- No overlap for code generation, generator listing, config help, batch generation, template authoring, or meta-generator creation.

Sources:

- [OpenAPI Generator usage docs](https://openapi-generator.tech/docs/usage/)
- [OpenAPI Generator CLI repository](https://github.com/OpenAPITools/openapi-generator-cli)
- [OpenAPI Generator templating docs](https://openapi-generator.tech/docs/templating/)

### oasdiff

oasdiff is a specialized OpenAPI diff and breaking-change detection CLI.

Key commands and features:

- `oasdiff diff` for detailed structural differences.
- `oasdiff breaking` for breaking changes.
- `oasdiff changelog` for important changes, breaking and non-breaking.
- `oasdiff flatten` to replace `allOf` with merged equivalents.
- `oasdiff checks` to list checks.
- Local file, URL, git revision, and collection comparisons.
- Output formats including YAML, JSON, text, Markdown, HTML, JUnit XML, and GitHub Actions annotations.
- `--fail-on` and `--fail-on-diff` for CI gating.
- Change fingerprints, path filters, extension exclusions, stability levels, localization, custom checks, and report customization.

Varsity overlap:

- Some conceptual overlap with structural analysis, but Varsity operates on one document and does not diff versions.
- No overlap for breaking-change detection, changelog, git ref comparison, or CI change gates.

Sources:

- [oasdiff GitHub repository](https://github.com/oasdiff/oasdiff)
- [oasdiff diff docs](https://github.com/oasdiff/oasdiff/blob/main/docs/DIFF.md)
- [oasdiff breaking changes docs](https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md)
- [oasdiff website](https://www.oasdiff.com/)

### Stoplight Prism

Prism turns OpenAPI documents into mock servers and validation proxies.

Key commands and features:

- `prism mock` to create a mock HTTP server.
- `prism proxy <spec> <upstream>` to validate traffic against a real upstream API.
- Request validation for parameters, headers, and bodies.
- Response validation in proxy mode.
- Static and dynamic response generation.
- `--errors` to return validation failures as RFC 7807 problem details.
- `--validate-request false` to skip request validation while validating responses.
- Support for OpenAPI 2.0, OpenAPI 3.x, and Postman collections.

Varsity overlap:

- No direct overlap beyond reading OpenAPI documents.
- Varsity validates specs, not HTTP requests/responses or upstream behavior.

Sources:

- [Prism GitHub repository](https://github.com/stoplightio/prism)
- [Prism CLI docs](https://github.com/stoplightio/prism/blob/master/docs/getting-started/03-cli.md)
- [Prism mocking guide](https://github.com/stoplightio/prism/blob/master/docs/guides/01-mocking.md)

### Dredd

Dredd validates an API implementation against an API description document by executing HTTP transactions.

Key commands and features:

- `dredd <api-description> <endpoint>` to test an implementation.
- `dredd init` to generate `dredd.yml`.
- `--dry-run` to parse and compile transactions without HTTP requests.
- `--hookfiles` for setup, teardown, authentication, transaction mutation, skipping tests, and custom expectations.
- `--path` for additional API description documents.
- `--server` and `--server-wait` to run backend commands.
- Method and transaction filtering.
- Multiple reporters including xUnit and HTML.
- Supports API Blueprint, OpenAPI 2, and experimental OpenAPI 3.

Varsity overlap:

- No direct overlap beyond OpenAPI document parsing/validation context.
- Varsity does not execute HTTP transactions or validate backend behavior.

Sources:

- [Dredd documentation](https://dredd.org/)
- [Dredd CLI usage](https://dredd.org/en/latest/usage-cli.html)
- [Dredd hooks](https://dredd.org/en/latest/hooks/)

### Bump.sh CLI

Bump.sh CLI focuses on API documentation and hubs hosted on Bump.sh, including validation, diffing, previews, deployment, and overlays.

Key commands and features:

- `bump deploy [FILE]` to publish a new documentation version.
- `bump deploy --dry-run` to validate without publishing.
- `bump diff [FILE]` to compare a local document with deployed documentation.
- `--fail-on-breaking` for CI gates.
- `bump preview [FILE]` to create a temporary hosted documentation preview URL.
- `bump preview --live` for continuously updated previews.
- `bump overlay <definition> <overlay>` to apply OpenAPI overlays.
- OpenAPI, Swagger, AsyncAPI, and workflow format support.

Varsity overlap:

- Overlap on validation only.
- No overlap for hosted docs, deploy/preview, diffing against hosted docs, breaking-change gates, or overlays.

Sources:

- [Bump.sh CLI docs](https://docs.bump.sh/help/continuous-integration/cli/)
- [Bump.sh CLI repository](https://github.com/bump-sh/cli)
- [Bump.sh CI workflow docs](https://docs.bump.sh/help/continuous-integration/)

### Fern CLI

Fern uses OpenAPI and other API definitions to generate SDKs and API documentation.

Key commands and features:

- `fern init --openapi <path-or-url>` to initialize a Fern project from OpenAPI.
- `fern check` to validate API definition and configuration.
- `fern generate` to generate SDKs.
- `fern generate --docs` for documentation generation/publishing workflows.
- `fern add <generator>` to add SDK generators.
- `fern generate --local` to run generators locally in Docker.
- `fern export` to export OpenAPI.
- `fern api update` and `fern api enrich`.
- `fern docs diff`, docs theme commands, and docs configuration validation.

Varsity overlap:

- Overlap on validation intent through `fern check`, but Fern checks Fern configuration and docs configuration too.
- No overlap for project initialization, SDK generation, docs generation, generator management, export/update/enrich workflows, or platform login.

Sources:

- [Fern repository](https://www.github.com/fern-api/fern)
- [Fern CLI commands](https://buildwithfern.com/learn/cli-api-reference/cli-reference/commands)
- [Fern TypeScript SDK quickstart](https://buildwithfern.com/learn/sdks/generators/typescript/quickstart)

### Microsoft Kiota

Kiota generates strongly typed API clients from OpenAPI descriptions and includes registry/discovery commands.

Key commands and features:

- `kiota search` to search for APIs and descriptions in registries.
- `kiota download` to download descriptions.
- `kiota show` to display API path trees.
- `kiota generate` to generate clients.
- `kiota update` to update existing clients from lock files.
- `kiota info` to show language support and runtime dependencies.
- `kiota login` and `logout` for private repositories.
- Generation filters such as include/exclude path.
- Options for backing store, additional data, serializers/deserializers, clean output, cache clearing, MIME types, and disabled validation rules.

Varsity overlap:

- Some overlap with `summary`/`analyze` in the general concept of introspection.
- No overlap for search/download registries, client generation, update workflows, language info, login, or path-filtered generation.

Sources:

- [Using the Kiota tool](https://learn.microsoft.com/en-us/openapi/kiota/using)
- [Kiota repository](https://github.com/microsoft/kiota/)
- [Kiota Python quickstart](https://learn.microsoft.com/en-us/openapi/kiota/quickstarts/python)

### APIMatic CLI

APIMatic CLI automates validation, format transformation, SDK generation/publishing, and documentation portal workflows.

Key commands and features:

- `apimatic api validate` to validate specifications.
- `apimatic api transform` to convert among OpenAPI, Swagger, RAML, WSDL, Postman, API Blueprint, and other formats.
- `apimatic sdk generate` for multi-language SDK generation.
- `apimatic sdk publish` to generate and publish SDKs to package registries or source repositories.
- `apimatic publishing profile list`.
- `apimatic portal generate` and `portal serve`.
- `apimatic quickstart`.
- Auth commands and autocomplete.

Varsity overlap:

- Overlap on validation.
- No overlap for transformation, SDK generation/publishing, portal generation/serving, publishing profiles, auth, or autocomplete.

Sources:

- [APIMatic CLI commands](https://docs.apimatic.io/apimatic-cli/commands/)
- [APIMatic CLI repository](https://github.com/apimatic/apimatic-cli)
- [APIMatic SDK publish changelog](https://docs.apimatic.io/changelog/cli-sdk-publish-and-publishing-profile-list/)

### openapi-typescript

openapi-typescript is a focused CLI for generating TypeScript types from OpenAPI 3.0 and 3.1 schemas.

Key commands and features:

- `openapi-typescript <input> -o <output>` for type generation.
- Local and remote JSON/YAML schemas.
- `--redocly` for multi-schema Redocly config support.
- `--check` to verify generated types are up-to-date.
- Type generation options including `--export-type`, `--enum`, `--immutable`, `--alphabetize`, `--exclude-deprecated`, `--root-types`, `--path-params-as-types`, `--make-paths-enum`, `--generate-path-params`, and read/write markers.
- Node API with transform hooks.

Varsity overlap:

- Overlap on reading OpenAPI JSON/YAML from local/remote sources.
- No overlap for generating TypeScript types or type-check freshness.

Sources:

- [openapi-typescript CLI docs](https://openapi-ts.dev/cli)
- [openapi-typescript repository](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-typescript)
- [openapi-typescript Node API](https://openapi-ts.dev/node)

### Hey API OpenAPI TypeScript

Hey API's `@hey-api/openapi-ts` generates TypeScript SDKs, schemas, clients, and integration code from OpenAPI.

Key commands and features:

- `npx @hey-api/openapi-ts -i <input> -o <output>`.
- Config file support through `openapi-ts.config.ts`.
- Default TypeScript interfaces and SDK generation.
- Fetch client by default, with Angular, Axios, Ky, Next.js, Nuxt, ofetch, and other clients.
- Plugins for SDKs, Zod, Valibot, TanStack Query integrations, Fastify, NestJS, oRPC, and more.
- Registry sync workflows.

Varsity overlap:

- No direct feature overlap beyond parsing OpenAPI as input.
- Varsity does not generate clients, SDKs, validators, or integration code.

Sources:

- [Hey API OpenAPI TypeScript repository](https://github.com/hey-api/openapi-ts)
- [Hey API npm package](https://registry.npmjs.org/@hey-api/openapi-ts)

### Orval

Orval generates type-safe TypeScript API clients, hooks, mocks, and validators from OpenAPI v2/v3.

Key commands and features:

- `orval` generation command, usually configured via `orval.config.ts`.
- TypeScript client generation.
- React Query, Vue Query, Svelte Query, Solid Query, SWR, Angular, Hono, native fetch, Zod, and MCP-related generation.
- Modes such as tag-split.
- Generated schemas/models.
- MSW mock generation with Faker.js data.
- Custom mutators, operation overrides, filters, clean output, barrel files, and post-write hooks.

Varsity overlap:

- No direct overlap beyond OpenAPI input.
- Varsity's `partition` is conceptually tag-oriented, but it partitions specs, while Orval tag-split partitions generated code.

Sources:

- [Orval website](https://orval.dev/)
- [Orval repository](https://github.com/orval-labs/orval/)

### Kubb

Kubb is a plugin-based code generation framework for OpenAPI/Swagger to TypeScript-oriented output.

Key commands and features:

- `npx kubb init` for interactive setup.
- `npx kubb generate` for generation.
- `kubb.config.ts` configuration.
- OpenAPI adapter and plugin architecture.
- TypeScript types, clients, React/Vue/Solid/Svelte Query hooks, SWR, Zod schemas, Faker generators, MSW handlers, and custom plugins.
- Output clean, progress tracking, debug mode, parser/middleware customization.

Varsity overlap:

- No direct overlap beyond OpenAPI input.
- Varsity does not provide generated application code or plugin-based codegen.

Sources:

- [Kubb website](https://kubb.dev/)
- [Kubb introduction](https://kubb.dev/kubb/getting-started/introduction)
- [Kubb quick start](https://kubb.dev/kubb/getting-started/quick-start)

### Portman

Portman converts OpenAPI specs into Postman collections and injects contract, variation, and integration tests.

Key commands and features:

- `portman -l <openapi> -c <portman-config>` to generate a Postman collection with tests.
- Contract tests, variation tests, and integration tests.
- Postman pre-request scripts.
- Request and variable customization.
- `--runNewman` to run generated collections through Newman.
- `--syncPostman` to upload collections to a Postman workspace.
- `--bundleContractTests` to group requests with contract tests.

Varsity overlap:

- No direct overlap.
- Varsity validates OpenAPI documents, but does not generate executable API test collections.

Sources:

- [Portman repository](https://github.com/apideck-libraries/portman)
- [Portman npm package](https://www.npmjs.com/package/@apideck/portman)
- [Portman contract test example](https://github.com/apideck-libraries/portman/blob/main/examples/testsuite-contract-tests/readme.md)

### IBM OpenAPI Validator

IBM OpenAPI Validator is a ruleset-driven linter/validator based around IBM Cloud validation rules and Spectral compatibility.

Key commands and features:

- `lint-openapi [options] [file...]`.
- `--config` for JSON/YAML/JS config.
- `--ruleset` for Spectral rulesets or `default` IBM ruleset.
- `--json`, `--errors-only`, `--summary-only`, `--markdown-report`.
- `--ignore` and config-based ignore behavior.
- Impact scoring.
- Warning limits and log-level controls.
- Custom rules via Spectral ruleset files.

Varsity overlap:

- Overlap on OpenAPI validation.
- No overlap for rulesets, config files, ignore files, impact scoring, warning limits, or Markdown lint reports with rule metadata.

Sources:

- [IBM OpenAPI Validator repository](https://github.com/IBM/openapi-validator)
- [IBM OpenAPI Validator npm package](https://www.npmjs.com/package/ibm-openapi-validator)
- [IBM Cloud rules docs](https://github.com/IBM/openapi-validator/blob/main/docs/ibm-cloud-rules.md)

### Optic

Optic is an archived OpenAPI tool focused on diffing, forwards-only governance, breaking-change prevention, and traffic capture.

Key commands and features:

- `optic diff <spec> --base <ref> --check` for breaking-change and governance checks.
- Git ref comparison.
- `--web` HTML changelog visualization.
- Spectral ruleset integration scoped to added/changed/always areas.
- `optic capture <openapi.yml>` to capture integration-test traffic.
- `optic capture --update interactive|automatic|documented` to update specs from observed traffic.
- Proxy port, HAR/Postman input, server override, upload, and verbose options.

Varsity overlap:

- No direct overlap beyond OpenAPI input and broad validation goals.
- Varsity does not diff versions, enforce forwards-only rules, capture traffic, or patch specs.

Sources:

- [Optic diff and lint wiki](https://github.com/opticdev/optic/wiki/Diff-and-Lint-OpenAPI)
- [Optic generate/update OpenAPI docs](https://github.com/opticdev/optic/blob/main/docs/generate-openapi.md)
- [Optic capture with integration tests](https://github.com/opticdev/optic/wiki/Using-Optic-Capture-with-Integration-Tests)

## Prioritized Gap Analysis For Varsity

These are not automatic recommendations. They are the most obvious product-surface gaps if Varsity is intended to compete more directly with public OpenAPI CLIs.

### High-Leverage Gaps

1. Configurable ruleset linting
   - Why it matters: Redocly, Spectral, Vacuum, Scalar, Speakeasy, and IBM Validator all treat governance linting as a core API quality workflow.
   - Current Varsity state: fixed `--strict`, `--examples`, and `--references` checks only.
   - Possible CLI shape: `varsity lint <sources...> --ruleset <file> --format json|text|sarif|junit`.

2. Bundle and dereference
   - Why it matters: Redocly, Swagger CLI, Scalar, and Vacuum all expose bundling as a core interoperability workflow.
   - Current Varsity state: recursive validation follows refs, but no bundled output is emitted.
   - Possible CLI shape: `varsity bundle <source> --output openapi.yaml --dereference --remove-unused-components`.

3. Conventional split and join
   - Why it matters: Redocly and Scalar expose split/join as spec file-management primitives.
   - Current Varsity state: `split` is reserved; `partition` is tag-based and intentionally different.
   - Possible CLI shape: `varsity split <source> --output openapi/` and `varsity join <sources...> --output openapi.yaml`.

4. CI-native output formats
   - Why it matters: Spectral, Vacuum, Redocly, oasdiff, and Dredd integrate deeply into CI through SARIF, JUnit, Checkstyle, and annotations.
   - Current Varsity state: JSON/YAML/HTML/Markdown reports only.
   - Possible CLI shape: `varsity validate spec.yaml --format sarif` or `varsity report --format junit`.

5. Diff and breaking-change detection
   - Why it matters: oasdiff, Bump, and Optic address API evolution, not just single-document quality.
   - Current Varsity state: no two-spec comparison.
   - Possible CLI shape: `varsity diff base.yaml head.yaml`, `varsity breaking base.yaml head.yaml --fail-on warn`.

### Medium-Leverage Gaps

1. Config file support
   - A `varsity.yaml` could centralize validation depth, report formats, rules, output directories, and partition settings.

2. Ignore/suppression workflow
   - Useful if Varsity grows ruleset linting or stricter validators.

3. OpenAPI overlays
   - Speakeasy, Bump, and Vacuum make overlays part of non-destructive spec customization.

4. Docs preview/build
   - Valuable if Varsity wants to compete with Redocly/Scalar/Bump/Fern/APIMatic rather than remain validation-focused.

5. Mock server or validation proxy
   - Valuable if Varsity wants runtime contract-testing workflows similar to Scalar/Prism/Dredd/Optic.

### Lower-Priority Or Out-Of-Scope Gaps

1. Multi-language SDK generation
   - Large product surface with heavy maintenance burden; already crowded by Speakeasy, OpenAPI Generator, Fern, Kiota, and APIMatic.

2. TypeScript SDK/type generation
   - Crowded by openapi-typescript, Hey API, Orval, and Kubb.

3. Hosted registry/platform workflows
   - Would shift Varsity from a local CLI/library to a platform product.

4. Terraform provider or MCP server generation
   - High complexity and likely outside the current validation/analysis identity.

## Source Index

### Redocly

- [Redocly CLI commands](https://redocly.com/docs/cli/commands)
- [Redocly bundle command](https://redocly.com/docs/cli/commands/bundle)
- [Redocly CLI npm package](https://www.npmjs.com/package/@redocly/cli)
- [Migrate from swagger-cli to Redocly CLI](https://redocly.com/docs/cli/guides/migrate-from-swagger-cli)

### Speakeasy

- [Speakeasy CLI reference](https://www.speakeasy.com/docs/speakeasy-reference/cli)
- [Speakeasy OpenAPI command](https://www.speakeasy.com/docs/speakeasy-reference/cli/openapi)
- [Speakeasy OpenAPI lint](https://www.speakeasy.com/docs/speakeasy-reference/cli/openapi/lint)
- [Speakeasy overlays](https://www.speakeasy.com/docs/prep-openapi/overlays/create-overlays)
- [Generate a CLI from OpenAPI](https://www.speakeasy.com/docs/cli-generation/create-cli)
- [Generate SDKs from OpenAPI](https://www.speakeasy.com/docs/sdks/create-client-sdks)

### Scalar

- [Scalar CLI commands](https://scalar.com/tools/cli/commands)
- [Scalar mock server guide](https://scalar.com/blog/posts/2025-08-19-how-to-set-up-an-openapi-mock-server)
- [Scalar registry rules](https://scalar.com/products/registry/rules)
- [Scalar CLI package README](https://github.com/scalar/scalar/blob/main/packages/cli/README.md)

### Linting And Validation Tools

- [Spectral GitHub repository](https://github.com/stoplightio/spectral)
- [Spectral CLI guide](https://github.com/stoplightio/spectral/blob/develop/docs/guides/2-cli.md)
- [Spectral npm package](https://registry.npmjs.org/@stoplight/spectral-cli)
- [Vacuum GitHub repository](https://github.com/daveshanley/vacuum)
- [Vacuum spectral-report command](https://quobix.com/vacuum/commands/spectral-report/)
- [Vacuum report command](https://quobix.com/vacuum/commands/report/)
- [IBM OpenAPI Validator repository](https://github.com/IBM/openapi-validator)
- [IBM OpenAPI Validator npm package](https://www.npmjs.com/package/ibm-openapi-validator)
- [IBM Cloud rules docs](https://github.com/IBM/openapi-validator/blob/main/docs/ibm-cloud-rules.md)

### Bundling And Generation Tools

- [swagger-cli npm package](https://www.npmjs.com/package/swagger-cli)
- [APIDevTools swagger-cli repository](https://github.com/BigstickCarpet/swagger-cli)
- [OpenAPI Generator usage docs](https://openapi-generator.tech/docs/usage/)
- [OpenAPI Generator CLI repository](https://github.com/OpenAPITools/openapi-generator-cli)
- [OpenAPI Generator templating docs](https://openapi-generator.tech/docs/templating/)
- [openapi-typescript CLI docs](https://openapi-ts.dev/cli)
- [openapi-typescript repository](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-typescript)
- [Hey API OpenAPI TypeScript repository](https://github.com/hey-api/openapi-ts)
- [Orval website](https://orval.dev/)
- [Orval repository](https://github.com/orval-labs/orval/)
- [Kubb website](https://kubb.dev/)
- [Kubb introduction](https://kubb.dev/kubb/getting-started/introduction)

### Diff, Mocking, Contract Testing, And Platforms

- [oasdiff GitHub repository](https://github.com/oasdiff/oasdiff)
- [oasdiff diff docs](https://github.com/oasdiff/oasdiff/blob/main/docs/DIFF.md)
- [oasdiff breaking changes docs](https://github.com/oasdiff/oasdiff/blob/main/docs/BREAKING-CHANGES.md)
- [Prism GitHub repository](https://github.com/stoplightio/prism)
- [Prism CLI docs](https://github.com/stoplightio/prism/blob/master/docs/getting-started/03-cli.md)
- [Dredd documentation](https://dredd.org/)
- [Dredd CLI usage](https://dredd.org/en/latest/usage-cli.html)
- [Portman repository](https://github.com/apideck-libraries/portman)
- [Bump.sh CLI docs](https://docs.bump.sh/help/continuous-integration/cli/)
- [Bump.sh CLI repository](https://github.com/bump-sh/cli)
- [Fern CLI commands](https://buildwithfern.com/learn/cli-api-reference/cli-reference/commands)
- [Kiota tool docs](https://learn.microsoft.com/en-us/openapi/kiota/using)
- [APIMatic CLI commands](https://docs.apimatic.io/apimatic-cli/commands/)
- [Optic diff and lint wiki](https://github.com/opticdev/optic/wiki/Diff-and-Lint-OpenAPI)
