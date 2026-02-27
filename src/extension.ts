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
  CancellationTokenSource,
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
let client: LanguageClient | undefined;
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

type EvalSession = {
  latestRequestId: number;
  inFlightRequest: CancellationTokenSource | undefined;
  debounceTimer: ReturnType<typeof setTimeout> | undefined;
};

type TempEvalOutput = {
  tempDir: string;
  tempFile: string;
  uri: Uri;
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
      await stopClient();
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

async function createTmpFile(yaml: boolean): Promise<TempEvalOutput> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jsonnet-eval'));
  const fileEnding = yaml ? 'yaml' : 'json';
  const tempFile = path.join(tempDir, `${evalFileName}.${fileEnding}`);
  return {
    tempDir,
    tempFile,
    uri: Uri.file(tempFile),
  };
}

async function executeEvalRequest<P>(
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean
): Promise<void> {
  if (!client) {
    window.showErrorMessage('Language server is not running');
    return;
  }

  // Close previous result tab (named jsonnet-eval-result)
  for (const editor of window.visibleTextEditors) {
    if (editor.document.fileName.includes(evalFileName)) {
      channel.appendLine(`Closing previous result tab ${editor.document.fileName}`);
      await window.showTextDocument(editor.document, { preview: false, viewColumn: ViewColumn.Beside });
      await commands.executeCommand('workbench.action.closeActiveEditor');
    }
  }

  const tempOutput = await createTmpFile(yaml);
  const tempFile = tempOutput.tempFile;
  const uri = tempOutput.uri;
  const session: EvalSession = {
    latestRequestId: 0,
    inFlightRequest: undefined,
    debounceTimer: undefined,
  };
  const watcher = workspace.createFileSystemWatcher('**/*.*sonnet', true, false, true);
  let cleanedUp = false;

  const cleanup = async () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    watcher.dispose();
    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = undefined;
    }
    session.inFlightRequest?.cancel();
    session.inFlightRequest?.dispose();
    session.inFlightRequest = undefined;
    try {
      await fs.promises.unlink(tempOutput.tempFile);
    } catch (err) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) {
        const message = err instanceof Error ? err.message : String(err);
        channel.appendLine(`Failed to delete eval temp file: ${message}`);
      }
    }
    try {
      await fs.promises.rmdir(tempOutput.tempDir);
    } catch (err) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) {
        const message = err instanceof Error ? err.message : String(err);
        channel.appendLine(`Failed to delete eval temp directory: ${message}`);
      }
    }
  };

  const closeDisposable = workspace.onDidCloseTextDocument((document) => {
    if (document.uri.fsPath !== uri.fsPath) {
      return;
    }
    channel.appendLine(`Closed result tab, stopping watcher and deleting temp output ${tempFile}`);
    void cleanup();
    closeDisposable.dispose();
  });

  await fs.promises.writeFile(tempFile, '"Evaluating..."');

  if (workspace.getConfiguration('jsonnet').get('languageServer.continuousEval') === false) {
    watcher.dispose();
    void evalJsonnet(request, params, yaml, tempFile, true, session);
  } else {
    // Initial eval
    void evalJsonnet(request, params, yaml, tempFile, true, session);

    // Watch all jsonnet files, trigger eval on change
    watcher.onDidChange((e) => {
      channel.appendLine(`File changed: ${e.fsPath}, triggering eval`);
      if (session.debounceTimer) {
        clearTimeout(session.debounceTimer);
      }
      session.debounceTimer = setTimeout(() => {
        void evalJsonnet(request, params, yaml, tempFile, false, session);
      }, 200);
    });
  }
}

async function evalJsonnet<P>(
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean,
  tempFile: string,
  display = false,
  session: EvalSession
): Promise<void> {
  const activeClient = client;
  if (!activeClient) {
    window.showErrorMessage('Language server is not running');
    return;
  }
  const requestId = session.latestRequestId + 1;
  session.latestRequestId = requestId;
  session.inFlightRequest?.cancel();
  session.inFlightRequest?.dispose();

  const cancellationSource = new CancellationTokenSource();
  session.inFlightRequest = cancellationSource;
  channel.appendLine(`Sending ${request.method} request ${requestId}: ${JSON.stringify(params)} for ${tempFile}`);

  try {
    const result: JsonValue = await activeClient.sendRequest(request, params, cancellationSource.token);
    if (requestId !== session.latestRequestId || cancellationSource.token.isCancellationRequested) {
      return;
    }
    let uri = Uri.file(tempFile);
    const serializedResult = JSON.stringify(result, null, 2);
    await fs.promises.writeFile(tempFile, serializedResult);

    if (yaml) {
      const yamlString = stringifyYaml(result);
      uri = Uri.file(tempFile);
      await fs.promises.writeFile(tempFile, yamlString);
    }
    if (display) {
      window.showTextDocument(uri, {
        preview: true,
        viewColumn: ViewColumn.Beside,
        preserveFocus: true,
      });
    }
  } catch (err) {
    if (requestId !== session.latestRequestId || cancellationSource.token.isCancellationRequested) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    window.showErrorMessage(message);
    await fs.promises.writeFile(tempFile, message);
    if (display) {
      const uri = Uri.file(tempFile);
      window.showTextDocument(uri, {
        preview: true,
        viewColumn: ViewColumn.Beside,
        preserveFocus: true,
      });
    }
  } finally {
    cancellationSource.dispose();
    if (session.inFlightRequest === cancellationSource) {
      session.inFlightRequest = undefined;
    }
  }
}

function evalFileUri(editor: TextEditor): string {
  return editor.document.uri.toString();
}

export function deactivate(): Thenable<void> | undefined {
  return stopClient();
}

async function installDebugger(context: ExtensionContext): Promise<void> {
  const binPath = await install(extensionContext, channel, 'debugger');
  if (!binPath) {
    return;
  }
  debug.registerDebugAdapterDescriptorFactory('jsonnet', new JsonnetDebugAdapterDescriptorFactory(context, binPath));
}

async function startClient(): Promise<void> {
  if (client) {
    return;
  }
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

async function stopClient(): Promise<void> {
  if (!client) {
    return;
  }
  const activeClient = client;
  client = undefined;
  await activeClient.stop();
  activeClient.outputChannel.dispose();
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
