import * as vscode from 'vscode';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DebugServer, DebugStep } from './debug-server.js';

// Keep track of server instances for cleanup
let mcpServer: McpServer | undefined;
let debugServer: DebugServer | undefined;
let statusBarItem: vscode.StatusBarItem;
let copyButtonItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;

export async function activate(context: vscode.ExtensionContext) {
    // Create output channel
    outputChannel = vscode.window.createOutputChannel("MCP Debug");
    context.subscriptions.push(outputChannel);
    outputChannel.show();

    const config = vscode.workspace.getConfiguration('mcpDebug');
    const port = config.get<number>('port') ?? 4711;

    outputChannel.appendLine(`Initializing server on port ${port}`);

    // Create status bar items
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    copyButtonItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    context.subscriptions.push(statusBarItem, copyButtonItem);

    // Register copy command
    let copyCommand = vscode.commands.registerCommand('vscode-mcp-debug.copyAddress', async () => {
        await vscode.env.clipboard.writeText(`http://localhost:${port}/sse`);
        outputChannel.appendLine('SSE address copied to clipboard');
        vscode.window.showInformationMessage('SSE address copied to clipboard');
    });
    context.subscriptions.push(copyCommand);

    async function startServers() {
        outputChannel.appendLine('\n--- Starting Server ---');
        
        try {
            // Create MCP server first
            mcpServer = new McpServer({
                name: "Debug Server",
                version: "1.0.0"
            });

            // Set up MCP server handlers
            mcpServer.tool(
                "listFiles",
                {
                    includePatterns: z.array(z.string()).optional(),
                    excludePatterns: z.array(z.string()).optional()
                },
                async ({ includePatterns, excludePatterns }) => {
                    const files = await debugServer!.handleListFiles({ includePatterns, excludePatterns });
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
                    const content = await debugServer!.handleGetFile({ path });
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
                    const results = await debugServer!.handleDebug({ steps });
                    return {
                        content: [{
                            type: "text",
                            text: results.join('\n')
                        }]
                    };
                }
            );

            // Create and start debug server with MCP server
            debugServer = new DebugServer(port, mcpServer);
            await debugServer.start();
            
            // Update status bar with SSE address
            statusBarItem.text = `$(debug) MCP Debug: http://localhost:${port}/sse`;
            statusBarItem.tooltip = 'Click to restart MCP Debug Server';
            statusBarItem.command = 'vscode-mcp-debug.restart';
            statusBarItem.show();

            // Show copy button
            copyButtonItem.text = '$(copy)';
            copyButtonItem.tooltip = 'Copy SSE address to clipboard';
            copyButtonItem.command = 'vscode-mcp-debug.copyAddress';
            copyButtonItem.show();

            outputChannel.appendLine('Server started successfully');
            vscode.window.showInformationMessage(`MCP Debug Server started. SSE endpoint: http://localhost:${port}/sse`);
        } catch (err) {
            outputChannel.appendLine(`Error starting server: ${err instanceof Error ? err.message : String(err)}`);
            if (err instanceof Error && err.stack) {
                outputChannel.appendLine(err.stack);
            }
            
            statusBarItem.text = '$(error) MCP Debug: Error';
            statusBarItem.tooltip = `Error: ${err instanceof Error ? err.message : String(err)}`;
            statusBarItem.show();
            copyButtonItem.hide();
            vscode.window.showErrorMessage(`Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    // Initial server start
    await startServers();

    let disposable = vscode.commands.registerCommand('vscode-mcp-debug.restart', async () => {
        try {
            outputChannel.appendLine('\n--- Restarting Server ---');
            
            statusBarItem.text = '$(sync~spin) MCP Debug: Restarting...';
            statusBarItem.tooltip = 'Restarting MCP Debug Server';
            statusBarItem.show();
            copyButtonItem.hide();

            // Stop server
            outputChannel.appendLine('Stopping server...');
            await debugServer?.stop();
            outputChannel.appendLine('Server stopped');

            // Wait a moment for ports to be released
            outputChannel.appendLine('Waiting for ports to be released...');
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Start new instance
            await startServers();

            vscode.window.showInformationMessage('Debug server restarted successfully');
        } catch (err) {
            outputChannel.appendLine(`Error restarting server: ${err instanceof Error ? err.message : String(err)}`);
            if (err instanceof Error && err.stack) {
                outputChannel.appendLine(err.stack);
            }
            
            statusBarItem.text = '$(error) MCP Debug: Error';
            statusBarItem.tooltip = `Error: ${err instanceof Error ? err.message : String(err)}`;
            statusBarItem.show();
            copyButtonItem.hide();
            vscode.window.showErrorMessage(`Failed to restart server: ${err instanceof Error ? err.message : String(err)}`);
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    outputChannel.appendLine('\n--- Deactivating Extension ---');
    // Cleanup on extension deactivation
    statusBarItem?.dispose();
    copyButtonItem?.dispose();

    return Promise.all([
        debugServer?.stop()
    ]).catch(err => {
        outputChannel.appendLine(`Error during cleanup: ${err}`);
        console.error('Error during cleanup:', err);
    }).finally(() => {
        outputChannel.appendLine('Cleanup complete');
        outputChannel.dispose();
    });
}
