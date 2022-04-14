"use strict"

const vscode = require('vscode')
const HexaLinter = require('./hexa-linter')

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
    workspace.onDidChangeTextDocument((document) => { linter.lintChange(document) })

    // Discard cache
    workspace.onDidDeleteFiles((event) => { linter.onDidDeleteFiles(event) })
    workspace.onDidCloseTextDocument((document) => { linter.onDidCloseTextDocument(document) })
    workspace.onDidRenameFiles((event) => { linter.onDidRenameFiles(event) })

    const sel = { scheme: 'file', language: 'hexa' }

    class HexaConfigDocumentSymbolProvider {
        provideDocumentSymbols(
            document, // vscode.TextDocument
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

    const providerSymbol = vscode.languages.registerDocumentSymbolProvider(
        sel,
        new HexaConfigDocumentSymbolProvider()
    )

    context.subscriptions.push(
        provider2,
        provider1,
        providerSymbol
    )
}
