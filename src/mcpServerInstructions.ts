export const mcpServerInstructions: string = `Some tools have an optional \`sessionId\` parameter. If you leave it empty, most tools will:

- use the singular session if there is only a single one (will usually be the case)
- use the singular stopped session if there is only a single stopped session.

In general, you should be able to get by by leaving it empty and letting the tool "guess", except for advanced debug sessions including multiple debug sessions.

### The skeleton of a debug workflow

In general you would do the following, in order:

- start by setting some breakpoints (note that you _can_ do this before starting a debug session - the IDE will take care of adding them to the debugger once the session starts)
- launch the target (potentially using the \`launch\` tool)
- perhaps send a request if you are debugging a server, call \`wait\` (potentially several times), see the debuggee stopped at a breakpoint, evaluate some expressions, potentially set new breakpoints/remove existing ones, and continue the debuggee.

When you are done, you can stop the debugging session using the \`stop\` tool.

This is just an example. Read the tool descriptions to get a better idea of what is available.`;