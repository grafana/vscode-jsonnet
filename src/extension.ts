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
const evalFileName = 'jsonnet-eval-result';

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
      evalJsonnet(params, false, tempFile, true);
    }),
    commands.registerCommand('jsonnet.evalFile', evalCommand(false)),
    commands.registerCommand('jsonnet.evalFileYaml', evalCommand(true)),
    commands.registerCommand('jsonnet.evalExpression', evalCommand(false, true)),
    commands.registerCommand('jsonnet.evalExpressionYaml', evalCommand(true, true))
  );
}

function evalCommand(yaml: boolean, promptExpr = false) {
  return async () => {
    let expr = '';
    if (promptExpr) {
      expr = await window.showInputBox({ prompt: 'Expression to evaluate' });
      if (expr === undefined || expr === '') {
        window.showErrorMessage('No expression provided');
        return;
      }
    }

    const currentFilePath = evalFilePath(window.activeTextEditor);
    const params: ExecuteCommandParams = {
      command: expr === '' ? `jsonnet.evalFile` : `jsonnet.evalExpression`,
      arguments: [currentFilePath].concat(expr === '' ? [] : [expr]),
    };

    // Close previous result tab (named jsonnet-eval-result)
    for (const editor of window.visibleTextEditors) {
      if (editor.document.fileName.includes(evalFileName)) {
        channel.appendLine(`Closing previous result tab ${editor.document.fileName}`);
        await window.showTextDocument(editor.document, { preview: false, viewColumn: ViewColumn.Beside });
        await commands.executeCommand('workbench.action.closeActiveEditor');
      }
    }

    const tempFile = createTmpFile(yaml);
    const uri = Uri.file(tempFile);

    fs.writeFileSync(tempFile, '"Evaluating..."');

    if (workspace.getConfiguration('jsonnet').get('languageServer.continuousEval') === false) {
      evalJsonnet(params, yaml, tempFile, true);
    } else {
      // Initial eval
      evalJsonnet(params, yaml, tempFile, true);

      // Watch all jsonnet files, trigger eval on change
      const watcher = workspace.createFileSystemWatcher("**/*.*sonnet", true, false, true);
      watcher.onDidChange((e) => {
        channel.appendLine(`File changed: ${e.fsPath}, triggering eval`);
        evalJsonnet(params, yaml, tempFile, false);
      });

      // Stop watching when the tab is closed. Only run this once.
      const disposable = window.onDidChangeVisibleTextEditors((editors) => {
        for (const editor of editors) {
          if (editor.document.uri.fsPath === uri.fsPath) {
            return;
          }
        }
        channel.appendLine(`Closed result tab, stopping watcher and deleting temp file ${tempFile}`);
        watcher.dispose();
        fs.unlinkSync(tempFile);
        disposable.dispose();
      });
    }
  };
}

function createTmpFile(yaml): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonnet-eval'));
  const fileEnding = yaml ? 'yaml' : 'json';
  const tempFile = path.join(tempDir, `${evalFileName}.${fileEnding}`);
  return tempFile;
}

function evalJsonnet(params: ExecuteCommandParams, yaml: boolean, tempFile: string, display = false): void {
  channel.appendLine(`Sending eval request: ${JSON.stringify(params)} for ${tempFile}`);
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
      if (display) {
        window.showTextDocument(uri, {
          preview: true,
          viewColumn: ViewColumn.Beside,
          preserveFocus: true,
        });
      }
    })
    .catch((err) => {
      window.showErrorMessage(err.message);
      fs.writeFileSync(tempFile, err.message);
      if (display) {
        const uri = Uri.file(tempFile);
        window.showTextDocument(uri, {
          preview: true,
          viewColumn: ViewColumn.Beside,
          preserveFocus: true,
        });
      }
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
