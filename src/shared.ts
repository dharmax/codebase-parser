export interface ParseInput {
  filePath: string
  content: string
  language?: string
}

export interface ParsedSymbol {
  name: string
  kind: string
  exported: boolean
  containerName?: string
  line?: number
  column?: number
  metadata?: Record<string, unknown>
}

export interface ParsedNote {
  noteType: string
  body: string
  filePath: string
  line: number
  column: number
}

export interface ParseResult {
  language: string
  fileKind: string
  symbols: ParsedSymbol[]
  facts: Array<{predicate: string; objectText: string; confidence: number}>
  notes: ParsedNote[]
  metadata: Record<string, unknown>
  searchText: string
}

/**
 * Shared utilities and semantic definitions for codebase-parser.
 */

export const SEMANTICS = {
  NOTES: {
    markers: ["TODO", "FIXME", "BUG", "RISK", "HACK", "NOTE", "OPTIMIZE", "REVIEW", "DEBT", "PENDING", "FIXIT", "REVISIT"],
    aliases: {
      "TODO": ["to-do", "todo", "[ ]"],
      "BUG": ["bug", "error", "fault", "fixit"],
      "REVIEW": ["review", "revisit", "audit"]
    }
  }
};

export function getNoteRegex() {
  const allMarkers = [
    ...SEMANTICS.NOTES.markers,
    ...Object.values(SEMANTICS.NOTES.aliases).flat()
  ];
  const escaped = allMarkers.map(m => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^\\s*(?:(?:[-*]\\s+)?(?:\\[\\s*)?(${escaped.join("|")})(?:\\s*\\])?[:\\-]?|\\-\\s+\\[\\s\\])\\s+(.+)`, "i");
}

export function findNotesFuzzily(text: string) {
  const lines = text.split("\n");
  const results = [];
  const regex = getNoteRegex();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(regex);
    if (match) {
      const typeText = match[1] || "TODO";
      const body = match[2] || "";
      const type = inferNoteType(typeText);
      results.push({
        type,
        body: body.trim(),
        line: i + 1,
        rawLine: line
      });
    }
  }
  return results;
}

export function isStandaloneNoteLine(line: string) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed) {
    return false;
  }
  return getNoteRegex().test(trimmed);
}

function inferNoteType(matchText: string) {
  const lower = (matchText || "").toLowerCase();
  for (const [canonical, aliases] of Object.entries(SEMANTICS.NOTES.aliases)) {
    if (aliases.some(a => lower.includes(a.toLowerCase()))) return canonical;
  }
  for (const marker of SEMANTICS.NOTES.markers) {
    if (lower.includes(marker.toLowerCase())) return marker;
  }
  return "TODO";
}

export function extractTaggedNotes(content: string, { commentPattern, filePath }: {commentPattern: RegExp; filePath: string}): ParsedNote[] {
  const results = [];
  const noteRegex = getNoteRegex();

  for (const match of content.matchAll(commentPattern)) {
    const commentBody = match[1];
    const offset = match.index;
    const { line, column } = countLineColumn(content, offset);

    const innerLines = commentBody.split("\n");
    for (let i = 0; i < innerLines.length; i++) {
      const noteMatch = innerLines[i].match(noteRegex);
      if (noteMatch) {
        const typeText = noteMatch[1] || "TODO";
        const body = noteMatch[2] || "";
        const noteType = inferNoteType(typeText);
        results.push({
          noteType,
          body: body.trim(),
          filePath,
          line: line + i,
          column: i === 0 ? column : 1
        });
      }
    }
  }
  return results;
}

export function buildCandidateTitle(note: Pick<ParsedNote, "body" | "noteType">) {
  const raw = String(note.body ?? "").replace(/[.]+$/, "").trim();
  if (!raw) {
    return `Follow up ${note.noteType.toLowerCase()}`;
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function countLineColumn(source: string, offset = 0) {
  const slice = source.slice(0, Math.max(0, offset));
  const lines = slice.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1) ?? "").length + 1
  };
}
