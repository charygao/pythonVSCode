'use strict';

import * as vscode from 'vscode';
import { RefactorProxy } from '../refactor/proxy';
import { getTextEditsFromPatch } from '../common/editor';
import { PythonSettings, IPythonSettings } from '../common/configSettings';
import { Installer, Product } from '../common/installer';

interface RenameResponse {
    results: [{ diff: string }];
}

let installer: Installer;

export function activateSimplePythonRefactorProvider(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    let disposable = vscode.commands.registerCommand('python.refactorExtractVariable', () => {
        extractVariable(context.extensionPath,
            vscode.window.activeTextEditor,
            vscode.window.activeTextEditor.selection,
            outputChannel).catch(() => { });
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('python.refactorExtractMethod', () => {
        extractMethod(context.extensionPath,
            vscode.window.activeTextEditor,
            vscode.window.activeTextEditor.selection,
            outputChannel).catch(() => { });
    });
    context.subscriptions.push(disposable);
    installer = new Installer(outputChannel);
    context.subscriptions.push(installer);
}

// Exported for unit testing
export function extractVariable(extensionDir: string, textEditor: vscode.TextEditor, range: vscode.Range,
    outputChannel: vscode.OutputChannel, workspaceRoot: string = vscode.workspace.rootPath,
    pythonSettings: IPythonSettings = PythonSettings.getInstance()): Promise<any> {

    return validateDocumentForRefactor(textEditor).then(() => {
        let newName = 'newvariable' + new Date().getMilliseconds().toString();
        let proxy = new RefactorProxy(extensionDir, pythonSettings, workspaceRoot);
        let rename = proxy.extractVariable<RenameResponse>(textEditor.document, newName, textEditor.document.uri.fsPath, range, textEditor.options).then(response => {
            return response.results[0].diff;
        });

        return extractName(extensionDir, textEditor, range, newName, rename, outputChannel);
    });
}

// Exported for unit testing
export function extractMethod(extensionDir: string, textEditor: vscode.TextEditor, range: vscode.Range,
    outputChannel: vscode.OutputChannel, workspaceRoot: string = vscode.workspace.rootPath,
    pythonSettings: IPythonSettings = PythonSettings.getInstance()): Promise<any> {

    return validateDocumentForRefactor(textEditor).then(() => {
        let newName = 'newmethod' + new Date().getMilliseconds().toString();
        let proxy = new RefactorProxy(extensionDir, pythonSettings, workspaceRoot);
        let rename = proxy.extractMethod<RenameResponse>(textEditor.document, newName, textEditor.document.uri.fsPath, range, textEditor.options).then(response => {
            return response.results[0].diff;
        });

        return extractName(extensionDir, textEditor, range, newName, rename, outputChannel);
    });
}

function validateDocumentForRefactor(textEditor: vscode.TextEditor): Promise<any> {
    if (!textEditor.document.isDirty) {
        return Promise.resolve();
    }

    return new Promise<any>((resolve, reject) => {
        vscode.window.showInformationMessage('Please save changes before refactoring', 'Save').then(item => {
            if (item === 'Save') {
                textEditor.document.save().then(resolve, reject);
            }
            else {
                return reject();
            }
        });
    });
}

function extractName(extensionDir: string, textEditor: vscode.TextEditor, range: vscode.Range, newName: string,
    renameResponse: Promise<string>, outputChannel: vscode.OutputChannel): Promise<any> {
    let changeStartsAtLine = -1;
    return renameResponse.then(diff => {
        if (diff.length === 0) {
            return [];
        }
        let edits = getTextEditsFromPatch(textEditor.document.getText(), diff);
        return edits;
    }).then(edits => {
        return textEditor.edit(editBuilder => {
            edits.forEach(edit => {
                if (changeStartsAtLine === -1 || changeStartsAtLine > edit.range.start.line) {
                    changeStartsAtLine = edit.range.start.line;
                }
                editBuilder.replace(edit.range, edit.newText);
            });
        });
    }).then(done => {
        if (done && changeStartsAtLine >= 0) {
            let newWordPosition: vscode.Position;
            for (let lineNumber = changeStartsAtLine; lineNumber < textEditor.document.lineCount; lineNumber++) {
                let line = textEditor.document.lineAt(lineNumber);
                let indexOfWord = line.text.indexOf(newName);
                if (indexOfWord >= 0) {
                    newWordPosition = new vscode.Position(line.range.start.line, indexOfWord);
                    break;
                }
            }

            if (newWordPosition) {
                textEditor.selections = [new vscode.Selection(newWordPosition, new vscode.Position(newWordPosition.line, newWordPosition.character + newName.length))];
                textEditor.revealRange(new vscode.Range(textEditor.selection.start, textEditor.selection.end), vscode.TextEditorRevealType.Default);
            }
            return newWordPosition;
        }
        return null;
    }).then(newWordPosition => {
        if (newWordPosition) {
            return textEditor.document.save().then(() => {
                // Now that we have selected the new variable, lets invoke the rename command
                return vscode.commands.executeCommand('editor.action.rename');
            });
        }
    }).catch(error => {
        if (error === 'Not installed') {
            installer.promptToInstall(Product.rope);
            return Promise.reject('');
        }
        let errorMessage = error + '';
        if (typeof error === 'string') {
            errorMessage = error;
        }
        if (typeof error === 'object' && error.message) {
            errorMessage = error.message;
        }
        outputChannel.appendLine('#'.repeat(10) + 'Refactor Output' + '#'.repeat(10));
        outputChannel.appendLine('Error in refactoring:\n' + errorMessage);
        vscode.window.showErrorMessage(`Cannot perform refactoring using selected element(s). (${errorMessage})`);
        return Promise.reject(error);
    });
}
