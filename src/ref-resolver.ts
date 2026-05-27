import { dirname, resolve } from "node:path";
import { isUrlSource, loadDocument } from "./document.js";
import type { OpenAPIVersion } from "./types.js";

export interface ResolvedReference {
  path: string;
  content: any;
  version?: OpenAPIVersion;
  isCircular: boolean;
  depth: number;
  source?: string;
}

export interface ReferenceContext {
  basePath: string;
  visited: Set<string>;
  maxDepth: number;
  currentDepth: number;
  baseDocument: any;
}

export interface UnresolvedReference {
  path: string;
  value: string;
  message: string;
  depth: number;
}

const detectDocumentVersion = (doc: any): OpenAPIVersion | null => {
  if (doc?.openapi) {
    const version = String(doc.openapi);
    if (version.startsWith("3.0")) return "3.0";
    if (version.startsWith("3.1")) return "3.1";
    if (version.startsWith("3.2")) return "3.2";
  }
  if (doc?.swagger === "2.0") return "2.0";
  return null;
};

const decodePointerSegment = (segment: string): string =>
  segment.replace(/~1/g, "/").replace(/~0/g, "~");

export const resolveJsonPointer = (root: unknown, pointer: string): unknown => {
  const normalized = pointer.replace(/^#/, "");
  if (!normalized) return root;

  const parts = normalized.replace(/^\//, "").split("/").map(decodePointerSegment);
  let current: unknown = root;
  for (const part of parts) {
    if (current && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
};

const splitRef = (ref: string): { sourcePart: string; pointer: string } => {
  const hashIndex = ref.indexOf("#");
  if (hashIndex === -1) return { sourcePart: ref, pointer: "" };
  return {
    sourcePart: ref.slice(0, hashIndex),
    pointer: ref.slice(hashIndex + 1),
  };
};

const resolveExternalSource = (sourcePart: string, basePath: string): string => {
  if (isUrlSource(sourcePart)) return sourcePart;
  if (isUrlSource(basePath)) return new URL(sourcePart, basePath).toString();
  return resolve(dirname(basePath), sourcePart);
};

const absoluteRefKey = (ref: string, basePath: string): string => {
  const { sourcePart, pointer } = splitRef(ref);
  const source =
    sourcePart.length === 0 ? basePath : resolveExternalSource(sourcePart, basePath);
  return `${source}#${pointer}`;
};

const loadExternalDocument = async (source: string): Promise<unknown> => {
  const loaded = await loadDocument(isUrlSource(source) ? { kind: "url", url: source } : source);
  return loaded.document;
};

const detectVersion = (
  doc: unknown,
  fallback?: OpenAPIVersion,
): OpenAPIVersion | undefined => {
  if (doc && typeof doc === "object") {
    return detectDocumentVersion(doc) ?? fallback;
  }
  return fallback;
};

export const resolveReference = async (
  ref: string,
  context: ReferenceContext,
): Promise<ResolvedReference> => {
  const { basePath, visited, maxDepth, currentDepth } = context;
  const refKey = absoluteRefKey(ref, basePath);

  if (visited.has(refKey)) {
    return {
      path: ref,
      content: null,
      isCircular: true,
      depth: currentDepth,
      source: refKey,
    };
  }

  if (currentDepth >= maxDepth) {
    throw new Error(`Maximum reference depth (${maxDepth}) exceeded`);
  }

  visited.add(refKey);

  try {
    const { sourcePart, pointer } = splitRef(ref);
    let source = basePath;
    let rootDocument = context.baseDocument;

    if (sourcePart.length > 0) {
      source = resolveExternalSource(sourcePart, basePath);
      rootDocument = await loadExternalDocument(source);
    }

    const content = pointer ? resolveJsonPointer(rootDocument, pointer) : rootDocument;
    if (content === undefined) {
      throw new Error(`Reference not found: ${ref}`);
    }

    return {
      path: ref,
      content,
      version: detectVersion(content, detectVersion(rootDocument)),
      isCircular: false,
      depth: currentDepth,
      source,
    };
  } catch (error) {
    throw new Error(
      `Failed to resolve reference '${ref}': ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  } finally {
    visited.delete(refKey);
  }
};

export const findReferences = (
  obj: any,
  path = "",
): Array<{ path: string; value: string }> => {
  const refs: Array<{ path: string; value: string }> = [];

  if (typeof obj === "object" && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;

      if (key === "$ref" && typeof value === "string") {
        refs.push({ path: currentPath, value });
      } else if (typeof value === "object") {
        refs.push(...findReferences(value, currentPath));
      }
    }
  }

  return refs;
};

export const resolveAllReferences = async (
  document: any,
  basePath: string,
  maxDepth = 10,
): Promise<{
  document: any;
  resolvedRefs: ResolvedReference[];
  circularRefs: string[];
  unresolvedRefs: UnresolvedReference[];
}> => {
  const active = new Set<string>();
  const seen = new Set<string>();
  const resolvedRefs: ResolvedReference[] = [];
  const circularRefs: string[] = [];
  const unresolvedRefs: UnresolvedReference[] = [];

  const walk = async (
    currentDocument: any,
    currentBasePath: string,
    currentRootDocument: any,
    depth: number,
  ): Promise<void> => {
    if (depth >= maxDepth) {
      unresolvedRefs.push({
        path: currentBasePath,
        value: currentBasePath,
        message: `Maximum reference depth (${maxDepth}) exceeded`,
        depth,
      });
      return;
    }

    const refs = findReferences(currentDocument);
    for (const ref of refs) {
      const key = absoluteRefKey(ref.value, currentBasePath);
      if (active.has(key)) {
        circularRefs.push(ref.value);
        resolvedRefs.push({
          path: ref.value,
          content: null,
          isCircular: true,
          depth,
          source: key,
        });
        continue;
      }

      if (seen.has(key)) continue;
      seen.add(key);
      active.add(key);

      try {
        const { sourcePart, pointer } = splitRef(ref.value);
        let resolvedSource = currentBasePath;
        let rootDocument = currentRootDocument;

        if (sourcePart.length > 0) {
          resolvedSource = resolveExternalSource(sourcePart, currentBasePath);
          rootDocument = await loadExternalDocument(resolvedSource);
        }

        const targetDocument = pointer
          ? resolveJsonPointer(rootDocument, pointer)
          : rootDocument;
        if (targetDocument === undefined) {
          throw new Error(`Reference not found: ${ref.value}`);
        }

        resolvedRefs.push({
          path: ref.value,
          content: targetDocument,
          version: detectVersion(targetDocument, detectVersion(rootDocument)),
          isCircular: false,
          depth,
          source: resolvedSource,
        });

        if (targetDocument && typeof targetDocument === "object") {
          await walk(targetDocument, resolvedSource, rootDocument, depth + 1);
        }
      } catch (error) {
        unresolvedRefs.push({
          path: ref.path,
          value: ref.value,
          message: error instanceof Error ? error.message : "Unknown error",
          depth,
        });
      } finally {
        active.delete(key);
      }
    }
  };

  await walk(document, basePath, document, 0);

  return {
    document,
    resolvedRefs,
    circularRefs: [...new Set(circularRefs)],
    unresolvedRefs,
  };
};
