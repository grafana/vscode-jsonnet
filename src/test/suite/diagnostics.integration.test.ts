import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  ensureExtensionReady,
  isRealLspMode,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

suite('Diagnostics', () => {
  suiteSetup(async function () {
    await ensureExtensionReady();

    if (isRealLspMode()) {
      this.skip();
    }
  });

  test('shows type errors as error diagnostics', async () => {
    const relativePath = 'jsonnet/invalid_type.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const firstExpected = expected.diagnostics?.[0];
    const document = await openScenarioDocument(relativePath);

    const diagnostics = await waitForValue(() => {
      const current = vscode.languages.getDiagnostics(document.uri);
      return current.length > 0 ? current : undefined;
    });

    assert.strictEqual(
      diagnostics[0].severity,
      toVscodeSeverity(firstExpected?.severity)
    );
    assert.ok(
      diagnostics[0].message.includes(firstExpected?.message || 'Type mismatch')
    );
  });

  test('shows non-fatal issues as warning diagnostics', async () => {
    const relativePath = 'jsonnet/deprecated_field.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const firstExpected = expected.diagnostics?.[0];
    const document = await openScenarioDocument(relativePath);

    const diagnostics = await waitForValue(() => {
      const current = vscode.languages.getDiagnostics(document.uri);
      return current.length > 0 ? current : undefined;
    });

    assert.strictEqual(
      diagnostics[0].severity,
      toVscodeSeverity(firstExpected?.severity)
    );
    assert.ok(
      diagnostics[0].message.includes(firstExpected?.message || 'Deprecated')
    );
  });
});

function toVscodeSeverity(value: number | undefined): vscode.DiagnosticSeverity {
  switch (value) {
    case 1:
      return vscode.DiagnosticSeverity.Error;
    case 2:
      return vscode.DiagnosticSeverity.Warning;
    case 3:
      return vscode.DiagnosticSeverity.Information;
    case 4:
      return vscode.DiagnosticSeverity.Hint;
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}
