import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  closeEvalEditors,
  ensureExtensionReady,
  openScenarioDocument,
  waitForValue,
} from './testHarness';

suite('Eval Commands', () => {
  suiteSetup(async () => {
    await ensureExtensionReady();
  });

  teardown(async () => {
    await closeEvalEditors();
  });

  test('evaluates a file as JSON', async () => {
    await openScenarioDocument('jsonnet/ok.jsonnet');
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

    assert.strictEqual(
      text.trim(),
      JSON.stringify(
        {
          source: 'jsonnet/ok.jsonnet',
          value: { greeting: 'hello', target: 'world' },
        },
        null,
        2
      )
    );
  });

  test('evaluates a file as YAML', async () => {
    await openScenarioDocument('tanka/environments/default/main.jsonnet');
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

    assert.ok(text.includes('source: tanka/environments/default/main.jsonnet'));
    assert.ok(text.includes('environment: default'));
    assert.ok(text.includes('kind: tanka'));
  });

  test('surfaces eval errors in the result tab', async () => {
    await openScenarioDocument('jsonnet/invalid_type.jsonnet');
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

    assert.ok(text.includes('RuntimeError: type mismatch'));
  });
});
