import {test, expect} from 'bun:test'
import {parseIndexedFile, type ParsedSymbol} from '../src/index.ts'

test('parseMarkdownFile recognizes shared standalone note markers', () => {
    const result = parseIndexedFile({
        filePath: 'docs/notes.md',
        content: '# Notes\n\nTODO: write tests\nFIXME: resolve memory leak\n',
    })
    expect(result.language).toBe('markdown')
    expect(result.notes.length).toBe(2)
    expect(result.notes[0].noteType).toBe('TODO')
    expect(result.notes[1].noteType).toBe('FIXME')
})

test('parseJsFamily records anonymous default exports and typescript mts extensions', () => {
    const result = parseIndexedFile({
        filePath: 'src/module.mts',
        content: 'import { foo } from "./foo.mts"\n\nexport default function () { return 42 }\nexport const bar = () => "bar"',
    })
    expect(result.language).toBe('mts')
    expect(result.symbols.length).toBe(2)
    expect(result.symbols[0].name).toBe('default')
    expect(result.symbols[1].name).toBe('bar')
    expect(result.facts.some(f => f.predicate === 'imports' && f.objectText === './foo.mts')).toBe(true)
})

test('parseRiot merges every script and style block', () => {
    const result = parseIndexedFile({
        filePath: 'components/my-tag.riot',
        content: '<my-tag><p>hello</p><script>export default { onMounted() {} }</script><style>p { color: red; }</style></my-tag>',
    })
    expect(result.language).toBe('riot')
    expect(result.symbols.length > 0).toBe(true)
})

test('parsePython extracts imports, functions, classes, and comments', () => {
    const result = parseIndexedFile({
        filePath: 'app/server.py',
        content: `import os\nfrom math import sqrt\n\n# TODO: optimize handler\ndef handle_request(req):\n    return calculate(req)\n\nclass ServerRunner:\n    pass\n`,
    })
    expect(result.language).toBe('python')
    expect(result.symbols.length).toBe(2)
    expect(result.symbols[0].name).toBe('handle_request')
    expect(result.symbols[1].name).toBe('ServerRunner')
    expect(result.notes.length).toBe(1)
    expect(result.notes[0].noteType).toBe('TODO')
    expect(result.facts.some(f => f.predicate === 'imports' && f.objectText === 'os')).toBe(true)
})

test('parseRust extracts use imports, pub fn, and structs', () => {
    const result = parseIndexedFile({
        filePath: 'src/lib.rs',
        content: `use std::sync::Arc;\n\n// NOTE: thread safe\npub fn run_worker() {\n    do_work();\n}\n\npub struct WorkerConfig;\n`,
    })
    expect(result.language).toBe('rust')
    expect(result.symbols.length).toBe(2)
    expect(result.symbols[0].name).toBe('run_worker')
    expect(result.symbols[1].name).toBe('WorkerConfig')
    expect(result.notes[0].noteType).toBe('NOTE')
})

test('parseGo extracts functions and types', () => {
    const result = parseIndexedFile({
        filePath: 'main.go',
        content: `package main\n\nimport "fmt"\n\nfunc StartServer() {\n    fmt.Println("start")\n}\n\ntype Config struct{}\n`,
    })
    expect(result.language).toBe('go')
    expect(result.symbols.length).toBe(2)
    expect(result.symbols[0].name).toBe('StartServer')
    expect(result.symbols[1].name).toBe('Config')
})

test('parseShell extracts function names and notes', () => {
    const result = parseIndexedFile({
        filePath: 'scripts/deploy.sh',
        content: `#!/bin/bash\n# TODO: add error handling\nfunction deploy_app() {\n    echo "deploying"\n}\n`,
    })
    expect(result.language).toBe('shell')
    expect(result.symbols.length).toBe(1)
    expect(result.symbols[0].name).toBe('deploy_app')
    expect(result.notes[0].noteType).toBe('TODO')
})

test('JS/TS AST ignores declaration-like text, regexes and type-only syntax as calls', () => {
    const result = parseIndexedFile({filePath: 'sample.ts', content: `
const text = "export function fake() {} // TODO: not a note";
const pattern = /function ghost() {}/;
// TODO: keep this actual comment
export function real<T>(value: T): T { return transform<T>(value); }
interface Shape { render(): void; }
`})
    expect(result.symbols.map(s => s.name)).toEqual(['text', 'pattern', 'real', 'Shape', 'render'])
    expect(result.facts.filter(f => f.predicate === 'calls').map(f => f.objectText)).toEqual(['transform'])
    expect(result.notes.length).toBe(1)
    expect(result.notes[0].line).toBe(4)
})

test('JS/TS AST preserves nested members, binding patterns, reexports and actual calls', () => {
    const result = parseIndexedFile({filePath: 'sample.ts', content: `
import type {Remote} from './types';
export {value as renamed} from './other';
export namespace Space {
  export class Box<T> {
    value: T;
    constructor(value: T) { this.value = value; }
    get current() { return this.value; }
    set current(value: T) { this.value = value; }
    run = () => service.run<T>(this.value);
    method<U>(value: U) { return consume<U>(value); }
  }
}
export const {first: alias, nested: {leaf}} = source;
export enum Mode {One, Two}
const lazy = import('./lazy');
`})
    const symbols = result.symbols
    for (const name of ['Space', 'Box', 'value', 'constructor', 'current', 'run', 'method', 'alias', 'leaf', 'Mode', 'One', 'Two', 'renamed'])
        expect(symbols.some(s => s.name === name), name).toBeTruthy()
    expect(symbols.find(s => s.name === 'method')?.containerName).toBe('Space.Box')
    expect(symbols.find(s => s.name === 'Box')?.exported).toBe(true)
    expect(symbols.filter(s => s.name === 'current').length).toBe(2)
    expect(result.facts.filter(f => f.predicate === 'imports').map(f => f.objectText)).toEqual(['./types', './other', './lazy'])
    expect(result.facts.filter(f => f.predicate === 'calls').map(f => f.objectText)).toEqual(['run', 'consume'])
    expect(symbols.every((s, i) => i === 0 || (s.line ?? 0) >= (symbols[i - 1].line ?? 0))).toBeTruthy()
})

test('JS/TS AST selects JSX grammar and parses template-expression calls and real comments', () => {
    const result = parseIndexedFile({filePath: 'view.tsx', content: `
export const View = () => <main title="function fake() {}">{format(value)}</main>;
const template = \`literal TODO: not a comment \${render(value)}\`;
/* NOTE: actual block comment */
`})
    expect(result.symbols.map(s => s.name)).toEqual(['View', 'template'])
    expect(result.facts.filter(f => f.predicate === 'calls').map(f => f.objectText)).toEqual(['format', 'render'])
    expect(result.notes[0].noteType).toBe('NOTE')
    expect(result.notes[0].line).toBe(4)
})

test('parseJsFamily indexes TypeScript members and ignores fake symbols in strings', () => {
    const source = [
      'export interface Ticket { priority: number; lane?: string; execute(): void }',
      'class Runner { priority = 2; constructor() {} run() { return this.priority } }',
      'type Setting = { priority?: number }',
      'const fake = "function invented() {}"',
      'export const helper = () => new Runner()',
    ].join('\n')
    const result = parseIndexedFile({filePath:'src/work.ts',content:source})
    const fields = result.symbols.filter(s => s.kind === 'property' && s.name === 'priority')
    expect(fields.map(s => s.containerName)).toEqual(['Ticket','Runner','Setting'])
    expect(result.symbols.filter(s => s.containerName === 'Ticket').map(s => s.name)).toEqual(['priority','lane','execute'])
    expect(result.symbols.some(s => s.name === 'invented')).toBe(false)
    expect(result.symbols.some(s => s.name === 'helper' && s.kind === 'function-value' && s.exported)).toBe(true)
    expect(result.symbols.every(s => s.line! > 0 && s.column! > 0)).toBeTruthy()
})
test('parseJsFamily extracts syntactic calls without matching strings or comments', () => {
    const result = parseIndexedFile({filePath:'src/view.tsx',content:'// pretend()\nexport function View() { const a = "fake()"; return <div>{actual()}</div> }'})
    const calls=result.facts.filter(f=>f.predicate==='calls')
    expect(calls.map(f=>f.objectText)).toEqual(['actual'])
    expect(calls[0].confidence < 1).toBe(true)
})

test('qualified owners distinguish nested symbols and remain stable after line edits', () => {
    const source = `namespace A { export class Box { run() { const local = 1; function nested() {} } } }
namespace B { export class Box { run() {} } }
function outer() { function inner() {} }
const factory = () => { function create() {} };
type Setting = { nested: { value: number } };`
    const parse = (content: string) => parseIndexedFile({filePath: 'scopes.ts', content})
    const identity = (s: ParsedSymbol) => [s.containerName, s.kind, s.name]
    const result = parse(source)
    expect(result.symbols.filter(s => s.name === 'run').map(s => s.containerName)).toEqual(['A.Box', 'B.Box'])
    expect(result.symbols.find(s => s.name === 'local')?.containerName).toBe('A.Box.run')
    expect(result.symbols.find(s => s.name === 'nested')?.containerName).toBe('A.Box.run')
    expect(result.symbols.find(s => s.name === 'inner')?.containerName).toBe('outer')
    expect(result.symbols.find(s => s.name === 'create')?.containerName).toBe('factory')
    expect(result.symbols.find(s => s.name === 'value')?.containerName).toBe('Setting.nested')
    expect(parse('// inserted comment\n\n' + source).symbols.map(identity)).toEqual(result.symbols.map(identity))
    expect(parse(source).symbols).toEqual(result.symbols)
})

test('overloads deduplicate without conflating distinct members or scopes', () => {
    const result = parseIndexedFile({filePath: 'overloads.ts', content: `
export function run(x: string): string;
export function run(x: number): number;
export function run(x: unknown) { return x }
class C {
  static run() {}
  run(x: string): string;
  run(x: unknown) { return x }
  get value() { return 1 }
  set value(x: number) {}
}
`})
    expect(result.symbols.filter(s => s.name === 'run' && !s.containerName).length).toBe(1)
    const methods = result.symbols.filter(s => s.name === 'run' && s.containerName === 'C')
    expect(methods.length).toBe(2)
    expect(methods.filter(s => s.metadata?.static === true).length).toBe(1)
    expect(result.symbols.filter(s => s.name === 'value').map(s => s.kind)).toEqual(['getter', 'setter'])
})

test('TS abstract members, parameter properties, accessors and private keys are structural symbols', () => {
    const result = parseIndexedFile({filePath: 'members.ts', content: `
abstract class C {
  abstract run(): void;
  abstract count: number;
  abstract accessor size: number;
  constructor(public readonly id: string) {}
  accessor value = 1;
  #value = 2;
  ['literal']() {}
  [dynamic]() {}
}
`})
    const members = result.symbols.filter(s => s.containerName === 'C')
    expect(members.map(s => s.name)).toEqual(['run', 'count', 'size', 'constructor', 'id', 'value', '#value', 'literal', '[dynamic]'])
    expect(members.find(s => s.name === 'id')?.kind).toBe('property')
})

test('object members and local export aliases retain their actual ownership', () => {
    const result = parseIndexedFile({filePath: 'objects.js', content: `
const obj = { field: 1, get value() { return 1 }, set value(x) {}, method() { const local = 1 }, nested: { field: 2 } };
const {field: alias} = obj;
function local() {}
export {local, obj as publicObject};
export default () => { function inner() {} };
`})
    expect(result.symbols.filter(s => s.containerName === 'obj').map(s => [s.kind, s.name])).toEqual([['property', 'field'], ['getter', 'value'], ['setter', 'value'], ['method', 'method'], ['property', 'nested']])
    expect(result.symbols.find(s => s.name === 'local' && s.kind === 'constant')?.containerName).toBe('obj.method')
    expect(result.symbols.find(s => s.name === 'field' && s.containerName === 'obj.nested')?.kind).toBe('property')
    expect(result.symbols.find(s => s.name === 'alias')?.kind).toBe('constant')
    expect(result.symbols.find(s => s.name === 'local' && s.kind === 'function')?.exported).toBe(true)
    expect(result.symbols.find(s => s.name === 'obj')?.exported).toBe(true)
    expect(result.symbols.find(s => s.name === 'inner')?.containerName).toBe('default')
})

test('import facts deduplicate and constructor calls stay syntactic candidates', () => {
    const result = parseIndexedFile({filePath: 'facts.ts', content: `
import type {T} from './dep';
export {value} from './dep';
import Alias = require('./legacy');
const lazy = import('./lazy');
new Client(); client?.run(); client['stop'](); client.run();
const fake = 'invented()'; type Fn = () => void;
`})
    expect(result.facts.filter(f => f.predicate === 'imports').map(f => f.objectText)).toEqual(['./dep', './legacy', './lazy'])
    const calls = result.facts.filter(f => f.predicate === 'calls')
    expect(calls.map(f => f.objectText)).toEqual(['Client', 'run', 'stop'])
    expect(calls.every(f => f.confidence < 1)).toBeTruthy()
})

test('all JS and TS grammars preserve UTF-16 name positions and source ordering', () => {
    for (const extension of ['ts', 'mts', 'cts', 'tsx', 'mtsx', 'ctsx', 'js', 'mjs', 'cjs', 'jsx']) {
        const jsx = extension.endsWith('sx')
        const content = `const emoji = "😀";\r\nexport class Café { élève() { return ${jsx ? '<div />' : '1'} } }`
        const result = parseIndexedFile({filePath: `sample.${extension}`, content})
        expect(result.metadata.parseErrors, extension).toBe(undefined)
        const klass = result.symbols.find(s => s.name === 'Café')!
        const method = result.symbols.find(s => s.name === 'élève')!
        expect([klass.line, klass.column], extension).toEqual([2, 14])
        expect([method.line, method.column], extension).toEqual([2, 21])
        expect(result.symbols.every((s, i, all) => i === 0 || s.line! > all[i - 1].line! ||
            (s.line === all[i - 1].line && s.column! >= all[i - 1].column!)), extension).toBeTruthy()
    }
})

test('JS comments preserve multiline note positions and ignore textual lookalikes', () => {
    const result = parseIndexedFile({filePath: 'notes.js', content: `const text = '// TODO: fake';\r\n/**\r\n * TODO: real\r\n * NOTE: second\r\n */\r\n// FIXME: last\r\n`})
    expect(result.notes.map(n => [n.noteType, n.body, n.line])).toEqual([['TODO', 'real', 3], ['NOTE', 'second', 4], ['FIXME', 'last', 6]])
})

test('anonymous lexical scopes do not collapse distinct bindings or object members', () => {
    const content = `function outer() {
  { const local = 1 }
  { const local = 2 }
  tasks.map(() => { const value = 1 });
  tasks.map(() => { const value = 2 });
}
const values = [{key: 1}, {key: 2}];`
    const parse = (source: string) => parseIndexedFile({filePath: 'scopes.ts', content: source})
    const result = parse(content)
    for (const name of ['local', 'value', 'key']) {
        const matches = result.symbols.filter(s => s.name === name)
        expect(matches.length, name).toBe(2)
        expect(new Set(matches.map(s => s.containerName)).size, name).toBe(2)
    }
    const identities = (source: string) => parse(source).symbols.map(s => [s.containerName, s.kind, s.name])
    expect(identities('// new line\n' + content)).toEqual(identities(content))
})

test('component script symbols and notes use host positions consistently', () => {
    const content = `<template/>\n<script>\nexport function first() {}\n// TODO: first note\n</script>\n<script lang="ts">\nexport class Second { value: number }\n// NOTE: second note\n</script>`
    const result = parseIndexedFile({filePath: 'view.vue', content})
    expect(result.symbols.map(s => [s.name, s.line, s.metadata?.declarationLine])).toEqual([['first', 3, 3], ['Second', 7, 7], ['value', 7, 7]])
    expect(result.notes.map(n => [n.noteType, n.line])).toEqual([['TODO', 4], ['NOTE', 8]])
})

test('JS multiline notes follow CR-only and Unicode line terminators', () => {
    for (const separator of ['\r', '\u2028', '\u2029']) {
        const result = parseIndexedFile({filePath: 'notes.js', content: ['/*', ' TODO: first', ' NOTE: second', '*/'].join(separator)})
        expect(result.notes.map(n => [n.body, n.line])).toEqual([['first', 2], ['second', 3]])
    }
})
