# @dharmax/codebase-parser

Universal, lightweight, and fast multi-language codebase parser for extracting symbols, imports, facts, and code notes for LLM context engines.

```
Source Code  →  parseIndexedFile()  →  { symbols, imports, facts, notes, searchText }
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
# npm
npm install @dharmax/codebase-parser

# bun
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

console.log(result.symbols)
// [ { name: 'startServer', kind: 'function', exported: true, line: 5, column: 1 } ]

console.log(result.facts)
// [ { predicate: 'imports', objectText: 'express', confidence: 1 } ]

console.log(result.notes)
// [ { noteType: 'TODO', body: 'add rate limiting', line: 4 } ]
```

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

Source and tests use TypeScript. Bun manages dependencies, runs tests against source, and bundles the Node-compatible ESM package. TypeScript 7 checks types and generates declarations in `dist/`. Commit `bun.lock` when dependencies change.

JavaScript and TypeScript parsing uses [Oxc](https://oxc.rs/docs/guide/usage/parser), declared as the runtime dependency `oxc-parser`. Symbols and call/import facts come from its AST; notes come from parser-owned comments. Other language parsers retain their existing heuristic implementation.

---

## License

MIT © [dharmax](https://github.com/dharmax)
