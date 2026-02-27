import * as assert from 'assert';
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import {
  closeEvalEditors,
  configureJsonnetForTest,
  isRealLspMode,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

suite('Eval Commands', () => {
  setup(async () => {
    await configureJsonnetForTest({
      'languageServer.continuousEval': false,
      'languageServer.enableEvalDiagnostics': false,
      'languageServer.enableLintDiagnostics': false,
    });
  });

  teardown(async () => {
    await closeEvalEditors();
  });

  test('evaluates a file as JSON', async () => {
    const relativePath = 'eval/jsonnet/ok.jsonnet';
    const expected = readScenarioExpected(relativePath);

    await openScenarioDocument(relativePath);
    await vscode.commands.executeCommand('jsonnet.evalFile');

    const editor = await waitForValue(() => {
      return vscode.window.visibleTextEditors.find(
        (item) => item.document.uri.scheme === 'jsonnet-eval'
      );
    });

    const text = await waitForValue(() => {
      const value = editor.document.getText();
      if (value.trim() === '"Evaluating..."') {
        return undefined;
      }
      return value;
    });

    const actual = JSON.parse(text);

    if (isRealLspMode()) {
      assert.ok(typeof actual === 'object' && actual !== null);
      return;
    }

    assert.deepStrictEqual(actual, expected.evalFile?.result);
  });

  test('evaluates a file as YAML', async () => {
    const relativePath = 'eval/tanka/environments/default/main.jsonnet';
    const expected = readScenarioExpected(relativePath);

    await openScenarioDocument(relativePath);
    await vscode.commands.executeCommand('jsonnet.evalFileYaml');

    const editor = await waitForValue(() => {
      return vscode.window.visibleTextEditors.find(
        (item) => item.document.uri.scheme === 'jsonnet-eval'
      );
    });

    const text = await waitForValue(() => {
      const value = editor.document.getText();
      if (value.trim() === '"Evaluating..."') {
        return undefined;
      }
      return value;
    });

    const actual = parseYaml(text);

    if (isRealLspMode()) {
      assert.ok(typeof actual === 'object' && actual !== null);
      return;
    }

    assert.deepStrictEqual(actual, expected.evalFile?.result);
  });

  test('surfaces eval errors in the result tab', async () => {
    const relativePath = 'eval/jsonnet/invalid_type.jsonnet';
    const expected = readScenarioExpected(relativePath);

    await openScenarioDocument(relativePath);
    await vscode.commands.executeCommand('jsonnet.evalFile');

    const editor = await waitForValue(() => {
      return vscode.window.visibleTextEditors.find(
        (item) => item.document.uri.scheme === 'jsonnet-eval'
      );
    });

    const text = await waitForValue(() => {
      const value = editor.document.getText();
      if (value.includes('Evaluating')) {
        return undefined;
      }
      return value;
    });

    if (isRealLspMode()) {
      assert.notStrictEqual(text.trim(), '');
      return;
    }

    assert.ok(text.includes(expected.evalFile?.error?.message || 'error'));
  });
});
