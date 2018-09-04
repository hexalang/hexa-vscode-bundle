const vscode = require('vscode')
const HexaLinter = require('./hexa-linter')

exports.activate = function (context) {
    const diagnostics = vscode.languages.createDiagnosticCollection('hexa')
    context.subscriptions.push(diagnostics)
    const linter = new HexaLinter(diagnostics)

    console.log("[Hexa-Lint] Initialized.")

    const workspace = vscode.workspace
    workspace.onDidChangeConfiguration(linter.updateConfig())
    workspace.textDocuments.forEach((document) => { linter.lint(document) })
    workspace.onDidOpenTextDocument((document) => { linter.lint(document) })
    workspace.onDidSaveTextDocument((document) => { linter.lint(document) })
    workspace.onDidCloseTextDocument((document) => { linter.clear(document) })
    workspace.onDidChangeTextDocument((document) => { linter.lint(document) })
}
