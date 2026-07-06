import { z } from "zod";
import * as vscode from "vscode";
import { ToolConfig } from "./types";
import {
  DebugSessionRegistry,
  DebugSessionState,
} from "../debugSessionRegistry";
import * as GetSessionStates from "./getSessionStates";

const name = "wait";
const description =
  "Block until a debug session starts, a breakpoint gets hit or the debuggee exits. Times out after 15 seconds.";

const inputSchema = z.object({});

// Source - https://stackoverflow.com/a/46675277
// Posted by Drew Noakes, modified by community. See post 'Timeline' for change history
// Retrieved 2026-03-28, License - CC BY-SA 4.0
async function withTimeout<T>(
  millis: number,
  callback: () => Error,
  promise: Promise<T>,
): Promise<T> {
  let timeout!: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>(
    (_, reject) => (timeout = setTimeout(() => reject(callback()), millis)),
  );
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function wait(debugSessionRegistry: DebugSessionRegistry) {
  let handle: vscode.Disposable;
  let promise: Promise<void>;
  if (debugSessionRegistry.getSessions().size === 0) {
    promise = new Promise<void>(
      (res) =>
        (handle = debugSessionRegistry.onStateChanged((sessionId) => {
          // A new debug session has started.
          res();
        })),
    );
  } else {
    const checkDebugSession = (x: DebugSessionState) =>
      x.state.type === "stopped" || x.state.type === "exited";

    // Return immediately if there are any stopped/exited targets.
    if (
      [...debugSessionRegistry.getSessions().values()].findIndex(
        checkDebugSession,
      ) !== -1
    ) {
      return;
    }

    promise = new Promise<void>(
      (res) =>
        (handle = debugSessionRegistry.onStateChanged((sessionId) => {
          const session = debugSessionRegistry.tryGetSession(sessionId);
          if (!session || checkDebugSession(session)) {
            // The debug session got terminated/stopped/debuggee exited.
            res();
          }
        })),
    );
  }

  return withTimeout(
    15000,
    () => Error("No results after 15 seconds. Timing out."),
    promise,
  ).finally(() => handle.dispose());
}

export async function handle(
  debugSessionRegistry: DebugSessionRegistry,
): Promise<string> {
  await wait(debugSessionRegistry);
  return GetSessionStates.handle(debugSessionRegistry);
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
