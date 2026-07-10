# Coretexa

**The accountability queue for AI-done work.**

AI agents will happily do 80% of a task and declare victory. Coretexa is the
protocol that catches the other 20%: work an agent **cannot close itself**, a
second agent that verifies against **ground truth**, and regressions that
**file their own follow-up tickets**.

> Built by one person actually living with AI agents doing real work —
> 100 tickets in, a third of them auto-spawned by other tickets, 75 verified
> by a second set of eyes. This isn't a framework looking for a user.
> It's a working habit, extracted.

---

## The problem

You hand work to an AI agent. It writes the code, edits the files, updates the
database — and tells you it's done. Three questions nobody in the loop is
answering:

1. **Did it actually do what was asked** — or what it *decided* was asked?
2. **Did it break something else on the way** — and would anyone notice?
3. **Who checked?** (If the answer is "the same agent that did the work,"
   that's not a check. That's a vibe.)

CI catches what your tests already know to look for. Code review catches what
a busy human happens to see. Neither was designed for a world where the
*worker* is a tireless agent that produces plausible-looking work at machine
speed. Capability is racing ahead; accountability hasn't kept up.

## The protocol

Coretexa is deliberately boring infrastructure: **one table, one lifecycle,
five gates, three rules.** Any agent that can read a row can participate.

### The lifecycle

```
pending ──claim──▶ claimed ──work──▶ done ──second set of eyes──▶ verified ──▶ closed
   ▲                                                                    
   └────────── decision recorded ─────── blocked ◀── needs a human decision
```

- **pending** — any agent may claim it
- **claimed** — an agent owns it and is working
- **done** — the doer *believes* it's complete. **Not closed.**
- **verified → closed** — a second agent checked it against reality
- **blocked** — waiting on a human decision, stated explicitly. Visible,
  never silently skipped.

### The five gates (definition of done)

1. **Does it do what the ticket asked?** Check the artifact, not the agent's
   summary.
2. **Did it break anything that worked?** Sweep the blast radius.
3. **Is it self-consistent?** No new contradictions with docs or sibling work.
4. **Is it actually finished — or just the easy 80%?** Surface the "wait,
   but…" question and confirm it's answered in the work.
5. **Did a SECOND set of eyes confirm 1–4 against reality?** The doer's
   report is a claim, not proof.

### The three rules

- **No self-close.** The doer may mark `done`; only a *different* agent may
  close. The one check the protocol exists for can't be skipped by an eager
  agent declaring victory.
- **Issues spawn issues.** Any problem discovered mid-work becomes its own
  ticket, linked to its parent. A row resurfaces in the next scan; a buried
  note never does.
- **Blocked is visible.** "Waiting on a human" is a first-class status with
  the exact decision needed written down — not a silent stall.

### The two extensions that fall out of lineage

Because every spawned ticket carries `parent_id`, you get two things almost
no tooling has:

- **Auto-cut on regression.** Snapshot what passed before a change; re-run
  after. Anything that *passed then and fails now* files its own correction
  ticket — cut by the system, not by the agent that caused it.
- **Spawn depth.** How many generations of fix-broke-something did a change
  take to settle? High spawn depth = a fragile area of your codebase,
  measured for free. Nobody else has this number because nobody else keeps
  the lineage.

## What's in this repo

```
schema.sql            the whole data model — one table + parent_id lineage
QUEUE-PROTOCOL.md     the protocol, normatively stated (this page, longer)
commands/
  work-queue.md       the DOER procedure (drop into .claude/commands/)
  verify-queue.md     the VERIFIER procedure (a different session/agent runs this)
mcp/                  reference MCP server (14 tools — see mcp/README.md)
```

Works today with **Claude Code** and any agent that can run SQL and follow a
procedure. The MCP server makes it one-line for **any** MCP-speaking agent
(Cursor, Windsurf, custom runtimes) — setup in `mcp/README.md`.

## Quick start (self-hosted, free forever)

1. Create the table: run `schema.sql` against any Postgres (Supabase free
   tier works fine).
2. Drop `commands/work-queue.md` and `commands/verify-queue.md` into your
   agent setup (for Claude Code: `.claude/commands/`).
3. Cut your first ticket (a row: `title`, `body` with SCOPE + DONE-WHEN,
   `priority`).
4. In one session: `/work-queue` — the agent claims it, works it, marks done.
5. In a **different** session: `/verify-queue` — a second agent runs the five
   gates against your actual repo and DB, then closes it or cuts a correction.

That's the whole loop. No service, no account, no telemetry.

## The verification contract

Two actor ids are necessary, not sufficient — two agents can share the same
blind spots. So tickets can declare **acceptance criteria** and
**required checks** (`build`, `tests`, `repro`), and actors attach
**executable evidence** per check. The server refuses `done` without evidence
and refuses to close while any required check lacks a passing result — no
matter who's verifying. Every ticket renders a **gate report**
(`docs/GATE-REPORT-EXAMPLE.md`) — the receipt you paste into a PR: criteria,
evidence table, verification stamp, and an honest "pending" when unverified.

## Roadmap

- [x] **Reference MCP server** — shipped in `mcp/`: 14 tools, no-self-close
      enforced by actor id, evidence contracts, gate reports, 29-test suite
- [ ] **GitHub Action (public repos, free)** — five gates as a PR check;
      a verification agent that is never the PR's author; regression auto-cut
      files Issues with lineage
- [ ] **GitHub App (private repos) + Coretexa Cloud** — hosted queue,
      team dashboard, org-wide view, spawn-depth analytics. This is the paid
      product that funds the open one. The protocol, schema, and reference
      implementation stay MIT forever; the line will not move.

## Contributing

PRs welcome — and yes, they go through the queue. Your fix gets a ticket, a
verification pass it didn't write, and a lineage row if it breaks something.
The contribution process *is* the product demo.

## License

MIT. The protocol belongs to everyone; accountability shouldn't have a vendor.

---

**Coretexa** · coretexa.dev · *Work you can trust, from workers that never sleep.*
