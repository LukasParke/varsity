import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as yaml from "js-yaml";
import type { DocumentInput } from "./types.js";

export interface LoadedDocument {
  content: string | null;
  document: unknown;
  source: string;
  kind: "path" | "url" | "content" | "object" | "stdin";
  resolvedPath?: string;
}

export interface LoadDocumentOptions {
  cwd?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
  stdin?: () => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export const isUrlSource = (source: string): boolean =>
  source.startsWith("http://") || source.startsWith("https://");

export const parseDocumentContent = (content: string, source = "<content>"): unknown => {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`Document is empty: ${source}`);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(content);
  }

  const parsed = yaml.load(content);
  if (parsed === undefined || parsed === null) {
    throw new Error(`Document is empty: ${source}`);
  }
  return parsed;
};

export const cloneDocument = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

export const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const fetchWithTimeout = async (
  url: string,
  options: LoadDocumentOptions,
): Promise<string> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: options.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText || ""}`.trim(),
      );
    }
    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs}ms fetching ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const loadDocument = async (
  input: DocumentInput,
  options: LoadDocumentOptions = {},
): Promise<LoadedDocument> => {
  if (typeof input === "string") {
    if (input === "-") {
      const content = options.stdin ? await options.stdin() : await readStdin();
      return {
        content,
        document: parseDocumentContent(content, "<stdin>"),
        source: "<stdin>",
        kind: "stdin",
      };
    }

    if (isUrlSource(input)) {
      const content = await fetchWithTimeout(input, options);
      return {
        content,
        document: parseDocumentContent(content, input),
        source: input,
        kind: "url",
      };
    }

    const cwd = options.cwd ?? process.cwd();
    const resolvedPath = resolve(cwd, input);
    try {
      const content = readFileSync(resolvedPath, "utf-8");
      return {
        content,
        document: parseDocumentContent(content, resolvedPath),
        source: input,
        kind: "path",
        resolvedPath,
      };
    } catch (error) {
      throw new Error(
        `Failed to read ${input} (resolved to ${resolvedPath}, cwd ${cwd}): ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  if ("kind" in input) {
    switch (input.kind) {
      case "path":
        return loadDocument(input.path, { ...options, cwd: input.cwd ?? options.cwd });
      case "url": {
        const content = await fetchWithTimeout(input.url, {
          ...options,
          headers: input.headers ?? options.headers,
          timeoutMs: input.timeoutMs ?? options.timeoutMs,
        });
        return {
          content,
          document: parseDocumentContent(content, input.url),
          source: input.url,
          kind: "url",
        };
      }
      case "content":
        return {
          content: input.content,
          document: parseDocumentContent(input.content, input.source ?? "<content>"),
          source: input.source ?? "<content>",
          kind: "content",
        };
      case "object":
        return {
          content: null,
          document: cloneDocument(input.value),
          source: input.source ?? "<object>",
          kind: "object",
        };
    }
  }

  return {
    content: null,
    document: cloneDocument(input),
    source: "<object>",
    kind: "object",
  };
};

export const loadDocumentSync = (source: string): LoadedDocument => {
  if (isUrlSource(source) || source === "-") {
    throw new Error(`Synchronous loading only supports local files: ${source}`);
  }

  const resolvedPath = resolve(source);
  const content = readFileSync(resolvedPath, "utf-8");
  return {
    content,
    document: parseDocumentContent(content, resolvedPath),
    source,
    kind: "path",
    resolvedPath,
  };
};
