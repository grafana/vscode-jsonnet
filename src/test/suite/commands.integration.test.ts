import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  ensureExtensionReady,
  openScenarioDocument,
} from './testHarness';

suite('Extension Commands', () => {
  suiteSetup(async () => {
    await ensureExtensionReady();
  });

  test('registers Jsonnet commands after activation', async () => {
    await openScenarioDocument('jsonnet/ok.jsonnet');

    const commands = await vscode.commands.getCommands(true);

    const expected = [
      'jsonnet.evalFile',
      'jsonnet.evalFileYaml',
      'jsonnet.evalExpression',
      'jsonnet.evalExpressionYaml',
      'jsonnet.findTransitiveImporters',
      'jsonnet.restartLanguageServer',
      'jsonnet.debugEditorContents',
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `missing command: ${command}`);
    }
  });
});
