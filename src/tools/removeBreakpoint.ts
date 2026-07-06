import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import * as GetSessionsState from "./getSessionStates";
import { DebugSessionRegistry } from "../debugSessionRegistry";
import { sleep } from "../utils/sleep";
import { Breakpoint } from "../debugSessionTracker";

const name = "removeBreakpoint";
const description = "Remove a breakpoint.";

function findClosest(a: number, arr: number[]): number | undefined {
  let closest: number | undefined;

  for (const b of arr) {
    if (typeof closest === "undefined") {
      closest = b;
    }
    closest = Math.abs(closest - a) < Math.abs(b - a) ? closest : b;
  }

  return closest;
}

const inputSchema = z.object({
  sessionId: z.string().optional(),
  file: z.string(),
  line: z.coerce.number(),
});

export async function handle(
  debugSessionRegistry: DebugSessionRegistry,
  payload: z.infer<typeof inputSchema>,
) {
  // Open the file and make it active
  const document = await vscode.workspace.openTextDocument(payload.file);
  const editor = await vscode.window.showTextDocument(document);
  const targetUri = editor.document.uri.toString();

  let sourceBreakpoints: readonly Breakpoint[] | undefined;

  if (debugSessionRegistry.getSessions().size > 0) {
    // Try un-resolving the line.
    sourceBreakpoints = debugSessionRegistry
      .getSessionOrTheStopped(payload.sessionId)
      ?.breakpoints?.get(payload.file);
    const sourceBreakpoint = sourceBreakpoints?.find(
      (b) => b.line === payload.line,
    );
    // Adjust the line in the payload if we could.
    if (sourceBreakpoint) {
      payload.line = sourceBreakpoint.requestedLine;
    }
  }

  const vscodeBreakpoints = vscode.debug.breakpoints
    .filter((b) => b instanceof vscode.SourceBreakpoint)
    .filter((b) => b.location.uri.toString() === targetUri);

  const breakpoint = vscodeBreakpoints.find(
    (bp) => bp.location.range.start.line + 1 === payload.line,
  );

  if (!breakpoint) {
    const closestLine = findClosest(
      payload.line,
      sourceBreakpoints?.map((b) => b.line) ?? [],
    );
    return `Breakpoint not found.${typeof closestLine !== "undefined" ? ` The closest breakpoint is at line ${closestLine}.` : ""}`;
  }
  vscode.debug.removeBreakpoints([breakpoint]);

  if (debugSessionRegistry.getSessions().size > 0) {
    await sleep(1000);
    return GetSessionsState.handle(debugSessionRegistry);
  } else {
    return "Success.";
  }
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
