/** Oxc owns JS/TS syntax. Call names are candidates, not resolved references. */
import {parseSync, Visitor} from 'oxc-parser'
import type {BindingPattern, Node, Program, Span, VisitorObject} from 'oxc-parser'
import {findNotesFuzzily} from './shared.ts'
import type {ParseInput, ParseResult, ParsedSymbol, ParsedNote} from './shared.ts'

function nodeName(node: Node, content: string, computed = false): string {
    if (node.type === 'PrivateIdentifier') return `#${node.name}`
    if (node.type === 'Literal') return String(node.value)
    if (node.type === 'Identifier' && !computed) return node.name
    return `[${content.slice(node.start, node.end)}]`
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

function locationAt(offset: number, lineStarts: number[]): {line: number; column: number} {
    let low = 0, high = lineStarts.length
    while (low + 1 < high) {
        const middle = (low + high) >>> 1
        if (lineStarts[middle] <= offset) low = middle
        else high = middle
    }
    return {line: low + 1, column: offset - lineStarts[low] + 1}
}

function collectSymbols(program: Program, content: string, lineStarts: number[]): ParsedSymbol[] {
    const symbols = new Map<string, ParsedSymbol>()
    const exported = new WeakSet<Node>(), boundExpressions = new WeakSet<Node>(), objectProperties = new WeakSet<Node>()
    const localExports = new Set<string>(), containers: string[] = []
    const functionBodies = new WeakSet<Node>(), anonymousCounts = new Map<string, number>()
    const container = () => containers.at(-1) || undefined
    const push = (name = '') => { containers.push([container(), name].filter(Boolean).join('.')) }
    const leave = () => { containers.pop() }
    const anonymous = (kind: string): string => {
        const key = JSON.stringify([container(), kind])
        const count = (anonymousCounts.get(key) ?? 0) + 1
        anonymousCounts.set(key, count)
        return `<${kind}:${count}>`
    }
    const add = (node: Pick<Span, 'start'>, name: string, kind: string, isExported = false, isStatic = false,
                 owner = container()): void => {
        const key = JSON.stringify([owner, kind, name, isStatic])
        const previous = symbols.get(key)
        if (previous) { previous.exported ||= isExported; return }
        const location = locationAt(node.start, lineStarts)
        const end = lineStarts[location.line] ?? content.length
        symbols.set(key, {name, kind, exported: isExported, ...location, ...(owner ? {containerName: owner} : {}),
            metadata: {signature: content.slice(lineStarts[location.line - 1], end).trim(),
                declarationLine: location.line, ...(owner ? {containerName: owner} : {}), ...(isStatic ? {static: true} : {})}})
    }
    const enter = (node: Node, name: string, kind: string, position: Span = node) => {
        add(position, name, kind, exported.has(node)); push(name)
    }
    const member = (node: {key: Node; computed: boolean; static?: boolean}, kind: string) => {
        const name = nodeName(node.key, content, node.computed)
        add(node.key, name, kind, false, node.static); push(name)
    }
    const visitor: VisitorObject = {
        ExportNamedDeclaration(node) {
            if (node.declaration) exported.add(node.declaration)
            if (!node.source) for (const specifier of node.specifiers)
                localExports.add([container(), nodeName(specifier.local, content)].filter(Boolean).join('.'))
        },
        ExportDefaultDeclaration(node) {
            exported.add(node.declaration)
            if (node.declaration.type !== 'ClassDeclaration' && node.declaration.type !== 'FunctionDeclaration' &&
                node.declaration.type !== 'TSDeclareFunction') {
                const value = node.declaration
                if (value.type === 'Identifier') localExports.add([container(), value.name].filter(Boolean).join('.'))
                add(node, 'default', value.type === 'ArrowFunctionExpression' || value.type === 'FunctionExpression'
                    ? 'function-value' : 'export', true)
                boundExpressions.add(value); push('default')
            }
        },
        'ExportDefaultDeclaration:exit'(node) {
            if (node.declaration.type !== 'ClassDeclaration' && node.declaration.type !== 'FunctionDeclaration' &&
                node.declaration.type !== 'TSDeclareFunction') leave()
        },
        FunctionDeclaration(node) { if (node.body) functionBodies.add(node.body); enter(node, node.id?.name ?? 'default', 'function', node.id ?? node) },
        'FunctionDeclaration:exit': leave,
        TSDeclareFunction(node) { enter(node, node.id?.name ?? 'default', 'function', node.id ?? node) },
        'TSDeclareFunction:exit': leave,
        FunctionExpression(node) {
            if (node.body) functionBodies.add(node.body)
            if (node.id) enter(node, node.id.name, 'function', node.id)
            else push(boundExpressions.has(node) ? '' : anonymous('function'))
        },
        'FunctionExpression:exit': leave,
        ArrowFunctionExpression(node) {
            functionBodies.add(node.body)
            push(boundExpressions.has(node) ? '' : anonymous('function'))
        },
        'ArrowFunctionExpression:exit': leave,
        BlockStatement(node) { push(functionBodies.has(node) ? '' : anonymous('block')) },
        'BlockStatement:exit': leave,
        StaticBlock() { push(anonymous('static')) },
        'StaticBlock:exit': leave,
        ForStatement() { push(anonymous('loop')) },
        'ForStatement:exit': leave,
        ForInStatement() { push(anonymous('loop')) },
        'ForInStatement:exit': leave,
        ForOfStatement() { push(anonymous('loop')) },
        'ForOfStatement:exit': leave,
        ClassDeclaration(node) { enter(node, node.id?.name ?? 'default', 'class', node.id ?? node) },
        'ClassDeclaration:exit': leave,
        ClassExpression(node) {
            if (boundExpressions.has(node)) push()
            else enter(node, node.id?.name ?? 'default', 'class', node.id ?? node)
        },
        'ClassExpression:exit': leave,
        TSInterfaceDeclaration(node) { enter(node, node.id.name, 'interface', node.id) },
        'TSInterfaceDeclaration:exit': leave,
        TSTypeAliasDeclaration(node) { enter(node, node.id.name, 'type', node.id) },
        'TSTypeAliasDeclaration:exit': leave,
        TSEnumDeclaration(node) { enter(node, node.id.name, 'enum', node.id) },
        'TSEnumDeclaration:exit': leave,
        TSEnumMember(node) { add(node.id, nodeName(node.id, content), 'enum-member') },
        TSModuleDeclaration(node) { enter(node, nodeName(node.id, content), 'module', node.id) },
        'TSModuleDeclaration:exit': leave,
        VariableDeclaration(node) {
            for (const declaration of node.declarations) {
                const value = declaration.init
                if (value) boundExpressions.add(value)
                const kind = value?.type === 'ArrowFunctionExpression' || value?.type === 'FunctionExpression'
                    ? 'function-value' : value?.type === 'ClassExpression' ? 'class' : node.kind === 'const' ? 'constant' : 'variable'
                for (const binding of bindingNames(declaration.id)) add(binding, binding.name, kind, exported.has(node))
            }
        },
        VariableDeclarator(node) { push(node.id.type === 'Identifier' ? node.id.name : '') },
        'VariableDeclarator:exit': leave,
        MethodDefinition(node) {
            for (const parameter of node.value.params) if (parameter.type === 'TSParameterProperty')
                for (const binding of bindingNames(parameter.parameter)) add(binding, binding.name, 'property')
            boundExpressions.add(node.value)
            member(node, node.kind === 'get' ? 'getter' : node.kind === 'set' ? 'setter' : node.kind)
        },
        'MethodDefinition:exit': leave,
        PropertyDefinition(node) { if (node.value) boundExpressions.add(node.value); member(node, 'property') },
        'PropertyDefinition:exit': leave,
        AccessorProperty(node) { member(node, 'property') },
        'AccessorProperty:exit': leave,
        TSMethodSignature(node) { member(node, node.kind === 'method' ? 'method' : node.kind === 'get' ? 'getter' : 'setter') },
        'TSMethodSignature:exit': leave,
        TSPropertySignature(node) { member(node, 'property') },
        'TSPropertySignature:exit': leave,
        ObjectExpression(node) {
            push(boundExpressions.has(node) ? '' : anonymous('object'))
            for (const property of node.properties) if (property.type === 'Property') objectProperties.add(property)
        },
        'ObjectExpression:exit': leave,
        Property(node) {
            if (!objectProperties.has(node)) return
            boundExpressions.add(node.value)
            member(node, node.kind === 'get' ? 'getter' : node.kind === 'set' ? 'setter' : node.method ? 'method' : 'property')
        },
        'Property:exit'(node) { if (objectProperties.has(node)) leave() },
        ExportSpecifier(node) { add(node.exported, nodeName(node.exported, content), 'export', true) },
        ExportAllDeclaration(node) { if (node.exported) add(node.exported, nodeName(node.exported, content), 'export', true) }
    }
    // Oxc gives abstract and concrete members different node types with the same shape.
    visitor.TSAbstractMethodDefinition = visitor.MethodDefinition
    visitor['TSAbstractMethodDefinition:exit'] = leave
    visitor.TSAbstractPropertyDefinition = visitor.PropertyDefinition
    visitor['TSAbstractPropertyDefinition:exit'] = leave
    visitor.TSAbstractAccessorProperty = visitor.AccessorProperty
    visitor['TSAbstractAccessorProperty:exit'] = leave
    new Visitor(visitor).visit(program)
    for (const symbol of symbols.values())
        if (localExports.has([symbol.containerName, symbol.name].filter(Boolean).join('.'))) symbol.exported = true
    return [...symbols.values()].sort((a, b) => a.line! - b.line! || a.column! - b.column!)
}

function collectFacts(program: Program): ParseResult['facts'] {
    const imports = new Set<string>(), calls = new Set<string>()
    const call = (node: {callee: Node}) => {
        if (node.callee.type === 'Identifier') calls.add(node.callee.name)
        else if (node.callee.type === 'MemberExpression') {
            const key = node.callee.property
            if (!node.callee.computed && key.type === 'Identifier') calls.add(key.name)
            else if (key.type === 'PrivateIdentifier') calls.add(`#${key.name}`)
            else if (key.type === 'Literal' && typeof key.value === 'string') calls.add(key.value)
        }
    }
    new Visitor({
        ImportDeclaration(node) { imports.add(node.source.value) },
        ExportNamedDeclaration(node) { if (node.source) imports.add(node.source.value) },
        ExportAllDeclaration(node) { imports.add(node.source.value) },
        ImportExpression(node) { if (node.source.type === 'Literal' && typeof node.source.value === 'string') imports.add(node.source.value) },
        TSImportEqualsDeclaration(node) {
            if (node.moduleReference.type === 'TSExternalModuleReference') imports.add(node.moduleReference.expression.value)
        },
        CallExpression: call,
        NewExpression: call
    }).visit(program)
    return [...imports].map(objectText => ({predicate: 'imports', objectText, confidence: 1})).concat(
        [...calls].map(objectText => ({predicate: 'calls', objectText, confidence: 0.52})))
}

function collectNotes(comments: ReturnType<typeof parseSync>['comments'], lineStarts: number[], filePath: string): ParsedNote[] {
    return comments.flatMap(comment => {
        const start = locationAt(comment.start, lineStarts)
        return findNotesFuzzily(comment.value.replace(/\r\n|[\r\u2028\u2029]/g, '\n')).map(note => ({noteType: note.type, body: note.body, filePath,
            line: start.line + note.line - 1, column: note.line === 1 ? start.column : 1}))
    })
}

export function parseJsFamily({filePath, content, language = 'ts'}: ParseInput): ParseResult {
    const lang = /\.[cm]?tsx$/i.test(filePath) ? 'tsx' : /\.jsx$/i.test(filePath) ? 'jsx'
        : /\.[cm]?js$/i.test(filePath) ? 'js' : 'ts'
    const parsed = parseSync(filePath, content, {lang, sourceType: 'unambiguous'})
    const lineStarts = [0, ...Array.from(content.matchAll(/\r\n|[\n\r\u2028\u2029]/g), match => match.index + match[0].length)]
    const symbols = collectSymbols(parsed.program, content, lineStarts)
    const facts = collectFacts(parsed.program)
    const imports = facts.filter(f => f.predicate === 'imports')
    return {language, fileKind: 'code', symbols, facts, notes: collectNotes(parsed.comments, lineStarts, filePath),
        metadata: {importCount: imports.length, symbolCount: symbols.length,
            approximateCallCount: facts.length - imports.length,
            ...(parsed.errors.length ? {parseErrors: parsed.errors.map(error => error.message)} : {})},
        searchText: [content, ...imports.map(f => f.objectText), ...symbols.map(s => s.name)].join('\n')}
}
