# @dharmax/codebase-parser

Multi-language codebase parser for extracting symbols, imports, facts, and code notes for LLM context engines. JavaScript/TypeScript extraction uses the Oxc AST (including member/property declarations); other languages may use lightweight heuristics. Call facts are syntactic candidates, not precise caller/callee edges; use a language server for exact references.

```
Source Code  →  parseIndexedFile()  →  { language, fileKind, symbols, facts, notes, metadata, searchText }
```

---

## Supported Languages & Formats

* **JavaScript / TypeScript**: `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.tsx`, `.mts`, `.cts`, `.mtsx`, `.ctsx`
* **Python**: `.py` (functions, classes, imports, `# TODO` / `# NOTE`)
* **Rust**: `.rs` (`pub fn`, `struct`, `enum`, `trait`, `use` imports)
* **Go**: `.go` (`func`, `type struct`, `type interface`, `import`)
* **Shell Scripts**: `.sh`, `.bash`, `.zsh` (functions, notes)
* **UI & Components**: `.html`, `.riot`, `.vue`, `.svelte`
* **Styles**: `.css`, `.scss`, `.sass`, `.less`, `.styl`
* **Data & Config**: `.json`, `.json5`, `.yaml`, `.yml`, `.toml`
* **Docs & Markdown**: `.md`, `.markdown`, `.mdx`

---

## Installation

```sh
bun add @dharmax/codebase-parser
```

---

## Usage

```ts
import { parseIndexedFile } from '@dharmax/codebase-parser'

const result = parseIndexedFile({
    filePath: 'src/server.ts',
    content: `
import express from 'express'

// TODO: add rate limiting
export function startServer(port: number) {
    const app = express()
    app.listen(port)
}
    `,
})

console.log(result.symbols.map(({name, kind}) => ({name, kind})))
// [{name: 'startServer', kind: 'function'}, {name: 'app', kind: 'constant'}]

console.log(result.facts)
// [{predicate: 'imports', objectText: 'express', confidence: 1},
//  {predicate: 'calls', objectText: 'express', confidence: 0.52},
//  {predicate: 'calls', objectText: 'listen', confidence: 0.52}]

console.log(result.notes.map(({noteType, body, line}) => ({noteType, body, line})))
// [{noteType: 'TODO', body: 'add rate limiting', line: 4}]
```

JS/TS symbol positions are one-based UTF-16 name positions. `containerName` is the qualified lexical owner, such as `Space.Box.run`. Overloads share a symbol; getters, setters, and static/instance members remain distinct (`metadata.static` identifies static members). Anonymous scopes use ordinals within their parent. These structural identities survive whitespace and comment edits; changing anonymous sibling structure can change ordinals. Persistent IDs belong to the consumer.

Import facts record unique syntactic dependencies, including type-only imports, reexports, and literal dynamic imports. Call facts record unique syntactic callee names, including constructors, with the established candidate confidence of `0.52`.

---

## Integration with `@dharmax/llm-utils` & `@dharmax/context-manager`

Use `codebase-parser` to extract code symbols, AST facts, and `# TODO` / `// NOTE` annotations to inject high-density structured code context into LLM prompts.

---

## Development

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
bun run build
```

This is a Bun/TypeScript library. The package exports its TypeScript source directly. Bun manages dependencies, runs tests, and builds a Bun bundle in `dist/`; TypeScript 7 checks source and tests. Commit `bun.lock` when dependencies change.

JavaScript and TypeScript parsing uses [Oxc](https://oxc.rs/docs/guide/usage/parser), declared as the runtime dependency `oxc-parser`. Symbols and call/import facts come from its AST; notes come from parser-owned comments. Other language parsers retain their existing heuristic implementation.

---

## License

MIT © [dharmax](https://github.com/dharmax)
