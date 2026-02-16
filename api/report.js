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
      'Expansion Revenue': p.expansionRevenue,
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

### Priority 1: [Based on user's stated priority: "${has(p.userPriority) || 'not specified'}"] — Weeks 1-4
- **parent_finding_id:** F[N]
- **trade_off / negative_externality:** What is the downside or tension?
- **prerequisite_for:** What does completing this enable in Priority 2?
- Week-by-week plan with specific actions, deliverables, success metrics

### Priority 2 — Weeks 4-8
- **parent_finding_id:** F[N]
- **trade_off / negative_externality:** [specific tension]
- **depends_on:** What from Priority 1 must be done first?
- **prerequisite_for:** What does this enable in Priority 3?

### Priority 3 — Weeks 8-12
- **parent_finding_id:** F[N]
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

| Category | Tool | ~Cost/mo | Why | Stage Fit |
|----------|------|----------|-----|-----------|
[Tools appropriate for ${stageData?.label || 'their'} stage. Max ~€${stageData?.playbook?.budgetGuidance?.toolSpend?.max || '?'}/mo total]

---

## Quick Wins

| # | Action | parent_finding_id | Expected Impact | Effort |
|---|--------|-------------------|-----------------|--------|
[5 high-impact actions executable this week]

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
12. FEASIBILITY FLAGS: Address detected contradictions explicitly. Do not produce a roadmap that ignores them.
13. Use NARROW BENCHMARK DATA from KBCM, Statista, Pavilion. Cite the source.`;

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
      stage: stageKey
    });

  } catch (e) {
    console.error('[Report v12]', e);
    return res.status(500).json({ error: e.message });
  }
}
