// Wires auth + routing + error handling around a plain node:http server.
// Exported separately from index.ts so tests can start it in-process on an
// ephemeral port without touching env vars or the real db file.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HttpError, sendError } from './http.ts';
import { isAuthorized } from './auth.ts';
import { dispatch, isHealthCheck } from './router.ts';
import type { PerfectFitDb } from './db.ts';

export interface ServerOptions {
  db: PerfectFitDb;
  /** Bearer token required for all routes except /api/v1/health. Unset/empty disables auth. */
  apiToken?: string;
}

export function createServer({ db, apiToken }: ServerOptions): Server {
  return createHttpServer((req, res) => {
    // A single request's failure must never take the process down.
    void handleRequest(req, res, db, apiToken).catch((err) => {
      // The request/response streams may already be half-consumed at this
      // point; guard against writing headers twice.
      if (!res.headersSent) {
        console.error('Unhandled server error:', err);
        sendError(res, 500, 'Internal server error');
      } else {
        res.destroy();
      }
    });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: PerfectFitDb,
  apiToken: string | undefined
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (apiToken && !isHealthCheck(req.method, url.pathname)) {
    if (!isAuthorized(req, apiToken)) {
      sendError(res, 401, 'Unauthorized');
      return;
    }
  }

  try {
    await dispatch(req, res, db);
  } catch (err) {
    if (err instanceof HttpError) {
      sendError(res, err.status, err.message);
      return;
    }
    throw err;
  }
}
