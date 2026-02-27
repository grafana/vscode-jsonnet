import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  normalizePosition,
  normalizeRange,
  normalizeUriValue,
  sortObjectKeys,
} from './lspTestUtils';

import {
  ComparableCodeAction,
  ComparableEdit,
  ComparableHover,
  ComparableLocation,
  ComparableWorkspaceEdit,
  PositionLike,
  RangeLike,
} from './languageFeatureTypes';

export function normalizeHovers(value: unknown): ComparableHover[] {
  if (!value) {
    return [];
  }

  const hovers = Array.isArray(value) ? value : [value];
  const normalized = hovers.map((item) => {
    const hover = item as {
      contents?: unknown[] | unknown;
    };

    const contentsValue = Array.isArray(hover.contents)
      ? hover.contents
      : [hover.contents];

    const contents = contentsValue
      .map((content) => {
        if (typeof content === 'string') {
          return normalizeHoverContent(content);
        }

        if (content instanceof vscode.MarkdownString) {
          return normalizeHoverContent(content.value);
        }

        if (!content || typeof content !== 'object') {
          return '';
        }

        const contentValue = (content as { value?: string }).value;
        return typeof contentValue === 'string'
          ? normalizeHoverContent(contentValue)
          : '';
      })
      .filter((content) => content !== '');

    contents.sort();

    return {
      contents,
    };
  });

  normalized.sort((left, right) =>
    left.contents.join('\n').localeCompare(right.contents.join('\n'))
  );

  return normalized;
}

export function normalizeLocations(value: unknown): ComparableLocation[] {
  if (!value) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];

  const normalized = list.map((item) => {
    const location = item as {
      uri?: vscode.Uri;
      range?: vscode.Range;
      targetUri?: vscode.Uri;
      targetSelectionRange?: vscode.Range;
      targetRange?: vscode.Range;
    };

    const uri = location.uri ?? location.targetUri;
    const range =
      location.range ??
      location.targetSelectionRange ??
      location.targetRange;

    assert.ok(uri, 'expected location URI');
    assert.ok(range, 'expected location range');

    return {
      uri: normalizeUriValue(uri),
      range: normalizeRange(range),
    };
  });

  normalized.sort(compareLocation);
  return normalized;
}

export function normalizeWorkspaceEdit(
  edit: vscode.WorkspaceEdit | undefined
): ComparableWorkspaceEdit | null {
  if (!edit) {
    return null;
  }

  const changes: Record<string, ComparableEdit[]> = {};

  for (const [uri, edits] of edit.entries()) {
    const key = normalizeUriValue(uri);
    changes[key] = normalizeTextEdits(edits);
  }

  return {
    changes: sortObjectKeys(changes),
  };
}

export function normalizeExpectedWorkspaceEdit(
  value: unknown
): ComparableWorkspaceEdit | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as {
    changes?: Record<string, Array<{ range: RangeLike; newText: string }>>;
  };

  const rawChanges = record?.changes ?? {};
  const changes: Record<string, ComparableEdit[]> = {};

  for (const [uri, edits] of Object.entries(rawChanges)) {
    const key = normalizeUriValue(uri);
    changes[key] = normalizeTextEdits(edits);
  }

  return {
    changes: sortObjectKeys(changes),
  };
}

export function completionItems(
  value: unknown
): Array<{ label: string | vscode.SnippetString }> {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value as Array<{ label: string | vscode.SnippetString }>;
  }

  const list = value as { items?: Array<{ label: string | vscode.SnippetString }> };
  return list.items ?? [];
}

export function normalizeSignatureHelp(value: unknown): {
  labels: string[];
  activeSignature: number | null;
  activeParameter: number | null;
} {
  if (!value) {
    return {
      labels: [],
      activeSignature: null,
      activeParameter: null,
    };
  }

  const signature = value as {
    signatures?: Array<{ label?: string }>;
    activeSignature?: number | null;
    activeParameter?: number | null;
  };

  return {
    labels: (signature.signatures ?? []).map((entry) => entry.label ?? ''),
    activeSignature: signature.activeSignature ?? null,
    activeParameter: signature.activeParameter ?? null,
  };
}

export function normalizeInlayHints(value: unknown): Array<{
  position: PositionLike;
  label: string;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value.map((item) => {
    const hint = item as {
      position: vscode.Position | PositionLike;
      label: string | vscode.InlayHintLabelPart[];
    };

    const label = Array.isArray(hint.label)
      ? hint.label.map((part) => part.value).join('')
      : hint.label;

    return {
      position: normalizePosition(hint.position),
      label,
    };
  });

  normalized.sort((left, right) => {
    const lineDelta = left.position.line - right.position.line;
    if (lineDelta !== 0) {
      return lineDelta;
    }
    return left.position.character - right.position.character;
  });

  return normalized;
}

export function normalizeTextEdits(value: unknown): ComparableEdit[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value.map((item) => {
    const edit = item as {
      range: vscode.Range | RangeLike;
      newText: string;
    };

    return {
      range: normalizeRange(edit.range),
      newText: edit.newText,
    };
  });

  normalized.sort((left, right) => compareRange(left.range, right.range));
  return normalized;
}

export function normalizeCodeActions(value: unknown): ComparableCodeAction[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: ComparableCodeAction[] = [];

  for (const action of value) {
    if (!action || typeof action !== 'object') {
      continue;
    }

    const record = action as {
      title?: string;
      kind?: string | vscode.CodeActionKind;
      isPreferred?: boolean;
      edit?: unknown;
    };

    if (!record.edit) {
      continue;
    }

    const edit = record.edit instanceof vscode.WorkspaceEdit
      ? normalizeWorkspaceEdit(record.edit)
      : normalizeExpectedWorkspaceEdit(record.edit);

    normalized.push({
      title: record.title ?? '',
      kind: normalizeCodeActionKind(record.kind),
      isPreferred: record.isPreferred === true,
      edit,
    });
  }

  normalized.sort((left, right) => {
    const titleDelta = left.title.localeCompare(right.title);
    if (titleDelta !== 0) {
      return titleDelta;
    }

    return (left.kind ?? '').localeCompare(right.kind ?? '');
  });

  return normalized;
}

export function normalizeDocumentSymbols(value: unknown): Array<{
  name: string;
  range: RangeLike;
}> {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value.map((symbol) => {
    const record = symbol as {
      name: string;
      range: vscode.Range | RangeLike;
      location?: {
        range: vscode.Range | RangeLike;
      };
    };

    const range = record.range ?? record.location?.range;
    assert.ok(range, 'expected symbol range');

    return {
      name: record.name,
      range: normalizeRange(range),
    };
  });

  normalized.sort((left, right) => {
    const nameDelta = left.name.localeCompare(right.name);
    if (nameDelta !== 0) {
      return nameDelta;
    }

    return compareRange(left.range, right.range);
  });

  return normalized;
}

function normalizeHoverContent(content: string): string {
  const trimmed = content.trim();
  const codeFenceMatch = /^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$/.exec(trimmed);
  return (codeFenceMatch ? codeFenceMatch[1] : trimmed).trim();
}

function compareRange(left: RangeLike, right: RangeLike): number {
  const startLineDelta = left.start.line - right.start.line;
  if (startLineDelta !== 0) {
    return startLineDelta;
  }

  const startCharDelta = left.start.character - right.start.character;
  if (startCharDelta !== 0) {
    return startCharDelta;
  }

  const endLineDelta = left.end.line - right.end.line;
  if (endLineDelta !== 0) {
    return endLineDelta;
  }

  return left.end.character - right.end.character;
}

function compareLocation(left: ComparableLocation, right: ComparableLocation): number {
  const uriDelta = left.uri.localeCompare(right.uri);
  if (uriDelta !== 0) {
    return uriDelta;
  }

  return compareRange(left.range, right.range);
}

function normalizeCodeActionKind(
  kind: string | vscode.CodeActionKind | undefined
): string | null {
  if (!kind) {
    return null;
  }

  return typeof kind === 'string' ? kind : kind.value;
}
