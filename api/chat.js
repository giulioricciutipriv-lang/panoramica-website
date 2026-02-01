// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE ARCHITECT - v9.0
// 
// Architecture: LLM generates message AND options
// The backend's job is to give the LLM MAXIMUM context so it can respond intelligently
// 
// Key principles:
// 1. LLM sees the FULL business profile (what's known + what's unknown)
// 2. LLM sees the COMPLETE conversation summary (every turn)
// 3. LLM receives PHASE-SPECIFIC instructions (long, detailed, with examples)
// 4. LLM generates options that match its question
// 5. Backend only enforces: phase transitions, min/max questions, session persistence
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: PHASE DEFINITIONS & RULES
// ═══════════════════════════════════════════════════════════════════════════════

const PHASES = {
  welcome:    { order: 0, minTurns: 1, maxTurns: 2, next: 'company' },
  company:    { order: 1, minTurns: 3, maxTurns: 5, next: 'gtm' },
  gtm:        { order: 2, minTurns: 3, maxTurns: 5, next: 'sales' },
  sales:      { order: 3, minTurns: 3, maxTurns: 5, next: 'diagnosis' },
  diagnosis:  { order: 4, minTurns: 2, maxTurns: 4, next: 'pre_finish' },
  pre_finish: { order: 5, minTurns: 1, maxTurns: 2, next: 'finish' },
  add_context:{ order: 6, minTurns: 1, maxTurns: 5, next: 'pre_finish' },
  finish:     { order: 7, minTurns: 0, maxTurns: 0, next: null }
};

// Topics to cover per phase (for tracking completeness)
const PHASE_TOPICS = {
  company: ['business_model', 'stage_revenue', 'team_composition', 'funding'],
  gtm: ['icp_definition', 'sales_motion_channels', 'key_metrics_cac'],
  sales: ['sales_process', 'who_closes', 'bottlenecks_churn', 'tools_stack'],
  diagnosis: ['present_findings', 'validate_priority']
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: PHASE-SPECIFIC PROMPTS (the core intelligence)
// ═══════════════════════════════════════════════════════════════════════════════

function getPhasePrompt(phase, session) {
  const p = session.profile;
  const covered = session.topicsCovered || [];
  const phaseTurns = session.phaseTurnCount || 0;
  
  const prompts = {
    // ─────────────────────────────────────────────────────────────────────────
    welcome: `
YOU ARE IN THE WELCOME PHASE.

You just received scraped data about this company. Your job:
1. Greet them confidently
2. Show you've done homework — reference 3-4 SPECIFIC things from the scraped data (headlines, pricing, features, copy from their website)
3. Make 3 assumptions about their business based on what you see
4. Ask: "Did I get this right? What should I correct?"

YOUR OPTIONS must be:
- One for "mostly correct"
- One for "partially correct, let me clarify"  
- One for "quite different, let me explain"

SCRAPED DATA:
${session.scrapedSummary || 'No data available'}

TONE: Confident, specific, bold. Like a consultant who already knows their stuff.
MINIMUM: 6 sentences. Quote actual website content.
`,
    // ─────────────────────────────────────────────────────────────────────────
    company: `
YOU ARE IN THE COMPANY DISCOVERY PHASE.
Questions asked in this phase: ${phaseTurns}
Minimum questions before moving on: ${PHASES.company.minTurns}

TOPICS STILL NEEDED (ask about ONE per turn):
${!covered.includes('business_model') ? '- BUSINESS MODEL: SaaS/services/marketplace? B2B/B2C? Subscription/usage/one-time?' : '✅ business_model covered'}
${!covered.includes('stage_revenue') ? '- STAGE & REVENUE: Pre-revenue/early/growing/scaling? MRR/ARR? Growth rate?' : '✅ stage_revenue covered'}
${!covered.includes('team_composition') ? '- TEAM: How many? Tech/sales/marketing split? Key missing roles?' : '✅ team_composition covered'}
${!covered.includes('funding') ? '- FUNDING: Bootstrapped/funded? Round? Runway? Profitable?' : '✅ funding covered'}

YOUR APPROACH FOR THIS TURN:
1. Acknowledge what they just said (2-3 sentences, be SPECIFIC, reference their words)
2. Share a relevant insight or benchmark: "Companies like yours typically..." or "At your stage, the benchmark is..."
3. Ask ONE clear question about the NEXT uncovered topic
4. Generate 4-5 options that are SPECIFIC ANSWERS to your question

EXAMPLES OF GOOD OPTIONS for business model:
- "B2B SaaS with monthly/annual subscription"
- "Professional services / consulting"  
- "Marketplace connecting buyers and sellers"
- "Hybrid: SaaS core + services layer"
- "Different model — let me explain"

IMPORTANT: Your options must be POSSIBLE ANSWERS to your question. Not generic actions.

Include benchmarks from: SaaStr, OpenView Partners, First Round Capital, a16z.
MINIMUM: 5 sentences per response.
`,
    // ─────────────────────────────────────────────────────────────────────────
    gtm: `
YOU ARE IN THE GO-TO-MARKET DISCOVERY PHASE.
Questions asked in this phase: ${phaseTurns}

TRANSITION: If this is the first question in GTM, start with: "Let's map your Go-to-Market strategy."
Briefly summarize what you learned about the company (2 sentences with real data).

TOPICS STILL NEEDED (ask about ONE per turn):
${!covered.includes('icp_definition') ? '- ICP: Who is the ideal buyer? Job title? Company size? Industry? Main pain point?' : '✅ icp_definition covered'}
${!covered.includes('sales_motion_channels') ? '- SALES MOTION & CHANNELS: Inbound/outbound/PLG/mix? Which channels? Best channel?' : '✅ sales_motion_channels covered'}
${!covered.includes('key_metrics_cac') ? '- KEY METRICS: Average deal size (ACV)? Sales cycle length? CAC? LTV? Conversion rate?' : '✅ key_metrics_cac covered'}

YOUR APPROACH:
1. Acknowledge previous answer with INSIGHT (not just "thanks")
2. Connect to their business: "Selling ${p.businessModel || 'your product'} to ${p.icpTitle || 'your ICP'}..."
3. Include benchmark: "For B2B ${p.businessModel || 'SaaS'} at ${p.stage || 'your stage'}, typical X is Y"
4. Ask ONE focused question
5. Generate 4-6 options that are DIRECT ANSWERS to your question

Example good options for ICP:
- "SMB owners and small team leads (1-50 employees)"
- "Mid-market directors and VPs (50-500 employees)"
- "Enterprise C-suite (500+ employees)"
- "Technical individual contributors (developers, engineers)"
- "Not clearly defined yet — we sell to anyone who buys"

MINIMUM: 5 sentences. Include specific tools, frameworks, or resources where relevant.
`,
    // ─────────────────────────────────────────────────────────────────────────
    sales: `
YOU ARE IN THE SALES ENGINE DISCOVERY PHASE.
Questions asked in this phase: ${phaseTurns}

TRANSITION: If first question, start with: "Now let's analyze your Sales Engine."
Summarize GTM findings in 2 sentences.

TOPICS STILL NEEDED:
${!covered.includes('sales_process') ? '- SALES PROCESS: What happens first contact → close? How many stages? Documented? CRM?' : '✅ sales_process covered'}
${!covered.includes('who_closes') ? '- WHO CLOSES: Founder vs team? What percentage? Can deals close without founder?' : '✅ who_closes covered'}
${!covered.includes('bottlenecks_churn') ? '- BOTTLENECKS: Where do deals die? Win rate? Top objections? Churn rate?' : '✅ bottlenecks_churn covered'}
${!covered.includes('tools_stack') ? '- TOOLS: CRM? Automation? Analytics? Pipeline tracking? What data do you trust?' : '✅ tools_stack covered'}

YOUR APPROACH:
1. Acknowledge with an insight about their specific situation
2. Make a HYPOTHESIS: "Based on [what they told you], I suspect [X] because [Y]"
3. Ask ONE focused question
4. Generate options that are SPECIFIC to their situation

KEY INSIGHT TO SHARE:
- If founder-led sales detected: "The Founder-Led Sales Trap: if the founder closes >60% of deals, you have a scaling ceiling"
- If no process: "Without a documented process, every new salesperson is starting from zero"
- If missing metrics: "If you can't measure it, you can't improve it — and your investors can't model it"

MINIMUM: 5 sentences. Be provocative but respectful.
`,
    // ─────────────────────────────────────────────────────────────────────────
    diagnosis: `
YOU ARE IN THE DIAGNOSIS PHASE.
${phaseTurns === 0 ? 'THIS IS YOUR FIRST DIAGNOSIS TURN — PRESENT YOUR FINDINGS.' : 'The user responded to your diagnosis — ADJUST based on their feedback.'}

${phaseTurns === 0 ? `
PRESENT YOUR DIAGNOSIS:
1. Start with: "Based on everything you've shared, here is my diagnosis:"
2. Identify TOP 3 revenue problems, ranked by impact
3. For EACH problem:
   - NAME it clearly (specific, not vague)
   - ROOT CAUSE: WHY this is happening
   - REVENUE IMPACT: Quantify or estimate
   - BENCHMARK: What "good" looks like
4. State your CORE HYPOTHESIS in one sentence
5. End with: "Does this diagnosis resonate?"

Use ALL the data you've collected. Be SPECIFIC — reference actual numbers they gave you.
This should be your LONGEST response. MINIMUM 10 sentences.

OPTIONS should be:
- "This resonates strongly"
- "Mostly right, but I'd adjust priorities"
- "You missed an important issue"
- "Right problems, but wrong root causes"
` : `
VALIDATE/ADJUST YOUR DIAGNOSIS:
The user just responded to your diagnosis. Based on what they said:
- If agreed: Confirm and ask about their #1 priority for the next 90 days
- If disagreed: Ask specifically what they'd change, then ADJUST
- If they added info: Incorporate and present updated view

Ask: "Which problem is most critical to fix first? And what have you already tried?"

OPTIONS should reflect priority choices and let them correct things.
MINIMUM: 5 sentences.
`}
`,
    // ─────────────────────────────────────────────────────────────────────────
    pre_finish: `
YOU ARE IN THE PRE-FINISH PHASE — Present final summary before report generation.

STRUCTURE:
1. "Here's the complete picture:"
2. Company snapshot (3 sentences with actual data: ${p.companyName}, ${p.businessModel}, ${p.stage}, ${p.revenue})
3. The 3 diagnosed problems (1 sentence each, specific)
4. Priority order based on user input: "${p.userPriority || 'not yet set'}"
5. Preview: "Your Strategic Growth Plan will include: executive summary, diagnostic findings, 90-day roadmap with weekly actions, key metrics, tool recommendations."
6. "Ready to generate?"

OPTIONS MUST include:
- "📥 Generate Strategic Growth Plan" (key: generate_report)
- "Wait, I want to add important context" (key: add_context)
- "I want to adjust a finding" (key: add_context)

MINIMUM: 8 sentences. Make it feel like a premium deliverable is coming.
`,
    // ─────────────────────────────────────────────────────────────────────────
    add_context: `
YOU ARE IN THE ADD CONTEXT PHASE — The user wants to add or correct information.

${phaseTurns === 0 ? `
FIRST TURN: Ask what they want to add/correct.
Say: "Of course! What would you like to add or correct?"
List areas they could address: team, market, product, challenges, diagnosis corrections.
Do NOT mention the report. Do NOT show generate button.
` : `
SUBSEQUENT TURN: They just shared new context.
1. Acknowledge SPECIFICALLY what they said (quote them)
2. Explain how this changes your understanding
3. Ask if there's anything else
4. If they're done, show updated assessment + generate option

If they indicate they're done adding, present a brief updated summary and offer to generate.
`}

OPTIONS should include:
- Specific areas to add context about
- "I'm done — update the analysis" (only after they've actually added something)
${phaseTurns > 0 ? '- "📥 Generate Updated Growth Plan" (key: generate_report)' : ''}
`
  };
  
  return prompts[phase] || prompts.company;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: SESSION
// ═══════════════════════════════════════════════════════════════════════════════

function createSession() {
  return {
    currentPhase: 'welcome',
    turnCount: 0,
    phaseTurnCount: 0,
    topicsCovered: [],
    profile: {
      companyName:'', website:'', industry:'', businessModel:'', stage:'', revenue:'',
      revenueGrowth:'', teamSize:'', teamRoles:'', funding:'',
      productDescription:'', pricingModel:'', pricingRange:'',
      icpTitle:'', icpCompanySize:'', icpIndustry:'', icpPainPoints:'',
      salesMotion:'', channels:'', bestChannel:'',
      avgDealSize:'', salesCycle:'', cac:'', ltv:'',
      salesProcess:'', processDocumented:'', whoCloses:'', founderInvolvement:'',
      winRate:'', mainObjections:'', lostDealReasons:'', crm:'', churnRate:'',
      mainBottleneck:'', tools:'',
      diagnosedProblems:[], rootCauses:[], validatedProblems:[],
      userPriority:'', pastAttempts:'', constraints:'', additionalContext:''
    },
    scrapedSummary: '',
    conversationSummary: [] // "Turn 1: AI presented website analysis. User confirmed mostly correct."
  };
}

function buildFullProfile(session) {
  const p = session.profile;
  const f = (label, val) => `  ${label}: ${val || '❓ NOT YET KNOWN'}`;
  
  return `
════════════════════════════════════════
COMPLETE BUSINESS PROFILE
(Everything learned so far)
════════════════════════════════════════

COMPANY:
${f('Name', p.companyName)}
${f('Website', p.website)}
${f('Industry', p.industry)}
${f('Business Model', p.businessModel)}
${f('Stage', p.stage)}
${f('Revenue', p.revenue)}
${f('Growth Rate', p.revenueGrowth)}
${f('Team Size', p.teamSize)}
${f('Team Roles', p.teamRoles)}
${f('Funding', p.funding)}

PRODUCT:
${f('Description', p.productDescription)}
${f('Pricing Model', p.pricingModel)}
${f('Pricing Range', p.pricingRange)}

GO-TO-MARKET:
${f('ICP (Buyer)', p.icpTitle)}
${f('ICP Company Size', p.icpCompanySize)}
${f('ICP Industry', p.icpIndustry)}
${f('ICP Pain Points', p.icpPainPoints)}
${f('Sales Motion', p.salesMotion)}
${f('Channels', p.channels)}
${f('Best Channel', p.bestChannel)}
${f('Avg Deal Size', p.avgDealSize)}
${f('Sales Cycle', p.salesCycle)}
${f('CAC', p.cac)}
${f('LTV', p.ltv)}

SALES ENGINE:
${f('Process', p.salesProcess)}
${f('Documented', p.processDocumented)}
${f('Who Closes', p.whoCloses)}
${f('Founder Role', p.founderInvolvement)}
${f('Win Rate', p.winRate)}
${f('Bottleneck', p.mainBottleneck)}
${f('Lost Deals', p.lostDealReasons)}
${f('Churn Rate', p.churnRate)}
${f('CRM/Tools', p.crm || p.tools)}

DIAGNOSIS:
${f('Problems', (p.diagnosedProblems||[]).join('; '))}
${f('Root Causes', (p.rootCauses||[]).join('; '))}
${f('User Priority', p.userPriority)}
${f('Past Attempts', p.pastAttempts)}
${f('Additional Context', p.additionalContext)}

════════════════════════════════════════
CONVERSATION HISTORY
(Summary of every turn)
════════════════════════════════════════
${session.conversationSummary.length > 0 ? session.conversationSummary.join('\n') : 'No conversation yet.'}

════════════════════════════════════════
TOPICS COVERED: ${session.topicsCovered.join(', ') || 'none yet'}
CURRENT PHASE: ${session.currentPhase}
PHASE TURN: ${session.phaseTurnCount} / min ${PHASES[session.currentPhase]?.minTurns || '?'}
TOTAL TURNS: ${session.turnCount}
════════════════════════════════════════`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: SCRAPING
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeWebsite(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const c = new AbortController(); setTimeout(() => c.abort(), 12000);
    const r = await fetch(u.href, { headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}, signal: c.signal });
    const html = await r.text();
    const ex = (re) => { const m = html.match(re); return m ? m[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim() : ''; };
    const exAll = (re, n=6) => [...html.matchAll(re)].map(m=>m[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()).filter(t=>t.length>2&&t.length<200).slice(0,n);
    return {
      title: ex(/<title[^>]*>([^<]+)<\/title>/i),
      desc: ex(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || ex(/<meta[^>]*content="([^"]*)"[^>]*name="description"/i),
      h1s: exAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi),
      h2s: exAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, 8),
      paras: [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').trim()).filter(t=>t.length>40&&t.length<500).slice(0,5),
      prices: [...new Set(html.match(/(\$|€|£)\s*\d+[,.]?\d*/g)||[])].slice(0,5),
      proof: [...(html.match(/(\d+[,.]?\d*[kK]?\+?)\s*(customers?|users?|companies|clients)/gi)||[]),...(html.match(/trusted by[^<]{0,80}/gi)||[])].slice(0,4)
    };
  } catch(e) { console.log(`[Scrape] ${e.message}`); return null; }
}

async function scrapeLinkedIn(url, key) {
  if (!url || !key) return null;
  try {
    const slug = url.match(/linkedin\.com\/company\/([^\/\?]+)/i)?.[1];
    if (!slug) return null;
    const r = await fetch("https://api.tavily.com/search", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({api_key:key, query:`"${slug}" site:linkedin.com company`, search_depth:"advanced", max_results:3, include_answer:true})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return { name: slug.replace(/-/g,' ').replace(/\b\w/g,l=>l.toUpperCase()), employees: d.answer?.match(/(\d+[\-–]?\d*)\s*(employees?|people)/i)?.[0]||'', industry: d.answer?.match(/(?:industry|sector):\s*([^.]+)/i)?.[1]?.trim()||'', desc: d.answer?.slice(0,400)||'' };
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: LLM CALL
// ═══════════════════════════════════════════════════════════════════════════════

async function callGemini(systemPrompt, conversationHistory, geminiKey) {
  const messages = [
    { role: 'user', parts: [{ text: systemPrompt }] },
    { role: 'model', parts: [{ text: 'Understood. I will follow the phase instructions exactly and respond with valid JSON containing "message", "options", "profile_updates", and "topic_covered".' }] }
  ];
  
  // Add last 14 messages for LLM context
  for (const msg of conversationHistory.slice(-14)) {
    let content = msg.content;
    if (msg.role === 'assistant') {
      try { content = JSON.parse(content).message || content; } catch {}
    }
    messages.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content.slice(0, 2500) }]
    });
  }
  
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages,
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          maxOutputTokens: 3500
        }
      })
    }
  );
  
  if (!resp.ok) throw new Error(`Gemini API: ${resp.status}`);
  const data = await resp.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response");
  text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { choice, history = [], contextData, sessionData: inputSession } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (!geminiKey) return res.status(200).json({ message: 'API key missing', options: [], session_data: null });

    let session = inputSession || createSession();
    session.turnCount++;

    // ═════════════════════════════════════════════════════════════
    // HANDLE SPECIAL ACTIONS
    // ═════════════════════════════════════════════════════════════
    
    // INIT: Scrape and welcome
    if (choice === 'SNAPSHOT_INIT') {
      session.currentPhase = 'welcome';
      session.phaseTurnCount = 0;
      
      if (contextData) {
        session.profile.website = contextData.website || '';
        if (contextData.description) session.profile.productDescription = contextData.description;
        
        const web = contextData.website ? await scrapeWebsite(contextData.website) : null;
        const li = contextData.linkedin ? await scrapeLinkedIn(contextData.linkedin, tavilyKey) : null;
        
        let sc = '';
        if (contextData.description) sc += `USER DESCRIPTION: "${contextData.description}"\n`;
        if (web) {
          sc += `WEBSITE TITLE: ${web.title}\n`;
          sc += `META DESCRIPTION: ${web.desc}\n`;
          sc += `MAIN HEADLINES (H1): ${web.h1s?.join(' | ') || 'none'}\n`;
          sc += `SECTION HEADERS (H2): ${web.h2s?.join(' | ') || 'none'}\n`;
          sc += `KEY CONTENT: ${web.paras?.join(' | ') || 'none'}\n`;
          sc += `PRICING FOUND: ${web.prices?.join(', ') || 'none'}\n`;
          sc += `SOCIAL PROOF: ${web.proof?.join(' | ') || 'none'}\n`;
          if (web.prices?.length) session.profile.pricingRange = web.prices.join(', ');
          if (web.title) session.profile.companyName = web.title.split(/[|\-–—]/)[0].trim();
        }
        if (li) {
          sc += `LINKEDIN: ${li.name}, ${li.employees||'?'} employees, Industry: ${li.industry||'?'}\n`;
          if (li.name) session.profile.companyName = li.name;
          if (li.industry) session.profile.industry = li.industry;
          if (li.employees) session.profile.teamSize = li.employees;
        }
        session.scrapedSummary = sc;
      }
    }
    // ADD CONTEXT trigger
    else if (choice === 'add_context' || choice === 'adjust_finding') {
      session.currentPhase = 'add_context';
      session.phaseTurnCount = 0;
    }
    // GENERATE REPORT trigger
    else if (choice === 'generate_report') {
      return res.status(200).json({
        message: '📥 Generating your Strategic Growth Plan...',
        mode: 'buttons',
        options: [{ key: 'generating', label: '⏳ Generating...' }],
        allow_text: false,
        session_data: session,
        current_phase: 'finish',
        confidence: calcConfidence(session)
      });
    }
    
    // ═════════════════════════════════════════════════════════════
    // LOG USER INPUT
    // ═════════════════════════════════════════════════════════════
    
    if (choice !== 'SNAPSHOT_INIT') {
      session.conversationSummary.push(
        `Turn ${session.turnCount}: [${session.currentPhase}] User said: "${choice.slice(0, 150)}"`
      );
      
      // Store additional context
      if (session.currentPhase === 'add_context' && !['add_context', 'adjust_finding', 'done_adding'].includes(choice)) {
        session.profile.additionalContext = (session.profile.additionalContext || '') + ' | ' + choice;
      }
    }

    // ═════════════════════════════════════════════════════════════
    // CHECK PHASE TRANSITION (before LLM call)
    // ═════════════════════════════════════════════════════════════
    
    const phaseConfig = PHASES[session.currentPhase];
    
    // Force advance if maxTurns exceeded
    if (phaseConfig && session.phaseTurnCount >= phaseConfig.maxTurns && phaseConfig.next) {
      if (session.currentPhase !== 'add_context') { // don't force-advance add_context
        session.currentPhase = phaseConfig.next;
        session.phaseTurnCount = 0;
      }
    }
    
    // Safety: force to pre_finish after 18 turns total
    if (session.turnCount >= 18 && !['pre_finish', 'finish', 'add_context'].includes(session.currentPhase)) {
      session.currentPhase = 'pre_finish';
      session.phaseTurnCount = 0;
    }

    // ═════════════════════════════════════════════════════════════
    // BUILD THE MEGA-PROMPT
    // ═════════════════════════════════════════════════════════════
    
    const fullProfile = buildFullProfile(session);
    const phaseInstructions = getPhasePrompt(session.currentPhase, session);
    
    const megaPrompt = `
You are the Revenue Architect, a senior B2B revenue strategist by Panoramica.

LANGUAGE RULE: Respond in the SAME LANGUAGE as the user. If they write Italian, respond entirely in Italian. If English, use English. Check the conversation history for language.

PERSONALITY:
- Confident and direct — like a $500/hour consultant
- Specific — always reference actual data, never be vague
- Provocative — challenge assumptions, don't just agree
- Generous with knowledge — share benchmarks, frameworks, tools
- Never say "interesting" or "great question" — ADD VALUE instead

${fullProfile}

═══════════════════════════════════════
PHASE INSTRUCTIONS FOR THIS TURN
═══════════════════════════════════════
${phaseInstructions}

═══════════════════════════════════════
USER'S LAST INPUT: "${choice}"
═══════════════════════════════════════

OUTPUT FORMAT — You MUST respond with this exact JSON structure:
{
  "message": "Your markdown response. FOLLOW THE PHASE INSTRUCTIONS ABOVE. Minimum 4-5 sentences.",
  "options": [
    { "key": "short_key", "label": "Human-readable option text" },
    { "key": "short_key2", "label": "Another option" },
    ...3-5 options total
  ],
  "profile_updates": {
    "fieldName": "new value extracted from user's last input"
  },
  "topic_covered": "business_model" or null,
  "ready_to_advance": false
}

CRITICAL RULES:
1. Your "options" MUST be specific answers to YOUR question, not generic buttons
2. Your "message" MUST end with a clear question (except in diagnosis phase where you present findings)
3. "profile_updates" — extract ANY info from the user's input and map to the correct profile field
4. "topic_covered" — if you asked about and got a clear answer on a topic, set this to the topic name
5. "ready_to_advance" — set to true ONLY if all topics for this phase are covered
6. Always acknowledge what the user said BEFORE asking your next question
7. NEVER repeat a question about a topic already marked as covered
8. Include at least one benchmark, example, or framework reference per response
`;

    console.log(`[v9] Turn ${session.turnCount} | Phase: ${session.currentPhase} | PhaseTurn: ${session.phaseTurnCount} | Topics: ${session.topicsCovered.join(',')}`);

    // ═════════════════════════════════════════════════════════════
    // CALL LLM
    // ═════════════════════════════════════════════════════════════
    
    let llmResponse;
    try {
      llmResponse = await callGemini(megaPrompt, history, geminiKey);
    } catch (e) {
      console.error(`[v9] LLM error: ${e.message}`);
      llmResponse = {
        message: "Mi scusi per l'interruzione. Continuiamo la nostra analisi. Qual è la sua sfida principale in questo momento?",
        options: [
          { key: 'lead_gen', label: 'Non abbastanza lead qualificati' },
          { key: 'conversion', label: 'Le lead non convertono' },
          { key: 'scaling', label: 'Non riesco a scalare le vendite' },
          { key: 'churn', label: 'Il churn è troppo alto' }
        ],
        profile_updates: {},
        topic_covered: null,
        ready_to_advance: false
      };
    }

    // ═════════════════════════════════════════════════════════════
    // UPDATE SESSION
    // ═════════════════════════════════════════════════════════════
    
    // Update profile
    if (llmResponse.profile_updates && typeof llmResponse.profile_updates === 'object') {
      for (const [key, value] of Object.entries(llmResponse.profile_updates)) {
        if (!value || !session.profile.hasOwnProperty(key)) continue;
        if (Array.isArray(session.profile[key])) {
          const items = Array.isArray(value) ? value : [value];
          session.profile[key] = [...new Set([...session.profile[key], ...items])];
        } else if (typeof value === 'string' && value.trim()) {
          session.profile[key] = value;
        }
      }
    }
    
    // Track topic
    if (llmResponse.topic_covered && !session.topicsCovered.includes(llmResponse.topic_covered)) {
      session.topicsCovered.push(llmResponse.topic_covered);
    }
    
    // Log AI turn
    session.conversationSummary.push(
      `Turn ${session.turnCount}: [${session.currentPhase}] AI asked about ${llmResponse.topic_covered || session.currentPhase}. ${llmResponse.ready_to_advance ? '→ Ready to advance.' : ''}`
    );
    
    session.phaseTurnCount++;

    // ═════════════════════════════════════════════════════════════
    // CHECK PHASE ADVANCE (after LLM call)
    // ═════════════════════════════════════════════════════════════
    
    const currentPhase = PHASES[session.currentPhase];
    
    if (currentPhase && currentPhase.next) {
      const minMet = session.phaseTurnCount >= currentPhase.minTurns;
      const maxHit = session.phaseTurnCount >= currentPhase.maxTurns;
      const llmReady = llmResponse.ready_to_advance === true;
      
      if (maxHit || (minMet && llmReady)) {
        session.currentPhase = currentPhase.next;
        session.phaseTurnCount = 0;
      }
    }

    // ═════════════════════════════════════════════════════════════
    // VALIDATE OPTIONS
    // ═════════════════════════════════════════════════════════════
    
    let options = llmResponse.options;
    
    // Ensure options is a valid array
    if (!Array.isArray(options) || options.length === 0) {
      options = [
        { key: 'tell_more', label: 'Let me explain in more detail' },
        { key: 'continue', label: 'Continue the analysis' },
        { key: 'ask_something', label: 'I have a question' }
      ];
    }
    
    // Ensure each option has key and label
    options = options.filter(o => o && o.key && o.label).slice(0, 6);
    
    // If pre_finish, ensure generate_report option exists
    if (session.currentPhase === 'pre_finish' || (currentPhase?.next === 'pre_finish' && session.phaseTurnCount === 0)) {
      if (!options.some(o => o.key === 'generate_report')) {
        options.unshift({ key: 'generate_report', label: '📥 Generate Strategic Growth Plan' });
      }
      if (!options.some(o => o.key === 'add_context')) {
        options.push({ key: 'add_context', label: 'Wait, I want to add more context' });
      }
    }

    // ═════════════════════════════════════════════════════════════
    // RESPOND
    // ═════════════════════════════════════════════════════════════
    
    const confidence = calcConfidence(session);
    
    return res.status(200).json({
      message: llmResponse.message || "Let's continue our analysis.",
      mode: session.currentPhase === 'pre_finish' ? 'buttons' : 'mixed',
      options: options,
      allow_text: session.currentPhase !== 'pre_finish',
      session_data: session,
      current_phase: session.currentPhase,
      turn_count: session.turnCount,
      confidence: confidence
    });

  } catch (error) {
    console.error('[v9 FATAL]', error);
    return res.status(200).json({
      message: "Something went wrong. What's your biggest revenue challenge?",
      mode: 'mixed',
      options: [
        { key: 'lead_gen', label: 'Not enough leads' },
        { key: 'conversion', label: 'Leads don\'t convert' },
        { key: 'scaling', label: 'Can\'t scale sales' },
        { key: 'churn', label: 'Churn is killing growth' }
      ],
      allow_text: true,
      session_data: null
    });
  }
}

function calcConfidence(session) {
  const p = session.profile;
  const fields = ['companyName','businessModel','stage','revenue','teamSize','funding','icpTitle','salesMotion','channels','avgDealSize','salesProcess','whoCloses','mainBottleneck'];
  let filled = 0;
  for (const k of fields) {
    const v = p[k];
    if (Array.isArray(v) ? v.length > 0 : (v && v !== '')) filled++;
  }
  if (p.diagnosedProblems?.length > 0) filled++;
  if (p.validatedProblems?.length > 0) filled++;
  return Math.round((filled / (fields.length + 2)) * 100);
}
