import { isDeepStrictEqual } from 'util';
import * as vscode from 'vscode';

import {
  ComparableDiagnostic,
  normalizeScenarioDiagnostics,
  normalizeVscodeDiagnostics,
} from './diagnosticUtils';

import {
  readScenarioExpected,
  waitForValue,
} from './testHarness';

export function expectedDiagnosticsFor(
  relativePath: string
): ComparableDiagnostic[] {
  const expected = readScenarioExpected(relativePath);
  return normalizeScenarioDiagnostics(expected.diagnostics);
}

export async function waitForDiagnostics(
  uri: vscode.Uri,
  expected: ComparableDiagnostic[],
  timeoutMs = 15000
): Promise<ComparableDiagnostic[]> {
  let streak = 0;

  return waitForValue(() => {
    const current = normalizeVscodeDiagnostics(
      vscode.languages.getDiagnostics(uri)
    );

    if (!isDeepStrictEqual(current, expected)) {
      streak = 0;
      return undefined;
    }

    streak += 1;
    return streak >= 3 ? current : undefined;
  }, timeoutMs, 50);
}
