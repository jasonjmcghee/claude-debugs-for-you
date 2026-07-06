import { z } from 'zod';
import * as vscode from "vscode";
import { ToolConfig } from './types';

const name = "stop";
const description = "Stop the debug session. This is the opposite of launch.";

const inputSchema = z.object({});

export async function handle(): Promise<string> {
  await vscode.debug.stopDebugging();

  return `Stopped debugging.`;
}

export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;