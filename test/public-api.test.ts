import { describe, expect, test } from "bun:test";
import varsity, {
  createVarsity,
  generateSpecificationSummary,
  parse,
  validate,
  type ValidationResult,
} from "../index.js";

const objectSpec = {
  openapi: "3.0.3",
  info: { title: "Object API", version: "1.0.0" },
  paths: {},
};

describe("public API", () => {
  test("validates object inputs from the package entrypoint", async () => {
    const result = (await validate({
      kind: "object",
      value: objectSpec,
      source: "object-spec",
    })) as ValidationResult;

    expect(result.valid).toBe(true);
    expect(result.version).toBe("3.0.3");
  });

  test("parses raw content inputs", async () => {
    const parsed = await parse({
      kind: "content",
      source: "inline.yaml",
      content: [
        "openapi: 3.0.3",
        "info:",
        "  title: Inline API",
        "  version: 1.0.0",
        "paths: {}",
      ].join("\n"),
    });

    expect(parsed.metadata.title).toBe("Inline API");
  });

  test("createVarsity mirrors top-level capabilities", async () => {
    const api = createVarsity({ silent: true });
    const result = (await api.validate({
      kind: "object",
      value: objectSpec,
    })) as ValidationResult;
    const summary = await api.summary({ kind: "object", value: objectSpec });

    expect(result.valid).toBe(true);
    expect(summary.summary.title).toBe("Object API");
    expect(typeof api.partitionByTags).toBe("function");
  });

  test("default export remains usable", async () => {
    const summary = await generateSpecificationSummary({
      kind: "object",
      value: objectSpec,
    });
    expect(summary.summary.title).toBe("Object API");
    expect(varsity.getSupportedVersions()).toContain("3.0.3");
  });
});
