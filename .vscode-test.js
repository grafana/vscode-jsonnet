const path = require('path');
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.integration.test.js',
  workspaceFolder: path.resolve(__dirname, 'test-scenarios/basic'),
  launchArgs: ['--disable-extensions'],
  mocha: {
    timeout: 30000,
  },
});
