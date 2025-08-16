# <img src="./images/claude-debugs-for-you.png" width="64" height="64" alt="description" align="center"> Claude Debugs For You

[![Badge](https://img.shields.io/badge/Visual%20Studio%20Marketplace-0.1.1-blue.svg)](https://marketplace.visualstudio.com/items?itemName=JasonMcGhee.claude-debugs-for-you)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/jasonjmcghee/claude-debugs-for-you)](https://archestra.ai/mcp-catalog/jasonjmcghee__claude-debugs-for-you)

_aka Vibe Debugging_

### Enable Claude (or any other LLM) to interactively debug your code

This is an [MCP](https://docs.anthropic.com/en/docs/build-with-claude/mcp) Server and VS Code extension which enables claude to interactively debug and evaluate expressions.

That means it should also work with other models / clients etc. but I only demonstrate it with Claude Desktop and Continue here.

It's language-agnostic, assuming debugger console support and valid launch.json for debugging in VSCode.

## Getting Started

1. Download the extension from [releases](https://github.com/jasonjmcghee/claude-debugs-for-you/releases/) or [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=JasonMcGhee.claude-debugs-for-you)
2. Install the extension
  - If using `.vsix` directly, go to the three dots in "Extensions" in VS Code and choose "Install from VSIX..."
3. You will see a new status menu item "Claude Debugs For You" which shows if it is running properly (check) or failed to startup (x)

<img width="314" alt="Screenshot 2025-03-22 at 9 51 22 PM" src="https://github.com/user-attachments/assets/2cd65e0d-4c1d-4fb6-b9ea-3995149b4043" />

You can click this status menu for the commands available

<img width="510" alt="Screenshot 2025-03-22 at 9 59 22 PM" src="https://github.com/user-attachments/assets/54e339e3-81f8-4ef2-a201-6742aa2c97a8" />

### Follow one of the options below, depending on your setup

<details>
  <summary>If using stdio (classic, required for Claude Desktop)</summary>

4. Copy the stdio server path to your clipboard by searching vs code commands for "Copy MCP Debug Server stdio path to clipboard"

5. Paste the following (BUT UPDATE THE PATH TO THE COPIED ONE!) in your `claude_desktop_config.json` or edit accordingly if you use other MCP servers

```
{
  "mcpServers": {
    "debug": {
      "command": "node",
      "args": [
        "/path/to/mcp-debug.js"
      ]
    }
  }
}
```

6. Start Claude desktop (or other MCP client)
    1. Note: You may need to restart it, if it was already running.
    2. You can skip this step if using Continue/Cursor or other built-in to VS Code
</details>

<details>
  <summary>If using `/sse` (e.g. Cursor)</summary>

4. Retrieve the MCP server sse address by using the "Copy MCP Debug Server sse address to clipboard" command
    1. You can just write it out server URL of "http://localhost:4711/sse", or whatever port you setup in settings.
5. Add it wherever you need to based on your client
    1. You may need to hit "refresh" depending on client: this is required in Cursor
6. Start MCP client
   1. Note: You may need to restart it, if it was already running.
   2. You can skip this step if using Continue/Cursor or other built-in to VS Code

</details>

### You're ready to debug!

_[VS Code Debugging Documentation](https://code.visualstudio.com/Docs/editor/debugging)_

Open a project containing a `.vscode/launch.json` with the first configuration setup to debug a specific file with `${file}`.

See [Run  an Example](#run-an-example) below, and/or watch a demo video.

## Contributing

Find bugs or have an idea that will improve this? Please open a pull request or log an issue.

Does this readme suck? Help me improve it!

## Demo

### Using [Continue](https://github.com/continuedev/continue)

It figures out the problem, and then suggests a fix, which we just click to apply

https://github.com/user-attachments/assets/3a0a879d-2db7-4a3f-ab43-796c22a0f1ef

<details>
  <summary>How do I set this up with Continue? / Show MCP Configuration</summary>

  [Read the docs!](https://docs.continue.dev/customize/tools)

  Configuration:
  
  ```json
  {
    ...
    "experimental": {
      "modelContextProtocolServers": [
        {
          "transport": {
            "type": "stdio",
            "command": "node",
            "args": [
              "/Users/jason/Library/Application Support/Code/User/globalStorage/jasonmcghee.claude-debugs-for-you/mcp-debug.js"
            ]
          }
        }
      ]
    }
  }
  ```

  You'll also need to choose a model capable of using tools.

  When the list of tools pops up, make sure to click "debug" in the list of your tools, and set it to be "Automatic".

  ### Troubleshooting

  If you are seeing MCP errors in continue, try disabling / re-enabling the continue plugin

</details>

If helpful, this is what my configuration looks like! But it's nearly the same as Claude Desktop.


### Using Claude Desktop

In this example, I made it intentionally very cautious (make no assumptions etc - same prompt as below) but you can ask it to do whatever.

https://github.com/user-attachments/assets/ef6085f7-11a2-4eea-bb60-b5a54873b5d5

## Developing

- Clone / Open this repo with VS Code
- Run `npm run install` and `npm run compile`
- Hit "run" which will open a new VSCode
- Otherwise same as "Getting Started applies"
- To rebuild, `npm run compile`

## Package

```bash
vsce package
```


## Run an Example

Open `examples/python` in a VS Code window

Enter the prompt:

```
i am building `longest_substring_with_k_distinct` and for some reason it's not working quite right. can you debug it step by step using breakpoints and evaluating expressions to figure out where it goes wrong? make sure to use the debug tool to get access and debug! don't make any guesses as to the problem up front. DEBUG!
```

## Other things worth mentioning

When you start multiple vs code windows, you'll see a pop-up. You can gracefully hand-off "Claude Debugs For You" between windows.

You can also disable autostart. Then you'll just need to click the status menu and select "Start Server".

<img width="395" alt="Screenshot 2025-03-22 at 10 08 52 PM" src="https://github.com/user-attachments/assets/2b6d1b61-a2c6-4447-8054-b4dd02a716e8" />


## Short list of ideas

- [ ] It should use ripgrep to find what you ask for, rather than list files + get file content.
- [x] Add support for conditional breakpoints
- [ ] Add "fix" tool by allowing MCP to insert a CodeLens or "auto fix" suggestion so the user can choose to apply a recommended change or not.
- Your idea here!
