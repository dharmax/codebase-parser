import {countLineColumn, findNotesFuzzily} from './shared.mjs'

export function parsePython({filePath, content}) {
    const imports = []
    const symbols = []
    const calls = new Set()

    for (const match of content.matchAll(/^\s*(?:import\s+([\w, ]+)|from\s+([\w.]+)\s+import\s+([\w, *]+))/gm)) {
        if (match[1]) {
            for (const mod of match[1].split(','))
                imports.push(mod.trim())
        } else if (match[2]) {
            imports.push(match[2].trim())
        }
    }

    for (const match of content.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gm)) {
        const loc = countLineColumn(content, match.index ?? 0)
        symbols.push({
            name: match[1],
            kind: 'function',
            exported: !match[1].startsWith('_'),
            line: loc.line,
            column: loc.column,
        })
    }

    for (const match of content.matchAll(/^\s*class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?:/gm)) {
        const loc = countLineColumn(content, match.index ?? 0)
        symbols.push({
            name: match[1],
            kind: 'class',
            exported: !match[1].startsWith('_'),
            line: loc.line,
            column: loc.column,
        })
    }

    for (const match of content.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
        const name = match[1]
        if (!['if', 'while', 'for', 'with', 'try', 'except', 'print', 'return', 'def', 'class'].includes(name))
            calls.add(name)
    }

    const notes = extractHashComments(content, filePath)

    return {
        language: 'python',
        fileKind: 'code',
        symbols,
        facts: [
            ...imports.map(value => ({predicate: 'imports', objectText: value, confidence: 1})),
            ...Array.from(calls).map(value => ({predicate: 'calls', objectText: value, confidence: 0.5})),
        ],
        notes,
        metadata: {importCount: imports.length, symbolCount: symbols.length, approximateCallCount: calls.size},
        searchText: [content, ...imports, ...symbols.map(s => s.name)].join('\n'),
    }
}

export function parseRust({filePath, content}) {
    const imports = []
    const symbols = []
    const calls = new Set()

    for (const match of content.matchAll(/^\s*use\s+([^;]+);/gm))
        imports.push(match[1].trim())

    for (const match of content.matchAll(/\b(pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/g)) {
        const loc = countLineColumn(content, match.index ?? 0)
        symbols.push({name: match[2], kind: 'function', exported: Boolean(match[1]), line: loc.line, column: loc.column})
    }

    for (const match of content.matchAll(/\b(pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/g)) {
        const loc = countLineColumn(content, match.index ?? 0)
        symbols.push({name: match[2], kind: 'type', exported: Boolean(match[1]), line: loc.line, column: loc.column})
    }

    for (const match of content.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
        const name = match[1]
        if (!['if', 'while', 'for', 'match', 'return', 'fn', 'let', 'mut'].includes(name))
            calls.add(name)
    }

    const notes = extractSlashComments(content, filePath)

    return {
        language: 'rust',
        fileKind: 'code',
        symbols,
        facts: [
            ...imports.map(value => ({predicate: 'imports', objectText: value, confidence: 1})),
            ...Array.from(calls).map(value => ({predicate: 'calls', objectText: value, confidence: 0.5})),
        ],
        notes,
        metadata: {importCount: imports.length, symbolCount: symbols.length, approximateCallCount: calls.size},
        searchText: [content, ...imports, ...symbols.map(s => s.name)].join('\n'),
    }
}

export function parseGo({filePath, content}) {
    const imports = []
    const symbols = []
    const calls = new Set()

    for (const match of content.matchAll(/^\s*import\s+(?:\(\s*([\s\S]*?)\s*\)|"([^"]+)")/gm)) {
        if (match[2]) {
            imports.push(match[2])
        } else if (match[1]) {
            for (const imp of match[1].matchAll(/"([^"]+)"/g))
                imports.push(imp[1])
        }
    }

    for (const match of content.matchAll(/\bfunc\s+(?:\([^)]+\)\s+)?([A-Za-z_]\w*)\s*\(/g)) {
        const loc = countLineColumn(content, match.index ?? 0)
        const name = match[1]
        symbols.push({name, kind: 'function', exported: name[0] === name[0].toUpperCase(), line: loc.line, column: loc.column})
    }

    for (const match of content.matchAll(/\btype\s+([A-Za-z_]\w*)\s+(?:struct|interface)\b/g)) {
        const loc = countLineColumn(content, match.index ?? 0)
        const name = match[1]
        symbols.push({name, kind: 'type', exported: name[0] === name[0].toUpperCase(), line: loc.line, column: loc.column})
    }

    for (const match of content.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
        const name = match[1]
        if (!['if', 'for', 'switch', 'return', 'func', 'go', 'defer'].includes(name))
            calls.add(name)
    }

    const notes = extractSlashComments(content, filePath)

    return {
        language: 'go',
        fileKind: 'code',
        symbols,
        facts: [
            ...imports.map(value => ({predicate: 'imports', objectText: value, confidence: 1})),
            ...Array.from(calls).map(value => ({predicate: 'calls', objectText: value, confidence: 0.5})),
        ],
        notes,
        metadata: {importCount: imports.length, symbolCount: symbols.length, approximateCallCount: calls.size},
        searchText: [content, ...imports, ...symbols.map(s => s.name)].join('\n'),
    }
}

export function parseShell({filePath, content}) {
    const symbols = []

    for (const match of content.matchAll(/^\s*(?:function\s+)?([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*\{/gm)) {
        const loc = countLineColumn(content, match.index ?? 0)
        symbols.push({name: match[1], kind: 'function', exported: true, line: loc.line, column: loc.column})
    }

    const notes = extractHashComments(content, filePath)

    return {
        language: 'shell',
        fileKind: 'script',
        symbols,
        facts: [],
        notes,
        metadata: {symbolCount: symbols.length},
        searchText: content,
    }
}

function extractHashComments(source, filePath) {
    const notes = []
    const lines = source.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        const hashIdx = line.indexOf('#')
        if (hashIdx !== -1) {
            const comment = line.slice(hashIdx + 1).trim()
            for (const found of findNotesFuzzily(comment)) {
                notes.push({
                    noteType: found.type,
                    body: found.body,
                    filePath,
                    line: i + 1,
                    column: hashIdx + 1,
                })
            }
        }
    }
    return notes
}

function extractSlashComments(source, filePath) {
    const notes = []
    const lines = source.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        const slashIdx = line.indexOf('//')
        if (slashIdx !== -1) {
            const comment = line.slice(slashIdx + 2).trim()
            for (const found of findNotesFuzzily(comment)) {
                notes.push({
                    noteType: found.type,
                    body: found.body,
                    filePath,
                    line: i + 1,
                    column: slashIdx + 1,
                })
            }
        }
    }
    return notes
}
