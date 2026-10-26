import assert from 'node:assert/strict'
import {test} from 'bun:test'
import {parseIndexedFile} from '../src/index.mjs'

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
