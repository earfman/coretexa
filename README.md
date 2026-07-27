# Coretexa

**Can this pull request's own new tests actually fail?**

A pull request says it fixes a bug and adds tests. Coretexa puts the source code
back the way it was, leaves the new tests exactly where they are, and runs them
again. If they still pass, the tests do not touch the thing the pull request
changed — and now you know that before you merge, not six months later.

The tool lives in its own repository:

### → **[github.com/earfman/coretexa-verify](https://github.com/earfman/coretexa-verify)**

```yaml
# .github/workflows/coretexa-verify.yml
name: coretexa-verify
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: earfman/coretexa-verify@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Runs entirely on your own runner. Zero dependencies — pure Python standard
library. No telemetry. Python, JavaScript/TypeScript, Go, Rust, and Java
(experimental), plus a `test-command` escape hatch for anything else. MIT.

---

## This repository

This is the source for **[coretexa.dev](https://coretexa.dev)** — the site, the
[proof page](https://coretexa.dev/proof.html) of real findings on real open
source pull requests, and the [writing](https://coretexa.dev/blog.html).

It also still contains the original **queue protocol** — a Postgres schema and
a reference MCP server for work an agent cannot close itself, with a second
actor required to verify. That was where this started, and the idea underneath
it is the same one: *the thing that did the work does not get to decide the work
was good.* It is no longer what Coretexa leads with, and it is not linked from
the site, but the files are here and MIT licensed if they are useful to you:

- [`QUEUE-PROTOCOL.md`](QUEUE-PROTOCOL.md) — the protocol
- [`schema.sql`](schema.sql) — the Postgres queue
- [`mcp/`](mcp/) — reference MCP server
- [`commands/`](commands/) — the `/work-queue` and `/verify-queue` commands

## Licence

MIT. See [LICENSE](LICENSE).
