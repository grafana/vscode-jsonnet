import * as assert from 'assert';
import * as vscode from 'vscode';
import { parse as parseYaml } from 'yaml';
import {
  closeEvalEditors,
  configureJsonnetForTest,
  openScenarioDocument,
  readScenarioExpected,
  waitForValue,
} from './testHarness';

suite('Eval Commands', () => {
  const evalFileCases: EvalFileCase[] = [
    {
      name: 'evaluates a file as JSON',
      relativePath: 'eval/jsonnet/ok.jsonnet',
      command: 'jsonnet.evalFile',
      parseOutput: JSON.parse,
    },
    {
      name: 'evaluates a file as YAML',
      relativePath: 'eval/tanka/environments/default/main.jsonnet',
      command: 'jsonnet.evalFileYaml',
      parseOutput: parseYaml,
    },
  ];

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

  for (const tc of evalFileCases) {
    test(tc.name, async () => {
      const expected = readScenarioExpected(tc.relativePath);

      await openScenarioDocument(tc.relativePath);
      await vscode.commands.executeCommand(tc.command);

      const text = await readEvalResultText();
      const actual = tc.parseOutput(text);

      assert.deepStrictEqual(actual, expected.evalFile?.result);
    });
  }

  test('surfaces eval errors in the result tab', async () => {
    const relativePath = 'eval/jsonnet/runtime_error.jsonnet';
    const expected = readScenarioExpected(relativePath);

    await openScenarioDocument(relativePath);
    await vscode.commands.executeCommand('jsonnet.evalFile');

    const text = await readEvalResultText();
    const actual = JSON.parse(text);
    assert.deepStrictEqual(actual, expected.evalFile?.result);
  });
});

type EvalFileCase = {
  name: string;
  relativePath: string;
  command: 'jsonnet.evalFile' | 'jsonnet.evalFileYaml';
  parseOutput: (text: string) => unknown;
};

async function readEvalResultText(): Promise<string> {
  const editor = await waitForValue(() => {
    return vscode.window.visibleTextEditors.find(
      (item) => item.document.uri.scheme === 'jsonnet-eval'
    );
  });

  return waitForValue(() => {
    const value = editor.document.getText();
    if (value.includes('Evaluating')) {
      return undefined;
    }
    return value;
  });
}
