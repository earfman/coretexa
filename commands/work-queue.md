---
description: Work the next pending ticket in the Coretexa queue (DOER procedure).
---

You are the DOER on a Coretexa queue. Follow this procedure exactly — the
procedure is itself one of the things the queue protects.

Read `QUEUE-PROTOCOL.md` first if you haven't this session (~90 seconds).

## 0. Identify yourself

You act under an actor id (your session/agent name — e.g. `claude-code-mac`,
`cursor-1`). If you're using the Coretexa MCP server it manages this for you
(`CORETEXA_ACTOR` env). You will NOT be able to close what you claim — that's
by design, not a bug.

## 1. Pick a ticket

Via MCP: call `next_ticket`.
Via SQL:

```sql
SELECT id, title, area, priority, body FROM tickets
WHERE status = 'pending'
ORDER BY priority ASC, created_at ASC
LIMIT 1;
```

**SKIP** any row whose title starts with `PARKED` — deliberately parked, do
not start. Skip rows routed to a different worker than you (the body will say
so). If nothing remains, stop and report the queue is clear.

## 2. Claim it

Via MCP: `claim_ticket(id)`. Via SQL: set `status='claimed'`,
`claimed_by='<your actor id>'`, `claimed_at=now()`.

## 3. Do the work — with the gates in mind as you go

1. **Does this do what the body actually asked?** Re-read it verbatim.
2. **Will it break anything that worked?** Check the blast radius as you
   touch it, not after.
3. **Is it self-consistent** with the governing docs and sibling tickets?
4. **Easy 80% or actually finished?** Surface your own "wait, but…" and
   answer it in the work or flag it explicitly.
5. *(Gate 5 belongs to the verifier — not you.)*

**Rule A — issues spawn issues.** Discover a NEW problem mid-work? Cut a new
ticket now — via MCP `cut_ticket(..., parent_id=<this ticket>, origin='spawned')`
— never a buried note in your result.

**Rule B — blocked is visible.** Need a human decision? `block_ticket(id,
"<the exact question>")` and move on to the next pending row. Never guess.

**Edit discipline.** Edits to canonical docs are surgical (targeted
replacements), never full-file pastes. Generated/embedded code gets a parse
check before it ships (`node --check` or equivalent) — a syntax error in an
embedded script fails silently at runtime, and there may be no CI behind you.

## 4. Mark done — you CANNOT close

Via MCP: `mark_done(id, result)`. Your `result` MUST include:

- What actually changed — files, rows, commits, by name.
- How you tested it — the specific check you ran, not "it works".
- What you deliberately deferred, and the ticket ids you cut for it.
- What the verifier should specifically look at.

The row stays at `done`. A DIFFERENT actor running `verify-queue` closes it.
If you try to verify your own ticket through the MCP server, it will refuse.

## 5. Continue or stop

Re-query for the next `pending` row and repeat. When only PARKED / blocked /
wrong-worker rows remain, STOP and report what's left and why. Don't loop
forever; don't escalate parked work; don't decide blocked tickets for the
human.
