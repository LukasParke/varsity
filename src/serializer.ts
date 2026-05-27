import * as yaml from "js-yaml";

export type SerializationFormat = "json" | "yaml";

/**
 * Serialize a value to a string in the requested format.
 *
 * JSON output uses 2-space indentation; YAML uses js-yaml defaults
 * with refs left as-is (no aliasing) so $ref strings remain literal.
 */
export const serialize = (
  value: unknown,
  format: SerializationFormat
): string => {
  switch (format) {
    case "json":
      return `${JSON.stringify(value, null, 2)}\n`;
    case "yaml":
      return yaml.dump(value, { noRefs: true, lineWidth: 120 });
    default:
      throw new Error(`Unsupported serialization format: ${format}`);
  }
};

/**
 * File extension (without leading dot) for the given format.
 */
export const extensionFor = (format: SerializationFormat): string => {
  switch (format) {
    case "json":
      return "json";
    case "yaml":
      return "yaml";
    default:
      throw new Error(`Unsupported serialization format: ${format}`);
  }
};

/**
 * Infer a default format from a source path/URL based on its extension.
 * Falls back to JSON when no extension matches.
 */
export const detectFormatFromPath = (
  source: string
): SerializationFormat | null => {
  const lower = source.toLowerCase().split("?")[0]?.split("#")[0] ?? "";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".json")) return "json";
  return null;
};
