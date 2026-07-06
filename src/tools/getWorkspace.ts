import { z } from 'zod';
import * as vscode from "vscode";
import { ToolConfig } from './types';

const name = "getWorkspace";
const description = "Get the active workspace.";

const inputSchema = z.object({});

export function handle(): string {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    return "No workspace folder found";
  }
  return workspaceFolder.uri.fsPath;
}

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;