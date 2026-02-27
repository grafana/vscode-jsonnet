import * as vscode from 'vscode';
import {
  ComparableRange,
  normalizeRange,
} from './lspTestUtils';

export type ComparableDiagnostic = {
  range: ComparableRange;
  severity: number;
  source?: string;
  message: string;
};

export function normalizeScenarioDiagnostics(value: unknown): ComparableDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((diagnostic) => {
    const record = diagnostic as {
      range: ComparableRange;
      severity: number;
      source?: string;
      message: string;
    };

    return {
      range: normalizeRange(record.range),
      severity: record.severity,
      source: record.source,
      message: record.message,
    };
  });
}

export function normalizeVscodeDiagnostics(
  diagnostics: readonly vscode.Diagnostic[]
): ComparableDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    range: normalizeRange(diagnostic.range),
    severity: toLspSeverity(diagnostic.severity),
    source: diagnostic.source,
    message: diagnostic.message,
  }));
}

function toLspSeverity(severity: vscode.DiagnosticSeverity): number {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 1;
    case vscode.DiagnosticSeverity.Warning:
      return 2;
    case vscode.DiagnosticSeverity.Information:
      return 3;
    case vscode.DiagnosticSeverity.Hint:
      return 4;
    default:
      return 1;
  }
}
