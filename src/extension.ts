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
  LanguageClient,
  LanguageClientOptions,
  RequestType,
  ServerOptions,
} from 'vscode-languageclient/node';
import { install } from './install';
import { JsonnetDebugAdapterDescriptorFactory } from './debugger';

let extensionContext: ExtensionContext;
let client: LanguageClient;
let channel: OutputChannel;
const evalFileName = 'jsonnet-eval-result';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type EvalFileParams = {
  textDocument: {
    uri: string;
  };
};

type EvalExpressionParams = {
  expression: string;
  baseDocument?: {
    uri: string;
  };
};

type FindTransitiveImportersParams = {
  textDocument: {
    uri: string;
  };
};

type FindTransitiveImportersResponse = {
  file: string;
  transitiveImporters: string[];
};

const EvalFileRequest = new RequestType<EvalFileParams, JsonValue, void>('jrsonnet/evalFile');
const EvalExpressionRequest = new RequestType<EvalExpressionParams, JsonValue, void>('jrsonnet/evalExpression');
const FindTransitiveImportersRequest = new RequestType<
  FindTransitiveImportersParams,
  FindTransitiveImportersResponse,
  void
>('jrsonnet/findTransitiveImporters');

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
    commands.registerCommand('jsonnet.evalFile', evalCommand(false)),
    commands.registerCommand('jsonnet.evalFileYaml', evalCommand(true)),
    commands.registerCommand('jsonnet.evalExpression', evalCommand(false, true)),
    commands.registerCommand('jsonnet.evalExpressionYaml', evalCommand(true, true)),
    commands.registerCommand('jsonnet.findTransitiveImporters', findTransitiveImportersCommand)
  );
}

function evalCommand(yaml: boolean, promptExpr = false) {
  return async () => {
    const editor = window.activeTextEditor;
    if (!editor) {
      window.showErrorMessage('No active editor');
      return;
    }

    let expr = '';
    if (promptExpr) {
      expr = await window.showInputBox({ prompt: 'Expression to evaluate' });
      if (expr === undefined || expr === '') {
        window.showErrorMessage('No expression provided');
        return;
      }
    }

    const currentFileUri = evalFileUri(editor);
    if (expr === '') {
      await executeEvalRequest(EvalFileRequest, { textDocument: { uri: currentFileUri } }, yaml);
    } else {
      await executeEvalRequest(
        EvalExpressionRequest,
        { expression: expr, baseDocument: { uri: currentFileUri } },
        yaml
      );
    }
  };
}

function createTmpFile(yaml: boolean): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonnet-eval'));
  const fileEnding = yaml ? 'yaml' : 'json';
  const tempFile = path.join(tempDir, `${evalFileName}.${fileEnding}`);
  return tempFile;
}

async function executeEvalRequest<P>(
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean
): Promise<void> {
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
    evalJsonnet(request, params, yaml, tempFile, true);
  } else {
    // Initial eval
    evalJsonnet(request, params, yaml, tempFile, true);

    // Watch all jsonnet files, trigger eval on change
    const watcher = workspace.createFileSystemWatcher('**/*.*sonnet', true, false, true);
    watcher.onDidChange((e) => {
      channel.appendLine(`File changed: ${e.fsPath}, triggering eval`);
      evalJsonnet(request, params, yaml, tempFile, false);
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
}

function evalJsonnet<P>(
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean,
  tempFile: string,
  display = false
): void {
  channel.appendLine(`Sending ${request.method} request: ${JSON.stringify(params)} for ${tempFile}`);
  client
    .sendRequest(request, params)
    .then((result: JsonValue) => {
      let uri = Uri.file(tempFile);
      const serializedResult = JSON.stringify(result, null, 2);
      fs.writeFileSync(tempFile, serializedResult);

      if (yaml) {
        const yamlString = stringifyYaml(result);
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

function evalFileUri(editor: TextEditor): string {
  return editor.document.uri.toString();
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
  const configuredLogLevel = workspace.getConfiguration('jsonnet').get<string | null>('languageServer.logLevel', null);
  const args: string[] = [];
  if (configuredLogLevel) {
    args.push('--log-level', configuredLogLevel);
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
  channel.appendLine(`jrsonnet-lsp will start: '${executable.command} ${executable.args.join(' ')}'`);

  const serverOptions: ServerOptions = {
    run: executable,
    debug: executable,
  };

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    // Register the server for jsonnet files
    documentSelector: [{ scheme: 'file', language: 'jsonnet' }],
    initializationOptions: getLanguageServerSettings(),
  };

  // Create the language client and start the client.
  client = new LanguageClient('jrsonnetLanguageServer', 'jrsonnet-lsp', serverOptions, clientOptions);

  // Start the client. This will also launch the server
  client.start();
}

async function didChangeConfigHandler() {
  if (!client) {
    return;
  }
  client.sendNotification(DidChangeConfigurationNotification.type, {
    settings: getLanguageServerSettings(),
  });
}

function getLanguageServerSettings() {
  const workspaceConfig = workspace.getConfiguration('jsonnet');
  const workspaceRoot = workspace.workspaceFolders?.[0]?.uri.fsPath;
  let jpath: string[] = workspaceConfig.get('languageServer.jpath', []);
  if (workspaceRoot) {
    jpath = jpath.map((p) => (path.isAbsolute(p) ? p : path.join(workspaceRoot, p)));
  }
  const formatting: Record<string, unknown> = {};
  const formattingSettings = [
    { settingKey: 'maxBlankLines', serverKey: 'max_blank_lines' },
    { settingKey: 'stringStyle', serverKey: 'string_style' },
    { settingKey: 'commentStyle', serverKey: 'comment_style' },
    { settingKey: 'padArrays', serverKey: 'pad_arrays' },
    { settingKey: 'padObjects', serverKey: 'pad_objects' },
    { settingKey: 'prettyFieldNames', serverKey: 'pretty_field_names' },
  ] as const;
  for (const setting of formattingSettings) {
    const value = workspaceConfig.get(`languageServer.formatting.${setting.settingKey}`);
    if (value !== undefined) {
      formatting[setting.serverKey] = value;
    }
  }

  return {
    log_level: workspaceConfig.get<string | null>('languageServer.logLevel', null),
    ext_vars: workspaceConfig.get('languageServer.extVars'),
    ext_code: workspaceConfig.get('languageServer.extCode'),
    jpath: jpath,
    resolve_paths_with_tanka: workspaceConfig.get('languageServer.resolvePathsWithTanka'),
    enable_lint_diagnostics: workspaceConfig.get('languageServer.enableLintDiagnostics'),
    enable_eval_diagnostics: workspaceConfig.get('languageServer.enableEvalDiagnostics'),
    formatting: formatting,
    code_actions: {
      removeUnused: workspaceConfig.get('languageServer.codeActions.removeUnused', 'all'),
      removeUnusedComments: workspaceConfig.get('languageServer.codeActions.removeUnusedComments', 'none'),
    },
    inlay_hints: {
      local: workspaceConfig.get('languageServer.inlayHints.local', 'all'),
      objectLocal: workspaceConfig.get('languageServer.inlayHints.objectLocal', 'all'),
      objectMembers: workspaceConfig.get('languageServer.inlayHints.objectMembers', 'off'),
      functionParameters: workspaceConfig.get('languageServer.inlayHints.functionParameters', 'off'),
      anonymousFunctionReturns: workspaceConfig.get('languageServer.inlayHints.anonymousFunctionReturns', 'off'),
      callArguments: workspaceConfig.get('languageServer.inlayHints.callArguments', 'off'),
      comprehensions: workspaceConfig.get('languageServer.inlayHints.comprehensions', 'off'),
      destructuring: workspaceConfig.get('languageServer.inlayHints.destructuring', 'off'),
    },
  };
}

function getActiveEditorUri(): Uri | undefined {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage('No active editor');
    return undefined;
  }
  return editor.document.uri;
}

async function sendLspRequest<P, R>(request: RequestType<P, R, void>, params: P): Promise<R | undefined> {
  if (!client) {
    window.showErrorMessage('Language server is not running');
    return undefined;
  }
  try {
    return await client.sendRequest(request, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    window.showErrorMessage(message);
    return undefined;
  }
}

async function findTransitiveImportersCommand() {
  const uri = getActiveEditorUri();
  if (!uri) {
    return;
  }

  const result = await sendLspRequest(FindTransitiveImportersRequest, {
    textDocument: { uri: uri.toString() },
  });
  const importers = result?.transitiveImporters ?? [];
  if (importers.length === 0) {
    window.showInformationMessage('No transitive importers found');
    return;
  }

  const items = importers.map((importer) => {
    const importerUri = Uri.parse(importer);
    return {
      label: path.basename(importerUri.fsPath) || importer,
      description: importerUri.fsPath || importer,
      importerUri,
    };
  });

  const selected = await window.showQuickPick(items, {
    title: 'Jsonnet: Transitive Importers',
    placeHolder: 'Select an importer to open',
  });
  if (!selected) {
    return;
  }

  const document = await workspace.openTextDocument(selected.importerUri);
  await window.showTextDocument(document);
}
