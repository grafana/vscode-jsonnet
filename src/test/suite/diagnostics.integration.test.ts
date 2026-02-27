import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  configureJsonnetForTest,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

suite('Diagnostics', () => {
  setup(async () => {
    await configureJsonnetForTest({
      'languageServer.continuousEval': false,
      'languageServer.enableEvalDiagnostics': true,
      'languageServer.enableLintDiagnostics': true,
    });
  });

  test('shows syntax errors as error diagnostics', async () => {
    const relativePath = 'jsonnet/syntax_error.jsonnet';
    const expectedDiagnostics = expectedDiagnosticsFor(relativePath);
    const document = await openScenarioDocument(relativePath);

    const diagnostics = await waitForValue(() => {
      const current = comparableDiagnostics(
        vscode.languages.getDiagnostics(document.uri)
      );
      return current.length === expectedDiagnostics.length ? current : undefined;
    });

    assert.deepStrictEqual(diagnostics, expectedDiagnostics);
  });

  test('shows lint warnings as warning diagnostics', async () => {
    const relativePath = 'jsonnet/unused_variable.jsonnet';
    const expectedDiagnostics = expectedDiagnosticsFor(relativePath);
    const document = await openScenarioDocument(relativePath);

    const diagnostics = await waitForValue(() => {
      const current = comparableDiagnostics(
        vscode.languages.getDiagnostics(document.uri)
      );
      return current.length === expectedDiagnostics.length ? current : undefined;
    });

    assert.deepStrictEqual(diagnostics, expectedDiagnostics);
  });
});

type ComparableDiagnostic = {
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

function expectedDiagnosticsFor(relativePath: string): ComparableDiagnostic[] {
  const expected = readScenarioExpected(relativePath);

  return (expected.diagnostics ?? []).map((diagnostic) => ({
    range: diagnostic.range,
    severity: diagnostic.severity,
    source: diagnostic.source,
    message: diagnostic.message,
  }));
}

function comparableDiagnostics(
  diagnostics: readonly vscode.Diagnostic[]
): ComparableDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    range: {
      start: {
        line: diagnostic.range.start.line,
        character: diagnostic.range.start.character,
      },
      end: {
        line: diagnostic.range.end.line,
        character: diagnostic.range.end.character,
      },
    },
    severity: toLspSeverity(diagnostic.severity),
    source: diagnostic.source,
    message: diagnostic.message,
  }));
}

function toLspSeverity(severity: vscode.DiagnosticSeverity): number {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 1;
    case vscode.DiagnosticSeverity.Warning:
      return 2;
    case vscode.DiagnosticSeverity.Information:
      return 3;
    case vscode.DiagnosticSeverity.Hint:
      return 4;
    default:
      return 1;
  }
}
