#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

let buffer = Buffer.alloc(0);
const expectedCache = new Map();

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drainBuffer();
});

process.stdin.on('error', () => {
  process.exit(1);
});

function drainBuffer() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const header = buffer.slice(0, headerEnd).toString('utf8');
    const contentLength = parseContentLength(header);
    if (contentLength === undefined) {
      buffer = Buffer.alloc(0);
      return;
    }

    const frameLength = headerEnd + 4 + contentLength;
    if (buffer.length < frameLength) {
      return;
    }

    const payload = buffer.slice(headerEnd + 4, frameLength).toString('utf8');
    buffer = buffer.slice(frameLength);

    let message;
    try {
      message = JSON.parse(payload);
    } catch {
      continue;
    }

    handleMessage(message);
  }
}

function parseContentLength(header) {
  for (const line of header.split('\r\n')) {
    const match = /^content-length:\s*(\d+)$/i.exec(line.trim());
    if (match) {
      return Number(match[1]);
    }
  }

  return undefined;
}

function send(payload) {
  const body = JSON.stringify(payload);
  const out = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
  process.stdout.write(out);
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function sendNotification(method, params) {
  send({ jsonrpc: '2.0', method, params });
}

function handleMessage(message) {
  if (typeof message !== 'object' || message === null) {
    return;
  }

  if (message.id !== undefined && typeof message.method === 'string') {
    handleRequest(message);
    return;
  }

  if (typeof message.method === 'string') {
    handleNotification(message.method, message.params);
  }
}

function handleRequest(message) {
  const id = message.id;
  const method = message.method;

  if (method === 'initialize') {
    sendResult(id, {
      capabilities: {
        textDocumentSync: {
          openClose: true,
          change: 2,
          save: true,
        },
        hoverProvider: true,
        completionProvider: {
          triggerCharacters: ['.'],
        },
        signatureHelpProvider: {
          triggerCharacters: ['(', ','],
        },
        definitionProvider: true,
        typeDefinitionProvider: true,
        implementationProvider: true,
        referencesProvider: true,
        documentHighlightProvider: true,
        documentSymbolProvider: true,
        codeActionProvider: {
          codeActionKinds: ['quickfix', 'source.fixAll'],
          resolveProvider: false,
        },
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        renameProvider: {
          prepareProvider: true,
        },
        declarationProvider: true,
        inlayHintProvider: true,
      },
      serverInfo: {
        name: 'fake-jrsonnet-lsp',
        version: '0.0.0-test',
      },
    });
    return;
  }

  if (method === 'shutdown') {
    sendResult(id, null);
    return;
  }

  if (method === 'jrsonnet/evalFile') {
    handleEvalFileRequest(id, message.params?.textDocument?.uri);
    return;
  }

  if (method === 'jrsonnet/evalExpression') {
    handleEvalExpressionRequest(
      id,
      message.params?.expression,
      message.params?.baseDocument?.uri
    );
    return;
  }

  if (method === 'jrsonnet/findTransitiveImporters') {
    handleFindImportersRequest(id, message.params?.textDocument?.uri);
    return;
  }

  if (method.startsWith('textDocument/')) {
    handleFeatureRequest(id, method, message.params);
    return;
  }

  sendResult(id, null);
}

function handleEvalFileRequest(id, uri) {
  const expected = loadExpectedFromUri(uri);
  const evalFile = expected.evalFile;

  if (evalFile?.error?.message) {
    sendError(id, evalFile.error.code ?? -32001, evalFile.error.message);
    return;
  }

  if (evalFile && Object.prototype.hasOwnProperty.call(evalFile, 'result')) {
    sendResult(id, evalFile.result);
    return;
  }

  sendResult(id, null);
}

function handleEvalExpressionRequest(id, expression, baseDocumentUri) {
  const expected = loadExpectedFromUri(baseDocumentUri);
  const evalExpression = expected.evalExpression || {};
  const entry = evalExpression[String(expression)] || undefined;

  if (entry?.error?.message) {
    sendError(id, entry.error.code ?? -32001, entry.error.message);
    return;
  }

  if (entry && Object.prototype.hasOwnProperty.call(entry, 'result')) {
    sendResult(id, entry.result);
    return;
  }

  if (expression === 'error') {
    sendError(id, -32001, 'RuntimeError: expression failure');
    return;
  }

  if (expression === '1 + 1' || expression === '1+1') {
    sendResult(id, 2);
    return;
  }

  sendResult(id, {
    expression,
    base: scenarioRelativePath(baseDocumentUri),
  });
}

function handleFindImportersRequest(id, uri) {
  const fsPath = toFsPath(uri);
  const root = findScenarioRoot(fsPath);
  const expected = loadExpectedFromUri(uri);
  const importers = resolveImporterUris(root, expected.findTransitiveImporters);

  sendResult(id, {
    file: uri,
    transitiveImporters: importers,
  });
}

function handleFeatureRequest(id, method, params) {
  const uri = params?.textDocument?.uri;
  const fsPath = toFsPath(uri);
  const root = findScenarioRoot(fsPath);
  const expected = loadExpectedFromUri(uri);
  const expectedKey = expectedKeyForMethod(method);

  if (!expectedKey) {
    sendResult(id, null);
    return;
  }

  const result = expected[expectedKey];
  if (result === undefined) {
    sendResult(id, defaultResultForMethod(method));
    return;
  }

  sendResult(id, absolutizeUris(root, result));
}

function handleNotification(method, params) {
  if (method === 'exit') {
    process.exit(0);
    return;
  }

  if (method === 'textDocument/didOpen') {
    publishDiagnostics(params?.textDocument?.uri);
    return;
  }

  if (method === 'textDocument/didChange') {
    publishDiagnostics(params?.textDocument?.uri);
    return;
  }

  if (method === 'textDocument/didClose') {
    sendNotification('textDocument/publishDiagnostics', {
      uri: params?.textDocument?.uri,
      diagnostics: [],
    });
  }
}

function publishDiagnostics(uri) {
  const expected = loadExpectedFromUri(uri);
  const root = findScenarioRoot(toFsPath(uri));
  const diagnostics = Array.isArray(expected.diagnostics)
    ? absolutizeUris(root, expected.diagnostics)
    : [];

  sendNotification('textDocument/publishDiagnostics', {
    uri,
    diagnostics,
  });
}

function resolveImporterUris(root, importers) {
  if (!root || !Array.isArray(importers)) {
    return [];
  }

  const uris = [];

  for (const importer of importers) {
    if (typeof importer !== 'string' || importer.length === 0) {
      continue;
    }

    if (importer.startsWith('file://')) {
      uris.push(importer);
      continue;
    }

    const absolutePath = path.isAbsolute(importer)
      ? importer
      : path.join(root, importer);
    uris.push(pathToFileURL(absolutePath).toString());
  }

  return uris;
}

function loadExpectedFromUri(uri) {
  const expectedPath = expectedPathForUri(uri);
  if (!expectedPath) {
    return {};
  }

  if (expectedCache.has(expectedPath)) {
    return expectedCache.get(expectedPath);
  }

  let value = {};

  try {
    if (fs.existsSync(expectedPath)) {
      value = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    }
  } catch {
    value = {};
  }

  expectedCache.set(expectedPath, value);
  return value;
}

function expectedPathForUri(uri) {
  const fsPath = toFsPath(uri);
  if (!fsPath) {
    return undefined;
  }

  return `${fsPath}.expected.json`;
}

function toFsPath(uri) {
  if (typeof uri !== 'string') {
    return '';
  }

  try {
    return fileURLToPath(uri);
  } catch {
    return uri;
  }
}

function scenarioRelativePath(uri) {
  const fsPath = toFsPath(uri);
  if (!fsPath) {
    return '';
  }

  const root = findScenarioRoot(fsPath);
  if (!root) {
    return path.basename(path.normalize(fsPath));
  }

  return path.relative(root, fsPath).split(path.sep).join('/');
}

function expectedKeyForMethod(method) {
  switch (method) {
    case 'textDocument/hover':
      return 'hover';
    case 'textDocument/definition':
      return 'definition';
    case 'textDocument/typeDefinition':
      return 'typeDefinition';
    case 'textDocument/declaration':
      return 'declaration';
    case 'textDocument/implementation':
      return 'implementation';
    case 'textDocument/references':
      return 'references';
    case 'textDocument/documentHighlight':
      return 'documentHighlights';
    case 'textDocument/rename':
      return 'rename';
    case 'textDocument/prepareRename':
      return 'prepareRename';
    case 'textDocument/completion':
      return 'completion';
    case 'textDocument/signatureHelp':
      return 'signatureHelp';
    case 'textDocument/inlayHint':
      return 'inlayHints';
    case 'textDocument/formatting':
      return 'formatting';
    case 'textDocument/codeAction':
      return 'codeActions';
    case 'textDocument/documentSymbol':
      return 'documentSymbols';
    default:
      return undefined;
  }
}

function defaultResultForMethod(method) {
  switch (method) {
    case 'textDocument/references':
    case 'textDocument/documentHighlight':
    case 'textDocument/inlayHint':
    case 'textDocument/formatting':
    case 'textDocument/codeAction':
    case 'textDocument/documentSymbol':
      return [];
    case 'textDocument/completion':
      return {
        isIncomplete: false,
        items: [],
      };
    default:
      return null;
  }
}

function absolutizeUris(root, value) {
  if (Array.isArray(value)) {
    return value.map((item) => absolutizeUris(root, item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const output = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === 'uri' && typeof child === 'string') {
      output[key] = absolutizeUri(root, child);
      continue;
    }

    if (key === 'changes' && child && typeof child === 'object') {
      output[key] = absolutizeChangeMap(root, child);
      continue;
    }

    output[key] = absolutizeUris(root, child);
  }

  return output;
}

function absolutizeChangeMap(root, value) {
  const output = {};

  for (const [uri, edits] of Object.entries(value)) {
    output[absolutizeUri(root, uri)] = absolutizeUris(root, edits);
  }

  return output;
}

function absolutizeUri(root, uri) {
  if (uri.startsWith('file://')) {
    return uri;
  }

  const fsPath = path.isAbsolute(uri)
    ? uri
    : root
      ? path.join(root, uri)
      : uri;

  if (!path.isAbsolute(fsPath)) {
    return uri;
  }

  return pathToFileURL(fsPath).toString();
}

function findScenarioRoot(fsPath) {
  if (!fsPath) {
    return undefined;
  }

  let current = path.resolve(fsPath);

  if (fs.existsSync(current) && !fs.statSync(current).isDirectory()) {
    current = path.dirname(current);
  }

  while (current !== path.dirname(current)) {
    const fakeServerScriptPath = path.join(
      current,
      '.tools',
      'fake-jrsonnet-lsp.js'
    );
    if (fs.existsSync(fakeServerScriptPath)) {
      return current;
    }

    current = path.dirname(current);
  }

  return undefined;
}
