import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  normalizeScenarioDiagnostics,
} from './diagnosticUtils';

import {
  normalizeCodeActions,
  normalizeExpectedWorkspaceEdit,
  normalizeHovers,
  normalizeLocations,
  normalizeWorkspaceEdit,
} from './languageFeatureNormalization';

import {
  applyComparableEdits,
  applyTextEdits,
} from './languageFeatureTextEdits';

import {
  ComparableEdit,
} from './languageFeatureTypes';

import {
  configureJsonnetForTest,
  openScenarioDocument,
  readScenarioExpected,
} from './testHarness';

import {
  waitForDiagnostics,
} from './diagnosticsTestUtils';

suite('Language Navigation and Editing', () => {
  setup(async () => {
    await configureJsonnetForTest({
      'languageServer.continuousEval': false,
      'languageServer.enableEvalDiagnostics': true,
      'languageServer.enableLintDiagnostics': true,

      'languageServer.codeActions.removeUnused': 'all',
      'languageServer.codeActions.removeUnusedComments': 'none',

      'languageServer.formatting.maxBlankLines': 2,
      'languageServer.formatting.stringStyle': 'single',
      'languageServer.formatting.commentStyle': 'leave',
      'languageServer.formatting.padArrays': false,
      'languageServer.formatting.padObjects': true,
      'languageServer.formatting.prettyFieldNames': true,
    });
  });

  const hoverCases: HoverCase[] = [
    {
      name: 'hover shows stdlib symbol signature',
      relativePath: 'language/hover/stdlib_symbol.jsonnet',
      position: new vscode.Position(0, 5),
    },
    {
      name: 'hover shows object field type',
      relativePath: 'language/hover/object_field.jsonnet',
      position: new vscode.Position(1, 5),
    },
    {
      name: 'hover shows import alias type',
      relativePath: 'language/hover/import_alias.jsonnet',
      position: new vscode.Position(1, 1),
    },
    {
      name: 'hover is empty when no symbol is under cursor',
      relativePath: 'language/hover/no_hover.jsonnet',
      position: new vscode.Position(0, 0),
    },
  ];

  for (const tc of hoverCases) {
    test(tc.name, async () => {
      const expected = readScenarioExpected(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        document.uri,
        tc.position
      );

      const actual = normalizeHovers(hovers);
      const expectedHovers = normalizeHovers(expected.hover ? [expected.hover] : []);

      assert.deepStrictEqual(actual, expectedHovers);
    });
  }

  test('renames symbols across files', async () => {
    const relativePath = 'language/navigation/cross_file_main.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const position = new vscode.Position(2, 12);

    const definition = await vscode.commands.executeCommand<
      vscode.Location | vscode.Location[] | vscode.LocationLink[]
    >('vscode.executeDefinitionProvider', document.uri, position);

    assert.deepStrictEqual(
      normalizeLocations(definition),
      normalizeLocations(expected.definition)
    );

    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      position
    );

    assert.deepStrictEqual(
      normalizeLocations(references),
      normalizeLocations(expected.references)
    );

    let rename: vscode.WorkspaceEdit | undefined;
    let renameError: unknown;

    try {
      rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        document.uri,
        position,
        'renamed'
      );
    } catch (error) {
      renameError = error;
    }

    const expectedRename = normalizeExpectedWorkspaceEdit(expected.rename);

    if (renameError) {
      assert.strictEqual(expectedRename, null);
      return;
    }

    assert.deepStrictEqual(normalizeWorkspaceEdit(rename), expectedRename);
  });

  test('rejects rename for invalid positions', async () => {
    const relativePath = 'language/navigation/rename_invalid.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const position = new vscode.Position(1, 10);

    let prepareRename: vscode.Range | {
      range: vscode.Range;
      placeholder: string;
    } | null = null;

    try {
      prepareRename = await vscode.commands.executeCommand<
        vscode.Range | { range: vscode.Range; placeholder: string } | null
      >('vscode.prepareRename', document.uri, position);
    } catch {
      prepareRename = null;
    }

    assert.deepStrictEqual(
      normalizePrepareRenameResult(prepareRename),
      normalizePrepareRenameResult(expected.prepareRename)
    );

    let rename: vscode.WorkspaceEdit | undefined;
    let renameError: unknown;

    try {
      rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        'vscode.executeDocumentRenameProvider',
        document.uri,
        position,
        'ignored'
      );
    } catch (error) {
      renameError = error;
    }

    const expectedRename = normalizeExpectedWorkspaceEdit(expected.rename);

    if (renameError) {
      assert.strictEqual(expectedRename, null);
      return;
    }

    assert.deepStrictEqual(normalizeWorkspaceEdit(rename), expectedRename);
  });

  const shadowCases: ShadowCase[] = [
    {
      name: 'definition/references resolve outer shadowed symbol',
      relativePath: 'language/navigation/shadow_outer.jsonnet',
      position: new vscode.Position(3, 9),
    },
    {
      name: 'definition/references resolve inner shadowed symbol',
      relativePath: 'language/navigation/shadow_inner.jsonnet',
      position: new vscode.Position(1, 22),
    },
  ];

  for (const tc of shadowCases) {
    test(tc.name, async () => {
      const expected = readScenarioExpected(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const definition = await vscode.commands.executeCommand<
        vscode.Location | vscode.Location[] | vscode.LocationLink[]
      >('vscode.executeDefinitionProvider', document.uri, tc.position);

      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        document.uri,
        tc.position
      );

      assert.deepStrictEqual(
        normalizeLocations(definition),
        normalizeLocations(expected.definition)
      );

      assert.deepStrictEqual(
        normalizeLocations(references),
        normalizeLocations(expected.references)
      );
    });
  }

  const importDefinitionCases: ImportDefinitionCase[] = [
    {
      name: 'definition on imported binding resolves local alias',
      relativePath: 'language/navigation/import_binding_definition.jsonnet',
      position: new vscode.Position(1, 1),
    },
    {
      name: 'definition on import path token resolves imported file',
      relativePath: 'language/navigation/import_path_definition.jsonnet',
      position: new vscode.Position(0, 22),
    },
  ];

  for (const tc of importDefinitionCases) {
    test(tc.name, async () => {
      const expected = readScenarioExpected(tc.relativePath);
      const document = await openScenarioDocument(tc.relativePath);

      const definition = await vscode.commands.executeCommand<
        vscode.Location | vscode.Location[] | vscode.LocationLink[]
      >('vscode.executeDefinitionProvider', document.uri, tc.position);

      assert.deepStrictEqual(
        normalizeLocations(definition),
        normalizeLocations(expected.definition)
      );
    });
  }

  test('code action edits apply to expected final source', async () => {
    const relativePath = 'language/code_actions/remove_unused.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const expectedDiagnostics = normalizeScenarioDiagnostics(expected.diagnostics);
    const diagnostics = await waitForDiagnostics(document.uri, expectedDiagnostics);

    assert.deepStrictEqual(diagnostics, expectedDiagnostics);

    const actions = await vscode.commands.executeCommand<
      readonly (vscode.CodeAction | vscode.Command)[]
    >(
      'vscode.executeCodeActionProvider',
      document.uri,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(2, 4)),
      vscode.CodeActionKind.QuickFix.value
    );

    const actualActions = normalizeCodeActions(actions);
    const expectedActions = normalizeCodeActions(expected.codeActions);

    assert.deepStrictEqual(actualActions, expectedActions);

    const original = document.getText();

    const finalSourceByTitle: Record<string, string> = {
      'Prefix `unused` with `_`': 'local used = 1;\nlocal _unused = 2;\nused\n',
      'Remove unused binding `unused`': 'local used = 1;;\nused\n',
    };

    for (const [title, expectedText] of Object.entries(finalSourceByTitle)) {
      const action = actualActions.find((item) => item.title === title);
      assert.ok(action, `missing code action: ${title}`);
      assert.ok(action.edit, `code action has no edit: ${title}`);

      const edits = editsForScenarioPath(
        action.edit,
        'language/code_actions/remove_unused.jsonnet'
      );

      const actualText = applyComparableEdits(original, edits, document);
      assert.strictEqual(actualText, expectedText);
    }
  });

  test('formatting is idempotent on second pass', async () => {
    const sourceDocument = await openScenarioDocument(
      'language/formatting/unformatted.jsonnet'
    );

    const firstPass = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      sourceDocument.uri,
      {
        tabSize: 2,
        insertSpaces: true,
      }
    );

    const firstPassText = applyTextEdits(
      sourceDocument.getText(),
      firstPass ?? [],
      sourceDocument
    );

    const secondDoc = await vscode.workspace.openTextDocument({
      language: 'jsonnet',
      content: firstPassText,
    });

    await vscode.window.showTextDocument(secondDoc);

    const secondPass = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      secondDoc.uri,
      {
        tabSize: 2,
        insertSpaces: true,
      }
    );

    assert.deepStrictEqual(secondPass ?? [], []);
  });
});

type HoverCase = {
  name: string;
  relativePath: string;
  position: vscode.Position;
};

type ShadowCase = {
  name: string;
  relativePath: string;
  position: vscode.Position;
};

type ImportDefinitionCase = {
  name: string;
  relativePath: string;
  position: vscode.Position;
};

function normalizePrepareRenameResult(
  value: unknown
): { range: { start: { line: number; character: number }; end: { line: number; character: number } } } | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as {
    start?: { line: number; character: number };
    end?: { line: number; character: number };
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };

  const range = record.range ?? (record.start && record.end
    ? { start: record.start, end: record.end }
    : undefined);

  if (!range) {
    return null;
  }

  return {
    range,
  };
}

function editsForScenarioPath(
  edit: { changes: Record<string, ComparableEdit[]> } | null,
  scenarioPath: string
): ComparableEdit[] {
  if (!edit) {
    return [];
  }

  const entries = Object.entries(edit.changes);

  for (const [path, edits] of entries) {
    if (path === scenarioPath) {
      return edits;
    }
  }

  return [];
}
