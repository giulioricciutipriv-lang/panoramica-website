// ═══════════════════════════════════════════════════════════════════════════════
// REPORT API v11 — Uses full transcript as primary source of truth
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { sessionData } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'API key missing' });

    const p = sessionData?.profile || {};
    const companyName = p.companyName || 'Company';
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── Build confirmed/unknown split ──
    function has(v) {
      if (Array.isArray(v)) return v.length > 0 ? v.join('; ') : null;
      return (v && typeof v === 'string' && v.trim()) ? v.trim() : null;
    }

    const allFields = {
      'Company': p.companyName, 'Website': p.website, 'Industry': p.industry,
      'Business Model': p.businessModel, 'Stage': p.stage, 'Revenue': p.revenue,
      'Revenue Growth': p.revenueGrowth, 'Team Size': p.teamSize, 'Team Roles': p.teamRoles,
      'Funding': p.funding, 'Runway': p.runway,
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
      'Additional Context': p.additionalContext
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
WEBSITE SCAN
═══════════════════════════════════════════
${sessionData?.scrapedSummary || 'N/A'}

═══════════════════════════════════════════
REPORT STRUCTURE
═══════════════════════════════════════════

# Strategic Growth Plan
## ${companyName} | ${today}

---

## Executive Summary

4-5 paragraphs covering: what the company does (use confirmed data), the 3 diagnosed problems, core hypothesis, 90-day approach, expected impact.

---

## Company Profile

| Dimension | Status |
|-----------|--------|
[Fill with CONFIRMED data. For unknown fields: "Not disclosed" or "To be assessed"]

Compare to benchmarks for their stage (T2D3, SaaStr). Be specific about gaps.

---

## ICP & Go-to-Market

Analyze their ICP, positioning, and channel effectiveness using confirmed data.
Apply April Dunford framework and Jobs-to-be-Done where data allows.
If ICP is vague, flag it as a finding.

---

## Diagnostic Findings

For each of the ${(p.diagnosedProblems || []).length || 3} diagnosed problems:

### Finding N: [Problem Name]
- **Severity:** 🔴/🟡/🟢
- **Evidence:** Reference what the user ACTUALLY said in the conversation: "The user mentioned that [quote/paraphrase]"
- **Root Cause:** Why this problem exists (reference confirmed data)
- **Revenue Impact:** Estimate only if you have data to support it. Otherwise describe qualitative impact.
- **Benchmark:** What good looks like

---

## Root Cause Analysis

Systems thinking: how the problems interconnect. Causal chain.
Reference confirmed data only.

---

## Strategic Recommendations

### Priority 1: [Based on user's stated priority: "${has(p.userPriority) || 'not specified'}"] — Weeks 1-4
Week-by-week plan with specific actions, deliverables, success metrics, resources needed.

### Priority 2 — Weeks 4-8
[Same structure]

### Priority 3 — Weeks 8-12
[Same structure]

---

## 90-Day Roadmap

| Week | Focus | Actions | Deliverable | KPI |
|------|-------|---------|-------------|-----|
[Fill 12 rows]

---

## Metrics Dashboard

| Metric | Current | 90-Day Target | How to Track |
|--------|---------|---------------|-------------|
[Fill with confirmed numbers where available, "TBD" where not]

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
[3-4 risks specific to their situation]

---

## Recommended Tools

| Category | Tool | ~Cost | Why |
|----------|------|-------|-----|
[Specific to their situation, stage, and budget]

---

## Quick Wins

5 high-impact actions executable this week.

---

## Next Steps

1. Immediate
2. This week
3. This month
4. Ongoing

---

*Generated by Revenue Architect by Panoramica — Confidential*

═══════════════════════════════════════════
ANTI-HALLUCINATION RULES
═══════════════════════════════════════════
1. The CONVERSATION TRANSCRIPT is your primary source. Reference it: "As discussed...", "You mentioned that..."
2. CONFIRMED fields = use freely. UNKNOWN fields = write "Not disclosed" or "To be assessed". NEVER invent.
3. Estimates MUST be labeled: "~€X (estimated based on [your reasoning])"
4. If a section lacks data, say so: "This section requires additional data. Based on what we know..."
5. Every diagnostic finding MUST cite evidence from the conversation.
6. Minimum 2500 words.
7. Write for the company's leadership team — professional, specific, actionable.`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 12000 }
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
      pdf_base64: null
    });

  } catch (e) {
    console.error('[Report v11]', e);
    return res.status(500).json({ error: e.message });
  }
}
