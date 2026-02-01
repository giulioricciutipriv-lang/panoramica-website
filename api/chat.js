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

// Topics mapped to profile fields — if the fields are filled, the topic is COVERED
// This is the SINGLE SOURCE OF TRUTH for what's been asked
const TOPIC_TO_FIELDS = {
  business_model:       ['businessModel'],
  stage_revenue:        ['stage', 'revenue'],
  team_composition:     ['teamSize'],
  funding:              ['funding'],
  icp_definition:       ['icpTitle'],
  sales_motion_channels:['salesMotion'],
  key_metrics_cac:      ['avgDealSize'],
  sales_process:        ['salesProcess'],
  who_closes:           ['whoCloses'],
  bottlenecks_churn:    ['mainBottleneck'],
  tools_stack:          ['crm', 'tools'],
  present_findings:     ['diagnosedProblems'],
  validate_priority:    ['userPriority']
};

const PHASE_TOPICS = {
  company:   ['business_model', 'stage_revenue', 'team_composition', 'funding'],
  gtm:       ['icp_definition', 'sales_motion_channels', 'key_metrics_cac'],
  sales:     ['sales_process', 'who_closes', 'bottlenecks_churn', 'tools_stack'],
  diagnosis: ['present_findings', 'validate_priority']
};

// Compute covered topics from profile data (not from LLM reports)
function computeCoveredTopics(profile) {
  const covered = [];
  for (const [topic, fields] of Object.entries(TOPIC_TO_FIELDS)) {
    const isFilled = fields.some(f => {
      const v = profile[f];
      return Array.isArray(v) ? v.length > 0 : (v && v.trim() !== '');
    });
    if (isFilled) covered.push(topic);
  }
  return covered;
}

// Get the NEXT uncovered topic for a phase
function getNextTopic(phase, profile) {
  const topics = PHASE_TOPICS[phase] || [];
  const covered = computeCoveredTopics(profile);
  return topics.find(t => !covered.includes(t)) || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: PHASE-SPECIFIC PROMPTS (the core intelligence)
// ═══════════════════════════════════════════════════════════════════════════════

function getPhasePrompt(phase, session) {
  const p = session.profile;
  const covered = computeCoveredTopics(p);
  const phaseTurns = session.phaseTurnCount || 0;
  const nextTopic = getNextTopic(phase, p);
  
  // Helper: show topic status
  const topicStatus = (topic, label) => covered.includes(topic) 
    ? `  ✅ ${label} — ALREADY ANSWERED (do NOT ask again)`
    : `  ❌ ${label} — NOT YET ASKED → ask about this`;
  
  const prompts = {
    // ─────────────────────────────────────────────────────────────────────────
    welcome: `
YOU ARE IN THE WELCOME PHASE.

You just received scraped data about this company. Your job:
1. Greet them confidently
2. Show you've done homework — reference 3-4 SPECIFIC things from the scraped data (actual headlines, prices, features, quotes from website)
3. Make 3 bold assumptions about their business
4. Ask: "Ho capito bene? Cosa devo correggere?" / "Did I get this right?"

YOUR OPTIONS must be:
- One for "mostly correct"
- One for "partially correct, let me clarify"
- One for "quite different, let me explain"

SCRAPED DATA:
${session.scrapedSummary || 'No scraped data available — ask the user to describe their business.'}

TONE: Confident, specific, like a consultant who already knows their stuff.
MINIMUM: 6 sentences. Quote actual content from the website.
`,
    // ─────────────────────────────────────────────────────────────────────────
    company: `
YOU ARE IN THE COMPANY ANALYSIS PHASE. Turn ${phaseTurns + 1} in this phase.

TOPIC STATUS — check marks mean DO NOT ASK AGAIN:
${topicStatus('business_model', 'Business Model (SaaS/services/marketplace, B2B/B2C, pricing type)')}
${topicStatus('stage_revenue', 'Stage & Revenue (pre-revenue/early/growth/scaling, MRR, growth rate)')}
${topicStatus('team_composition', 'Team (size, roles, tech/sales/marketing split, missing roles)')}
${topicStatus('funding', 'Funding (bootstrapped/funded, round, runway, profitable?)')}

${nextTopic ? `
YOUR TASK: Ask about "${nextTopic.replace(/_/g, ' ').toUpperCase()}"
` : `
ALL TOPICS COVERED in this phase. Summarize what you know and transition.
Set ready_to_advance: true
`}

WHAT THE USER JUST TOLD YOU — acknowledge it first:
${p.businessModel ? `Business model: ${p.businessModel}` : ''}
${p.stage ? `Stage: ${p.stage}` : ''}
${p.revenue ? `Revenue: ${p.revenue}` : ''}
${p.teamSize ? `Team: ${p.teamSize} ${p.teamRoles || ''}` : ''}
${p.funding ? `Funding: ${p.funding}` : ''}

YOUR APPROACH:
1. Acknowledge what they said (2-3 sentences, be SPECIFIC, use their exact words)
2. Share a relevant insight or benchmark (e.g., "At your revenue, companies typically have X people")
3. Ask ONE clear question about the next ❌ topic
4. Generate 4-5 options that are SPECIFIC ANSWERS to your question

IMPORTANT: Options must be answers to YOUR question. If you ask about revenue, options should be revenue ranges. If you ask about team, options should be team sizes.

MINIMUM: 5 sentences. Include a benchmark or reference.
`,
    // ─────────────────────────────────────────────────────────────────────────
    gtm: `
YOU ARE IN THE GO-TO-MARKET ANALYSIS PHASE. Turn ${phaseTurns + 1}.

${phaseTurns === 0 ? `TRANSITION: Start with "Passiamo alla tua strategia Go-to-Market" / "Let's map your Go-to-Market."
Summarize company findings: "${p.companyName || 'Your company'} is a ${p.businessModel || '?'} at ${p.stage || '?'} stage with ${p.teamSize || '?'} people, ${p.funding || '?'}."` : ''}

TOPIC STATUS:
${topicStatus('icp_definition', 'ICP — ideal buyer persona, company size, industry, pain point')}
${topicStatus('sales_motion_channels', 'Sales motion & channels — inbound/outbound/PLG, which channels, best performer')}
${topicStatus('key_metrics_cac', 'Key metrics — ACV, sales cycle, CAC, LTV, conversion rates')}

${nextTopic ? `YOUR TASK: Ask about "${nextTopic.replace(/_/g, ' ').toUpperCase()}"` : 'ALL TOPICS COVERED. Set ready_to_advance: true'}

KNOWN DATA TO REFERENCE:
${p.icpTitle ? `ICP: ${p.icpTitle} at ${p.icpCompanySize || '?'} companies` : ''}
${p.salesMotion ? `Motion: ${p.salesMotion}, channels: ${p.channels || '?'}` : ''}
${p.avgDealSize ? `ACV: ${p.avgDealSize}, cycle: ${p.salesCycle || '?'}` : ''}

YOUR APPROACH:
1. Acknowledge previous answer with a business INSIGHT (not "great, thanks")
2. Connect to their situation: "With a ${p.businessModel || 'SaaS'} selling to ${p.icpTitle || 'your audience'}..."
3. Include benchmark: "For B2B ${p.businessModel || 'SaaS'} at ${p.stage || 'your stage'}, typical X is Y"
4. Ask ONE focused question about the next ❌ topic
5. Generate 4-6 options that DIRECTLY answer your question

MINIMUM: 5 sentences.
`,
    // ─────────────────────────────────────────────────────────────────────────
    sales: `
YOU ARE IN THE SALES ENGINE ANALYSIS PHASE. Turn ${phaseTurns + 1}.

${phaseTurns === 0 ? `TRANSITION: Start with "Analizziamo il tuo motore di vendita" / "Let's analyze your Sales Engine."
Summarize: "You're a ${p.businessModel || '?'} selling to ${p.icpTitle || '?'} via ${p.salesMotion || '?'}, with ACV of ${p.avgDealSize || '?'}."` : ''}

TOPIC STATUS:
${topicStatus('sales_process', 'Sales process — steps from first contact to close, documented?, CRM used')}
${topicStatus('who_closes', 'Who closes — founder vs team, percentage, can deals close without founder?')}
${topicStatus('bottlenecks_churn', 'Bottlenecks — where deals die, win rate, objections, churn rate')}
${topicStatus('tools_stack', 'Tech stack — CRM, automation, analytics, pipeline tracking')}

${nextTopic ? `YOUR TASK: Ask about "${nextTopic.replace(/_/g, ' ').toUpperCase()}"` : 'ALL TOPICS COVERED. Set ready_to_advance: true'}

KNOWN SALES DATA:
${p.salesProcess ? `Process: ${p.salesProcess}` : ''}
${p.whoCloses ? `Closes: ${p.whoCloses}` : ''}
${p.mainBottleneck ? `Bottleneck: ${p.mainBottleneck}` : ''}
${p.crm || p.tools ? `Tools: ${p.crm || p.tools}` : ''}

HYPOTHESES TO SHARE (pick the most relevant):
${p.whoCloses && p.whoCloses.toLowerCase().includes('founder') ? '- "FOUNDER-LED TRAP: If you close >60% of deals, scaling is mathematically impossible without building a sales playbook first."' : ''}
${!p.salesProcess || p.salesProcess.toLowerCase().includes('no') ? '- "Without a documented process, each new hire starts from zero. You\'re not scaling — you\'re duplicating chaos."' : ''}
${!p.winRate ? '- "Not tracking win rate = flying blind. You can\'t optimize what you don\'t measure."' : ''}

YOUR APPROACH:
1. Acknowledge with insight (reference their specific situation)
2. Make a bold hypothesis if relevant
3. Ask ONE focused question about the next ❌ topic
4. Generate situational options

MINIMUM: 5 sentences. Be provocative.
`,
    // ─────────────────────────────────────────────────────────────────────────
    diagnosis: `
YOU ARE IN THE DIAGNOSIS PHASE. Turn ${phaseTurns + 1}.

${phaseTurns === 0 ? `
THIS IS YOUR DIAGNOSIS — PRESENT YOUR FINDINGS.
Do NOT ask discovery questions. You have enough information.

FULL DATA COLLECTED:
- Company: ${p.companyName}, ${p.businessModel}, ${p.stage}, ${p.revenue}
- Team: ${p.teamSize} (${p.teamRoles || '?'}), ${p.funding}
- ICP: ${p.icpTitle} at ${p.icpCompanySize || '?'} in ${p.icpIndustry || '?'}
- Motion: ${p.salesMotion}, channels: ${p.channels}, ACV: ${p.avgDealSize}
- Process: ${p.salesProcess}, closes: ${p.whoCloses}
- Bottleneck: ${p.mainBottleneck}, churn: ${p.churnRate || '?'}
- Tools: ${p.crm || p.tools || '?'}

PRESENT:
1. "Ecco la mia diagnosi" / "Here is my diagnosis"
2. TOP 3 problems ranked by revenue impact. For EACH:
   - Problem name (specific)
   - Root cause (WHY)
   - Revenue impact (quantify)
   - Benchmark (what "good" looks like)
3. Core hypothesis in ONE sentence
4. Ask: "Questa diagnosi risuona?" / "Does this resonate?"

OPTIONS: resonates / mostly right / missed something / wrong causes
This is your LONGEST message. MINIMUM 10 sentences. Use their real data.
` : `
User responded to your diagnosis. ADJUST based on what they said.
If agreed → ask about #1 priority for next 90 days and what they already tried
If disagreed → ask what to change, present adjusted view
OPTIONS: priority choices + "let me correct something"
MINIMUM: 5 sentences.
`}
`,
    // ─────────────────────────────────────────────────────────────────────────
    pre_finish: `
FINAL SUMMARY — present everything before report generation.

DATA:
- Company: ${p.companyName}, ${p.businessModel}, ${p.stage}, ${p.revenue}
- Team: ${p.teamSize}, ${p.funding}
- ICP: ${p.icpTitle}, Motion: ${p.salesMotion}
- Top problems: ${(p.diagnosedProblems||[]).join('; ') || '?'}
- Priority: ${p.userPriority || '?'}

STRUCTURE:
1. "Ecco il quadro completo:" / "Here's the complete picture:"
2. Company snapshot (3 sentences, real data)
3. The 3 problems (1 sentence each, specific)
4. Priority order
5. Preview: "Il tuo piano includerà: executive summary, diagnosi, roadmap 90 giorni, metriche, strumenti."
6. "Sei pronto a generare?" / "Ready to generate?"

YOU MUST include these options:
- { "key": "generate_report", "label": "📥 Genera il Growth Plan" } (or English equivalent)
- { "key": "add_context", "label": "Aspetta, voglio aggiungere qualcosa" } (or English equivalent)
- { "key": "adjust_finding", "label": "Voglio correggere un punto" }

MINIMUM: 8 sentences.
`,
    // ─────────────────────────────────────────────────────────────────────────
    add_context: `
The user wants to ADD or CORRECT something.

${phaseTurns === 0 ? `
Ask what they want to add/correct. Be welcoming.
"Certo! Cosa vuoi aggiungere o correggere?" / "Of course! What would you like to add?"
Do NOT mention the report yet. Do NOT show generate button.
OPTIONS: areas to add context (team, market, product, challenges, correct diagnosis)
` : `
They just shared context: "${session.conversationSummary.slice(-1)[0] || ''}"
1. Acknowledge SPECIFICALLY
2. Explain how it changes your view
3. Ask if there's more, or generate

Include these options:
- "I have more to add"
- { "key": "generate_report", "label": "📥 Generate Updated Plan" }
`}
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
    conversationSummary: []
  };
}

function buildFullProfile(session) {
  const p = session.profile;
  const covered = computeCoveredTopics(p);
  const f = (label, val) => {
    const v = Array.isArray(val) ? (val.length > 0 ? val.join('; ') : '') : (val || '');
    return v ? `  ✅ ${label}: ${v}` : `  ❓ ${label}: NOT YET KNOWN`;
  };
  
  return `
═══ BUSINESS PROFILE (✅ = known, ❓ = still needed) ═══

COMPANY:
${f('Name', p.companyName)}
${f('Website', p.website)}
${f('Industry', p.industry)}
${f('Business Model', p.businessModel)}
${f('Stage', p.stage)}
${f('Revenue', p.revenue)}
${f('Team Size', p.teamSize)}
${f('Team Roles', p.teamRoles)}
${f('Funding', p.funding)}

PRODUCT:
${f('Description', p.productDescription)}
${f('Pricing', `${p.pricingModel} ${p.pricingRange}`.trim())}

GO-TO-MARKET:
${f('ICP (Buyer)', p.icpTitle)}
${f('ICP Company', p.icpCompanySize)}
${f('ICP Pain Points', p.icpPainPoints)}
${f('Sales Motion', p.salesMotion)}
${f('Channels', p.channels)}
${f('Avg Deal Size', p.avgDealSize)}
${f('Sales Cycle', p.salesCycle)}
${f('CAC', p.cac)}

SALES ENGINE:
${f('Process', p.salesProcess)}
${f('Who Closes', p.whoCloses)}
${f('Bottleneck', p.mainBottleneck)}
${f('Churn Rate', p.churnRate)}
${f('CRM/Tools', p.crm || p.tools)}

DIAGNOSIS:
${f('Problems', p.diagnosedProblems)}
${f('Root Causes', p.rootCauses)}
${f('User Priority', p.userPriority)}
${f('Additional Context', p.additionalContext)}

═══ TOPICS COVERED: ${covered.join(', ') || 'none yet'} ═══
═══ CONVERSATION (last 10 of ${session.conversationSummary.length} turns) ═══
${session.conversationSummary.length > 0 ? session.conversationSummary.slice(-10).join('\n') : 'No history.'}
═══ PHASE: ${session.currentPhase} | PHASE TURN: ${session.phaseTurnCount} | TOTAL: ${session.turnCount} ═══`;
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
2. Your "message" MUST end with a clear question (except in diagnosis/pre_finish phases)
3. "profile_updates" — extract ANY info from the user's input and map to the correct profile field
4. "topic_covered" — set to the topic name you just got answers for (or null)
5. "ready_to_advance" — set true ONLY if all ❌ topics are now covered
6. ALWAYS acknowledge what the user said BEFORE asking your next question
7. ABSOLUTELY DO NOT ask about any topic marked ✅ in the profile or phase instructions
8. Look at the ❌ topics in the phase instructions — ask about the FIRST uncovered one
9. Include at least one benchmark, example, or framework reference per response
10. If the user writes in Italian, respond ENTIRELY in Italian. If English, respond in English.
`;

    console.log(`[v9] Turn ${session.turnCount} | Phase: ${session.currentPhase} | PhaseTurn: ${session.phaseTurnCount} | Topics: ${computeCoveredTopics(session.profile).join(',')}`);

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
    
    // Update profile from LLM extractions
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
    
    // Log AI turn
    const coveredNow = computeCoveredTopics(session.profile);
    session.conversationSummary.push(
      `Turn ${session.turnCount}: [${session.currentPhase}] AI response. Covered topics: ${coveredNow.join(', ')}`
    );
    
    session.phaseTurnCount++;

    // ═════════════════════════════════════════════════════════════
    // CHECK PHASE ADVANCE (profile-based)
    // ═════════════════════════════════════════════════════════════
    
    const currentPhaseConfig = PHASES[session.currentPhase];
    
    if (currentPhaseConfig && currentPhaseConfig.next) {
      const minMet = session.phaseTurnCount >= currentPhaseConfig.minTurns;
      const maxHit = session.phaseTurnCount >= currentPhaseConfig.maxTurns;
      
      // Check if all topics for current phase are covered (profile-based)
      const phaseTopics = PHASE_TOPICS[session.currentPhase] || [];
      const allTopicsCovered = phaseTopics.length > 0 && phaseTopics.every(t => coveredNow.includes(t));
      
      const llmReady = llmResponse.ready_to_advance === true;
      
      if (maxHit || (minMet && (allTopicsCovered || llmReady))) {
        console.log(`[v9] Phase advance: ${session.currentPhase} → ${currentPhaseConfig.next} (min:${minMet} max:${maxHit} topics:${allTopicsCovered} llm:${llmReady})`);
        session.currentPhase = currentPhaseConfig.next;
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
    if (session.currentPhase === 'pre_finish' || (currentPhaseConfig?.next === 'pre_finish' && session.phaseTurnCount === 0)) {
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
