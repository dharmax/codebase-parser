import type {ParseInput, ParseResult} from './shared.ts'
import { extractTaggedNotes } from "./shared.ts";
import { countLineColumn } from "./shared.ts";
import { parseJsFamily } from "./js-family.ts";
import { parseStyles } from "./styles.ts";

export function parseHtml({ filePath, content, language = "html" }: ParseInput): ParseResult {
  const ids = new Set<string>();
  const classes = new Set<string>();

  for (const match of content.matchAll(/\sid=["']([^"']+)["']/g)) {
    ids.add(`#${match[1]}`);
  }

  for (const match of content.matchAll(/\sclass=["']([^"']+)["']/g)) {
    for (const className of match[1].split(/\s+/)) {
      if (className) {
        classes.add(`.${className}`);
      }
    }
  }

  const selectors = [...ids, ...classes];
  const notes = extractTaggedNotes(content, {
    commentPattern: /<!--([\s\S]*?)-->/g,
    filePath
  });

  return {
    language,
    fileKind: "markup",
    symbols: selectors.map((selector) => ({ name: selector, kind: "selector", exported: false })),
    facts: selectors.map((selector) => ({ predicate: "uses-selector", objectText: selector, confidence: 0.95 })),
    notes,
    metadata: {
      selectorCount: selectors.length
    },
    searchText: [content, ...selectors].join("\n")
  };
}

export function parseRiot({ filePath, content }: ParseInput): ParseResult {
  const script = collectEmbeddedParseResults({
    filePath,
    source: content,
    tagPattern: /<script[^>]*>([\s\S]*?)<\/script>/ig,
    parseBlock: ({ blockContent }) => parseJsFamily({ filePath, content: blockContent, language: "riot-script" }),
    empty: emptyResult("riot-script")
  });
  const style = collectEmbeddedParseResults({
    filePath,
    source: content,
    tagPattern: /<style[^>]*>([\s\S]*?)<\/style>/ig,
    parseBlock: ({ blockContent }) => parseStyles({ filePath, content: blockContent, language: "riot-style" }),
    empty: emptyResult("riot-style")
  });
  const templateContent = content.replace(/<script[\s\S]*?<\/script>/ig, "").replace(/<style[\s\S]*?<\/style>/ig, "");
  const markup = parseHtml({ filePath, content: templateContent, language: "riot-template" });

  return {
    language: "riot",
    fileKind: "component",
    symbols: [...script.symbols, ...style.symbols, ...markup.symbols],
    facts: [...script.facts, ...style.facts, ...markup.facts],
    notes: [...script.notes, ...style.notes, ...markup.notes],
    metadata: {
      scriptSymbols: script.symbols.length,
      styleSelectors: style.symbols.length,
      templateSelectors: markup.symbols.length
    },
    searchText: [script.searchText, style.searchText, markup.searchText].filter(Boolean).join("\n")
  };
}

function collectEmbeddedParseResults({ source, tagPattern, parseBlock, empty }: {filePath: string; source: string; tagPattern: RegExp; parseBlock: (input: {blockContent: string}) => ParseResult; empty: ParseResult}): ParseResult {
  const matches = [...source.matchAll(tagPattern)];
  if (matches.length === 0) {
    return empty;
  }

  const aggregate: ParseResult = {
    language: empty.language,
    fileKind: empty.fileKind,
    symbols: [],
    facts: [],
    notes: [],
    metadata: {},
    searchText: ""
  };

  for (const match of matches) {
    const blockContent = match[1] ?? "";
    const fullMatch = match[0] ?? "";
    const blockOffset = typeof match.index === "number" ? match.index + fullMatch.indexOf(blockContent) : 0;
    const blockResult = parseBlock({ blockContent });
    mergeEmbeddedBlock(aggregate, blockResult, countLineColumn(source, blockOffset));
  }

  return aggregate;
}

function mergeEmbeddedBlock(target: ParseResult, blockResult: ParseResult, start: {line: number; column: number}) {
  target.symbols.push(...blockResult.symbols.map((symbol) => offsetResultLocation(symbol, start)));
  target.facts.push(...blockResult.facts);
  target.notes.push(...blockResult.notes.map((note) => offsetResultLocation(note, start)));
  target.searchText = [target.searchText, blockResult.searchText].filter(Boolean).join("\n");
}

function offsetResultLocation<T extends {line?: number; column?: number; metadata?: Record<string, unknown>}>(entry: T, start: {line: number; column: number}): T {
  if (typeof entry?.line !== "number") {
    return entry;
  }

  const line = start.line + entry.line - 1;
  const column = entry.line === 1 ? start.column + (entry.column ?? 1) - 1 : entry.column;
  return {
    ...entry,
    line,
    column,
    ...(typeof entry.metadata?.declarationLine === 'number' ? {
      metadata: {...entry.metadata, declarationLine: start.line + entry.metadata.declarationLine - 1}
    } : {})
  };
}

function emptyResult(language: string): ParseResult {
  return {
    language,
    fileKind: "empty",
    symbols: [],
    facts: [],
    notes: [],
    metadata: {},
    searchText: ""
  };
}
