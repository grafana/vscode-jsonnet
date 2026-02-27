import {
  DebugConfiguration,
  DebugConfigurationProvider,
  ProviderResult,
  TextDocument,
  Uri,
  WorkspaceFolder,
  workspace,
  window,
} from 'vscode';
import * as path from 'path';

export class JsonnetDebugConfigurationProvider
  implements DebugConfigurationProvider
{
  provideDebugConfigurations(
    folder: WorkspaceFolder | undefined
  ): ProviderResult<DebugConfiguration[]> {
    return [
      {
        name: 'Debug current Jsonnet file',
        request: 'launch',
        type: 'jsonnet',
        program: '${file}',
        jpaths: this.workspaceJpaths(folder),
      },
    ];
  }

  resolveDebugConfiguration(
    folder: WorkspaceFolder | undefined,
    config: DebugConfiguration
  ): ProviderResult<DebugConfiguration> {
    const resolved: DebugConfiguration = {
      ...config,
      type: config.type || 'jsonnet',
      name: config.name || 'Debug current Jsonnet file',
      request: config.request || 'launch',
    };

    if (!resolved.program) {
      const activeDocument: TextDocument | undefined =
        window.activeTextEditor?.document;
      resolved.program = activeDocument?.uri.fsPath;
    }

    if (!Array.isArray(resolved.jpaths) || resolved.jpaths.length === 0) {
      const workspaceFolder = folder || this.workspaceFolderForProgram(resolved.program);
      resolved.jpaths = this.workspaceJpaths(workspaceFolder);
    }

    return resolved;
  }

  private workspaceFolderForProgram(
    program: unknown
  ): WorkspaceFolder | undefined {
    if (typeof program !== 'string' || program.length === 0) {
      return undefined;
    }

    return workspace.getWorkspaceFolder(Uri.file(program));
  }

  private workspaceJpaths(folder: WorkspaceFolder | undefined): string[] {
    const root = folder?.uri.fsPath;
    const configuredJpath: string[] = workspace
      .getConfiguration('jsonnet', folder?.uri)
      .get('languageServer.jpath', []);

    if (!root) {
      return configuredJpath;
    }

    const deduped: string[] = [];
    const seen = new Set<string>();

    for (const configuredPath of configuredJpath) {
      const resolved = path.isAbsolute(configuredPath)
        ? configuredPath
        : path.join(root, configuredPath);
      if (seen.has(resolved)) {
        continue;
      }

      seen.add(resolved);
      deduped.push(resolved);
    }

    return deduped;
  }
}
