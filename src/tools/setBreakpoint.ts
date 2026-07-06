import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import { DebugSessionRegistry } from "../debugSessionRegistry";
import { sleep } from "../utils/sleep";
import * as GetSessionsState from "./getSessionStates";

const name = "setBreakpoint";
const description =
  "Set a breakpoint. Use absolute local file paths (e.g. `/home/user/...`).";

const inputSchema = z.object({
  file: z.string(),
  line: z.coerce.number(),
  condition: z.string().optional(),
});

export async function handle(
  debugSessionRegistry: DebugSessionRegistry,
  payload: z.infer<typeof inputSchema>,
) {
  // Open the file and make it active
  const document = await vscode.workspace.openTextDocument(payload.file);
  const editor = await vscode.window.showTextDocument(document);

  const bp = new vscode.SourceBreakpoint(
    new vscode.Location(
      editor.document.uri,
      new vscode.Position(payload.line - 1, 0),
    ),
    true,
    payload.condition,
  );
  vscode.debug.addBreakpoints([bp]);

  if (debugSessionRegistry.getSessions().size > 0) {
    await sleep(1000);
    return GetSessionsState.handle(debugSessionRegistry);
  } else {
    // The breakpoint will be pending until a debug session starts.
    return "Success.";
  }
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
