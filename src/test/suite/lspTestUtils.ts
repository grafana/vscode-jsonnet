import * as path from 'path';
import * as vscode from 'vscode';
import { scenarioRoot } from './testHarness';

export type ComparablePosition = {
  line: number;
  character: number;
};

export type ComparableRange = {
  start: ComparablePosition;
  end: ComparablePosition;
};

export function normalizePosition(
  position: vscode.Position | ComparablePosition
): ComparablePosition {
  return {
    line: position.line,
    character: position.character,
  };
}

export function normalizeRange(
  range: vscode.Range | ComparableRange
): ComparableRange {
  return {
    start: normalizePosition(range.start),
    end: normalizePosition(range.end),
  };
}

export function normalizeUriValue(value: unknown): string {
  if (value instanceof vscode.Uri) {
    return normalizeFsPath(value.fsPath);
  }

  if (typeof value !== 'string') {
    return '';
  }

  if (value.startsWith('file://')) {
    return normalizeFsPath(vscode.Uri.parse(value).fsPath);
  }

  return value.replace(/\\/g, '/');
}

export function sortObjectKeys<T>(value: Record<string, T>): Record<string, T> {
  const sortedKeys = Object.keys(value).sort();
  const output: Record<string, T> = {};

  for (const key of sortedKeys) {
    output[key] = value[key];
  }

  return output;
}

function normalizeFsPath(fsPath: string): string {
  const relative = path.relative(scenarioRoot(), fsPath);
  return relative.split(path.sep).join('/');
}
