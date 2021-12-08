import * as path from 'path';
import { commands, window, workspace, ExtensionContext } from 'vscode';

import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';
import { install } from './install';

let client: LanguageClient;

export async function activate(context: ExtensionContext): Promise<void> {
	const channel = window.createOutputChannel('Jsonnet');

	let jpath: string[] = workspace.getConfiguration('jsonnet').get('languageServer.jpath');
	jpath = jpath.map(p => path.isAbsolute(p) ? p : path.join(workspace.workspaceFolders[0].uri.fsPath, p));

	const args: string[] = ["--log-level", workspace.getConfiguration('jsonnet').get('languageServer.logLevel')];
	if (workspace.getConfiguration('jsonnet').get('languageServer.tankaMode') === true) {
		args.push('--tanka');
	}
	if (workspace.getConfiguration('jsonnet').get('languageServer.lint') === true) {
		args.push('--lint');
	}

	const binPath = await install(context, channel);
	const executable: Executable = {
		command: binPath,
		args: args,
		options: {
			env: { "JSONNET_PATH": jpath.join(path.delimiter) }
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

	context.subscriptions.push(
		workspace.onDidChangeConfiguration(restartHandler),
	);
	context.subscriptions.push(
		commands.registerCommand('jsonnet.restartLanguageServer', restartHandler),
	);

	// Start the client. This will also launch the server
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}

async function restartHandler(): Promise<void> {
	await client.stop();
	client.start();
}