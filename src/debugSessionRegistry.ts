import * as vscode from "vscode";
import { logger } from "./logger";
import {
  DebugSessionState,
  DebugSessionStateImpl,
  DebugSessionTracker,
} from "./debugSessionTracker";

export { DebugSessionState };

export class DebugSessionRegistry {
  private readonly _sessions = new Map<string, DebugSessionStateImpl>();
  private _trackerFactoryRegistration: vscode.Disposable | undefined;
  private readonly _onStateChanged = new vscode.EventEmitter<string>();
  readonly onStateChanged = this._onStateChanged.event;

  constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(this._onStateChanged);
  }

  startTracking() {
    if (this._trackerFactoryRegistration) {
      return;
    }

    const self = this;

    this._trackerFactoryRegistration =
      vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker(session: vscode.DebugSession) {
          logger.debug("Debug session started", session);
          const debugSessionState = new DebugSessionStateImpl(session);
          self._sessions.set(session.id, debugSessionState);
          self._onStateChanged.fire(session.id);
          const delState = () => self._sessions.delete(session.id);
          const fireStateChanged = () => self._onStateChanged.fire(session.id);
          return new DebugSessionTracker(
            debugSessionState,
            delState,
            fireStateChanged,
          );
        },
      });
  }

  stopTracking() {
    this._trackerFactoryRegistration?.dispose();
    this._trackerFactoryRegistration = undefined;
    this._sessions.clear();
  }

  getSessions(): ReadonlyMap<string, DebugSessionState> {
    return this._sessions;
  }

  tryGetSession(id: string): DebugSessionState | undefined {
    return this._sessions.get(id);
  }

  getSessionOrTheStopped(id: string | undefined): DebugSessionState {
    if (typeof id === "undefined") {
      if (this._sessions.size === 0) {
        throw new Error("There are no debug sessions.");
      }
      // If there is a single session, return it.
      if (this._sessions.size === 1) {
        return this._sessions.values().next().value!;
      }
      const stoppedSessions = [...this._sessions.values()].filter(
        (x) => x.state.type === "stopped",
      );
      if (stoppedSessions.length === 1) {
        return stoppedSessions[0];
      } else {
        throw new Error(
          "There are multiple stopped debug sessions. You need to pick a specific one. Use `getSessionStates` if necessary.",
        );
      }
    }
    const session = this.tryGetSession(id);
    if (!session) {
      throw new Error(
        "Session not found. If it existed, it might have exited.",
      );
    }
    return session;
  }
}
