import { readFileSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { dirname, resolve, basename, extname } from "path";
import * as yaml from "js-yaml";
import type { OpenAPISpec, ParsedSpec } from "./types.js";
import { parseOpenAPISpec } from "./parser.js";
import { serialize, extensionFor } from "./serializer.js";
import type { SerializationFormat } from "./serializer.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PartitionOptions {
  /** Output format for the generated files. Defaults to "json". */
  format?: SerializationFormat;
  /**
   * When true (default), operations without any `tags` are grouped into an
   * `untagged` folder. When false, those operations are dropped from output.
   */
  includeUntagged?: boolean;
  /** Maximum reference-resolution depth (defensive guard). Defaults to 25. */
  maxRefDepth?: number;
}

/**
 * Per-path-item entry inside a tag bucket.
 *
 * - `content`: the PathItem subset for this tag (only the operations whose
 *   tags select this bucket, plus the shared path-item fields).
 * - `sourceFile`: absolute path of the file the path item originally lived
 *   in. For inline path items this is the root spec; for path items expressed
 *   as a `$ref` (e.g. `{"/orders": {"$ref": "./paths/orders.json"}}`), this
 *   is the referenced file. Refs inside `content` are resolved relative to
 *   this file when partitioning.
 */
export interface BucketedPathItem {
  content: Record<string, unknown>;
  sourceFile: string;
}

/**
 * One bucket of work for a single tag (or "untagged").
 *
 * - `name`: filesystem-safe folder name (already slugified)
 * - `originalTag`: original tag string (or "untagged" sentinel)
 * - `pathItems`: filtered PathItem entries, keyed by the original path string
 */
export interface TagBucket {
  name: string;
  originalTag: string;
  pathItems: Record<string, BucketedPathItem>;
}

export interface PartitionFile {
  /** Path relative to the per-tag folder, using forward slashes. */
  relativePath: string;
  /** Parsed object to be serialized when written. */
  content: unknown;
}

export interface PartitionTag {
  name: string;
  originalTag: string;
  files: PartitionFile[];
}

export interface PartitionPlan {
  format: SerializationFormat;
  tags: PartitionTag[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

const COMPONENT_FOLDER_BY_KEY: Record<string, string> = {
  schemas: "schemas",
  parameters: "parameters",
  responses: "responses",
  requestBodies: "request-bodies",
  headers: "headers",
  examples: "examples",
  links: "links",
  callbacks: "callbacks",
  securitySchemes: "security-schemes",
  pathItems: "path-items",
};

const UNTAGGED = "untagged";

// ---------------------------------------------------------------------------
// Slug helpers
// ---------------------------------------------------------------------------

/**
 * Convert an arbitrary string into a filesystem-safe slug.
 *
 * Rules:
 *  - lowercase
 *  - `/` becomes `-`
 *  - `{param}` becomes `by-param`
 *  - any other non `[a-z0-9-_]` char becomes `-`
 *  - collapse consecutive `-` and trim
 */
export const slugify = (input: string): string => {
  if (!input) return "root";

  let slug = input.trim();
  slug = slug.replace(/\{([^}]+)\}/g, "by-$1");
  slug = slug.replace(/[\/\\]/g, "-");
  slug = slug.toLowerCase();
  slug = slug.replace(/[^a-z0-9\-_.]/g, "-");
  slug = slug.replace(/-+/g, "-");
  slug = slug.replace(/^[-_.]+|[-_.]+$/g, "");
  return slug || "root";
};

/**
 * Slugify a path string like `/users/{id}` into `users-by-id`.
 * `/` alone becomes `root`.
 */
export const slugifyPath = (path: string): string => {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return "root";
  return slugify(trimmed);
};

/**
 * Derive a friendly component-style name from a file path
 * (e.g. `./schemas/user-schema.json` -> `user-schema`).
 */
const baseNameOf = (filePath: string): string => {
  const stem = basename(filePath, extname(filePath));
  return slugify(stem);
};

// ---------------------------------------------------------------------------
// Spec helpers
// ---------------------------------------------------------------------------

const cloneJson = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

/**
 * Parse a JSON or YAML file from disk into a JS object.
 */
const parseSidecarFile = (filePath: string): unknown => {
  const content = readFileSync(filePath, "utf-8");
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(content);
  }
  return yaml.load(content);
};

// ---------------------------------------------------------------------------
// Tag bucketing
// ---------------------------------------------------------------------------

/**
 * Walk `spec.paths` and produce one bucket per tag (plus optional
 * `untagged` bucket). Operations are duplicated into every bucket their
 * `tags` list references. Shared path-item fields (parameters, summary,
 * description, servers) are propagated to every bucket that ends up with
 * at least one operation on that path.
 *
 * Path items expressed as a top-level `$ref` (e.g.
 * `{"/products": {"$ref": "./paths/products.json"}}`) are resolved by
 * loading the referenced file. Each bucketed path item records the absolute
 * source file it was read from so that refs inside it can later be resolved
 * relative to the correct directory.
 *
 * @param spec       The parsed root specification.
 * @param basePath   Absolute path (or URL) of the file that `spec` came from.
 *                   Used to resolve relative PathItem `$ref` entries.
 * @param options    Bucketing options.
 */
export const collectTagBuckets = (
  spec: OpenAPISpec,
  basePath: string,
  options: { includeUntagged?: boolean } = {}
): Map<string, TagBucket> => {
  const includeUntagged = options.includeUntagged ?? true;
  const buckets = new Map<string, TagBucket>();

  const paths = (spec as { paths?: Record<string, unknown> }).paths;
  if (!paths || typeof paths !== "object") {
    return buckets;
  }

  const ensureBucket = (originalTag: string): TagBucket => {
    const name = originalTag === UNTAGGED ? UNTAGGED : slugify(originalTag);
    const existing = buckets.get(name);
    if (existing) return existing;
    const bucket: TagBucket = { name, originalTag, pathItems: {} };
    buckets.set(name, bucket);
    return bucket;
  };

  const ensurePathItem = (
    bucket: TagBucket,
    pathKey: string,
    sharedFields: Record<string, unknown>,
    sourceFile: string
  ): Record<string, unknown> => {
    const existing = bucket.pathItems[pathKey];
    if (existing) return existing.content;
    const entry: BucketedPathItem = {
      content: cloneJson(sharedFields),
      sourceFile,
    };
    bucket.pathItems[pathKey] = entry;
    return entry.content;
  };

  for (const [pathKey, rawPathItem] of Object.entries(paths)) {
    if (!rawPathItem || typeof rawPathItem !== "object") continue;

    // Resolve a top-level PathItem $ref so its operations can be bucketed.
    const resolved = resolvePathItemRef(
      rawPathItem as Record<string, unknown>,
      basePath
    );
    if (!resolved) {
      log.warn(
        `Skipping path '${pathKey}': could not resolve path-item reference`
      );
      continue;
    }
    const { pathItem, sourceFile } = resolved;

    // Pull shared (non-method) fields out so each bucket gets its own copy.
    const sharedFields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pathItem)) {
      if (key === "$ref") continue; // already consumed by resolution
      if (!HTTP_METHODS.has(key.toLowerCase())) {
        sharedFields[key] = value;
      }
    }

    for (const [method, rawOp] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (!rawOp || typeof rawOp !== "object") continue;
      const op = rawOp as { tags?: unknown };

      const tags = Array.isArray(op.tags)
        ? (op.tags as unknown[]).filter(
            (t): t is string => typeof t === "string" && t.length > 0
          )
        : [];

      if (tags.length === 0) {
        if (!includeUntagged) continue;
        const bucket = ensureBucket(UNTAGGED);
        const target = ensurePathItem(bucket, pathKey, sharedFields, sourceFile);
        target[method] = cloneJson(rawOp);
        continue;
      }

      for (const tag of tags) {
        const bucket = ensureBucket(tag);
        const target = ensurePathItem(bucket, pathKey, sharedFields, sourceFile);
        target[method] = cloneJson(rawOp);
      }
    }
  }

  return buckets;
};

/**
 * Resolve a top-level PathItem `$ref`. If the entry has no `$ref`, the input
 * is returned as-is with `sourceFile = basePath`. Internal pointers (`#/...`)
 * and remote http(s):// refs are NOT followed here; only local file refs are
 * inlined. Returns null if a ref is present but cannot be loaded.
 */
const resolvePathItemRef = (
  pathItem: Record<string, unknown>,
  basePath: string
): { pathItem: Record<string, unknown>; sourceFile: string } | null => {
  const ref = pathItem.$ref;
  if (typeof ref !== "string") {
    return { pathItem, sourceFile: basePath };
  }

  if (ref.startsWith("#/")) {
    // Internal pointer to another part of the spec. Following these for
    // bucketing is rare and risks duplication; skip and warn.
    log.warn(
      `Path-item references via internal pointer '${ref}' are not bucketed; skipping`
    );
    return null;
  }
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    log.warn(
      `Path-item references via URL '${ref}' are not bucketed; skipping`
    );
    return null;
  }

  if (isRemoteSource(basePath)) {
    log.warn(
      `Cannot resolve relative path-item ref '${ref}' from remote source '${basePath}'`
    );
    return null;
  }

  const [pathPart, fragment] = ref.split("#");
  const absPath = resolve(dirname(basePath), pathPart || "");
  let loaded: unknown;
  try {
    loaded = parseSidecarFile(absPath);
  } catch (err) {
    log.warn(
      `Failed to load path-item ref '${ref}' from ${basePath}: ${
        err instanceof Error ? err.message : "Unknown error"
      }`
    );
    return null;
  }

  // Honor JSON-pointer fragment, e.g. "./paths.json#/Pet"
  if (fragment) {
    const target = resolveJsonPointer(loaded, fragment);
    if (!target || typeof target !== "object") {
      log.warn(
        `Path-item ref '${ref}' fragment did not resolve to an object`
      );
      return null;
    }
    return { pathItem: target as Record<string, unknown>, sourceFile: absPath };
  }

  if (!loaded || typeof loaded !== "object") {
    log.warn(`Path-item ref '${ref}' did not resolve to an object`);
    return null;
  }
  return {
    pathItem: loaded as Record<string, unknown>,
    sourceFile: absPath,
  };
};

/** Quick check for a URL-shaped source string. */
const isRemoteSource = (s: string): boolean =>
  s.startsWith("http://") || s.startsWith("https://");

/** Resolve a JSON pointer fragment (without leading `#`) inside a value. */
const resolveJsonPointer = (root: unknown, fragment: string): unknown => {
  const path = fragment.replace(/^\//, "").split("/").map(decodePointerSegment);
  let current: unknown = root;
  for (const seg of path) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return current;
};

// ---------------------------------------------------------------------------
// Reference rewriting
// ---------------------------------------------------------------------------

/**
 * Recursively walk a value and replace `$ref` strings using the supplied
 * mapper. Returns a NEW value; the input is not mutated.
 */
const mapRefs = (
  value: unknown,
  mapper: (ref: string) => string | null
): unknown => {
  if (Array.isArray(value)) {
    return value.map((v) => mapRefs(v, mapper));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "$ref" && typeof v === "string") {
        const mapped = mapper(v);
        out[k] = mapped ?? v;
      } else {
        out[k] = mapRefs(v, mapper);
      }
    }
    return out;
  }
  return value;
};

// ---------------------------------------------------------------------------
// Component / file collection
// ---------------------------------------------------------------------------

/**
 * Internal id used to key collected sidecar files: e.g.
 *   `schemas/User`, `parameters/page-param`, `responses/error-response`.
 */
type SidecarId = string;

interface SidecarEntry {
  id: SidecarId;
  folder: string; // e.g. "schemas"
  name: string; // e.g. "User"
  content: unknown; // already-rewritten content
}

/**
 * Build a working context that collects sidecar files (schemas, parameters,
 * responses, etc.) and rewrites every `$ref` in the visited values to point
 * at the per-tag folder layout.
 */
const buildCollector = (
  baseDoc: OpenAPISpec,
  baseFilePath: string,
  options: { maxRefDepth: number; format: SerializationFormat }
) => {
  const ext = extensionFor(options.format);

  // Map of "<absolute path>" -> SidecarId, used for de-duping file refs.
  const fileToId = new Map<string, SidecarId>();
  // Map of "<componentType>/<name>" internal pointer -> SidecarId.
  const internalToId = new Map<string, SidecarId>();
  // Map of name-within-folder -> count (for collision suffixing).
  const namesByFolder = new Map<string, Map<string, number>>();

  const sidecars = new Map<SidecarId, SidecarEntry>();

  const allocateName = (folder: string, desiredName: string): string => {
    let counts = namesByFolder.get(folder);
    if (!counts) {
      counts = new Map();
      namesByFolder.set(folder, counts);
    }
    const base = desiredName || "item";
    const existing = counts.get(base);
    if (existing === undefined) {
      counts.set(base, 1);
      return base;
    }
    let n = existing + 1;
    let candidate = `${base}-${n}`;
    while (counts.has(candidate)) {
      n += 1;
      candidate = `${base}-${n}`;
    }
    counts.set(base, n);
    counts.set(candidate, 1);
    return candidate;
  };

  /**
   * Look up a value inside `baseDoc` using a JSON-pointer-like ref
   * (`#/components/schemas/User`). Returns null if not found.
   */
  const resolveInternal = (
    ref: string
  ): {
    value: unknown;
    componentType: string | null;
    componentName: string | null;
  } | null => {
    if (!ref.startsWith("#/")) return null;
    const parts = ref.substring(2).split("/").map(decodePointerSegment);
    let current: unknown = baseDoc;
    for (const part of parts) {
      if (current && typeof current === "object" && current !== null) {
        const obj = current as Record<string, unknown>;
        if (part in obj) {
          current = obj[part];
          continue;
        }
      }
      return null;
    }
    // Recognize the pattern #/components/<type>/<name>
    let componentType: string | null = null;
    let componentName: string | null = null;
    if (parts[0] === "components" && parts.length >= 3) {
      componentType = parts[1] ?? null;
      componentName = parts[2] ?? null;
    }
    return { value: current, componentType, componentName };
  };

  /**
   * Resolve a file reference (`./schemas/foo.json#/...`) relative to the
   * given owning file. Returns the absolute path and any fragment.
   */
  const resolveFile = (
    ref: string,
    fromFile: string
  ): { absPath: string; fragment: string | null } => {
    const [pathPart, fragmentPart] = ref.split("#");
    const baseDir = dirname(fromFile);
    const absPath = resolve(baseDir, pathPart || "");
    return {
      absPath,
      fragment: fragmentPart ? `#${fragmentPart}` : null,
    };
  };

  /**
   * Given an internal component pointer like `#/components/schemas/User`,
   * choose a target folder + name and register the sidecar (if new).
   *
   * Invariant: the entry is registered in both `sidecars` and `internalToId`
   * BEFORE recursing into `walkAndRewrite`. This is what breaks reference
   * cycles (User -> Address -> User): the second visit hits the cache.
   * The entry's `content` starts as `null` and is filled in once the
   * recursive rewrite completes.
   */
  const ingestInternal = (
    ref: string,
    depth: number
  ): SidecarEntry | null => {
    if (depth > options.maxRefDepth) {
      log.warn(`Max ref depth exceeded for ${ref}`);
      return null;
    }
    const existingId = internalToId.get(ref);
    if (existingId !== undefined) {
      return sidecars.get(existingId) ?? null;
    }

    const resolved = resolveInternal(ref);
    if (!resolved) {
      log.warn(`Unable to resolve internal reference: ${ref}`);
      return null;
    }
    const { value, componentType, componentName } = resolved;

    // Non-component internal refs (e.g. `#/paths/~1users`) are left alone.
    if (!componentType || !componentName) {
      log.warn(
        `Internal ref '${ref}' does not target a known components/* bucket; leaving it in place (this may leave a dangling pointer because no components block is emitted)`
      );
      return null;
    }

    const folder = COMPONENT_FOLDER_BY_KEY[componentType];
    if (!folder) {
      log.warn(
        `Internal ref '${ref}' targets unknown component type '${componentType}'; leaving it in place (this may leave a dangling pointer because no components block is emitted)`
      );
      return null;
    }

    const allocatedName = allocateName(folder, slugify(componentName));
    const id = `${folder}/${allocatedName}`;
    const entry: SidecarEntry = {
      id,
      folder,
      name: allocatedName,
      content: null,
    };
    sidecars.set(id, entry);
    internalToId.set(ref, id);

    // Rewrite refs inside the resolved value with this file as the "owner".
    // Internal refs become file refs relative to this file's folder.
    entry.content = walkAndRewrite(value, baseFilePath, folder, depth + 1);
    return entry;
  };

  /**
   * Ingest a file ref. The file content is loaded, its refs are rewritten,
   * and a sidecar entry is registered.
   */
  const ingestFile = (
    ref: string,
    fromFile: string,
    depth: number,
    desiredFolderHint?: string
  ): { entry: SidecarEntry; fragment: string | null } | null => {
    if (depth > options.maxRefDepth) {
      log.warn(`Max ref depth exceeded for ${ref}`);
      return null;
    }

    const { absPath, fragment } = resolveFile(ref, fromFile);
    const existingFileId = fileToId.get(absPath);
    if (existingFileId !== undefined) {
      const existingEntry = sidecars.get(existingFileId);
      if (existingEntry) {
        return { entry: existingEntry, fragment };
      }
    }

    let content: unknown;
    try {
      content = parseSidecarFile(absPath);
    } catch (err) {
      log.warn(
        `Failed to load external reference '${ref}' from ${fromFile}: ${
          err instanceof Error ? err.message : "Unknown error"
        }`
      );
      return null;
    }

    const folder = desiredFolderHint ?? guessFolderFromPath(absPath);
    const allocatedName = allocateName(folder, baseNameOf(absPath));
    const id = `${folder}/${allocatedName}`;
    const entry: SidecarEntry = {
      id,
      folder,
      name: allocatedName,
      content: null,
    };
    sidecars.set(id, entry);
    fileToId.set(absPath, id);

    // Recurse: rewrite refs inside this loaded file, using *this file* as
    // the owner so its own relative refs resolve correctly.
    entry.content = walkAndRewrite(content, absPath, folder, depth + 1);
    return { entry, fragment };
  };

  /**
   * Rewrite every $ref in `value`. The owning file path is needed so file
   * refs can be resolved relative to the file they came from; the owning
   * folder (e.g. `schemas` or `paths`) is needed so the new $ref path is
   * relative to where this file will live in the per-tag folder.
   */
  const walkAndRewrite = (
    value: unknown,
    ownerFilePath: string,
    ownerFolder: string | null,
    depth: number
  ): unknown => {
    return mapRefs(value, (ref) => {
      if (ref.startsWith("#/")) {
        const entry = ingestInternal(ref, depth);
        if (!entry) {
          // ingestInternal already logged the reason; keep the original
          // ref in the output so the user can grep for it.
          return ref;
        }
        return makeRelativeRef(ownerFolder, entry, ext);
      }
      if (ref.startsWith("http://") || ref.startsWith("https://")) {
        // Leave remote refs untouched; we do not attempt to inline them.
        return ref;
      }
      // Local file ref. URL-based sources can't host relative files;
      // bail out with a clear warning and keep the original.
      if (isRemoteSource(ownerFilePath)) {
        log.warn(
          `Cannot resolve relative file ref '${ref}' from remote source '${ownerFilePath}'`
        );
        return ref;
      }
      const ingested = ingestFile(ref, ownerFilePath, depth);
      if (!ingested) return ref;
      const base = makeRelativeRef(ownerFolder, ingested.entry, ext);
      return ingested.fragment ? `${base}${ingested.fragment}` : base;
    });
  };

  return {
    sidecars,
    walkAndRewrite,
  };
};

/**
 * Decode a JSON-pointer segment (`~1` -> `/`, `~0` -> `~`).
 */
const decodePointerSegment = (seg: string): string =>
  seg.replace(/~1/g, "/").replace(/~0/g, "~");

/**
 * Compute the relative $ref string from an owner-folder location to the
 * given sidecar entry.
 *
 *  - ownerFolder = null    -> from root spec: `./<folder>/<name>.<ext>`
 *  - ownerFolder = same    -> `./<name>.<ext>`
 *  - ownerFolder = other   -> `../<folder>/<name>.<ext>`
 */
const makeRelativeRef = (
  ownerFolder: string | null,
  entry: SidecarEntry,
  ext: string
): string => {
  const fileName = `${entry.name}.${ext}`;
  if (!ownerFolder) return `./${entry.folder}/${fileName}`;
  if (ownerFolder === entry.folder) return `./${fileName}`;
  return `../${entry.folder}/${fileName}`;
};

/**
 * Guess which folder a file ref belongs to by inspecting its source path.
 * Falls back to "schemas" when nothing matches; the heuristic is only used
 * for external file refs (internal refs always know their component type).
 */
const guessFolderFromPath = (absPath: string): string => {
  const lower = absPath.toLowerCase();
  if (lower.includes("/schemas/")) return "schemas";
  if (lower.includes("/parameters/")) return "parameters";
  if (lower.includes("/responses/")) return "responses";
  if (lower.includes("/request-bodies/")) return "request-bodies";
  if (lower.includes("/requestbodies/")) return "request-bodies";
  if (lower.includes("/headers/")) return "headers";
  if (lower.includes("/examples/")) return "examples";
  if (lower.includes("/links/")) return "links";
  if (lower.includes("/callbacks/")) return "callbacks";
  if (lower.includes("/security-schemes/")) return "security-schemes";
  if (lower.includes("/securityschemes/")) return "security-schemes";
  if (lower.includes("/paths/")) return "paths";
  if (lower.includes("/path-items/")) return "path-items";
  if (lower.includes("/pathitems/")) return "path-items";
  return "schemas";
};

// ---------------------------------------------------------------------------
// Per-tag plan construction
// ---------------------------------------------------------------------------

const buildRootSpec = (
  baseSpec: OpenAPISpec,
  tag: string,
  pathItemRefs: Array<{ pathKey: string; relRef: string }>
): Record<string, unknown> => {
  const anySpec = baseSpec as Record<string, unknown>;
  const root: Record<string, unknown> = {};

  if (anySpec.openapi) root.openapi = anySpec.openapi;
  if (anySpec.swagger) root.swagger = anySpec.swagger;

  const info = cloneJson(anySpec.info ?? {}) as Record<string, unknown>;
  const originalTitle =
    typeof info.title === "string" ? info.title : "OpenAPI";
  info.title = `${originalTitle} - ${tag}`;
  root.info = info;

  if (anySpec.servers) root.servers = cloneJson(anySpec.servers);

  // Tags array filtered to the one we're emitting (if it exists in source).
  if (Array.isArray(anySpec.tags)) {
    const matching = (anySpec.tags as Array<Record<string, unknown>>).filter(
      (t) => typeof t === "object" && t && t.name === tag
    );
    if (matching.length > 0) root.tags = cloneJson(matching);
  }

  const pathsBlock: Record<string, unknown> = {};
  for (const { pathKey, relRef } of pathItemRefs) {
    pathsBlock[pathKey] = { $ref: relRef };
  }
  root.paths = pathsBlock;

  if (anySpec.externalDocs) root.externalDocs = cloneJson(anySpec.externalDocs);
  if (anySpec.security) root.security = cloneJson(anySpec.security);

  return root;
};

/**
 * Partition a parsed OpenAPI specification into a per-tag PartitionPlan.
 * Does NOT touch the filesystem.
 *
 * Remote (http/https) sources are supported only for fully self-contained
 * specs. Relative file `$ref`s cannot be resolved through a URL — those refs
 * will be left as-is in the output and a warning is logged for each.
 */
export const partitionByTags = (
  parsed: ParsedSpec,
  options: PartitionOptions = {}
): PartitionPlan => {
  const format: SerializationFormat = options.format ?? "json";
  const includeUntagged = options.includeUntagged ?? true;
  const maxRefDepth = options.maxRefDepth ?? 25;
  const ext = extensionFor(format);

  if (isRemoteSource(parsed.source)) {
    log.warn(
      `Partitioning a remote source ('${parsed.source}'): relative file $refs cannot be resolved and will be left in place. Only fully-inline specifications are fully supported for URL sources.`
    );
  }

  const buckets = collectTagBuckets(parsed.spec, parsed.source, {
    includeUntagged,
  });

  const plan: PartitionPlan = { format, tags: [] };

  for (const bucket of buckets.values()) {
    const collector = buildCollector(parsed.spec, parsed.source, {
      maxRefDepth,
      format,
    });

    const pathItemRefs: Array<{ pathKey: string; relRef: string }> = [];
    const pathFiles: PartitionFile[] = [];
    const usedPathSlugs = new Map<string, number>();

    for (const [pathKey, pathItem] of Object.entries(bucket.pathItems)) {
      // Rewrite refs inside the path item. The owner file is whichever file
      // the path item was originally loaded from (root spec, or an external
      // path-item file when the original entry was a $ref). Owner folder is
      // "paths" so internal refs become ../schemas/... etc.
      const rewritten = collector.walkAndRewrite(
        pathItem.content,
        pathItem.sourceFile,
        "paths",
        0
      );

      let slug = slugifyPath(pathKey);
      const prior = usedPathSlugs.get(slug);
      if (prior !== undefined) {
        const next = prior + 1;
        usedPathSlugs.set(slug, next);
        slug = `${slug}-${next}`;
      } else {
        usedPathSlugs.set(slug, 1);
      }

      const relPath = `paths/${slug}.${ext}`;
      pathFiles.push({ relativePath: relPath, content: rewritten });
      pathItemRefs.push({ pathKey, relRef: `./${relPath}` });
    }

    const rootSpec = buildRootSpec(parsed.spec, bucket.originalTag, pathItemRefs);

    const sidecarFiles: PartitionFile[] = [];
    for (const entry of collector.sidecars.values()) {
      sidecarFiles.push({
        relativePath: `${entry.folder}/${entry.name}.${ext}`,
        content: entry.content,
      });
    }

    plan.tags.push({
      name: bucket.name,
      originalTag: bucket.originalTag,
      files: [
        { relativePath: `openapi.${ext}`, content: rootSpec },
        ...pathFiles,
        ...sidecarFiles,
      ],
    });
  }

  return plan;
};

// ---------------------------------------------------------------------------
// Convenience: parse + partition
// ---------------------------------------------------------------------------

/**
 * Parse a spec from disk/URL and partition it by tags in one call.
 */
export const partitionSpecByTags = async (
  source: string,
  options: PartitionOptions = {}
): Promise<PartitionPlan> => {
  const parsed = await parseOpenAPISpec(source);
  return partitionByTags(parsed, options);
};

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export interface WriteResult {
  outputDir: string;
  filesWritten: number;
  tagsWritten: number;
}

export interface WriteOptions {
  /**
   * When true, remove `outputDir` entirely before writing so stale files
   * from a previous run don't linger. Default is false (overwrite-in-place,
   * leaving orphaned files alone).
   */
  clean?: boolean;
}

/**
 * Flush a PartitionPlan to disk under `outputDir`. Each tag becomes a folder
 * named after `tag.name`; files within use the relative paths from the plan.
 */
export const writePartitionPlan = (
  plan: PartitionPlan,
  outputDir: string,
  options: WriteOptions = {}
): WriteResult => {
  const absRoot = resolve(outputDir);
  if (options.clean) {
    rmSync(absRoot, { recursive: true, force: true });
  }
  mkdirSync(absRoot, { recursive: true });

  let filesWritten = 0;
  for (const tag of plan.tags) {
    const tagRoot = resolve(absRoot, tag.name);
    mkdirSync(tagRoot, { recursive: true });
    for (const file of tag.files) {
      const absFile = resolve(tagRoot, file.relativePath);
      mkdirSync(dirname(absFile), { recursive: true });
      writeFileSync(absFile, serialize(file.content, plan.format), "utf-8");
      filesWritten += 1;
    }
  }

  return {
    outputDir: absRoot,
    filesWritten,
    tagsWritten: plan.tags.length,
  };
};

/**
 * Produce a human-readable preview of the planned file tree, useful for
 * --dry-run output.
 */
export const describePartitionPlan = (plan: PartitionPlan, outputDir: string): string => {
  const lines: string[] = [];
  const absRoot = resolve(outputDir);
  lines.push(`${absRoot} (format: ${plan.format})`);
  for (const tag of plan.tags) {
    lines.push(`  ${tag.name}/  [tag: ${tag.originalTag}]`);
    const sorted = [...tag.files].sort((a, b) =>
      a.relativePath.localeCompare(b.relativePath)
    );
    for (const file of sorted) {
      lines.push(`    ${file.relativePath}`);
    }
  }
  return lines.join("\n");
};
