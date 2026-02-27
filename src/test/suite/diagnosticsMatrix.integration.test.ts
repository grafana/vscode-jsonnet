import * as assert from 'assert';

import {
  configureJsonnetForTest,
  openScenarioDocument,
} from './testHarness';

import {
  expectedDiagnosticsFor,
  waitForDiagnostics,
} from './diagnosticsTestUtils';

suite('Diagnostics Matrix', () => {
  const lintTypeCases: DiagnosticsCase[] = [
    {
      name: 'stdlib wrong arg count reports a type diagnostic',
      relativePath: 'language/diagnostics-matrix/wrong_arg_count.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': true,
      },
    },
    {
      name: 'local function wrong named arg reports a type diagnostic',
      relativePath: 'language/diagnostics-matrix/wrong_named_arg.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': true,
      },
    },
    {
      name: 'unknown field access reports a type diagnostic',
      relativePath: 'language/diagnostics-matrix/unknown_field_access.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': true,
      },
    },
    {
      name: 'indexing a non-indexable value reports a type diagnostic',
      relativePath: 'language/diagnostics-matrix/index_non_indexable.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': true,
      },
    },
  ];

  for (const tc of lintTypeCases) {
    test(tc.name, async () => {
      await configure(tc.settings);

      const expectedDiagnostics = expectedDiagnosticsFor(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const diagnostics = await waitForDiagnostics(document.uri, expectedDiagnostics);
      assert.deepStrictEqual(diagnostics, expectedDiagnostics);
    });
  }

  const modeCases: DiagnosticsCase[] = [
    {
      name: 'lint channel can be enabled while eval is disabled',
      relativePath: 'language/diagnostics-matrix/mode_lint_enabled.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': true,
      },
    },
    {
      name: 'eval channel can be enabled while lint is disabled',
      relativePath: 'language/diagnostics-matrix/mode_eval_enabled.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': true,
        'languageServer.enableLintDiagnostics': false,
      },
    },
    {
      name: 'both diagnostic channels can be disabled',
      relativePath: 'language/diagnostics-matrix/mode_all_disabled.jsonnet',
      settings: {
        'languageServer.enableEvalDiagnostics': false,
        'languageServer.enableLintDiagnostics': false,
      },
    },
  ];

  for (const tc of modeCases) {
    test(tc.name, async () => {
      await configure(tc.settings);

      const expectedDiagnostics = expectedDiagnosticsFor(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const diagnostics = await waitForDiagnostics(document.uri, expectedDiagnostics);
      assert.deepStrictEqual(diagnostics, expectedDiagnostics);
    });
  }
});

type DiagnosticsCase = {
  name: string;
  relativePath: string;
  settings: Record<string, unknown>;
};

async function configure(settings: Record<string, unknown>): Promise<void> {
  await configureJsonnetForTest({
    'languageServer.continuousEval': false,
    ...settings,
  });
}
