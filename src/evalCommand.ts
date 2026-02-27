import {
  commands,
  window,
  workspace,
  Uri,
  TextEditor,
  ViewColumn,
  CancellationTokenSource,
  OutputChannel,
  Event,
  EventEmitter,
  TextDocumentContentProvider,
  ExtensionContext,
} from 'vscode';
import { LanguageClient, RequestType } from 'vscode-languageclient/node';
import { stringify as stringifyYaml } from 'yaml';
import {
  EvalExpressionRequest,
  EvalFileRequest,
  JsonValue,
} from './lspRequests';


const evalFileName = 'jsonnet-eval-result';
const evalResultScheme = 'jsonnet-eval';


type EvalSession = {
  latestRequestId: number;
  inFlightRequest: CancellationTokenSource | undefined;
  debounceTimer: ReturnType<typeof setTimeout> | undefined;
};


type GetClient = () => LanguageClient | undefined;


export type EvalResultStore = {
  createUri(yaml: boolean): Uri;
  setContent(uri: Uri, content: string): void;
  delete(uri: Uri): void;
  has(uri: Uri): boolean;
};


type EvalCommandOptions = {
  channel: OutputChannel;
  getClient: GetClient;
  resultStore: EvalResultStore;
};


export function registerEvalResultStore(
  context: ExtensionContext
): EvalResultStore {
  const contents = new Map<string, string>();
  const changeEmitter = new EventEmitter<Uri>();
  let nextId = 0;

  const provider: TextDocumentContentProvider = {
    get onDidChange(): Event<Uri> {
      return changeEmitter.event;
    },

    provideTextDocumentContent(uri: Uri): string {
      return contents.get(uri.toString()) ?? '';
    },
  };

  context.subscriptions.push(
    changeEmitter,
    workspace.registerTextDocumentContentProvider(evalResultScheme, provider)
  );

  return {
    createUri(yaml: boolean): Uri {
      const id = nextId;
      nextId += 1;

      const extension = yaml ? 'yaml' : 'json';
      return Uri.parse(`${evalResultScheme}:/${evalFileName}-${id}.${extension}`);
    },

    setContent(uri: Uri, content: string): void {
      contents.set(uri.toString(), content);
      changeEmitter.fire(uri);
    },

    delete(uri: Uri): void {
      contents.delete(uri.toString());
      changeEmitter.fire(uri);
    },

    has(uri: Uri): boolean {
      return contents.has(uri.toString());
    },
  };
}


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


async function executeEvalRequest<P>(
  options: EvalCommandOptions,
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean
): Promise<void> {
  await closePreviousEvalTabs(options.channel);

  const resultUri = options.resultStore.createUri(yaml);
  options.resultStore.setContent(resultUri, '"Evaluating..."');

  await showResultDocument(resultUri);

  const session: EvalSession = {
    latestRequestId: 0,
    inFlightRequest: undefined,
    debounceTimer: undefined,
  };

  const continuousEval = workspace
    .getConfiguration('jsonnet')
    .get('languageServer.continuousEval');

  let watcher: ReturnType<typeof workspace.createFileSystemWatcher> | undefined;
  if (continuousEval !== false) {
    watcher = workspace.createFileSystemWatcher('**/*.*sonnet', true, false, true);
  }

  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;

    watcher?.dispose();

    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
      session.debounceTimer = undefined;
    }

    session.inFlightRequest?.cancel();
    session.inFlightRequest?.dispose();
    session.inFlightRequest = undefined;

    options.resultStore.delete(resultUri);
  };

  const closeDisposable = workspace.onDidCloseTextDocument((document) => {
    if (document.uri.toString() !== resultUri.toString()) {
      return;
    }

    options.channel.appendLine(
      `Closed result tab, stopping watcher for ${resultUri.toString()}`
    );

    cleanup();
    closeDisposable.dispose();
  });

  const triggerEval = () => {
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
      resultUri,
      session
    );
  };

  triggerEval();

  watcher?.onDidChange((e) => {
    options.channel.appendLine(`File changed: ${e.fsPath}, triggering eval`);

    if (session.debounceTimer) {
      clearTimeout(session.debounceTimer);
    }

    session.debounceTimer = setTimeout(() => {
      triggerEval();
    }, 200);
  });
}


async function closePreviousEvalTabs(channel: OutputChannel): Promise<void> {
  for (const editor of window.visibleTextEditors) {
    if (editor.document.uri.scheme !== evalResultScheme) {
      continue;
    }

    if (!editor.document.fileName.includes(evalFileName)) {
      continue;
    }

    channel.appendLine(`Closing previous result tab ${editor.document.fileName}`);

    await window.showTextDocument(editor.document, {
      preview: false,
      viewColumn: ViewColumn.Beside,
    });

    await commands.executeCommand('workbench.action.closeActiveEditor');
  }
}


async function showResultDocument(uri: Uri): Promise<void> {
  const document = await workspace.openTextDocument(uri);
  await window.showTextDocument(document, {
    preview: true,
    viewColumn: ViewColumn.Beside,
    preserveFocus: true,
  });
}


async function evalJsonnet<P>(
  options: EvalCommandOptions,
  client: LanguageClient,
  request: RequestType<P, JsonValue, void>,
  params: P,
  yaml: boolean,
  resultUri: Uri,
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
      `${JSON.stringify(params)} for ${resultUri.toString()}`
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

    const serializedResult = yaml
      ? stringifyYaml(result)
      : JSON.stringify(result, null, 2);

    options.resultStore.setContent(resultUri, serializedResult);
  } catch (err) {
    if (
      requestId !== session.latestRequestId ||
      cancellationSource.token.isCancellationRequested
    ) {
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    window.showErrorMessage(message);
    options.resultStore.setContent(resultUri, message);
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
