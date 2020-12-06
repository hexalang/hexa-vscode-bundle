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
}
