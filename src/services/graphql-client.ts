import { GraphQLClient, ClientError } from 'graphql-request';
import { config } from '../config.js';
import { cacheGet, cacheSet, isFresh, hashKey, type CacheEntry } from './redis-client.js';

const client = new GraphQLClient(config.GRAPHQL_ENDPOINT, {
  errorPolicy: 'all',
});

interface TypeRef {
  name?: string;
  kind: string;
  ofType?: TypeRef;
}

export interface IntrospectionResult {
  __type: {
    name: string;
    kind: string;
    description?: string;
    fields?: Array<{
      name: string;
      description?: string;
      type: TypeRef;
    }>;
    inputFields?: Array<{
      name: string;
      description?: string;
      type: { name?: string; kind: string };
    }>;
    enumValues?: Array<{ name: string; description?: string }>;
  } | null;
}

export interface RootQueryFieldsResult {
  __schema: {
    queryType: {
      fields: Array<{
        name: string;
        description?: string;
        type: { name?: string; kind: string };
      }>;
    };
  };
}

export async function executeQuery(
  query: string,
  variables?: Record<string, unknown>,
  sessionId?: string,
): Promise<{ data: unknown; errors?: unknown[]; stale?: boolean }> {
  const key = hashKey(query, variables);
  const keyShort = key.slice(0, 8);
  const start = Date.now();

  const cached = await cacheGet(key);
  let staleEntry: CacheEntry | null = null;

  if (cached) {
    if (isFresh(cached)) {
      console.log(`[graphql] session=${sessionId ?? 'none'} hash=${keyShort} cache=hit time=${Date.now() - start}ms`);
      return { data: cached.data };
    }
    staleEntry = cached;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.UPSTREAM_TIMEOUT);

    try {
      const response = await client.rawRequest({
        query,
        variables,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      const data = response.data;
      const errors = response.errors as unknown[] | undefined;

      if (data !== null && data !== undefined) {
        cacheSet(key, { data, fetchedAt: Date.now() }).catch((err) =>
          console.warn('[cache] Write failed:', (err as Error).message),
        );
      }

      console.log(`[graphql] session=${sessionId ?? 'none'} hash=${keyShort} cache=miss time=${Date.now() - start}ms`);
      return { data, ...(errors ? { errors } : {}) };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if (err instanceof ClientError && err.response) {
      const { data, errors } = err.response;

      if (data !== null && data !== undefined) {
        cacheSet(key, { data, fetchedAt: Date.now() }).catch((e) =>
          console.warn('[cache] Write failed:', (e as Error).message),
        );
        console.log(
          `[graphql] session=${sessionId ?? 'none'} hash=${keyShort} cache=miss time=${Date.now() - start}ms`,
        );
        return { data, ...(errors ? { errors: errors as unknown[] } : {}) };
      }

      if (errors) {
        return { data: null, errors: errors as unknown[] };
      }
    }

    if (staleEntry) {
      console.warn('[upstream] Failed, serving stale cache');
      console.log(
        `[graphql] session=${sessionId ?? 'none'} hash=${keyShort} cache=stale time=${Date.now() - start}ms`,
      );
      return { data: staleEntry.data, stale: true };
    }

    throw err;
  }
}

export async function executeIntrospection(typeName: string, sessionId?: string): Promise<IntrospectionResult> {
  const query = `query IntrospectType($name: String!) {
    __type(name: $name) {
      name
      kind
      description
      fields {
        name
        description
        type {
          name
          kind
          ofType {
            name
            kind
            ofType {
              name
              kind
              ofType {
                name
                kind
              }
            }
          }
        }
      }
      inputFields {
        name
        description
        type {
          name
          kind
        }
      }
      enumValues {
        name
        description
      }
    }
  }`;
  const result = await executeQuery(query, { name: typeName }, sessionId);
  return result.data as IntrospectionResult;
}

export async function executeRootQueryFields(sessionId?: string): Promise<RootQueryFieldsResult> {
  const query = `{
    __schema {
      queryType {
        fields {
          name
          description
          type {
            name
            kind
          }
        }
      }
    }
  }`;
  const result = await executeQuery(query, undefined, sessionId);
  return result.data as RootQueryFieldsResult;
}
