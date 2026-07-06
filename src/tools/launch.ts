import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import { DebugSessionRegistry } from "../debugSessionRegistry";

const configName = "mcp_debug";

const name = "launch";
const description = `Start the debug configuration with the name \`${configName}\`.`;

const inputSchema = z.object({});

export async function handle(debugSessionRegistry: DebugSessionRegistry): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    throw new Error("No workspace folder found");
  }

  // Return an error message if we are already debugging
  if (debugSessionRegistry.getSessions().size > 0) {
    return "Already debugging.";
  }

  // Start debugging using the well-known launch configuration
  await vscode.debug.startDebugging(workspaceFolder, configName);

  return `Launched.`;
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
