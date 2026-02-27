import {
  commands,
  debug,
  window,
  workspace,
  ExtensionContext,
  Uri,
  OutputChannel,
  ProviderResult,
  WorkspaceFolder,
  DebugConfiguration,
  DebugConfigurationProviderTriggerKind,
} from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { install } from './install';
import { JsonnetDebugAdapterDescriptorFactory } from './debugger';
import { createEvalCommand } from './evalCommand';
import { createFindTransitiveImportersCommand } from './findTransitiveImporters';
import { sendDidChangeConfiguration, startLanguageClient, stopLanguageClient } from './languageServer';

let extensionContext: ExtensionContext;
let client: LanguageClient | undefined;
let channel: OutputChannel;

export async function activate(context: ExtensionContext): Promise<void> {
  channel = window.createOutputChannel('Jsonnet');
  extensionContext = context;

  client = await startLanguageClient(extensionContext, channel);

  await installDebugger(context);
  await didChangeConfigHandler();

  context.subscriptions.push(
    debug.registerDebugConfigurationProvider(
      'jsonnet',
      {
        provideDebugConfigurations(_folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
          return [
            {
              name: 'Debug current Jsonnet file',
              request: 'launch',
              type: 'jsonnet',
              program: '${file}',
            },
          ];
        },
      },
      DebugConfigurationProviderTriggerKind.Dynamic
    ),

    commands.registerCommand('jsonnet.debugEditorContents', (resource: Uri) => {
      let targetResource = resource;
      if (!targetResource && window.activeTextEditor) {
        targetResource = window.activeTextEditor.document.uri;
      }

      if (targetResource) {
        debug.startDebugging(undefined, {
          type: 'jsonnet',
          name: 'Debug File',
          request: 'launch',
          program: targetResource.fsPath,
        });
      }
    })
  );

  const getClient = () => client;
  const evalCommandOptions = {
    channel,
    getClient,
  };

  context.subscriptions.push(
    workspace.onDidChangeConfiguration(didChangeConfigHandler),

    commands.registerCommand('jsonnet.restartLanguageServer', restartLanguageServer),

    commands.registerCommand('jsonnet.evalFile', createEvalCommand(evalCommandOptions, false)),
    commands.registerCommand('jsonnet.evalFileYaml', createEvalCommand(evalCommandOptions, true)),
    commands.registerCommand('jsonnet.evalExpression', createEvalCommand(evalCommandOptions, false, true)),
    commands.registerCommand('jsonnet.evalExpressionYaml', createEvalCommand(evalCommandOptions, true, true)),

    commands.registerCommand('jsonnet.findTransitiveImporters', createFindTransitiveImportersCommand(getClient))
  );
}

export function deactivate(): Thenable<void> | undefined {
  return stopClient();
}

async function restartLanguageServer(): Promise<void> {
  await stopClient();

  client = await startLanguageClient(extensionContext, channel);
  await didChangeConfigHandler();
}

async function stopClient(): Promise<void> {
  await stopLanguageClient(client);
  client = undefined;
}

async function installDebugger(context: ExtensionContext): Promise<void> {
  const binPath = await install(extensionContext, channel, 'debugger');
  if (!binPath) {
    return;
  }

  debug.registerDebugAdapterDescriptorFactory('jsonnet', new JsonnetDebugAdapterDescriptorFactory(context, binPath));
}

async function didChangeConfigHandler() {
  await sendDidChangeConfiguration(client);
}
