import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeQuery } from '../services/graphql-client.js';
import { config } from '../config.js';

const OPERATION_RE = /^(query\b|\{|fragment\b)/;

function stripComments(query: string): string {
  // Remove line comments (#) but skip # inside quoted strings
  let result = '';
  let inString = false;
  let inBlockString = false;
  for (let i = 0; i < query.length; i++) {
    if (inBlockString) {
      result += query[i];
      if (query[i] === '"' && query[i + 1] === '"' && query[i + 2] === '"') {
        result += '""';
        i += 2;
        inBlockString = false;
      }
    } else if (inString) {
      result += query[i];
      if (query[i] === '\\') {
        result += query[++i] ?? '';
      } else if (query[i] === '"') {
        inString = false;
      }
    } else if (query[i] === '"' && query[i + 1] === '"' && query[i + 2] === '"') {
      result += '"""';
      i += 2;
      inBlockString = true;
    } else if (query[i] === '"') {
      result += '"';
      inString = true;
    } else if (query[i] === '#') {
      // Skip until end of line
      while (i < query.length && query[i] !== '\n') i++;
    } else {
      result += query[i];
    }
  }
  return result.trim();
}

export function registerGraphqlQuery(server: McpServer): void {
  server.registerTool(
    'graphql_query',
    {
      description:
        "Execute a GraphQL query against the D&D 5e SRD API (2014 SRD). Supports all 24 resource types. IMPORTANT: (1) Filters use typed inputs, e.g., challenge_rating: { eq: 6 }, not challenge_rating: 6. (2) Union type fields (like Monster.armor_class, Action.damage) require inline fragments: '... on ArmorClassDex { type value }'. Use explore_schema first to discover field types and required fragments.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'The GraphQL query to execute. Must be a query operation (mutations and subscriptions are not supported).',
          ),
        variables: z
          .record(z.unknown())
          .optional()
          .describe('Optional variables for the GraphQL query'),
      }),
    },
    async ({ query, variables }) => {
      try {
        if (!query.trim()) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Query cannot be empty.' }],
            isError: true,
          };
        }

        const stripped = stripComments(query);

        if (!OPERATION_RE.test(stripped)) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Only query operations are supported. Mutations and subscriptions are not available.',
              },
            ],
            isError: true,
          };
        }

        const result = await executeQuery(query, variables);

        const parts: string[] = [];

        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
          parts.push('## Errors\n');
          for (const err of result.errors) {
            parts.push(`- ${typeof err === 'object' && err !== null && 'message' in err ? (err as { message: string }).message : JSON.stringify(err)}`);
          }
          parts.push('');
        }

        if (result.stale) {
          parts.push('> **Note:** This data is from cache and may be slightly outdated.\n');
        }

        const dataJson = JSON.stringify(result.data, null, 2);
        const sizeBytes = Buffer.byteLength(dataJson, 'utf-8');

        if (sizeBytes > config.MAX_RESPONSE_SIZE) {
          const limitKb = Math.round(config.MAX_RESPONSE_SIZE / 1024);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Response too large (exceeded configured limit of ${limitKb} KB). Please use more specific field selections or add filters (limit, name, challenge_rating: {eq: N}) to reduce the response size. Use explore_schema to discover available filter options.`,
              },
            ],
            isError: true,
          };
        }

        parts.push(dataJson);

        return { content: [{ type: 'text' as const, text: parts.join('\n') }] };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing query: ${(err as Error).message}\n\nTip: Use explore_schema to discover available types and fields.`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
