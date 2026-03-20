import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Try to read port from config file, fallback to default
function getPortFromConfig(): number {
    try {
        const homeDir = os.homedir();

        // Check all VS Code variants (stable, insiders, OSS, Cursor)
        const codeVariants = ['Code - Insiders', 'Code', 'code-oss', 'Cursor'];
        const variants = process.platform === 'darwin'
            ? codeVariants.map(v => path.join(homeDir, 'Library', 'Application Support', v, 'User', 'globalStorage', 'jasonmcghee.claude-debugs-for-you'))
            : process.platform === 'win32'
            ? codeVariants.map(v => path.join(homeDir, 'AppData', 'Roaming', v, 'User', 'globalStorage', 'jasonmcghee.claude-debugs-for-you'))
            : codeVariants.map(v => path.join(homeDir, '.config', v, 'User', 'globalStorage', 'jasonmcghee.claude-debugs-for-you'));

        for (const storagePath of variants) {
            const configPath = path.join(storagePath, 'port-config.json');
            if (fs.existsSync(configPath)) {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                if (config && typeof config.port === 'number') {
                    return config.port;
                }
            }
        }
    } catch (error) {
        console.error('Error reading port config:', error);
    }

    return 4711; // Default port
}

const MAX_REQUEST_RETRIES = 3;
const REQUEST_RETRY_DELAY = 500;

async function makeRequest(payload: any): Promise<any> {
    const port = getPortFromConfig();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_REQUEST_RETRIES; attempt++) {
        try {
            return await doRequest(port, payload);
        } catch (err: any) {
            lastError = err;
            // Only retry on connection errors, not on application errors
            if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' || err.code === 'EPIPE') {
                console.error(`Request failed (attempt ${attempt + 1}/${MAX_REQUEST_RETRIES}): ${err.code}`);
                if (attempt < MAX_REQUEST_RETRIES - 1) {
                    await sleep(REQUEST_RETRY_DELAY);
                }
            } else {
                throw err;
            }
        }
    }
    throw lastError;
}

function doRequest(port: number, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);

        const req = http.request({
            hostname: 'localhost',
            port,
            path: '/tcp',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            },
            timeout: 30000
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (!response.success) {
                        reject(new Error(response.error || 'Unknown error'));
                    } else {
                        resolve(response.data);
                    }
                } catch (err) {
                    reject(err);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const server = new Server(
    {
        name: "mcp-debug-server",
        version: "2.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

const debugDescription = `Debug tool with full stepping, inspection, and control. Step types:
- setBreakpoint/removeBreakpoint: manage breakpoints (file + line required, optional condition)
- continue: resume execution (returns immediately — confirm BP hit before evaluating)
- stepOver/stepInto/stepOut: single-step execution (returns new location)
- pause: break into running program
- evaluate: evaluate expression in current frame
- getStackTrace: get call stack with file/line info
- getVariables: list all variables in current scope
- getBreakpoints: list all set breakpoints
- getThreads: list all threads
- getLoadedModules: list loaded DLLs/modules
- setVariable: modify a variable value (name + value in expression field)
- goto: jump to a target line (file + line)
- startDebugging: start a VS Code debug session by config name (pass config name in expression field, or omit to list available configs)
NEVER chain continue + evaluate in same call. Set breakpoints WHILE PAUSED or before session starts.`;

const listFilesDescription = "List all files in the workspace. Use this to find any requested files.";

const getFileContentDescription = `Get file content with line numbers - you likely need to list files
to understand what files are available. Be careful to use absolute paths.`;

const listFilesInputSchema = {
    type: "object",
    properties: {
        includePatterns: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to include (e.g. ['**/*.js'])"
        },
        excludePatterns: {
            type: "array",
            items: { type: "string" },
            description: "Glob patterns to exclude (e.g. ['node_modules/**'])"
        }
    }
};

const getFileContentInputSchema = {
    type: "object",
    properties: {
        path: {
            type: "string",
            description: "Path to the file. IT MUST BE AN ABSOLUTE PATH AND MATCH THE OUTPUT OF listFiles"
        }
    },
    required: ["path"]
};

const debugStepSchema = {
    type: "array",
    items: {
        type: "object",
        properties: {
            type: {
                type: "string",
                enum: ["setBreakpoint", "removeBreakpoint", "continue", "evaluate", "launch",
                       "stepOver", "stepInto", "stepOut", "pause",
                       "getStackTrace", "getVariables", "getBreakpoints", "getThreads",
                       "getLoadedModules", "setVariable", "goto", "startDebugging"],
                description: ""
            },
            file: { type: "string" },
            line: { type: "number" },
            expression: {
                description: "An expression to evaluate, or for setVariable: 'name=value'",
                type: "string"
            },
            condition: {
                description: "Breakpoint condition expression",
                type: "string"
            },
        },
        required: ["type", "file"]
    }
};

const debugInputSchema = {
    type: "object",
    properties: {
        steps: debugStepSchema
    },
    required: ["steps"]
};

const tools = [
    { name: "listFiles", description: listFilesDescription, inputSchema: listFilesInputSchema },
    { name: "getFileContent", description: getFileContentDescription, inputSchema: getFileContentInputSchema },
    { name: "debug", description: debugDescription, inputSchema: debugInputSchema },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
        const response = await makeRequest({
            type: 'callTool',
            tool: request.params.name,
            arguments: request.params.arguments
        });

        return {
            content: [{
                type: "text",
                text: Array.isArray(response) ? response.join("\n") : String(response)
            }]
        };
    } catch (err: any) {
        return {
            content: [{
                type: "text",
                text: `Error: ${err.message}. Is the VS Code debug extension active?`
            }],
            isError: true
        };
    }
});

// Connect immediately
(async function() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("MCP Debug Server v2.0.0 running");
    } catch (error) {
        console.error("Failed to start MCP Debug Server:", error);
        process.exit(1);
    }
})();
