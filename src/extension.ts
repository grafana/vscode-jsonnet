import * as path from 'path';
import { commands, window, workspace, ExtensionContext, Uri, OutputChannel, TextEditor, ViewColumn } from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { stringify as stringifyYaml } from 'yaml';

import {
	DidChangeConfigurationNotification,
	Executable,
	ExecuteCommandParams,
	ExecuteCommandRequest,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';
import { install } from './install';
import { openStdin } from 'process';

enum OutputMode {
    json,
    yaml,
    string
}

let extensionContext: ExtensionContext;
let client: LanguageClient;
let channel: OutputChannel;

export async function activate(context: ExtensionContext): Promise<void> {
	channel = window.createOutputChannel('Jsonnet');
	extensionContext = context;

	await startClient();
	await didChangeConfigHandler();

	context.subscriptions.push(
		workspace.onDidChangeConfiguration(didChangeConfigHandler),
		commands.registerCommand('jsonnet.restartLanguageServer', async function (): Promise<void> {
			await client.stop();
			client.outputChannel.dispose();
			await startClient();
			await didChangeConfigHandler();
		}),
		commands.registerCommand('jsonnet.evalItem', async () => {
			// Not enabled for now, because the language server doesn't support it.
			const editor = window.activeTextEditor;
			const params: ExecuteCommandParams = {
				command: `jsonnet.evalItem`,
				arguments: [evalFilePath(editor), editor.selection.active],
			};
			evalAndDisplay(params, OutputMode.json);
		}),
		commands.registerCommand('jsonnet.evalFile', evalFileFunc(OutputMode.json)),
		commands.registerCommand('jsonnet.evalFileYaml', evalFileFunc(OutputMode.yaml)),
		commands.registerCommand('jsonnet.evalFileString', evalFileFunc(OutputMode.string)),
		commands.registerCommand('jsonnet.evalExpression', evalExpressionFunc(OutputMode.json)),
		commands.registerCommand('jsonnet.evalExpressionYaml', evalExpressionFunc(OutputMode.yaml)),
		commands.registerCommand('jsonnet.evalExpressionString', evalExpressionFunc(OutputMode.string))
	);
}

/**
 * @returns The extension of the output file suggested by the header of the current file.
 */
function suggestOutputExtension(): string {
    const editor = window.activeTextEditor;
    const header = editor.document.lineAt(0).text;
    const ext = /output: \S*[.](?<ext>\S*)/i.exec(header)?.groups?.ext;
    channel.appendLine(`Header: ${header}`);
    channel.appendLine(`Suggested extension: ${ext}`);
    return ext;
}

function evalFileFunc(mode: OutputMode) {
	return async () => {
		const editor = window.activeTextEditor;
        const ext = suggestOutputExtension();
		const params: ExecuteCommandParams = {
			command: `jsonnet.evalFile`,
			arguments: [evalFilePath(editor)],
		};
		evalAndDisplay(params, mode, ext);
	};
}

function evalExpressionFunc(mode: OutputMode) {
	return async () => {
		const editor = window.activeTextEditor;
		window.showInputBox({ prompt: 'Expression to evaluate' }).then(async (expr) => {
			if (expr) {
                const ext = suggestOutputExtension();
				const params: ExecuteCommandParams = {
					command: `jsonnet.evalExpression`,
					arguments: [evalFilePath(editor), expr],
				};
				evalAndDisplay(params, mode, ext);
			} else {
				window.showErrorMessage('No expression provided');
			}
		});
	};
}

function outputYaml(tempFile: string, ext?: string): Uri {
    const file = fs.readFileSync(tempFile, 'utf8');
    const parsed = JSON.parse(file);
    const yamlString = stringifyYaml(parsed);
    const tempYamlFile = path.join(os.tmpdir(), "result.${ext || 'yaml'}}");
    fs.writeFileSync(tempYamlFile, yamlString);
    return Uri.file(tempYamlFile);
}

function outputString(tempFile: string, ext?: string): Uri {
    const file = fs.readFileSync(tempFile, 'utf8');
    const parsed = JSON.parse(file);
    const tempStringFile = path.join(os.tmpdir(), `result.${ext || 'txt'}`);
    const flatten = (arr: any[]): string =>
        arr.map((item) => (typeof item === 'string' ? item : flatten(item)))
        .join('\n');
    if (typeof parsed === 'string') {
        fs.writeFileSync(tempStringFile, parsed);
    } else if (parsed instanceof Array) {
        fs.writeFileSync(tempStringFile, flatten(parsed));
    } else {
        fs.writeFileSync(file, `Not a string or array of strings: ${JSON.stringify(parsed)}`);
    }
    return Uri.file(tempStringFile);
}
function evalAndDisplay(params: ExecuteCommandParams, mode: OutputMode, ext: string = null): void {
	channel.appendLine(`Sending eval request: ${JSON.stringify(params)}`);
	client.sendRequest(ExecuteCommandRequest.type, params)
		.then(result => {
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsonnet-eval"));
			const tempFile = path.join(tempDir, "result.json");
			let uri = Uri.file(tempFile);
			fs.writeFileSync(tempFile, result);
            switch (mode) {
                case OutputMode.json:
                    // No conversion needed.
                    break;
                case OutputMode.yaml:
                    uri = outputYaml(tempFile, ext);
                    break;
                case OutputMode.string:
                    uri = outputString(tempFile, ext);
                    break;
            }
			window.showTextDocument(uri, {
				preview: true,
				viewColumn: ViewColumn.Beside
			});
		})
		.catch(err => {
			window.showErrorMessage(err.message);
		});
}

function evalFilePath(editor: TextEditor): string {
	return editor.document.uri.fsPath.replace(/\\/g, '/');
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

async function startClient(): Promise<void> {
	const args: string[] = ["--log-level", workspace.getConfiguration('jsonnet').get('languageServer.logLevel')];
	if (workspace.getConfiguration('jsonnet').get('languageServer.tankaMode') === true) {
		args.push('--tanka');
	}
	if (workspace.getConfiguration('jsonnet').get('languageServer.lint') === true) {
		args.push('--lint');
	}

	const binPath = await install(extensionContext, channel);
	const executable: Executable = {
		command: binPath,
		args: args,
		options: {
			env: process.env,
		},
	};
	channel.appendLine(`Jsonnet Language Server will start: '${executable.command} ${executable.args.join(' ')}'`);

	const serverOptions: ServerOptions = {
		run: executable,
		debug: executable,
	};

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for jsonnet files
		documentSelector: [{ scheme: 'file', language: 'jsonnet' }],
	};

	// Create the language client and start the client.
	client = new LanguageClient(
		'jsonnetLanguageServer',
		'Jsonnet Language Server',
		serverOptions,
		clientOptions
	);

	// Start the client. This will also launch the server
	client.start();
}

async function didChangeConfigHandler() {
	const workspaceConfig = workspace.getConfiguration('jsonnet');
	let jpath: string[] = workspaceConfig.get('languageServer.jpath');
	jpath = jpath.map(p => path.isAbsolute(p) ? p : path.join(workspace.workspaceFolders[0].uri.fsPath, p));
	client.sendNotification(DidChangeConfigurationNotification.type, {
		settings: {
			log_level: workspaceConfig.get('languageServer.logLevel'),
			ext_vars: workspaceConfig.get("languageServer.extVars"),
			ext_code: workspaceConfig.get("languageServer.extCode"),
			jpath: jpath,
			resolve_paths_with_tanka: workspaceConfig.get('languageServer.tankaMode'),
			enable_lint_diagnostics: workspaceConfig.get('languageServer.lint'),
			enable_eval_diagnostics: workspaceConfig.get('languageServer.eval'),
			formatting: workspaceConfig.get('languageServer.formatting'),
		}
	});
}
