import * as vscode from "vscode";
import { z } from "zod";

import * as dap from "./dap";
import { logger } from "./logger";

export type InitializingState = { type: "initializing" };
export type RunningState = { type: "running" };
export type StoppedState = { type: "stopped"; threadId: number };
export type ExitedState = { type: "exited" };

export type Breakpoint = dap.Breakpoint & { requestedLine: number; line: number; condition?: string };

export interface DebugSessionState {
  readonly session: vscode.DebugSession;
  readonly state: Readonly<
    InitializingState | RunningState | StoppedState | ExitedState
  >;
  // Keyed by source path ?? name.
  breakpoints: ReadonlyMap<string, readonly Breakpoint[]>;

  readOutputs(): dap.Output["body"][];
}

export class DebugSessionStateImpl implements DebugSessionState {
  readonly session: vscode.DebugSession;
  state: DebugSessionState["state"] = { type: "initializing" };
  breakpoints: Map<string, Breakpoint[]>;
  // This only contains setBreakpoints requests that have not
  // received a response from the adapter yet.
  pending_setbreakpoints_requests: Map<number, dap.SetBreakpointsArguments>;
  outputBuffer: [dap.Output["body"], number][]; // second: size in bytes
  outputBufferSize = 0; // Total size in bytes

  constructor(session: vscode.DebugSession) {
    this.session = session;
    this.breakpoints = new Map();
    this.pending_setbreakpoints_requests = new Map();
    this.outputBuffer = [];
  }

  readOutputs() {
    // Strip away the size information
    const outputs = this.outputBuffer.map(([body]) => body);
    this.outputBuffer = [];
    this.outputBufferSize = 0;
    return outputs;
  }
}

const setBreakpointsRequestSchema = z.object({
  seq: z.int(),
  command: z.literal("setBreakpoints"),
  arguments: dap.SetBreakpointsArgumentsSchema,
});

const setBreakpointsResponseSchema = z.object({
  request_seq: z.int(),
  body: z.object({
    breakpoints: z.array(dap.BreakpointSchema),
  }),
});

type SetBreakpointsResponse = z.infer<typeof setBreakpointsResponseSchema>;

const eventSchema = z.discriminatedUnion("event", [
  dap.OutputSchema,
  dap.BreakpointEventSchema,
  dap.ContinuedSchema,
  dap.ExitedSchema,
  dap.StoppedSchema,
]);

type Event = z.infer<typeof eventSchema>;

export class DebugSessionTracker {
  state: DebugSessionStateImpl;
  delState: () => void;
  fireStateChanged: () => void;

  constructor(
    state: DebugSessionStateImpl,
    delState: () => void,
    fireStateChanged: () => void,
  ) {
    this.state = state;
    this.delState = delState;
    this.fireStateChanged = fireStateChanged;
  }

  onWillReceiveMessage(msg: any) {
    logger.debug("Editor sending DAP message", this.state.session.id, msg);
    try {
      const parsed = setBreakpointsRequestSchema.safeParse(msg);
      if (!parsed.success) {
        return;
      }
      const data = parsed.data;
      this.state.pending_setbreakpoints_requests.set(data.seq, data.arguments);
    } catch (e) {
      logger.error("Caught exception while handling DAP message", e);
    }
  }

  handleBreakpointEvent(event: dap.BreakpointEvent["body"]) {
    switch (event.reason) {
      case "new":
        // We do not support "new" breakpoint events.
        break;
      case "changed":
        const id = event.breakpoint.id;
        if (typeof id === "undefined") {
          // As per the DAP spec.
          logger.warn("Expected id in breakpoint changed event.");
        }
        // Naively search for the matching id across all the sources.
        // This can be improved for sure.
        (() => {
          for (const breakpoints of this.state.breakpoints.values()) {
            for (let i = 0; i < breakpoints.length; i++) {
              if (breakpoints[i].id === id) {
                breakpoints[i] = { ...breakpoints[i], ...event.breakpoint };
                this.fireStateChanged();
                return;
              }
            }
          }
          logger.warn("Did not find a matching breakpoint.");
        })();
        break;
      case "removed":
        // We do not support "removed" breakpoint events.
        break;
      default:
        event.reason satisfies never;
    }
  }

  handleOutputEvent(event: dap.Output["body"]) {
    const BufferSizeLimit = 5 * 1024; // 5kb
    const eventSize = JSON.stringify(event).length;
    while (this.state.outputBufferSize + eventSize > BufferSizeLimit) {
      const firstOutput = this.state.outputBuffer.splice(0, 1)[0];
      this.state.outputBufferSize -= firstOutput[1];
    }
    // Always push the latest output
    this.state.outputBuffer.push([event, eventSize]);
    this.state.outputBufferSize += eventSize;
  }

  handleDAPEvent(event: Event) {
    logger.debug("Got DAP event", this.state.session.id, event);
    switch (event.event) {
      case "continued":
        this.state.state = { type: "running" };
        break;
      case "exited":
        this.state.state = { type: "exited" };
        break;
      case "stopped":
        this.state.state = { type: "stopped", threadId: event.body.threadId };
        break;
      case "breakpoint":
        this.handleBreakpointEvent(event.body);
        break;
      case "output":
        this.handleOutputEvent(event.body);
        break;
      default:
        event satisfies never;
    }
    this.fireStateChanged();
  }

  handleSetBreakpointsResponse(response: SetBreakpointsResponse) {
    const request = this.state.pending_setbreakpoints_requests.get(
      response.request_seq,
    );
    if (!request) {
      // No corresponding request.
      // Maybe this is not even a setBreakpoints request, after all.
      // In any case, not much we can do.
      return;
    }
    // Remove the request from the buffer.
    this.state.pending_setbreakpoints_requests.delete(response.request_seq);

    // Need to merge the request and the response, because the response
    // may omit line information and does not have conditions.
    const requestBreakpoints = request.breakpoints;
    const responseBreakpoints = response.body.breakpoints;
    // As per the DAP spec.
    if ((requestBreakpoints?.length ?? 0) !== responseBreakpoints.length) {
      logger.warn("Mismatching setBreakpoints requests vs. response length.");
      return;
    }

    const mergedBreakpoints = [] as Breakpoint[];

    for (let i = 0; i < (requestBreakpoints?.length ?? 0); i++) {
      const requestBreakpoint = requestBreakpoints![i];
      const responseBreakpoint = responseBreakpoints[i];
      mergedBreakpoints.push({
        ...responseBreakpoint,
        requestedLine: requestBreakpoint.line,
        line: responseBreakpoint.line ?? requestBreakpoint.line,
        ...("condition" in requestBreakpoint
          ? { condition: requestBreakpoint.condition }
          : {}),
      });
    }

    const sourceKey = request.source.path ?? request.source.name;
    if (mergedBreakpoints.length === 0) {
      this.state.breakpoints.delete(sourceKey);
    } else {
      this.state.breakpoints.set(sourceKey, mergedBreakpoints);
    }

    this.fireStateChanged();
  }

  onDidSendMessage(msg: any) {
    logger.debug("Got DAP message", this.state.session.id, msg);
    try {
      {
        const parsed = z.safeParse(eventSchema, msg);
        if (parsed.success) {
          this.handleDAPEvent(parsed.data);
          return;
        }
      }
      {
        const parsed = z.safeParse(setBreakpointsResponseSchema, msg);
        if (parsed.success) {
          this.handleSetBreakpointsResponse(parsed.data);
        }
      }
    } catch (e) {
      logger.error("Caught exception while handling DAP event", e);
    }
  }

  onWillStopSession() {
    logger.debug("Debug session terminated", this.state.session.id);
    this.fireStateChanged();
    this.delState();
  }
}
