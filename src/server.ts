import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerExploreSchema } from './tools/explore-schema.js';
import { registerGraphqlQuery } from './tools/graphql-query.js';
import { SERVER_INSTRUCTIONS, registerSystemPrompt } from './prompts/system-prompt.js';

// Read from cwd (Docker WORKDIR) for reliable resolution regardless of dist/ nesting
export const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
) as { version: string };

export function createMcpServer(): McpServer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- instructions is supported at runtime but not yet in v1 type definitions
  const server = new McpServer(
    { name: 'dnd-5e-mcp', version, instructions: SERVER_INSTRUCTIONS } as any,
    { capabilities: { logging: {} } },
  );

  registerExploreSchema(server);
  registerGraphqlQuery(server);
  registerSystemPrompt(server);

  return server;
}
