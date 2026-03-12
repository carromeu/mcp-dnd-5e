---
title: 'DnD 5e MCP Server'
slug: 'dnd-5e-mcp-server'
created: '2026-03-12'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack:
  - 'Node.js 22 LTS (Alpine)'
  - 'TypeScript 5.x'
  - '@modelcontextprotocol/sdk 1.27.x (monolítico — pacotes v2 ainda não publicados)'
  - 'Express 5.x (dependência explícita — não depender de transitiva do SDK)'
  - 'Zod 4.x (compatível com SDK — suporta ^3.25 || ^4.0)'
  - 'graphql-request 7.x'
  - 'ioredis 5.x'
  - 'express-rate-limit 7.x'
  - 'cors 2.x'
  - 'Redis 7 (Alpine)'
  - 'Docker / Docker Compose'
files_to_modify:
  - 'package.json'
  - 'tsconfig.json'
  - '.env.example'
  - '.dockerignore'
  - '.gitignore'
  - 'src/config.ts'
  - 'src/services/redis-client.ts'
  - 'src/services/graphql-client.ts'
  - 'src/tools/explore-schema.ts'
  - 'src/tools/graphql-query.ts'
  - 'src/prompts/system-prompt.ts'
  - 'src/server.ts'
  - 'src/index.ts'
  - 'Dockerfile'
  - 'docker-compose.yaml'
code_patterns:
  - 'MCP Server com Streamable HTTP (sessions com TTL) + SSE fallback via Express'
  - 'SDK monolítico @modelcontextprotocol/sdk v1 — imports: server/mcp.js, server/streamableHttp.js, server/sse.js, types.js'
  - 'Express 5 como dependência explícita — app criado via express() diretamente, sem createMcpExpressApp()'
  - 'McpServer com campo instructions para auto-inject de contexto no system prompt do cliente'
  - 'McpServer.registerTool() com Zod 4 inputSchema'
  - 'McpServer.registerPrompt() para guia detalhado sob demanda'
  - 'GraphQL client (graphql-request rawRequest()) com cache Redis metadata-based (sem TTL, staleness por fetchedAt)'
  - 'Redis: chave única com metadados {data, fetchedAt}, sem TTL, evicção via allkeys-lru'
  - 'express-rate-limit: rate limiting por IP real em memória (trust proxy + excluindo /health)'
  - 'cors: pacote npm para CORS completo com preflight OPTIONS'
  - 'Graceful shutdown: SIGTERM/SIGINT com drain + forced timeout 5s'
  - 'Docker multi-stage build (build stage + runtime stage Alpine)'
  - 'ESM modules (type: module no package.json)'
test_patterns:
  - 'Testes manuais via MCP Inspector (SDK tool)'
  - 'curl/httpie para testar endpoints HTTP diretamente'
  - 'Validação de compatibilidade com Claude Desktop e ChatGPT'
---

# Tech-Spec: DnD 5e MCP Server

**Criado:** 2026-03-12

## Visão Geral

### Problema

LLMs (Claude Desktop, ChatGPT) não têm acesso estruturado aos dados do D&D 5e SRD para auxiliar jogadores em consultas de regras, criação de personagens e referências rápidas, nem mestres na criação e planejamento de campanhas completas. As informações estão disponíveis na API pública do 5e SRD, mas sem uma camada MCP as LLMs não conseguem acessá-las diretamente.

### Solução

MCP Server em Node.js/TypeScript que expõe a API GraphQL do D&D 5e SRD (dnd5eapi.co) via Streamable HTTP + SSE, utilizando o SDK oficial da Anthropic. Conta com 2 tools (`graphql_query` + `explore_schema`), campo `instructions` para auto-inject de contexto no system prompt do cliente, prompt detalhado sob demanda (`dnd5e_guide`), e cache Redis efêmero com stale-while-revalidate baseado em metadados. Inclui rate limiting por IP, gerenciamento unificado de sessions (HTTP + SSE) com TTL, graceful shutdown com timeout forçado e healthchecks. Empacotado em Docker Compose para deploy via Dokploy.

### Escopo

**Incluído:**
- MCP Server com transporte SSE e Streamable HTTP (SDK oficial Anthropic para Node.js)
- Consumo upstream exclusivamente via GraphQL (https://www.dnd5eapi.co/graphql)
- 2 tools: `graphql_query` (execução de queries) + `explore_schema` (introspecção dinâmica de tipos)
- Campo `instructions` no McpServer para auto-inject de contexto no system prompt (schema, relações, Union types, sintaxe de filtros)
- Prompt detalhado `dnd5e_guide` sob demanda com exemplos extensivos e contexto player/dm
- Cache Redis efêmero com stale-while-revalidate baseado em metadados (`{data, fetchedAt}`, sem TTL no Redis)
- Rate limiting por IP via `express-rate-limit` (em memória, configurável, excluindo `/health`)
- CORS completo via pacote `cors` (com preflight OPTIONS)
- Gerenciamento unificado de sessions (Streamable HTTP + SSE) com TTL de inatividade e limite máximo
- Validação de operation type (aceitar apenas queries, rejeitar mutations/subscriptions)
- Graceful shutdown (SIGTERM/SIGINT) com drain de conexões e timeout forçado de 5s
- Healthchecks em todos os serviços Docker (MCP verifica Redis; Redis verifica via redis-cli ping)
- Docker Compose: serviço MCP + serviço Redis
- Arquivo `.env` / `.env.example` com todas as variáveis de ambiente
- Compatibilidade com Claude Desktop e ChatGPT (web)
- URL base de produção: `https://mcp.dnd.carromeu.com`
- Uso geral: jogadores (consultas, criação de personagens) e mestres (planejamento de campanhas)
- API versão 2014 (completa — 24 recursos, 48+ queries GraphQL)
- Logs com correlação de session ID e query hash via console (stdout/stderr Docker)

**Excluído:**
- Autenticação / autorização (a API GraphQL upstream também é aberta; rate limiting protege recursos locais)
- API REST como upstream (usaremos GraphQL exclusivamente)
- Persistência de dados (cache é 100% efêmero — sem TTL Redis, evicção via LRU)
- Integração com Obsidian / TTRPG (fase futura)
- Endpoint STDIO (apenas HTTP)
- API versão 2024 (parcial/incompleta upstream — será adicionada quando madura)
- UI / frontend
- Testes automatizados (fase futura)

## Contexto para Desenvolvimento

### Padrões do Projeto

- **Projeto greenfield** — clean slate confirmado, sem código existente
- **SDK MCP v1 monolítico** (`@modelcontextprotocol/sdk` 1.27.x) — pacotes v2 ainda não publicados no npm
- **Compatibilidade Zod**: SDK declara `"zod": "^3.25 || ^4.0"` — Zod 4.x totalmente compatível
- **Express 5 como dependência explícita**: Usar `express()` diretamente em vez de `createMcpExpressApp()` do SDK. `createMcpExpressApp()` foi testado e retorna Express app padrão, mas não ficou claro se pré-registra rotas MCP internamente — conflito potencial com rotas manuais. Usar `express()` direto elimina ambiguidade e dá controle total sobre middlewares, CORS, rate limiting e rotas.
- **Campo `instructions`**: `McpServer` aceita `instructions` no objeto `serverInfo` do construtor. Clientes chamam `client.getInstructions()` e injetam automaticamente no system prompt. Forma oficial do MCP para auto-include de contexto.
- **Imports confirmados:**
  - `McpServer, ResourceTemplate` → `@modelcontextprotocol/sdk/server/mcp.js`
  - `StreamableHTTPServerTransport` → `@modelcontextprotocol/sdk/server/streamableHttp.js`
  - `SSEServerTransport` → `@modelcontextprotocol/sdk/server/sse.js`
  - `isInitializeRequest` → `@modelcontextprotocol/sdk/types.js`
  - `express` → `express` (dependência explícita, não transitiva do SDK)
- **Transport dual**: Streamable HTTP + SSE com gerenciamento unificado de sessions
- **GraphQL upstream** (validado via curl):
  - 199 tipos, 50 queries, relações ricas entre entidades
  - 24 categorias de recursos com queries list (filtros via `NumberFilterInput`, `StringFilterInput`) e item (index)
  - **Union types** que exigem inline fragments: `MonsterArmorClass` (→ `ArmorClassDex`, `ArmorClassNatural`, `ArmorClassArmor`, `ArmorClassCondition`, `ArmorClassSpell`), `DamageOrDamageChoice` (→ `Damage`), `AnyEquipment`, `ProficiencyReference`
  - **Filtros tipados**: `challenge_rating` usa `NumberFilterInput` com `{ eq: 6 }`, não valor direto. Suporta `eq`, `in`, `nin`, `range`.
  - **Mutations/subscriptions**: API retorna erro explícito ("Schema is not configured to execute mutation/subscription operation.")
  - **Respostas parciais**: GraphQL pode retornar `{ data: {...}, errors: [...] }` simultaneamente
  - **Body parsing confirmado**: `StreamableHTTPServerTransport.handleRequest(req, res, parsedBody)` e `SSEServerTransport.handlePostMessage(req, res, parsedBody)` aceitam body pré-parseado como 3º argumento. `express.json()` global é compatível — passar `req.body` diretamente.
  - **SSE session routing confirmado**: `SSEServerTransport` gera `_sessionId = randomUUID()` no construtor. `start()` envia `event: endpoint` com URL `${endpoint}?sessionId=${sessionId}`. Rota `POST /messages` usa `req.query.sessionId` para correlacionar.
- **Cache pattern**: Chave única com metadados `{data, fetchedAt}`, sem TTL no Redis. Staleness gerenciada na aplicação. Evicção via `allkeys-lru`.
- **Idiomas**: Documentação em português do Brasil; comentários e artefatos de código em inglês
- **TLS/HTTPS**: Terminação TLS pelo Dokploy (reverse proxy com certificado automático). Servidor expõe apenas HTTP.

### Referências Externas

| Referência | Propósito |
| ---------- | --------- |
| https://www.dnd5eapi.co/graphql | Endpoint GraphQL upstream (introspecção disponível, sem auth) |
| https://github.com/5e-bits/5e-srd-api | Repositório da API upstream (REST + GraphQL, Express, MongoDB) |
| https://github.com/5e-bits/5e-database | Banco de dados do SRD (seed data) |
| https://github.com/franpek/5e-srd-api-mcp | MCP STDIO de referência (50+ tools, abordagem 1:1 REST) |
| https://github.com/modelcontextprotocol/typescript-sdk | SDK MCP oficial v1.27.x |

### Decisões Técnicas

- **GraphQL em vez de REST**: Permite queries complexas em uma única interação, reduzindo tokens e round-trips. Validado via curl — queries com variáveis, filtros tipados e inline fragments funcionam corretamente.
- **2 tools em vez de 50+**: Consolidação em `graphql_query` + `explore_schema` — máxima flexibilidade com mínimo overhead.
- **`instructions` + `prompt` (duas camadas)**: Campo `instructions` no McpServer para contexto auto-injetado no system prompt do cliente (schema, Union types, sintaxe de filtros). Prompt `dnd5e_guide` para referência detalhada sob demanda (exemplos extensivos, guia contextual).
- **Cache com metadados (sem TTL Redis)**: Armazena `{data, fetchedAt}` sem TTL. Staleness verificada na aplicação (`Date.now() - fetchedAt > CACHE_TTL * 1000`). Dado stale nunca desaparece — só é evictado pelo LRU quando Redis precisa de memória. Permite stale-while-revalidate real.
- **Validação de operation type**: Rejeitar mutations e subscriptions antes de enviar ao upstream. Defesa em profundidade — upstream já rejeita, mas evita requests desnecessárias.
- **Gerenciamento unificado de sessions**: Streamable HTTP e SSE compartilham a mesma Map de sessions, o mesmo `MAX_SESSIONS`, o mesmo cleanup periódico e o mesmo TTL de inatividade. Impede bypass via SSE.
- **Rate limiting excluindo `/health`**: Aplicado globalmente exceto no health check, evitando falsos positivos de monitoramento. Requer `app.set('trust proxy', 1)` para que `express-rate-limit` identifique o IP real do cliente atrás do reverse proxy do Dokploy (sem isso, todos os clientes compartilham o mesmo bucket de rate limit do IP do proxy).
- **CORS via pacote `cors`**: Tratamento completo de preflight (OPTIONS) com `allowedHeaders` explícitos: `Content-Type`, `Accept`, `mcp-session-id` (obrigatório para Streamable HTTP). `exposedHeaders: ['mcp-session-id']` para que clientes browser leiam o header da resposta. Configurável via `CORS_ORIGIN`.
- **Graceful shutdown com timeout forçado**: Drain de conexões + `setTimeout(() => process.exit(1), 5000)` como safety net contra transport.close() que pendura. Docker `stop_grace_period: 10s`.
- **hashKey determinístico**: Função recursiva que cria objetos novos com chaves ordenadas via `Object.keys().sort()` em todos os níveis, seguida de `JSON.stringify` + normalização de whitespace na query + SHA-256.
- **Respostas parciais GraphQL via `rawRequest()` + `errorPolicy: 'all'`**: `graphql-request` v7 lança `ClientError` por padrão quando o upstream retorna `errors`. Usar `rawRequest()` com `errorPolicy: 'all'` no construtor do `GraphQLClient` — em **HTTP 200 + errors** (respostas parciais), retorna `{ data, errors, extensions, status, headers }` sem lançar exceção. Em **HTTP 400** (erros de validação), `rawRequest()` **sempre lança `ClientError`** independente de `errorPolicy` — capturar via try/catch e extrair `error.response.data` e `error.response.errors`. Cachear apenas se `data` não é null. Exibir erros junto com dados para a LLM. Assinatura: `rawRequest({ query, variables, signal })` — campo é `query` (não `document`), verificado no source code de `parseRawRequestArgs`.
- **Truncamento inteligente**: Se resposta excede `MAX_RESPONSE_SIZE`, substituir resposta inteira por mensagem de erro orientando uso de filtros — nunca truncar JSON no meio.
- **Docker healthcheck via Node.js**: Usar `node -e` em vez de `wget` para não depender de tools opcionais em Alpine.
- **Logs com correlação**: Incluir session ID e query hash em todas as mensagens de log relevantes.

## Plano de Implementação

### Estrutura do Projeto

```
dnd-5e-mcp/
├── src/
│   ├── index.ts                  # Entry point: Express + dual transport + shutdown
│   ├── server.ts                 # McpServer factory: instructions + register tools/prompt
│   ├── config.ts                 # Typed env var config
│   ├── tools/
│   │   ├── graphql-query.ts      # Tool: graphql_query
│   │   └── explore-schema.ts     # Tool: explore_schema
│   ├── prompts/
│   │   └── system-prompt.ts      # Prompt: dnd5e_guide
│   └── services/
│       ├── graphql-client.ts     # GraphQL client + Redis cache + stale-while-revalidate
│       └── redis-client.ts       # Redis connection + helpers
├── Dockerfile                    # Multi-stage build
├── docker-compose.yaml           # MCP server + Redis + healthchecks
├── .env.example                  # Template de variáveis de ambiente
├── .dockerignore
├── .gitignore
├── package.json
└── tsconfig.json
```

### Tarefas

- [x] **Tarefa 1: Scaffolding do projeto**
  - File: `package.json`
  - Action: Criar com `"type": "module"`, scripts (`build`: `tsc`, `dev`: `tsx --env-file=.env src/index.ts`, `start`: `node dist/index.js`), dependencies (`@modelcontextprotocol/sdk`, `express`, `graphql-request`, `graphql`, `ioredis`, `zod`, `express-rate-limit`, `cors`), devDependencies (`typescript`, `@types/node`, `tsx`, `@types/cors`)
  - File: `tsconfig.json`
  - Action: Configurar `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"outDir": "./dist"`, `"rootDir": "./src"`, `"strict": true`, `"esModuleInterop": true`, `"skipLibCheck": true`
  - File: `.gitignore`
  - Action: Criar com `node_modules/`, `dist/`, `.env`, `*.js.map`
  - File: `.dockerignore`
  - Action: Criar com `node_modules/`, `dist/`, `.env`, `.git/`, `*.md`
  - Notes: `npm install` após criar package.json. Express 5 é declarado como dependência explícita (não depender de transitiva do SDK). Versão mínima `^5.2.1` (compatível com SDK).

- [x] **Tarefa 2: Módulo de configuração**
  - File: `src/config.ts`
  - Action: Exportar objeto `config` tipado lendo de `process.env` com defaults sensatos:
    - `PORT` (default: `3000`) — porta do servidor Express
    - `GRAPHQL_ENDPOINT` (default: `https://www.dnd5eapi.co/graphql`) — URL do GraphQL upstream
    - `REDIS_URL` (default: `redis://redis:6379`) — conexão Redis (nome do serviço Docker)
    - `CACHE_TTL` (default: `3600`) — tempo em segundos após o qual o dado é considerado stale (1h). Não é TTL do Redis — é verificado na aplicação.
    - `UPSTREAM_TIMEOUT` (default: `30000`) — timeout das requests ao upstream em ms (conservador para queries pesadas)
    - `RATE_LIMIT_WINDOW` (default: `60000`) — janela do rate limit em ms (1 minuto)
    - `RATE_LIMIT_MAX` (default: `60`) — máximo de requests por IP por janela
    - `MAX_SESSIONS` (default: `100`) — limite máximo de sessions concorrentes (Streamable HTTP + SSE unificado)
    - `SESSION_IDLE_TTL` (default: `1800000`) — TTL de inatividade de session em ms (30 minutos)
    - `MAX_RESPONSE_SIZE` (default: `102400`) — tamanho máximo da resposta serializada em bytes (100KB)
    - `CORS_ORIGIN` (default: `*`) — origens permitidas para CORS
    - `NODE_ENV` (default: `production`)
  - Notes: Sem dotenv — Docker Compose injeta via `env_file`. Para dev local, usar `tsx --env-file=.env src/index.ts`. **Todas as variáveis numéricas** (`PORT`, `CACHE_TTL`, `UPSTREAM_TIMEOUT`, `RATE_LIMIT_WINDOW`, `RATE_LIMIT_MAX`, `MAX_SESSIONS`, `SESSION_IDLE_TTL`, `MAX_RESPONSE_SIZE`) devem ser parseadas com `Number()` e incluir guard contra NaN: `const val = Number(process.env.X); if (Number.isNaN(val)) throw new Error('Invalid X')` — ou usar default se NaN. `process.env` retorna strings; sem coerção explícita, comparações numéricas falham silenciosamente.

- [x] **Tarefa 3: Cliente Redis com cache metadata-based**
  - File: `src/services/redis-client.ts`
  - Action: Criar módulo que exporta:
    - `redis` — instância ioredis conectada via `config.REDIS_URL` com opções: `maxRetriesPerRequest: 1` (falhar rápido em operações individuais), `retryStrategy(times)` retornando `Math.min(times * 500, 5000)` para reconexão com backoff (máx 5s), e `lazyConnect: false` (conectar eagerly). Isso evita storm de retries e logs poluídos quando Redis está indisponível (especialmente em dev local sem Docker).
    - **Tipo `CacheEntry`**: `{ data: unknown, fetchedAt: number }` — formato de armazenamento no cache
    - `cacheGet(key: string): Promise<CacheEntry | null>` — executa `redis.get(key)`, parse JSON, retorna `CacheEntry` ou `null`. Try/catch retornando `null` se Redis indisponível. Loga warning com query hash se falhar.
    - `cacheSet(key: string, entry: CacheEntry): Promise<void>` — executa `redis.set(key, JSON.stringify(entry))` **sem TTL** (sem `EX`). Evicção fica por conta do `maxmemory-policy allkeys-lru`. Try/catch logando warning se falhar.
    - `isFresh(entry: CacheEntry): boolean` — retorna `Date.now() - entry.fetchedAt < config.CACHE_TTL * 1000`
    - `hashKey(query: string, variables?: Record<string, unknown>): string` — gera SHA-256 hash determinístico:
      1. Normalizar query: colapsar múltiplos whitespace em espaço único, trim
      2. Serializar variables com chaves ordenadas recursivamente: usar `variables ?? {}` para tratar `undefined` (garante hash consistente). Função `sortKeys(obj)` que percorre o objeto, para cada nível cria novo objeto com `Object.keys(obj).sort()` e aplica recursivamente em valores que são objetos (não arrays, não null)
      3. Concatenar: `query_normalizada + '|' + variables_serializadas`
      4. SHA-256 hex do resultado
    - `isRedisHealthy(): Promise<boolean>` — executa `redis.ping()` com timeout de 1s
    - `closeRedis(): Promise<void>` — fecha conexão Redis (graceful shutdown)
    - Graceful degradation: todas as operações envolvidas em try/catch. Se Redis indisponível, loga `console.warn` com contexto e continua sem cache.
  - Notes: Conectar eagerly e logar status. Listener `redis.on('error', (err) => console.error('[redis]', err.message))`.

- [x] **Tarefa 4: Cliente GraphQL com stale-while-revalidate**
  - File: `src/services/graphql-client.ts`
  - Action: Criar módulo que exporta:
    - `executeQuery(query: string, variables?: Record<string, unknown>): Promise<{ data: unknown, errors?: unknown[], stale?: boolean }>` — função principal:
      1. Gerar cache key via `hashKey(query, variables)`
      2. `cacheGet(key)` → se encontrou entry:
         - Se `isFresh(entry)` → retornar `{ data: entry.data }` (cache hit)
         - Se stale → guardar referência, continuar para upstream (tentará atualizar)
      3. Tentar upstream via `graphql-request` **`rawRequest()`** com **AbortController** timeout de `config.UPSTREAM_TIMEOUT` ms. **IMPORTANTE**: Usar `rawRequest()` em vez de `request()` — o método `request()` lança `ClientError` quando o upstream retorna `errors`, descartando `data` parcial. `rawRequest()` com `errorPolicy: 'all'` retorna `{ data, errors, extensions, status, headers }` sem lançar exceção em **erros GraphQL retornados com HTTP 200** (respostas parciais). **PORÉM**, em erros de validação que resultam em **HTTP 400**, `rawRequest()` **lança `ClientError` independentemente de `errorPolicy`**. Tratar ambos os cenários:
         - **HTTP 200 + errors**: `rawRequest()` retorna normalmente → acessar `response.data` e `response.errors`
         - **HTTP 400 (validação)**: `rawRequest()` lança `ClientError` → capturar via `try/catch`, extrair `error.response.data` e `error.response.errors` do `ClientError`. Retornar dados parciais se disponíveis, ou propagar erros se `data` é null.
      4. **Se upstream retornou** (com ou sem erros, via retorno normal ou ClientError com dados):
         - Se `data` não é null → `cacheSet(key, { data, fetchedAt: Date.now() }).catch(err => console.warn('[cache] Write failed:', err.message))`
         - Se `errors` existe → incluir no retorno junto com data
         - Retornar `{ data, errors }`
      5. **Se upstream falhou** (timeout, network error — exceções que NÃO são erros GraphQL):
         - Se tem entry stale do passo 2 → retornar `{ data: entry.data, stale: true }` com `console.warn('[upstream] Failed, serving stale cache')`
         - Se não tem cache → propagar erro com mensagem clara
    - `executeIntrospection(typeName: string): Promise<IntrospectionResult>` — wrapper para introspection query **usando variáveis parametrizadas** (nunca interpolação de string — prevenir injeção GraphQL): query `query IntrospectType($name: String!) { __type(name: $name) { name kind description fields { name description type { name kind ofType { name kind ofType { name } } } } inputFields { name description type { name kind } } enumValues { name description } } }` com `variables: { name: typeName }`. Usa mesmo fluxo de cache via `executeQuery`. **Tipo `IntrospectionResult`**: definir interface local `{ __type: { name: string, kind: string, description?: string, fields?: Array<{ name: string, description?: string, type: { name?: string, kind: string, ofType?: ... } }>, inputFields?: ..., enumValues?: ... } | null }`. Usar type assertion no retorno de `executeQuery`: `result.data as IntrospectionResult`.
    - `executeRootQueryFields(): Promise<RootQueryFieldsResult>` — introspection query para listar todos os root query fields: `{ __schema { queryType { fields { name description type { name kind } } } } }`. Retorna lista de campos disponíveis com nome, descrição e tipo de retorno. Usa mesmo fluxo de cache via `executeQuery`. **Tipo `RootQueryFieldsResult`**: `{ __schema: { queryType: { fields: Array<{ name: string, description?: string, type: { name?: string, kind: string } }> } } }`. Verificado via curl — retorna 50 fields na API atual.
    - Loga `[graphql] session=${sessionId} hash=${keyHash} cache=${hit|miss|stale} time=${ms}ms` em cada operação (sessionId passado como parâmetro opcional).
  - Notes: `GraphQLClient` do graphql-request 7 instanciado uma vez no module scope com `errorPolicy: 'all'` no requestConfig do construtor: `new GraphQLClient(config.GRAPHQL_ENDPOINT, { errorPolicy: 'all' })`. `errorPolicy: 'all'` vai no 2º argumento do construtor (requestConfig), que é espalhado internamente como `fetchOptions`. Com `errorPolicy: 'all'`, `rawRequest()` NÃO lança em HTTP 200 + errors (retorna data + errors). Em HTTP 400 (validação), `rawRequest()` SEMPRE lança `ClientError` independente de `errorPolicy` — capturar via try/catch e extrair `.response.data` e `.response.errors`. Signal do AbortController passado via opções de `rawRequest()`: `rawRequest({ query, variables, signal })`.

- [x] **Tarefa 5: Tool — explore_schema**
  - File: `src/tools/explore-schema.ts`
  - Action: Exportar função `registerExploreSchema(server: McpServer)` que registra via `server.registerTool()`:
    - **name**: `explore_schema`
    - **description**: `Explore the D&D 5e GraphQL API schema. Use this to discover available types, their fields, and relationships before constructing queries. You can explore a specific type to see its fields, or list all available query root fields. IMPORTANT: Some fields use Union types that require inline fragments (e.g., Monster.armor_class needs '... on ArmorClassDex { type value }'). This tool will indicate when inline fragments are needed.`
    - **inputSchema**: `z.object({ typeName: z.string().optional().describe('Name of the GraphQL type to explore (e.g., "Monster", "Spell", "Class"). If omitted, returns all available root query fields.') })`
    - **callback**: Se `typeName` fornecido → `executeIntrospection(typeName)` formatando como tabela markdown com colunas: Field, Type, Description. Para campos com tipo UNION ou INTERFACE, adicionar nota: "⚠ Union type — use inline fragments: `... on TypeA { fields }`. Variants: [lista]". Se omitido → `executeRootQueryFields()` (da Tarefa 4) para listar todos os root query fields com nome, tipo de retorno e descrição.
  - Notes: Formatar output como texto legível. Não hardcodar contagem de fields — usar o que a introspection retornar.

- [x] **Tarefa 6: Tool — graphql_query com validação de operation type**
  - File: `src/tools/graphql-query.ts`
  - Action: Exportar função `registerGraphqlQuery(server: McpServer)` que registra via `server.registerTool()`:
    - **name**: `graphql_query`
    - **description**: `Execute a GraphQL query against the D&D 5e SRD API (2014 SRD). Supports all 24 resource types. IMPORTANT: (1) Filters use typed inputs, e.g., challenge_rating: { eq: 6 }, not challenge_rating: 6. (2) Union type fields (like Monster.armor_class, Action.damage) require inline fragments: '... on ArmorClassDex { type value }'. Use explore_schema first to discover field types and required fragments.`
    - **inputSchema**: `z.object({ query: z.string().describe('The GraphQL query to execute. Must be a query operation (mutations and subscriptions are not supported).'), variables: z.record(z.unknown()).optional().describe('Optional variables for the GraphQL query') })`
    - **callback**:
      1. Validar que a query não é vazia
      2. **Validar operation type**: Primeiro strip de comentários GraphQL (`#` até fim de linha) e trim de whitespace. Depois verificar que o corpo restante começa com `query`, `{` (query anônima), ou `fragment` (fragmentos seguidos de query). Rejeitar se começa com `mutation` ou `subscription` com mensagem: "Only query operations are supported. Mutations and subscriptions are not available." Regex: `/^(query\b|\{|fragment\b)/` aplicado após limpeza de comentários e whitespace.
      3. Executar `executeQuery(query, variables)`
      4. Formatar resultado: se `errors` presente, incluir seção "Errors:" antes dos dados. Se `stale` é true, incluir nota "Note: This data is from cache and may be slightly outdated."
      5. Serializar dados como JSON indentado
      6. Verificar tamanho contra `config.MAX_RESPONSE_SIZE`. Se exceder, **substituir resposta inteira** por mensagem: "Response too large (exceeded configured limit of X KB). Please use more specific field selections or add filters (limit, name, challenge_rating: {eq: N}) to reduce the response size. Use explore_schema to discover available filter options."
      7. Em caso de erro (upstream falhou, sem cache) → mensagem de erro clara com sugestão de usar `explore_schema`
  - Notes: A validação de mutations/subscriptions é defesa em profundidade — upstream já rejeita, mas evitamos requests desnecessárias e damos mensagem de erro melhor. Para `MAX_RESPONSE_SIZE`: como `rawRequest()` já desserializa o JSON, o objeto já está em memória. O `JSON.stringify` para verificar tamanho é inevitável. Para mitigar respostas absurdamente grandes, considerar `JSON.stringify` com `replacer` que conta bytes incrementalmente e lança exceção ao exceder o limite (evita alocar string gigante completa). Alternativa simples: confiar que o upstream retorna respostas razoáveis e serializar normalmente.

- [x] **Tarefa 7: System prompt em duas camadas — instructions + prompt**
  - File: `src/prompts/system-prompt.ts`
  - Action: Exportar duas coisas:
    - **`SERVER_INSTRUCTIONS: string`** — texto conciso (~800-1000 tokens, em inglês) para o campo `instructions` do McpServer. Conteúdo:
      1. Identificação: "This server provides access to the D&D 5e SRD (System Reference Document) database via GraphQL."
      2. Tools disponíveis: breve descrição de `graphql_query` e `explore_schema`
      3. **Regras críticas para queries** (a LLM PRECISA saber):
         - Filtros tipados: `challenge_rating: { eq: 6 }`, `name: "Fireball"`, `limit: 10`, `skip: 0`
         - Union types que exigem inline fragments: `MonsterArmorClass` (→ `ArmorClassDex`, `ArmorClassNatural`, `ArmorClassArmor`), `DamageOrDamageChoice` (→ `Damage`), `AnyEquipment`, `ProficiencyReference`
         - Exemplo inline fragment: `armor_class { ... on ArmorClassDex { type value } ... on ArmorClassNatural { type value } }`
      4. **Relações principais**: Class→Levels→Features, Race→Subrace→Traits, Spell→School→Classes, Monster→Actions→Damage
      5. Instrução: "Use explore_schema to discover types and fields before constructing complex queries. Use the dnd5e_guide prompt for comprehensive examples and context-specific guidance."
    - **`registerSystemPrompt(server: McpServer)`** — registra prompt detalhado `dnd5e_guide` via `server.registerPrompt()`:
      - **name**: `dnd5e_guide`
      - **description**: `Comprehensive reference guide with detailed examples for querying the D&D 5e SRD. Includes entity relationships, example queries for common use cases, and context-specific guidance for players and DMs.`
      - **argsSchema**: `z.object({ context: z.enum(['player', 'dm', 'general']).optional().default('general').describe('Context: player (character creation, rules lookup), dm (campaign planning, encounter building), general (all-purpose)') })`
      - **callback**: Retornar mensagem (~2000-3000 tokens, em inglês) com:
        1. **Overview completo**: 24 categorias de recursos com descrição
        2. **Mapa de relações detalhado** (Character Building, Combat, Rules)
        3. **8+ exemplos de queries prontas** (testadas e validadas via curl):
           - Monstro por nome: `{ monster(index: "adult-red-dragon") { name challenge_rating hit_points armor_class { ... on ArmorClassDex { type value } ... on ArmorClassNatural { type value } } } }`
           - Monstros por CR: `{ monsters(challenge_rating: { eq: 6 }, limit: 5) { index name challenge_rating hit_points size type } }`
           - Spells com filtro: `{ spells(level: { eq: 3 }, limit: 10) { index name level school { name } casting_time concentration } }`
           - Classe com levels: `{ class(index: "wizard") { name hit_die spellcasting { spellcasting_ability { name } info { name desc } } class_levels { level prof_bonus features { name } } } }`
           - Raça com subraças: `{ race(index: "elf") { name speed ability_bonuses { bonus ability_score { name } } subraces { name index } } }`
           - Equipamento por categoria: `{ equipmentCategory(index: "weapon") { name equipment { index name ... on Weapon { weapon_category damage { damage_dice damage_type { name } } } } } }`
           - Regras: `{ rules { index name subsections { name desc } } }`
           - Condições: `{ conditions { index name desc } }`
        4. **Dicas para queries eficientes**
        5. **Seção contextual** baseada no arg `context`
  - Notes: `SERVER_INSTRUCTIONS` deve ser conciso — é injetado em TODA interação. `dnd5e_guide` pode ser extenso — só é carregado sob demanda. Todos os exemplos de queries devem ser testados contra a API real.

- [x] **Tarefa 8: Factory do MCP Server com instructions**
  - File: `src/server.ts`
  - Action: Exportar função `createMcpServer(): McpServer` que:
    1. Importar `SERVER_INSTRUCTIONS` e `registerSystemPrompt` da Tarefa 7
    2. Ler versão do `package.json` via `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const { version } = require('../package.json');` (funciona em ESM; alternativa: `JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version`)
    3. Instancia `new McpServer({ name: 'dnd-5e-mcp', version, instructions: SERVER_INSTRUCTIONS }, { capabilities: { logging: {} } })`
    4. Chama `registerExploreSchema(server)` (da Tarefa 5)
    5. Chama `registerGraphqlQuery(server)` (da Tarefa 6)
    6. Chama `registerSystemPrompt(server)` (da Tarefa 7)
    7. Retorna `server`
  - Notes: O campo `instructions` é enviado automaticamente ao cliente na resposta de inicialização. O cliente injeta no system prompt via `client.getInstructions()`. Função pura — transport é conectado no entry point. Versão lida de `package.json` em vez de hardcoded — single source of truth.

- [x] **Tarefa 9: Entry point — Express + transports + rate limiting + CORS + shutdown**
  - File: `src/index.ts`
  - Action: Criar o entry point do servidor:
    1. Importar `express` do pacote `express`, `StreamableHTTPServerTransport` e `SSEServerTransport` do SDK, `isInitializeRequest` do SDK, pacotes `cors` e `express-rate-limit`
    2. Criar Express app via `express()` diretamente (não usar `createMcpExpressApp()` — seu comportamento de pré-registro de rotas é ambíguo e pode conflitar com rotas manuais)
    3. **Trust proxy**: `app.set('trust proxy', 1)` — **obrigatório** para que `express-rate-limit` e `req.ip` identifiquem o IP real do cliente atrás do reverse proxy do Dokploy. Sem isso, todos os clientes aparecem como o IP do proxy e compartilham um único bucket de rate limit.
    4. **Body parsing**: `app.use(express.json())` — Express 5 não faz parse automático de JSON. Necessário para todas as rotas POST (`/mcp`, `/messages`). **Confirmado compatível com SDK**: `StreamableHTTPServerTransport.handleRequest(req, res, parsedBody)` e `SSEServerTransport.handlePostMessage(req, res, parsedBody)` ambos aceitam body pré-parseado como 3º argumento — passar `req.body` (já parseado pelo middleware).
    5. **CORS**: `app.use(cors({ origin: config.CORS_ORIGIN, allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id'], exposedHeaders: ['mcp-session-id'] }))` — tratamento completo de preflight OPTIONS com headers explícitos para Streamable HTTP. `allowedHeaders` garante que browsers enviem `mcp-session-id` em requests cross-origin. `exposedHeaders` permite que browsers leiam `mcp-session-id` da resposta.
    6. **Rate limiting**: Criar **uma única instância** de `rateLimit({ windowMs: config.RATE_LIMIT_WINDOW, max: config.RATE_LIMIT_MAX, message: 'Too many requests, please try again later' })` e aplicar nas rotas MCP: `app.use('/mcp', rateLimiter)`, `app.use('/sse', rateLimiter)`, `app.use('/messages', rateLimiter)` — **excluindo** `/health`. Usar instância compartilhada (não criar múltiplas) para que o contador de requests por IP seja unificado entre todas as rotas MCP.
    7. **Health check**: `GET /health` (sem rate limiting — registrar ANTES dos rate limiters) → verificar `isRedisHealthy()` e retornar:
       - Redis up: `{ status: 'ok', redis: true, activeSessions: N, uptime: process.uptime() }`
       - Redis down: `{ status: 'degraded', redis: false, activeSessions: N, uptime: process.uptime() }`
       - Sempre retorna 200 (o servidor funciona mesmo sem Redis)
    8. **Mapa unificado de sessions**: `Map<string, { transport: StreamableHTTPServerTransport | SSEServerTransport, server: McpServer, lastActivity: number, type: 'http' | 'sse' }>` — compartilhado entre Streamable HTTP e SSE
    9. **Streamable HTTP**:
       - `POST /mcp`: Se header `mcp-session-id` existe e session válida → atualizar `lastActivity`, reuse transport → `transport.handleRequest(req, res, req.body)`. Se não tem session e body é `isInitializeRequest()` → verificar `sessions.size < config.MAX_SESSIONS` (senão 503), criar transport com `sessionIdGenerator: () => randomUUID()`, criar McpServer via `createMcpServer()`, conectar, registrar na Map → `transport.handleRequest(req, res, req.body)`. Senão → 400.
       - `GET /mcp`: SSE streaming para session existente (header `mcp-session-id`). Atualizar `lastActivity`. → `transport.handleRequest(req, res)`
       - `DELETE /mcp`: Cleanup de session → `transport.handleRequest(req, res)`
    10. **SSE fallback (legado)** — compartilha gerenciamento de sessions:
       - `GET /sse`: Verificar `sessions.size < config.MAX_SESSIONS` (senão 503). Criar `SSEServerTransport('/messages')`, criar McpServer, conectar, registrar na Map unificada com `type: 'sse'` e sessionId gerado (`randomUUID()`), retornar SSE stream. O `SSEServerTransport` retorna ao cliente um endpoint com path `/messages?sessionId={id}` via header SSE.
       - `POST /messages`: Extrair `sessionId` do query parameter (`req.query.sessionId`). Buscar session na Map unificada via sessionId. Se session não existe → 400. Se existe → atualizar `lastActivity` e delegar ao `transport.handlePostMessage(req, res, req.body)` (3º arg = body pré-parseado pelo `express.json()` middleware; SSE transport tem fallback para raw-body se omitido, mas é melhor passar explicitamente). **Isso garante correlação correta entre mensagens e sessions SSE.**
    11. **Cleanup periódico com guard contra race condition**: `const cleanupInterval = setInterval(() => {...}, 60_000)` — para cada session, verificar `Date.now() - lastActivity > config.SESSION_IDLE_TTL`. Antes de fechar, verificar novamente `lastActivity` (double-check — uma request pode ter atualizado entre a iteração e o close). Se ainda idle, chamar `transport.close()` e deletar da Map. Loga `[sessions] Cleaned N idle sessions, M active remaining`.
    12. **Graceful shutdown** (handler **async** com `await`):
        - Definir `async function shutdown(signal: string)` e registrar para `SIGTERM` e `SIGINT`: `process.on('SIGTERM', () => shutdown('SIGTERM'))`, `process.on('SIGINT', () => shutdown('SIGINT'))`
        - Usar flag `let isShuttingDown = false` para ignorar sinais duplicados (evitar double-shutdown)
        - No handler:
          1. `if (isShuttingDown) return; isShuttingDown = true;`
          2. `console.log('[shutdown] ${signal} received, draining...')`
          3. **Safety net** (registrar ANTES do await para garantir que dispara mesmo se drain pendura): `const forceTimer = setTimeout(() => { console.error('[shutdown] Forced exit after 5s'); process.exit(1); }, 5000); forceTimer.unref();` (`.unref()` para não manter o event loop vivo se drain terminar antes)
          4. `clearInterval(cleanupInterval)`
          5. `httpServer.close()` — para de aceitar novas conexões
          6. `await Promise.all([...sessions.values()].map(s => s.transport.close().catch(err => console.warn('[shutdown] Transport close error:', err.message))))` — fechar todos os transports em paralelo com catch individual
          7. `await closeRedis()`
          8. `process.exit(0)`
    13. Iniciar: `const httpServer = app.listen(config.PORT, () => console.log(...))`. Logar porta, NODE_ENV e configurações ativas.
  - Notes: `transport.onclose` também deve deletar da Map unificada (client-initiated cleanup). Loga `[session] Created type=${type} id=${id} total=${sessions.size}` e `[session] Closed id=${id} total=${sessions.size}`. O double-check de `lastActivity` no cleanup (item 11) é uma proteção simples contra race conditions — se entre a verificação e o close uma request atualizou `lastActivity`, o close é abortado e a session sobrevive até o próximo ciclo.

- [x] **Tarefa 10: Docker setup com healthchecks**
  - File: `Dockerfile`
  - Action: Multi-stage build:
    - **Stage 1 (build)**: `FROM node:22-alpine AS build`, `WORKDIR /app`, copiar package*.json, `npm ci`, copiar src + tsconfig, `npm run build`
    - **Stage 2 (runtime)**: `FROM node:22-alpine`, `WORKDIR /app`, copiar package*.json, `npm ci --omit=dev`, copiar `dist/` do stage build, `EXPOSE 3000`, `USER node`, `CMD ["node", "dist/index.js"]`
  - File: `docker-compose.yaml`
  - Action: Dois serviços com healthchecks:
    - **mcp**:
      - Build do Dockerfile
      - `ports: ["3000:3000"]`
      - `env_file: .env`
      - `depends_on: redis (condition: service_healthy)`
      - `restart: unless-stopped`
      - `stop_grace_period: 10s`
      - `networks: [mcp-net]`
      - `healthcheck: test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', r => { let d=''; r.on('data', c => d+=c); r.on('end', () => process.exit(JSON.parse(d).status ? 0 : 1)); }).on('error', () => process.exit(1))"], interval: 30s, timeout: 5s, retries: 3, start_period: 10s`
    - **redis**:
      - `image: redis:7-alpine`
      - `command: redis-server --maxmemory 128mb --maxmemory-policy allkeys-lru --save ""`
      - Sem port mapping (rede interna apenas)
      - `restart: unless-stopped`
      - `networks: [mcp-net]`
      - Sem volumes (efêmero por design)
      - `healthcheck: test: ["CMD", "redis-cli", "ping"], interval: 10s, timeout: 3s, retries: 3`
    - **networks**: `mcp-net: driver: bridge`
  - File: `.env.example`
  - Action: Template com todas as variáveis documentadas em português:
    ```
    # Servidor
    PORT=3000
    NODE_ENV=production

    # API D&D 5e (upstream GraphQL)
    GRAPHQL_ENDPOINT=https://www.dnd5eapi.co/graphql
    UPSTREAM_TIMEOUT=30000

    # Cache Redis (sem TTL no Redis — staleness gerenciada pela aplicação)
    REDIS_URL=redis://redis:6379
    CACHE_TTL=3600

    # Rate Limiting (por IP, em memória)
    RATE_LIMIT_WINDOW=60000
    RATE_LIMIT_MAX=60

    # Sessions (Streamable HTTP + SSE unificado)
    MAX_SESSIONS=100
    SESSION_IDLE_TTL=1800000

    # Resposta (substituir por mensagem de erro se exceder)
    MAX_RESPONSE_SIZE=102400

    # CORS
    CORS_ORIGIN=*
    ```
  - Notes: Redis com `--save ""` desabilita snapshots RDB explicitamente. `stop_grace_period: 10s` no Docker dá margem para o safety net de 5s do shutdown.

### Critérios de Aceitação

**Funcionalidade principal:**

- [x] AC 1: Dado que o servidor MCP está rodando, quando um cliente envia POST para `/mcp` com uma request de inicialização, então uma nova session é criada e o servidor responde com capabilities incluindo as 2 tools, 1 prompt e campo `instructions` com o conteúdo do schema overview.

- [x] AC 2: Dado uma session válida, quando o cliente invoca `graphql_query` com `{ query: "{ monsters(challenge_rating: { eq: 6 }, limit: 3) { index name challenge_rating } }" }`, então o servidor retorna uma resposta JSON com monstros de CR 6.

- [x] AC 3: Dado uma session válida, quando o cliente invoca `explore_schema` sem argumentos, então o servidor retorna uma lista formatada de todos os root query fields com nomes e descrições (quantidade dinâmica conforme API upstream).

- [x] AC 4: Dado uma session válida, quando o cliente invoca `explore_schema` com `{ typeName: "Monster" }`, então o servidor retorna campos formatados incluindo indicação de Union types que requerem inline fragments (ex: `armor_class` → `MonsterArmorClass`).

- [x] AC 5: Dado uma session válida, quando o cliente solicita o prompt `dnd5e_guide` com `{ context: "dm" }`, então o servidor retorna um guia markdown com exemplos de queries validadas, focado em casos de uso de DM.

**Cache com stale-while-revalidate:**

- [x] AC 6: Dado que o Redis está rodando, quando a mesma query GraphQL é executada duas vezes, então a segunda chamada retorna do cache (verificável via diferença no tempo de resposta ou log `cache=hit`).

- [x] AC 7: Dado que o Redis NÃO está rodando, quando uma query GraphQL é executada, então o servidor retorna o resultado da API upstream (degradação graciosa) e loga warning.

- [x] AC 8: Dado que o upstream está fora do ar e existe um dado stale no cache, quando uma query é executada, então o servidor retorna o dado stale com nota "data is from cache and may be slightly outdated" e loga `[upstream] Failed, serving stale cache`.

- [x] AC 9: Dado que o upstream está fora do ar e NÃO existe cache, quando uma query é executada, então o servidor retorna mensagem de erro clara indicando indisponibilidade do upstream.

**Compatibilidade de transporte:**

- [x] AC 10: Dado que o servidor está rodando, quando um cliente conecta via `GET /sse` (transporte SSE legado), então uma conexão SSE válida é estabelecida, registrada na Map unificada de sessions, e o cliente pode enviar mensagens via `POST /messages`.

- [x] AC 11: Dado que o servidor está rodando, quando um cliente conecta via Streamable HTTP (`POST /mcp` + `GET /mcp`), então sessions stateful funcionam com resumption via header `mcp-session-id`.

**Docker:**

- [x] AC 12: Dado o docker-compose.yaml, quando `docker compose up --build` é executado, então ambos os serviços (mcp + redis) iniciam com sucesso, passam nos healthchecks e o servidor MCP responde na porta 3000.

- [x] AC 13: Dado uma stack rodando, quando `docker compose down && docker compose up --build` é executado, então a stack reconstrói do zero sem nenhum estado residual.

**Rate limiting e proteção:**

- [x] AC 14: Dado que o servidor está rodando, quando um IP envia mais de `RATE_LIMIT_MAX` requests para `/mcp` dentro de `RATE_LIMIT_WINDOW`, então o servidor retorna 429 Too Many Requests.

- [x] AC 15: Dado que existem `MAX_SESSIONS` sessions ativas (HTTP + SSE combinadas), quando um novo cliente tenta inicializar (via `/mcp` ou `/sse`), então o servidor retorna 503 Service Unavailable.

- [x] AC 16: Dado uma session inativa por mais de `SESSION_IDLE_TTL`, quando o cleanup periódico executa, então a session é removida, `transport.close()` é chamado e recursos são liberados.

- [x] AC 17: Dado que o servidor está rodando, quando um cliente envia mutation (`mutation { ... }`), então o servidor retorna erro "Only query operations are supported" sem enviar request ao upstream.

**Tratamento de erros e limites:**

- [x] AC 18: Dado uma session válida, quando o cliente envia uma query GraphQL com erro de sintaxe, então o servidor retorna mensagem de erro clara com detalhes do GraphQL e sugestão de usar `explore_schema`.

- [x] AC 19: Dado uma session válida, quando o cliente envia `graphql_query` com query vazia, então o servidor retorna erro de validação.

- [x] AC 20: Dado uma session válida, quando a resposta do upstream excede `MAX_RESPONSE_SIZE`, então a resposta inteira é substituída por mensagem orientando uso de filtros (não truncar JSON).

- [x] AC 21: Dado que o upstream retorna resposta parcial (`{ data: {...}, errors: [...] }`), quando o cliente recebe o resultado, então tanto os dados parciais quanto os erros são incluídos na resposta formatada.

**Health e shutdown:**

- [x] AC 22: Dado que o servidor está rodando com Redis disponível, quando GET `/health` é chamado, então responde 200 com `{ status: "ok", redis: true, activeSessions: N, uptime: N }`.

- [x] AC 23: Dado que o servidor está rodando com Redis indisponível, quando GET `/health` é chamado, então responde 200 com `{ status: "degraded", redis: false }`.

- [x] AC 24: Dado que o servidor está rodando, quando SIGTERM é recebido, então o servidor para de aceitar conexões, drena sessions ativas, fecha Redis e encerra com código 0 em até 5s (ou código 1 via safety net).

- [x] AC 25: Dado que o health check é chamado frequentemente por monitoramento, quando `/health` recebe múltiplas requests por segundo, então NÃO é afetado pelo rate limiting (rota excluída).

## Contexto Adicional

### Dependências

**Runtime:**
- `@modelcontextprotocol/sdk` ^1.27.1 — SDK MCP completo (transports, McpServer, compat Zod)
- `express` ^5.2.1 — Framework HTTP (dependência explícita — não depender de transitiva do SDK)
- `graphql-request` ^7.4.0 — Cliente GraphQL leve (usar `rawRequest()` para respostas parciais)
- `graphql` ^16.x — Peer dependency do graphql-request
- `ioredis` ^5.10.0 — Cliente Redis para Node.js
- `zod` ^4.3.6 — Validação de schemas (compatível com SDK `^3.25 || ^4.0`)
- `express-rate-limit` ^7.x — Rate limiting por IP em memória
- `cors` ^2.x — CORS completo com preflight OPTIONS

**Dev:**
- `typescript` ^5.x — Compilador TypeScript
- `@types/node` ^22.x — Type definitions Node.js
- `@types/cors` — Type definitions cors
- `tsx` ^4.x — Runner TypeScript para desenvolvimento

**Infra:**
- Docker + Docker Compose v2
- `node:22-alpine` — Imagem base runtime
- `redis:7-alpine` — Cache service

**Externa:**
- API GraphQL D&D 5e SRD (`https://www.dnd5eapi.co/graphql`) — upstream sem autenticação. Mutations e subscriptions não suportados. Validação de queries é responsabilidade do upstream.

### Estratégia de Testes

**Manual (MCP Inspector):**
- Conectar via MCP Inspector ao servidor local
- Verificar que `instructions` está presente na resposta de inicialização
- Testar `explore_schema` sem argumentos → listar root queries
- Testar `explore_schema` com `typeName: "Monster"` → verificar indicação de Union types
- Testar `graphql_query` com query simples → validar resposta
- Testar `graphql_query` com query usando inline fragments → validar
- Testar `graphql_query` com mutation → verificar rejeição
- Solicitar prompt `dnd5e_guide` nos 3 contextos → validar conteúdo e exemplos

**HTTP direto (curl):**
- `POST /mcp` com initialize → validar session + instructions no response
- `GET /health` → validar health check (com e sem Redis)
- `GET /sse` → validar conexão SSE e registro na Map unificada
- Enviar múltiplas requests rápidas → validar rate limiting (429)
- Confirmar que `/health` não é rate limited

**Validação de cache:**
- `docker compose exec redis redis-cli KEYS '*'` → verificar chaves (sem TTL)
- `docker compose exec redis redis-cli GET <key>` → verificar formato `{data, fetchedAt}`
- Executar mesma query 2x, comparar logs (`cache=hit` vs `cache=miss`)
- Simular upstream down (alterar `GRAPHQL_ENDPOINT` para URL inválida) → verificar stale-while-revalidate

**Compatibilidade:**
- Claude Desktop: configurar endpoint `https://mcp.dnd.carromeu.com/mcp` (Streamable HTTP) ou `/sse`
- ChatGPT: configurar endpoint MCP em `https://mcp.dnd.carromeu.com/mcp`

### Notas

**Riscos identificados:**
- A API upstream pode ter instabilidade — cache com stale-while-revalidate garante disponibilidade enquanto houver dados cacheados (sem TTL no Redis, dados persistem até evicção LRU)
- Union types no GraphQL exigem inline fragments — documentado nas `instructions` e na tool `explore_schema`, mas LLMs podem errar nas primeiras tentativas. Os erros do upstream são claros e incluem sugestões ("Did you mean to use an inline fragment on...")
- `graphql-request` v7 — usar `rawRequest()` com `errorPolicy: 'all'` (não `request()`) para acessar respostas parciais. API verificada: `rawRequest({ query, variables, signal })`. Lembrar que HTTP 400 sempre lança `ClientError` mesmo com `errorPolicy: 'all'` — tratar via try/catch.

**Limitações conhecidas:**
- Cache sem invalidação proativa — staleness controlada por `CACHE_TTL` na aplicação. Dados do SRD mudam raramente.
- SSE transport é legado e pode ser removido em versões futuras do SDK
- Sem testes automatizados nesta versão
- Logs via console sem estruturação JSON

**Futuro:**
- Integração com MCP do Obsidian para construção incremental de campanhas (TTRPG)
- Expandir para API 2024 quando madura
- Testes automatizados (unit + integration)
- Logging estruturado se necessidade operacional aumentar
- Deploy via Dokploy — TLS terminado pelo reverse proxy automático do Dokploy
- URL base produção: `https://mcp.dnd.carromeu.com`

## Review Notes
- Adversarial review completed
- Findings: 15 total, 8 fixed, 7 skipped (6 noise + 1 by-design)
- Resolution approach: auto-fix
- Fixed: F1 (Redis health timeout), F2 (dynamic version in logs), F3 (comment stripping respects strings), F4 (explicit body size limit), F5 (log injection sanitization), F7 (robust package.json path), F8 (await httpServer.close), F9 (cleanup ordering)
