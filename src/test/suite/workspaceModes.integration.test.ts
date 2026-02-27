import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  closeEvalEditors,
  configureJsonnetForTest,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

import {
  expectedDiagnosticsFor,
  waitForDiagnostics,
} from './diagnosticsTestUtils';

suite('Workspace Modes', () => {
  teardown(async () => {
    await closeEvalEditors();
  });

  const tankaCases: TankaCase[] = [
    {
      name: 'tanka mode false leaves non-relative imports unresolved',
      relativePath: 'tanka-modes/false/environments/default/main.jsonnet',
      mode: 'false',
    },
    {
      name: 'tanka mode auto resolves imports via tanka root',
      relativePath: 'tanka-modes/auto/environments/default/main.jsonnet',
      mode: 'auto',
    },
    {
      name: 'tanka mode true resolves imports via tanka root',
      relativePath: 'tanka-modes/true/environments/default/main.jsonnet',
      mode: 'true',
    },
  ];

  for (const tc of tankaCases) {
    test(tc.name, async () => {
      await configureJsonnetForTest({
        'languageServer.continuousEval': false,
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': false,
        'languageServer.resolvePathsWithTanka': tc.mode,
      });

      const expected = readScenarioExpected(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const expectedDiagnostics = expectedDiagnosticsFor(tc.relativePath);
      const diagnostics = await waitForDiagnostics(document.uri, expectedDiagnostics);

      assert.deepStrictEqual(diagnostics, expectedDiagnostics);

      if (!expected.evalFile?.result) {
        return;
      }

      await vscode.commands.executeCommand('jsonnet.evalFile');
      const resultText = await readEvalResultText();
      const actual = JSON.parse(resultText);

      assert.deepStrictEqual(actual, expected.evalFile.result);
    });
  }
});

type TankaCase = {
  name: string;
  relativePath: string;
  mode: 'false' | 'auto' | 'true';
};

async function readEvalResultText(): Promise<string> {
  const editor = await waitForValue(() => {
    return vscode.window.visibleTextEditors.find(
      (item) => item.document.uri.scheme === 'jsonnet-eval'
    );
  });

  return waitForValue(() => {
    const value = editor.document.getText();
    if (value.includes('Evaluating')) {
      return undefined;
    }
    return value;
  });
}
