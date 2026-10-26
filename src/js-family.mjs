/**
 * JS/TS structural extraction through the TypeScript compiler AST.
 * Call facts are syntactic candidates, not resolved cross-file references.
 */
import ts from 'typescript'
import {findNotesFuzzily} from './shared.mjs'

const exported = node => !!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
const defaulted = node => !!node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)
const nameOf = name => name && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) ? name.text : undefined

export function parseJsFamily({filePath, content, language}) {
  const kind = ['tsx', 'jsx', 'mtsx', 'ctsx'].includes(language) ? ts.ScriptKind.TSX
    : ['js', 'mjs', 'cjs'].includes(language) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind)
  const symbols = [], imports = [], calls = new Set(), seen = new Set()
  const add = (node, type, name, containerName, isExported, nameNode = node.name) => {
    if (!name) return
    const key = `${containerName ?? ''}:${type}:${name}`
    if (seen.has(key)) return
    seen.add(key)
    const position = source.getLineAndCharacterOfPosition((nameNode ?? node).getStart(source))
    const line = position.line + 1, column = position.character + 1
    symbols.push({name, kind: type, ...(containerName ? {containerName} : {}), exported: isExported,
      line, column, metadata: {signature: source.text.split('\n')[position.line]?.trim() ?? '', declarationLine: line}})
  }
  const visit = (node, container) => {
    let nextContainer = container
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        imports.push(node.arguments[0].text)
      const callee = ts.isIdentifier(node.expression) ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined
      if (callee) calls.add(callee)
    }
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const name = nameOf(node.name) ?? (defaulted(node) ? 'default' : undefined)
      const type = ts.isClassDeclaration(node) ? 'class' : ts.isInterfaceDeclaration(node) ? 'interface'
        : ts.isEnumDeclaration(node) ? 'enum' : 'type'
      add(node, type, name, container, exported(node) || defaulted(node), node.name ?? node)
      if (name) nextContainer = name
    } else if (ts.isFunctionDeclaration(node)) {
      const name = nameOf(node.name) ?? (defaulted(node) ? 'default' : undefined)
      add(node, 'function', name, container, exported(node) || defaulted(node), node.name ?? node)
      if (name) nextContainer = name
    } else if (ts.isVariableDeclaration(node) && ts.isVariableStatement(node.parent.parent)
      && (ts.isSourceFile(node.parent.parent.parent) || ts.isModuleBlock(node.parent.parent.parent))) {
      const name = nameOf(node.name)
      const kind = node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? 'function-value' : 'variable'
      add(node, kind, name, container, exported(node.parent.parent), node.name)
    } else if (container && (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)
      || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node))) {
      add(node, 'method', nameOf(node.name), container, exported(node), node.name)
    } else if (container && (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node))) {
      add(node, 'property', nameOf(node.name), container, exported(node), node.name)
    } else if (container && ts.isConstructorDeclaration(node)) {
      add(node, 'constructor', 'constructor', container, false, node)
    } else if (container && ts.isEnumMember(node)) {
      add(node, 'enum-member', nameOf(node.name), container, false, node.name)
    }
    ts.forEachChild(node, child => visit(child, nextContainer))
  }
  visit(source)
  symbols.sort((a, b) => a.line - b.line || a.column - b.column)
  return {language, fileKind:'code', symbols,
    facts: [...imports.map(objectText => ({predicate:'imports',objectText,confidence:1})),
      ...[...calls].map(objectText => ({predicate:'calls',objectText,confidence:0.52}))],
    notes: extractJsNotes(content, filePath), metadata:{importCount:imports.length,symbolCount:symbols.length,approximateCallCount:calls.size},
    searchText:[content,...imports,...symbols.map(s => s.name)].join('\n')}
}

function extractJsNotes(source, filePath) {
  const comments = [];
  let index = 0;
  let mode = "code";

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (mode === "code") {
      if (current === "'" || current === "\"" || current === "`") {
        mode = current;
        index += 1;
        continue;
      }
      if (current === "/" && next === "/") {
        const start = index;
        index += 2;
        let body = "";
        while (index < source.length && source[index] !== "\n") {
          body += source[index];
          index += 1;
        }
        comments.push({ body, index: start });
        continue;
      }
      if (current === "/" && next === "*") {
        const start = index;
        index += 2;
        let body = "";
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
          body += source[index];
          index += 1;
        }
        index += 2;
        comments.push({ body, index: start });
        continue;
      }
      index += 1;
      continue;
    }

    if (current === "\\") {
      index += 2;
      continue;
    }

    if (current === mode) {
      mode = "code";
    }
    index += 1;
  }

  return comments
    .flatMap((comment) => {
      const location = countLineColumn(source, comment.index);
      return findNotesFuzzily(comment.body.replace(/^\*\s*/gm, "").trim())
        .map(found => ({
          noteType: found.type,
          body: found.body,
          filePath,
          line: location.line + (found.line - 1),
          column: location.column
        }));
    });
}
