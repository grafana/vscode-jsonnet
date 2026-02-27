import * as assert from 'assert';
import {
  configureJsonnetForTest,
  openScenarioDocument,
} from './testHarness';
import { ComparableDiagnostic } from './diagnosticUtils';
import {
  expectedDiagnosticsFor,
  waitForDiagnostics,
} from './diagnosticsTestUtils';

suite('Diagnostics', () => {
  const diagnosticsCases: DiagnosticsCase[] = [
    {
      name: 'shows syntax errors as error diagnostics',
      relativePath: 'diagnostics/jsonnet/syntax_error.jsonnet',
    },
    {
      name: 'shows lint warnings as warning diagnostics',
      relativePath: 'diagnostics/jsonnet/unused_variable.jsonnet',
    },
    {
      name: 'shows stdlib type mismatch diagnostics',
      relativePath: 'language/diagnostics/type_stdlib_mismatch.jsonnet',
    },
    {
      name: 'shows local function runtime type diagnostics',
      relativePath: 'language/diagnostics/type_local_runtime_error.jsonnet',
    },
  ];

  setup(async () => {
    await configureJsonnetForTest({
      'languageServer.continuousEval': false,
      'languageServer.enableEvalDiagnostics': true,
      'languageServer.enableLintDiagnostics': true,
    });
  });

  for (const tc of diagnosticsCases) {
    test(tc.name, async () => {
      const expectedDiagnostics = scenarioExpectedDiagnosticsFor(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const diagnostics = await waitForDiagnostics(
        document.uri,
        expectedDiagnostics
      );

      assert.deepStrictEqual(diagnostics, expectedDiagnostics);
    });
  }
});

type DiagnosticsCase = {
  name: string;
  relativePath: string;
};

function scenarioExpectedDiagnosticsFor(relativePath: string): ComparableDiagnostic[] {
  return expectedDiagnosticsFor(relativePath);
}
