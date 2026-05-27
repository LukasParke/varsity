import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "..");
const cli = ["run", "src/cli.ts"];

const runCli = (args: string[], input?: string) =>
  spawnSync("bun", [...cli, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    input,
  });

describe("CLI validation", () => {
  test("emits stable JSON for a single valid source", () => {
    const result = runCli(["validate", "test/sample-openapi.json", "--json"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout);
    expect(payload.valid).toBe(true);
    expect(payload.summary.total).toBe(1);
    expect(payload.results[0].source).toBe("test/sample-openapi.json");
  });

  test("exits non-zero and still emits JSON for invalid specs", () => {
    const dir = mkdtempSync(join(tmpdir(), "varsity-cli-"));
    const invalidPath = join(dir, "invalid.json");
    writeFileSync(invalidPath, JSON.stringify({ openapi: "3.0.3" }));

    try {
      const result = runCli(["validate", invalidPath, "--json"]);
      expect(result.status).toBe(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.valid).toBe(false);
      expect(payload.summary.errors).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts stdin via '-'", () => {
    const spec = readFileSync(resolve(repoRoot, "test/sample-openapi.yaml"), "utf-8");
    const result = runCli(["validate", "-", "--json"], spec);

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.valid).toBe(true);
    expect(payload.results[0].source).toBe("-");
  });
});
