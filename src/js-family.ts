/** JS/TS syntax facts come from Oxc's AST and parser-owned comment ranges. */
import {parseSync, Visitor} from 'oxc-parser'
import type {BindingPattern, Node, Program, Span} from 'oxc-parser'
import {countLineColumn, findNotesFuzzily} from './shared.js'
import type {ParseInput, ParseResult, ParsedSymbol, ParsedNote} from './shared.js'

function nodeName(node: Node, content: string): string {
    if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name
    if (node.type === 'Literal') return String(node.value)
    return content.slice(node.start, node.end)
}

function bindingNames(pattern: BindingPattern): Array<{name: string; start: number}> {
    switch (pattern.type) {
        case 'Identifier': return [pattern]
        case 'AssignmentPattern': return bindingNames(pattern.left)
        case 'ObjectPattern': return pattern.properties.flatMap(property =>
            property.type === 'RestElement' ? bindingNames(property.argument) : bindingNames(property.value))
        case 'ArrayPattern': return pattern.elements.flatMap(element => !element ? [] :
            bindingNames(element.type === 'RestElement' ? element.argument : element))
    }
}

function collectSymbols(program: Program, content: string): ParsedSymbol[] {
    const symbols: ParsedSymbol[] = []
    const exported = new WeakSet<Node>()
    const containers: string[] = []
    const add = (node: Pick<Span, "start">, name: string, kind: string, isExported = false): void => {
        const location = countLineColumn(content, node.start)
        const containerName = containers.at(-1)
        symbols.push({name, kind, exported: isExported, ...location, containerName,
            metadata: {signature: content.slice(node.start).split('\n', 1)[0].trim(),
                declarationLine: location.line, containerName}})
    }
    const enter = (node: Node, name: string, kind: string): void => {
        add(node, name, kind, exported.has(node))
        containers.push(name)
    }
    const leave = (): void => { containers.pop() }
    new Visitor({
        ExportNamedDeclaration(node) { if (node.declaration) exported.add(node.declaration) },
        ExportDefaultDeclaration(node) { exported.add(node.declaration) },
        FunctionDeclaration(node) { add(node, node.id?.name ?? 'default', 'function', exported.has(node)) },
        TSDeclareFunction(node) { add(node, node.id?.name ?? 'default', 'function', exported.has(node)) },
        ClassDeclaration(node) { enter(node, node.id?.name ?? 'default', 'class') },
        'ClassDeclaration:exit': leave,
        ClassExpression(node) { enter(node, node.id?.name ?? 'default', 'class') },
        'ClassExpression:exit': leave,
        TSInterfaceDeclaration(node) { enter(node, node.id.name, 'interface') },
        'TSInterfaceDeclaration:exit': leave,
        TSTypeAliasDeclaration(node) { add(node, node.id.name, 'type', exported.has(node)) },
        TSEnumDeclaration(node) { enter(node, node.id.name, 'enum') },
        'TSEnumDeclaration:exit': leave,
        TSEnumMember(node) { add(node, nodeName(node.id, content), 'enum-member') },
        TSModuleDeclaration(node) { enter(node, nodeName(node.id, content), 'module') },
        'TSModuleDeclaration:exit': leave,
        VariableDeclaration(node) {
            for (const declaration of node.declarations) {
                const kind = declaration.init?.type === 'ArrowFunctionExpression' || declaration.init?.type === 'FunctionExpression'
                    ? 'function-value' : node.kind === 'const' ? 'constant' : 'variable'
                for (const binding of bindingNames(declaration.id)) add(binding, binding.name, kind, exported.has(node))
            }
        },
        MethodDefinition(node) { add(node, nodeName(node.key, content),
            node.kind === 'get' ? 'getter' : node.kind === 'set' ? 'setter' : node.kind === 'constructor' ? 'constructor' : 'method') },
        PropertyDefinition(node) { add(node, nodeName(node.key, content), 'property') },
        TSMethodSignature(node) { add(node, nodeName(node.key, content),
            node.kind === 'get' ? 'getter' : node.kind === 'set' ? 'setter' : 'method') },
        TSPropertySignature(node) { add(node, nodeName(node.key, content), 'property') },
        Property(node) { if (node.method) add(node, nodeName(node.key, content), 'method') },
        ExportSpecifier(node) { add(node, nodeName(node.exported, content), 'export', true) },
        ExportAllDeclaration(node) { if (node.exported) add(node, nodeName(node.exported, content), 'export', true) }
    }).visit(program)
    return symbols.sort((a, b) => a.line! - b.line! || a.column! - b.column!)
}

function collectFacts(program: Program): ParseResult['facts'] {
    const imports: string[] = []
    const calls = new Set<string>()
    new Visitor({
        ImportDeclaration(node) { imports.push(node.source.value) },
        ExportNamedDeclaration(node) { if (node.source) imports.push(node.source.value) },
        ExportAllDeclaration(node) { imports.push(node.source.value) },
        ImportExpression(node) { if (node.source.type === 'Literal' && typeof node.source.value === 'string') imports.push(node.source.value) },
        TSImportEqualsDeclaration(node) {
            if (node.moduleReference.type === 'TSExternalModuleReference') imports.push(node.moduleReference.expression.value)
        },
        CallExpression(node) {
            if (node.callee.type === 'Identifier') calls.add(node.callee.name)
            else if (node.callee.type === 'MemberExpression' && !node.callee.computed &&
                     (node.callee.property.type === 'Identifier' || node.callee.property.type === 'PrivateIdentifier')) calls.add(node.callee.property.name)
        }
    }).visit(program)
    return [...imports.map(objectText => ({predicate: 'imports', objectText, confidence: 1})),
        ...[...calls].map(objectText => ({predicate: 'calls', objectText, confidence: 0.52}))]
}

function collectNotes(comments: ReturnType<typeof parseSync>['comments'], content: string, filePath: string): ParsedNote[] {
    return comments.flatMap(comment => {
        const start = countLineColumn(content, comment.start)
        return findNotesFuzzily(comment.value).map(note => ({noteType: note.type, body: note.body, filePath,
            line: start.line + note.line - 1, column: note.line === 1 ? start.column : 1}))
    })
}

export function parseJsFamily({filePath, content, language = 'ts'}: ParseInput): ParseResult {
    const lang = /\.[cm]?tsx$/i.test(filePath) ? 'tsx' : /\.jsx$/i.test(filePath) ? 'jsx'
        : /\.[cm]?js$/i.test(filePath) ? 'js' : 'ts'
    const parsed = parseSync(filePath, content, {lang, sourceType: 'unambiguous'})
    const symbols = collectSymbols(parsed.program, content)
    const facts = collectFacts(parsed.program)
    const imports = facts.filter(f => f.predicate === 'imports')
    return {language, fileKind: 'code', symbols, facts, notes: collectNotes(parsed.comments, content, filePath),
        metadata: {importCount: imports.length, symbolCount: symbols.length,
            approximateCallCount: facts.length - imports.length,
            ...(parsed.errors.length ? {parseErrors: parsed.errors.map(error => error.message)} : {})},
        searchText: [content, ...imports.map(f => f.objectText), ...symbols.map(s => s.name)].join('\n')}
}
