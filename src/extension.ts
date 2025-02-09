import * as vscode from 'vscode';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { startSSEServer } from './mcp/KnownGoodServer.js';

// Keep track of server instances for cleanup
let mcpServer: McpServer | undefined;
let sseServer: { close: () => Promise<void> } | undefined;
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
            // Start SSE server
            outputChannel.appendLine('Starting SSE server...');
            sseServer = await startSSEServer({
                port,
                endpoint: '/sse',
                createServer: async () => {
                    const server = new McpServer({
                        name: "Debug Server",
                        version: "1.0.0"
                    });

                    // Set up MCP server handlers
                    server.tool(
                        "listFiles",
                        { path: z.string().optional() },
                        async ({ path }) => {
                            // Handle list files request
                            return {
                                content: [{
                                    type: "text",
                                    text: JSON.stringify([])
                                }]
                            };
                        }
                    );

                    server.tool(
                        "getFile",
                        { path: z.string() },
                        async ({ path }) => {
                            // Handle get file request
                            return {
                                content: [{
                                    type: "text",
                                    text: ""
                                }]
                            };
                        }
                    );

                    server.tool(
                        "debug",
                        { 
                            command: z.string(),
                            args: z.array(z.string()).optional()
                        },
                        async ({ command, args }) => {
                            // Handle debug command
                            return {
                                content: [{
                                    type: "text",
                                    text: "Success"
                                }]
                            };
                        }
                    );

                    mcpServer = server;
                    return server;
                },
                onConnect: (server) => {
                    outputChannel.appendLine('Client connected to SSE server');
                },
                onClose: (server) => {
                    outputChannel.appendLine('Client disconnected from SSE server');
                }
            });
            
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
            await sseServer?.close();
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
        sseServer?.close()
    ]).catch(err => {
        outputChannel.appendLine(`Error during cleanup: ${err}`);
        console.error('Error during cleanup:', err);
    }).finally(() => {
        outputChannel.appendLine('Cleanup complete');
        outputChannel.dispose();
    });
}
