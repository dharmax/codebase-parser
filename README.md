# @dharmax/codebase-parser

Multi-language codebase parser for extracting symbols, imports, facts, and code notes for LLM context engines. JavaScript/TypeScript extraction uses the TypeScript compiler AST (including member/property declarations); other languages may use lightweight heuristics. Call facts are syntactic candidates, not precise caller/callee edges; use a language server for exact references.

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

## Testing

```sh
# Node
npm test

# Bun
bun test tests/parser.test.mjs
```

---

## License

MIT © [dharmax](https://github.com/dharmax)
