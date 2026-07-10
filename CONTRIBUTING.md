# Contributing to Coretexa

PRs welcome — and yes, **your contribution goes through the queue.** The
contribution process is the product demo.

## How it works here

1. **Every change starts as a ticket.** Open a GitHub Issue using the ticket
   shape: one imperative title, a body with `SCOPE:` and `DONE WHEN:`
   (observable conditions a verifier can check — see `QUEUE-PROTOCOL.md` §6).
2. **Your PR is the doer's work.** Link it to the Issue. In the PR
   description, include what a doer's `result` would include: what changed
   (by name), how you tested it (the specific check), what you deferred.
3. **You cannot close your own work.** A maintainer — or a verification agent
   that did not write the PR — runs the five gates against ground truth:
   does it do what the Issue asked, does anything that worked now break, is
   it consistent, is it the easy 80%, confirmed against reality.
4. **Gate failures become corrections, not shame.** If a gate fails, you'll
   get a linked correction issue stating CLAIMED / OBSERVED / GAP / FIX.
   That's the protocol working, not a rejection of you.
5. **Found something else broken while you were in there?** Rule A: open a
   new Issue referencing the one you were working. Don't bury it in a comment.

## Good first contributions

- The reference MCP server has a roadmap section in its README — pick an
  unchecked box.
- Adapters: the doer/verifier commands are written for Claude Code's
  `.claude/commands/`; ports for Cursor rules / Windsurf / plain-CLI agents
  are wanted.
- The GitHub Action (five gates as a PR check) is the most-wanted item.

## Ground rules

- MIT licensed; by contributing you agree your work ships under it.
- The protocol itself (`QUEUE-PROTOCOL.md`) changes only with strong reason —
  it's load-bearing for everyone who adopted it. Propose protocol changes as
  Issues first, PRs second.
- Maintained part-time by a human with a family and a day job. Response
  times are honest, not instant.
