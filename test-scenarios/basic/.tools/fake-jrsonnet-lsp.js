#!/usr/bin/env node

const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const documents = new Map();
let buffer = Buffer.alloc(0);

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
        textDocumentSync: 1,
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
    const uri = message.params?.textDocument?.uri;
    const relative = scenarioRelativePath(uri);

    if (relative === 'jsonnet/invalid_type.jsonnet') {
      sendError(id, -32001, 'RuntimeError: type mismatch in invalid_type.jsonnet');
      return;
    }

    if (relative === 'tanka/environments/default/main.jsonnet') {
      sendResult(id, {
        source: relative,
        kind: 'tanka',
        environment: 'default',
      });
      return;
    }

    sendResult(id, {
      source: relative,
      value: {
        greeting: 'hello',
        target: 'world',
      },
    });
    return;
  }

  if (method === 'jrsonnet/evalExpression') {
    const expression = message.params?.expression;
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
      base: scenarioRelativePath(message.params?.baseDocument?.uri),
    });
    return;
  }

  if (method === 'jrsonnet/findTransitiveImporters') {
    const uri = message.params?.textDocument?.uri;
    const fsPath = toFsPath(uri);
    const root = findScenarioRoot(fsPath);

    let importers = [];
    if (root && scenarioRelativePath(uri) === 'jsonnet/lib/imported.libsonnet') {
      importers = [
        pathToFileURL(path.join(root, 'jsonnet/ok.jsonnet')).toString(),
        pathToFileURL(path.join(root, 'tanka/environments/default/main.jsonnet')).toString(),
      ];
    }

    sendResult(id, {
      file: uri,
      transitiveImporters: importers,
    });
    return;
  }

  sendResult(id, null);
}

function handleNotification(method, params) {
  if (method === 'exit') {
    process.exit(0);
    return;
  }

  if (method === 'textDocument/didOpen') {
    const uri = params?.textDocument?.uri;
    const text = params?.textDocument?.text;
    documents.set(uri, text);
    publishDiagnostics(uri);
    return;
  }

  if (method === 'textDocument/didChange') {
    const uri = params?.textDocument?.uri;
    const changes = params?.contentChanges;
    if (Array.isArray(changes) && changes.length > 0) {
      documents.set(uri, changes[changes.length - 1].text);
    }
    publishDiagnostics(uri);
    return;
  }

  if (method === 'textDocument/didClose') {
    const uri = params?.textDocument?.uri;
    documents.delete(uri);
    sendNotification('textDocument/publishDiagnostics', {
      uri,
      diagnostics: [],
    });
  }
}

function publishDiagnostics(uri) {
  const diagnostics = diagnosticsForUri(uri);
  sendNotification('textDocument/publishDiagnostics', {
    uri,
    diagnostics,
  });
}

function diagnosticsForUri(uri) {
  const relative = scenarioRelativePath(uri);
  if (relative === 'jsonnet/invalid_type.jsonnet') {
    return [
      {
        range: {
          start: { line: 1, character: 9 },
          end: { line: 1, character: 10 },
        },
        severity: 1,
        source: 'fake-jrsonnet-lsp',
        message: 'Type mismatch: object + string',
      },
    ];
  }

  if (relative === 'jsonnet/deprecated_field.jsonnet') {
    return [
      {
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 17 },
        },
        severity: 2,
        source: 'fake-jrsonnet-lsp',
        message: 'Deprecated field used: deprecatedField',
      },
    ];
  }

  return [];
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

  const normalized = path.normalize(fsPath);
  const parts = normalized.split(path.sep);
  const scenariosIndex = parts.lastIndexOf('test-scenarios');
  if (scenariosIndex === -1 || scenariosIndex + 2 >= parts.length) {
    return path.basename(normalized);
  }

  return parts.slice(scenariosIndex + 2).join('/');
}

function findScenarioRoot(fsPath) {
  if (!fsPath) {
    return undefined;
  }

  let current = path.resolve(fsPath);
  while (current !== path.dirname(current)) {
    if (
      path.basename(current) === 'basic' &&
      path.basename(path.dirname(current)) === 'test-scenarios'
    ) {
      return current;
    }
    current = path.dirname(current);
  }

  return undefined;
}
