const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseVersionFromOutput,
  findMatchingReleaseAsset,
  findChecksumAsset,
  parseSha256Checksum,
} = require('../out/installUtils');

test('parseVersionFromOutput handles prefixed and bare formats', () => {
  assert.equal(parseVersionFromOutput('jrsonnet-lsp version 1.2.3\n', 'jrsonnet-lsp'), '1.2.3');
  assert.equal(parseVersionFromOutput('v2.4.6\n', 'jrsonnet-lsp'), '2.4.6');
  assert.equal(parseVersionFromOutput('unknown output', 'jrsonnet-lsp'), null);
});

test('findMatchingReleaseAsset excludes non-binary assets', () => {
  const assets = [
    { name: 'jrsonnet-lsp_1.0.0_linux_amd64.sha256', browser_download_url: 'https://example/sha' },
    { name: 'jrsonnet-lsp_1.0.0_linux_amd64.sig', browser_download_url: 'https://example/sig' },
    { name: 'jrsonnet-lsp_1.0.0_linux_amd64', browser_download_url: 'https://example/bin' },
  ];

  const selected = findMatchingReleaseAsset(assets, 'jrsonnet-lsp', 'linux', 'amd64');
  assert.equal(selected?.browser_download_url, 'https://example/bin');
});

test('findChecksumAsset matches direct and fuzzy checksum files', () => {
  const assets = [
    { name: 'notes.txt', browser_download_url: 'https://example/notes' },
    { name: 'jrsonnet-lsp_1.0.0_linux_amd64.sha256', browser_download_url: 'https://example/sha' },
  ];

  assert.equal(
    findChecksumAsset(assets, 'jrsonnet-lsp_1.0.0_linux_amd64')?.browser_download_url,
    'https://example/sha'
  );
  assert.equal(findChecksumAsset(assets, 'missing'), null);
});

test('parseSha256Checksum chooses named entry and supports bare hash', () => {
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);
  const contents = `${hashA}  something-else\n${hashB}  artifact.bin\n`;
  assert.equal(parseSha256Checksum(contents, 'artifact.bin'), hashB);

  const bare = `${hashA}\n`;
  assert.equal(parseSha256Checksum(bare, 'ignored.bin'), hashA);
});
