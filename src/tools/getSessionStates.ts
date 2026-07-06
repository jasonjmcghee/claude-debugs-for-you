import { z } from "zod";
import { ToolConfig } from "./types";
import { stackTrace } from "../utils/dap/stackTrace";
import { cleanStackFrames, formatStackFrames } from "../utils/stackTraceFormat";
import { DebugSessionRegistry } from "../debugSessionRegistry";

const name = "getSessionStates";
const description =
  "Get the state of the debug sessions, including a stack trace for the stopped thread per debug session in which the debuggee is stopped. Most other tools calls this implicitly, so you should rarely need to use it explicitly.";

const inputSchema = z.object({});

function mapMapValues<K, V, U>(
  map: ReadonlyMap<K, V>,
  f: (v: V) => U,
): Map<K, U> {
  const res = new Map<K, U>();
  for (const [k, v] of map.entries()) {
    res.set(k, f(v));
  }
  return res;
}

async function mapMapValuesAsync<K, V, U>(
  map: ReadonlyMap<K, V>,
  f: (v: V) => Promise<U>,
): Promise<Map<K, U>> {
  const res = new Map<K, U>();
  for (const [k, v] of map.entries()) {
    res.set(k, await f(v));
  }
  return res;
}

export async function handle(
  debugSessionRegistry: DebugSessionRegistry,
): Promise<string> {
  const sessions = debugSessionRegistry.getSessions();
  if (sessions.size === 0) {
    return "There are no debug sessions.";
  }

  return JSON.stringify(
    Object.fromEntries(
      await mapMapValuesAsync(sessions, async (sessionState) => {
        const output = sessionState.readOutputs();
        const breakpoints = Object.fromEntries(
          mapMapValues(sessionState.breakpoints, (breakpoints) =>
            breakpoints.map((b) => {
              return {
                line: b.line,
                verified: b.verified,
                message: b.message,
                condition: b.condition,
              };
            }),
          ).entries(),
        );
        const frames =
          sessionState.state.type === "stopped"
            ? {
                frames: await (async (stoppedState) => {
                  const stack = await stackTrace(
                    sessionState.session,
                    stoppedState.threadId,
                  );
                  const frames = formatStackFrames(
                    cleanStackFrames(stack.stackFrames),
                  );
                  return frames;
                })(sessionState.state),
              }
            : {};

        return {
          state: sessionState.state.type,
          name: sessionState.session.name,
          pid: sessionState.session.configuration.pid ?? "<unknown>",
          breakpoints:
            Object.keys(breakpoints).length > 0
              ? breakpoints
              : "<no breakpoints>",
          recentOutput: output.length > 0 ? output : "<no recent output>",
          ...frames,
        };
      }),
    ),
  );
}

export const tool = { name, description, inputSchema } satisfies ToolConfig<
  typeof inputSchema
>;
