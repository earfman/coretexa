// db.js — thin data layer for the Coretexa queue.
// All protocol enforcement that belongs in code lives here:
// legal status transitions, no-self-close, lineage on corrections.

const LEGAL = {
  pending: ['claimed', 'blocked'],
  claimed: ['done', 'blocked', 'pending'],   // pending = release a claim
  done: ['closed'],                          // via verify only
  blocked: ['pending'],
  verified: ['closed'],
  closed: [],
};

export class QueueDB {
  /** @param {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} client */
  constructor(client) {
    this.client = client;
  }

  async q(sql, params = []) {
    const res = await this.client.query(sql, params);
    return res.rows;
  }

  async getTicket(id) {
    const rows = await this.q('select * from tickets where id = $1', [id]);
    if (!rows.length) throw new Error(`No ticket with id ${id}`);
    return rows[0];
  }

  assertTransition(from, to) {
    if (!LEGAL[from]?.includes(to)) {
      throw new Error(
        `Illegal transition ${from} -> ${to}. Legal from '${from}': ${LEGAL[from]?.join(', ') || '(terminal)'}`
      );
    }
  }

  async nextTicket() {
    const rows = await this.q(
      `select * from tickets
       where status = 'pending' and title not like 'PARKED%'
       order by priority asc, created_at asc limit 1`
    );
    return rows[0] ?? null;
  }

  async nextDoneTicket() {
    const rows = await this.q(
      `select * from tickets where status = 'done' order by done_at asc nulls last limit 1`
    );
    return rows[0] ?? null;
  }

  async listTickets(status) {
    return status
      ? this.q(
          `select id, title, area, priority, status, origin, parent_id, claimed_by, created_at
           from tickets where status = $1 order by priority asc, created_at asc`,
          [status]
        )
      : this.q(
          `select id, title, area, priority, status, origin, parent_id, claimed_by, created_at
           from tickets where status <> 'closed' order by priority asc, created_at asc`
        );
  }

  async cutTicket({
    title, body, area = null, priority = 3, parent_id = null, origin = 'manual',
    acceptance = null, required_checks = null,
  }) {
    if (!title?.trim()) throw new Error('title is required');
    if (acceptance && !Array.isArray(acceptance)) throw new Error('acceptance must be an array of criteria strings');
    if (required_checks && !Array.isArray(required_checks)) throw new Error('required_checks must be an array of check names');
    const rows = await this.q(
      `insert into tickets (title, body, area, priority, parent_id, origin, acceptance, required_checks)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [
        title.trim(), body ?? null, area, priority, parent_id, origin,
        acceptance ? JSON.stringify(acceptance) : null,
        required_checks ? JSON.stringify(required_checks) : null,
      ]
    );
    return rows[0];
  }

  /** Evidence: executable proof (build/tests/repro), not prose. */
  async submitEvidence(id, actor, entries) {
    const t = await this.getTicket(id);
    if (!['claimed', 'done'].includes(t.status)) {
      throw new Error(`Evidence can be submitted only on claimed or done tickets; ${id} is '${t.status}'`);
    }
    if (!actor) throw new Error('actor id required to submit evidence');
    if (!Array.isArray(entries) || !entries.length) throw new Error('entries must be a non-empty array');
    for (const e of entries) {
      if (!e.check?.trim()) throw new Error('each evidence entry needs a check name');
      if (!['pass', 'fail'].includes(e.result)) throw new Error(`evidence result must be 'pass' or 'fail' (check "${e.check}")`);
    }
    const stamped = entries.map((e) => ({
      check: e.check.trim(),
      result: e.result,
      command: e.command ?? null,
      detail: e.detail ?? null,
      submitted_by: actor,
      at: new Date().toISOString(),
    }));
    const existing = this.parseJson(t.evidence) ?? [];
    const rows = await this.q(
      `update tickets set evidence = $2 where id = $1 returning *`,
      [id, JSON.stringify([...existing, ...stamped])]
    );
    return rows[0];
  }

  parseJson(v) {
    if (v == null) return null;
    if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
    return v;
  }

  /** Which required checks lack passing evidence? */
  missingChecks(t) {
    const required = this.parseJson(t.required_checks) ?? [];
    if (!required.length) return [];
    const evidence = this.parseJson(t.evidence) ?? [];
    return required.filter((c) => !evidence.some((e) => e.check === c && e.result === 'pass'));
  }

  async claim(id, actor) {
    if (!actor) throw new Error('actor id required to claim');
    const t = await this.getTicket(id);
    this.assertTransition(t.status, 'claimed');
    const rows = await this.q(
      `update tickets set status='claimed', claimed_by=$2, claimed_at=now()
       where id=$1 and status='pending' returning *`,
      [id, actor]
    );
    if (!rows.length) throw new Error(`Ticket ${id} was claimed by someone else first`);
    return rows[0];
  }

  async markDone(id, actor, result) {
    const t = await this.getTicket(id);
    this.assertTransition(t.status, 'done');
    if (t.claimed_by && t.claimed_by !== actor) {
      throw new Error(`Ticket ${id} is claimed by '${t.claimed_by}', not '${actor}'`);
    }
    if (!result?.trim()) {
      throw new Error(
        'A done ticket requires a result: what changed (by name), how you tested it, what you deferred.'
      );
    }
    const required = this.parseJson(t.required_checks) ?? [];
    const evidence = this.parseJson(t.evidence) ?? [];
    if (required.length && !evidence.length) {
      throw new Error(
        `This ticket declares required checks (${required.join(', ')}) — submit_evidence before marking done. ` +
          `"Done" is a claim; evidence is what makes it checkable.`
      );
    }
    const rows = await this.q(
      `update tickets set status='done', done_at=now(), result=$2 where id=$1 returning *`,
      [id, result]
    );
    return rows[0];
  }

  /**
   * THE RULE. verify_ticket refuses when verifier === doer.
   * pass=true  -> close, stamp result.
   * pass=false -> parent stays 'done'; cut a linked correction ticket.
   */
  async verify(id, actor, pass, notes) {
    const t = await this.getTicket(id);
    if (t.status !== 'done') {
      throw new Error(`Only 'done' tickets can be verified; ${id} is '${t.status}'`);
    }
    if (!actor) throw new Error('actor id required to verify');
    if (t.claimed_by && t.claimed_by === actor) {
      throw new Error(
        `NO-SELF-CLOSE: '${actor}' claimed this ticket and may not verify it. ` +
          `Gate 5 requires a second set of eyes — run verification from a different actor/session.`
      );
    }
    if (!notes?.trim()) {
      throw new Error('Verification requires notes: what you actually checked, one line per gate.');
    }
    if (pass) {
      const missing = this.missingChecks(t);
      if (missing.length) {
        throw new Error(
          `EVIDENCE REQUIRED: cannot close — required checks without passing evidence: ${missing.join(', ')}. ` +
            `Verification means acceptance criteria + executable evidence, not a second opinion. ` +
            `Run the checks, submit_evidence, then verify.`
        );
      }
    }

    if (pass) {
      const stamp = `\n\n--- VERIFIED ${new Date().toISOString().slice(0, 10)} by ${actor} ---\n${notes.trim()}`;
      const rows = await this.q(
        `update tickets set status='closed', verified_by=$2, processed_at=now(),
           result = coalesce(result,'') || $3
         where id=$1 returning *`,
        [id, actor, stamp]
      );
      return { closed: rows[0], correction: null };
    }

    // Fail: parent stays at done (work record preserved); correction is its own row.
    const correction = await this.cutTicket({
      title: `CORRECTION: ${t.title}`.slice(0, 200),
      body:
        `Surfaced during verification of parent ticket ${t.id}.\n\n${notes.trim()}\n\n` +
        `(Format: CLAIMED / OBSERVED / GAP / FIX — see QUEUE-PROTOCOL.md §3.)`,
      area: t.area,
      priority: t.priority,
      parent_id: t.id,
      origin: 'correction',
    });
    await this.q(`update tickets set verified_by=$2 where id=$1`, [id, actor]);
    return { closed: null, correction };
  }

  async block(id, question) {
    const t = await this.getTicket(id);
    this.assertTransition(t.status, 'blocked');
    if (!question?.trim()) throw new Error('block requires the exact decision needed from the human');
    const rows = await this.q(
      `update tickets set status='blocked',
         body = coalesce(body,'') || $2
       where id=$1 returning *`,
      [id, `\n\nBLOCKED: ${question.trim()}`]
    );
    return rows[0];
  }

  async unblock(id, decision) {
    const t = await this.getTicket(id);
    this.assertTransition(t.status, 'pending');
    if (!decision?.trim()) throw new Error('unblock requires the decision that was made');
    const rows = await this.q(
      `update tickets set status='pending',
         body = coalesce(body,'') || $2
       where id=$1 returning *`,
      [id, `\n\n--- DECIDED: ${decision.trim()} ---`]
    );
    return rows[0];
  }

  /** Regression auto-cut: the SYSTEM files it, not the doer. */
  async cutRegression(parentId, whatBroke) {
    const parent = await this.getTicket(parentId);
    return this.cutTicket({
      title: `REGRESSION: ${whatBroke}`.slice(0, 200),
      body:
        `Detected after ticket ${parent.id} ("${parent.title}") was marked done: ` +
        `a check that passed before now fails.\n\nWHAT BROKE: ${whatBroke}\n\n` +
        `Filed automatically (origin=regression). The doer did not and cannot suppress this row.`,
      area: parent.area,
      priority: Math.max(1, (parent.priority ?? 3) - 1), // regressions escalate
      parent_id: parent.id,
      origin: 'regression',
    });
  }

  async lineage(rootId) {
    // Walk down from the given ticket (works even if it isn't a root).
    // Iterative level-by-level walk: portable across Postgres versions and
    // test harnesses (recursive-CTE views for real Postgres live in schema.sql).
    const root = await this.getTicket(rootId);
    const rows = [{ ...root, depth: 0 }];
    let frontier = [root.id];
    let depth = 0;
    while (frontier.length) {
      depth += 1;
      const children = [];
      for (const pid of frontier) {
        // One eq-query per frontier node: maximally portable (some Postgres
        // emulators mishandle uuid[] ANY), and lineage trees are small.
        const batch = await this.q(
          `select id, parent_id, title, status, origin, priority, created_at
           from tickets where parent_id = $1 order by created_at asc`,
          [pid]
        );
        children.push(...batch);
      }
      if (!children.length) break;
      for (const c of children) rows.push({ ...c, depth });
      frontier = children.map((c) => c.id);
    }
    const open = rows.filter((r) => r.status !== 'closed').length;
    return {
      tickets: rows,
      max_depth: rows.length ? Math.max(...rows.map((r) => r.depth)) : 0,
      descendants: rows.length - 1,
      open_descendants: rows.filter((r) => r.depth > 0 && r.status !== 'closed').length,
      settled: open === 0,
    };
  }

  /**
   * The gate report — the receipt pasted into a PR or issue.
   * Renders identically for a closed ticket (full stamp) and a pending one
   * (honest "pending verification"), so nobody can dress up unverified work.
   */
  async gateReport(id) {
    const t = await this.getTicket(id);
    const shortId = String(t.id).slice(0, 8);
    const acceptance = this.parseJson(t.acceptance) ?? [];
    const evidence = this.parseJson(t.evidence) ?? [];
    const required = this.parseJson(t.required_checks) ?? [];
    const missing = this.missingChecks(t);
    const verified = t.status === 'closed' && t.verified_by;

    const lines = [];
    lines.push(`### Coretexa gate report — \`${shortId}\``);
    lines.push('');
    lines.push(`**${t.title}**`);
    lines.push('');
    lines.push(
      `status: **${t.status}** · doer: \`${t.claimed_by ?? '—'}\` · verifier: \`${t.verified_by ?? 'pending'}\`` +
        (t.origin && t.origin !== 'manual' ? ` · origin: \`${t.origin}\`` : '')
    );

    if (acceptance.length) {
      lines.push('');
      lines.push('**Acceptance criteria**');
      for (const a of acceptance) lines.push(`- ${a}`);
    }

    lines.push('');
    lines.push('**Evidence**');
    if (evidence.length) {
      lines.push('');
      lines.push('| check | result | by | detail |');
      lines.push('|---|---|---|---|');
      for (const e of evidence) {
        const mark = e.result === 'pass' ? '✓ pass' : '✗ fail';
        lines.push(`| \`${e.check}\` | ${mark} | \`${e.submitted_by}\` | ${e.detail ?? e.command ?? ''} |`);
      }
    } else {
      lines.push('');
      lines.push('_No evidence submitted._');
    }
    if (missing.length) {
      lines.push('');
      lines.push(`⚠ required checks without passing evidence: ${missing.map((m) => `\`${m}\``).join(', ')}`);
    } else if (required.length) {
      lines.push('');
      lines.push(`All required checks have passing evidence: ${required.map((m) => `\`${m}\``).join(', ')}`);
    }

    lines.push('');
    lines.push('**Verification**');
    if (verified) {
      const stampIdx = (t.result ?? '').indexOf('--- VERIFIED');
      if (stampIdx >= 0) {
        lines.push('');
        lines.push('```');
        lines.push(t.result.slice(stampIdx).trim());
        lines.push('```');
      } else {
        lines.push('');
        lines.push(`Closed by \`${t.verified_by}\` (a different actor than the doer).`);
      }
    } else {
      lines.push('');
      lines.push('_Pending — this work has NOT yet been verified by a second actor._');
    }

    lines.push('');
    lines.push('---');
    lines.push('*Verified by a second agent · claimer ≠ verifier · [coretexa.dev](https://coretexa.dev)*');
    return lines.join('\n');
  }

  async stats() {
    const by = await this.q(`select status, count(*)::int as n from tickets group by status`);
    const origin = await this.q(`select origin, count(*)::int as n from tickets group by origin`);
    return {
      by_status: Object.fromEntries(by.map((r) => [r.status, r.n])),
      by_origin: Object.fromEntries(origin.map((r) => [r.origin, r.n])),
    };
  }
}
