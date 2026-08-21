import path from 'node:path'
import {parseJsonFile, parseMarkdownFile, parseYamlFile} from './data-files.mjs'
import {parseJsFamily} from './js-family.mjs'
import {parseHtml, parseRiot} from './markup.mjs'
import {parseGo, parsePython, parseRust, parseShell} from './polyglot.mjs'
import {parseStyles} from './styles.mjs'

export function parseIndexedFile({filePath, content}) {
    const extension = path.extname(filePath).toLowerCase()

    if (['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.mtsx', '.ctsx'].includes(extension))
        return parseJsFamily({filePath, content, language: extension.slice(1)})

    if (['.css', '.scss', '.sass', '.less', '.styl'].includes(extension))
        return parseStyles({filePath, content, language: extension.slice(1)})

    if (extension === '.html' || extension === '.htm')
        return parseHtml({filePath, content, language: 'html'})

    if (extension === '.riot' || extension === '.vue' || extension === '.svelte')
        return parseRiot({filePath, content})

    if (extension === '.json' || extension === '.json5')
        return parseJsonFile({filePath, content})

    if (extension === '.yaml' || extension === '.yml' || extension === '.toml')
        return parseYamlFile({filePath, content, language: extension.slice(1)})

    if (extension === '.md' || extension === '.markdown' || extension === '.mdx')
        return parseMarkdownFile({filePath, content})

    if (extension === '.py')
        return parsePython({filePath, content})

    if (extension === '.rs')
        return parseRust({filePath, content})

    if (extension === '.go')
        return parseGo({filePath, content})

    if (['.sh', '.bash', '.zsh'].includes(extension))
        return parseShell({filePath, content})

    return {
        language: 'unknown',
        fileKind: 'unknown',
        symbols: [],
        facts: [],
        notes: [],
        metadata: {},
        searchText: content,
    }
}
