// PeyTy (c) 2023
"use strict"

// Used for TypeScript JSDoc @types
const vscode = require('vscode')
const {
    HoverProvider,
    Hover
} = require('vscode')

const HexaLinter = require('./hexa-linter')
const options = HexaLinter.options

const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const onDidChangeTextDocuments = []
const onDidChangeTextDocumentDelay = 444
let onDidChangeTextDocumentLast = 0
let onDidChangeTextDocumentTimer = 0
const onDidChangeTextDocument = (document, linter) => {
    if (!onDidChangeTextDocuments.includes(document)) {
        onDidChangeTextDocuments.push(document)
        // TODO dot Array.pushIfNotIncludes
    }

    const now = Date.now()
    const ready = (now - onDidChangeTextDocumentLast) >= onDidChangeTextDocumentDelay
    onDidChangeTextDocumentLast = now

    if (ready && !linter.busy) {
        while (onDidChangeTextDocuments.length > 0) {
            const document = onDidChangeTextDocuments.pop()
            linter.lintChangedDocument(document)
        }
    } else {
        clearTimeout(onDidChangeTextDocumentTimer)
        onDidChangeTextDocumentTimer = setTimeout(() => onDidChangeTextDocument(document, linter), onDidChangeTextDocumentDelay + 5)
    }
}

exports.activate = function (context) {
    const diagnostics = vscode.languages.createDiagnosticCollection('hexa')
    context.subscriptions.push(diagnostics)
    const linter = new HexaLinter(diagnostics)

    console.log("[Hexa-Lint] Initialized.")

    const workspace = vscode.workspace
    workspace.onDidChangeConfiguration(config => { linter.updateConfig(config) })
    workspace.textDocuments.forEach((document) => { linter.lint(document) })
    workspace.onDidOpenTextDocument((document) => { linter.lint(document) })
    workspace.onDidSaveTextDocument((document) => { linter.lint(document) })
    workspace.onDidChangeTextDocument((documentChange) => { onDidChangeTextDocument(documentChange.document, linter) })

    // Discard cache
    workspace.onDidDeleteFiles((event) => { linter.onDidDeleteFiles(event) })
    workspace.onDidCloseTextDocument((document) => { linter.onDidCloseTextDocument(document) })
    workspace.onDidRenameFiles((event) => { linter.onDidRenameFiles(event) })

    const sel = { scheme: 'file', language: 'hexa' }

    const provider1 = vscode.languages.registerCompletionItemProvider(
        sel,
        {
            provideCompletionItems(document, position, token, context) {
                const fsPath = document.uri.fsPath

                return new Promise((resolve, reject) => {
                    // TODO move to separate file or HexaLinter
                    const commandCompletionItemProvider = {
                        kind: 'CompletionItemProvider',
                        payload: {
                            fsPath
                        }
                    }

                    const commands = [commandCompletionItemProvider]

                    const req = http.request(options, res => {
                        const chunks = []

                        res.on('data', chunk => {
                            chunks.push(chunk)
                        })

                        res.on('end', () => {
                            let json = []
                            const sourceJson = Buffer.concat(chunks).toString()
                            try {
                                json = JSON.parse(sourceJson)
                            } catch (e) {
                                console.error(e)
                                console.error('sourceJson:', sourceJson)
                                reject()
                            }

                            resolve(json[0][0].map(complete => {
                                const item = new vscode.CompletionItem(complete.name, complete.kind)

                                if (complete.imported == '') {
                                    item.documentation = 'Exported from the current module'
                                    item.sortText = 'a'
                                } else if (complete.imported == '*') {
                                    item.documentation = 'Imported globally'
                                    item.sortText = 'c'
                                } else {
                                    const fileUrl = url.pathToFileURL(complete.file).href
                                    item.documentation = 'Imported from [`' + complete.imported + '`](' + fileUrl + ')'
                                    item.sortText = 'b'
                                }

                                item.documentation = new vscode.MarkdownString(
                                    '```hexa\n' + complete.detail + '\n```\n\n' +
                                    item.documentation
                                )
                                return item
                            }))
                        })
                    })

                    req.on('error', error => {
                        console.error(error)
                        console.error('Cannot get json: ' + error.message)
                        linter.startServer()
                        reject()
                    })

                    req.write(JSON.stringify(commands))
                    req.end()
                })
            }
        }
    )

    class HexaConfigDocumentSymbolProvider {
        /**
        * @param {vscode.TextDocument} document
        */
        provideDocumentSymbols(
            document,
            token // vscode.CancellationToken
        )
        // Promise<vscode.DocumentSymbol[]>
        {
            return new Promise((resolve, reject) => {
                let symbols = []
                var re = new RegExp("([a-z]+) ([A-z]+)")
                let children = null
                for (var i = 0; i < document.lineCount; i++) {
                    var line = document.lineAt(i)
                    var text = line.text.trim()
                    if (
                        ["class ", "enum ", "var ", "let ", "fun "].some(_ => text.startsWith(_))
                    ) {
                        let isType = text.startsWith("class ") || text.startsWith("enum ")
                        if (isType) {
                            children = []
                        }

                        let symbol = new vscode.DocumentSymbol(
                            re.exec(text)[2],
                            re.exec(text)[1],
                            {
                                'class': vscode.SymbolKind.Class,
                                'enum': vscode.SymbolKind.Enum,
                                'var': vscode.SymbolKind.Variable,
                                'let': vscode.SymbolKind.Constant,
                                'fun': vscode.SymbolKind.Function,
                            }[re.exec(text)[1]] ?? vscode.SymbolKind.Function,
                            line.range,
                            line.range
                        )

                        symbol.children = isType ? children : []

                        if (children && !isType) {
                            children.push(symbol)
                        } else {
                            symbols.push(symbol)
                        }
                    }
                }
                resolve(symbols)
            })
        }
    }

    // TODO reuse last success result
    // TODO what to with unsaved files without fsPath?
    /** @implements {vscode.DocumentSymbolProvider} */
    class HexaDocumentSymbolProvider {
        // Cache as string, not JSON, to use less memory
        cache = new Map()
        // TODO implement cache on the server side
        // ^ autocomplete by latest successful parsing

        jsonToSymbol(symbol) {
            const range = new vscode.Range(
                new vscode.Position(symbol.range.line, symbol.range.start),
                new vscode.Position(symbol.range.line, symbol.range.end)
            )
            return new vscode.DocumentSymbol(
                symbol.name,
                symbol.detail,
                symbol.kind,
                range,
                range
            )
        }

        /**
        * @param {vscode.TextDocument} document
        */
        provideDocumentSymbols(
            document,
            token // vscode.CancellationToken
        )
        // Promise<vscode.DocumentSymbol[]>
        {
            const reuse = false
            const commands = reuse ? [] : [linter.documentSymbolProvider(document.uri.fsPath)]
            return new Promise((resolve, reject) => {
                linter.request(commands,
                    onJSON => {
                        if (onJSON[0].fail) {
                            // TODO reuse & SyncFileContents
                            resolve([])
                        } else {
                            const symbols = onJSON[0].map(symbol => {
                                const result = this.jsonToSymbol(symbol)

                                if (symbol.children && symbol.children.length > 0) {
                                    symbol.children.forEach(child => result.children.push(this.jsonToSymbol(child)))
                                }

                                return result
                            })
                            resolve(symbols)
                        }
                    },
                    onError => {
                        // TODO reuse
                        resolve([])
                    })
            })
        }
    }

    const providerSymbol = vscode.languages.registerDocumentSymbolProvider(
        sel,
        new HexaDocumentSymbolProvider(),
        { label: 'Hexa' }
    )

    /** @implements {HoverProvider} */
    class HexaHoverProvider {
        /**
        * @param {vscode.TextDocument} document
        */
        provideHover(document, position, token) {
            const commands = [linter.hoverProvider(document.uri.fsPath, position.line, position.character)]

            return new Promise((resolve, reject) => {
                linter.request(commands,
                    onJSON => {
                        const code = onJSON[0][0].code
                        if (code && code.length > 0) {
                            const hover = new vscode.MarkdownString()
                            hover.appendCodeblock(code, 'hexa')
                            const doc = onJSON[0][0].markdown
                            if (doc && doc.length > 0) {
                                hover.appendMarkdown('---')
                                hover.appendMarkdown(doc)
                            }
                            resolve(new Hover(hover))
                        }
                        reject()
                    },
                    onError => {
                        reject()
                    }
                )
            })
        }
    }

    // TODO go to def Ctrl+LMB / F12

    const providerHover = vscode.languages.registerHoverProvider(
        sel,
        new HexaHoverProvider()
    )

    context.subscriptions.push(
        provider1, // TODO rename
        providerHover,
        providerSymbol
    )
}
