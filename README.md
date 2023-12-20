# vscode-jsonnet

Full code support (formatting, highlighting, navigation, etc) for Jsonnet

Uses <https://github.com/grafana/jsonnet-language-server> as a language server. See that project's readme for information about its features

## Additional Features (over the language server)

### Auto-update

Installs the language server and keeps it up-to-date (prompting the user to install the new binary)

https://user-images.githubusercontent.com/29210090/145628508-0a793f71-dc62-4b4c-8de9-9f04801a5d2e.mp4

### Evaluate a file or an expression

https://user-images.githubusercontent.com/29210090/145628481-97b2d6ee-9ef6-4a72-82f5-2e488cf2e6cd.mp4

The new commands `jsonnet: Evaluate File (String)` and `jsonnet: Evaluate Expression (String)` interpret
the result as a JSON string, or an array which is recursively flattened to a string. (This can be useful
to examine intermediate results).

The non-JSON output formats check the first line for a string of the form `Output: <name.ext>`. Only the
file extension is used, to construct the name of the preview buffer, `result.<ext>`. This allows proper
syntax highlighting of the result file. For example, a script to produce a shell script might begin:

```jsonnet
// Output: .sh
```

and syntax highlighting for `.sh` files will be enabled.

## To use this

1. Install the extension from [the VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=Grafana.vscode-jsonnet) or [Open VSX](https://open-vsx.org/extension/Grafana/vscode-jsonnet)
2. Open a jsonnet file and follow the instructions on screen to download the language server
3. Enjoy
