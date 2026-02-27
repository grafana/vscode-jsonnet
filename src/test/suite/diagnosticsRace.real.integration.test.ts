import * as assert from 'assert';
import { isDeepStrictEqual } from 'util';
import * as vscode from 'vscode';

import {
  configureJsonnetForTest,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

import {
  normalizeScenarioDiagnostics,
  normalizeVscodeDiagnostics,
} from './diagnosticUtils';

suite('Diagnostics Race (Real LSP)', () => {
  test('rapid document churn settles to diagnostics for final content', async function () {
    if (process.env.JSONNET_TEST_REAL_LSP !== '1') {
      this.skip();
    }

    await configureJsonnetForTest({
      'languageServer.continuousEval': false,
      'languageServer.enableEvalDiagnostics': false,
      'languageServer.enableLintDiagnostics': true,
    });

    const expected = readScenarioExpected(
      'language/diagnostics-matrix/mode_lint_enabled.jsonnet'
    );

    const expectedDiagnostics = normalizeScenarioDiagnostics(expected.diagnostics);

    const document = await openScenarioDocument('language/race/churn.jsonnet');

    const edits = [
      'std.length(1)\n',
      'local x = 1;\nx[0]\n',
      '{\n  ok: true,\n}\n',
      'local getFoo(x) = x.foo;\ngetFoo(1)\n',
      'std.length(1)\n',
    ];

    for (const text of edits) {
      await replaceWholeDocument(document.uri, text);
    }

    const diagnostics = await waitForValue(() => {
      const current = normalizeVscodeDiagnostics(
        vscode.languages.getDiagnostics(document.uri)
      );

      if (current.length === 0) {
        return undefined;
      }

      return isDeepStrictEqual(current, expectedDiagnostics)
        ? current
        : undefined;
    }, 20000, 50);

    assert.deepStrictEqual(diagnostics, expectedDiagnostics);
  });
});

async function replaceWholeDocument(uri: vscode.Uri, text: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);

  const start = document.positionAt(0);
  const end = document.positionAt(document.getText().length);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(start, end), text);

  const applied = await vscode.workspace.applyEdit(edit);
  assert.strictEqual(applied, true);
}
