import type {ParseInput, ParseResult, ParsedSymbol} from './shared.ts'
import { countLineColumn, findNotesFuzzily } from './shared.ts';

export function parsePython({ filePath, content }: ParseInput): ParseResult {
  const imports = [];
  const symbols: Array<ParsedSymbol & {line: number; column: number}> = [];
  const calls = new Set<string>();
  const seen = new Set();

  for (const match of content.matchAll(/^\s*(?:import\s+([\w, ]+)|from\s+([\w.]+)\s+import\s+([\w, *]+))/gm)) {
    if (match[1]) {
      for (const mod of match[1].split(',')) imports.push(mod.trim());
    } else if (match[2]) {
      imports.push(match[2].trim());
    }
  }

  // Track classes to identify methods inside them
  const classes = [];
  for (const match of content.matchAll(/^(\s*)class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?:/gm)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const className = match[2];
    const indent = match[1].length;
    classes.push({ name: className, indent, line: loc.line });
    symbols.push({
      name: className,
      kind: 'class',
      exported: !className.startsWith('_'),
      line: loc.line,
      column: loc.column,
      metadata: { signature: `class ${className}` }
    });
    seen.add(`class:${className}`);
  }

  // Functions and methods
  for (const match of content.matchAll(/^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const fnName = match[2];
    const indent = match[1].length;

    // Check if inside a class (indent > class.indent and line > class.line)
    let containerClass = null;
    for (let i = classes.length - 1; i >= 0; i--) {
      if (loc.line > classes[i].line && indent > classes[i].indent) {
        containerClass = classes[i].name;
        break;
      }
    }

    const kind = containerClass ? 'method' : 'function';
    const key = `${kind}:${containerClass ? `${containerClass}.` : ''}${fnName}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name: fnName,
        kind,
        containerName: containerClass || undefined,
        exported: !fnName.startsWith('_'),
        line: loc.line,
        column: loc.column,
        metadata: {
          signature: `${containerClass ? `${containerClass}.` : ''}${fnName}`,
          containerName: containerClass || undefined
        }
      });
    }
  }

  // Module-level constants (e.g. MAX_BUFFER_SIZE = 1024)
  for (const match of content.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=/gm)) {
    const name = match[1];
    if (name.startsWith('__')) continue;
    const key = `constant:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      const loc = countLineColumn(content, match.index ?? 0);
      symbols.push({
        name,
        kind: 'constant',
        exported: !name.startsWith('_'),
        line: loc.line,
        column: loc.column,
        metadata: { signature: name }
      });
    }
  }

  // Function calls
  for (const match of content.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1];
    if (!['if', 'while', 'for', 'with', 'try', 'except', 'print', 'return', 'def', 'class'].includes(name)) {
      calls.add(name);
    }
  }

  const notes = extractHashComments(content, filePath);
  symbols.sort((a, b) => a.line - b.line || a.column - b.column);

  return {
    language: 'python',
    fileKind: 'code',
    symbols,
    facts: [
      ...imports.map(value => ({ predicate: 'imports', objectText: value, confidence: 1 })),
      ...Array.from(calls).map(value => ({ predicate: 'calls', objectText: value, confidence: 0.5 }))
    ],
    notes,
    metadata: { importCount: imports.length, symbolCount: symbols.length, approximateCallCount: calls.size },
    searchText: [content, ...imports, ...symbols.map(s => s.name)].join('\n')
  };
}

export function parseRust({ filePath, content }: ParseInput): ParseResult {
  const imports = [];
  const symbols: Array<ParsedSymbol & {line: number; column: number}> = [];
  const calls = new Set<string>();
  const seen = new Set();

  for (const match of content.matchAll(/^\s*use\s+([^;]+);/gm)) {
    imports.push(match[1].trim());
  }

  // Functions
  for (const match of content.matchAll(/\b(pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const name = match[2];
    const key = `function:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: 'function',
        exported: Boolean(match[1]),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `fn ${name}` }
      });
    }
  }

  // Struct, enum, trait, union
  for (const match of content.matchAll(/\b(pub\s+)?(?:(struct|enum|trait|union))\s+([A-Za-z_]\w*)/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const kind = match[2];
    const name = match[3];
    const key = `${kind}:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: kind === 'struct' || kind === 'enum' || kind === 'trait' ? kind : 'type',
        exported: Boolean(match[1]),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `${kind} ${name}` }
      });
    }
  }

  // Type aliases
  for (const match of content.matchAll(/\b(pub\s+)?type\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*=/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const name = match[2];
    const key = `type:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: 'type',
        exported: Boolean(match[1]),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `type ${name}` }
      });
    }
  }

  // Constants
  for (const match of content.matchAll(/\b(pub\s+)?(?:const|static)\s+([A-Za-z_]\w*)\s*:/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const name = match[2];
    const key = `constant:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: 'constant',
        exported: Boolean(match[1]),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `const ${name}` }
      });
    }
  }

  for (const match of content.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1];
    if (!['if', 'while', 'for', 'match', 'return', 'fn', 'let', 'mut'].includes(name)) {
      calls.add(name);
    }
  }

  const notes = extractSlashComments(content, filePath);
  symbols.sort((a, b) => a.line - b.line || a.column - b.column);

  return {
    language: 'rust',
    fileKind: 'code',
    symbols,
    facts: [
      ...imports.map(value => ({ predicate: 'imports', objectText: value, confidence: 1 })),
      ...Array.from(calls).map(value => ({ predicate: 'calls', objectText: value, confidence: 0.5 }))
    ],
    notes,
    metadata: { importCount: imports.length, symbolCount: symbols.length, approximateCallCount: calls.size },
    searchText: [content, ...imports, ...symbols.map(s => s.name)].join('\n')
  };
}

export function parseGo({ filePath, content }: ParseInput): ParseResult {
  const imports = [];
  const symbols: Array<ParsedSymbol & {line: number; column: number}> = [];
  const calls = new Set<string>();
  const seen = new Set();

  for (const match of content.matchAll(/^\s*import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/gm)) {
    if (match[2]) {
      imports.push(match[2]);
    } else if (match[1]) {
      for (const imp of match[1].matchAll(/"([^"]+)"/g)) imports.push(imp[1]);
    }
  }

  // Methods with receivers: `func (r *Receiver) MethodName(...)`
  for (const match of content.matchAll(/\bfunc\s+\(\s*([^)]+)\s*\)\s*([A-Za-z_]\w*)\s*\(/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const receiverRaw = match[1].trim();
    const receiverParts = receiverRaw.split(/\s+/);
    const receiverType = receiverParts[receiverParts.length - 1].replace(/^\*/, '');
    const name = match[2];
    const key = `method:${receiverType}.${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: 'method',
        containerName: receiverType || undefined,
        exported: name[0] === name[0].toUpperCase(),
        line: loc.line,
        column: loc.column,
        metadata: {
          signature: `func (${receiverRaw}) ${name}`,
          containerName: receiverType || undefined
        }
      });
    }
  }

  // Regular functions
  for (const match of content.matchAll(/\bfunc\s+([A-Za-z_]\w*)\s*\(/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const name = match[1];
    const key = `function:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: 'function',
        exported: name[0] === name[0].toUpperCase(),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `func ${name}` }
      });
    }
  }

  // Types (struct, interface, custom)
  for (const match of content.matchAll(/\btype\s+([A-Za-z_]\w*)\s+(struct|interface|[A-Za-z_]\w*)\b/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const name = match[1];
    const kind = match[2];
    const key = `type:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: kind === 'struct' || kind === 'interface' ? kind : 'type',
        exported: name[0] === name[0].toUpperCase(),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `type ${name} ${kind}` }
      });
    }
  }

  // Constants
  for (const match of content.matchAll(/\bconst\s+([A-Za-z_]\w*)\s*(?:[A-Za-z_]\w*)?\s*=/g)) {
    const loc = countLineColumn(content, match.index ?? 0);
    const name = match[1];
    const key = `constant:${name}`;
    if (!seen.has(key)) {
      seen.add(key);
      symbols.push({
        name,
        kind: 'constant',
        exported: name[0] === name[0].toUpperCase(),
        line: loc.line,
        column: loc.column,
        metadata: { signature: `const ${name}` }
      });
    }
  }

  // Function calls
  for (const match of content.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1];
    if (!['if', 'for', 'switch', 'return', 'func', 'go', 'defer'].includes(name)) {
      calls.add(name);
    }
  }

  const notes = extractSlashComments(content, filePath);
  symbols.sort((a, b) => a.line - b.line || a.column - b.column);

  return {
    language: 'go',
    fileKind: 'code',
    symbols,
    facts: [
      ...imports.map(value => ({ predicate: 'imports', objectText: value, confidence: 1 })),
      ...Array.from(calls).map(value => ({ predicate: 'calls', objectText: value, confidence: 0.5 }))
    ],
    notes,
    metadata: { importCount: imports.length, symbolCount: symbols.length, approximateCallCount: calls.size },
    searchText: [content, ...imports, ...symbols.map(s => s.name)].join('\n')
  };
}

export function parseShell({ filePath, content }: ParseInput): ParseResult {
  const symbols: Array<ParsedSymbol & {line: number; column: number}> = [];
  const seen = new Set();

  for (const match of content.matchAll(/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*\{/gm)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      const loc = countLineColumn(content, match.index ?? 0);
      symbols.push({
        name,
        kind: 'function',
        exported: true,
        line: loc.line,
        column: loc.column,
        metadata: { signature: `function ${name}` }
      });
    }
  }

  // Exported variables: `export VAR_NAME=...`
  for (const match of content.matchAll(/^\s*export\s+([A-Za-z_]\w*)=/gm)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      const loc = countLineColumn(content, match.index ?? 0);
      symbols.push({
        name,
        kind: 'variable',
        exported: true,
        line: loc.line,
        column: loc.column,
        metadata: { signature: `export ${name}` }
      });
    }
  }

  const notes = extractHashComments(content, filePath);
  symbols.sort((a, b) => a.line - b.line || a.column - b.column);

  return {
    language: 'shell',
    fileKind: 'script',
    symbols,
    facts: [],
    notes,
    metadata: { symbolCount: symbols.length },
    searchText: content
  };
}

function extractHashComments(source: string, filePath: string) {
  const notes = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hashIdx = line.indexOf('#');
    if (hashIdx !== -1) {
      const comment = line.slice(hashIdx + 1).trim();
      for (const found of findNotesFuzzily(comment)) {
        notes.push({
          noteType: found.type,
          body: found.body,
          filePath,
          line: i + 1,
          column: hashIdx + 1
        });
      }
    }
  }
  return notes;
}

function extractSlashComments(source: string, filePath: string) {
  const notes = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const slashIdx = line.indexOf('//');
    if (slashIdx !== -1) {
      const comment = line.slice(slashIdx + 2).trim();
      for (const found of findNotesFuzzily(comment)) {
        notes.push({
          noteType: found.type,
          body: found.body,
          filePath,
          line: i + 1,
          column: slashIdx + 1
        });
      }
    }
  }
  return notes;
}
