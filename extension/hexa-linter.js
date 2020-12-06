const childProcess = require('child_process')
const vscode = require('vscode')

const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const port = 3978

const decorationType = vscode.window.createTextEditorDecorationType({ after: { margin: '0 0 0 1rem' } })

const options = {
    hostname: 'localhost',
    port,
    path: '/',
    method: 'POST',
    headers: {}
}

function getWord(line, col) {
    let subline = line.substr(col, line.length - col)

    let word = subline.split("(")[0].split(" ")[0].split(",")[0].split(")")[0].split(".")[0]

    return word
}

class HexaLinter {
    constructor(diagnostics) {
        this.diagnostics = diagnostics
        this.files = new Map() // TODO group per-project (reported by server)
        this.updateConfig()
    }

    lintChange(documentChange) {
        const document = documentChange.document
        this.lintDocument(document)
    }

    discard(fsPath) {
        const commandDiscardFileContents = {
            kind: 'DiscardFileContents',
            payload: { fsPath }
        }

        const commands = [commandDiscardFileContents]

        const req = http.request(options, res => {
        })

        req.on('error', error => {
            console.error(error)
            console.error('Cannot get json: ' + error.message)
        })

        req.write(JSON.stringify(commands))
        req.end()

        // TODO this.files.delete
    }

    onDidRenameFiles(event) {
        for (const file of event.files) {
            this.discard(file.oldUri.fsPath)
        }
    }

    onDidCloseTextDocument(document) {
        if (document.languageId !== 'hexa' || document.isUntitled || document.uri.scheme !== 'file') {
            return
        }

        this.clear(document)
        this.discard(document.uri.fsPath)
    }

    onDidDeleteFiles(event) {
        for (const uri of event.files) {
            this.discard(uri.fsPath)
        }
    }

    lintDocument(document) {
        if (document.languageId !== 'hexa' || document.isUntitled || document.uri.scheme !== 'file') {
            return
        }

        const fullText = document.getText()
        const fsPath = document.uri.fsPath

        const commandSyncFileContents = {
            kind: 'SyncFileContents',
            payload: {
                fsPath,
                content: fullText
            }
        }

        const commandAutocheckProject = {
            kind: 'AutocheckProject',
            payload: { fsPath }
        }

        const commands = [commandSyncFileContents, commandAutocheckProject]

        const req = http.request(options, res => {
            const chunks = [] // TODO use Buffer

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
                }

                {
                    // Parse the report
                    const map = new Map()
                    // Parse offenses for the file
                    const projectMessages = []

                    for (const msg of json[1]) {
                        try {
                            let info = map.get(msg.fileName)

                            if (msg.fileName.endsWith('hexa.json')) {
                                const fileName = path.resolve(msg.fileName)

                                if (projectMessages.includes(msg.details)) continue
                                projectMessages.push(msg.details)

                                const button = 'Open hexa.json'
                                vscode.window
                                    .showErrorMessage(msg.details, button)
                                    .then(selection => {
                                        if (selection == button) {
                                            var openPath = vscode.Uri.file(fileName)
                                            vscode.workspace.openTextDocument(openPath).then(doc => {
                                                vscode.window.showTextDocument(doc).then(editor => {
                                                })
                                            })
                                        }
                                    })

                                continue
                            }

                            if (info == null) {
                                const fileName = path.resolve(msg.fileName)

                                const editor = vscode.window.visibleTextEditors.filter(
                                    editor => path.resolve(editor.document.uri.fsPath) === fileName
                                )[0]

                                const document = editor ? editor.document : vscode.workspace.textDocuments.filter(
                                    document => path.resolve(document.fileName) === fileName
                                )[0]

                                if (editor == null && document == null) {
                                    let showAlert = true

                                    const basename = path.basename(fileName)
                                    const button = 'Open ' + basename
                                    const text = 'You have errors in the `' + basename + '`'
                                    if (projectMessages.includes(text)) {
                                        showAlert = false
                                    }
                                    projectMessages.push(text)

                                    if (showAlert) vscode.window
                                        .showWarningMessage(text, button)
                                        .then(selection => {
                                            if (selection == button) {
                                                var openPath = vscode.Uri.file(fileName)
                                                vscode.workspace.openTextDocument(openPath).then(doc => {
                                                    vscode.window.showTextDocument(doc).then(editor => {
                                                        this.lintDocument(doc)
                                                    })
                                                })
                                            }
                                        })

                                    continue
                                }

                                info = {
                                    document,
                                    editor,
                                    decorations: [],
                                    diagnostics: []
                                }

                                map.set(msg.fileName, info)

                            }

                            this.files.set(msg.fileName, info)

                            let parsed = {
                                line: msg.line - 1, //Number(match[2]) - 1,
                                col: msg.column, //Number(match[3]), // FIXME // TODO
                                msgtext: msg.details //match[4]
                            }

                            if (parsed.col < 0) parsed.col = 0
                            if (parsed.line < 0) parsed.line = 0

                            let lineindoc = info.document.lineAt(parsed.line)

                            let errorWord = getWord(lineindoc.text, parsed.col)

                            let range = new vscode.Range(
                                parsed.line, parsed.col,
                                parsed.line, parsed.col + errorWord.length
                            )

                            let diagnostic = new vscode.Diagnostic(range, parsed.msgtext, vscode.DiagnosticSeverity.Error)
                            info.diagnostics.push(diagnostic)

                            const line = parsed.line
                            info.decorations.push({
                                renderOptions: { after: { contentText: msg.details, color: '#BB0000' } },
                                range: new vscode.Range(new vscode.Position(line, 1024), new vscode.Position(line, 1024))
                            })
                        }
                        catch (err) {
                            console.log(err)
                        }
                    }

                    const entries = []

                    for (const key of map.keys()) {
                        const info = map.get(key)
                        if (info.document) entries.push([info.document.uri, info.diagnostics])
                        if (info.editor) info.editor.setDecorations(decorationType, info.decorations)
                    }

                    for (const key of this.files.keys()) {
                        if (!map.has(key)) {
                            const info = this.files.get(key)
                            if (info.document) entries.push([info.document.uri, []])
                            if (info.editor) {
                                info.editor.setDecorations(decorationType, [])
                            }
                        }
                    }

                    this.diagnostics.set(entries)
                }
            })
        })

        req.on('error', error => {
            console.error('Cannot get json: ' + error.message)
        })

        req.write(JSON.stringify(commands))
        req.end()
    }

    lintDocumentLegacy(document) {
        if (document.languageId !== 'hexa' || document.isUntitled || document.uri.scheme !== 'file') {
            return
        }

        const fullText = document.getText()

        const commandFindProjectFile = {
            kind: 'FindProjectFile',
            payload: document.uri.fsPath
        }

        const commandGetWholeFileSyntaxErrors = {
            kind: 'GetWholeFileSyntaxErrors',
            payload: fullText
        }

        const commands = [commandFindProjectFile, commandGetWholeFileSyntaxErrors]

        const req = http.request(options, res => {
            const chunks = [] // TODO use Buffer

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
                }

                {
                    // Parse the report
                    let entries = []
                    const decorationsArray = []
                    const openEditor = vscode.window.visibleTextEditors.filter(
                        editor => editor.document.uri === document.uri
                    )[0]

                    // Parse offenses for the file
                    let diagnostics = []
                    for (const msg of json[1]) {
                        try {
                            let parsed = {
                                line: msg.line - 1, //Number(match[2]) - 1,
                                col: msg.column, //Number(match[3]), // FIXME // TODO
                                msgtext: msg.details //match[4]
                            }

                            let lineindoc = document.lineAt(parsed.line)

                            let errorWord = getWord(lineindoc.text, parsed.col)

                            let range = new vscode.Range(
                                parsed.line, parsed.col,
                                parsed.line, parsed.col + errorWord.length
                            )

                            let diagnostic = new vscode.Diagnostic(range, parsed.msgtext, vscode.DiagnosticSeverity.Error)
                            diagnostics.push(diagnostic)

                            const line = parsed.line
                            decorationsArray.push({
                                renderOptions: { after: { contentText: msg.details, color: '#BB0000' } },
                                range: new vscode.Range(new vscode.Position(line, 1024), new vscode.Position(line, 1024))
                            })
                        }
                        catch (err) {
                            console.log(err)
                        }
                    }

                    if (openEditor) {
                        openEditor.setDecorations(decorationType, decorationsArray)
                    } else {
                    }

                    entries.push([document.uri, diagnostics])
                    this.diagnostics.set(entries)
                }
            })
        })

        req.on('error', error => {
            console.error(error)
            console.error('Cannot get json: ' + error.message)
        })

        req.write(JSON.stringify(commands))
        req.end()
    }

    lint(document) {
        this.lintDocument(document)
    }

    lintCli(document) {
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
            `${path} syntax-linter ${document.fileName}`,
            { 'cwd': vscode.workspace.rootPath } // Current working directory
        )
        console.log("[Hexa-Lint] Compiler executed.")
        this.diagnostics.delete(document.uri)

        let buffer = ''
        let dataHandler = (data) => {
            buffer += data
        }
        let ended = 0
        let endHandler = () => {
            ended++
            if (ended == 2) {
                eventHandler(buffer)
            }
        }

        let eventHandler = (data) => {
            console.log("[Hexa-Lint] Handled data.", data)

            let msgs = data.split("\n")
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

                    let lineindoc = document.lineAt(parsed.line)

                    console.log(`[Hexa-Lint] Got needed line from document.`, lineindoc)

                    let errorWord = getWord(lineindoc.text, parsed.col)
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
                    console.log(err)
                }
            }
            console.log(`[Hexa-Lint] Got ${entries.length} entries of diagnostic.`)
            entries.push([document.uri, diagnostics])
            this.diagnostics.set(entries)
        }

        linter.stderr.on('data', dataHandler)
        linter.stderr.on('end', endHandler)

        // Wait for linter to return the report
        linter.stdout.on('data', dataHandler)
        linter.stdout.on('end', endHandler)
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
