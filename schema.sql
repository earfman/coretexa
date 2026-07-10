-- ============================================================
-- Coretexa — the accountability queue for AI-done work
-- schema.sql · one table, one lifecycle, lineage built in
--
-- Runs on any Postgres 14+. Supabase free tier works fine.
-- ============================================================

create table if not exists tickets (
  id           uuid primary key default gen_random_uuid(),

  -- What
  title        text not null,             -- one line, imperative, findable
  body         text,                      -- SCOPE + DONE-WHEN (see TICKET-TEMPLATE section of QUEUE-PROTOCOL.md)
  area         text,                      -- grouping tag: docs / apps / schema / security / ...
  priority     integer not null default 3,-- lower = more urgent (1 before 2 before 3)

  -- Lifecycle
  status       text not null default 'pending'
               check (status in ('pending','claimed','done','verified','closed','blocked')),
  result       text,                      -- doer writeup, then verifier stamp appended

  -- Verification contract (v0.2): verification means acceptance criteria +
  -- executable evidence — not "a second actor said LGTM".
  acceptance      jsonb,                  -- ["Login succeeds with a valid account", ...]
  required_checks jsonb,                  -- ["build","tests","lint"] — each must have passing evidence before close
  evidence        jsonb,                  -- [{check, command, result:'pass'|'fail', detail, submitted_by, at}]

  -- Accountability (who did what — enforced by the MCP server)
  claimed_by   text,                      -- actor id of the doer
  verified_by  text,                      -- actor id of the verifier (must differ from claimed_by)

  -- Lineage (issues spawn issues — as data, not prose)
  parent_id    uuid references tickets(id),
  origin       text not null default 'manual'
               check (origin in ('manual','spawned','correction','regression')),
               -- manual:     a human or agent cut it directly
               -- spawned:    discovered mid-work on the parent (Rule A)
               -- correction: a verifier failed a gate on the parent
               -- regression: the system detected something that passed before and fails now

  -- Timestamps
  created_at   timestamptz not null default now(),
  claimed_at   timestamptz,
  done_at      timestamptz,
  processed_at timestamptz                -- stamped when the ticket closes
);

create index if not exists tickets_work_scan  on tickets (status, priority asc, created_at asc);
create index if not exists tickets_parent     on tickets (parent_id);

-- ------------------------------------------------------------
-- Multi-user note (single-user installs can ignore this block):
-- add `user_id uuid not null default auth.uid()` and enable
-- owner-scoped RLS, e.g. on Supabase:
--
--   alter table tickets enable row level security;
--   create policy tickets_owner on tickets
--     for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- ------------------------------------------------------------

-- ============================================================
-- Lineage views — the part almost no tooling has
-- ============================================================

-- Every ticket with its full ancestry chain and depth.
create or replace view ticket_lineage as
with recursive chain as (
  select id, parent_id, title, status, origin, created_at,
         0 as depth,
         id as root_id
  from tickets
  where parent_id is null
  union all
  select t.id, t.parent_id, t.title, t.status, t.origin, t.created_at,
         c.depth + 1,
         c.root_id
  from tickets t
  join chain c on t.parent_id = c.id
)
select * from chain;

-- Spawn depth per root ticket: how many generations of
-- fix-broke-something did this change take to settle?
-- High spawn depth = a fragile area of the codebase.
create or replace view spawn_depth as
select
  root_id,
  (select title from tickets where id = l.root_id)       as root_title,
  max(depth)                                             as max_depth,
  count(*) - 1                                           as descendants,
  count(*) filter (where origin = 'regression')          as regressions,
  count(*) filter (where origin = 'correction')          as corrections,
  bool_and(status in ('closed'))                         as settled
from ticket_lineage l
group by root_id;

-- A root ticket is not truly settled while it has open descendants.
create or replace view unsettled_roots as
select * from spawn_depth where settled = false;
