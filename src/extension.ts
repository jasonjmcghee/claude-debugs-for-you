import * as vscode from "vscode";
import { DebugServer } from "./debug-server";
import { logger } from "./logger";
import { DebugSessionRegistry } from "./debugSessionRegistry";

let serverGlobal: DebugServer | null = null;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("mcpDebug");
  const port = config.get<number>("port") ?? 4711;

  const debugSessionRegistry = new DebugSessionRegistry(context);
  const server = new DebugServer(port, debugSessionRegistry);
  serverGlobal = server;

  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
  );
  statusBarItem.command = "mcpDebug.toggleServer";

  // Update status bar with server state
  function updateStatusBar(running: boolean) {
    if (running) {
      statusBarItem.text = "$(check) Claude Debugs For You";
      statusBarItem.tooltip = "Claude Debugs For You (Running — click to stop)";
    } else {
      statusBarItem.text = "$(x) Claude Debugs For You";
      statusBarItem.tooltip = "Claude Debugs For You (Stopped — click to start)";
    }
    statusBarItem.show();
  }

  // Listen for server state changes
  server.on("started", () => {
    logger.info(`CDFY running on port ${server.getPort()}.`);
    updateStatusBar(true);
  });
  server.on("stopped", () => {
    logger.info(`CDFY server stopped.`);
    updateStatusBar(false);
  });

  let running = false;
  server.on("started", () => { running = true; });
  server.on("stopped", () => { running = false; });

  // Toggle command wired to the status bar item click
  context.subscriptions.push(
    vscode.commands.registerCommand("mcpDebug.toggleServer", async () => {
      if (running) {
        await server.stop();
      } else {
        await startServer();
      }
    }),
  );

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("mcpDebug.port")) {
        // Always reload the latest configuration
        const updatedConfig = vscode.workspace.getConfiguration("mcpDebug");
        const newPort = updatedConfig.get<number>("port") ?? 4711;

        // Update server's port setting
        server.setPort(newPort);

        // Port changed, restart server with new port
        vscode.window.showInformationMessage(
          `Port changed to ${newPort}. Restarting server...`,
        );

        await server.stop();
        void startServer();
      }
    }),
  );

  // Initial state
  updateStatusBar(false);

  async function startServer() {
    // Always get the current port from config
    const updatedConfig = vscode.workspace.getConfiguration("mcpDebug");
    const currentPort = updatedConfig.get<number>("port") ?? 4711;
    server.setPort(currentPort);

    try {
      await server.start();
    } catch (err: any) {
      // Stop our own server
      await server.stop();

      // Check if this is likely a port conflict (server already running)
      const nodeErr = err as NodeJS.ErrnoException;
      if (
        nodeErr.code === "EADDRINUSE" ||
        (nodeErr.message && nodeErr.message.includes("already running"))
      ) {
        await vscode.window.showInformationMessage(
          "Failed to start debug server. Another server is likely already running in a different VS Code window.",
        );
      } else {
        const errorMessage = `Failed to start debug server: ${err}`;
        vscode.window.showErrorMessage(errorMessage);
        logger.error(errorMessage);
      }
    }
  }
}

export function deactivate() {
  return serverGlobal?.stop();
}
