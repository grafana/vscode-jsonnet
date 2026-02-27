import * as path from 'path';
import { window, workspace, Uri } from 'vscode';
import { LanguageClient, RequestType } from 'vscode-languageclient/node';
import {
  FindTransitiveImportersRequest,
  FindTransitiveImportersParams,
  FindTransitiveImportersResponse,
} from './lspRequests';

type GetClient = () => LanguageClient | undefined;

export function createFindTransitiveImportersCommand(getClient: GetClient) {
  return async () => {
    const uri = getActiveEditorUri();
    if (!uri) {
      return;
    }

    const result = await sendLspRequest(getClient, FindTransitiveImportersRequest, {
      textDocument: { uri: uri.toString() },
    });

    const importers = result?.transitiveImporters ?? [];
    if (importers.length === 0) {
      window.showInformationMessage('No transitive importers found');
      return;
    }

    const items = importers.map((importer) => {
      const importerUri = Uri.parse(importer);
      return {
        label: path.basename(importerUri.fsPath) || importer,
        description: importerUri.fsPath || importer,
        importerUri,
      };
    });

    const selected = await window.showQuickPick(items, {
      title: 'Jsonnet: Transitive Importers',
      placeHolder: 'Select an importer to open',
    });
    if (!selected) {
      return;
    }

    const document = await workspace.openTextDocument(selected.importerUri);
    await window.showTextDocument(document);
  };
}

function getActiveEditorUri(): Uri | undefined {
  const editor = window.activeTextEditor;
  if (!editor) {
    window.showErrorMessage('No active editor');
    return undefined;
  }

  return editor.document.uri;
}

async function sendLspRequest<P, R>(
  getClient: GetClient,
  request: RequestType<P, R, void>,
  params: P
): Promise<R | undefined> {
  const client = getClient();
  if (!client) {
    window.showErrorMessage('Language server is not running');
    return undefined;
  }

  try {
    return await client.sendRequest(request, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    window.showErrorMessage(message);
    return undefined;
  }
}
