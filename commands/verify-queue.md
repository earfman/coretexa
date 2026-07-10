---
description: Verify done tickets against the five gates and close passing rows (VERIFIER procedure).
---

You are the VERIFIER on a Coretexa queue. You did NOT do this work — a
different actor shipped it under `work-queue`. Your job is to check the work
against **ground truth**, never against the doer's prose summary.

The whole point of gate 5: **the doer cannot grade its own homework.** If you
worked any of these tickets yourself, skip them — the MCP server will refuse
your close anyway (`verified_by` must differ from `claimed_by`).

Read `QUEUE-PROTOCOL.md` first if you haven't this session.

## 1. Pick a ticket

Via MCP: `next_done_ticket`. Via SQL:

```sql
SELECT id, title, body, result, claimed_by FROM tickets
WHERE status = 'done'
ORDER BY done_at ASC;   -- FIFO so nothing rots
```

## 2. Run the five gates against REAL state

For each gate, inspect the actual thing:

1. **Did it do what the ticket asked?** Re-read the original `body`, then go
   look: "add column X" → query the schema; "delete file Y" → list the
   directory; "build feature Z" → open it and use it; "update docs" → read
   the current file at the actual lines, not the doer's diff snippet.
2. **Did it break anything that worked?** Sweep the blast radius: run the
   checks that passed before the change (tests, linters, audits, a parse
   check on any embedded/generated code the ticket touched). Anything that
   passed before and fails now = fail this gate.
3. **Is it self-consistent?** Read the surrounding section/module, not just
   the diff. Check recent sibling tickets in the same `area` for
   contradictions.
4. **Easy 80% or actually finished?** Ask the obvious "wait, but…" yourself.
   Addressed in the work, or explicitly flagged with a follow-up ticket cut →
   pass. Silent hard-half → fail.
5. **You ARE gate 5.**

## 3. Decide

### Passes all five — close it

Via MCP: `verify_ticket(id, pass=true, notes=...)`. The stamp appended to
`result` MUST record what you actually checked, one line per gate:

```
--- VERIFIED <date> by <actor> ---
Gate 1: <what you read/queried>
Gate 2: <what you re-ran / spot-checked>
Gate 3: <what surrounding state you reviewed>
Gate 4: <the wait-but question and where it's answered>
```

### Fails any gate — correction, never a silent re-open

Via MCP: `verify_ticket(id, pass=false, notes=...)` — the server cuts the
correction ticket for you, linked via `parent_id`, `origin='correction'`,
priority matching the parent. The correction body states:

```
CLAIMED: <what the doer's result said>
OBSERVED: <what you actually observed>
GAP: <what is missing or wrong>
FIX: <what needs to happen, concretely>
```

The original ticket STAYS at `done` — it is the record of work that shipped.
Do NOT set it back to pending or claimed; that erases history.

## 4. Continue or stop

FIFO through the remaining `done` rows. Then report: how many closed, how
many corrections cut (with ids), and anything that looked off but didn't
warrant a correction (style nits go in the report, not the queue).
