import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  normalizeScenarioDiagnostics,
  normalizeVscodeDiagnostics,
} from './diagnosticUtils';

import {
  completionItems,
  normalizeCodeActions,
  normalizeDocumentSymbols,
  normalizeExpectedWorkspaceEdit,
  normalizeHovers,
  normalizeInlayHints,
  normalizeLocations,
  normalizeSignatureHelp,
  normalizeTextEdits,
  normalizeWorkspaceEdit,
} from './languageFeatureNormalization';

import {
  applyComparableEdits,
  applyTextEdits,
} from './languageFeatureTextEdits';

import {
  configureJsonnetForTest,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

suite('Language Features', () => {
  setup(async () => {
    await configureJsonnetForTest({
      'languageServer.continuousEval': false,
      'languageServer.enableEvalDiagnostics': true,
      'languageServer.enableLintDiagnostics': true,

      'languageServer.codeActions.removeUnused': 'all',
      'languageServer.codeActions.removeUnusedComments': 'none',

      'languageServer.inlayHints.local': 'all',
      'languageServer.inlayHints.objectLocal': 'all',
      'languageServer.inlayHints.objectMembers': 'all',
      'languageServer.inlayHints.functionParameters': 'all',
      'languageServer.inlayHints.anonymousFunctionReturns': 'all',
      'languageServer.inlayHints.callArguments': 'all',
      'languageServer.inlayHints.comprehensions': 'all',
      'languageServer.inlayHints.destructuring': 'all',

      'languageServer.formatting.maxBlankLines': 2,
      'languageServer.formatting.stringStyle': 'single',
      'languageServer.formatting.commentStyle': 'leave',
      'languageServer.formatting.padArrays': false,
      'languageServer.formatting.padObjects': true,
      'languageServer.formatting.prettyFieldNames': true,
    });
  });

  test('provides hover with type details', async () => {
    const relativePath = 'language/navigation/main.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      document.uri,
      new vscode.Position(3, 11)
    );

    const actual = normalizeHovers(hovers);
    const expectedHovers = normalizeHovers(expected.hover ? [expected.hover] : []);

    assert.deepStrictEqual(actual, expectedHovers);
  });

  test('provides go-to-definition across files', async () => {
    const relativePath = 'language/navigation/main.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const definition = await vscode.commands.executeCommand<
      vscode.Location | vscode.Location[] | vscode.LocationLink[]
    >(
      'vscode.executeDefinitionProvider',
      document.uri,
      new vscode.Position(1, 20)
    );

    const actual = normalizeLocations(definition);
    const expectedLocations = normalizeLocations(expected.definition);

    assert.deepStrictEqual(actual, expectedLocations);
  });

  test('provides find-references results', async () => {
    const relativePath = 'language/navigation/main.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const references = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider',
      document.uri,
      new vscode.Position(1, 7)
    );

    const actual = normalizeLocations(references);
    const expectedLocations = normalizeLocations(expected.references);

    assert.deepStrictEqual(actual, expectedLocations);
  });

  test('provides rename edits for all references', async () => {
    const relativePath = 'language/navigation/main.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
      'vscode.executeDocumentRenameProvider',
      document.uri,
      new vscode.Position(3, 11),
      'result'
    );

    const actual = normalizeWorkspaceEdit(edit);
    const expectedEdit = normalizeExpectedWorkspaceEdit(expected.rename);

    assert.deepStrictEqual(actual, expectedEdit);
  });

  test('provides completion items', async () => {
    const relativePath = 'language/intel/completion.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const completion = await vscode.commands.executeCommand<
      vscode.CompletionList | vscode.CompletionItem[]
    >(
      'vscode.executeCompletionItemProvider',
      document.uri,
      new vscode.Position(4, 4),
      '.'
    );

    const actualLabels = completionItems(completion)
      .map((item) => item.label.toString())
      .sort();

    const expectedLabels = completionItems(expected.completion)
      .map((item) => String(item.label))
      .sort();

    assert.deepStrictEqual(actualLabels, expectedLabels);
  });

  test('provides signature help', async () => {
    const relativePath = 'language/intel/signature.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const signature = await vscode.commands.executeCommand<vscode.SignatureHelp>(
      'vscode.executeSignatureHelpProvider',
      document.uri,
      new vscode.Position(1, 4),
      '('
    );

    const actual = normalizeSignatureHelp(signature);
    const expectedSignature = normalizeSignatureHelp(expected.signatureHelp);

    assert.deepStrictEqual(actual, expectedSignature);
  });

  test('provides inlay hints', async () => {
    const relativePath = 'language/intel/inlay.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const inlayHints = await vscode.commands.executeCommand<vscode.InlayHint[]>(
      'vscode.executeInlayHintProvider',
      document.uri,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(4, 0))
    );

    const actual = normalizeInlayHints(inlayHints);
    const expectedHints = normalizeInlayHints(expected.inlayHints);

    assert.deepStrictEqual(actual, expectedHints);
  });

  test('formats documents deterministically', async () => {
    const relativePath = 'language/formatting/unformatted.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
      'vscode.executeFormatDocumentProvider',
      document.uri,
      {
        tabSize: 2,
        insertSpaces: true,
      }
    );

    const original = document.getText();
    const actual = applyTextEdits(original, edits ?? [], document);

    const expectedEdits = normalizeTextEdits(expected.formatting);
    const expectedText = applyComparableEdits(original, expectedEdits, document);

    assert.strictEqual(actual, expectedText);
  });

  test('returns quick-fix code actions for unused bindings', async () => {
    const relativePath = 'language/code_actions/remove_unused.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const expectedDiagnostics = normalizeScenarioDiagnostics(expected.diagnostics);

    const diagnostics = await waitForValue(() => {
      const current = normalizeVscodeDiagnostics(
        vscode.languages.getDiagnostics(document.uri)
      );
      return current.length > 0 ? current : undefined;
    });

    assert.deepStrictEqual(diagnostics, expectedDiagnostics);

    const actions = await vscode.commands.executeCommand<
      readonly (vscode.CodeAction | vscode.Command)[]
    >(
      'vscode.executeCodeActionProvider',
      document.uri,
      new vscode.Range(new vscode.Position(0, 0), new vscode.Position(2, 4)),
      vscode.CodeActionKind.QuickFix.value
    );

    const actual = normalizeCodeActions(actions);
    const expectedActions = normalizeCodeActions(expected.codeActions);

    assert.deepStrictEqual(actual, expectedActions);
  });

  test('returns document symbols', async () => {
    const relativePath = 'language/navigation/main.jsonnet';
    const expected = readScenarioExpected(relativePath);
    const document = await openScenarioDocument(relativePath);

    const symbols = await vscode.commands.executeCommand<
      vscode.DocumentSymbol[] | vscode.SymbolInformation[]
    >('vscode.executeDocumentSymbolProvider', document.uri);

    const actual = normalizeDocumentSymbols(symbols ?? []);
    const expectedSymbols = normalizeDocumentSymbols(expected.documentSymbols);

    assert.deepStrictEqual(actual, expectedSymbols);
  });
});
