# Tech Spec: DnD 5e MCP Server

## Visão Geral

### Problema

LLMs (Claude Desktop, ChatGPT) não têm acesso estruturado aos dados do D&D 5e SRD para auxiliar jogadores em consultas de regras, criação de personagens e referências rápidas, nem mestres na criação e planejamento de campanhas completas.

### Solução

MCP Server em Node.js/TypeScript que expõe a API GraphQL do D&D 5e SRD (dnd5eapi.co) via Streamable HTTP + SSE, utilizando o SDK oficial da Anthropic. Consolidação em 2 tools + 1 prompt em vez de 50+ tools individuais — máxima flexibilidade com mínimo overhead de contexto para a LLM.

## Arquitetura

### Estrutura do Projeto

```
src/
├── index.ts                  # Entry point: Express + dual transport + shutdown
├── server.ts                 # McpServer factory: instructions + register tools/prompt
├── config.ts                 # Typed env var config (12 variáveis)
├── tools/
│   ├── graphql-query.ts      # Tool: graphql_query
│   └── explore-schema.ts     # Tool: explore_schema
├── prompts/
│   └── system-prompt.ts      # instructions + Prompt: dnd5e_guide
└── services/
    ├── graphql-client.ts     # GraphQL client + cache + stale-while-revalidate
    └── redis-client.ts       # Redis connection + cache helpers + hash
```

### Diagrama de Fluxo

```
Cliente MCP (Claude/ChatGPT)
    │
    ▼
┌─────────────────────────────────────┐
│          Express 5 (HTTP)           │
│  ┌─────────┐  ┌──────┐  ┌───────┐  │
│  │  CORS   │  │ JSON │  │ Rate  │  │
│  │         │  │16kb  │  │Limit  │  │
│  └─────────┘  └──────┘  └───────┘  │
│                                     │
│  POST/GET/DELETE /mcp (Streamable)  │
│  GET /sse + POST /messages (SSE)    │
│  GET /health                        │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│  Sessions Map (HTTP + SSE unificado)│
│  ┌──────────────────────────────┐   │
│  │ McpServer (por session)      │   │
│  │  ├─ explore_schema tool      │   │
│  │  ├─ graphql_query tool       │   │
│  │  ├─ dnd5e_guide prompt       │   │
│  │  └─ instructions (auto)      │   │
│  └──────────────────────────────┘   │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│       graphql-client.ts             │
│  1. hashKey(query, vars) → SHA-256  │
│  2. cacheGet(key) → fresh? return   │
│  3. rawRequest() → upstream         │
│  4. cacheSet(key, {data, fetchedAt})│
│  5. stale fallback se upstream down │
└──────┬───────────────────┬──────────┘
       │                   │
       ▼                   ▼
┌─────────────┐   ┌───────────────────┐
│  Redis 7    │   │  D&D 5e SRD API   │
│  (cache)    │   │  (GraphQL upstream)│
│  allkeys-lru│   │  dnd5eapi.co      │
│  128MB      │   │                   │
│  sem TTL    │   │  199 tipos        │
│             │   │  50 queries       │
└─────────────┘   │  24 categorias    │
                  └───────────────────┘
```

## Decisões Técnicas

### GraphQL em vez de REST

Permite queries complexas em uma única interação, reduzindo tokens e round-trips. A API upstream oferece 199 tipos, 50 queries root e 24 categorias de recursos com filtros tipados (`NumberFilterInput`, `StringFilterInput`).

### 2 Tools em vez de 50+

Consolidação em `graphql_query` + `explore_schema`. A LLM usa `explore_schema` para descobrir tipos e campos, depois constrói queries com `graphql_query`. Abordagem mais flexível e com menor overhead de contexto que mapear 1:1 endpoints REST para tools.

### Duas Camadas de Contexto

1. **`instructions`** (~800 tokens): Auto-injetado em toda interação via campo `instructions` do McpServer. Contém regras críticas: filtros tipados, Union types, relações entre entidades.
2. **`dnd5e_guide` prompt** (~3000 tokens): Carregado sob demanda com 8+ exemplos de queries validadas e seções contextuais (player/dm/general).

### Cache Metadata-Based (sem TTL Redis)

Armazena `{data, fetchedAt}` sem TTL no Redis. Staleness verificada na aplicação (`Date.now() - fetchedAt > CACHE_TTL * 1000`). Dado stale nunca desaparece — só é evictado pelo LRU quando Redis precisa de memória. Permite stale-while-revalidate real: se o upstream falha, dados stale são servidos com indicação clara.

### Respostas Parciais via `rawRequest()`

`graphql-request` v7 com `errorPolicy: 'all'` e `rawRequest()`:
- **HTTP 200 + errors**: retorna `{data, errors}` sem lançar exceção
- **HTTP 400**: lança `ClientError` — catch extrai `error.response.data` e `.errors`
- Dados parciais são cacheados e apresentados junto com erros

### Validação de Operation Type

Rejeita mutations e subscriptions antes de enviar ao upstream. Strip de comentários GraphQL (respeitando string literals e block strings), depois regex `/^(query\b|\{|fragment\b)/`. Defesa em profundidade — upstream já rejeita, mas evita requests desnecessárias.

### Gerenciamento Unificado de Sessions

Streamable HTTP e SSE compartilham a mesma `Map<string, Session>`, o mesmo `MAX_SESSIONS`, o mesmo cleanup periódico (60s) e o mesmo TTL de inatividade. HTTP usa `onsessioninitialized` callback para registrar sessions apenas quando a inicialização é bem-sucedida (evita sessions órfãs).

### Graceful Shutdown

1. Flag guard contra sinais duplicados
2. Safety net com `setTimeout(5s).unref()` registrado antes do drain
3. `httpServer.close()` awaited — para de aceitar novas conexões
4. `Promise.all` fecha todos os transports em paralelo (com catch individual)
5. `closeRedis()` — quit graceful
6. Docker `stop_grace_period: 10s` dá margem ao timeout de 5s

### Rate Limiting

Instância compartilhada de `express-rate-limit` aplicada em `/mcp`, `/sse`, `/messages` — excluindo `/health` (registrado antes do middleware). `trust proxy: 1` para identificar IP real atrás de reverse proxy. Contador unificado entre todas as rotas MCP.

### CORS

Pacote `cors` com `allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id']` e `exposedHeaders: ['mcp-session-id']`. Necessário para que clientes browser enviem e leiam o header de session do Streamable HTTP.

### Docker

Multi-stage build (build + runtime Alpine). Redis sem persistência (`--save ""`), sem volumes (efêmero por design), `allkeys-lru` com 128MB. Healthchecks: MCP via `node -e` HTTP GET ao `/health`, Redis via `redis-cli ping`.

## Stack Tecnológico

### Runtime

| Pacote | Versão | Uso |
|--------|--------|-----|
| `@modelcontextprotocol/sdk` | ^1.27.1 | SDK MCP (McpServer, transports, types) |
| `express` | ^5.1.0 | HTTP framework (dependência explícita) |
| `graphql-request` | ^7.1.2 | Cliente GraphQL (`rawRequest` + `errorPolicy`) |
| `graphql` | ^16.10.0 | Peer dependency do graphql-request |
| `ioredis` | ^5.4.2 | Cliente Redis (named import `{ Redis }`) |
| `zod` | ^3.24.4 | Validação de schemas (compat SDK `^3.25 \|\| ^4.0`) |
| `express-rate-limit` | ^7.5.0 | Rate limiting por IP em memória |
| `cors` | ^2.8.5 | CORS com preflight OPTIONS |

### Dev

| Pacote | Versão | Uso |
|--------|--------|-----|
| `typescript` | ^5.8.2 | Compilador (target ES2022, module NodeNext) |
| `@types/node` | ^22.13.14 | Type definitions Node.js |
| `@types/express` | ^5.0.6 | Type definitions Express 5 |
| `@types/cors` | ^2.8.17 | Type definitions cors |
| `tsx` | ^4.19.3 | Runner TypeScript para dev |

### Infra

- **Docker**: node:22-alpine (multi-stage build)
- **Redis**: redis:7-alpine (128MB, allkeys-lru, sem persistência)
- **Rede**: bridge interna (`mcp-net`)
- **Deploy**: Dokploy com TLS automático via reverse proxy

## API GraphQL Upstream

**Endpoint**: `https://www.dnd5eapi.co/graphql`

- 199 tipos, 50 queries root, 24 categorias de recursos
- Filtros tipados: `NumberFilterInput` (`eq`, `in`, `nin`, `range`), `StringFilterInput`
- Union types que exigem inline fragments:
  - `MonsterArmorClass` → `ArmorClassDex`, `ArmorClassNatural`, `ArmorClassArmor`, `ArmorClassCondition`, `ArmorClassSpell`
  - `DamageOrDamageChoice` → `Damage`
  - `AnyEquipment` → `Weapon`, `Armor`, `Gear`, `Tool`, `Pack`, `Ammunition`
  - `ProficiencyReference` → `AbilityScore`, `Skill`, `Equipment`, `EquipmentCategory`, `SavingThrow`
- Mutations e subscriptions não suportados
- Respostas parciais (`{data, errors}`) são comuns em queries com campos de Union sem inline fragments

## Segurança

- **Rate limiting** por IP (compartilhado entre todas as rotas MCP)
- **Body size limit** explícito (16KB via `express.json({ limit })`)
- **Sanitização de session IDs** em logs (previne log injection)
- **Validação de operation type** (rejeita mutations/subscriptions)
- **Truncamento inteligente** (respostas > MAX_RESPONSE_SIZE são substituídas, não truncadas)
- **CORS configurável** (default `*`, restringível via env)
- **Trust proxy** para identificação de IP real atrás de reverse proxy

## Limitações Conhecidas

- Cache sem invalidação proativa — staleness controlada por `CACHE_TTL`. Dados do SRD mudam raramente.
- SSE transport é legado e pode ser removido em versões futuras do SDK
- Sem testes automatizados nesta versão
- Logs via console sem estruturação JSON
- Campo `instructions` no McpServer usa cast `as any` (funciona em runtime, não tipado no SDK v1)

## Roadmap

- Integração com MCP do Obsidian para construção incremental de campanhas (TTRPG)
- Expandir para API D&D 2024 quando madura no upstream
- Testes automatizados (unit + integration)
- Logging estruturado se necessidade operacional aumentar

## Referências

| Referência | Propósito |
|------------|-----------|
| https://www.dnd5eapi.co/graphql | Endpoint GraphQL upstream |
| https://github.com/5e-bits/5e-srd-api | Repositório da API upstream |
| https://github.com/5e-bits/5e-database | Banco de dados SRD (seed data) |
| https://github.com/modelcontextprotocol/typescript-sdk | SDK MCP oficial |
