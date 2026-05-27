import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateWithReferences } from "../src/varsity.js";

describe("recursive validation", () => {
  test("follows nested YAML sidecar refs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "varsity-recursive-"));
    const root = join(dir, "openapi.yaml");

    writeFileSync(
      root,
      [
        "openapi: 3.0.3",
        "info:",
        "  title: YAML Ref API",
        "  version: 1.0.0",
        "paths:",
        "  /users:",
        "    get:",
        "      responses:",
        "        '200':",
        "          description: ok",
        "          content:",
        "            application/json:",
        "              schema:",
        "                $ref: './user.yaml'",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "user.yaml"),
      [
        "type: object",
        "properties:",
        "  profile:",
        "    $ref: './profile.yaml'",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "profile.yaml"),
      ["type: object", "properties:", "  name:", "    type: string"].join("\n"),
    );

    try {
      const result = await validateWithReferences(root);
      expect(result.valid).toBe(true);
      expect(result.totalDocuments).toBeGreaterThanOrEqual(3);
      expect(result.errors).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("accepts ref-only partial documents while following their targets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "varsity-ref-only-"));
    const root = join(dir, "openapi.json");

    writeFileSync(
      root,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Ref Only API", version: "1.0.0" },
        paths: {
          "/users": {
            get: {
              responses: {
                "200": { $ref: "./response.json" },
              },
            },
          },
        },
      }),
    );
    writeFileSync("".concat(dir, "/response.json"), JSON.stringify({ $ref: "./actual-response.json" }));
    writeFileSync(
      join(dir, "actual-response.json"),
      JSON.stringify({
        description: "ok",
        content: {
          "application/json": {
            schema: { type: "object" },
          },
        },
      }),
    );

    try {
      const result = await validateWithReferences(root);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
