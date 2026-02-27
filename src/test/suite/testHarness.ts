import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

let ready: Promise<void> | undefined;

type ScenarioEvalResult = {
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

type ScenarioExpressionExpectations = Record<string, ScenarioEvalResult>;

type ScenarioDiagnostic = {
  range: {
    start: {
      line: number;
      character: number;
    };
    end: {
      line: number;
      character: number;
    };
  };
  severity: number;
  source?: string;
  message: string;
};

export type ScenarioExpected = {
  evalFile?: ScenarioEvalResult;
  evalExpression?: ScenarioExpressionExpectations;
  diagnostics?: ScenarioDiagnostic[];
  findTransitiveImporters?: string[];
};

export async function ensureExtensionReady(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const root = scenarioRoot();
      const languageServerPath = resolveLanguageServerPath(root);
      const fakeDebugger = fakeToolPath(root, 'fake-jsonnet-debugger');

      const config = vscode.workspace.getConfiguration('jsonnet');
      await config.update(
        'languageServer.enableAutoUpdate',
        false,
        vscode.ConfigurationTarget.Workspace
      );
      await config.update(
        'languageServer.pathToBinary',
        languageServerPath,
        vscode.ConfigurationTarget.Workspace
      );
      await config.update(
        'languageServer.continuousEval',
        false,
        vscode.ConfigurationTarget.Workspace
      );
      await config.update(
        'debugger.enableAutoUpdate',
        false,
        vscode.ConfigurationTarget.Workspace
      );
      await config.update(
        'debugger.pathToBinary',
        fakeDebugger,
        vscode.ConfigurationTarget.Workspace
      );

      const extension = findExtension();
      await extension.activate();
    })();
  }

  await ready;
}

export function scenarioRoot(): string {
  const [folder] = vscode.workspace.workspaceFolders ?? [];
  assert.ok(folder, 'expected a test workspace folder');
  return folder.uri.fsPath;
}

export function isRealLspMode(): boolean {
  return process.env.JSONNET_TEST_REAL_LSP === '1';
}

export function readScenarioExpected(relativePath: string): ScenarioExpected {
  const scenarioPath = path.join(scenarioRoot(), relativePath);
  const expectedPath = `${scenarioPath}.expected.json`;

  if (!fs.existsSync(expectedPath)) {
    return {};
  }

  const content = fs.readFileSync(expectedPath, 'utf8');
  return JSON.parse(content) as ScenarioExpected;
}

export async function openScenarioDocument(
  relativePath: string
): Promise<vscode.TextDocument> {
  const uri = vscode.Uri.file(path.join(scenarioRoot(), relativePath));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  return document;
}

export async function closeEvalEditors(): Promise<void> {
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme !== 'jsonnet-eval') {
      continue;
    }

    await vscode.window.showTextDocument(editor.document, {
      preview: false,
      preserveFocus: false,
    });
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  }
}

export async function waitForValue<T>(
  provider: () => T | undefined,
  timeoutMs = 15000,
  pollMs = 50
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = provider();
    if (value !== undefined) {
      return value;
    }
    await delay(pollMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeToolPath(root: string, baseName: string): string {
  const filename = process.platform === 'win32'
    ? `${baseName}.cmd`
    : baseName;
  return path.join(root, '.tools', filename);
}

function resolveLanguageServerPath(root: string): string {
  const configuredPath = process.env.JSONNET_LSP_SERVER;
  const realMode = process.env.JSONNET_TEST_REAL_LSP === '1';

  if (realMode && !configuredPath) {
    throw new Error(
      'JSONNET_LSP_SERVER must be set when running real integration tests'
    );
  }

  if (!configuredPath) {
    return fakeToolPath(root, 'fake-jrsonnet-lsp');
  }

  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(root, configuredPath);
}

function findExtension(): vscode.Extension<unknown> {
  const extension =
    vscode.extensions.getExtension('grafana.vscode-jsonnet') ??
    vscode.extensions.getExtension('Grafana.vscode-jsonnet') ??
    vscode.extensions.all.find((item) => item.packageJSON?.name === 'vscode-jsonnet');

  assert.ok(extension, 'failed to locate vscode-jsonnet extension under test');
  return extension;
}
