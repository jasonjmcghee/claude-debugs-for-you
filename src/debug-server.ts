import * as http from "http";
import * as vscode from "vscode";
import { EventEmitter } from "events";
import * as cont from "./tools/continue";
import * as variables from "./tools/variables";
import * as evaluate from "./tools/evaluate";
import * as launch from "./tools/launch";
import * as stop from "./tools/stop";
import * as removeBreakpoint from "./tools/removeBreakpoint";
import * as setBreakpoint from "./tools/setBreakpoint";
import * as waitForBreakpoint from "./tools/wait";
import * as getWorkspace from "./tools/getWorkspace";
import * as getSessionStates from "./tools/getSessionStates";
import {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolResult,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import {
  AnySchema,
  SchemaOutput,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { ToolConfig } from "./tools/types";
import { logger } from "./logger";
import { DebugSessionRegistry } from "./debugSessionRegistry";
import { mcpServerInstructions } from "./mcpServerInstructions";

interface DebugServerEvents {
  on(event: "started", listener: () => void): this;
  on(event: "stopped", listener: () => void): this;
  emit(event: "started"): boolean;
  emit(event: "stopped"): boolean;
}

export class DebugServer extends EventEmitter implements DebugServerEvents {
  private port: number;
  private server: http.Server | null = null;
  private transports: { [sessionId: string]: StreamableHTTPServerTransport } =
    {};
  private app: express.Express;
  private debugSessionRegistry: DebugSessionRegistry;

  constructor(port: number, debugSessionRegistry: DebugSessionRegistry) {
    super();
    this.port = port;

    this.debugSessionRegistry = debugSessionRegistry;

    this.app = express();
    this.app.use(express.json());

    this.app.post("/mcp", async (req, res) => {
      // Check for existing session ID
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && this.transports[sessionId]) {
        // Reuse existing transport
        transport = this.transports[sessionId];
      } else if (!sessionId && isInitializeRequest(req.body)) {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            this.transports[sessionId] = transport;
          },
          allowedHosts: ["127.0.0.1", "localhost"],
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete this.transports[transport.sessionId];
          }
        };

        const server = new McpServer(
          {
            name: "mcp-debug-server",
            version: "1.0.0",
          },
          { instructions: mcpServerInstructions },
        );

        this.addTools(server);

        // Connect to the MCP server
        await server.connect(transport);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided",
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    });
  }

  setPort(port: number): void {
    this.port = port || 4711;
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    this.debugSessionRegistry.startTracking();
    return new Promise((resolve, reject) => {
      const server = this.app.listen(this.port, (err) => {
        if (err) {
          reject(err);
        } else {
          this.server = server;
          this.emit("started");
          resolve();
        }
      });
    });
  }

  private addTools(server: McpServer) {
    function registerToolWrapper<Input extends AnySchema>(
      debugSessionRegistry: DebugSessionRegistry,
      config: ToolConfig<Input>,
      tool: (
        debugSessionRegistry: DebugSessionRegistry,
        input: SchemaOutput<Input>,
      ) => Promise<string> | string,
    ) {
      const toolWrapped = (async (
        input: SchemaOutput<Input>,
        extra: unknown,
      ) => {
        logger.info(
          `<-- Tool call  : ${config.name}: ${JSON.stringify(input)}`,
        );
        try {
          const res = await tool(debugSessionRegistry, input);
          logger.info(`--> Tool result: ${config.name}: ${res}`);
          return {
            content: [{ type: "text" as const, text: res }],
          } satisfies CallToolResult;
        } catch (e) {
          const res = `Error: ${e}`;
          logger.info(`--> Tool error : ${config.name}: ${res}`);
          return {
            content: [{ type: "text" as const, text: res }],
            isError: true,
          } satisfies CallToolResult;
        }
      }) satisfies ToolCallback<any> as any;
      server.registerTool(config.name, config, toolWrapped);
    }

    registerToolWrapper(
      this.debugSessionRegistry,
      setBreakpoint.tool,
      setBreakpoint.handle,
    );
    registerToolWrapper(
      this.debugSessionRegistry,
      removeBreakpoint.tool,
      removeBreakpoint.handle,
    );
    registerToolWrapper(
      this.debugSessionRegistry,
      variables.tool,
      variables.handle,
    );
    registerToolWrapper(
      this.debugSessionRegistry,
      evaluate.tool,
      evaluate.handle,
    );
    registerToolWrapper(this.debugSessionRegistry, launch.tool, launch.handle);
    registerToolWrapper(this.debugSessionRegistry, stop.tool, stop.handle);
    registerToolWrapper(this.debugSessionRegistry, cont.tool, cont.handle);
    registerToolWrapper(
      this.debugSessionRegistry,
      waitForBreakpoint.tool,
      waitForBreakpoint.handle,
    );
    registerToolWrapper(
      this.debugSessionRegistry,
      getWorkspace.tool,
      getWorkspace.handle,
    );
    registerToolWrapper(
      this.debugSessionRegistry,
      getSessionStates.tool,
      getSessionStates.handle,
    );
  }

  stop(): Promise<void> {
    this.debugSessionRegistry.stopTracking();
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.server = null;
        this.emit("stopped");
        resolve();
      });
    });
  }
}
