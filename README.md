# <img src="./images/claude-debugs-for-you.png" width="64" height="64" alt="description" align="center"> Claude Debugs For You


[![Badge](https://img.shields.io/badge/Visual%20Studio%20Marketplace-0.0.3-blue.svg)](https://marketplace.visualstudio.com/items?itemName=JasonMcGhee.claude-debugs-for-you)

### Enable Claude (or any other LLM) to interactively debug your code

This is an [MCP](https://docs.anthropic.com/en/docs/build-with-claude/mcp) Server and VS Code extension which enables claude to interactively debug and evaluate expressions.

That means it should also work with other models / clients etc. but I only demonstrate it with Claude Desktop here.

It's language-agnostic, assuming debugger console support and valid launch.json for debugging in VSCode.

## Getting Started

- Download the extension from [releases](https://github.com/jasonjmcghee/claude-debugs-for-you/releases/) or [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JasonMcGhee.claude-debugs-for-you)
- Install the extension
  - If using `.vsix` directly, go to the three dots in "Extensions" in VS Code and choose "Install from VSIX..."
- Open a project containing a `.vscode/launch.json` with the first configuration setup to debug a specific file with `${file}`.
- Execute "Start MCP Debug Server" (A popup will show that it started: copy the SSE URL)

<img width="384" alt="image" src="https://github.com/user-attachments/assets/5de31d62-32e5-4eac-83f1-cd6bacc2ab7d" />

### Configure MCP Server

You can configure the MCP server in either Claude Desktop or Cursor:

#### Claude Desktop
Paste the following (updating the port if needed) in your `claude_desktop_config.json`:

Config file location:
- MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```
{
  "mcpServers": {
    "debug": {
      "sse": "http://localhost:4711/sse"
    }
  }
}
```

#### Cursor
1. Open Cursor Settings (Ctrl + Shift + J)
2. Go to Features -> MCP Servers
3. Add a new server with:
   - Name: `debug`
   - Type: `sse`
   - URL: `http://localhost:4711/sse`

- Start Claude desktop (or other MCP client)
- You're ready to debug
- See [Run  an Example](#run-an-example) below.

## Contributing

Find bugs or have an idea that will improve this? Please open a pull request or log an issue.

Does this readme suck? Help me improve it!

## Demo

In this example, I made it intentionally very cautious (make no assumptions etc - same prompt as below) but you can ask it to do whatever.

https://github.com/user-attachments/assets/ef6085f7-11a2-4eea-bb60-b5a54873b5d5

## Development

1. Install dependencies
```bash
npm install
```

2. Development in VS Code/Cursor
   - Open the project in VS Code/Cursor
   - Press `F5` to start debugging (this will automatically):
     - Start the TypeScript watch compilation
     - Launch the debugger
     - Connect to the debug server

Alternatively, you can manually:
- Start watching for changes: `npm run watch`
- Start the debug server: `npm run start`

## Package

You can build a VSIX package for installation in VS Code:

```bash
# Install dependencies
npm install

# Build the extension
npm run compile

# Create VSIX package
npm run package
```

This will create a file named `claude-debugs-for-you-0.0.4.vsix` in your project directory.

### Installing the VSIX

There are two ways to install the VSIX package:

1. Through VS Code UI:
   - Open VS Code
   - Go to the Extensions view (Ctrl+Shift+X)
   - Click the "..." menu in the top right
   - Select "Install from VSIX..."
   - Choose the `claude-debugs-for-you-0.0.4.vsix` file

2. Through command line:
   ```bash
   code --install-extension claude-debugs-for-you-0.0.4.vsix
   ```

## Run an Example

Enter the prompt:

```
i am building `longest_substring_with_k_distinct` and for some reason it's not working quite right. can you debug it step by step using breakpoints and evaluating expressions to figure out where it goes wrong? make sure to use the debug tool to get access and debug! don't make any guesses as to the problem up front. DEBUG!
```

## Configuration

There's a hidden env var you can use to set the port on the MCP side.

```
"debug": {
  "command": "node",
  "args": [
    "/path/to/mcp-debug.js"
  ],
  "env": {
    "MCP_DEBUGGER_PORT": 4711
  }
}
```

And similarly you may set the port on the vs code side using extensions settings or JSON:

<img width="243" alt="image" src="https://github.com/user-attachments/assets/51037811-b4f1-4c65-9344-f4d14d059be7" />

```
"mcpDebug.port": 4711
```

## Short list of ideas

- [ ] It should use ripgrep to find what you ask for, rather than list files + get file content.
- [x] Add support for conditional breakpoints
- [ ] Add "fix" tool by allowing MCP to insert a CodeLens or "auto fix" suggestion so the user can choose to apply a recommended change or not.
- Your idea here!