import type {ParseInput, ParseResult} from './shared.ts'
import { extractTaggedNotes } from "./shared.ts";

export function parseStyles({ filePath, content, language = "" }: ParseInput): ParseResult {
  const selectors = [];
  for (const match of content.matchAll(/(^|})\s*([^@}{][^{]+)\{/gm)) {
    const group = match[2].trim();
    for (const selector of group.split(",")) {
      const normalized = selector.trim();
      if (normalized) {
        selectors.push(normalized);
      }
    }
  }

  const notes = extractTaggedNotes(content, {
    commentPattern: /\/\*([\s\S]*?)\*\//g,
    filePath
  });

  return {
    language,
    fileKind: "style",
    symbols: selectors.map((selector) => ({ name: selector, kind: "selector", exported: false })),
    facts: selectors.map((selector) => ({ predicate: "defines-selector", objectText: selector, confidence: 1 })),
    notes,
    metadata: {
      selectorCount: selectors.length
    },
    searchText: [content, ...selectors].join("\n")
  };
}
