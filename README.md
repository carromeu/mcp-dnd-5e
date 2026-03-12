# DnD 5e MCP Server

MCP Server que expõe a API GraphQL do [D&D 5e SRD](https://www.dnd5eapi.co/graphql) para LLMs via [Model Context Protocol](https://modelcontextprotocol.io). Compatível com Claude Desktop e ChatGPT.

## Funcionalidades

- **2 tools**: `graphql_query` (execução de queries) + `explore_schema` (introspecção dinâmica de tipos)
- **1 prompt**: `dnd5e_guide` — guia detalhado com exemplos, sob demanda, com contexto player/dm/general
- **`instructions`** auto-injetado no system prompt do cliente (schema, Union types, filtros tipados)
- **Cache Redis** com stale-while-revalidate baseado em metadados
- **Dual transport**: Streamable HTTP + SSE (legado)
- **Rate limiting** por IP, CORS configurável, graceful shutdown
- **Docker Compose** com healthchecks em ambos os serviços

## Quick Start

### 1. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env se necessário (os defaults funcionam para deploy local)
```

### 2. Subir os containers

```bash
docker compose up --build -d
```

Aguardar ambos os serviços ficarem healthy:

```bash
docker compose ps
# NAME          STATUS                 PORTS
# mcp-mcp-1     Up (healthy)          0.0.0.0:3000->3000/tcp
# mcp-redis-1   Up (healthy)          6379/tcp
```

### 3. Verificar

```bash
curl http://localhost:3000/health
# {"status":"ok","redis":true,"activeSessions":0,"uptime":...}
```

### Rebuild completo

```bash
docker compose down
docker compose up --force-recreate --build --remove-orphans -d
```

## Configuração de Clientes MCP

### Claude Desktop

Adicionar ao `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "dnd-5e": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Reiniciar o Claude Desktop após salvar.

### Produção

```json
{
  "mcpServers": {
    "dnd-5e": {
      "url": "https://mcp.dnd.carromeu.com/mcp"
    }
  }
}
```

## Variáveis de Ambiente

| Variável | Default | Descrição |
|----------|---------|-----------|
| `PORT` | `3000` | Porta do servidor |
| `NODE_ENV` | `production` | Ambiente |
| `GRAPHQL_ENDPOINT` | `https://www.dnd5eapi.co/graphql` | URL do upstream GraphQL |
| `UPSTREAM_TIMEOUT` | `30000` | Timeout upstream (ms) |
| `REDIS_URL` | `redis://redis:6379` | URL de conexão Redis |
| `CACHE_TTL` | `3600` | Staleness do cache (segundos) |
| `RATE_LIMIT_WINDOW` | `60000` | Janela do rate limit (ms) |
| `RATE_LIMIT_MAX` | `60` | Requests por IP por janela |
| `MAX_SESSIONS` | `100` | Sessions concorrentes (HTTP + SSE) |
| `SESSION_IDLE_TTL` | `1800000` | TTL de inatividade (ms) |
| `MAX_RESPONSE_SIZE` | `102400` | Tamanho máximo de resposta (bytes) |
| `CORS_ORIGIN` | `*` | Origens permitidas para CORS |

## Desenvolvimento Local

Sem Docker (requer Redis rodando separadamente):

```bash
npm install
npm run dev     # tsx com hot reload
```

Build e execução:

```bash
npm run build
npm start
```

## Endpoints

| Método | Path | Descrição |
|--------|------|-----------|
| `POST` | `/mcp` | Streamable HTTP — init + requests |
| `GET` | `/mcp` | Streamable HTTP — SSE streaming |
| `DELETE` | `/mcp` | Streamable HTTP — encerrar session |
| `GET` | `/sse` | SSE legado — estabelecer conexão |
| `POST` | `/messages` | SSE legado — enviar mensagens |
| `GET` | `/health` | Health check (sem rate limiting) |

## Arquitetura

Para detalhes técnicos completos sobre a arquitetura, decisões de design e stack tecnológico, consulte [docs/tech-spec.md](docs/tech-spec.md).

## Tech Stack

- **Runtime**: Node.js 22 LTS (Alpine) + TypeScript 5.x
- **MCP SDK**: `@modelcontextprotocol/sdk` 1.27.x
- **HTTP**: Express 5.x
- **GraphQL**: `graphql-request` 7.x com `rawRequest()` + `errorPolicy: 'all'`
- **Cache**: Redis 7 (Alpine) via `ioredis` 5.x
- **Infra**: Docker multi-stage build + Docker Compose

## Licença

MIT
