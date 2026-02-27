import * as vscode from 'vscode';

export class JsonnetDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
  context: vscode.ExtensionContext;
  binPath: string;

  constructor(context: vscode.ExtensionContext, binPath: string) {
    this.context = context;
    this.binPath = binPath;
  }

  createDebugAdapterDescriptor(
    _session: vscode.DebugSession,
    executable: vscode.DebugAdapterExecutable | undefined
  ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
    if (executable) {
      return executable;
    }

    return new vscode.DebugAdapterExecutable(this.binPath, ['-d', '-s']);
  }
}
