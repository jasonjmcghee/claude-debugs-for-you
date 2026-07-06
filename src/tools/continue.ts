import { z } from 'zod';
import { ToolConfig } from './types';
import { DebugSessionRegistry } from '../debugSessionRegistry';

const name = "continue";
const description = "Continue execution from a breakpoint. Do not use this unless you know the debug session is stopped at a breakpoint. Most notably, you do not, in general, have to use this when starting a debug session. If you use this blindly, you risk skipping a breakpoint.";

const inputSchema = z.object({sessionId: z.string().optional()});

export async function handle(debugSessionRegistry: DebugSessionRegistry, payload: z.infer<typeof inputSchema>) {
  const session = debugSessionRegistry.getSessionOrTheStopped(payload.sessionId).session;
  
  // Get the current thread ID (required by DAP spec)
  const threads = await session.customRequest("threads");
  let threadId = threads.threads[0].id;

  // Continue with the thread ID
  await session.customRequest("continue", { threadId });

  return `Continued.`;
}


export const tool = {name, description, inputSchema} satisfies ToolConfig<typeof inputSchema>;