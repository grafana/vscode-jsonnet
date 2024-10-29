import * as path from 'path';
import {
  commands,
  debug,
  window,
  workspace,
  ExtensionContext,
  Uri,
  OutputChannel,
  TextEditor,
  ViewColumn,
  ProviderResult,
  WorkspaceFolder,
  DebugConfiguration,
  DebugConfigurationProviderTriggerKind,
} from 'vscode';
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
import { JsonnetDebugAdapterDescriptorFactory } from './debugger';

let extensionContext: ExtensionContext;
let client: LanguageClient;
let channel: OutputChannel;

export async function activate(context: ExtensionContext): Promise<void> {
  channel = window.createOutputChannel('Jsonnet');
  extensionContext = context;

  await startClient();
  await installDebugger(context);
  await didChangeConfigHandler();
  context.subscriptions.push(
    debug.registerDebugConfigurationProvider(
      'jsonnet',
      {
        provideDebugConfigurations(folder: WorkspaceFolder | undefined): ProviderResult<DebugConfiguration[]> {
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
      const tempFile = createTmpFile(false);
      evalAndDisplay(params, false, tempFile);
    }),
    commands.registerCommand('jsonnet.evalFile', evalFileFunc(false)),
    commands.registerCommand('jsonnet.evalFileYaml', evalFileFunc(true)),
    commands.registerCommand('jsonnet.evalExpression', evalExpressionFunc(false)),
    commands.registerCommand('jsonnet.evalExpressionYaml', evalExpressionFunc(true))
  );
}

function evalFileFunc(yaml: boolean) {
  return async () => {
    const currentFilePath = evalFilePath(window.activeTextEditor);
    const params: ExecuteCommandParams = {
      command: `jsonnet.evalFile`,
      arguments: [currentFilePath],
    };
    const tempFile = createTmpFile(yaml);
    const uri = Uri.file(tempFile);

    fs.writeFileSync(tempFile, '"Evaluating..."');

    if (workspace.getConfiguration('jsonnet').get('languageServer.continuousEval') === false) {
      evalAndDisplay(params, yaml, tempFile);
    }
    else {

      // Initial eval
      evalOnDisplay(params, yaml, tempFile);

      const watcher = workspace.createFileSystemWatcher(currentFilePath);

      window.showTextDocument(uri, {
        preview: true,
        viewColumn: ViewColumn.Beside,
        preserveFocus: true,
      });
      watcher.onDidChange((e) => {
        evalOnDisplay(params, yaml, tempFile);
      }
      );
    }
  };
}

function createTmpFile(yaml): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonnet-eval'));
  const fileEnding = yaml ? 'yaml' : 'json';
  const tempFile = path.join(tempDir, `result.${fileEnding}`);
  return tempFile;
}

function evalExpressionFunc(yaml: boolean) {
  return async () => {
    window.showInputBox({ prompt: 'Expression to evaluate' }).then(async (expr) => {
      if (expr) {
        const currentFilePath = evalFilePath(window.activeTextEditor);
        const params: ExecuteCommandParams = {
          command: `jsonnet.evalExpression`,
          arguments: [currentFilePath, expr],
        };
        const tempFile = createTmpFile(yaml);
        const uri = Uri.file(tempFile);

        fs.writeFileSync(tempFile, '"Evaluating..."');

        if (workspace.getConfiguration('jsonnet').get('languageServer.continuousEval') === false) {
          evalAndDisplay(params, yaml, tempFile);
        }
        else {
          // Initial eval
          evalOnDisplay(params, yaml, tempFile);

          const watcher = workspace.createFileSystemWatcher(currentFilePath);

          window.showTextDocument(uri, {
            preview: true,
            viewColumn: ViewColumn.Beside,
            preserveFocus: true,
          });
          watcher.onDidChange((e) => {
            evalOnDisplay(params, yaml, tempFile);
          }
          );
        }
      } else {
        window.showErrorMessage('No expression provided');
      }
    });
  };
}

function evalOnDisplay(params: ExecuteCommandParams, yaml: boolean, tempFile: string): void {
  channel.appendLine(`Sending eval request: ${JSON.stringify(params)}`);
  client
    .sendRequest(ExecuteCommandRequest.type, params)
    .then((result) => {
      let uri = Uri.file(tempFile);
      fs.writeFileSync(tempFile, result);

      if (yaml) {
        const file = fs.readFileSync(tempFile, 'utf8');
        const parsed = JSON.parse(file);
        const yamlString = stringifyYaml(parsed);
        uri = Uri.file(tempFile);
        fs.writeFileSync(tempFile, yamlString);
      }
    })
    .catch((err) => {
      window.showErrorMessage(err.message);
      fs.writeFileSync(tempFile, err.message);
    });
}

function evalAndDisplay(params: ExecuteCommandParams, yaml: boolean, tempFile: string): void {
  channel.appendLine(`Sending eval request: ${JSON.stringify(params)}`);
  client
    .sendRequest(ExecuteCommandRequest.type, params)
    .then((result) => {
      let uri = Uri.file(tempFile);
      fs.writeFileSync(tempFile, result);

      if (yaml) {
        const file = fs.readFileSync(tempFile, 'utf8');
        const parsed = JSON.parse(file);
        const yamlString = stringifyYaml(parsed);
        uri = Uri.file(tempFile);
        fs.writeFileSync(tempFile, yamlString);
      }
      window.showTextDocument(uri, {
        preview: true,
        viewColumn: ViewColumn.Beside,
      });
    })
    .catch((err) => {
      window.showErrorMessage(err.message);
      fs.writeFileSync(tempFile, err.message);
      const uri = Uri.file(tempFile);
      window.showTextDocument(uri, {
        preview: true,
        viewColumn: ViewColumn.Beside,
      });
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

async function installDebugger(context: ExtensionContext): Promise<void> {
  const binPath = await install(extensionContext, channel, 'debugger');
  if (!binPath) {
    return;
  }
  debug.registerDebugAdapterDescriptorFactory('jsonnet', new JsonnetDebugAdapterDescriptorFactory(context, binPath));
}

async function startClient(): Promise<void> {
  const args: string[] = ['--log-level', workspace.getConfiguration('jsonnet').get('languageServer.logLevel')];
  if (workspace.getConfiguration('jsonnet').get('languageServer.tankaMode') === true) {
    args.push('--tanka');
  }
  if (workspace.getConfiguration('jsonnet').get('languageServer.lint') === true) {
    args.push('--lint');
  }

  const binPath = await install(extensionContext, channel, 'languageServer');
  if (!binPath) {
    return;
  }
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
  client = new LanguageClient('jsonnetLanguageServer', 'Jsonnet Language Server', serverOptions, clientOptions);

  // Start the client. This will also launch the server
  client.start();
}

async function didChangeConfigHandler() {
  const workspaceConfig = workspace.getConfiguration('jsonnet');
  let jpath: string[] = workspaceConfig.get('languageServer.jpath');
  jpath = jpath.map((p) => (path.isAbsolute(p) ? p : path.join(workspace.workspaceFolders[0].uri.fsPath, p)));
  client.sendNotification(DidChangeConfigurationNotification.type, {
    settings: {
      log_level: workspaceConfig.get('languageServer.logLevel'),
      ext_vars: workspaceConfig.get('languageServer.extVars'),
      ext_code: workspaceConfig.get('languageServer.extCode'),
      jpath: jpath,
      resolve_paths_with_tanka: workspaceConfig.get('languageServer.tankaMode'),
      enable_lint_diagnostics: workspaceConfig.get('languageServer.lint'),
      enable_eval_diagnostics: workspaceConfig.get('languageServer.eval'),
      formatting: workspaceConfig.get('languageServer.formatting'),
    },
  });
}
