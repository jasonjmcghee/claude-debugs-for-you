import * as vscode from "vscode";

export const logger = vscode.window.createOutputChannel("MCP Debug", {
  log: true,
});