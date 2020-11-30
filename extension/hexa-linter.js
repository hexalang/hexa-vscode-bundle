const childProcess = require('child_process')
const vscode = require('vscode')


function getWord(line, col) {
    let subline = line.substr(col, line.length - col);

    let word = subline.split("(")[0].split(" ")[0].split(",")[0].split(")")[0].split(".")[0]

    return word;
}

class HexaLinter {
    constructor(diagnostics) {
        this.diagnostics = diagnostics
        this.updateConfig()
    }

    lintChange(documentChange) {
        const document = documentChange.document
        if (document.languageId !== 'hexa' || document.isUntitled || document.uri.scheme !== 'file') {
            return
        }

    }

    lint(document) {
        if (document.languageId !== 'hexa' || document.isUntitled || document.uri.scheme !== 'file') {
            return
        }
        console.log("[Hexa-Lint] Started.")

        // Path check
        let path = this.config.get('path', '')
        if (path === '') {
            vscode.window.showErrorMessage('hexa-lint path is not specified')
            return
        }

        // Asynchronously run Hexa syntax linter
        let linter = childProcess.exec(
            `${path} --syntax-linter ${document.fileName}`,
            { 'cwd': vscode.workspace.rootPath } // Current working directory
        )
        console.log("[Hexa-Lint] Compiler executed.")
        this.diagnostics.delete(document.uri)

        let eventHandler = (data) => {
            console.log("[Hexa-Lint] Handled data.", data)

            let msgs = data.split("\n");
            console.log(`[Hexa-Lint] Got ${msgs.length} data lines.`)

            // Parse the report
            let entries = []
            // Parse offenses for the file
            let diagnostics = []
            for (const msg of msgs) {
                if (!msg.startsWith("["))
                    continue

                try {
                    let match = msg.match(/\[(.*):([-0-9]+):([-0-9]+)\]:(.*)$/)

                    if (match == null) {
                        console.log(`[Hexa-Lint] Can not parse message '${msg}'.`)
                        continue
                    }

                    let parsed = {
                        filename: match[1],
                        line: Number(match[2]) - 1,
                        col: Number(match[3]), // FIXME // TODO
                        msgtext: match[4]
                    }

                    console.log(`[Hexa-Lint] Compiler message parsed successfully.`, parsed)

                    let lineindoc = document.lineAt(parsed.line);

                    console.log(`[Hexa-Lint] Got needed line from document.`, lineindoc)

                    let errorWord = getWord(lineindoc.text, parsed.col);
                    console.log(`[Hexa-Lint] Word found.`, errorWord)

                    let range = new vscode.Range(
                        parsed.line, parsed.col,
                        parsed.line, parsed.col + errorWord.length
                    )
                    console.log(`Created range: `, range)

                    let diagnostic = new vscode.Diagnostic(range, parsed.msgtext, vscode.DiagnosticSeverity.Error)
                    diagnostics.push(diagnostic)
                }
                catch (err) {
                    console.log(err);
                }
            }
            console.log(`[Hexa-Lint] Got ${entries.length} entries of diagnostic.`)
            entries.push([document.uri, diagnostics])
            this.diagnostics.set(entries)
        }

        linter.stderr.on('data', eventHandler);

        // Wait for linter to return the report
        linter.stdout.on('data', eventHandler)
    }

    clear(document) {
        if (document.uri.scheme === 'file') {
            this.diagnostics.delete(document.uri)
        }
    }

    updateConfig(config) {
        this.config = vscode.workspace.getConfiguration('hexa')
        console.log("[Hexa-Lint] Configuration updated.")
    }
}

module.exports = HexaLinter
