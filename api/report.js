// ═══════════════════════════════════════════════════════════════════════════════
// REPORT API v12 — Stage-Aware + Strategic Narrative + Guardrails
//
// Changes over v11:
// 1. Pre-Analysis Guardrail: flags contradictions before generation
// 2. Golden Thread: every recommendation links to parent_finding_id
// 3. Trade-off Parameters: negative_externality per priority
// 4. Strategic Narrative: Current State → Hard Truth → Unlock → Risk of Inaction
// 5. Narrow Data Sources: benchmark library injected per stage
// 6. Second-Order Effects: sequential roadmap (M1 → M2 → M3)
// 7. Live Audit: Tavily API real-time market data
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK DATA
// ═══════════════════════════════════════════════════════════════════════════════

let BENCHMARKS = null;
function loadBenchmarks() {
  if (BENCHMARKS) return BENCHMARKS;
  try {
    let base;
    try { base = dirname(fileURLToPath(import.meta.url)); } catch { base = process.cwd() + '/api'; }
    const raw = readFileSync(join(base, 'benchmarks', 'saas-stages.json'), 'utf-8');
    BENCHMARKS = JSON.parse(raw);
  } catch (e) {
    console.warn('[Report] Could not load benchmarks:', e.message);
    BENCHMARKS = { stages: {}, marketContext2026: {} };
  }
  return BENCHMARKS;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

function resolveStage(rawStage) {
  if (!rawStage) return 'seed_startup';
  const s = rawStage.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const map = {
    'pre_seed_idea': ['pre-seed', 'pre seed', 'idea', 'concept', 'pre-revenue', 'prerevenue', 'pre revenue', 'just started', 'no revenue', 'prototype'],
    'seed_startup': ['seed', 'startup', 'early', 'pre-series-a', 'pre series a', 'angel', 'bootstrap', 'bootstrapped'],
    'early_scale': ['series a', 'series-a', 'growth', 'scaling', 'scale', 'early scale', 'growing', 'scaleup'],
    'expansion_enterprise': ['series b', 'series-b', 'series c', 'enterprise', 'expansion', 'mature', 'ipo', 'late stage']
  };
  for (const [key, aliases] of Object.entries(map)) {
    if (aliases.some(a => s.includes(a))) return key;
  }
  if (['pre_seed_idea', 'seed_startup', 'early_scale', 'expansion_enterprise'].includes(rawStage)) return rawStage;
  return 'seed_startup';
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-ANALYSIS GUARDRAIL — flags contradictions and feasibility issues
// ═══════════════════════════════════════════════════════════════════════════════

function runFeasibilityChecks(profile, stageData) {
  const flags = [];
  const p = profile;

  // 1. Budget vs. ambition mismatch
  if (p.budgetLevel === 'limited' && p.growthTarget) {
    const growthNum = parseInt(p.growthTarget.replace(/[^0-9]/g, ''));
    if (growthNum > 100) {
      flags.push({
        type: 'contradiction', severity: 'high',
        issue: 'High growth target with limited budget',
        detail: `Growth target "${p.growthTarget}" paired with "limited" budget is unrealistic without external funding or radical efficiency gains.`,
        recommendation: 'Either adjust growth expectations to 30-50% or identify budget reallocation opportunities.'
      });
    }
  }

  // 2. Stage vs. tool mismatch
  if (stageData) {
    const stageLabel = stageData.label;
    const maxToolSpend = stageData.playbook?.budgetGuidance?.toolSpend?.max;
    const tools = (p.tools || '').toLowerCase();
    const crm = (p.crm || '').toLowerCase();

    if (['pre_seed_idea'].includes(resolveStage(p.companyStage || p.stage))) {
      if (/salesforce|hubspot pro|hubspot enterprise|marketo|outreach|salesloft|gong|6sense/.test(tools + crm)) {
        flags.push({
          type: 'anti_pattern', severity: 'medium',
          issue: `Enterprise-grade tools at ${stageLabel} stage`,
          detail: `Tools like Salesforce/Marketo/Gong are over-engineered for a ${stageLabel} company. Maximum recommended tool spend: €${maxToolSpend || '200'}/mo.`,
          recommendation: 'Downgrade to founder-appropriate tools: Google Sheets, Notion, HubSpot Free.'
        });
      }
    }
  }

  // 3. Team size vs. sales motion mismatch
  const teamNum = parseInt((p.teamSize || '0').replace(/[^0-9]/g, ''));
  if (teamNum <= 5 && /outbound|abm|account.based/.test((p.salesMotion || '').toLowerCase())) {
    flags.push({
      type: 'contradiction', severity: 'medium',
      issue: 'Outbound/ABM motion with tiny team',
      detail: `Team of ${teamNum} running outbound/ABM is unsustainable. ABM requires dedicated SDRs, content, and ops.`,
      recommendation: 'Focus on founder-led inbound or PLG until team grows to 10+.'
    });
  }

  // 4. Revenue vs. funding gap
  if (p.funding && p.revenue) {
    const isBoot = /bootstrap|self.funded|no funding/i.test(p.funding);
    const mrr = parseInt((p.revenue || '0').replace(/[^0-9]/g, ''));
    if (isBoot && mrr < 5000 && teamNum > 5) {
      flags.push({
        type: 'risk', severity: 'high',
        issue: 'Cash runway concern',
        detail: `Bootstrapped with <€5K MRR and ${teamNum} team members. Burn likely exceeds revenue significantly.`,
        recommendation: 'Urgent: reduce to core team (founder + 1-2) or close bridge funding within 60 days.'
      });
    }
  }

  // 5. Founder dependency + scaling ambition
  if (p.whoCloses && p.mainBottleneck) {
    const founderCloses = /founder|ceo|co-founder|io|myself/i.test(p.whoCloses);
    const scalingBottleneck = /scaling|growth|capacity/i.test(p.mainBottleneck);
    if (founderCloses && scalingBottleneck) {
      flags.push({
        type: 'structural', severity: 'high',
        issue: 'Founder bottleneck blocks scaling',
        detail: 'Founder is the only closer while scaling is the identified bottleneck. These are directly connected.',
        recommendation: 'First hire should be an AE who can own the sales process end-to-end, not an SDR.'
      });
    }
  }

  // 6. Churn vs. acquisition focus
  if (p.churnRate && p.mainBottleneck) {
    const churnNum = parseFloat((p.churnRate || '0').replace(/[^0-9.]/g, ''));
    const focusOnLeads = /lead|acquisition|pipeline|traffic/i.test(p.mainBottleneck);
    if (churnNum > 5 && focusOnLeads) {
      flags.push({
        type: 'contradiction', severity: 'high',
        issue: 'Leaky bucket: high churn with acquisition focus',
        detail: `Monthly churn of ${churnNum}% means the bucket is leaking. Focusing on lead gen without fixing retention is burning money.`,
        recommendation: 'Fix retention first: aim for <3% monthly churn before scaling acquisition.'
      });
    }
  }

  return flags;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK SCORECARD — compare user metrics to stage benchmarks w/ visual gauge
// ═══════════════════════════════════════════════════════════════════════════════

function buildBenchmarkScorecard(profile, stageData) {
  if (!stageData?.benchmarks) return '';
  const bm = stageData.benchmarks;
  const p = profile;
  const lines = [`## Benchmark Scorecard — ${stageData.label} Stage\n`];
  lines.push('| Metric | Your Value | Stage Median | Good | Assessment | Visual |');
  lines.push('|--------|-----------|-------------|------|------------|--------|');

  // Helper: parse a numeric value from user input
  const num = (v) => {
    if (!v) return null;
    const s = String(v).replace(/[^0-9.,]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  // Helper: generate visual gauge (5-block bar)
  const gauge = (userVal, median, good, bad, lowerIsBetter = false) => {
    if (userVal === null || median === null) return '—';
    let ratio;
    if (lowerIsBetter) {
      // For metrics where lower is better (churn, CAC, burn multiple)
      if (good && userVal <= good) return '🟢🟢🟢🟢🟢';
      if (bad && userVal >= bad) return '🔴🔴🔴🔴🔴';
      ratio = median / Math.max(userVal, 0.01);
    } else {
      // For metrics where higher is better (LTV, NRR, win rate)
      if (good && userVal >= good) return '🟢🟢🟢🟢🟢';
      if (bad && userVal <= bad) return '🔴🔴🔴🔴🔴';
      ratio = userVal / Math.max(median, 0.01);
    }
    if (ratio >= 1.3) return '🟢🟢🟢🟢⚪';
    if (ratio >= 1.0) return '🟢🟢🟢⚪⚪';
    if (ratio >= 0.7) return '🟡🟡⚪⚪⚪';
    return '🔴🔴⚪⚪⚪';
  };

  const assess = (userVal, median, good, bad, lowerIsBetter = false) => {
    if (userVal === null) return 'Not disclosed';
    if (lowerIsBetter) {
      if (good !== undefined && userVal <= good) return '✅ Strong';
      if (bad !== undefined && userVal >= bad) return '🔴 Critical';
      if (userVal <= median) return '✅ At/above median';
      return '⚠️ Below median';
    } else {
      if (good !== undefined && userVal >= good) return '✅ Strong';
      if (bad !== undefined && userVal <= bad) return '🔴 Critical';
      if (userVal >= median) return '✅ At/above median';
      return '⚠️ Below median';
    }
  };

  // Map user fields to benchmark keys
  const metrics = [
    { key: 'churnMonthly', label: 'Monthly Churn', userField: p.churnRate, unit: '%', lowerBetter: true },
    { key: 'cac', label: 'CAC', userField: p.cac, unit: '€', lowerBetter: true },
    { key: 'ltv', label: 'LTV', userField: p.ltv, unit: '€', lowerBetter: false },
    { key: 'salesCycleDays', label: 'Sales Cycle', userField: p.salesCycle, unit: ' days', lowerBetter: true },
    { key: 'avgDealSize', label: 'Avg Deal Size', userField: p.avgDealSize, unit: '€', lowerBetter: false },
    { key: 'winRate', label: 'Win Rate', userField: p.winRate, unit: '%', lowerBetter: false },
    { key: 'netRevenueRetention', label: 'Net Revenue Retention', userField: p.nrr, unit: '%', lowerBetter: false },
    { key: 'burnMultiple', label: 'Burn Multiple', userField: null, unit: 'x', lowerBetter: true },
    { key: 'grossMargin', label: 'Gross Margin', userField: null, unit: '%', lowerBetter: false },
  ];

  let scorecardRows = 0;
  for (const m of metrics) {
    const bmData = bm[m.key];
    if (!bmData || bmData.median === null || bmData.median === undefined) continue;
    const userVal = num(m.userField);
    const med = bmData.median;
    const good = bmData.good;
    const bad = bmData.bad;

    const userDisplay = userVal !== null ? `${userVal}${m.unit}` : '*Not disclosed*';
    const medDisplay = `${med}${m.unit}`;
    const goodDisplay = good !== undefined ? `${good}${m.unit}` : '—';
    const visual = gauge(userVal, med, good, bad, m.lowerBetter);
    const assessment = assess(userVal, med, good, bad, m.lowerBetter);

    lines.push(`| ${m.label} | ${userDisplay} | ${medDisplay} | ${goodDisplay} | ${assessment} | ${visual} |`);
    scorecardRows++;
  }

  if (scorecardRows === 0) return '';

  lines.push('');
  lines.push('> 🟢 = strong / at or above good threshold | 🟡 = near median | 🔴 = below median or critical | ⚪ = room to grow');
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHART DATA BUILDER — structured data for frontend Chart.js rendering
// ═══════════════════════════════════════════════════════════════════════════════

function buildChartData(profile, stageData) {
  if (!stageData?.benchmarks) return null;
  const bm = stageData.benchmarks;
  const p = profile;

  const num = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[^0-9.,]/g, '').replace(',', '.');
    if (s === '') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  // Metrics definition (same as scorecard)
  const metricDefs = [
    { key: 'churnMonthly', label: 'Monthly Churn', userField: p.churnRate, unit: '%', lowerBetter: true },
    { key: 'cac', label: 'CAC', userField: p.cac, unit: '€', lowerBetter: true },
    { key: 'ltv', label: 'LTV', userField: p.ltv, unit: '€', lowerBetter: false },
    { key: 'salesCycleDays', label: 'Sales Cycle', userField: p.salesCycle, unit: 'days', lowerBetter: true },
    { key: 'avgDealSize', label: 'Avg Deal Size', userField: p.avgDealSize, unit: '€', lowerBetter: false },
    { key: 'winRate', label: 'Win Rate', userField: p.winRate, unit: '%', lowerBetter: false },
    { key: 'netRevenueRetention', label: 'NRR', userField: p.nrr, unit: '%', lowerBetter: false },
    { key: 'grossMargin', label: 'Gross Margin', userField: null, unit: '%', lowerBetter: false },
  ];

  // Build radar data: normalize user vs median to 0-100 scale (100 = best)
  const radarLabels = [];
  const radarUser = [];
  const radarMedian = [];
  const radarGood = [];

  // Build bar data: normalized 0-100 values (like radar) for fair cross-metric comparison
  const barLabels = [];
  const barUser = [];
  const barMedian = [];
  const barGood = [];
  const barUnits = [];
  let barRawUser = [];
  let barRawMedian = [];

  for (const m of metricDefs) {
    const bmData = bm[m.key];
    if (!bmData || bmData.median === null || bmData.median === undefined) continue;

    const userVal = num(m.userField);
    const med = bmData.median;
    const good = bmData.good;

    // For bar chart: include all metrics even without user data
    barLabels.push(m.label);
    barUnits.push(m.unit);

    // Normalize to 0-100 for bar chart (same logic as radar)
    const goodVal = good !== undefined ? good : (m.lowerBetter ? med * 0.5 : med * 2);
    const badVal = bmData.bad !== undefined ? bmData.bad : (m.lowerBetter ? med * 2 : med * 0.3);

    const normForBar = (val) => {
      if (val === null || val === undefined) return null;
      if (m.lowerBetter) {
        if (val <= goodVal) return 100;
        if (val >= badVal) return 0;
        return Math.round(100 * (badVal - val) / (badVal - goodVal));
      } else {
        if (val >= goodVal) return 100;
        if (val <= badVal) return 0;
        return Math.round(100 * (val - badVal) / (goodVal - badVal));
      }
    };

    barUser.push(normForBar(userVal));
    barMedian.push(normForBar(med));
    barGood.push(100); // Good threshold always normalizes to 100
    // Also store raw values for tooltips
    barRawUser.push(userVal);
    barRawMedian.push(med);

    // For radar chart: only metrics where user has data
    if (userVal !== null) {
      radarLabels.push(m.label);
      // Normalize to 0-100 where 100 = best possible
      const goodVal = good !== undefined ? good : (m.lowerBetter ? med * 0.5 : med * 2);
      const badVal = bmData.bad !== undefined ? bmData.bad : (m.lowerBetter ? med * 2 : med * 0.3);

      const normalize = (val) => {
        if (m.lowerBetter) {
          // Lower is better: good=100, bad=0
          if (val <= goodVal) return 100;
          if (val >= badVal) return 0;
          return Math.round(100 * (badVal - val) / (badVal - goodVal));
        } else {
          // Higher is better: good=100, bad=0
          if (val >= goodVal) return 100;
          if (val <= badVal) return 0;
          return Math.round(100 * (val - badVal) / (goodVal - badVal));
        }
      };

      radarUser.push(Math.max(0, Math.min(100, normalize(userVal))));
      radarMedian.push(Math.max(0, Math.min(100, normalize(med))));
      radarGood.push(100); // Good threshold is always 100 on normalized scale
    }
  }

  if (barLabels.length === 0) return null;

  return {
    stageLabel: stageData.label,
    radar: {
      labels: radarLabels,
      datasets: {
        user: radarUser,
        median: radarMedian,
        good: radarGood
      }
    },
    bar: {
      labels: barLabels,
      datasets: {
        user: barUser,
        median: barMedian,
        good: barGood
      },
      units: barUnits,
      rawUser: barRawUser,
      rawMedian: barRawMedian
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD DATA BUILDER — structured data for interactive 90-day tracking
// ═══════════════════════════════════════════════════════════════════════════════

function buildDashboardData(profile, stageData) {
  if (!stageData?.benchmarks) return null;
  const bm = stageData.benchmarks;
  const p = profile;

  const num = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    const s = String(v).replace(/[^0-9.,]/g, '').replace(',', '.');
    if (s === '') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  const metricDefs = [
    { key: 'churnMonthly', label: 'Monthly Churn', userField: p.churnRate, unit: '%', lowerBetter: true },
    { key: 'cac', label: 'Customer Acquisition Cost', userField: p.cac, unit: '€', lowerBetter: true },
    { key: 'ltv', label: 'Lifetime Value', userField: p.ltv, unit: '€', lowerBetter: false },
    { key: 'salesCycleDays', label: 'Sales Cycle', userField: p.salesCycle, unit: 'days', lowerBetter: true },
    { key: 'avgDealSize', label: 'Avg Deal Size', userField: p.avgDealSize, unit: '€', lowerBetter: false },
    { key: 'winRate', label: 'Win Rate', userField: p.winRate, unit: '%', lowerBetter: false },
    { key: 'netRevenueRetention', label: 'Net Revenue Retention', userField: p.nrr, unit: '%', lowerBetter: false },
    { key: 'grossMargin', label: 'Gross Margin', userField: null, unit: '%', lowerBetter: false },
  ];

  const metrics = [];
  for (const m of metricDefs) {
    const bmData = bm[m.key];
    if (!bmData || bmData.median === null || bmData.median === undefined) continue;
    const userVal = num(m.userField);
    if (userVal === null) continue; // Dashboard only tracks metrics with known current values

    const med = bmData.median;
    const good = bmData.good !== undefined ? bmData.good : (m.lowerBetter ? med * 0.5 : med * 2);
    const bad = bmData.bad !== undefined ? bmData.bad : (m.lowerBetter ? med * 2 : med * 0.3);

    // 90-day target: move 60% toward "good" from current
    let target90;
    if (m.lowerBetter) {
      target90 = userVal <= good ? userVal : Math.round((userVal - (userVal - good) * 0.6) * 100) / 100;
    } else {
      target90 = userVal >= good ? userVal : Math.round((userVal + (good - userVal) * 0.6) * 100) / 100;
    }

    // Health score 0-100
    let healthScore;
    if (m.lowerBetter) {
      if (userVal <= good) healthScore = 100;
      else if (userVal >= bad) healthScore = 0;
      else healthScore = Math.round(100 * (bad - userVal) / (bad - good));
    } else {
      if (userVal >= good) healthScore = 100;
      else if (userVal <= bad) healthScore = 0;
      else healthScore = Math.round(100 * (userVal - bad) / (good - bad));
    }
    healthScore = Math.max(0, Math.min(100, healthScore));

    metrics.push({
      key: m.key,
      label: m.label,
      unit: m.unit,
      lowerBetter: m.lowerBetter,
      current: userVal,
      stageMedian: med,
      good,
      bad,
      target90Day: target90,
      healthScore
    });
  }

  if (metrics.length === 0) return null;

  return {
    companyName: p.companyName || 'Company',
    stageLabel: stageData.label,
    generatedAt: new Date().toISOString(),
    metrics
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPERATING MODEL BLOCK — build context from collected profile data
// ═══════════════════════════════════════════════════════════════════════════════

function buildOperatingModelContext(profile) {
  const fields = [
    ['Current Situation', profile.currentSituation],
    ['Org Structure', profile.orgStructure],
    ['Decision Making', profile.decisionMaking],
    ['Key Dependencies', profile.keyDependencies],
    ['Team Morale / Culture', profile.teamMorale],
    ['Systems Landscape', profile.systemsLandscape],
    ['Roadmap (6-12mo)', profile.roadmap],
    ['Planned Changes', profile.plannedChanges],
    ['Team Enablement', profile.teamEnablement],
    ['Who Closes Deals', profile.whoCloses],
    ['Founder Involvement', profile.founderInvolvement],
    ['CRM', profile.crm],
    ['Tools', profile.tools],
    ['Automation Level', profile.automationLevel],
  ];

  const confirmed = [];
  const gaps = [];
  for (const [label, value] of fields) {
    if (value && typeof value === 'string' && value.trim()) {
      confirmed.push(`  • ${label}: ${value.trim()}`);
    } else {
      gaps.push(label);
    }
  }

  if (confirmed.length === 0) return '(No operating model data collected during discovery)';

  let block = 'CONFIRMED OPERATING MODEL DATA:\n' + confirmed.join('\n');
  if (gaps.length > 0) {
    block += '\n\nGAPS (not disclosed — flag as "To be assessed" in Operating Model section):\n  ' + gaps.join(', ');
  }
  return block;
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE AUDIT — Tavily API for real-time market data
// ═══════════════════════════════════════════════════════════════════════════════

async function liveAudit(companyName, industry, stage, tavilyKey) {
  if (!tavilyKey) return null;
  try {
    const queries = [
      `${industry || 'B2B SaaS'} market size growth 2025 2026`,
      `${stage || 'startup'} SaaS unit economics benchmarks CAC LTV churn 2025`
    ];
    const results = [];
    for (const q of queries) {
      try {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: tavilyKey, query: q, search_depth: "basic", max_results: 3, include_answer: true })
        });
        if (r.ok) {
          const d = await r.json();
          if (d.answer) results.push({ query: q, answer: d.answer.slice(0, 500) });
        }
      } catch { /* skip failed queries */ }
    }
    if (results.length === 0) return null;
    return results.map(r => `Q: ${r.query}\nA: ${r.answer}`).join('\n\n');
  } catch (e) {
    console.warn('[LiveAudit]', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { sessionData } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'API key missing' });

    const p = sessionData?.profile || {};
    const companyName = p.companyName || 'Company';
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── Stage Resolution ──
    const stageKey = sessionData?.resolvedStage || resolveStage(p.companyStage || p.stage);
    const bm = loadBenchmarks();
    const stageData = bm.stages?.[stageKey] || bm.stages?.seed_startup;
    const marketCtx = bm.marketContext2026 || {};

    // ── Pre-Analysis Guardrail ──
    const feasibilityFlags = runFeasibilityChecks(p, stageData);
    console.log(`[Report v12] Stage: ${stageKey}, Flags: ${feasibilityFlags.length}`);

    // ── Live Market Audit ──
    let liveData = null;
    try {
      liveData = await liveAudit(companyName, p.industry, stageData?.label, tavilyKey);
    } catch (e) {
      console.warn('[Report v12] Live audit skipped:', e.message);
    }

    // ── Benchmark Scorecard ──
    const scorecardBlock = buildBenchmarkScorecard(p, stageData);

    // ── Chart Data for frontend rendering ──
    const chartData = buildChartData(p, stageData);

    // ── Dashboard Data for interactive 90-day tracking ──
    const dashboardData = buildDashboardData(p, stageData);

    // ── Operating Model Context ──
    const operatingModelBlock = buildOperatingModelContext(p);

    // ── Build confirmed/unknown split ──
    function has(v) {
      if (Array.isArray(v)) return v.length > 0 ? v.join('; ') : null;
      return (v && typeof v === 'string' && v.trim()) ? v.trim() : null;
    }

    const allFields = {
      'Company': p.companyName, 'Website': p.website, 'Industry': p.industry,
      'Business Model': p.businessModel, 'Stage': p.stage, 'Company Stage': p.companyStage,
      'Revenue': p.revenue, 'Revenue Growth': p.revenueGrowth, 'Team Size': p.teamSize,
      'Team Roles': p.teamRoles, 'Funding': p.funding, 'Runway': p.runway,
      'Product': p.productDescription, 'Pricing Model': p.pricingModel, 'Pricing Range': p.pricingRange,
      'Competitive Landscape': p.competitiveLandscape, 'Differentiator': p.differentiator,
      'ICP Buyer': p.icpTitle, 'ICP Company Size': p.icpCompanySize,
      'ICP Industry': p.icpIndustry, 'ICP Pain Points': p.icpPainPoints,
      'ICP Decision Process': p.icpDecisionProcess,
      'Sales Motion': p.salesMotion, 'Channels': p.channels, 'Best Channel': p.bestChannel,
      'Avg Deal Size': p.avgDealSize, 'Sales Cycle': p.salesCycle, 'CAC': p.cac, 'LTV': p.ltv,
      'Content Strategy': p.contentStrategy, 'Lead Gen': p.leadGenMethod,
      'Sales Process': p.salesProcess, 'Process Stages': p.processStages,
      'Who Closes': p.whoCloses, 'Founder Involvement': p.founderInvolvement,
      'Win Rate': p.winRate, 'Lost Deal Reasons': p.lostDealReasons, 'Objections': p.mainObjections,
      'Main Bottleneck': p.mainBottleneck, 'Secondary Bottleneck': p.secondaryBottleneck,
      'Churn Rate': p.churnRate, 'Churn Reasons': p.churnReasons,
      'Expansion Revenue': p.expansionRevenue, 'NRR': p.nrr,
      'CRM': p.crm, 'Tools': p.tools, 'Automation Level': p.automationLevel,
      'Onboarding': p.onboardingProcess, 'Customer Success': p.customerSuccess,
      'Diagnosed Problems': p.diagnosedProblems, 'Root Causes': p.rootCauses,
      'User Priority': p.userPriority, 'Past Attempts': p.pastAttempts,
      'Budget Level': p.budgetLevel, 'Growth Target': p.growthTarget,
      'Constraints': p.constraints, 'Additional Context': p.additionalContext
    };

    const confirmed = [];
    const unknown = [];
    for (const [label, value] of Object.entries(allFields)) {
      const v = has(value);
      if (v) confirmed.push(`✅ ${label}: ${v}`);
      else unknown.push(label);
    }

    // ── Transcript ──
    let transcript = '(no conversation recorded)';
    if (sessionData?.transcript?.length > 0) {
      transcript = sessionData.transcript.map((t, i) => {
        const who = t.role === 'user' ? 'USER' : 'REVENUE ARCHITECT';
        return `[Turn ${Math.floor(i / 2) + 1}] ${who}:\n${t.text}`;
      }).join('\n\n---\n\n');
    }

    // ── Language ──
    const allUserText = (sessionData?.transcript || []).filter(t => t.role === 'user').map(t => t.text).join(' ');
    const itCount = (allUserText.match(/\b(che|sono|abbiamo|nostro|nostra|clienti|vendite|azienda|problema|siamo|facciamo|questo|anche|molto|come|alla|delle|della)\b/gi) || []).length;
    const lang = itCount > 5
      ? 'The user spoke ITALIAN throughout the conversation. Write the ENTIRE report in Italian — every heading, every sentence, everything.'
      : 'Write in the language the user used. Default to English.';

    // ── Format benchmarks ──
    let benchmarkBlock = '(No stage-specific benchmarks available)';
    if (stageData?.benchmarks) {
      const lines = [`Stage: ${stageData.label}`];
      for (const [metric, data] of Object.entries(stageData.benchmarks)) {
        if (data.median !== null && data.median !== undefined) {
          const cur = data.currency ? ` ${data.currency}` : '';
          const unit = data.unit === 'percent' ? '%' : cur;
          let line = `  ${metric}: median=${data.median}${unit}`;
          if (data.good !== undefined) line += `, good=${data.good}${unit}`;
          if (data.bad !== undefined) line += `, bad=${data.bad}${unit}`;
          if (data.source) line += ` (${data.source})`;
          lines.push(line);
        }
      }
      benchmarkBlock = lines.join('\n');
    }

    // ── Guardrail block ──
    let guardrailBlock = '';
    if (feasibilityFlags.length > 0) {
      guardrailBlock = `\n═══════════════════════════════════════════\n⚠️ PRE-ANALYSIS GUARDRAIL — FEASIBILITY FLAGS\n(Address these EXPLICITLY in the report. Do NOT ignore them.)\n═══════════════════════════════════════════\n${feasibilityFlags.map((f, i) => `FLAG ${i + 1} [${f.severity.toUpperCase()}] — ${f.type}\nIssue: ${f.issue}\nDetail: ${f.detail}\nRecommended Action: ${f.recommendation}\n`).join('\n')}\nThese flags represent DATA-DRIVEN contradictions detected in the user's profile.\nYou MUST address each flag in the "Risk Mitigation" or "Diagnostic Findings" section.\nDo not hallucinate solutions that ignore these constraints.`;
    }

    // ── Playbook block ──
    let playbookBlock = '';
    if (stageData?.playbook) {
      const pb = stageData.playbook;
      const antiPatterns = (pb.antiPatterns || []).map(ap => `  ⛔ ${ap}`).join('\n');
      const recActions = (pb.recommendedActions || []).map(a => `  → ${a}`).join('\n');
      playbookBlock = `\n═══════════════════════════════════════════\nSTAGE PLAYBOOK: ${stageData.label}\n═══════════════════════════════════════════\nFocus: ${pb.focus}\nSales Approach: ${pb.salesApproach}\nRecommended Tech Stack: ${pb.techStack?.join(', ') || 'N/A'}\nKey Metrics: ${pb.keyMetrics?.join(', ') || 'N/A'}\nBudget Guidance: Tools max ~€${pb.budgetGuidance?.toolSpend?.max || '?'}/mo, Marketing max ~€${pb.budgetGuidance?.marketingSpend?.max || '?'}/mo\n\nANTI-PATTERNS:\n${antiPatterns || '  (none)'}\n\nRECOMMENDED ACTIONS:\n${recActions}`;
    }

    // ── Market context block ──
    let marketBlock = '';
    if (marketCtx.globalSaaSMarket) {
      marketBlock = `\n═══════════════════════════════════════════\nMARKET CONTEXT 2025-2026\n═══════════════════════════════════════════\nGlobal SaaS Market: ${marketCtx.globalSaaSMarket?.size || 'N/A'} at ${marketCtx.globalSaaSMarket?.growthRate || 'N/A'} CAGR (${marketCtx.globalSaaSMarket?.source || ''})\nB2B Buying: ~${marketCtx.b2bBuyingBehavior?.avgStakeholders || 'N/A'} stakeholders per deal, ${marketCtx.b2bBuyingBehavior?.selfServePreference || 'N/A'} (${marketCtx.b2bBuyingBehavior?.source || ''})\nRevOps Adoption: ${marketCtx.revOpsAdoption?.companiesWithRevOps || 'N/A'} of companies, ${marketCtx.revOpsAdoption?.revOpsTeamGrowth || 'N/A'} YoY growth (${marketCtx.revOpsAdoption?.source || ''})\nAI in Sales: ${marketCtx.aiImpact?.companiesUsingAIinSales || 'N/A'} adoption, ${marketCtx.aiImpact?.productivityGain || 'N/A'} SDR productivity gain (${marketCtx.aiImpact?.source || ''})\nRevOps Audit Benchmark: €${marketCtx.benchmarkingServices?.revOpsAuditCost?.low || '?'}-${marketCtx.benchmarkingServices?.revOpsAuditCost?.high || '?'} (${marketCtx.benchmarkingServices?.revOpsAuditCost?.note || ''})`;
    }

    // ── Live audit block ──
    let liveAuditBlock = '';
    if (liveData) {
      liveAuditBlock = `\n═══════════════════════════════════════════\n📡 LIVE MARKET DATA (real-time lookup — use to validate/enrich)\n═══════════════════════════════════════════\n${liveData}`;
    }

    const prompt = `Generate a Strategic Growth Plan for ${companyName}.

ROLE: Senior B2B revenue strategist. McKinsey-caliber analysis, but practical and actionable.
OUTPUT: Pure Markdown. No JSON, no code fences. Clean Markdown only.
LANGUAGE: ${lang}

═══════════════════════════════════════════
PRIMARY SOURCE: FULL CONVERSATION TRANSCRIPT
(This is the ground truth. Reference specific things the user said.)
═══════════════════════════════════════════
${transcript}

═══════════════════════════════════════════
CONFIRMED PROFILE DATA (extracted from conversation)
═══════════════════════════════════════════
${confirmed.join('\n')}

═══════════════════════════════════════════
UNKNOWN FIELDS (NOT provided by user — DO NOT INVENT)
═══════════════════════════════════════════
${unknown.join(', ')}

═══════════════════════════════════════════
STAGE-SPECIFIC BENCHMARKS (KBCM, Statista, Pavilion, OpenView, Bessemer)
═══════════════════════════════════════════
${benchmarkBlock}
${playbookBlock}
${marketBlock}
${guardrailBlock}
${liveAuditBlock}

═══════════════════════════════════════════
BENCHMARK SCORECARD (pre-computed — embed in report)
═══════════════════════════════════════════
${scorecardBlock || '(Insufficient user data for scorecard — generate comparison table from available metrics)'}

═══════════════════════════════════════════
OPERATING MODEL DATA (collected during discovery)
═══════════════════════════════════════════
${operatingModelBlock}

═══════════════════════════════════════════
WEBSITE SCAN
═══════════════════════════════════════════
${sessionData?.scrapedSummary || 'N/A'}

═══════════════════════════════════════════
REPORT STRUCTURE — v12 STRATEGIC NARRATIVE FORMAT
═══════════════════════════════════════════

# Strategic Growth Plan
## ${companyName} | ${today}

---

## Strategic Narrative

Replace the generic "Executive Summary" with a STRATEGIC NARRATIVE using this framework:

### The Current State
Describe where ${companyName} stands today using ONLY confirmed data. Revenue, team, model, GTM motion, tools. Be precise and factual. Reference the stage benchmarks: "At the ${stageData?.label || 'current'} stage, the median [metric] is [X] — ${companyName} is [above/below/at] this benchmark."

### The Hard Truth
State the 3 diagnosed problems bluntly. Each one gets a finding_id (F1, F2, F3). Connect them into a CAUSAL CHAIN — explain how F1 causes F2 which amplifies F3. This is where you show systems thinking. Reference what the user actually said in conversation.

### The Unlock
The core hypothesis: what ONE strategic shift would break the negative cycle? This should be connected to the user's stated priority: "${has(p.userPriority) || 'not specified'}". Explain the mechanism — how this unlock cascades into solving the other problems.

### The Risk of Inaction
What happens if ${companyName} does nothing? Project forward 6-12 months with specific consequences. Use stage benchmarks to quantify: "Companies at ${stageData?.label || 'this'} stage with >X% churn typically [outcome]." Be direct and evidence-based, not alarmist.

---

## Company Profile

| Dimension | Current State | Stage Benchmark (${stageData?.label || 'N/A'}) | Assessment |
|-----------|--------------|----------------------------------------------|------------|
[Fill with CONFIRMED data vs. stage benchmarks. For unknown fields: "Not disclosed" | "N/A" | "To be assessed"]

Key comparisons: Burn Multiple, CAC, LTV:CAC ratio, churn, Magic Number, Revenue per Employee.

---

## ICP & Go-to-Market

Analyze their ICP, positioning, and channel effectiveness using confirmed data.
Apply April Dunford framework and Jobs-to-be-Done where data allows.
If ICP is vague, flag it as a finding.
Compare to stage-appropriate GTM patterns from the playbook above.

---

## Diagnostic Findings

For each of the ${(p.diagnosedProblems || []).length || 3} diagnosed problems:

### Finding F[N]: [Problem Name]
- **finding_id:** F[N] (used for golden thread traceability)
- **Severity:** 🔴/🟡/🟢
- **Evidence:** Reference what the user ACTUALLY said in the conversation
- **Root Cause:** Why this problem exists (reference confirmed data)
- **Stage Benchmark Comparison:** Compare to ${stageData?.label || 'stage'} benchmarks
- **Revenue Impact:** Estimate only if you have data to support it
- **Anti-Pattern Check:** Does this map to any known anti-pattern for their stage?

${feasibilityFlags.length > 0 ? `### ⚠️ Feasibility Flags (System-Detected Contradictions)\n${feasibilityFlags.map((f, i) => `**Flag ${i + 1}: ${f.issue}** [${f.severity.toUpperCase()}]\n${f.detail}\n→ ${f.recommendation}`).join('\n\n')}` : ''}

---

## Root Cause Analysis — Causal Chain

Systems thinking: F1 → causes/amplifies → F2 → which leads to → F3.
Reference confirmed data only.

---

## Strategic Recommendations

CRITICAL: Every recommendation MUST trace back to a parent finding via finding_id. No orphaned recommendations.

CREATIVITY MANDATE: Go BEYOND classic GTM playbooks. The user is paying for strategic insight they cannot Google. For each priority:
- Start with the OBVIOUS play (what any consultant would say), then ELEVATE IT with a creative twist that fits their specific situation.
- Think adjacently: what would a company in a DIFFERENT industry do with this same problem? What counterintuitive approach could work?
- Consider asymmetric bets: low-cost experiments with outsized upside potential.
- Look for leverage points that multiply impact — one action that solves multiple findings simultaneously.
- Reference real-world unconventional tactics: co-opetition strategies, community-led motions, reverse trials, customer-as-channel models, founder-brand plays, micro-partnerships, content flywheels, signal-based outbound, dark social strategies, product-led narratives, etc.
- If the company's stage/resources suggest a traditional play won't work, propose the scrappy alternative that will.

### Priority 1: [Based on user's stated priority: "${has(p.userPriority) || 'not specified'}"] — Weeks 1-4
- **parent_finding_id:** F[N]
- **the_obvious_play:** What the standard playbook says
- **the_creative_edge:** The non-obvious twist or unconventional approach that makes this recommendation uniquely powerful for THIS company
- **trade_off / negative_externality:** What is the downside or tension?
- **prerequisite_for:** What does completing this enable in Priority 2?
- Week-by-week plan with specific actions, deliverables, success metrics

### Priority 2 — Weeks 4-8
- **parent_finding_id:** F[N]
- **the_obvious_play:** [standard approach]
- **the_creative_edge:** [the unconventional angle]
- **trade_off / negative_externality:** [specific tension]
- **depends_on:** What from Priority 1 must be done first?
- **prerequisite_for:** What does this enable in Priority 3?

### Priority 3 — Weeks 8-12
- **parent_finding_id:** F[N]
- **the_obvious_play:** [standard approach]
- **the_creative_edge:** [the unconventional angle]
- **trade_off / negative_externality:** [specific tension]
- **depends_on:** What from Priority 2 must be done first?

---

## 90-Day Roadmap — Sequential with Second-Order Effects

### Month 1: Foundation (Weeks 1-4)
| Week | Focus | Actions | Deliverable | KPI | Enables (→) |
|------|-------|---------|-------------|-----|-------------|
[4 rows. "Enables" column shows what this action sets up for Month 2]

**Month 1 → Month 2 Handoff:** What completed work from M1 makes M2 possible?

### Month 2: Acceleration (Weeks 5-8)
| Week | Focus | Actions | Deliverable | KPI | Depends On (←) | Enables (→) |
|------|-------|---------|-------------|-----|-----------------|-------------|
[4 rows]

### Month 3: Scale (Weeks 9-12)
| Week | Focus | Actions | Deliverable | KPI | Depends On (←) |
|------|-------|---------|-------------|-----|-----------------|
[4 rows]

---

## Benchmark Scorecard — ${companyName} vs. ${stageData?.label || 'Stage'} Median

Embed the pre-computed BENCHMARK SCORECARD above as-is (it contains visual gauge indicators).
Then ADD a brief narrative (3-5 sentences) interpreting the scorecard:
- Which metrics are strengths?
- Which are critical gaps?
- How do the gaps connect to the diagnosed findings (F1, F2, F3)?
- What does this pattern tell us about the company's stage-readiness?

### Market Context Illustration

Using the MARKET CONTEXT 2026 data and LIVE MARKET DATA (if available), write a brief section (3-4 sentences) placing ${companyName} within the broader market:
- Industry growth trajectory and what it means for their timing
- How their GTM motion compares to market trends (self-serve preference, AI adoption, RevOps maturity)
- One insight from market data that directly impacts their 90-day plan

---

## Operating Model Design

Using the OPERATING MODEL DATA collected during discovery, design a target operating model for ${companyName}.

### Current Operating Model Assessment

| Dimension | Current State | Stage-Appropriate Target | Gap | Priority |
|-----------|--------------|-------------------------|-----|----------|
| Org Structure | [from data] | [stage recommendation] | [gap analysis] | 🔴/🟡/🟢 |
| Decision Flow | [from data] | [stage recommendation] | [gap analysis] | 🔴/🟡/🟢 |
| Key Dependencies | [from data] | [stage recommendation] | [gap analysis] | 🔴/🟡/🟢 |
| Systems & Tools | [from data] | [stage recommendation] | [gap analysis] | 🔴/🟡/🟢 |
| Team Enablement | [from data] | [stage recommendation] | [gap analysis] | 🔴/🟡/🟢 |
| Automation Maturity | [from data] | [stage recommendation] | [gap analysis] | 🔴/🟡/🟢 |

For UNKNOWN dimensions, write: "Not disclosed — recommended assessment area"

### Target Operating Model (90-Day Horizon)

Describe the RECOMMENDED operating model for ${companyName} at the end of the 90-day sprint:
1. **Team Structure & Roles**: Who should own what? Where should new hires slot in? What roles are missing?
2. **Decision Flow**: How should key decisions (pricing, hiring, deal approval) flow? Where should founder dependency reduce?
3. **Systems Architecture**: Which tools to keep, replace, or add — mapped to the RECOMMENDED TECH STACK for ${stageData?.label || 'their'} stage
4. **Process Design**: Key processes that need to exist (lead handoff, deal review, customer onboarding, QBR)
5. **Metrics & Cadence**: What should be measured, by whom, how often (daily/weekly/monthly rituals)

Connect EVERY operating model recommendation to a parent_finding_id (F1, F2, F3) and show how the new operating model resolves the diagnosed problems.

---

## Metrics Dashboard

| Metric | Current | ${stageData?.label || 'Stage'} Median | 90-Day Target | How to Track | Source |
|--------|---------|--------------------------------------|---------------|-------------|--------|

---

## Risk Mitigation

| Risk | Probability | Impact | Mitigation | parent_finding_id |
|------|------------|--------|------------|-------------------|
[4-5 risks. Include feasibility flags. Every risk traces to a finding.]

---

## Recommended Tools — Stage-Calibrated

Do NOT just list tools. For each tool, show HOW it fits into a workflow — the trigger, the action, and the outcome. The user needs to see their future operating rhythm, not a shopping list.

| Category | Tool | ~Cost/mo | Why | Stage Fit |
|----------|------|----------|-----|----------|
[Tools appropriate for ${stageData?.label || 'their'} stage. Max ~€${stageData?.playbook?.budgetGuidance?.toolSpend?.max || '?'}/mo total]

### Workflow Architecture

For each major tool combination above, describe the WORKFLOW it enables. Use this format:

**Workflow: [Name — e.g. "Signal-to-Meeting Pipeline"]**
→ Trigger: [What starts the workflow — e.g. "Lead scores above 50 in HubSpot" or "Champion visits pricing page 3x"]
→ Action Chain: [What happens automatically and what requires human input — e.g. "Auto-enrich via Clay → Slack alert to AE → Personalized sequence via Instantly"]
→ Owner: [Who is responsible for this workflow]
→ Outcome: [What success looks like — e.g. "Qualified meeting booked within 48h of trigger"]
→ Connects To: [Next workflow in the chain — e.g. "feeds into Deal Progression workflow"]

Design 3-4 core workflows that form the OPERATING BACKBONE — these should chain together into a coherent system, not sit in isolation. Show how data flows between workflows.

IMPORTANT: Keep workflow descriptions conceptual and outcome-oriented. Do NOT write step-by-step setup instructions or click-by-click guides. The user should understand WHAT the machine looks like when running, not how to build it.

---

## Quick Wins

| # | Action | parent_finding_id | Expected Impact | Effort | Creative Angle |
|---|--------|-------------------|-----------------|--------|----------------|
[5 high-impact actions executable this week. At least 2 should be NON-OBVIOUS — things competitors aren't doing. The "Creative Angle" column should explain WHY this is smarter than the standard approach.]

---

## Next Steps

1. Immediate (This week)
2. Short-term (Weeks 2-4)
3. Medium-term (Month 2-3)
4. Ongoing cadence

---

*Generated by Revenue Architect by Panoramica — Validated Market Audit*
*Benchmark Sources: KBCM SaaS Survey, Statista, Pavilion/BenchSights, OpenView, Bessemer Cloud Index*

═══════════════════════════════════════════
ANTI-HALLUCINATION RULES
═══════════════════════════════════════════
1. The CONVERSATION TRANSCRIPT is your primary source. Reference it: "As discussed...", "You mentioned that..."
2. CONFIRMED fields = use freely. UNKNOWN fields = write "Not disclosed" or "To be assessed". NEVER invent.
3. Estimates MUST be labeled: "~€X (estimated based on [your reasoning])"
4. If a section lacks data, say so: "This section requires additional data. Based on what we know..."
5. Every diagnostic finding MUST cite evidence from the conversation.
6. Minimum 3000 words.
7. Write for the company's leadership team — professional, specific, actionable.
8. GOLDEN THREAD: Every recommendation, quick win, and risk MUST have a parent_finding_id (F1, F2, or F3). No orphaned recommendations.
9. TRADE-OFFS: Every priority must include a negative_externality.
10. SECOND-ORDER EFFECTS: Month 1 must enable Month 2, Month 2 must enable Month 3. Not a flat list.
11. STAGE-CALIBRATION: All benchmarks, tools, and budget guidance must fit ${stageData?.label || 'their'} stage.
18. CREATIVITY OVER PLAYBOOK: Do NOT produce generic GTM advice anyone could find in a blog post. Every recommendation section must contain at least one insight that is SPECIFIC to this company's unique situation and would surprise the reader. Think like a fractional CRO who has seen 200 companies — what pattern-matched insight applies here?
19. TOOL WORKFLOWS: When recommending tools, ALWAYS describe the workflow they enable — trigger, action chain, owner, outcome. A tool without a workflow is shelfware. Show 3-4 interconnected workflows that form the company's new operating backbone.
20. ACTIONABLE ≠ GENERIC: "Improve your sales process" is not actionable. "Run a 2-week pipeline audit where your AE records every objection verbatim, then cluster them into 3 categories to build an objection-handling playbook" is actionable. Every recommendation must pass the test: could someone START executing this tomorrow morning?
12. FEASIBILITY FLAGS: Address detected contradictions explicitly. Do not produce a roadmap that ignores them.
13. Use NARROW BENCHMARK DATA from KBCM, Statista, Pavilion. Cite the source.
14. BENCHMARK SCORECARD: Embed the pre-computed scorecard with visual gauges. Add narrative interpretation connecting gaps to findings.
15. OPERATING MODEL: Use confirmed operating model data to design a concrete target model. For gaps, flag them as assessment areas. Every OM recommendation must trace to a finding_id.
16. MARKET ILLUSTRATIONS: When citing market data (SaaS market size, AI adoption, RevOps trends), frame it as context that impacts the company's specific situation. Don't just cite — connect it to their 90-day plan.
17. For companies with disclosed metrics, generate a BENCHMARK POSITION narrative: "Your [metric] of [X] places you in the [top/bottom] [N]th percentile for ${stageData?.label || 'your'} stage companies (source: [benchmark])." Use this to validate urgency.`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 16000 }
        })
      }
    );

    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const data = await resp.json();
    let md = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!md) throw new Error('Empty report');
    md = md.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();

    return res.status(200).json({
      report: md,
      filename: `Growth_Plan_${companyName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`,
      pdf_base64: null,
      feasibility_flags: feasibilityFlags,
      stage: stageKey,
      chart_data: chartData,
      dashboard_data: dashboardData
    });

  } catch (e) {
    console.error('[Report v12]', e);
    return res.status(500).json({ error: e.message });
  }
}
