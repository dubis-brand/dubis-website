#!/usr/bin/env node
/**
 * security-scan-report.js — results sink for the DUBIS code+site security scan
 * GitHub Action (.github/workflows/dubis-security-scan.yml).
 *
 * Reads the JSON/text artifacts each scan step produced into ./scan-results/ ,
 * computes REAL finding counts, then writes them to TWO places:
 *
 *   1. agent_runs (ALWAYS)  — agent_id='security', status, summary, side_effects.
 *        The Boss report's opinionSecurity() reads exactly this:
 *        side_effects.issues_count, status==='failed', extractError(side_effects).
 *        Writing here means the Boss security section shows REAL numbers with
 *        zero changes to dubis-boss-orchestrator.
 *
 *   2. security_scans (BEST-EFFORT) — the clean dedicated table. If the table
 *        doesn't exist yet (migration not applied), we log + skip, never fail.
 *
 * Counts are REAL — derived from the actual tool output files. If a tool found
 * nothing, we record "0 (tool X ran)", never a hardcoded pass. If a tool step
 * was skipped/errored, that is reflected too (and surfaced as a finding).
 *
 * Env required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (GHA secrets).
 * Env optional: GITHUB_SHA, GITHUB_REF, GITHUB_EVENT_NAME, GHA_RUN_URL.
 *
 * Exit code: 0 always for the SINK step itself (we want the row written even on
 * findings). The workflow decides pass/fail visibility via the `passed` flag and
 * a separate gate step. We DO exit 1 only if we cannot write agent_runs at all
 * (that's a real infra failure worth a red run).
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const RESULTS_DIR = path.join(process.cwd(), 'scan-results');

function readText(file) {
  try { return fs.readFileSync(path.join(RESULTS_DIR, file), 'utf8'); }
  catch { return null; }
}
function readJSON(file) {
  const t = readText(file);
  if (t === null) return null;
  try { return JSON.parse(t); } catch { return { __parse_error: true, raw: t.slice(0, 500) }; }
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

// ── 1. gitleaks ──────────────────────────────────────────────
// gitleaks --report-format json writes an ARRAY of leak objects (empty [] = clean).
// gitleaks auto-honors .gitleaksignore, so this array = NEW (un-baselined) leaks.
// We count the baseline separately for visibility (the known rotation backlog).
// A "ran" marker file proves a 0 is "tool ran", not "tool absent".
function parseGitleaks() {
  const ran = readText('gitleaks.ran') !== null;
  const report = readJSON('gitleaks.json');
  let count = 0;          // NEW (un-baselined) secrets — actionable
  let samples = [];
  if (Array.isArray(report)) {
    count = report.length;
    samples = report.slice(0, 10).map(r => ({
      rule: r.RuleID || r.Rule || r.Description,
      file: r.File,
      line: r.StartLine,
      commit: (r.Commit || '').slice(0, 8),
    }));
  }
  // Baseline = accepted historical leaks on the rotation backlog (status.md).
  let backlog = 0;
  try {
    const lines = fs.readFileSync(path.join(process.cwd(), '.gitleaksignore'), 'utf8').split('\n');
    backlog = lines.map(l => l.trim()).filter(l => l && !l.startsWith('#')).length;
  } catch { /* no baseline yet */ }
  return { ran, count, backlog, samples, version: (readText('gitleaks.version') || '').trim() || 'gitleaks' };
}

// ── 2. npm audit --json ──────────────────────────────────────
function parseNpmAudit() {
  const ran = readText('npm-audit.ran') !== null;
  const j = readJSON('npm-audit.json');
  // npm v7+ shape: { metadata: { vulnerabilities: { critical, high, moderate, low, info } } }
  const v = (j && j.metadata && j.metadata.vulnerabilities) || {};
  return {
    ran,
    critical: num(v.critical),
    high: num(v.high),
    moderate: num(v.moderate),
    low: num(v.low),
    info: num(v.info),
  };
}

// ── 3. semgrep --json ────────────────────────────────────────
function parseSemgrep() {
  const ran = readText('semgrep.ran') !== null;
  const j = readJSON('semgrep.json');
  const results = (j && Array.isArray(j.results)) ? j.results : [];
  // Count only ERROR + WARNING severities as real findings (INFO is noise).
  const real = results.filter(r => {
    const sev = (r.extra && r.extra.severity) || '';
    return sev === 'ERROR' || sev === 'WARNING';
  });
  const samples = real.slice(0, 15).map(r => ({
    check: r.check_id,
    file: r.path,
    line: r.start && r.start.line,
    sev: r.extra && r.extra.severity,
  }));
  return { ran, count: real.length, total: results.length, samples, version: (readText('semgrep.version') || '').trim() || 'semgrep' };
}

// ── 4. site header check ─────────────────────────────────────
// headers.json shape (written by the workflow curl step):
//   { ok: bool, missing: ["content-security-policy", ...], present: {...}, status: 200 }
function parseHeaders() {
  const j = readJSON('headers.json');
  if (!j) return { ran: false, ok: null, missing: [], present: {} };
  return {
    ran: true,
    ok: j.ok === true,
    missing: Array.isArray(j.missing) ? j.missing : [],
    present: j.present || {},
    status: j.status,
  };
}

(async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[security-scan-report] FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
    process.exit(1);
  }

  const gitleaks = parseGitleaks();
  const npm = parseNpmAudit();
  const semgrep = parseSemgrep();
  const headers = parseHeaders();

  // ── Real finding rollup ──
  // Secrets = NEW leaks (P0, any), npm high+critical, semgrep ERROR/WARNING,
  // missing headers. The KNOWN backlog (baselined historical leaks) is reported
  // for visibility but does NOT inflate the actionable issues_count — it's
  // tracked on the rotation backlog (status.md), not a per-run regression.
  const secretsFound = gitleaks.count;          // NEW, actionable
  const secretsBacklog = gitleaks.backlog;      // known historical, baselined
  const npmHighCrit = npm.high + npm.critical;
  const sastFindings = semgrep.count;
  const headersMissingCount = headers.ran ? headers.missing.length : 0;

  // "tool did not run" is itself a finding (so a silent skip can't masquerade as green).
  const toolGaps = [];
  if (!gitleaks.ran) toolGaps.push('gitleaks did not run');
  if (!npm.ran) toolGaps.push('npm audit did not run');
  if (!semgrep.ran) toolGaps.push('semgrep did not run');
  if (!headers.ran) toolGaps.push('site header check did not run');

  const issuesCount =
    secretsFound +
    npmHighCrit +
    sastFindings +
    headersMissingCount +
    toolGaps.length;

  const passed = issuesCount === 0;

  const ghaRunUrl = process.env.GHA_RUN_URL ||
    (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null);

  const summaryParts = [
    `secrets_new=${secretsFound}${secretsBacklog ? ` (backlog=${secretsBacklog})` : ''}`,
    `npm(crit=${npm.critical},high=${npm.high},mod=${npm.moderate})`,
    `sast=${sastFindings}`,
    `headers_ok=${headers.ran ? headers.ok : 'n/a'}${headersMissingCount ? `(missing:${headers.missing.join(',')})` : ''}`,
  ];
  if (toolGaps.length) summaryParts.push(`gaps=[${toolGaps.join('; ')}]`);
  const summary = `code+site security scan: ${passed ? '✅ clean' : `⚠️ ${issuesCount} findings`} — ${summaryParts.join(' · ')}`;

  // Detail blob (also drives the dedicated table + Boss drill-down if wired).
  const details = {
    gitleaks: { ran: gitleaks.ran, new: gitleaks.count, backlog_baselined: secretsBacklog, version: gitleaks.version, samples: gitleaks.samples },
    npm_audit: { ran: npm.ran, critical: npm.critical, high: npm.high, moderate: npm.moderate, low: npm.low, info: npm.info },
    semgrep: { ran: semgrep.ran, findings: semgrep.count, total_incl_info: semgrep.total, version: semgrep.version, samples: semgrep.samples },
    headers: { ran: headers.ran, ok: headers.ok, status: headers.status, missing: headers.missing },
    tool_gaps: toolGaps,
  };

  // ── side_effects — EXACT shape the Boss opinionSecurity() reads ──
  const sideEffects = {
    source: 'gha:dubis-security-scan',
    issues_count: issuesCount,          // ← Boss reads this (actionable: NEW secrets + npm h/c + sast + missing headers + tool gaps)
    secrets_found: secretsFound,        // NEW (un-baselined) leaks
    secrets_backlog: secretsBacklog,    // known historical leaks on the rotation backlog (visibility only)
    npm_critical: npm.critical,
    npm_high: npm.high,
    npm_moderate: npm.moderate,
    sast_findings: sastFindings,
    headers_ok: headers.ran ? headers.ok : null,
    headers_missing: headers.missing,
    passed,
    gha_run_url: ghaRunUrl,
    git_sha: (process.env.GITHUB_SHA || '').slice(0, 8),
    git_ref: process.env.GITHUB_REF || null,
    trigger: process.env.GITHUB_EVENT_NAME || null,
    details,
  };
  // If a NEW secret leaked, surface as `error` too so extractError() shows P0 context.
  if (secretsFound > 0) sideEffects.error = `${secretsFound} NEW secret(s) introduced — rotate immediately, see GHA run`;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ── Sink 1: agent_runs (mandatory) ──
  // status reflects whether the SCAN ran cleanly, NOT whether it found issues.
  // Boss opinionSecurity() reads status==='failed' as "the agent is broken" (P0)
  // and reads side_effects.issues_count>0 (with status ok) as "N findings" (P1).
  // So we mark 'failed' ONLY when something is genuinely broken: a NEW leaked
  // secret (active incident) or a tool that didn't run (blind spot). npm/sast/
  // header/backlog findings are normal scan output → 'completed' + issues_count.
  const scanBroken = secretsFound > 0 || toolGaps.length > 0;
  const runStatus = scanBroken ? 'failed' : 'completed';
  const { data: runRow, error: runErr } = await sb.from('agent_runs').insert({
    agent_id: 'security',
    status: runStatus,
    summary,
    tasks_created: 0,
    side_effects: sideEffects,
  }).select('id, created_at').single();

  if (runErr) {
    console.error('[security-scan-report] FATAL: could not write agent_runs:', runErr.message);
    process.exit(1);
  }
  console.log(`[security-scan-report] agent_runs row written: id=${runRow.id} status=${runStatus} issues=${issuesCount}`);

  // ── Sink 2: security_scans (best-effort) ──
  const { data: scanRow, error: scanErr } = await sb.from('security_scans').insert({
    git_sha: process.env.GITHUB_SHA || null,
    git_ref: process.env.GITHUB_REF || null,
    trigger: process.env.GITHUB_EVENT_NAME || null,
    gha_run_url: ghaRunUrl,
    secrets_found: secretsFound,
    secrets_tool: gitleaks.version,
    npm_critical: npm.critical,
    npm_high: npm.high,
    npm_moderate: npm.moderate,
    npm_low: npm.low,
    sast_findings: sastFindings,
    sast_tool: semgrep.version,
    headers_ok: headers.ran ? headers.ok : null,
    headers_missing: headers.missing,
    issues_count: issuesCount,
    passed,
    details,
  }).select('id').single();

  if (scanErr) {
    // Most likely: table not created yet. Don't fail the run — agent_runs already has it.
    console.warn(`[security-scan-report] security_scans write skipped (apply migration 20260615_security_scans.sql to enable): ${scanErr.message}`);
  } else {
    console.log(`[security-scan-report] security_scans row written: id=${scanRow.id}`);
  }

  // Emit GitHub step summary so the run page shows the numbers at a glance.
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    const md = [
      `## 🔒 DUBIS Security Scan — ${passed ? '✅ clean' : `⚠️ ${issuesCount} findings`}`,
      '',
      '| Check | Result |',
      '|---|---|',
      `| Secrets (gitleaks) | new: ${gitleaks.ran ? secretsFound : '❌ did not run'}${secretsBacklog ? ` · backlog: ${secretsBacklog} (rotation)` : ''} |`,
      `| npm audit | crit ${npm.critical} · high ${npm.high} · mod ${npm.moderate} ${npm.ran ? '' : '(❌ did not run)'} |`,
      `| Static analysis (semgrep) | ${semgrep.ran ? sastFindings : '❌ did not run'} |`,
      `| Site headers | ${headers.ran ? (headers.ok ? '✅ ok' : `⚠️ missing: ${headers.missing.join(', ')}`) : '❌ did not run'} |`,
      '',
      `agent_runs id: \`${runRow.id}\``,
    ].join('\n');
    fs.appendFileSync(stepSummary, md + '\n');
  }

  // The sink itself succeeded. Findings-gating is a separate workflow step.
  console.log(`[security-scan-report] DONE. passed=${passed} issues=${issuesCount}`);
  process.exit(0);
})().catch(e => {
  console.error('[security-scan-report] uncaught:', e);
  process.exit(1);
});
