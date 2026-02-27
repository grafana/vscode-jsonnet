import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  commands,
  window,
  workspace,
  Uri,
  TextEditor,
  ViewColumn,
  CancellationTokenSource,
  OutputChannel,
} from 'vscode';
import { LanguageClient, RequestType } from 'vscode-languageclient/node';
import { stringify as stringifyYaml } from 'yaml';
import {
  EvalExpressionRequest,
  EvalFileRequest,
  JsonValue,
} from './lspRequests';

const evalFileName = 'jsonnet-eval-result';

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

type GetClient = () => LanguageClient | undefined;

type EvalCommandOptions = {
  channel: OutputChannel;
  getClient: GetClient;
};

export function createEvalCommand(
  options: EvalCommandOptions,
  yaml: boolean,
  promptExpr = false
) {
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
      await executeEvalRequest(
        options,
        EvalFileRequest,
        { textDocument: { uri: currentFileUri } },
        yaml
      );
    } else {
      await executeEvalRequest(
        options,
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
  options: EvalCommandOptions,
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean
): Promise<void> {
  // Close previous result tab (named jsonnet-eval-result)
  for (const editor of window.visibleTextEditors) {
    if (editor.document.fileName.includes(evalFileName)) {
      options.channel.appendLine(`Closing previous result tab ${editor.document.fileName}`);
      await window.showTextDocument(editor.document, {
        preview: false,
        viewColumn: ViewColumn.Beside,
      });
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
        options.channel.appendLine(`Failed to delete eval temp file: ${message}`);
      }
    }
    try {
      await fs.promises.rmdir(tempOutput.tempDir);
    } catch (err) {
      if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) {
        const message = err instanceof Error ? err.message : String(err);
        options.channel.appendLine(`Failed to delete eval temp directory: ${message}`);
      }
    }
  };

  const closeDisposable = workspace.onDidCloseTextDocument((document) => {
    if (document.uri.fsPath !== uri.fsPath) {
      return;
    }
    options.channel.appendLine(
      `Closed result tab, stopping watcher and deleting temp output ${tempFile}`
    );
    void cleanup();
    closeDisposable.dispose();
  });

  await fs.promises.writeFile(tempFile, '"Evaluating..."');

  const triggerEval = (display: boolean) => {
    const activeClient = options.getClient();
    if (!activeClient) {
      window.showErrorMessage('Language server is not running');
      return;
    }
    void evalJsonnet(
      options,
      activeClient,
      request,
      params,
      yaml,
      tempFile,
      display,
      session
    );
  };

  const continuousEval = workspace
    .getConfiguration('jsonnet')
    .get('languageServer.continuousEval');
  if (continuousEval === false) {
    watcher.dispose();
    triggerEval(true);
    return;
  }

  triggerEval(true);
  watcher.onDidChange((e) => {
    options.channel.appendLine(`File changed: ${e.fsPath}, triggering eval`);
    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
    }
    session.debounceTimer = setTimeout(() => {
      triggerEval(false);
    }, 200);
  });
}

async function evalJsonnet<P>(
  options: EvalCommandOptions,
  client: LanguageClient,
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean,
  tempFile: string,
  display: boolean,
  session: EvalSession
): Promise<void> {
  const requestId = session.latestRequestId + 1;
  session.latestRequestId = requestId;
  session.inFlightRequest?.cancel();
  session.inFlightRequest?.dispose();

  const cancellationSource = new CancellationTokenSource();
  session.inFlightRequest = cancellationSource;
  options.channel.appendLine(
    `Sending ${request.method} request ${requestId}: ` +
      `${JSON.stringify(params)} for ${tempFile}`
  );

  try {
    const result: JsonValue = await client.sendRequest(
      request,
      params,
      cancellationSource.token
    );
    if (
      requestId !== session.latestRequestId ||
      cancellationSource.token.isCancellationRequested
    ) {
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
    if (
      requestId !== session.latestRequestId ||
      cancellationSource.token.isCancellationRequested
    ) {
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
