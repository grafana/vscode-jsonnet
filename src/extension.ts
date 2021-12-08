import * as path from 'path';
import { workspace, ExtensionContext } from 'vscode';

import {
	Executable,
	LanguageClient,
	LanguageClientOptions,
	ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	const binPath: string = workspace.getConfiguration('jsonnet').get('languageServer.pathToBinary');

	if (binPath === null) {
		// TODO: vscode-client should auto-install the latest released version when pathToBinary is not set
		// Then ask the user to update when a new release goes out
		throw new Error("Set languageServer.pathToBinary");
	}

	let jpath: string[] = workspace.getConfiguration('jsonnet').get('languageServer.jpath');
	jpath = jpath.map(p => path.isAbsolute(p) ? p : path.join(workspace.workspaceFolders[0].uri.fsPath, p));

	let args: string[] = ["--log-level", workspace.getConfiguration('jsonnet').get('languageServer.logLevel')];
	if (workspace.getConfiguration('jsonnet').get('languageServer.tankaMode') === true) {
		args.push('--tanka');
	}
	if (workspace.getConfiguration('jsonnet').get('languageServer.lint') === true) {
		args.push('--lint');
	}

	const executable: Executable = {
		command: binPath,
		args: args,
		options: {
			env: { "JSONNET_PATH": jpath.join(path.delimiter) }
		},
	};

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

export function deactivate(): Thenable<void> | undefined {
	if (!client) {
		return undefined;
	}
	return client.stop();
}
