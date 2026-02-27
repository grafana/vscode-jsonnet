import {
  DebugConfiguration,
  DebugConfigurationProvider,
  ProviderResult,
  TextDocument,
  WorkspaceFolder,
  window,
} from 'vscode';

export class JsonnetDebugConfigurationProvider
  implements DebugConfigurationProvider
{
  provideDebugConfigurations(
    _folder: WorkspaceFolder | undefined
  ): ProviderResult<DebugConfiguration[]> {
    return [
      {
        name: 'Debug current Jsonnet file',
        request: 'launch',
        type: 'jsonnet',
        program: '${file}',
        jpaths: [],
      },
    ];
  }

  resolveDebugConfiguration(
    _folder: WorkspaceFolder | undefined,
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

    if (!Array.isArray(resolved.jpaths)) {
      resolved.jpaths = [];
    }

    return resolved;
  }
}
