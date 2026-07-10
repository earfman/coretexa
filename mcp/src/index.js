#!/usr/bin/env node
// Coretexa reference MCP server.
// One env var to point at your Postgres, one to say who you are:
//   DATABASE_URL=postgres://...          (Supabase free tier works fine)
//   CORETEXA_ACTOR=claude-code-mac       (this session's identity)
//
// The actor id is how no-self-close is enforced: run your doer and your
// verifier as DIFFERENT actors (different sessions/agents), and the server
// will mechanically refuse a verify where verifier === doer.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import pg from 'pg';
import { QueueDB } from './db.js';

const ACTOR = process.env.CORETEXA_ACTOR;
if (!ACTOR) {
  console.error('CORETEXA_ACTOR is required (e.g. "claude-code-mac", "cursor-1", "verifier-a").');
  process.exit(1);
}

let db = null;
async function getDB() {
  if (db) return db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Point it at any Postgres with schema.sql applied.');
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  db = new QueueDB(pool);
  return db;
}

const server = new McpServer({ name: 'coretexa', version: '0.1.0' });

const asText = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const asError = (e) => ({ content: [{ type: 'text', text: `ERROR: ${e.message}` }], isError: true });

server.tool(
  'next_ticket',
  'Get the next pending ticket to work (lowest priority number, oldest first; PARKED rows skipped).',
  {},
  async () => {
    try {
      const t = await (await getDB()).nextTicket();
      return asText(t ?? { queue: 'clear', message: 'No pending tickets.' });
    } catch (e) { return asError(e); }
  }
);

server.tool(
  'list_tickets',
  'List tickets. Optionally filter by status (pending|claimed|done|verified|closed|blocked). Default: all non-closed.',
  { status: z.string().optional() },
  async ({ status }) => {
    try { return asText(await (await getDB()).listTickets(status)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'cut_ticket',
  'Create a new ticket. Body should contain SCOPE and DONE WHEN. Use parent_id + origin="spawned" for problems discovered mid-work (Rule A).',
  {
    title: z.string(),
    body: z.string().optional(),
    area: z.string().optional(),
    priority: z.number().int().min(1).max(9).optional(),
    parent_id: z.string().uuid().optional(),
    origin: z.enum(['manual', 'spawned']).optional(),
    acceptance: z.array(z.string()).optional(),
    required_checks: z.array(z.string()).optional(),
  },
  async (args) => {
    try { return asText(await (await getDB()).cutTicket(args)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'claim_ticket',
  `Claim a pending ticket as this actor ("${ACTOR}"). You will NOT be able to verify/close what you claim.`,
  { id: z.string().uuid() },
  async ({ id }) => {
    try { return asText(await (await getDB()).claim(id, ACTOR)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'mark_done',
  'Mark a claimed ticket done (NOT closed). result must say: what changed by name, how you tested it, what you deferred. A different actor closes it.',
  { id: z.string().uuid(), result: z.string() },
  async ({ id, result }) => {
    try { return asText(await (await getDB()).markDone(id, ACTOR, result)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'verify_ticket',
  'Run gate 5: close a done ticket (pass=true) or fail it (pass=false → linked correction ticket is cut automatically). REFUSES if you are the actor who claimed it.',
  { id: z.string().uuid(), pass: z.boolean(), notes: z.string() },
  async ({ id, pass, notes }) => {
    try { return asText(await (await getDB()).verify(id, ACTOR, pass, notes)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'next_done_ticket',
  'Get the oldest done ticket awaiting verification (FIFO).',
  {},
  async () => {
    try {
      const t = await (await getDB()).nextDoneTicket();
      return asText(t ?? { queue: 'clear', message: 'Nothing awaiting verification.' });
    } catch (e) { return asError(e); }
  }
);

server.tool(
  'block_ticket',
  'Mark a ticket blocked on a human decision. question must state the EXACT decision needed. Never guess the human\'s answer.',
  { id: z.string().uuid(), question: z.string() },
  async ({ id, question }) => {
    try { return asText(await (await getDB()).block(id, question)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'unblock_ticket',
  'Record the human decision on a blocked ticket and return it to pending.',
  { id: z.string().uuid(), decision: z.string() },
  async ({ id, decision }) => {
    try { return asText(await (await getDB()).unblock(id, decision)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'cut_regression',
  'SYSTEM tool: file a regression ticket against a parent (something that passed before now fails). Escalates priority by one. Origin=regression, lineage linked.',
  { parent_id: z.string().uuid(), what_broke: z.string() },
  async ({ parent_id, what_broke }) => {
    try { return asText(await (await getDB()).cutRegression(parent_id, what_broke)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'ticket_lineage',
  'Walk a ticket\'s lineage tree: descendants, spawn depth, open descendants, settled or not.',
  { id: z.string().uuid() },
  async ({ id }) => {
    try { return asText(await (await getDB()).lineage(id)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'submit_evidence',
  'Attach executable evidence to a claimed/done ticket: test runs, builds, repros. Each entry: {check, result: "pass"|"fail", command?, detail?}. Verification cannot close a ticket whose required checks lack passing evidence.',
  {
    id: z.string().uuid(),
    entries: z.array(
      z.object({
        check: z.string(),
        result: z.enum(['pass', 'fail']),
        command: z.string().optional(),
        detail: z.string().optional(),
      })
    ),
  },
  async ({ id, entries }) => {
    try { return asText(await (await getDB()).submitEvidence(id, ACTOR, entries)); }
    catch (e) { return asError(e); }
  }
);

server.tool(
  'gate_report',
  'Render the gate report for a ticket as markdown — the receipt pasted into a PR or issue. Shows acceptance criteria, evidence table, verification stamp (or an honest "pending verification").',
  { id: z.string().uuid() },
  async ({ id }) => {
    try {
      const md = await (await getDB()).gateReport(id);
      return { content: [{ type: 'text', text: md }] };
    } catch (e) { return asError(e); }
  }
);

server.tool(
  'queue_stats',
  'Counts by status and by origin (manual/spawned/correction/regression).',
  {},
  async () => {
    try { return asText(await (await getDB()).stats()); }
    catch (e) { return asError(e); }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`coretexa-mcp up · actor="${ACTOR}" · waiting for a client...`);
