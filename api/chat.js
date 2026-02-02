// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE ARCHITECT v10 - SIMPLE
// Back to basics: LLM has freedom, backend just tracks and enforces progression
// ═══════════════════════════════════════════════════════════════════════════════

const PHASES = ['welcome', 'company', 'gtm', 'sales', 'diagnosis', 'pre_finish', 'finish'];

function createSession() {
  return {
    currentPhase: 'welcome',
    turnCount: 0,
    questionsAsked: [],
    profile: {
      companyName: '', website: '', industry: '',
      businessModel: '', stage: '', revenue: '', teamSize: '', funding: '',
      icp: '', salesMotion: '', channels: '', avgDealSize: '', salesCycle: '',
      salesProcess: '', whoCloses: '', bottleneck: '', churnRate: '',
      tools: '', diagnosedProblems: [], userPriority: '', additionalContext: ''
    },
    scrapedData: '',
    insights: []
  };
}

function buildContext(session) {
  const p = session.profile;
  return `
=== BUSINESS PROFILE ===
Company: ${p.companyName || '?'} | Website: ${p.website || '?'}
Industry: ${p.industry || '?'} | Model: ${p.businessModel || '?'}
Stage: ${p.stage || '?'} | Revenue: ${p.revenue || '?'} | Team: ${p.teamSize || '?'} | Funding: ${p.funding || '?'}
ICP: ${p.icp || '?'} | Motion: ${p.salesMotion || '?'} | Channels: ${p.channels || '?'}
Deal size: ${p.avgDealSize || '?'} | Cycle: ${p.salesCycle || '?'}
Sales process: ${p.salesProcess || '?'} | Who closes: ${p.whoCloses || '?'}
Bottleneck: ${p.bottleneck || '?'} | Churn: ${p.churnRate || '?'} | Tools: ${p.tools || '?'}
Diagnosed problems: ${(p.diagnosedProblems||[]).join(', ') || '?'}
User priority: ${p.userPriority || '?'}
Extra context: ${p.additionalContext || 'none'}

=== SCRAPED DATA ===
${session.scrapedData || 'No data'}

=== QUESTIONS ALREADY ASKED (DO NOT REPEAT) ===
${session.questionsAsked.length > 0 ? session.questionsAsked.join('\n') : 'None yet'}

=== KEY INSIGHTS ===
${session.insights.slice(-5).join('\n') || 'None'}

=== PHASE: ${session.currentPhase} | TURN: ${session.turnCount} ===`;
}

const PROMPTS = {
  welcome: `You are the Revenue Architect. You just analyzed the user's website.

TASK: Create a personalized welcome message.
1. Greet them and cite 3-4 SPECIFIC elements from the website (headlines, prices, features)
2. Make 2-3 bold assumptions about their business
3. Ask for confirmation: "Did I get this right? What should I correct?"

Be confident, specific, like a consultant who did their homework.`,

  company: `You are in the COMPANY phase. You need to understand the business fundamentals.

TOPICS TO EXPLORE (one at a time):
- Business model (SaaS, services, marketplace?)
- Stage and revenue (pre-revenue, early, growth?)
- Team (how many? what roles?)
- Funding (bootstrapped, funded?)

RULES:
- Do NOT repeat questions already asked
- One question per turn
- Include a benchmark or real example
- Options must be specific answers to YOUR question`,

  gtm: `You are in the GTM phase. You need to understand the go-to-market strategy.

TOPICS TO EXPLORE:
- ICP: who buys? what role? what companies?
- Sales motion: inbound, outbound, PLG?
- Channels: which work? which don't?
- Metrics: ACV, sales cycle, CAC

RULES:
- Connect to the company info already gathered
- One question per turn
- Specific benchmarks for their industry`,

  sales: `You are in the SALES phase. You need to understand the sales engine and find bottlenecks.

TOPICS TO EXPLORE:
- Current sales process
- Who closes deals? Founder or team?
- Where do deals get stuck?
- Win rate, objections, churn

INSIGHTS TO LOOK FOR:
- "Founder-Led Sales Trap": if founder closes >60% of deals, there's a scaling problem
- Undocumented process = every new sales rep starts from zero
- If they don't measure, they can't improve

Be provocative but respectful.`,

  diagnosis: `You are in the DIAGNOSIS phase. YOU HAVE ENOUGH INFORMATION.

DO NOT ask more discovery questions. PRESENT YOUR DIAGNOSIS.

STRUCTURE:
1. "Here is my diagnosis:"
2. TOP 3 problems blocking revenue, for each:
   - Problem name
   - Root cause
   - Estimated impact
3. Core hypothesis in one sentence
4. Ask: "Does this diagnosis resonate?"

Use ALL the data you collected. Be specific, cite real numbers.`,

  pre_finish: `You are ready to generate the report.

TASK: Present the final summary.
1. Company snapshot (3 sentences)
2. The 3 diagnosed problems
3. Suggested priorities
4. Report preview: "Your plan will include: executive summary, diagnosis, 90-day roadmap, metrics, tools."
5. "Ready to generate?"

REQUIRED OPTIONS:
- { "key": "generate_report", "label": "📥 Generate Growth Plan" }
- { "key": "add_context", "label": "Wait, I want to add something" }`
};

// Determine next phase
function getNextPhase(session) {
  const { currentPhase, turnCount, questionsAsked, profile } = session;
  
  // Force progression after too many turns
  if (turnCount >= 15) return 'pre_finish';
  
  switch (currentPhase) {
    case 'welcome': return 'company';
    case 'company':
      if (questionsAsked.filter(q => q.includes('company') || q.includes('stage') || q.includes('revenue') || q.includes('team') || q.includes('funding')).length >= 3 ||
          (profile.businessModel && profile.stage)) return 'gtm';
      return 'company';
    case 'gtm':
      if (questionsAsked.filter(q => q.includes('gtm') || q.includes('icp') || q.includes('channel') || q.includes('motion')).length >= 3 ||
          (profile.icp && profile.salesMotion)) return 'sales';
      return 'gtm';
    case 'sales':
      if (questionsAsked.filter(q => q.includes('sales') || q.includes('process') || q.includes('bottleneck') || q.includes('founder')).length >= 3 ||
          (profile.salesProcess && profile.bottleneck)) return 'diagnosis';
      return 'sales';
    case 'diagnosis':
      if (profile.diagnosedProblems.length > 0 || turnCount >= 12) return 'pre_finish';
      return 'diagnosis';
    case 'pre_finish': return 'finish';
    default: return 'company';
  }
}

async function scrapeWebsite(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const c = new AbortController(); setTimeout(() => c.abort(), 12000);
    const r = await fetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: c.signal });
    const html = await r.text();
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || '';
    const desc = (html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || [])[1] || '';
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(t => t.length > 2).slice(0, 4);
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(t => t.length > 2).slice(0, 6);
    const prices = [...new Set(html.match(/(\$|€|£)\s*\d+[,.]?\d*/g) || [])].slice(0, 5);
    return `TITOLO: ${title}\nDESCRIZIONE: ${desc}\nH1: ${h1s.join(' | ')}\nH2: ${h2s.join(' | ')}\nPREZZI: ${prices.join(', ') || 'nessuno'}`;
  } catch (e) { return null; }
}

async function callLLM(systemPrompt, userMessage, context, history, geminiKey) {
  const fullPrompt = `${systemPrompt}

${context}

USER INPUT: "${userMessage}"

RESPOND IN JSON:
{
  "message": "Your message (markdown). Minimum 3-4 sentences.",
  "options": [{"key": "key", "label": "Option text"}, ...],
  "profile_updates": {"field": "value"},
  "question_asked": "brief description of the question asked",
  "insight": "key insight from this turn"
}`;

  const messages = [
    { role: 'user', parts: [{ text: fullPrompt }] },
    { role: 'model', parts: [{ text: 'OK, I will respond in JSON.' }] }
  ];
  
  for (const m of history.slice(-10)) {
    const content = m.role === 'assistant' ? (JSON.parse(m.content || '{}').message || m.content) : m.content;
    messages.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(content).slice(0, 1500) }] });
  }

  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: messages, generationConfig: { temperature: 0.8, responseMimeType: "application/json", maxOutputTokens: 2500 } })
  });
  
  if (!resp.ok) throw new Error(`Gemini: ${resp.status}`);
  const data = await resp.json();
  let text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(text);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { choice, history = [], contextData, sessionData } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(200).json({ message: 'API key missing', options: [] });

    let session = sessionData || createSession();
    session.turnCount++;

    // INIT
    if (choice === 'SNAPSHOT_INIT') {
      session.currentPhase = 'welcome';
      if (contextData?.website) {
        session.profile.website = contextData.website;
        session.scrapedData = await scrapeWebsite(contextData.website) || '';
        if (contextData.description) session.scrapedData += `\nDESCRIZIONE UTENTE: ${contextData.description}`;
      }
    }
    // ADD CONTEXT
    else if (choice === 'add_context') {
      session.currentPhase = 'add_context_mode';
    }
    // GENERATE
    else if (choice === 'generate_report') {
      return res.status(200).json({
        message: '📥 Generating...', mode: 'buttons',
        options: [{ key: 'generating', label: '⏳ Generating...' }],
        session_data: session, current_phase: 'finish'
      });
    }

    // Store user input
    if (choice !== 'SNAPSHOT_INIT') {
      session.insights.push(`Turno ${session.turnCount}: Utente ha detto "${choice.slice(0, 80)}"`);
    }

    // Determine phase (auto-advance)
    if (session.currentPhase !== 'add_context_mode') {
      session.currentPhase = getNextPhase(session);
    }

    // Get prompt
    let prompt = PROMPTS[session.currentPhase] || PROMPTS.company;
    if (session.currentPhase === 'add_context_mode') {
      prompt = `The user wants to add context. Ask what they want to add or correct. Be welcoming. When they're done, offer to generate the report with the generate_report option.`;
    }

    // Call LLM
    const context = buildContext(session);
    let llm;
    try {
      llm = await callLLM(prompt, choice, context, history, geminiKey);
    } catch (e) {
      console.error('[LLM Error]', e.message);
      llm = {
        message: "Let's continue the analysis. What's your main challenge?",
        options: [{ key: 'continue', label: 'Continue' }],
        profile_updates: {}
      };
    }

    // Update profile
    if (llm.profile_updates) {
      for (const [k, v] of Object.entries(llm.profile_updates)) {
        if (v && session.profile.hasOwnProperty(k)) {
          if (Array.isArray(session.profile[k])) {
            session.profile[k] = [...session.profile[k], ...(Array.isArray(v) ? v : [v])];
          } else {
            session.profile[k] = v;
          }
        }
      }
    }

    // Track question
    if (llm.question_asked) {
      session.questionsAsked.push(llm.question_asked);
    }
    if (llm.insight) {
      session.insights.push(llm.insight);
    }

    // Ensure options
    let options = llm.options || [];
    if (!Array.isArray(options) || options.length === 0) {
      options = [{ key: 'continue', label: 'Continue' }];
    }
    
    // Force generate option in pre_finish
    if (session.currentPhase === 'pre_finish' && !options.some(o => o.key === 'generate_report')) {
      options.unshift({ key: 'generate_report', label: '📥 Generate Growth Plan' });
    }

    console.log(`[v10] Turn ${session.turnCount} | Phase: ${session.currentPhase}`);

    return res.status(200).json({
      message: llm.message || 'Let\'s continue.',
      options: options.filter(o => o && o.key && o.label).slice(0, 6),
      mode: session.currentPhase === 'pre_finish' ? 'buttons' : 'mixed',
      allow_text: session.currentPhase !== 'pre_finish',
      session_data: session,
      current_phase: session.currentPhase,
      turn_count: session.turnCount
    });

  } catch (e) {
    console.error('[v10 ERROR]', e);
    return res.status(200).json({
      message: "Error. What's your main challenge?",
      options: [{ key: 'retry', label: 'Retry' }],
      mode: 'mixed', allow_text: true
    });
  }
}
