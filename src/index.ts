import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from './config.js';
import { createMcpServer, version } from './server.js';
import { isRedisHealthy, closeRedis } from './services/redis-client.js';

interface Session {
  transport: StreamableHTTPServerTransport | SSEServerTransport;
  server: McpServer;
  lastActivity: number;
  type: 'http' | 'sse';
}

const sessions = new Map<string, Session>();

// Sanitize session IDs for logging (prevent log injection)
function sanitizeId(id: string): string {
  return id.replace(/[^\w-]/g, '').slice(0, 64);
}

const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '16kb' }));
app.use(
  cors({
    origin: config.CORS_ORIGIN,
    allowedHeaders: ['Content-Type', 'Accept', 'mcp-session-id'],
    exposedHeaders: ['mcp-session-id'],
  }),
);

// Health check — registered BEFORE rate limiting
app.get('/health', async (_req, res) => {
  const redisOk = await isRedisHealthy();
  res.json({
    status: redisOk ? 'ok' : 'degraded',
    redis: redisOk,
    activeSessions: sessions.size,
    uptime: process.uptime(),
  });
});

// Rate limiting — shared instance, excludes /health
const rateLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW,
  max: config.RATE_LIMIT_MAX,
  message: 'Too many requests, please try again later',
});
app.use('/mcp', rateLimiter);
app.use('/sse', rateLimiter);
app.use('/messages', rateLimiter);

// --- Streamable HTTP ---
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res, req.body);
    return;
  }

  if (!sessionId && isInitializeRequest(req.body)) {
    if (sessions.size >= config.MAX_SESSIONS) {
      res.status(503).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Too many active sessions' },
        id: null,
      });
      return;
    }

    const server = createMcpServer();
    let registeredSessionId: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        registeredSessionId = sessionId;
        sessions.set(sessionId, {
          transport,
          server,
          lastActivity: Date.now(),
          type: 'http',
        });
        console.log(`[session] Created type=http id=${sanitizeId(sessionId)} total=${sessions.size}`);
      },
    });

    transport.onclose = () => {
      if (registeredSessionId) {
        sessions.delete(registeredSessionId);
        console.log(`[session] Closed id=${sanitizeId(registeredSessionId)} total=${sessions.size}`);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Invalid session' },
    id: null,
  });
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    session.lastActivity = Date.now();
    await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res);
    return;
  }
  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Invalid session' },
    id: null,
  });
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res);
    return;
  }
  res.status(400).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Invalid session' },
    id: null,
  });
});

// --- SSE fallback (legacy) ---
app.get('/sse', async (req, res) => {
  if (sessions.size >= config.MAX_SESSIONS) {
    res.status(503).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Too many active sessions' },
      id: null,
    });
    return;
  }

  const transport = new SSEServerTransport('/messages', res);
  const server = createMcpServer();
  const sseId = transport.sessionId;

  sessions.set(sseId, {
    transport,
    server,
    lastActivity: Date.now(),
    type: 'sse',
  });
  console.log(`[session] Created type=sse id=${sanitizeId(sseId)} total=${sessions.size}`);

  transport.onclose = () => {
    sessions.delete(sseId);
    console.log(`[session] Closed id=${sanitizeId(sseId)} total=${sessions.size}`);
  };

  res.on('close', () => {
    sessions.delete(sseId);
  });

  await server.connect(transport);
});

app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Invalid session' },
      id: null,
    });
    return;
  }

  const session = sessions.get(sessionId)!;
  session.lastActivity = Date.now();
  await (session.transport as SSEServerTransport).handlePostMessage(req, res, req.body);
});

// --- Session cleanup ---
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  const toClean: string[] = [];
  for (const [id, session] of sessions) {
    if (now - session.lastActivity > config.SESSION_IDLE_TTL) {
      toClean.push(id);
    }
  }
  for (const id of toClean) {
    // Re-check — a request may have updated lastActivity between collection and close
    const current = sessions.get(id);
    if (current && now - current.lastActivity > config.SESSION_IDLE_TTL) {
      sessions.delete(id);
      current.transport.close().catch((err) =>
        console.warn(`[sessions] Close error for id=${sanitizeId(id)}:`, (err as Error).message),
      );
    }
  }
  if (toClean.length > 0) {
    console.log(`[sessions] Cleaned idle sessions, ${sessions.size} active remaining`);
  }
}, 60_000);

// --- Graceful shutdown ---
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[shutdown] ${signal} received, draining...`);

  const forceTimer = setTimeout(() => {
    console.error('[shutdown] Forced exit after 5s');
    process.exit(1);
  }, 5000);
  forceTimer.unref();

  clearInterval(cleanupInterval);
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));

  await Promise.all(
    [...sessions.values()].map((s) =>
      s.transport.close().catch((err) => console.warn('[shutdown] Transport close error:', (err as Error).message)),
    ),
  );

  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// --- Start ---
const httpServer = app.listen(config.PORT, () => {
  console.log(`[server] DnD 5e MCP Server v${version} listening on port ${config.PORT}`);
  console.log(`[server] NODE_ENV=${config.NODE_ENV}`);
  console.log(`[server] GraphQL upstream: ${config.GRAPHQL_ENDPOINT}`);
  console.log(`[server] Redis: ${config.REDIS_URL}`);
  console.log(`[server] Rate limit: ${config.RATE_LIMIT_MAX} req/${config.RATE_LIMIT_WINDOW}ms`);
  console.log(`[server] Max sessions: ${config.MAX_SESSIONS}`);
});
