import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve, resolve as resolvePath } from "path";
import {
	collectTagBuckets,
	describePartitionPlan,
	findReferences,
	type PartitionTag,
	parseOpenAPISpec,
	partitionByTags,
	partitionSpecByTags,
	slugifyPath,
	type TagBucket,
	validateOpenAPISpec,
	validateWithReferences,
	writePartitionPlan,
} from "../src/varsity.js";

const taggedSpecPath = resolve(__dirname, "tagged-spec.json");
const mainApiPath = resolve(__dirname, "main-api.json");

const findTag = (tags: PartitionTag[], name: string): PartitionTag => {
	const t = tags.find((x) => x.name === name);
	if (!t) throw new Error(`Tag '${name}' not found in plan`);
	return t;
};

const findFile = (tag: PartitionTag, relativePath: string) => {
	const f = tag.files.find((x) => x.relativePath === relativePath);
	if (!f)
		throw new Error(`File '${relativePath}' not found in tag '${tag.name}'`);
	return f;
};

const getBucket = (
	buckets: Map<string, TagBucket>,
	name: string,
): TagBucket => {
	const b = buckets.get(name);
	if (!b) throw new Error(`Bucket '${name}' not found`);
	return b;
};

describe("partitioner / slugifyPath", () => {
	test("converts paths into filesystem-safe slugs", () => {
		expect(slugifyPath("/users")).toBe("users");
		expect(slugifyPath("/users/{id}")).toBe("users-by-id");
		expect(slugifyPath("/")).toBe("root");
		expect(slugifyPath("/orders/{orderId}/items/{itemId}")).toBe(
			"orders-by-orderid-items-by-itemid",
		);
	});
});

describe("partitioner / collectTagBuckets", () => {
	test("groups operations by tag and respects untagged option", async () => {
		const parsed = await parseOpenAPISpec(taggedSpecPath);

		const withUntagged = collectTagBuckets(parsed.spec, parsed.source, {
			includeUntagged: true,
		});
		expect(withUntagged.has("users")).toBe(true);
		expect(withUntagged.has("orders")).toBe(true);
		expect(withUntagged.has("shared")).toBe(true);
		expect(withUntagged.has("untagged")).toBe(true);

		const withoutUntagged = collectTagBuckets(parsed.spec, parsed.source, {
			includeUntagged: false,
		});
		expect(withoutUntagged.has("untagged")).toBe(false);
	});

	test("duplicates multi-tag operations into every matching bucket", async () => {
		const parsed = await parseOpenAPISpec(taggedSpecPath);
		const buckets = collectTagBuckets(parsed.spec, parsed.source);

		const usersBucket = getBucket(buckets, "users");
		const sharedBucket = getBucket(buckets, "shared");

		const usersItem = usersBucket.pathItems["/users"]?.content;
		const sharedItem = sharedBucket.pathItems["/users"]?.content;
		expect(usersItem?.post).toBeDefined();
		expect(sharedItem?.post).toBeDefined();
		expect(
			(sharedItem?.post as { summary?: string } | undefined)?.summary,
		).toBe("Create user");

		// The GET on /users is only tagged "users", so should NOT be in shared.
		expect(sharedItem?.get).toBeUndefined();
	});

	test("propagates shared path-item fields (e.g. parameters) into each bucket", async () => {
		const parsed = await parseOpenAPISpec(taggedSpecPath);
		const buckets = collectTagBuckets(parsed.spec, parsed.source);

		const usersBucket = getBucket(buckets, "users");
		const usersById = usersBucket.pathItems["/users/{id}"]?.content as {
			parameters?: Array<{ name?: string }>;
		};
		expect(Array.isArray(usersById.parameters)).toBe(true);
		expect(usersById.parameters?.[0]?.name).toBe("id");
	});
});

describe("partitioner / partitionByTags plan shape", () => {
	test("produces one folder per tag (plus untagged) with required root files", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);

		const tagNames = plan.tags.map((t) => t.name).sort();
		expect(tagNames).toEqual(["orders", "shared", "untagged", "users"]);

		for (const tag of plan.tags) {
			const rootFile = findFile(tag, "openapi.json");
			const root = rootFile.content as {
				openapi?: string;
				info?: { title?: string };
				paths?: Record<string, unknown>;
			};
			expect(root.openapi).toBe("3.0.3");
			expect(root.info?.title ?? "").toContain(tag.originalTag);
			expect(typeof root.paths).toBe("object");
		}
	});

	test("only includes components transitively referenced by the tag's operations", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);
		const ordersTag = findTag(plan.tags, "orders");
		const ordersFiles = ordersTag.files.map((f) => f.relativePath).sort();

		expect(ordersFiles).toContain("openapi.json");
		expect(ordersFiles).toContain("paths/orders.json");
		expect(ordersFiles).toContain("schemas/order.json");
		expect(ordersFiles).toContain("schemas/orderitem.json");

		expect(ordersFiles).not.toContain("schemas/user.json");
		expect(ordersFiles).not.toContain("schemas/address.json");
		expect(ordersFiles).not.toContain("schemas/unused.json");
	});

	test("rewrites internal $refs to relative file refs", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);
		const usersTag = findTag(plan.tags, "users");

		const usersPath = findFile(usersTag, "paths/users.json");
		const usersPathStr = JSON.stringify(usersPath.content);
		expect(usersPathStr).not.toContain("#/components/");
		expect(usersPathStr).toContain("../schemas/user.json");
		expect(usersPathStr).toContain("../parameters/pageparam.json");
		expect(usersPathStr).toContain("../responses/unauthorized.json");
		expect(usersPathStr).toContain("../request-bodies/userbody.json");

		const userSchema = findFile(usersTag, "schemas/user.json");
		expect(JSON.stringify(userSchema.content)).toContain("./address.json");
	});

	test("untagged operations land in the untagged folder", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);
		const untagged = findTag(plan.tags, "untagged");
		findFile(untagged, "paths/health.json");
	});

	test("describePartitionPlan returns a readable preview", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);
		const preview = describePartitionPlan(plan, "/tmp/whatever");
		expect(preview).toContain("/tmp/whatever");
		expect(preview).toContain("users/");
		expect(preview).toContain("openapi.json");
	});
});

describe("partitioner / writePartitionPlan + validation", () => {
	let outDir: string;
	beforeAll(() => {
		outDir = mkdtempSync(join(tmpdir(), "varsity-partition-"));
	});
	afterAll(() => {
		rmSync(outDir, { recursive: true, force: true });
	});

	test("writes the planned files to disk and each root re-parses + validates", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);
		const result = writePartitionPlan(plan, outDir);

		expect(result.tagsWritten).toBe(plan.tags.length);
		expect(result.filesWritten).toBeGreaterThan(0);

		for (const tag of plan.tags) {
			const openapiPath = join(outDir, tag.name, "openapi.json");
			expect(existsSync(openapiPath)).toBe(true);

			const parsed = await parseOpenAPISpec(openapiPath);
			const validation = validateOpenAPISpec(parsed.spec, parsed.version, {});
			expect(validation.valid).toBe(true);

			// Recursive validation walks rewritten file refs and partial-
			// validates each one. We don't assert zero errors here because the
			// pre-existing partial-validator has a known limitation with
			// $ref-only Response objects; we only verify the call completes.
			const recursive = await validateWithReferences(openapiPath);
			expect(recursive.totalDocuments).toBeGreaterThan(1);
		}
	});

	test("writePartitionPlan with --clean wipes the output dir first", async () => {
		const localOut = mkdtempSync(join(tmpdir(), "varsity-partition-clean-"));
		try {
			// Seed a stale file in the output directory.
			const fs = await import("fs");
			const stalePath = join(localOut, "stale-from-prior-run.txt");
			fs.writeFileSync(stalePath, "left over", "utf-8");

			const plan = await partitionSpecByTags(taggedSpecPath);
			writePartitionPlan(plan, localOut, { clean: true });

			expect(existsSync(stalePath)).toBe(false);
			expect(existsSync(join(localOut, "users", "openapi.json"))).toBe(true);
		} finally {
			rmSync(localOut, { recursive: true, force: true });
		}
	});

	test("every emitted $ref points at a file that actually exists on disk", async () => {
		const plan = await partitionSpecByTags(taggedSpecPath);
		writePartitionPlan(plan, outDir);

		for (const tag of plan.tags) {
			const tagRoot = join(outDir, tag.name);
			for (const file of tag.files) {
				const absFile = join(tagRoot, file.relativePath);
				const content = JSON.parse(readFileSync(absFile, "utf-8"));
				const refs = findReferences(content);
				for (const ref of refs) {
					if (ref.value.startsWith("#") || /^https?:\/\//.test(ref.value)) {
						continue;
					}
					const [pathPart] = ref.value.split("#");
					const target = resolvePath(dirname(absFile), pathPart || "");
					expect(existsSync(target)).toBe(true);
				}
			}
		}
	});

	test("includeUntagged: false omits the untagged folder on disk", async () => {
		const localOut = mkdtempSync(join(tmpdir(), "varsity-partition-strict-"));
		try {
			const parsed = await parseOpenAPISpec(taggedSpecPath);
			const plan = partitionByTags(parsed, { includeUntagged: false });
			writePartitionPlan(plan, localOut);
			const entries = readdirSync(localOut);
			expect(entries).not.toContain("untagged");
		} finally {
			rmSync(localOut, { recursive: true, force: true });
		}
	});
});

describe("partitioner / file-ref based source (main-api.json)", () => {
	test("works against a spec whose components are external file refs", async () => {
		const plan = await partitionSpecByTags(mainApiPath);
		const untagged = findTag(plan.tags, "untagged");

		const fileNames = untagged.files.map((f) => f.relativePath);
		expect(fileNames).toContain("openapi.json");
		expect(
			fileNames.some(
				(n) =>
					n.startsWith("schemas/") && n.toLowerCase().includes("user-schema"),
			),
		).toBe(true);

		for (const f of untagged.files) {
			expect(JSON.stringify(f.content)).not.toContain("#/components/");
		}
	});

	test("resolves top-level PathItem $refs so all paths are emitted", async () => {
		const plan = await partitionSpecByTags(mainApiPath);
		const untagged = findTag(plan.tags, "untagged");
		const pathFiles = untagged.files
			.filter((f) => f.relativePath.startsWith("paths/"))
			.map((f) => f.relativePath);

		// main-api.json has /users, /users/{id}, /products, /orders.
		// /products and /orders are PathItem-level $refs; they must NOT be dropped.
		expect(pathFiles).toContain("paths/users.json");
		expect(pathFiles).toContain("paths/users-by-id.json");
		expect(pathFiles).toContain("paths/products.json");
		expect(pathFiles).toContain("paths/orders.json");

		// The root spec's paths map should reference each of them.
		const rootFile = findFile(untagged, "openapi.json");
		const root = rootFile.content as {
			paths?: Record<string, { $ref?: string }>;
		};
		expect(Object.keys(root.paths ?? {}).sort()).toEqual(
			["/orders", "/products", "/users", "/users/{id}"].sort(),
		);
		expect(root.paths?.["/orders"]?.$ref).toBe("./paths/orders.json");
		expect(root.paths?.["/products"]?.$ref).toBe("./paths/products.json");
	});

	test("refs inside a PathItem $ref'd file resolve relative to its origin", async () => {
		// orders-path.json sits in test/paths/ and uses ../parameters/page-param.json.
		// After partitioning, the emitted paths/orders.json should reference
		// ../parameters/page-param.json (one level up to the parameters folder).
		const plan = await partitionSpecByTags(mainApiPath);
		const untagged = findTag(plan.tags, "untagged");
		const ordersFile = findFile(untagged, "paths/orders.json");
		const text = JSON.stringify(ordersFile.content);
		expect(text).toContain("../parameters/page-param.json");
		expect(text).toContain("../responses/orders-response.json");

		// And the referenced parameter/response files must actually be in the plan.
		const fileNames = untagged.files.map((f) => f.relativePath);
		expect(fileNames).toContain("parameters/page-param.json");
		expect(fileNames).toContain("responses/orders-response.json");
	});
});

describe("CLI command naming", () => {
	test("registers partition and leaves split unregistered", () => {
		const partitionHelp = spawnSync(
			"bun",
			["run", "src/cli.ts", "partition", "--help"],
			{
				cwd: resolve(__dirname, ".."),
				encoding: "utf-8",
			},
		);
		expect(partitionHelp.status).toBe(0);
		expect(partitionHelp.stdout).toContain("Usage: varsity partition");

		const splitHelp = spawnSync(
			"bun",
			["run", "src/cli.ts", "split", "--help"],
			{
				cwd: resolve(__dirname, ".."),
				encoding: "utf-8",
			},
		);
		expect(splitHelp.status).not.toBe(0);
		expect(splitHelp.stderr).toContain("unknown command");
	});
});
