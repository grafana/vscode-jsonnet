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
  WebviewPanel,
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
      evalAndDisplay(params, false);
    }),
    commands.registerCommand('jsonnet.evalFile', evalFileFunc(false)),
    commands.registerCommand('jsonnet.evalFileContinous', evalContinuouslyFileFunc(false)),
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
      arguments: [evalFilePath(editor)],
    };
    evalAndDisplay(params, yaml);
  };
}

function evalContinuouslyFileFunc(yaml: boolean) {

  const currentFilePath = evalFilePath(window.activeTextEditor);

  const watcher = workspace.createFileSystemWatcher(currentFilePath);

  return async () => {
    const params: ExecuteCommandParams = {
      command: `jsonnet.evalFile`,
      arguments: [currentFilePath],
    };
    const workspaceConfig = workspace.getConfiguration('jsonnet');
    const PauseTime : number = workspaceConfig.get('languageServer.evalContinousPauseTime');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonnet-eval'));
    const tempFile = path.join(tempDir, 'result.json');
    const uri = Uri.file(tempFile);
    fs.writeFileSync(tempFile, '{}');

    let end = window.showTextDocument(uri, {
      preview: true,
      viewColumn: ViewColumn.Beside,
    });
    watcher.onDidChange((e) => {
      evalOnDisplay(params, yaml, tempDir)
    });
  };
}

function evalExpressionFunc(yaml: boolean) {
  return async () => {
    const editor = window.activeTextEditor;
    window.showInputBox({ prompt: 'Expression to evaluate' }).then(async (expr) => {
      if (expr) {
        const params: ExecuteCommandParams = {
          command: `jsonnet.evalExpression`,
          arguments: [evalFilePath(editor), expr],
        };
        evalAndDisplay(params, yaml);
      } else {
        window.showErrorMessage('No expression provided');
      }
    });
  };
}

function evalOnDisplay(params: ExecuteCommandParams, yaml: boolean, tmpdir): void {
  channel.appendLine(`Sending eval request: ${JSON.stringify(params)}`);
  client
    .sendRequest(ExecuteCommandRequest.type, params)
    .then((result) => {
      const tempFile = path.join(tmpdir, 'result.json');
      fs.writeFileSync(tempFile, result);

      if (yaml) {
        const file = fs.readFileSync(tempFile, 'utf8');
        const parsed = JSON.parse(file);
        const yamlString = stringifyYaml(parsed);
        const tempYamlFile = path.join(tmpdir, 'result.yaml');
        fs.writeFileSync(tempYamlFile, yamlString);
      }      
    })
    .catch((err) => {
      window.showErrorMessage(err.message);
      const tempFile = path.join(tmpdir, 'result.json');
      fs.writeFileSync(tempFile, err.message);
    });

}

function evalAndDisplay(params: ExecuteCommandParams, yaml: boolean): void {
  channel.appendLine(`Sending eval request: ${JSON.stringify(params)}`);
  client
    .sendRequest(ExecuteCommandRequest.type, params)
    .then((result) => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonnet-eval'));
      const tempFile = path.join(tempDir, 'result.json');
      let uri = Uri.file(tempFile);
      fs.writeFileSync(tempFile, result);

      if (yaml) {
        const file = fs.readFileSync(tempFile, 'utf8');
        const parsed = JSON.parse(file);
        const yamlString = stringifyYaml(parsed);
        const tempYamlFile = path.join(tempDir, 'result.yaml');
        uri = Uri.file(tempYamlFile);
        fs.writeFileSync(tempYamlFile, yamlString);
      }
      window.showTextDocument(uri, {
        preview: true,
        viewColumn: ViewColumn.Beside,
      });
    })
    .catch((err) => {
      window.showErrorMessage(err.message);
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonnet-eval'));
      const tempFile = path.join(tempDir, 'result.json');
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
