import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  ensureExtensionReady,
  openScenarioDocument,
  waitForValue,
} from './testHarness';

suite('Diagnostics', () => {
  suiteSetup(async () => {
    await ensureExtensionReady();
  });

  test('shows type errors as error diagnostics', async () => {
    const document = await openScenarioDocument('jsonnet/invalid_type.jsonnet');

    const diagnostics = await waitForValue(() => {
      const current = vscode.languages.getDiagnostics(document.uri);
      return current.length > 0 ? current : undefined;
    });

    assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
    assert.ok(diagnostics[0].message.includes('Type mismatch'));
  });

  test('shows non-fatal issues as warning diagnostics', async () => {
    const document = await openScenarioDocument(
      'jsonnet/deprecated_field.jsonnet'
    );

    const diagnostics = await waitForValue(() => {
      const current = vscode.languages.getDiagnostics(document.uri);
      return current.length > 0 ? current : undefined;
    });

    assert.strictEqual(
      diagnostics[0].severity,
      vscode.DiagnosticSeverity.Warning
    );
    assert.ok(diagnostics[0].message.includes('Deprecated field'));
  });
});
