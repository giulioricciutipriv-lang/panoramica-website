// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE ARCHITECT - v8.0 FINAL
// 
// Fixes from v7:
// 1. Step advancement was double-counting → now explicit nextStep tracking
// 2. LLM was ignoring options → options are now HARDCODED per step, not LLM-generated
// 3. "Add context" was looping → dedicated state machine for add_context  
// 4. PDF blank → use window.print() with styled HTML, not html2pdf.js
// 5. LLM losing context → full conversation replay with explicit "you said X, they said Y"
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CONVERSATION SCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

const STEPS = {
  // ── WELCOME ──
  welcome: {
    phase: 'welcome', nextStep: 'company_model',
    instruction: `Create a WELCOME message. You MUST:
1. Greet them, name the company
2. Reference 3-4 SPECIFIC things from their website (actual headlines, pricing, features you see in the scraped data)
3. Make 3 bold assumptions about their business
4. End with a clear question: "Ho capito bene? Cosa devo correggere?" / "Did I get this right? What should I correct?"

MINIMUM 6 sentences. Be specific — quote actual text from the website data.`,
    options: [
      { key: 'correct', label: 'Yes, that\'s mostly correct' },
      { key: 'partial', label: 'Partially — let me clarify a few things' },
      { key: 'wrong', label: 'Actually quite different — let me explain' }
    ],
    mode: 'mixed'
  },

  // ── COMPANY ──
  company_model: {
    phase: 'company', nextStep: 'company_stage',
    instruction: `Ask about their BUSINESS MODEL. You MUST ask ONE clear question:
"What is your business model? SaaS subscription, usage-based, services, marketplace?"

First acknowledge what they said (2 sentences). Then ask the question.
Include an insight: "Based on your website I see [X], which suggests [Y]."
MINIMUM 5 sentences.`,
    options: [
      { key: 'saas_subscription', label: 'SaaS with recurring subscription' },
      { key: 'saas_usage', label: 'SaaS with usage-based pricing' },
      { key: 'services', label: 'Professional services / consulting' },
      { key: 'marketplace', label: 'Marketplace or platform' },
      { key: 'hybrid', label: 'Hybrid / other model' }
    ],
    mode: 'mixed'
  },
  company_stage: {
    phase: 'company', nextStep: 'company_team',
    instruction: `Ask about STAGE and REVENUE. ONE clear question:
"What's your current revenue? Pre-revenue, early (0-10K MRR), growing (10-50K), scaling (50K+)?"

First acknowledge business model with an insight (2 sentences).
Include a benchmark: "For [their model] companies, the path typically looks like..."
MINIMUM 5 sentences.`,
    options: [
      { key: 'pre_revenue', label: 'Pre-revenue — still building' },
      { key: 'early', label: '€0-€10K MRR — early customers' },
      { key: 'growing', label: '€10K-€50K MRR — growing' },
      { key: 'scaling', label: '€50K-€200K MRR — scaling' },
      { key: 'mature', label: '€200K+ MRR — optimizing' }
    ],
    mode: 'mixed'
  },
  company_team: {
    phase: 'company', nextStep: 'company_funding',
    instruction: `Ask about TEAM. ONE clear question:
"How many people are on your team? How is it structured? (tech, sales, marketing)"

Acknowledge revenue info with context: "At [X] MRR, the typical team for a [their model] is..."
Reference SaaStr or similar benchmarks.
MINIMUM 5 sentences.`,
    options: [
      { key: 'solo', label: 'Solo founder or 1-2 people' },
      { key: 'small', label: '3-5 people, mostly technical' },
      { key: 'growing_team', label: '5-15, mixed roles' },
      { key: 'mid', label: '15-50, structured departments' },
      { key: 'large', label: '50+ employees' }
    ],
    mode: 'mixed'
  },
  company_funding: {
    phase: 'company', nextStep: 'gtm_icp',
    instruction: `Ask about FUNDING. ONE question:
"Are you bootstrapped or funded? If funded, what stage? How much runway?"

Acknowledge team info. Include: "This matters because it determines how aggressively you can invest in growth."
MINIMUM 4 sentences.`,
    options: [
      { key: 'bootstrapped_profit', label: 'Bootstrapped and profitable' },
      { key: 'bootstrapped_burn', label: 'Bootstrapped, burning cash' },
      { key: 'seed', label: 'Pre-seed or seed round' },
      { key: 'series_a', label: 'Series A or later' },
      { key: 'other_funding', label: 'Other situation' }
    ],
    mode: 'mixed'
  },

  // ── GTM ──
  gtm_icp: {
    phase: 'gtm', nextStep: 'gtm_motion',
    instruction: `TRANSITION: "Now let's map your Go-to-Market." 
Summarize company findings in 2 sentences.

Ask about ICP: "Who is your ideal customer? What job title, company size, industry?"
Include: "A well-defined ICP is the foundation of scalable revenue."
MINIMUM 5 sentences.`,
    options: [
      { key: 'smb', label: 'SMB owners / small teams' },
      { key: 'mid_market', label: 'Mid-market managers/directors' },
      { key: 'enterprise', label: 'Enterprise VP/C-level' },
      { key: 'developers', label: 'Developers / technical ICs' },
      { key: 'unclear_icp', label: 'Not clearly defined yet' }
    ],
    mode: 'mixed'
  },
  gtm_motion: {
    phase: 'gtm', nextStep: 'gtm_metrics',
    instruction: `Ask about SALES MOTION and CHANNELS. ONE question:
"Is your go-to-market inbound, outbound, product-led, or a mix? Which channels work best?"

Acknowledge ICP with insight: "Selling to [their ICP], the most effective motion is usually..."
Mention relevant tools/approaches.
MINIMUM 5 sentences.`,
    options: [
      { key: 'inbound_content', label: 'Inbound: content, SEO, referrals' },
      { key: 'outbound_cold', label: 'Outbound: cold email, LinkedIn, calls' },
      { key: 'plg', label: 'Product-led: free trial, freemium' },
      { key: 'paid', label: 'Paid acquisition: ads, sponsorships' },
      { key: 'mixed_channels', label: 'Mix of multiple channels' },
      { key: 'figuring_out', label: 'Still figuring out what works' }
    ],
    mode: 'mixed'
  },
  gtm_metrics: {
    phase: 'gtm', nextStep: 'sales_process',
    instruction: `Ask about KEY METRICS. ONE question:
"What's your average deal size, sales cycle length, and do you know your CAC?"

Include benchmarks: "For B2B [their model] selling to [their ICP], typical ACV is X, cycle is Y."
Push for specifics. MINIMUM 5 sentences.`,
    options: [
      { key: 'low_touch', label: '<€1K deals, <2 week cycle' },
      { key: 'mid_touch', label: '€1K-€10K deals, 1-3 month cycle' },
      { key: 'high_touch', label: '€10K+ deals, 3-6+ month cycle' },
      { key: 'dont_track', label: 'Don\'t track these yet' },
      { key: 'varies', label: 'It varies a lot' }
    ],
    mode: 'mixed'
  },

  // ── SALES ──
  sales_process: {
    phase: 'sales', nextStep: 'sales_who_closes',
    instruction: `TRANSITION: "Let's dig into your Sales Engine."
Summarize GTM findings in 2 sentences.

Ask: "Walk me through your sales process. What happens from first contact to close? Is it documented?"
Include: "A repeatable sales process is what separates companies that scale from those that stall."
MINIMUM 5 sentences.`,
    options: [
      { key: 'no_process', label: 'No formal process — ad hoc' },
      { key: 'basic', label: 'Basic: demo → proposal → close' },
      { key: 'documented', label: 'Multi-stage documented pipeline' },
      { key: 'enterprise_proc', label: 'Complex enterprise with procurement' },
      { key: 'self_serve', label: 'Mostly self-serve / PLG' }
    ],
    mode: 'mixed'
  },
  sales_who_closes: {
    phase: 'sales', nextStep: 'sales_bottleneck',
    instruction: `Ask WHO CLOSES DEALS. ONE question:
"Who is actually closing deals? Founder, sales team, or self-serve? What percentage?"

Include: "If the founder closes >60% of deals, you have a scaling ceiling."
Give a real example. MINIMUM 5 sentences.`,
    options: [
      { key: 'founder_all', label: 'Founder closes 100%' },
      { key: 'founder_most', label: 'Founder 60-90%, team assists' },
      { key: 'split', label: '~50/50 founder and team' },
      { key: 'team_mostly', label: 'Team mostly, founder on big deals' },
      { key: 'no_sales', label: 'No dedicated sales team yet' }
    ],
    mode: 'mixed'
  },
  sales_bottleneck: {
    phase: 'sales', nextStep: 'sales_tools',
    instruction: `Ask about BOTTLENECKS. ONE question:
"Where do deals get stuck or die? What's your win rate? What's your churn?"

Make a hypothesis: "Based on what you've told me, I suspect the bottleneck is [X] because [Y]."
MINIMUM 5 sentences.`,
    options: [
      { key: 'not_enough_leads', label: 'Not enough qualified leads' },
      { key: 'leads_cold', label: 'Leads go cold, slow follow-up' },
      { key: 'stuck_deal', label: 'Deals stall in negotiation' },
      { key: 'price_issue', label: 'Price is the main blocker' },
      { key: 'no_urgency', label: 'No urgency to buy' },
      { key: 'churn_kills', label: 'We close but churn kills us' }
    ],
    mode: 'mixed'
  },
  sales_tools: {
    phase: 'sales', nextStep: 'diagnosis_present',
    instruction: `Ask about TOOLS and TECH STACK. ONE question:
"What tools do you use? CRM, email automation, analytics? How do you track pipeline?"

Include: "At your stage, the essential stack is [X, Y, Z]."
Recommend specific tools. MINIMUM 4 sentences.`,
    options: [
      { key: 'spreadsheets', label: 'Spreadsheets and manual tracking' },
      { key: 'basic_crm', label: 'Basic CRM (HubSpot Free, Pipedrive)' },
      { key: 'full_stack', label: 'Full stack: CRM + automation + analytics' },
      { key: 'too_many', label: 'Too many disconnected tools' },
      { key: 'need_recs', label: 'Minimal — need recommendations' }
    ],
    mode: 'mixed'
  },

  // ── DIAGNOSIS ──
  diagnosis_present: {
    phase: 'diagnosis', nextStep: 'diagnosis_validate',
    instruction: `PRESENT YOUR DIAGNOSIS. Do NOT ask more discovery questions.

Structure:
1. "Based on everything you've shared, here is my diagnosis:"
2. TOP 3 revenue problems, each with:
   - The problem (specific)
   - Root cause (why)
   - Revenue impact (quantify)
   - Benchmark (what good looks like)
3. Your CORE HYPOTHESIS in one sentence
4. End with: "Does this resonate?"

This should be your LONGEST message. MINIMUM 10 sentences.
Reference actual data they provided. Be specific.`,
    options: [
      { key: 'resonates', label: '🎯 Spot on — this resonates strongly' },
      { key: 'mostly_right', label: 'Mostly right, small adjustments needed' },
      { key: 'missed_issue', label: 'You missed an important issue' },
      { key: 'wrong_causes', label: 'Right problems, wrong root causes' }
    ],
    mode: 'mixed'
  },
  diagnosis_validate: {
    phase: 'diagnosis', nextStep: 'pre_finish',
    instruction: `User responded to your diagnosis. 

If agreed: Validate and ask about priority.
If disagreed: Ask what's wrong and ADJUST.

Ask: "Which problem is your #1 priority for the next 90 days? And what have you already tried to fix?"
Reference their specific feedback. MINIMUM 5 sentences.`,
    options: [
      { key: 'priority_1', label: 'Problem #1 is my top priority' },
      { key: 'priority_2', label: 'Problem #2 is most urgent' },
      { key: 'priority_3', label: 'Problem #3 matters most' },
      { key: 'different', label: 'My priority is different — let me explain' }
    ],
    mode: 'mixed'
  },

  // ── PRE-FINISH ──
  pre_finish: {
    phase: 'pre_finish', nextStep: null,
    instruction: `FINAL SUMMARY before report.

Structure:
1. "Here's the complete picture:"
2. Company snapshot (3 sentences with real data)
3. The 3 problems (1 sentence each with specifics)
4. Priority order based on their input
5. Preview: "Your plan will include: executive summary, diagnostic findings, 90-day roadmap, metrics, tools."
6. "Ready to generate?"

MINIMUM 8 sentences. Make it feel premium.`,
    options: [
      { key: 'generate_report', label: '📥 Generate Strategic Growth Plan' },
      { key: 'add_context', label: 'Wait, I want to add important context' },
      { key: 'adjust', label: 'I want to adjust a finding first' }
    ],
    mode: 'buttons'
  },

  // ── ADD CONTEXT (re-entrant) ──
  add_context_ask: {
    phase: 'add_context', nextStep: 'add_context_receive',
    instruction: `The user wants to ADD or CORRECT something. 

Say: "Of course! Tell me what you'd like to add or correct. Take your time."
Be welcoming. Do NOT mention the report. Do NOT show a generate button.
MINIMUM 3 sentences.`,
    options: [
      { key: 'about_team', label: 'About our team / org structure' },
      { key: 'about_market', label: 'About our market / competition' },
      { key: 'about_product', label: 'About our product / roadmap' },
      { key: 'about_challenges', label: 'Additional challenges' },
      { key: 'correct_diagnosis', label: 'Correct something in the diagnosis' }
    ],
    mode: 'mixed'
  },
  add_context_receive: {
    phase: 'add_context', nextStep: 'add_context_done',
    instruction: `User just shared new context.

1. Acknowledge SPECIFICALLY what they said
2. Explain how this changes your understanding
3. Ask: "Anything else to add? Or shall I update the analysis?"

MINIMUM 4 sentences. Show you actually processed what they said.`,
    options: [
      { key: 'more_to_add', label: 'I have more to add' },
      { key: 'done_adding', label: 'That\'s everything — update the analysis' }
    ],
    mode: 'mixed'
  },
  add_context_done: {
    phase: 'add_context', nextStep: null,
    instruction: `Present UPDATED findings incorporating the new context.

1. "Here's my updated assessment based on what you added:"
2. Show what CHANGED vs the original
3. Updated priority order
4. "Ready to generate the updated plan?"

MINIMUM 6 sentences.`,
    options: [
      { key: 'generate_report', label: '📥 Generate Updated Growth Plan' },
      { key: 'add_more', label: 'Actually, one more thing...' }
    ],
    mode: 'buttons'
  }
};

// Step order for normal flow
const STEP_ORDER = [
  'welcome', 'company_model', 'company_stage', 'company_team', 'company_funding',
  'gtm_icp', 'gtm_motion', 'gtm_metrics',
  'sales_process', 'sales_who_closes', 'sales_bottleneck', 'sales_tools',
  'diagnosis_present', 'diagnosis_validate', 'pre_finish'
];

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: SESSION
// ═══════════════════════════════════════════════════════════════════════════════

function createSession() {
  return {
    currentStep: 'welcome',
    turnCount: 0,
    profile: {
      companyName:'',website:'',industry:'',businessModel:'',stage:'',revenue:'',
      revenueGrowth:'',teamSize:'',teamRoles:'',funding:'',
      productDescription:'',pricingModel:'',pricingRange:'',
      icpTitle:'',icpCompanySize:'',icpIndustry:'',icpPainPoints:'',
      salesMotion:'',channels:'',bestChannel:'',
      avgDealSize:'',salesCycle:'',cac:'',ltv:'',
      salesProcess:'',processDocumented:'',whoCloses:'',founderInvolvement:'',
      winRate:'',mainObjections:'',lostDealReasons:'',crm:'',churnRate:'',
      mainBottleneck:'',tools:'',
      diagnosedProblems:[],rootCauses:[],validatedProblems:[],
      userPriority:'',pastAttempts:'',constraints:'',additionalContext:''
    },
    scrapedSummary: '',
    turnLog: [] // "Turn 1: [welcome] Asked about company. User said: correct"
  };
}

function buildContext(session) {
  const p = session.profile;
  const lines = [];
  
  lines.push('═══ COMPLETE BUSINESS PROFILE ═══');
  const fields = [
    ['Company', p.companyName], ['Website', p.website], ['Industry', p.industry],
    ['Business Model', p.businessModel], ['Stage', p.stage], ['Revenue', p.revenue],
    ['Growth', p.revenueGrowth], ['Team Size', p.teamSize], ['Team Roles', p.teamRoles],
    ['Funding', p.funding], ['Product', p.productDescription],
    ['Pricing', `${p.pricingModel} ${p.pricingRange}`.trim()],
    ['ICP Buyer', p.icpTitle], ['ICP Company', p.icpCompanySize], ['ICP Industry', p.icpIndustry],
    ['ICP Pain', p.icpPainPoints], ['Sales Motion', p.salesMotion], ['Channels', p.channels],
    ['Best Channel', p.bestChannel], ['Deal Size', p.avgDealSize], ['Sales Cycle', p.salesCycle],
    ['CAC', p.cac], ['LTV', p.ltv], ['Sales Process', p.salesProcess],
    ['Documented', p.processDocumented], ['Who Closes', p.whoCloses],
    ['Founder Role', p.founderInvolvement], ['Win Rate', p.winRate],
    ['Bottleneck', p.mainBottleneck], ['Lost Deals', p.lostDealReasons],
    ['Churn', p.churnRate], ['CRM/Tools', p.crm || p.tools],
    ['Diagnosed Problems', (p.diagnosedProblems||[]).join('; ')],
    ['Root Causes', (p.rootCauses||[]).join('; ')],
    ['User Priority', p.userPriority], ['Additional Context', p.additionalContext]
  ];
  for (const [k,v] of fields) lines.push(`  ${k}: ${v || '❓ UNKNOWN'}`);
  
  if (session.scrapedSummary) lines.push('\n═══ SCRAPED DATA ═══\n' + session.scrapedSummary);
  
  if (session.turnLog.length > 0) {
    lines.push('\n═══ FULL CONVERSATION LOG ═══');
    session.turnLog.forEach(e => lines.push('  ' + e));
  }
  
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: SCRAPING
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeWebsite(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const c = new AbortController(); setTimeout(() => c.abort(), 12000);
    const r = await fetch(u.href, { headers:{'User-Agent':'Mozilla/5.0'}, signal: c.signal });
    const html = await r.text();
    const ex = (re) => (html.match(re)||[null,''])[1]?.replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()||'';
    const exAll = (re,n=6) => [...html.matchAll(re)].map(m=>m[1].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim()).filter(t=>t.length>2&&t.length<200).slice(0,n);
    return {
      title: ex(/<title[^>]*>([^<]+)<\/title>/i),
      desc: ex(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i)||ex(/<meta[^>]*content="([^"]*)"[^>]*name="description"/i),
      h1s: exAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi),
      h2s: exAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi,8),
      paras: [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m=>m[1].replace(/<[^>]*>/g,'').trim()).filter(t=>t.length>40&&t.length<500).slice(0,4),
      prices: [...new Set(html.match(/(\$|€|£)\s*\d+[,.]?\d*/g)||[])].slice(0,5),
      proof: [...(html.match(/(\d+[,.]?\d*[kK]?\+?)\s*(customers?|users?|companies|clients)/gi)||[]),...(html.match(/trusted by[^<]{0,80}/gi)||[])].slice(0,4)
    };
  } catch(e) { return null; }
}

async function scrapeLinkedIn(url, key) {
  if (!url || !key) return null;
  try {
    const slug = url.match(/linkedin\.com\/company\/([^\/\?]+)/i)?.[1];
    if (!slug) return null;
    const r = await fetch("https://api.tavily.com/search", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({api_key:key,query:`"${slug}" site:linkedin.com company`,search_depth:"advanced",max_results:3,include_answer:true})
    });
    if (!r.ok) return null;
    const d = await r.json();
    return { name: slug.replace(/-/g,' ').replace(/\b\w/g,l=>l.toUpperCase()), employees: d.answer?.match(/(\d+[\-–]?\d*)\s*(employees?|people)/i)?.[0]||'', industry: d.answer?.match(/(?:industry|sector):\s*([^.]+)/i)?.[1]?.trim()||'', desc: d.answer?.slice(0,400)||'' };
  } catch(e) { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: LLM
// ═══════════════════════════════════════════════════════════════════════════════

async function callGemini(prompt, history, key) {
  const msgs = [
    {role:'user',parts:[{text:prompt}]},
    {role:'model',parts:[{text:'Understood. I output ONLY valid JSON with a "message" and "profile_updates" field.'}]}
  ];
  for (const m of history.slice(-12)) {
    let c = m.content;
    if (m.role==='assistant') try{c=JSON.parse(c).message||c}catch{}
    msgs.push({role:m.role==='assistant'?'model':'user',parts:[{text:c.slice(0,2000)}]});
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({contents:msgs,generationConfig:{temperature:0.7,responseMimeType:"application/json",maxOutputTokens:3000}})
  });
  if(!r.ok) throw new Error(`Gemini ${r.status}`);
  const d = await r.json();
  let t = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!t) throw new Error("Empty");
  t = t.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
  return JSON.parse(t);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  try {
    const {choice, history=[], contextData, sessionData:input} = req.body;
    const gKey = process.env.GEMINI_API_KEY;
    const tKey = process.env.TAVILY_API_KEY;
    if(!gKey) return res.status(200).json({message:'API key missing',options:[],session_data:null});

    let S = input || createSession();
    S.turnCount++;
    
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: DETERMINE WHICH STEP TO EXECUTE
    // ═══════════════════════════════════════════════════════════════════
    
    let stepToExecute = S.currentStep;
    let userInput = choice;
    
    // INIT: scrape and execute welcome
    if (choice === 'SNAPSHOT_INIT') {
      S.currentStep = 'welcome';
      stepToExecute = 'welcome';
      
      // Scrape
      if (contextData) {
        S.profile.website = contextData.website || '';
        if (contextData.description) S.profile.productDescription = contextData.description;
        
        const web = contextData.website ? await scrapeWebsite(contextData.website) : null;
        const li = contextData.linkedin ? await scrapeLinkedIn(contextData.linkedin, tKey) : null;
        
        let sc = '';
        if (contextData.description) sc += `USER DESCRIPTION: "${contextData.description}"\n`;
        if (web) {
          sc += `WEBSITE TITLE: ${web.title}\nDESCRIPTION: ${web.desc}\n`;
          sc += `HEADLINES: ${web.h1s?.join(' | ')}\nSECTIONS: ${web.h2s?.join(' | ')}\n`;
          sc += `CONTENT: ${web.paras?.join(' | ')}\nPRICING: ${web.prices?.join(', ')||'none'}\n`;
          sc += `SOCIAL PROOF: ${web.proof?.join(' | ')||'none'}\n`;
          if (web.prices?.length) S.profile.pricingRange = web.prices.join(', ');
        }
        if (li) {
          sc += `LINKEDIN: ${li.name}, ${li.employees||'?'} employees, ${li.industry||'?'}\n`;
          if (li.name) S.profile.companyName = li.name;
          if (li.industry) S.profile.industry = li.industry;
          if (li.employees) S.profile.teamSize = li.employees;
        }
        S.scrapedSummary = sc;
      }
    }
    // SPECIAL: add_context trigger
    else if (['add_context','adjust','correct_diagnosis'].includes(choice)) {
      stepToExecute = 'add_context_ask';
      S.currentStep = 'add_context_ask';
    }
    // SPECIAL: add_more loops back to ask
    else if (choice === 'add_more' || choice === 'more_to_add') {
      stepToExecute = 'add_context_ask';
      S.currentStep = 'add_context_ask';
    }
    // SPECIAL: done adding → show updated diagnosis
    else if (choice === 'done_adding') {
      stepToExecute = 'add_context_done';
      S.currentStep = 'add_context_done';
    }
    // SPECIAL: generate_report
    else if (choice === 'generate_report') {
      return res.status(200).json({
        step_id: 'GENERATE', message: 'Generating...', mode: 'buttons',
        options: [{key:'generating',label:'⏳ Generating...'}],
        allow_text:false, session_data:S, current_phase:'finish',
        turn_count:S.turnCount, confidence_state:calcConf(S)
      });
    }
    // NORMAL: advance from current step to next
    else {
      const currentDef = STEPS[S.currentStep];
      if (currentDef?.nextStep) {
        stepToExecute = currentDef.nextStep;
        S.currentStep = currentDef.nextStep;
      } else {
        // At pre_finish or end — stay
        stepToExecute = S.currentStep;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: LOG USER INPUT
    // ═══════════════════════════════════════════════════════════════════
    
    if (choice !== 'SNAPSHOT_INIT') {
      S.turnLog.push(`Turn ${S.turnCount}: [${S.currentStep}] User said: "${choice.slice(0,120)}"`);
      
      // Store add_context input
      if (S.currentStep.startsWith('add_context') && !['add_context','adjust','correct_diagnosis','more_to_add','add_more','done_adding'].includes(choice)) {
        S.profile.additionalContext = (S.profile.additionalContext||'') + ' | ' + choice;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 3: GET STEP DEFINITION
    // ═══════════════════════════════════════════════════════════════════
    
    const step = STEPS[stepToExecute];
    if (!step) {
      return res.status(200).json({
        step_id:'error', message:'Something went wrong.', mode:'buttons',
        options:[{key:'restart',label:'Start Over'}],
        allow_text:false, session_data:S, current_phase:'error'
      });
    }

    console.log(`[v8] Turn ${S.turnCount} | Execute: ${stepToExecute} | Phase: ${step.phase} | Input: "${choice.slice(0,50)}"`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 4: CALL LLM
    // ═══════════════════════════════════════════════════════════════════
    
    const ctx = buildContext(S);
    const prompt = `You are the Revenue Architect, a senior B2B revenue strategist.

LANGUAGE: Respond in the SAME language the user writes. Italian → Italian. English → English.

${ctx}

═══ CURRENT STEP: ${stepToExecute} ═══
═══ PHASE: ${step.phase} ═══

YOUR TASK FOR THIS TURN:
${step.instruction}

THE USER JUST SAID: "${userInput}"

RESPOND AS JSON:
{
  "message": "Your markdown response. FOLLOW THE INSTRUCTION ABOVE EXACTLY. MINIMUM 4-5 sentences.",
  "profile_updates": { "fieldName": "new value learned from user input" }
}

CRITICAL RULES:
1. Follow the instruction EXACTLY — do not skip ahead or add extra questions
2. ALWAYS acknowledge what the user just said before asking your question
3. In profile_updates, use ONLY these field names: ${Object.keys(S.profile).join(', ')}
4. Your message MUST end with a clear QUESTION (not a statement)
5. Be specific — use real numbers, names, benchmarks
6. NEVER say "interesting" or "great question"`;

    let llm;
    try {
      llm = await callGemini(prompt, history, gKey);
    } catch(e) {
      console.error(`[v8] LLM error: ${e.message}`);
      llm = { message: "Let me continue our analysis. " + step.instruction.split('\n')[0], profile_updates:{} };
    }

    // ═══════════════════════════════════════════════════════════════════
    // STEP 5: UPDATE PROFILE
    // ═══════════════════════════════════════════════════════════════════
    
    if (llm.profile_updates && typeof llm.profile_updates === 'object') {
      for (const [k,v] of Object.entries(llm.profile_updates)) {
        if (!v || !S.profile.hasOwnProperty(k)) continue;
        if (Array.isArray(S.profile[k])) {
          const items = Array.isArray(v) ? v : [v];
          S.profile[k] = [...new Set([...S.profile[k], ...items])];
        } else if (typeof v === 'string' && v.trim()) {
          S.profile[k] = v;
        }
      }
    }
    
    S.turnLog.push(`Turn ${S.turnCount}: [${stepToExecute}] AI asked about ${step.phase}`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 6: RESPOND — OPTIONS ARE FROM THE STEP, NOT THE LLM
    // ═══════════════════════════════════════════════════════════════════
    
    const conf = calcConf(S);
    
    return res.status(200).json({
      step_id: stepToExecute,
      message: llm.message || step.instruction.split('\n')[0],
      mode: step.mode || 'mixed',
      options: step.options,  // ← HARDCODED from step definition, not LLM
      allow_text: step.mode !== 'buttons',
      session_data: S,
      current_phase: step.phase,
      turn_count: S.turnCount,
      confidence_state: conf
    });

  } catch(e) {
    console.error('[v8 FATAL]', e);
    return res.status(200).json({
      step_id:'error', message:"Something went wrong. What's your biggest revenue challenge?",
      mode:'mixed', options:[
        {key:'leads',label:'Not enough leads'},{key:'conversion',label:'Leads don\'t convert'},
        {key:'scaling',label:'Can\'t scale sales'},{key:'churn',label:'Churn is too high'}
      ], allow_text:true, session_data:null
    });
  }
}

function calcConf(S) {
  const p = S.profile;
  const important = ['companyName','businessModel','stage','revenue','teamSize','icpTitle','salesMotion','channels','salesProcess','whoCloses','mainBottleneck'];
  let filled = important.filter(k => { const v=p[k]; return Array.isArray(v)?v.length>0:v&&v!==''; }).length;
  if (p.diagnosedProblems?.length>0) filled++;
  return { total: Math.round((filled/(important.length+1))*100) };
}
