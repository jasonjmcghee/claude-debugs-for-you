import { z } from "zod";
import * as vscode from "vscode";
import { DebugSessionRegistry } from "../debugSessionRegistry";

const name = "variables";
const description =
  "Retrieves all child variables for the given variable reference.";

const inputSchema = z.object({
  sessionId: z.string().optional(),
  // Claude sometimes passes numbers as strings by mistake
  variablesReference: z.coerce.number(),
});

export async function handle(debugSessionRegistry: DebugSessionRegistry, payload: z.infer<typeof inputSchema>) {
  const session = debugSessionRegistry.getSessionOrTheStopped(payload.sessionId).session;

  const response = await session.customRequest("variables", {
    variablesReference: payload.variablesReference,
  });

  return `Variables result: ${JSON.stringify(response)}`;
}

export const tool = { name, description, inputSchema };
