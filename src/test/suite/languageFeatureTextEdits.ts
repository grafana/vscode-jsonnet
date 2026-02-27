import * as vscode from 'vscode';

import { ComparableEdit } from './languageFeatureTypes';

export function applyTextEdits(
  originalText: string,
  edits: readonly vscode.TextEdit[],
  document: vscode.TextDocument
): string {
  const withOffsets = edits.map((edit) => ({
    start: document.offsetAt(edit.range.start),
    end: document.offsetAt(edit.range.end),
    newText: edit.newText,
  }));

  withOffsets.sort((left, right) => right.start - left.start);

  let output = originalText;
  for (const edit of withOffsets) {
    output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`;
  }

  return output;
}

export function applyComparableEdits(
  originalText: string,
  edits: readonly ComparableEdit[],
  document: vscode.TextDocument
): string {
  const withOffsets = edits.map((edit) => ({
    start: document.offsetAt(
      new vscode.Position(edit.range.start.line, edit.range.start.character)
    ),
    end: document.offsetAt(
      new vscode.Position(edit.range.end.line, edit.range.end.character)
    ),
    newText: edit.newText,
  }));

  withOffsets.sort((left, right) => right.start - left.start);

  let output = originalText;
  for (const edit of withOffsets) {
    output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`;
  }

  return output;
}
