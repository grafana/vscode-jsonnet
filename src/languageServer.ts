import { workspace, ExtensionContext, OutputChannel } from 'vscode';
import {
  DidChangeConfigurationNotification,
  Executable,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from 'vscode-languageclient/node';
import { install } from './install';
import { getLanguageServerSettings } from './settings';

export async function startLanguageClient(
  extensionContext: ExtensionContext,
  channel: OutputChannel
): Promise<LanguageClient | undefined> {
  const configuredLogLevel = workspace.getConfiguration('jsonnet').get<string | null>('languageServer.logLevel', null);
  const args: string[] = [];
  if (configuredLogLevel) {
    args.push('--log-level', configuredLogLevel);
  }

  const binPath = await install(extensionContext, channel, 'languageServer');
  if (!binPath) {
    return undefined;
  }
  const executable: Executable = {
    command: binPath,
    args: args,
    options: {
      env: process.env,
    },
  };
  channel.appendLine(`jrsonnet-lsp will start: '${executable.command} ${executable.args.join(' ')}'`);

  const serverOptions: ServerOptions = {
    run: executable,
    debug: executable,
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'jsonnet' }],
    initializationOptions: getLanguageServerSettings(),
  };

  const client = new LanguageClient('jrsonnetLanguageServer', 'jrsonnet-lsp', serverOptions, clientOptions);
  client.start();
  return client;
}

export async function stopLanguageClient(client: LanguageClient | undefined): Promise<void> {
  if (!client) {
    return;
  }
  await client.stop();
  client.outputChannel.dispose();
}

export async function sendDidChangeConfiguration(client: LanguageClient | undefined): Promise<void> {
  if (!client) {
    return;
  }
  client.sendNotification(DidChangeConfigurationNotification.type, {
    settings: getLanguageServerSettings(),
  });
}
