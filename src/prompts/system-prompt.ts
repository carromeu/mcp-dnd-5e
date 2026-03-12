import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_INSTRUCTIONS = `This server provides access to the D&D 5e SRD (System Reference Document) database via GraphQL.

## Available Tools
- **graphql_query**: Execute GraphQL queries against the D&D 5e SRD API. Supports all 24 resource types with rich filtering.
- **explore_schema**: Discover available types, fields, and relationships in the schema. Use this before constructing complex queries.

## Critical Query Rules
1. **Typed filters** — Do NOT pass raw values. Use typed input objects:
   - \`challenge_rating: { eq: 6 }\` (not \`challenge_rating: 6\`)
   - Supported operators: \`eq\`, \`in\`, \`nin\`, \`range\`
   - String filters: \`name: "Fireball"\`
   - Pagination: \`limit: 10\`, \`skip: 0\`

2. **Union types require inline fragments** — These fields return Union types:
   - \`MonsterArmorClass\` → \`ArmorClassDex\`, \`ArmorClassNatural\`, \`ArmorClassArmor\`, \`ArmorClassCondition\`, \`ArmorClassSpell\`
   - \`DamageOrDamageChoice\` → \`Damage\`
   - \`AnyEquipment\` → \`Weapon\`, \`Armor\`, \`Gear\`, \`Tool\`, \`Pack\`, \`Ammunition\`
   - \`ProficiencyReference\` → \`AbilityScore\`, \`Skill\`, \`Equipment\`
   - Example: \`armor_class { ... on ArmorClassDex { type value } ... on ArmorClassNatural { type value } }\`

3. **Key relationships**: Class→Levels→Features, Race→Subrace→Traits, Spell→School→Classes, Monster→Actions→Damage

4. **Only queries** — Mutations and subscriptions are not supported.

Use explore_schema to discover types and fields before constructing complex queries. Use the dnd5e_guide prompt for comprehensive examples and context-specific guidance.`;

export function registerSystemPrompt(server: McpServer): void {
  server.registerPrompt(
    'dnd5e_guide',
    {
      description:
        'Comprehensive reference guide with detailed examples for querying the D&D 5e SRD. Includes entity relationships, example queries for common use cases, and context-specific guidance for players and DMs.',
      argsSchema: {
        context: z
          .enum(['player', 'dm', 'general'])
          .optional()
          .default('general')
          .describe('Context: player (character creation, rules lookup), dm (campaign planning, encounter building), general (all-purpose)'),
      },
    },
    async ({ context }) => {
      const sections: string[] = [];

      sections.push(`# D&D 5e SRD Query Guide (${context} context)

## Resource Categories (24 total)
**Character**: AbilityScore, Alignment, Background, Class, Feat, Language, Proficiency, Race, Skill, Subclass, Subrace
**Magic**: MagicItem, MagicSchool, Spell
**Equipment**: EquipmentCategory, Equipment, WeaponProperty
**Monsters**: Monster
**Rules**: Condition, DamageType, Feature, Level, Rule, RuleSection, Trait

## Entity Relationship Map

### Character Building
- **Class** → \`class_levels\` → **Level** (prof_bonus, features, spellcasting)
- **Class** → \`spellcasting\` → spellcasting_ability, info
- **Class** → \`subclasses\` → **Subclass** → subclass_levels
- **Race** → \`ability_bonuses\` → AbilityScore + bonus
- **Race** → \`subraces\` → **Subrace** → racial_traits
- **Background** → \`starting_proficiencies\`, \`starting_equipment\`

### Combat & Magic
- **Monster** → \`actions\` → damage (Union: \`DamageOrDamageChoice\`)
- **Monster** → \`armor_class\` (Union: \`MonsterArmorClass\`)
- **Spell** → \`school\` → MagicSchool
- **Spell** → \`classes\` → Class[]
- **Spell** → \`damage\` → damage_type, damage_at_slot_level

### Equipment
- **EquipmentCategory** → \`equipment\` (Union: \`AnyEquipment\`)
- **Weapon** (via AnyEquipment) → weapon_category, damage, properties`);

      sections.push(`## Example Queries

### Monster by name
\`\`\`graphql
{
  monster(index: "adult-red-dragon") {
    name challenge_rating hit_points size type
    armor_class { ... on ArmorClassDex { type value } ... on ArmorClassNatural { type value } }
    actions { name desc damage { ... on Damage { damage_dice damage_type { name } } } }
  }
}
\`\`\`

### Monsters by CR
\`\`\`graphql
{
  monsters(challenge_rating: { eq: 6 }, limit: 5) {
    index name challenge_rating hit_points size type
  }
}
\`\`\`

### Spells with filter
\`\`\`graphql
{
  spells(level: { eq: 3 }, limit: 10) {
    index name level school { name } casting_time concentration range
  }
}
\`\`\`

### Class with levels
\`\`\`graphql
{
  class(index: "wizard") {
    name hit_die
    spellcasting { spellcasting_ability { name } info { name desc } }
    class_levels { level prof_bonus features { name } }
  }
}
\`\`\`

### Race with subraces
\`\`\`graphql
{
  race(index: "elf") {
    name speed
    ability_bonuses { bonus ability_score { name } }
    subraces { name index }
    traits { name desc }
  }
}
\`\`\`

### Equipment by category
\`\`\`graphql
{
  equipmentCategory(index: "weapon") {
    name
    equipment {
      index name
      ... on Weapon { weapon_category damage { damage_dice damage_type { name } } }
    }
  }
}
\`\`\`

### Rules lookup
\`\`\`graphql
{ rules { index name subsections { name desc } } }
\`\`\`

### Conditions
\`\`\`graphql
{ conditions { index name desc } }
\`\`\``);

      sections.push(`## Query Tips
- Use \`explore_schema\` to discover types before writing queries
- Use \`limit\` and field selection to keep responses small
- Union types ALWAYS need inline fragments (\`... on TypeName { fields }\`)
- Filter operators: \`eq\` (exact), \`in\` (list), \`nin\` (exclude), \`range\` (min/max)
- All index values are kebab-case: \`"adult-red-dragon"\`, \`"cure-wounds"\``);

      if (context === 'player') {
        sections.push(`## Player-Specific Guidance
- **Character creation**: Start with \`race\` and \`class\` queries to see options
- **Spell selection**: Filter spells by class and level: \`spells(class: "wizard", level: { eq: 1 })\`
- **Ability scores**: Query \`abilityScores\` for the 6 core stats and their skills
- **Equipment shopping**: Use \`equipmentCategory\` to browse by type
- **Feature lookup**: Query specific class levels to see features gained
- **Proficiencies**: Check class and race for starting proficiencies`);
      } else if (context === 'dm') {
        sections.push(`## DM-Specific Guidance
- **Encounter building**: Filter monsters by CR with \`monsters(challenge_rating: { range: [1, 5] })\`
- **Monster details**: Always include \`armor_class\` with inline fragments and \`actions\` with damage
- **Treasure/loot**: Browse \`magicItems\` for rewards, \`equipmentCategory\` for mundane items
- **NPC building**: Combine class features, spells, and equipment for NPC stat blocks
- **Rule references**: Use \`rules\` and \`conditions\` for quick rule lookups during play
- **Campaign planning**: Query multiple resource types to build coherent encounters and story elements`);
      } else {
        sections.push(`## General Tips
- Start with \`explore_schema\` (no args) to see all available root queries
- Use \`explore_schema\` with a type name to understand its fields before querying
- Combine data from multiple queries to build complete game references
- The API covers the complete 2014 SRD with 24 resource categories`);
      }

      return {
        messages: [
          {
            role: 'user' as const,
            content: { type: 'text' as const, text: sections.join('\n\n') },
          },
        ],
      };
    },
  );
}
