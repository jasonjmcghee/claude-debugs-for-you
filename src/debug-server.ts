import * as vscode from 'vscode';
import * as http from 'http';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from 'zod';

export interface DebugCommand {
    command: 'listFiles' | 'getFileContent' | 'debug';
    payload: any;
}

export interface DebugStep {
    type: 'setBreakpoint' | 'removeBreakpoint' | 'continue' | 'evaluate' | 'launch';
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

const debugDescription = `Execute a debug plan with breakpoints, launch, continues, and expression 
evaluation. ONLY SET BREAKPOINTS BEFORE LAUNCHING OR WHILE PAUSED. Be careful to keep track of where 
you are, if paused on a breakpoint. Make sure to find and get the contents of any requested files. 
Only use continue when ready to move to the next breakpoint. Launch will bring you to the first 
breakpoint. DO NOT USE CONTINUE TO GET TO THE FIRST BREAKPOINT.`;

const listFilesDescription = "List all files in the workspace. Use this to find any requested files.";

const getFileContentDescription = `Get file content with line numbers - you likely need to list files 
to understand what files are available. Be careful to use absolute paths.`;

export class DebugServer {
    private httpServer: http.Server | null = null;
    private port: number = 4711;
    private activeTransports: Record<string, SSEServerTransport> = {};
    private outputChannel: vscode.OutputChannel;
    private mcpServer: McpServer | null = null;

    constructor(port?: number, mcpServer?: McpServer) {
        this.port = port || 4711;
        this.mcpServer = mcpServer || null;
        this.outputChannel = vscode.window.createOutputChannel("Debug Server");
        this.outputChannel.show();
        
        if (mcpServer) {
            this.setupMcpTools(mcpServer);
        }
    }

    private setupMcpTools(mcpServer: McpServer) {
        // Register MCP tools
        mcpServer.tool(
            "listFiles",
            {
                includePatterns: z.array(z.string()).optional(),
                excludePatterns: z.array(z.string()).optional()
            },
            async ({ includePatterns, excludePatterns }) => {
                const files = await this.handleListFiles({ includePatterns, excludePatterns });
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(files, null, 2)
                    }]
                };
            }
        );

        mcpServer.tool(
            "getFile",
            { path: z.string() },
            async ({ path }) => {
                const content = await this.handleGetFile({ path });
                return {
                    content: [{
                        type: "text",
                        text: content
                    }]
                };
            }
        );

        mcpServer.tool(
            "debug",
            { 
                steps: z.array(z.object({
                    type: z.enum(["setBreakpoint", "removeBreakpoint", "continue", "evaluate", "launch"]),
                    file: z.string(),
                    line: z.number().optional(),
                    expression: z.string().optional(),
                    condition: z.string().optional()
                }))
            },
            async ({ steps }) => {
                const results = await this.handleDebug({ steps });
                return {
                    content: [{
                        type: "text",
                        text: results.join('\n')
                    }]
                };
            }
        );
    }

    setMcpServer(server: McpServer) {
        this.mcpServer = server;
        this.setupMcpTools(server);
    }

    async start(): Promise<void> {
        if (this.httpServer) {
            throw new Error('Server is already running');
        }

        if (!this.mcpServer) {
            throw new Error('MCP Server not set');
        }

        this.httpServer = http.createServer(async (req, res) => {
            // Handle CORS
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', '*');
            
            if (req.method === 'OPTIONS') {
                res.writeHead(204).end();
                return;
            }

            // Health check endpoint
            if (req.method === 'GET' && req.url === '/ping') {
                res.writeHead(200).end('pong');
                return;
            }

            // SSE endpoint
            if (req.method === 'GET' && req.url === '/sse') {
                const transport = new SSEServerTransport('/messages', res);
                this.activeTransports[transport.sessionId] = transport;

                // Connect the transport to the MCP server
                await this.mcpServer!.connect(transport);

                this.outputChannel.appendLine(`Client connected: ${transport.sessionId}`);

                res.on('close', async () => {
                    if (transport.sessionId in this.activeTransports) {
                        await this.mcpServer!.close();
                        delete this.activeTransports[transport.sessionId];
                        this.outputChannel.appendLine(`Client disconnected: ${transport.sessionId}`);
                    }
                });

                return;
            }

            // Message endpoint
            if (req.method === 'POST' && req.url?.startsWith('/messages')) {
                const url = new URL(req.url, 'http://localhost');
                const sessionId = url.searchParams.get('sessionId');

                if (!sessionId) {
                    res.writeHead(400).end('No sessionId');
                    return;
                }

                const transport = this.activeTransports[sessionId];
                if (!transport) {
                    res.writeHead(404).end('Session not found');
                    return;
                }

                await transport.handlePostMessage(req, res);
                return;
            }

            res.writeHead(404).end();
        });

        return new Promise((resolve, reject) => {
            this.httpServer!.listen(this.port, () => {
                this.outputChannel.appendLine(`Debug server started on port ${this.port}`);
                resolve();
            });

            this.httpServer!.on('error', (err) => {
                this.outputChannel.appendLine(`Server error: ${err.message}`);
                reject(err);
            });
        });
    }

    public async handleListFiles(payload: { 
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

    public async handleGetFile(payload: { path: string }): Promise<string> {
        const doc = await vscode.workspace.openTextDocument(payload.path);
        const lines = doc.getText().split('\n');
        return lines.map((line, i) => `${i + 1}: ${line}`).join('\n');
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
        const config = {...configurations[0]};
        
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

        // Start debugging using the configured launch configuration
        await vscode.debug.startDebugging(workspaceFolder, config);
        
        // Wait for session to be available
        const session = await this.waitForDebugSession();
    
        // Check if we're at a breakpoint
        try {
            const threads = await session.customRequest('threads');
            const threadId = threads.threads[0].id;
            
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

    public async handleDebug(payload: { steps: DebugStep[] }): Promise<string[]> {
        const results: string[] = [];

        for (const step of payload.steps) {
            switch (step.type) {
                case 'setBreakpoint': {
                    if (!step.line) {throw new Error('Line number required');}
                    if (!step.file) {throw new Error('File path required');}

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
                    if (!step.line) {throw new Error('Line number required');}
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
                    await session.customRequest('continue');
                    results.push('Continued execution');
                    break;
                }

                case 'evaluate': {
                    const session = vscode.debug.activeDebugSession;
                    if (!session) {
                        throw new Error('No active debug session');
                    }
                    // Get the current stack frame
                    const frames = await session.customRequest('stackTrace', {
                        threadId: 1  // You might need to get the actual threadId
                    });
                    
                    if (!frames || !frames.stackFrames || frames.stackFrames.length === 0) {
                        vscode.window.showErrorMessage('No stack frame available');
                        break;
                    }

                    const frameId = frames.stackFrames[0].id;  // Usually use the top frame

                    try {
                        const response = await session.customRequest('evaluate', {
                            expression: step.expression,
                            frameId: frameId,
                            context: 'repl'
                        });
                        
                        results.push(`Evaluated "${step.expression}": ${response.result}`);
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to execute: ${err}`);
                    }
                    break;
                }

                case 'launch': {
                    await this.handleLaunch({ program: step.file });
                }
            }
        }

        return results;
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.httpServer) {
                resolve();
                return;
            }

            // Close all active transports
            Object.values(this.activeTransports).forEach(transport => {
                transport.close();
            });
            this.activeTransports = {};

            this.httpServer.close(() => {
                this.httpServer = null;
                this.outputChannel.appendLine('Debug server stopped');
                resolve();
            });
        });
    }
}