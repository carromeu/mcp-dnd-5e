import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { executeIntrospection, executeRootQueryFields } from '../services/graphql-client.js';

const UNION_TYPES: Record<string, string[]> = {
  MonsterArmorClass: ['ArmorClassDex', 'ArmorClassNatural', 'ArmorClassArmor', 'ArmorClassCondition', 'ArmorClassSpell'],
  DamageOrDamageChoice: ['Damage'],
  AnyEquipment: ['Weapon', 'Armor', 'Gear', 'Tool', 'Pack', 'Ammunition'],
  ProficiencyReference: ['AbilityScore', 'Skill', 'Equipment', 'EquipmentCategory', 'SavingThrow'],
};

interface TypeInfo {
  name?: string;
  kind: string;
  ofType?: TypeInfo;
}

function resolveTypeName(typeObj: TypeInfo): string {
  if (typeObj.name) return typeObj.name;
  if (typeObj.kind === 'NON_NULL' && typeObj.ofType) return resolveTypeName(typeObj.ofType);
  if (typeObj.kind === 'LIST' && typeObj.ofType) return `[${resolveTypeName(typeObj.ofType)}]`;
  return typeObj.kind;
}

function extractBaseTypeName(typeObj: TypeInfo): string | undefined {
  if (typeObj.name) return typeObj.name;
  if (typeObj.ofType) return extractBaseTypeName(typeObj.ofType);
  return undefined;
}

export function registerExploreSchema(server: McpServer): void {
  server.registerTool(
    'explore_schema',
    {
      description:
        'Explore the D&D 5e GraphQL API schema. Use this to discover available types, their fields, and relationships before constructing queries. You can explore a specific type to see its fields, or list all available query root fields. IMPORTANT: Some fields use Union types that require inline fragments (e.g., Monster.armor_class needs \'... on ArmorClassDex { type value }\'). This tool will indicate when inline fragments are needed.',
      inputSchema: z.object({
        typeName: z
          .string()
          .optional()
          .describe(
            'Name of the GraphQL type to explore (e.g., "Monster", "Spell", "Class"). If omitted, returns all available root query fields.',
          ),
      }),
    },
    async ({ typeName }) => {
      try {
        if (!typeName) {
          const result = await executeRootQueryFields();
          const fields = result.__schema.queryType.fields;

          let output = `# D&D 5e API — Root Query Fields (${fields.length} available)\n\n`;
          output += '| Field | Return Type | Description |\n';
          output += '|-------|-------------|-------------|\n';
          for (const f of fields) {
            const type = f.type.name ?? f.type.kind;
            output += `| ${f.name} | ${type} | ${f.description ?? '-'} |\n`;
          }
          output += '\nUse `explore_schema` with a typeName to see fields for any type.';

          return { content: [{ type: 'text' as const, text: output }] };
        }

        const result = await executeIntrospection(typeName);

        if (!result.__type) {
          return {
            content: [{ type: 'text' as const, text: `Type "${typeName}" not found. Use explore_schema without arguments to see all available types.` }],
          };
        }

        const t = result.__type;
        let output = `# ${t.name} (${t.kind})\n`;
        if (t.description) output += `\n${t.description}\n`;

        if (t.fields && t.fields.length > 0) {
          output += '\n| Field | Type | Description |\n';
          output += '|-------|------|-------------|\n';
          for (const f of t.fields) {
            const displayName = resolveTypeName(f.type as TypeInfo);
            const baseName = extractBaseTypeName(f.type as TypeInfo);
            let desc = f.description ?? '-';

            if (baseName && UNION_TYPES[baseName]) {
              desc += ` ⚠ Union type — use inline fragments: \`... on TypeA { fields }\`. Variants: ${UNION_TYPES[baseName].join(', ')}`;
            }

            output += `| ${f.name} | ${displayName} | ${desc} |\n`;
          }
        }

        if (t.inputFields && t.inputFields.length > 0) {
          output += '\n### Input Fields\n\n';
          output += '| Field | Type | Description |\n';
          output += '|-------|------|-------------|\n';
          for (const f of t.inputFields) {
            output += `| ${f.name} | ${f.type.name ?? f.type.kind} | ${f.description ?? '-'} |\n`;
          }
        }

        if (t.enumValues && t.enumValues.length > 0) {
          output += '\n### Enum Values\n\n';
          for (const v of t.enumValues) {
            output += `- \`${v.name}\`${v.description ? `: ${v.description}` : ''}\n`;
          }
        }

        return { content: [{ type: 'text' as const, text: output }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `Error exploring schema: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );
}
