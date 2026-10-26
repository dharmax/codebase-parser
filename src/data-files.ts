import type {ParseInput, ParseResult} from './shared.ts'
import { extractTaggedNotes } from "./shared.ts";
import { findNotesFuzzily } from "./shared.ts";
import { isStandaloneNoteLine } from "./shared.ts";

export function parseJsonFile({ filePath, content }: ParseInput): ParseResult {
  let value = null;
  let error = null;

  try {
    value = JSON.parse(content);
  } catch (caughtError) {
    error = caughtError instanceof Error ? caughtError.message : String(caughtError);
  }

  const topLevelKeys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  return {
    language: "json",
    fileKind: "data",
    symbols: topLevelKeys.map((key) => ({ name: key, kind: "json-key", exported: false })),
    facts: topLevelKeys.map((key) => ({ predicate: "has-key", objectText: key, confidence: 1 })),
    notes: [],
    metadata: {
      parseError: error,
      topLevelKeyCount: topLevelKeys.length
    },
    searchText: [content, ...topLevelKeys].join("\n")
  };
}

export function parseYamlFile({ filePath, content, language = "" }: ParseInput): ParseResult {
  const keys = [];
  for (const match of content.matchAll(/^([A-Za-z0-9_.-]+):/gm)) {
    keys.push(match[1]);
  }
  const notes = extractTaggedNotes(content, {
    commentPattern: /#([^\n]+)/g,
    filePath
  });
  return {
    language,
    fileKind: "data",
    symbols: keys.map((key) => ({ name: key, kind: "yaml-key", exported: false })),
    facts: keys.map((key) => ({ predicate: "has-key", objectText: key, confidence: 0.9 })),
    notes,
    metadata: {
      topLevelKeyCount: keys.length
    },
    searchText: [content, ...keys].join("\n")
  };
}

export function parseMarkdownFile({ filePath, content }: ParseInput): ParseResult {
  const headings = [];
  for (const match of content.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
    headings.push(match[2].trim());
  }

  const explicitLineNotes = extractExplicitMarkdownNotes(content, filePath);

  // Classic tagged notes (comments)
  const taggedNotes = extractTaggedNotes(content, {
    commentPattern: /<!--([\s\S]*?)-->/gm,
    filePath
  });

  const notes = [...explicitLineNotes, ...taggedNotes].filter((note, index, self) => 
    index === self.findIndex((t) => t.line === note.line && t.body === note.body)
  );

  return {
    language: "markdown",
    fileKind: "doc",
    symbols: headings.map((heading) => ({ name: heading, kind: "heading", exported: false })),
    facts: headings.map((heading) => ({ predicate: "has-heading", objectText: heading, confidence: 1 })),
    notes,
    metadata: {
      headingCount: headings.length
    },
    searchText: [content, ...headings].join("\n")
  };
}

function extractExplicitMarkdownNotes(content: string, filePath: string) {
  return findNotesFuzzily(content)
    .filter((note) => isExplicitMarkdownNote(note.rawLine))
    .map((note) => ({
      noteType: note.type,
      body: note.body,
      filePath,
      line: note.line,
      column: 1
    }));
}

function isExplicitMarkdownNote(line: string) {
  return isStandaloneNoteLine(line);
}
