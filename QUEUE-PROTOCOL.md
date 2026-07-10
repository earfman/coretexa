# The Coretexa Queue Protocol

**Normative spec. One table, one lifecycle, five gates, three rules.**
Anything that can read a row can participate — Claude Code, Cursor, a custom
agent, or a human with `psql`.

The words **MUST**, **MUST NOT**, **MAY** are used in the RFC sense.

---

## 1. The lifecycle

```
pending ──claim──▶ claimed ──work──▶ done ──verify──▶ verified ──▶ closed
   ▲                                                        
   └──────── decision recorded ──────── blocked ◀── needs a human decision
```

| Status | Meaning | Who moves it |
|---|---|---|
| `pending` | Work-now. Any doer MAY claim it. | doer → `claimed` |
| `claimed` | An actor owns it and is working. | doer → `done`, or → `blocked` |
| `done` | The doer believes it is complete. **Not closed.** | verifier → `closed`, or files a correction |
| `verified` | A second actor confirmed it against ground truth. | → `closed` (may be one step) |
| `closed` | Terminal. `result` and `processed_at` set. | — |
| `blocked` | Cannot proceed without a **human** decision, stated in `body`. | human records decision → `pending` |

Priority is an integer; **lower is more urgent**. Doers MUST take the
lowest-priority-number `pending` row, oldest first (FIFO within a priority).

## 2. The no-self-close rule (the heart of the protocol)

The doer MAY set `status='done'`. The doer **MUST NOT** close its own work.

Closing requires a **verifier**: a *different* actor (different session,
different agent, or a human) that runs the five gates against ground truth.
Implementations MUST record `claimed_by` and `verified_by` and MUST reject a
verification where `verified_by = claimed_by`. (The reference MCP server
enforces this mechanically.)

Why: gate 5 *is* the second set of eyes. An eager agent declaring victory is
precisely the failure mode this protocol exists to catch.

## 3. The five gates (definition of done)

A verifier MUST answer all five against the **actual artifact** — the real
repo, the real database, the real running thing — never against the doer's
prose summary.

1. **Does it do what the ticket asked?** Re-read the original `body`;
   inspect the artifact it claims to have changed.
2. **Did it break anything that worked?** Sweep the blast radius: adjacent
   code, adjacent state, the checks that passed before.
3. **Is it self-consistent?** No new contradictions with governing docs or
   with sibling tickets in the same area.
4. **Is it actually finished, or just the easy 80%?** Surface the obvious
   *"wait, but…"* and confirm the answer is in the work. Half-done with a
   flag is acceptable; half-done silent is a failure.
5. **Did a SECOND set of eyes confirm 1–4 against reality?** The verifier
   IS this gate.

**Pass:** close the ticket; append a verification stamp to `result` recording
what was actually checked (one line per gate).
**Fail:** the original stays at `done` (the work record is preserved — never
silently re-open it). Cut a **correction ticket**: `origin='correction'`,
`parent_id` = the failed ticket, priority matching the parent, `body` stating
CLAIMED / OBSERVED / GAP / FIX.

### The verification contract (v0.2)

Two different actor ids are necessary but not sufficient — two actors can
share the same blind spots. "Verified" therefore means **declared acceptance
criteria plus executable evidence**, not a second opinion. A ticket MAY
declare:

- **`acceptance`** — observable criteria a verifier can check ("login succeeds
  with a valid account"), written at cut time, in the ticket — never invented
  after the fact.
- **`required_checks`** — named executable checks (`build`, `tests`, `repro`,
  `lint`) that MUST each have **passing evidence** before the ticket may close.

Actors attach evidence via `submit_evidence`: per-check entries
`{check, result: pass|fail, command, detail}`, stamped with who submitted and
when. Implementations MUST refuse `mark_done` on a ticket that declares
required checks but has no evidence, and MUST refuse a passing verification
while any required check lacks passing evidence — regardless of who is
verifying. The doer's word is a claim; a second actor's word is an opinion;
**evidence is what closes tickets.** ("Ground truth" is the aspiration;
acceptance criteria and executable evidence are the implementation.)

## 4. The three rules

**Rule A — Issues spawn issues.** Any NEW problem discovered mid-work
(a stale reference, a schema gap, a design ambiguity) MUST become its own
ticket — `origin='spawned'`, `parent_id` set — never a paragraph buried in
the parent's `result`. A row resurfaces in the next queue scan; a buried
note never does.

**Rule B — Blocked is visible.** If a ticket cannot proceed without a human
decision, the doer MUST set `status='blocked'` and write the **exact
decision needed** into `body`. Guessing the human's answer is forbidden.
When the decision is recorded (also in `body`), the ticket returns to
`pending`.

**Rule C — Verify against evidence, not reports.** Implementations SHOULD give
the verifier the same access the doer had (repo, DB, running system). A
verifier that can only read the doer's report cannot verify anything — it can
only agree.

## 5. Lineage & the two system behaviors

Every spawned/correction/regression ticket carries `parent_id`. That makes
accountability *queryable*:

- **Auto-cut on regression.** Implementations SHOULD snapshot the relevant
  checks before a change (what passes) and re-run them after the doer marks
  `done`. Anything that **passed before and fails now** MUST be filed as a
  new ticket with `origin='regression'` and `parent_id` set — **cut by the
  system, not by the doer**, so breakage cannot be rationalized away.
- **Spawn depth.** `max(depth)` over a root's lineage tree (see
  `spawn_depth` view in `schema.sql`): how many generations of
  fix-broke-something a change took to settle. High spawn depth marks a
  fragile area of the codebase. A root ticket SHOULD NOT be considered
  settled while any descendant is open (`unsettled_roots` view).

## 6. The ticket template

A well-formed ticket `body` contains two sections:

```
SCOPE: what is and is not included, in 2–5 lines.
DONE WHEN: observable conditions a verifier can check against reality —
  "the column exists", "the tile renders", "the test passes" —
  never "the code is improved".
```

`title` is one imperative line. `area` groups related work. `priority` is
set at cut time: 1 = drop everything, 2 = next, 3 = normal (default).

## 7. Conformance

An implementation conforms if it:

1. stores tickets with the lifecycle statuses of §1 and moves them only along
   the edges of §1;
2. records `claimed_by`/`verified_by` and mechanically rejects self-close (§2);
3. requires the five gates at verification and preserves failed work as
   `done` + correction (§3);
4. captures spawned work as linked rows (§4-A) and surfaces blocked state
   (§4-B);
5. stores lineage as data (`parent_id`) rather than prose (§5);
6. enforces the verification contract where declared: no `done` without
   evidence, no close while a required check lacks passing evidence (§3).

Auto-cut-on-regression and spawn-depth analytics are OPTIONAL but are what
make the protocol worth adopting over a plain issue tracker.
