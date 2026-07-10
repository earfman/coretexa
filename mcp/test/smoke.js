// smoke.js — runs the ENTIRE protocol lifecycle against an in-memory Postgres.
// No network, no real DB needed:  cd mcp && npm install && npm test
//
// What it proves, in order:
//   1. schema.sql applies clean
//   2. cut -> claim -> done -> verify(pass) closes with a stamp
//   3. NO-SELF-CLOSE: the doer's verify attempt is REFUSED
//   4. verify(fail) leaves parent at done + auto-cuts a linked CORRECTION
//   5. the system files a REGRESSION with escalated priority
//   6. lineage/spawn-depth reports the tree and settled=false while open
//   7. illegal transitions are refused

import { newDb } from 'pg-mem';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { QueueDB } from '../src/db.js';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
};
const shouldThrow = async (name, fn, needle) => {
  try { await fn(); failed++; console.log(`  ✗ ${name} (no error thrown)`); }
  catch (e) {
    const hit = !needle || String(e.message).toLowerCase().includes(needle.toLowerCase());
    if (hit) { passed++; console.log(`  ✓ ${name}`); }
    else { failed++; console.log(`  ✗ ${name} (wrong error: ${e.message})`); }
  }
};

// ---- boot an in-memory postgres and apply the real schema ----
const mem = newDb();
mem.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', implementation: () => crypto.randomUUID(), impure: true });
const schema = readFileSync(join(here, '..', '..', 'schema.sql'), 'utf8');
// pg-mem doesn't support CREATE VIEW with recursive CTEs — apply the table part only.
const tablePart = schema.split('-- ============================================================\n-- Lineage views')[0];
mem.public.none(tablePart);
console.log('\nschema.sql (table + indexes) applied to in-memory postgres');

const { Pool } = mem.adapters.createPg();
const db = new QueueDB(new Pool());

console.log('\n— happy path —');
const t1 = await db.cutTicket({ title: 'Add a settings page', body: 'SCOPE: ...\nDONE WHEN: page renders', area: 'apps', priority: 2 });
ok('cut_ticket creates pending', t1.status === 'pending' && t1.origin === 'manual');

const next = await db.nextTicket();
ok('next_ticket returns FIFO/priority pick', next.id === t1.id);

await db.claim(t1.id, 'doer-A');
const claimed = await db.getTicket(t1.id);
ok('claim records actor', claimed.status === 'claimed' && claimed.claimed_by === 'doer-A');

await shouldThrow('mark_done without a result is refused', () => db.markDone(t1.id, 'doer-A', '  '), 'result');
await db.markDone(t1.id, 'doer-A', 'Built settings page. Tested: opened it, saved a value. Deferred: dark mode (cut no ticket — trivial).');

console.log('\n— THE RULE: no self-close —');
await shouldThrow('doer-A cannot verify its own ticket', () => db.verify(t1.id, 'doer-A', true, 'looks good'), 'NO-SELF-CLOSE');

const v1 = await db.verify(t1.id, 'verifier-B', true, 'Gate 1: opened page, renders.\nGate 2: adjacent nav still works.\nGate 3: consistent.\nGate 4: dark-mode deferral is flagged.');
ok('different actor closes it', v1.closed?.status === 'closed' && v1.closed.verified_by === 'verifier-B');
ok('verification stamp appended to result', v1.closed.result.includes('VERIFIED') && v1.closed.result.includes('verifier-B'));

console.log('\n— failed verification -> correction with lineage —');
const t2 = await db.cutTicket({ title: 'Fix login redirect', area: 'auth', priority: 1 });
await db.claim(t2.id, 'doer-A');
await db.markDone(t2.id, 'doer-A', 'Fixed redirect. Tested: logged in once.');
const v2 = await db.verify(t2.id, 'verifier-B', false, 'CLAIMED: fixed.\nOBSERVED: redirect loops on Safari.\nGAP: only tested Chrome.\nFIX: handle Safari ITP case.');
const parent2 = await db.getTicket(t2.id);
ok('parent STAYS at done (work record preserved)', parent2.status === 'done');
ok('correction cut + linked', v2.correction?.origin === 'correction' && v2.correction.parent_id === t2.id);
ok('correction inherits priority', v2.correction.priority === 1);

console.log('\n— regression auto-cut by the SYSTEM —');
const reg = await db.cutRegression(t2.id, 'signup flow now 500s (passed before the redirect fix)');
ok('regression linked to parent', reg.parent_id === t2.id && reg.origin === 'regression');
ok('regression escalates priority (1 stays 1, floor)', reg.priority === 1);

console.log('\n— lineage / spawn depth —');
const lin = await db.lineage(t2.id);
ok('tree walks: parent + correction + regression', lin.descendants === 2);
ok('spawn depth computed', lin.max_depth === 1);
ok('NOT settled while descendants open', lin.settled === false);

console.log('\n— blocked is visible —');
const t3 = await db.cutTicket({ title: 'Choose auth provider', area: 'auth' });
await db.claim(t3.id, 'doer-A');
await db.block(t3.id, 'Google OAuth or magic-link only? Cost vs. friction tradeoff needs the human.');
const b = await db.getTicket(t3.id);
ok('blocked with the exact question in body', b.status === 'blocked' && b.body.includes('BLOCKED:'));
await db.unblock(t3.id, 'Google OAuth. Burt 2026-07-10.');
const ub = await db.getTicket(t3.id);
ok('decision recorded, back to pending', ub.status === 'pending' && ub.body.includes('DECIDED'));

console.log('\n— evidence contracts (v0.2) —');
const t4 = await db.cutTicket({
  title: 'Fix ANY(uuid[]) match', area: 'engine', priority: 2,
  acceptance: ['col = ANY($1::uuid[]) matches rows that col = $1 matches'],
  required_checks: ['tests', 'repro'],
});
ok('cut_ticket stores contract', !!t4.required_checks && !!t4.acceptance);
await db.claim(t4.id, 'doer-A');
await shouldThrow('mark_done refused: required checks but no evidence', () => db.markDone(t4.id, 'doer-A', 'fixed it, trust me'), 'submit_evidence');
await shouldThrow('evidence entries validated', () => db.submitEvidence(t4.id, 'doer-A', [{ check: 'tests', result: 'maybe' }]), "pass' or 'fail");
await db.submitEvidence(t4.id, 'doer-A', [
  { check: 'tests', result: 'pass', command: 'npm test', detail: '19 passed, 0 failed' },
]);
await db.markDone(t4.id, 'doer-A', 'Fixed array matching. Tested: full suite. Repro pending verifier run.');
await shouldThrow('verify refused: repro check has no passing evidence', () => db.verify(t4.id, 'verifier-B', true, 'looks complete'), 'EVIDENCE REQUIRED');
await db.submitEvidence(t4.id, 'verifier-B', [
  { check: 'repro', result: 'pass', command: 'node repro.js', detail: 'previously-failing query now returns 1 row' },
]);
const v4 = await db.verify(t4.id, 'verifier-B', true, 'Gate 1: repro passes.\nGate 2: suite green.\nGate 3: consistent.\nGate 4: complete.');
ok('verify closes once every required check has passing evidence', v4.closed?.status === 'closed');

console.log('\n— gate report —');
const report = await db.gateReport(t4.id);
ok('report has title + short id', report.includes('Coretexa gate report'));
ok('report shows evidence table', report.includes('| `tests` | ✓ pass |'));
ok('report shows verification stamp', report.includes('VERIFIED') || report.includes('different actor'));
ok('report has the footer line', report.includes('claimer ≠ verifier') && report.includes('coretexa.dev'));
const pendingReport = await db.gateReport(t2.id); // t2 is still at done (failed verify earlier)
ok('unverified ticket reports honestly', pendingReport.includes('NOT yet been verified'));

console.log('\n— illegal transitions refused —');
await shouldThrow('cannot claim a closed ticket', () => db.claim(t1.id, 'doer-A'), 'Illegal transition');
await shouldThrow('cannot verify a pending ticket', () => db.verify(t3.id, 'verifier-B', true, 'n/a'), "Only 'done'");

const stats = await db.stats();
console.log('\nqueue_stats:', JSON.stringify(stats));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
