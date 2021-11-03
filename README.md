# vscode-jsonnet

Full code support (formatting, highlighting, navigation, etc) for Jsonnet

Uses <https://github.com/jdbaldry/jsonnet-language-server> as a language server

## To use this

1. Build/install or download the [jsonnet language server](https://github.com/jdbaldry/jsonnet-language-server)
2. Build the vscode client (`npm run compile` or `npm run watch`)
3. Run vscode with following command: `code <path_to_jsonnet> --extensionDevelopmentPath=<path_to_vscode_client>`