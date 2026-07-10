# @coretexa/mcp — reference MCP server

Gives **any MCP-speaking agent** (Claude Code, Cursor, Windsurf, custom
runtimes) an accountability queue: work it can't close itself, verification
by a different actor, corrections and regressions filed with lineage.

## Setup

```bash
cd mcp && npm install
```

Apply `../schema.sql` to any Postgres (Supabase free tier works — paste it
into the SQL editor).

## Wiring it up (Claude Code example)

Two entries, two identities — that's how no-self-close is enforced:

```json
{
  "mcpServers": {
    "coretexa-doer": {
      "command": "node",
      "args": ["/path/to/coretexa/mcp/src/index.js"],
      "env": {
        "DATABASE_URL": "postgres://...",
        "CORETEXA_ACTOR": "doer-claude-code"
      }
    },
    "coretexa-verifier": {
      "command": "node",
      "args": ["/path/to/coretexa/mcp/src/index.js"],
      "env": {
        "DATABASE_URL": "postgres://...",
        "CORETEXA_ACTOR": "verifier-claude-chat"
      }
    }
  }
}
```

Typical split: your working session uses the doer server; a separate
session/agent (or your chat Claude) uses the verifier server. If the same
actor that claimed a ticket tries to `verify_ticket` it, the server refuses
with `NO-SELF-CLOSE`.

## Tools

| Tool | What it does |
|---|---|
| `next_ticket` | Next pending row (priority asc, FIFO; PARKED skipped) |
| `list_tickets` | List by status, or all non-closed |
| `cut_ticket` | New ticket; `parent_id`+`origin='spawned'` for Rule A finds |
| `claim_ticket` | Claim as this actor |
| `mark_done` | Done ≠ closed; requires a real result writeup |
| `next_done_ticket` | Oldest row awaiting verification |
| `verify_ticket` | Pass → close + stamp. Fail → linked correction. **Refuses self-close.** |
| `block_ticket` / `unblock_ticket` | Human-decision states, question/decision recorded |
| `cut_regression` | SYSTEM files "passed before, fails now" with escalated priority |
| `submit_evidence` | Attach executable proof per check (`{check, result, command, detail}`) |
| `gate_report` | Render the PR-ready markdown receipt for any ticket |
| `ticket_lineage` | Tree walk: spawn depth, open descendants, settled? |
| `queue_stats` | Counts by status and origin |

**Evidence enforcement:** `mark_done` is refused on a ticket that declares
`required_checks` but has no evidence; `verify_ticket(pass=true)` is refused
while any required check lacks passing evidence — regardless of actor.

## Test

No database needed — the smoke test runs the full lifecycle (including the
refused self-close and the auto-cut correction) against an in-memory Postgres:

```bash
npm test
```
