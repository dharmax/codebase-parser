import assert from 'node:assert/strict'
import {test} from 'bun:test'
import {parseIndexedFile} from '../src/index.js'

test('parseMarkdownFile recognizes shared standalone note markers', () => {
    const result = parseIndexedFile({
        filePath: 'docs/notes.md',
        content: '# Notes\n\nTODO: write tests\nFIXME: resolve memory leak\n',
    })
    assert.equal(result.language, 'markdown')
    assert.equal(result.notes.length, 2)
    assert.equal(result.notes[0].noteType, 'TODO')
    assert.equal(result.notes[1].noteType, 'FIXME')
})

test('parseJsFamily records anonymous default exports and typescript mts extensions', () => {
    const result = parseIndexedFile({
        filePath: 'src/module.mts',
        content: 'import { foo } from "./foo.mts"\n\nexport default function () { return 42 }\nexport const bar = () => "bar"',
    })
    assert.equal(result.language, 'mts')
    assert.equal(result.symbols.length, 2)
    assert.equal(result.symbols[0].name, 'default')
    assert.equal(result.symbols[1].name, 'bar')
    assert.equal(result.facts.some(f => f.predicate === 'imports' && f.objectText === './foo.mts'), true)
})

test('parseRiot merges every script and style block', () => {
    const result = parseIndexedFile({
        filePath: 'components/my-tag.riot',
        content: '<my-tag><p>hello</p><script>export default { onMounted() {} }</script><style>p { color: red; }</style></my-tag>',
    })
    assert.equal(result.language, 'riot')
    assert.equal(result.symbols.length > 0, true)
})

test('parsePython extracts imports, functions, classes, and comments', () => {
    const result = parseIndexedFile({
        filePath: 'app/server.py',
        content: `import os\nfrom math import sqrt\n\n# TODO: optimize handler\ndef handle_request(req):\n    return calculate(req)\n\nclass ServerRunner:\n    pass\n`,
    })
    assert.equal(result.language, 'python')
    assert.equal(result.symbols.length, 2)
    assert.equal(result.symbols[0].name, 'handle_request')
    assert.equal(result.symbols[1].name, 'ServerRunner')
    assert.equal(result.notes.length, 1)
    assert.equal(result.notes[0].noteType, 'TODO')
    assert.equal(result.facts.some(f => f.predicate === 'imports' && f.objectText === 'os'), true)
})

test('parseRust extracts use imports, pub fn, and structs', () => {
    const result = parseIndexedFile({
        filePath: 'src/lib.rs',
        content: `use std::sync::Arc;\n\n// NOTE: thread safe\npub fn run_worker() {\n    do_work();\n}\n\npub struct WorkerConfig;\n`,
    })
    assert.equal(result.language, 'rust')
    assert.equal(result.symbols.length, 2)
    assert.equal(result.symbols[0].name, 'run_worker')
    assert.equal(result.symbols[1].name, 'WorkerConfig')
    assert.equal(result.notes[0].noteType, 'NOTE')
})

test('parseGo extracts functions and types', () => {
    const result = parseIndexedFile({
        filePath: 'main.go',
        content: `package main\n\nimport "fmt"\n\nfunc StartServer() {\n    fmt.Println("start")\n}\n\ntype Config struct{}\n`,
    })
    assert.equal(result.language, 'go')
    assert.equal(result.symbols.length, 2)
    assert.equal(result.symbols[0].name, 'StartServer')
    assert.equal(result.symbols[1].name, 'Config')
})

test('parseShell extracts function names and notes', () => {
    const result = parseIndexedFile({
        filePath: 'scripts/deploy.sh',
        content: `#!/bin/bash\n# TODO: add error handling\nfunction deploy_app() {\n    echo "deploying"\n}\n`,
    })
    assert.equal(result.language, 'shell')
    assert.equal(result.symbols.length, 1)
    assert.equal(result.symbols[0].name, 'deploy_app')
    assert.equal(result.notes[0].noteType, 'TODO')
})

test('JS/TS AST ignores declaration-like text, regexes and type-only syntax as calls', () => {
    const result = parseIndexedFile({filePath: 'sample.ts', content: `
const text = "export function fake() {} // TODO: not a note";
const pattern = /function ghost() {}/;
// TODO: keep this actual comment
export function real<T>(value: T): T { return transform<T>(value); }
interface Shape { render(): void; }
`})
    assert.deepEqual(result.symbols.map(s => s.name), ['text', 'pattern', 'real', 'Shape', 'render'])
    assert.deepEqual(result.facts.filter(f => f.predicate === 'calls').map(f => f.objectText), ['transform'])
    assert.equal(result.notes.length, 1)
    assert.equal(result.notes[0].line, 4)
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
        assert.ok(symbols.some(s => s.name === name), name)
    assert.equal(symbols.find(s => s.name === 'method')?.containerName, 'Box')
    assert.equal(symbols.find(s => s.name === 'Box')?.exported, true)
    assert.equal(symbols.filter(s => s.name === 'current').length, 2)
    assert.deepEqual(result.facts.filter(f => f.predicate === 'imports').map(f => f.objectText), ['./types', './other', './lazy'])
    assert.deepEqual(result.facts.filter(f => f.predicate === 'calls').map(f => f.objectText), ['run', 'consume'])
    assert.ok(symbols.every((s, i) => i === 0 || (s.line ?? 0) >= (symbols[i - 1].line ?? 0)))
})

test('JS/TS AST selects JSX grammar and parses template-expression calls and real comments', () => {
    const result = parseIndexedFile({filePath: 'view.tsx', content: `
export const View = () => <main title="function fake() {}">{format(value)}</main>;
const template = \`literal TODO: not a comment \${render(value)}\`;
/* NOTE: actual block comment */
`})
    assert.deepEqual(result.symbols.map(s => s.name), ['View', 'template'])
    assert.deepEqual(result.facts.filter(f => f.predicate === 'calls').map(f => f.objectText), ['format', 'render'])
    assert.equal(result.notes[0].noteType, 'NOTE')
    assert.equal(result.notes[0].line, 4)
})
