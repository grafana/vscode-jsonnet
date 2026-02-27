const path = require('path');
const { defineConfig } = require('@vscode/test-cli');

const common = {
  files: 'out/test/**/*.integration.test.js',
  workspaceFolder: path.resolve(__dirname, 'test-scenarios/basic'),
  launchArgs: ['--disable-extensions'],
  mocha: {
    timeout: 30000,
  },
};

module.exports = defineConfig([
  {
    label: 'fake',
    ...common,
  },
  {
    label: 'real',
    ...common,
    env: {
      JSONNET_TEST_REAL_LSP: '1',
      JSONNET_LSP_SERVER: process.env.JSONNET_LSP_SERVER,
    },
  },
]);
