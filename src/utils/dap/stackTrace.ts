import { DebugProtocol } from "@vscode/debugprotocol";
import { DebugSession } from "vscode";

export async function stackTrace(session: DebugSession, threadId: number) {
  const stackTrace: DebugProtocol.StackTraceResponse["body"] = await session.customRequest("stackTrace", { threadId });
  return stackTrace;
}
