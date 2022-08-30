import * as path from 'path';
import { commands, window, workspace, ExtensionContext, Uri, OutputChannel } from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import { stringify as stringifyYaml } from 'yaml';

import {
	Executable,
	ExecuteCommandParams,
	ExecuteCommandRequest,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';
import { install } from './install';

let extensionContext: ExtensionContext;
let client: LanguageClient;
let channel: OutputChannel;

export async function activate(context: ExtensionContext): Promise<void> {
	channel = window.createOutputChannel('Jsonnet');
	extensionContext = context;

	await startClient();

	context.subscriptions.push(
		workspace.onDidChangeConfiguration(restartHandler),
		commands.registerCommand('jsonnet.restartLanguageServer', restartHandler),
		commands.registerCommand('jsonnet.evalItem', async () => {
			// Not enabled for now, because the language server doesn't support it.
			const editor = window.activeTextEditor;
			const params: ExecuteCommandParams = {
				command: `jsonnet.evalItem`,
				arguments: [editor.document.uri.fsPath, editor.selection.active],
			};
			evalAndDisplay(params, false);
		}),
		commands.registerCommand('jsonnet.evalFile', evalFileFunc(false)),
		commands.registerCommand('jsonnet.evalFileYaml', evalFileFunc(true)),
		commands.registerCommand('jsonnet.evalExpression', evalExpressionFunc(false)),
		commands.registerCommand('jsonnet.evalExpressionYaml', evalExpressionFunc(true))
	);
}

function evalFileFunc(yaml: boolean) {
	return async () => {
		const editor = window.activeTextEditor;
		const params: ExecuteCommandParams = {
			command: `jsonnet.evalFile`,
			arguments: [editor.document.uri.fsPath],
		};
		evalAndDisplay(params, yaml);
	};
}

function evalExpressionFunc(yaml: boolean) {
	return async () => {
		const editor = window.activeTextEditor;
		window.showInputBox({ prompt: 'Expression to evaluate' }).then(async (expr) => {
			if (expr) {
				const params: ExecuteCommandParams = {
					command: `jsonnet.evalExpression`,
					arguments: [editor.document.uri.fsPath, expr],
				};
				evalAndDisplay(params, yaml);
			} else {
				window.showErrorMessage('No expression provided');
			}
		});
	};
}

function evalAndDisplay(params: ExecuteCommandParams, yaml: boolean): void {
	client.sendRequest(ExecuteCommandRequest.type, params)
		.then(result => {
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "jsonnet-eval"));
			const tempFile = path.join(tempDir, "result.json");
			let uri = Uri.file(tempFile);
			fs.writeFileSync(tempFile, result);

			if (yaml) {
				const file = fs.readFileSync(tempFile, 'utf8');
				const parsed = JSON.parse(file);
				const yamlString = stringifyYaml(parsed);
				const tempYamlFile = path.join(tempDir, "result.yaml");
				uri = Uri.file(tempYamlFile);
				fs.writeFileSync(tempYamlFile, yamlString);
			}
			window.showTextDocument(uri, { preview: true });
		})
		.catch(err => {
			window.showErrorMessage(err.message);
		});
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

async function startClient(): Promise<void> {
	let jpath: string[] = workspace.getConfiguration('jsonnet').get('languageServer.jpath');
	jpath = jpath.map(p => path.isAbsolute(p) ? p : path.join(workspace.workspaceFolders[0].uri.fsPath, p));

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
			env: Object.assign(process.env, { "JSONNET_PATH": jpath.join(path.delimiter) }),
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
		documentSelector: [{ scheme: 'file', language: 'jsonnet' }]
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

async function restartHandler(): Promise<void> {
	await client.stop();
	client.outputChannel.dispose();
	await startClient();
}