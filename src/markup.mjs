/**
 * @file markup.mjs
 * @brief Auto-generated header for markup.mjs. Needs detailed responsibility and scope.
 */

import { extractTaggedNotes } from "./shared.mjs";
import { countLineColumn } from "./shared.mjs";
import { parseJsFamily } from "./js-family.mjs";
import { parseStyles } from "./styles.mjs";

export function parseHtml({ filePath, content, language = "html" }) {
  const ids = new Set();
  const classes = new Set();

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

export function parseRiot({ filePath, content }) {
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

function collectEmbeddedParseResults({ filePath, source, tagPattern, parseBlock, empty }) {
  const matches = [...source.matchAll(tagPattern)];
  if (matches.length === 0) {
    return empty;
  }

  const aggregate = {
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

function mergeEmbeddedBlock(target, blockResult, start) {
  target.symbols.push(...blockResult.symbols.map((symbol) => offsetResultLocation(symbol, start)));
  target.facts.push(...blockResult.facts);
  target.notes.push(...blockResult.notes.map((note) => offsetResultLocation(note, start)));
  target.searchText = [target.searchText, blockResult.searchText].filter(Boolean).join("\n");
}

function offsetResultLocation(entry, start) {
  if (typeof entry?.line !== "number") {
    return entry;
  }

  const line = start.line + entry.line - 1;
  const column = entry.line === 1 ? start.column + entry.column - 1 : entry.column;
  return {
    ...entry,
    line,
    column
  };
}

function emptyResult(language) {
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
