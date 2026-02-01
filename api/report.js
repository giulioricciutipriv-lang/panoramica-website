// ═══════════════════════════════════════════════════════════════════════════════
// REPORT API - /api/report.js (v7 compatible)
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { history = [], sessionData, diagnosticData } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'API key missing' });

    // Build profile context
    let ctx = '';
    if (sessionData?.profile) {
      const p = sessionData.profile;
      ctx = `
BUSINESS PROFILE:
Company: ${p.companyName || 'Unknown'} | Website: ${p.website || ''}
Industry: ${p.industry || 'Unknown'} | Model: ${p.businessModel || 'Unknown'}
Stage: ${p.stage || 'Unknown'} | Revenue: ${p.revenue || 'Unknown'} | Growth: ${p.revenueGrowth || 'Unknown'}
Team: ${p.teamSize || 'Unknown'} (${p.teamRoles || 'Unknown'}) | Funding: ${p.funding || 'Unknown'}
Product: ${p.productDescription || 'Unknown'} | Pricing: ${p.pricingModel || ''} ${p.pricingRange || ''}

ICP: ${p.icpTitle || 'Unknown'} at ${p.icpCompanySize || '?'} companies in ${p.icpIndustry || '?'}
Pain points: ${p.icpPainPoints || 'Unknown'}
Motion: ${p.salesMotion || 'Unknown'} | Channels: ${p.channels || 'Unknown'} | Best: ${p.bestChannel || '?'}
Deal size: ${p.avgDealSize || '?'} | Cycle: ${p.salesCycle || '?'} | CAC: ${p.cac || '?'} | LTV: ${p.ltv || '?'}

Process: ${p.salesProcess || 'Unknown'} | Documented: ${p.processDocumented || '?'}
Closes: ${p.whoCloses || 'Unknown'} | Founder: ${p.founderInvolvement || '?'}
Win rate: ${p.winRate || '?'} | Bottleneck: ${p.mainBottleneck || 'Unknown'}
Lost reasons: ${p.lostDealReasons || '?'} | Churn: ${p.churnRate || '?'} | CRM: ${p.crm || '?'}

DIAGNOSIS:
Problems: ${(p.diagnosedProblems||[]).join(' | ') || 'Not diagnosed'}
Root causes: ${(p.rootCauses||[]).join(' | ') || '?'}
Validated: ${(p.validatedProblems||[]).join(' | ') || '?'}
Priority: ${p.userPriority || '?'} | Past attempts: ${p.pastAttempts || '?'}
Constraints: ${p.constraints || '?'}
Additional context: ${p.additionalContext || 'None'}`;
    }

    let convLog = '';
    if (sessionData?.conversationLog?.length > 0) {
      convLog = '\nCONVERSATION:\n' + sessionData.conversationLog.slice(-20).join('\n');
    }

    const prompt = `You are generating a comprehensive Strategic Growth Plan report.

OUTPUT: Pure Markdown. NO JSON wrapper. NO code fences. Just Markdown text.

LANGUAGE: Write in the same language the user used during the conversation. Check the conversation log for language cues. If they spoke Italian, write the ENTIRE report in Italian.

${ctx}
${convLog}

Generate the report with this EXACT structure:

# Strategic Growth Plan
## ${sessionData?.profile?.companyName || 'Company'} | ${new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'})}

---

## Executive Summary
[3-4 paragraphs: what the company does, current stage, key problems identified, core recommendation]

---

## Company Snapshot

| Dimension | Detail |
|-----------|--------|
| Company | [name] |
| Industry | [industry] |
| Stage | [stage] |
| Revenue | [revenue] |
| Team | [size and roles] |
| Model | [business model] |
| ICP | [ideal customer] |
| Motion | [sales motion] |
| Primary Channel | [best channel] |

---

## Diagnostic Findings

### Finding 1: [Problem Name]
**Root Cause:** [specific explanation]
**Revenue Impact:** [quantified estimate]
**Evidence:** [what was observed]
**Benchmark:** [industry standard]

### Finding 2: [Problem Name]
**Root Cause:** [specific explanation]
**Revenue Impact:** [quantified estimate]
**Evidence:** [what was observed]
**Benchmark:** [industry standard]

### Finding 3: [Problem Name]
**Root Cause:** [specific explanation]
**Revenue Impact:** [quantified estimate]
**Evidence:** [what was observed]
**Benchmark:** [industry standard]

---

## Root Cause Analysis
[Explain how problems interconnect. Systems thinking. 2-3 paragraphs.]

---

## Strategic Recommendations

### Priority 1: [Action] (Weeks 1-4)
**Objective:** [goal]
**Actions:**
- [step 1]
- [step 2]
- [step 3]
**Expected Outcome:** [measurable result]
**Resources:** [what's needed]

### Priority 2: [Action] (Weeks 4-8)
**Objective:** [goal]
**Actions:**
- [step 1]
- [step 2]
- [step 3]
**Expected Outcome:** [measurable result]
**Resources:** [what's needed]

### Priority 3: [Action] (Weeks 8-12)
**Objective:** [goal]
**Actions:**
- [step 1]
- [step 2]
- [step 3]
**Expected Outcome:** [measurable result]
**Resources:** [what's needed]

---

## 90-Day Roadmap

| Week | Focus | Actions | Metric |
|------|-------|---------|--------|
| 1-2 | [area] | [actions] | [KPI] |
| 3-4 | [area] | [actions] | [KPI] |
| 5-6 | [area] | [actions] | [KPI] |
| 7-8 | [area] | [actions] | [KPI] |
| 9-10 | [area] | [actions] | [KPI] |
| 11-12 | [area] | [actions] | [KPI] |

---

## Key Metrics

| Metric | Current | Target (90d) | How to Track |
|--------|---------|-------------|--------------|
| [metric] | [now] | [goal] | [tool] |
| [metric] | [now] | [goal] | [tool] |
| [metric] | [now] | [goal] | [tool] |
| [metric] | [now] | [goal] | [tool] |

---

## Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [risk] | [H/M/L] | [H/M/L] | [action] |
| [risk] | [H/M/L] | [H/M/L] | [action] |

---

## Recommended Tools
- **[Tool]**: [why and how]
- **[Tool]**: [why and how]
- **[Tool]**: [why and how]

---

## Next Steps
1. [immediate action]
2. [immediate action]
3. [immediate action]

---

*Generated by Revenue Architect by Panoramica*

IMPORTANT:
- Fill ALL placeholders with REAL data from the profile
- Be SPECIFIC (actual numbers, names, tools)
- Every recommendation must be ACTIONABLE
- Minimum 2000 words
- Write in the user's language`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 8000 }
        })
      }
    );

    if (!resp.ok) throw new Error(`Gemini: ${resp.status}`);
    const data = await resp.json();
    let md = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!md) throw new Error('Empty report');

    md = md.replace(/^```markdown\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

    const name = sessionData?.profile?.companyName || 'Company';
    return res.status(200).json({
      report: md,
      filename: `Growth_Plan_${name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`,
      pdf_base64: null
    });

  } catch (e) {
    console.error('[Report]', e);
    return res.status(500).json({ error: e.message });
  }
}
