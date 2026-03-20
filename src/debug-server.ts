import * as net from 'net';
import * as http from 'http';
import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { z } from 'zod';

interface DebugServerEvents {
    on(event: 'started', listener: () => void): this;
    on(event: 'stopped', listener: () => void): this;
    emit(event: 'started'): boolean;
    emit(event: 'stopped'): boolean;
}
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export interface DebugCommand {
    command: 'listFiles' | 'getFileContent' | 'debug';
    payload: any;
}

export interface DebugStep {
    type: 'setBreakpoint' | 'removeBreakpoint' | 'continue' | 'evaluate' | 'launch' | 'stepOver' | 'stepInto' | 'stepOut' | 'pause' | 'getStackTrace' | 'getVariables' | 'getBreakpoints' | 'getThreads' | 'getModules' | 'setVariable' | 'goto' | 'startDebugging';
    file: string;
    line?: number;
    expression?: string;
    condition?: string;
}

interface ToolRequest {
    type: 'listTools' | 'callTool';
    tool?: string;
    arguments?: any;
}

const debugDescription = `Full-featured debugger control with breakpoints, stepping, inspection, and expression evaluation.
ONLY SET BREAKPOINTS BEFORE LAUNCHING OR WHILE PAUSED.
Only use continue when ready to move to the next breakpoint. Launch will bring you to the first breakpoint.
DO NOT USE CONTINUE TO GET TO THE FIRST BREAKPOINT.

Step types:
- setBreakpoint/removeBreakpoint: manage breakpoints (file+line required, optional condition)
- continue: resume execution (returns immediately)
- stepOver/stepInto/stepOut: single-step (waits for stop, returns new location)
- pause: break a running program (returns where it stopped)
- evaluate: evaluate expression in current frame (use expression field)
- getStackTrace: full call stack with file paths and line numbers
- getVariables: all locals/args in current frame with values and types
- getBreakpoints: list all currently set breakpoints with file, line, condition, enabled state
- getThreads: list all threads with ID, name, and stopped status
- getModules: list loaded modules/DLLs with symbol status
- setVariable: modify a variable value (use expression="name=value")
- goto: set next statement to a specific line (file+line required, does not execute)
- launch: start debug session using first launch.json config`;

const listFilesDescription = "List all files in the workspace. Use this to find any requested files.";

const getFileContentDescription = `Get file content with line numbers - you likely need to list files 
to understand what files are available. Be careful to use absolute paths.`;

// Zod schemas for the tools
const listFilesInputSchema = {
    includePatterns: z.array(z.string()).describe("Glob patterns to include (e.g. ['**/*.js'])").optional(),
    excludePatterns: z.array(z.string()).describe("Glob patterns to exclude (e.g. ['node_modules/**'])").optional(),
};

const getFileContentInputSchema = {
    path: z.string().describe("Path to the file. IT MUST BE AN ABSOLUTE PATH AND MATCH THE OUTPUT OF listFiles"),
};

const debugStepSchema = z.object({
    type: z.enum(["setBreakpoint", "removeBreakpoint", "continue", "evaluate", "launch", "stepOver", "stepInto", "stepOut", "pause", "getStackTrace", "getVariables", "getBreakpoints", "getThreads", "getModules", "setVariable", "goto", "startDebugging"]).describe(""),
    file: z.string(),
    line: z.number().optional(),
    expression: z.string().describe("An expression to be evaluated in the stack frame of the current breakpoint").optional(),
    condition: z.string().describe("If needed, a breakpoint condition may be specified to only stop on a breakpoint for some given condition.").optional(),
});

const debugInputSchema = {
    steps: z.array(debugStepSchema),
};

// Main tools array with Zod schemas
const tools = [
    {
        name: "listFiles",
        description: listFilesDescription, // Make sure this variable is defined in your code
        inputSchema: listFilesInputSchema,
    },
    {
        name: "getFileContent",
        description: getFileContentDescription, // Make sure this variable is defined in your code
        inputSchema: getFileContentInputSchema,
    },
    {
        name: "debug",
        description: debugDescription, // Make sure this variable is defined in your code
        inputSchema: debugInputSchema,
    },
];
export class DebugServer extends EventEmitter implements DebugServerEvents {
    private server: net.Server | null = null;
    private port: number = 4711;
    private portConfigPath: string | null = null;
    private activeTransports: Record<string, SSEServerTransport> = {};
    private mcpServer: McpServer;
    private _isRunning: boolean = false;

    constructor(port?: number, portConfigPath?: string) {
        super();
        this.port = port || 4711;
        this.portConfigPath = portConfigPath || null;
        this.mcpServer = new McpServer({
            name: "Debug Server",
            version: "1.0.0",
        });

        // Setup MCP tools to use our existing handlers
        this.mcpServer.tool("listFiles", listFilesDescription, listFilesInputSchema, async (args: any) => {
            const files = await this.handleListFiles(args);
            return { content: [{ type: "text", text: JSON.stringify(files) }] };
        });

        this.mcpServer.tool("getFileContent", getFileContentDescription, getFileContentInputSchema, async (args: any) => {
            const content = await this.handleGetFile(args);
            return { content: [{ type: "text", text: content }] };
        });

        this.mcpServer.tool("debug", debugDescription, debugInputSchema, async (args: any) => {
            const results = await this.handleDebug(args);
            return { content: [{ type: "text", text: results.join('\n') }] };
        });
    }

    get isRunning(): boolean {
        return this._isRunning;
    }

    setPort(port: number): void {
        this.port = port || 4711;

        // Update port in configuration file if available
        if (this.portConfigPath && typeof port === 'number') {
            try {
                const fs = require('fs');
                fs.writeFileSync(this.portConfigPath, JSON.stringify({ port }));
            } catch (err) {
                console.error('Failed to update port configuration file:', err);
                // We'll still use the new port even if saving to file fails
            }
        }
    }

    getPort(): number {
        return this.port;
    }

    async forceStopExistingServer(): Promise<void> {
        try {
            // Send a request to the shutdown endpoint of any existing server
            await new Promise<void>((resolve, reject) => {
                const req = http.request({
                    hostname: 'localhost',
                    port: this.port,
                    path: '/shutdown',
                    method: 'POST',
                    timeout: 3000 // 3 second timeout
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            // Give the server a moment to shut down
                            setTimeout(resolve, 500);
                        } else {
                            reject(new Error(`Unexpected status: ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', (err: NodeJS.ErrnoException) => {
                    // If we can't connect, there's no server running or it's not ours
                    if (err.code === 'ECONNREFUSED') {
                        resolve(); // No server running, so nothing to stop
                    } else {
                        reject(err);
                    }
                });

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timed out'));
                });

                req.end();
            });
        } catch (err) {
            console.error('Error requesting server shutdown:', err);
            throw new Error('Failed to stop existing server');
        }
    }

    async start(): Promise<void> {
        if (this.server) {
            throw new Error('Server is already running');
        }

        this.server = http.createServer(async (req, res) => {
            // Handle CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');

            if (req.method === 'OPTIONS') {
                res.writeHead(204).end();
                return;
            }

            // Shutdown endpoint - allows another instance to request shutdown of this server
            if (req.method === 'POST' && req.url === '/shutdown') {
                res.writeHead(200).end('Server shutting down');
                this.stop().catch(err => {
                    res.writeHead(500).end(`Error shutting down: ${err.message}`);
                });
                return;
            }

            // Legacy TCP-style endpoint
            if (req.method === 'POST' && req.url === '/tcp') {
                let body = '';
                req.on('data', chunk => body += chunk);
                req.on('end', async () => {
                    try {
                        const request = JSON.parse(body);
                        let response: any;

                        if (request.type === 'listTools') {
                            response = { tools };
                        } else if (request.type === 'callTool') {
                            response = await this.handleCommand(request);
                        }

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, data: response }));
                    } catch (error) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: false,
                            error: error instanceof Error ? error.message : 'Unknown error'
                        }));
                    }
                });
                return;
            }

            // SSE endpoint
            if (req.method === 'GET' && req.url === '/sse') {
                const transport = new SSEServerTransport('/messages', res);
                this.activeTransports[transport.sessionId] = transport;
                await this.mcpServer.connect(transport);
                res.on('close', () => {
                    delete this.activeTransports[transport.sessionId];
                });
                return;
            }

            // Message endpoint for SSE
            if (req.method === 'POST' && req.url?.startsWith('/messages')) {
                const url = new URL(req.url, 'http://localhost');
                const sessionId = url.searchParams.get('sessionId');
                if (!sessionId || !this.activeTransports[sessionId]) {
                    res.writeHead(404).end('Session not found');
                    return;
                }
                await this.activeTransports[sessionId].handlePostMessage(req, res);
                return;
            }

            res.writeHead(404).end();
        });

        return new Promise((resolve, reject) => {
            this.server!.listen(this.port, () => {
                this._isRunning = true;
                this.emit('started');
                resolve();
            }).on('error', reject);
        });
    }

    // Helper method to handle tool calls
    private async handleCommand(request: ToolRequest): Promise<any> {
        switch (request.tool) {
            case 'listFiles':
                return await this.handleListFiles(request.arguments);
            case 'getFileContent':
                return await this.handleGetFile(request.arguments);
            case 'debug':
                return await this.handleDebug(request.arguments);
            default:
                throw new Error(`Unknown tool: ${request.tool}`);
        }
    }

    private async handleLaunch(payload: {
        program: string,
        args?: string[]
    }): Promise<string> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        // Try to get launch configurations
        const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
        const configurations = launchConfig.get<any[]>('configurations');

        if (!configurations || configurations.length === 0) {
            throw new Error('No debug configurations found in launch.json');
        }

        // Get the first configuration and update it with the current file
        const config = { ...configurations[0] };

        // Replace ${file} with actual file path if it exists in the configuration
        Object.keys(config).forEach(key => {
            if (typeof config[key] === 'string') {
                config[key] = config[key].replace('${file}', payload.program);
            }
        });

        // Replace ${workspaceFolder} in environment variables if they exist
        if (config.env) {
            Object.keys(config.env).forEach(key => {
                if (typeof config.env[key] === 'string') {
                    config.env[key] = config.env[key].replace(
                        '${workspaceFolder}',
                        workspaceFolder.uri.fsPath
                    );
                }
            });
        }

        // Stop any existing debug session before launching a new one.
        // A stale/zombie session (e.g. from a stuck REPL) would otherwise be
        // reused, causing "Unable to find thread" errors on every subsequent
        // launch attempt.
        let session = vscode.debug.activeDebugSession;
        if (session) {
            let isAlive = false;
            try {
                const threads = await session.customRequest('threads');
                isAlive = threads?.threads?.length > 0;
            } catch {
                isAlive = false;
            }
            if (!isAlive) {
                await vscode.debug.stopDebugging(session);
                // Give VS Code a moment to tear down
                await new Promise(resolve => setTimeout(resolve, 500));
                session = undefined;
            }
        }

        if (!session) {
            // Start debugging using the configured launch configuration
            await vscode.debug.startDebugging(workspaceFolder, config);

            // Wait for session to be available
            session = await this.waitForDebugSession();
        }

        // Check if we're at a breakpoint
        try {
            const threads = await session.customRequest('threads');
            const threadId = threads?.threads?.[0]?.id;

            const stack = await session.customRequest('stackTrace', { threadId });
            if (stack.stackFrames && stack.stackFrames.length > 0) {
                const topFrame = stack.stackFrames[0];
                const currentBreakpoints = vscode.debug.breakpoints.filter(bp => {
                    if (bp instanceof vscode.SourceBreakpoint) {
                        return bp.location.uri.toString() === topFrame.source.path &&
                            bp.location.range.start.line === (topFrame.line - 1);
                    }
                    return false;
                });

                if (currentBreakpoints.length > 0) {
                    return `Debug session started - Stopped at breakpoint on line ${topFrame.line}`;
                }
            }
            return 'Debug session started';
        } catch (err) {
            console.error('Error checking breakpoint status:', err);
            return 'Debug session started';
        }
    }

    private waitForStopped(timeout: number = 10000): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error('Timeout waiting for debugger to stop'));
            }, timeout);

            const disposable = vscode.debug.onDidChangeActiveStackItem(() => {
                clearTimeout(timer);
                disposable.dispose();
                // Small delay to let VS Code fully update
                setTimeout(resolve, 50);
            });
        });
    }

    private async getThreadId(): Promise<{ session: vscode.DebugSession; threadId: number }> {
        const session = vscode.debug.activeDebugSession;
        if (!session) {
            throw new Error('No active debug session');
        }
        const threads = await session.customRequest('threads');
        const threadId = threads.threads[0].id;
        return { session, threadId };
    }

    private waitForDebugSession(): Promise<vscode.DebugSession> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for debug session'));
            }, 5000);

            const checkSession = () => {
                const session = vscode.debug.activeDebugSession;
                if (session) {
                    clearTimeout(timeout);
                    resolve(session);
                } else {
                    setTimeout(checkSession, 100);
                }
            };

            checkSession();
        });
    }

    private async handleListFiles(payload: {
        includePatterns?: string[],
        excludePatterns?: string[]
    }): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folders found');
        }

        const includePatterns = payload.includePatterns || ['**/*'];
        const excludePatterns = payload.excludePatterns || ['**/node_modules/**', '**/.git/**'];

        const files: string[] = [];
        for (const folder of workspaceFolders) {
            const relativePattern = new vscode.RelativePattern(folder, `{${includePatterns.join(',')}}`);
            const foundFiles = await vscode.workspace.findFiles(relativePattern, `{${excludePatterns.join(',')}}`);
            files.push(...foundFiles.map(file => file.fsPath));
        }

        return files;
    }

    private async handleGetFile(payload: { path: string }): Promise<string> {
        const doc = await vscode.workspace.openTextDocument(payload.path);
        const lines = doc.getText().split('\n');
        return lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
    }

    private async handleDebug(payload: { steps: DebugStep[] }): Promise<string[]> {
        const results: string[] = [];

        for (const step of payload.steps) {
            switch (step.type) {
                case 'setBreakpoint': {
                    if (!step.line) {
                        throw new Error('Line number required');
                    }
                    if (!step.file) {
                        throw new Error('File path required');
                    }

                    // Open the file and make it active
                    const document = await vscode.workspace.openTextDocument(step.file);
                    const editor = await vscode.window.showTextDocument(document);

                    const bp = new vscode.SourceBreakpoint(
                        new vscode.Location(
                            editor.document.uri,
                            new vscode.Position(step.line - 1, 0)
                        ),
                        true,
                        step.condition,
                    );
                    await vscode.debug.addBreakpoints([bp]);
                    results.push(`Set breakpoint at line ${step.line}`);
                    break;
                }

                case 'removeBreakpoint': {
                    if (!step.line) {
                        throw new Error('Line number required');
                    }
                    const bps = vscode.debug.breakpoints.filter(bp => {
                        if (bp instanceof vscode.SourceBreakpoint) {
                            return bp.location.range.start.line === step.line! - 1;
                        }
                        return false;
                    });
                    await vscode.debug.removeBreakpoints(bps);
                    results.push(`Removed breakpoint at line ${step.line}`);
                    break;
                }

                case 'continue': {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) {
                        throw new Error('No active debug session');
                    }

                    // Get the current thread ID (required by DAP spec)
                    const threads = await session.customRequest('threads');
                    const threadId = threads.threads[0].id;

                    // Continue with the thread ID
                    await session.customRequest('continue', { threadId });
                    results.push('Continued execution');
                    break;
                }

                case 'evaluate': {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) {
                        throw new Error('No active debug session');
                    }

                    const activeStackItem = vscode.debug.activeStackItem;

                    // Grab the active frameId
                    let frameId = undefined;
                    if (activeStackItem instanceof vscode.DebugStackFrame) {
                        frameId = activeStackItem.frameId;
                    }

                    // In case activeStackItem.frameId is falsey
                    if (!frameId) {
                        // Get the current stack frame
                        const frames = await session.customRequest('stackTrace', {
                            threadId: 1  // You might need to get the actual threadId
                        });

                        if (!frames || !frames.stackFrames || frames.stackFrames.length === 0) {
                            vscode.window.showErrorMessage('No stack frame available');
                            break;
                        }

                        frameId = frames.stackFrames[0].id;  // Usually use the top frame
                    }

                    try {
                        const response = await session.customRequest('evaluate', {
                            expression: step.expression,
                            frameId: frameId,
                            context: 'repl'
                        });

                        results.push(`Evaluated "${step.expression}": ${response.result}`);
                    } catch (err: any) {
                        let errorMessage = '';
                        let stackTrace = '';

                        if (err instanceof Error) {
                            errorMessage = err.message;
                            if (err.stack) {
                                stackTrace = `\nStack: ${err.stack}`;
                            }
                        } else {
                            errorMessage = String(err);
                        }
                        results.push(`ERROR: Evaluation failed for "${step.expression}": ${errorMessage}${stackTrace}`);
                    }
                    break;
                }

                case 'stepOver': {
                    const { session: soSession, threadId: soThreadId } = await this.getThreadId();
                    const soStoppedPromise = this.waitForStopped();
                    await soSession.customRequest('next', { threadId: soThreadId });
                    await soStoppedPromise;
                    const soStack = await soSession.customRequest('stackTrace', { threadId: soThreadId, levels: 1 });
                    const soFrame = soStack.stackFrames[0];
                    results.push(`Stepped over → ${soFrame.source?.name || 'unknown'}:${soFrame.line} (${soFrame.name})`);
                    break;
                }

                case 'stepInto': {
                    const { session: siSession, threadId: siThreadId } = await this.getThreadId();
                    const siStoppedPromise = this.waitForStopped();
                    await siSession.customRequest('stepIn', { threadId: siThreadId });
                    await siStoppedPromise;
                    const siStack = await siSession.customRequest('stackTrace', { threadId: siThreadId, levels: 1 });
                    const siFrame = siStack.stackFrames[0];
                    results.push(`Stepped into → ${siFrame.source?.name || 'unknown'}:${siFrame.line} (${siFrame.name})`);
                    break;
                }

                case 'stepOut': {
                    const { session: soutSession, threadId: soutThreadId } = await this.getThreadId();
                    const soutStoppedPromise = this.waitForStopped();
                    await soutSession.customRequest('stepOut', { threadId: soutThreadId });
                    await soutStoppedPromise;
                    const soutStack = await soutSession.customRequest('stackTrace', { threadId: soutThreadId, levels: 1 });
                    const soutFrame = soutStack.stackFrames[0];
                    results.push(`Stepped out → ${soutFrame.source?.name || 'unknown'}:${soutFrame.line} (${soutFrame.name})`);
                    break;
                }

                case 'pause': {
                    const { session: pauseSession, threadId: pauseThreadId } = await this.getThreadId();
                    await pauseSession.customRequest('pause', { threadId: pauseThreadId });
                    // Wait briefly for the debugger to actually pause
                    await new Promise(resolve => setTimeout(resolve, 200));
                    const pauseStack = await pauseSession.customRequest('stackTrace', { threadId: pauseThreadId, levels: 1 });
                    const pauseFrame = pauseStack.stackFrames[0];
                    results.push(`Paused at ${pauseFrame.source?.name || 'unknown'}:${pauseFrame.line} (${pauseFrame.name})`);
                    break;
                }

                case 'getStackTrace': {
                    const { session: stSession, threadId: stThreadId } = await this.getThreadId();
                    const stStack = await stSession.customRequest('stackTrace', { threadId: stThreadId, levels: 50 });
                    const formatted = stStack.stackFrames.map((f: any, i: number) =>
                        `#${i} ${f.name} at ${f.source?.path || f.source?.name || '<unknown>'}:${f.line}`
                    ).join('\n');
                    results.push(`Stack trace (${stStack.stackFrames.length} frames):\n${formatted}`);
                    break;
                }

                case 'getVariables': {
                    const { session: gvSession, threadId: gvThreadId } = await this.getThreadId();
                    const gvStack = await gvSession.customRequest('stackTrace', { threadId: gvThreadId, levels: 1 });
                    const gvFrameId = gvStack.stackFrames[0].id;
                    const gvScopes = await gvSession.customRequest('scopes', { frameId: gvFrameId });
                    const allVars: string[] = [];
                    for (const scope of gvScopes.scopes) {
                        try {
                            const vars = await gvSession.customRequest('variables', {
                                variablesReference: scope.variablesReference
                            });
                            allVars.push(`--- ${scope.name} ---`);
                            for (const v of vars.variables) {
                                allVars.push(`  ${v.name} = ${v.value}${v.type ? ` (${v.type})` : ''}`);
                            }
                        } catch (err) {
                            allVars.push(`--- ${scope.name} --- (error reading)`);
                        }
                    }
                    results.push(`Variables at ${gvStack.stackFrames[0].name}:\n${allVars.join('\n')}`);
                    break;
                }

                case 'getBreakpoints': {
                    const bps = vscode.debug.breakpoints;
                    if (bps.length === 0) {
                        results.push('No breakpoints set');
                    } else {
                        const formatted = bps.map((bp, i) => {
                            if (bp instanceof vscode.SourceBreakpoint) {
                                const loc = bp.location;
                                const cond = bp.condition ? ` (condition: ${bp.condition})` : '';
                                const enabled = bp.enabled ? '' : ' [DISABLED]';
                                return `#${i} ${loc.uri.fsPath}:${loc.range.start.line + 1}${cond}${enabled}`;
                            }
                            return `#${i} (function breakpoint)`;
                        }).join('\n');
                        results.push(`Breakpoints (${bps.length}):\n${formatted}`);
                    }
                    break;
                }

                case 'getThreads': {
                    const { session: gtSession } = await this.getThreadId();
                    const gtThreads = await gtSession.customRequest('threads');
                    const formatted = gtThreads.threads.map((t: any) =>
                        `Thread ${t.id}: ${t.name}`
                    ).join('\n');
                    results.push(`Threads (${gtThreads.threads.length}):\n${formatted}`);
                    break;
                }

                case 'getModules': {
                    const { session: gmSession } = await this.getThreadId();
                    try {
                        const modules = await gmSession.customRequest('modules', { startModule: 0, moduleCount: 100 });
                        const formatted = modules.modules.map((m: any) =>
                            `${m.name}${m.path ? ` (${m.path})` : ''}${m.symbolStatus ? ` [${m.symbolStatus}]` : ''}`
                        ).join('\n');
                        results.push(`Loaded modules (${modules.modules.length}):\n${formatted}`);
                    } catch (err) {
                        results.push('getModules not supported by this debug adapter');
                    }
                    break;
                }

                case 'setVariable': {
                    const { session: svSession, threadId: svThreadId } = await this.getThreadId();
                    if (!step.expression) {
                        throw new Error('expression required for setVariable (format: "name=value")');
                    }
                    const eqIdx = step.expression.indexOf('=');
                    if (eqIdx === -1) {
                        throw new Error('expression must be "name=value"');
                    }
                    const varName = step.expression.substring(0, eqIdx).trim();
                    const varValue = step.expression.substring(eqIdx + 1).trim();

                    const svStack = await svSession.customRequest('stackTrace', { threadId: svThreadId, levels: 1 });
                    const svFrameId = svStack.stackFrames[0].id;
                    const svScopes = await svSession.customRequest('scopes', { frameId: svFrameId });

                    let set = false;
                    for (const scope of svScopes.scopes) {
                        try {
                            const response = await svSession.customRequest('setVariable', {
                                variablesReference: scope.variablesReference,
                                name: varName,
                                value: varValue,
                            });
                            results.push(`Set ${varName} = ${response.value}${response.type ? ` (${response.type})` : ''}`);
                            set = true;
                            break;
                        } catch {
                            continue;
                        }
                    }
                    if (!set) {
                        results.push(`ERROR: Could not set variable "${varName}" — not found in any scope`);
                    }
                    break;
                }

                case 'goto': {
                    const { session: goSession, threadId: goThreadId } = await this.getThreadId();
                    if (!step.line) {
                        throw new Error('line required for goto');
                    }
                    try {
                        // Get goto targets for the line
                        const targets = await goSession.customRequest('gotoTargets', {
                            source: { path: step.file },
                            line: step.line,
                        });
                        if (targets.targets && targets.targets.length > 0) {
                            await goSession.customRequest('goto', {
                                threadId: goThreadId,
                                targetId: targets.targets[0].id,
                            });
                            results.push(`Set next statement to ${step.file}:${step.line}`);
                        } else {
                            results.push(`ERROR: No goto target available at line ${step.line}`);
                        }
                    } catch (err) {
                        results.push(`goto not supported by this debug adapter`);
                    }
                    break;
                }

                case 'launch': {
                    await this.handleLaunch({ program: step.file });
                    break;
                }

                case 'startDebugging': {
                    const configName = step.expression; // config name from launch.json
                    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                    if (!workspaceFolder) {
                        results.push('ERROR: No workspace folder found');
                        break;
                    }

                    // Stop any existing debug session first
                    const existingSession = vscode.debug.activeDebugSession;
                    if (existingSession) {
                        await vscode.debug.stopDebugging(existingSession);
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }

                    if (configName) {
                        // Find the named configuration in launch.json
                        const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
                        const configurations = launchConfig.get<any[]>('configurations') || [];
                        const config = configurations.find(c => c.name === configName);
                        if (!config) {
                            const names = configurations.map(c => c.name).join(', ');
                            results.push(`ERROR: Configuration "${configName}" not found. Available: ${names}`);
                            break;
                        }
                        await vscode.debug.startDebugging(workspaceFolder, config);
                    } else {
                        // No config name — list available configurations
                        const launchConfig = vscode.workspace.getConfiguration('launch', workspaceFolder.uri);
                        const configurations = launchConfig.get<any[]>('configurations') || [];
                        const names = configurations.map(c => `${c.name} (${c.type}/${c.request})`).join(', ');
                        results.push(`Available configurations: ${names}`);
                        break;
                    }

                    // Wait for session to become active
                    const newSession = await this.waitForDebugSession();
                    if (newSession) {
                        results.push(`Started debugging with "${configName}". Session active.`);
                        // Check if paused at a breakpoint
                        try {
                            const threads = await newSession.customRequest('threads');
                            const threadId = threads?.threads?.[0]?.id;
                            if (threadId) {
                                const stack = await newSession.customRequest('stackTrace', { threadId });
                                if (stack.stackFrames?.length > 0) {
                                    const frame = stack.stackFrames[0];
                                    results.push(`Paused at ${frame.source?.path || '?'}:${frame.line} (${frame.name})`);
                                }
                            }
                        } catch { /* running, not paused */ }
                    } else {
                        results.push(`Started debugging with "${configName}" but session not yet active.`);
                    }
                    break;
                }
            }
        }

        return results;
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.server) {
                this._isRunning = false;
                this.emit('stopped');
                resolve();
                return;
            }

            Object.values(this.activeTransports).forEach(transport => {
                transport.close();
            });
            this.activeTransports = {};

            this.server.close(() => {
                this.server = null;
                this._isRunning = false;
                this.emit('stopped');
                resolve();
            });
        });
    }
}
