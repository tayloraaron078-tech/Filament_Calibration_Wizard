// Entry point for the opt-in self-hosted persistence server. Standalone Node
// script — no build step, Node 24 strips types natively (`node server/index.ts`).
//
// FORGE-NOTE: PERFECTFIT_PORT default (8787) is arbitrary — wiring this into
// the Docker image's CMD/EXPOSE is a later phase, not this one.
import { createServer } from './createServer.ts';
import { openDatabase } from './db.ts';

const dbPath = process.env.PERFECTFIT_DB_PATH || './perfectfit.sqlite3';
const port = Number(process.env.PERFECTFIT_PORT) || 8787;
const apiToken = process.env.PERFECTFIT_API_TOKEN || undefined;

const db = openDatabase(dbPath);
const server = createServer({ db, apiToken });

server.listen(port, () => {
  console.log(`PerfectFit server listening on port ${port} (db: ${dbPath}, auth: ${apiToken ? 'on' : 'off'})`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
