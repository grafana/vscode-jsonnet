import * as path from 'path';
import { workspace } from 'vscode';

export function getLanguageServerSettings() {
  const workspaceConfig = workspace.getConfiguration('jsonnet');
  const workspaceRoots = workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
  const configuredJpath: string[] = workspaceConfig.get('languageServer.jpath', []);
  const jpath: string[] = [];
  const jpathSet = new Set<string>();
  for (const p of configuredJpath) {
    if (path.isAbsolute(p) || workspaceRoots.length === 0) {
      if (!jpathSet.has(p)) {
        jpathSet.add(p);
        jpath.push(p);
      }
      continue;
    }
    for (const root of workspaceRoots) {
      const resolved = path.join(root, p);
      if (jpathSet.has(resolved)) {
        continue;
      }
      jpathSet.add(resolved);
      jpath.push(resolved);
    }
  }
  const formatting: Record<string, unknown> = {};
  const formattingSettings = [
    { settingKey: 'maxBlankLines', serverKey: 'max_blank_lines' },
    { settingKey: 'stringStyle', serverKey: 'string_style' },
    { settingKey: 'commentStyle', serverKey: 'comment_style' },
    { settingKey: 'padArrays', serverKey: 'pad_arrays' },
    { settingKey: 'padObjects', serverKey: 'pad_objects' },
    { settingKey: 'prettyFieldNames', serverKey: 'pretty_field_names' },
  ] as const;
  for (const setting of formattingSettings) {
    const value = workspaceConfig.get(`languageServer.formatting.${setting.settingKey}`);
    if (value !== undefined) {
      formatting[setting.serverKey] = value;
    }
  }

  return {
    log_level: workspaceConfig.get<string | null>('languageServer.logLevel', null),
    ext_vars: workspaceConfig.get('languageServer.extVars'),
    ext_code: workspaceConfig.get('languageServer.extCode'),
    jpath: jpath,
    resolve_paths_with_tanka: workspaceConfig.get('languageServer.resolvePathsWithTanka'),
    enable_lint_diagnostics: workspaceConfig.get('languageServer.enableLintDiagnostics'),
    enable_eval_diagnostics: workspaceConfig.get('languageServer.enableEvalDiagnostics'),
    formatting: formatting,
    code_actions: {
      removeUnused: workspaceConfig.get('languageServer.codeActions.removeUnused', 'all'),
      removeUnusedComments: workspaceConfig.get('languageServer.codeActions.removeUnusedComments', 'none'),
    },
    inlay_hints: {
      local: workspaceConfig.get('languageServer.inlayHints.local', 'all'),
      objectLocal: workspaceConfig.get('languageServer.inlayHints.objectLocal', 'all'),
      objectMembers: workspaceConfig.get('languageServer.inlayHints.objectMembers', 'off'),
      functionParameters: workspaceConfig.get('languageServer.inlayHints.functionParameters', 'off'),
      anonymousFunctionReturns: workspaceConfig.get('languageServer.inlayHints.anonymousFunctionReturns', 'off'),
      callArguments: workspaceConfig.get('languageServer.inlayHints.callArguments', 'off'),
      comprehensions: workspaceConfig.get('languageServer.inlayHints.comprehensions', 'off'),
      destructuring: workspaceConfig.get('languageServer.inlayHints.destructuring', 'off'),
    },
  };
}
