# vscode-jsonnet

Full code support (formatting, highlighting, navigation, etc) for Jsonnet

Uses Rustanka's `jrsonnet-lsp` as a language server. See [rustanka-lsp
documentation] for supported features and configuration.

## Additional Features (over the language server)

### Auto-update

Installs the language server and keeps it up-to-date (prompting the user to
install the new binary)

<https://user-images.githubusercontent.com/29210090/145628508-0a793f71-dc62-4b4c-8de9-9f04801a5d2e.mp4>

### Evaluate a file or an expression

<https://user-images.githubusercontent.com/29210090/145628481-97b2d6ee-9ef6-4a72-82f5-2e488cf2e6cd.mp4>

## Commands

### `Jsonnet: Evaluate File`

Evaluates the active Jsonnet document and opens the result beside the editor.

When `jsonnet.languageServer.continuousEval` is enabled (default), result
output is refreshed after Jsonnet file changes.

### `Jsonnet: Evaluate Expression`

Prompts for an expression and evaluates it against the active Jsonnet
document context.

Use `Jsonnet: Evaluate Expression (YAML)` for YAML output.

### `Jsonnet: Debug File`

Starts a debug session using the active file as `program`.

The extension also contributes a launch configuration template:
`Debug current Jsonnet file`.

### `Jsonnet: Find Transitive Importers`

Asks the language server for all files that import the active file
transitively, then opens a quick pick to jump to one of them.

## Error Behavior

- If there is no active editor for eval/debug/importer commands, the extension
  shows `No active editor`.
- If the language server is not running, commands show
  `Language server is not running`.
- Eval failures are shown to the user and written to the result view.
- Importer lookup shows `No transitive importers found` when the server
  returns an empty set.
- Auto-update download failures are reported in both the UI and `Jsonnet`
  output channel.

## To use this

1. Install the extension from [the VSCode Marketplace][VSCode Marketplace] or
   [Open VSX]
2. Open a jsonnet file and follow the instructions on screen to download the
   language server
3. Enjoy

## Development Testing

- `npm test` runs fast unit tests.
- `npm run test:integration` runs VS Code extension-host integration tests
  through `@vscode/test-cli` with the fake LSP.
- `npm run test:integration:real` runs the same suite against a real LSP
  binary. Set `JSONNET_LSP_SERVER` to the binary path.
- Integration scenarios live in `test-scenarios/` and include Jsonnet and
  Tanka-style trees.
- Integration harness forces `jsonnet.languageServer.enableAutoUpdate=false`
  and `jsonnet.debugger.enableAutoUpdate=false`.

[Open VSX]: https://open-vsx.org/extension/Grafana/vscode-jsonnet
[rustanka-lsp documentation]: https://github.com/grafana/rustanka/tree/main/docs/lsp
[VSCode Marketplace]: https://marketplace.visualstudio.com/items?itemName=Grafana.vscode-jsonnet
