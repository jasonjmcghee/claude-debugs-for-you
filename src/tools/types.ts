import { AnySchema } from "@modelcontextprotocol/sdk/server/zod-compat.js";

export type ToolConfig<Input extends AnySchema> = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Input;
};
