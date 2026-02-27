// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE ARCHITECT v13 — HOLISTIC KYC + OPERATING MODEL DESIGN
//
// v13 additions over v12:
// 1. Rebalanced KYC: discovery now covers people, systems, culture,
//    roadmap & operating model alongside financial metrics.
// 2. Input-Extractor Persona: gentle, clever, concise questioning
//    that seeks situational clarity before diving into numbers.
// 3. Operating Model Design: new actionable output section that maps
//    org structure, decision flows, team roles & system architecture.
// 4. (Retained) Stage-Awareness, Benchmark injection, Anti-patterns,
//    Strategic Narrative, Golden Thread, Feasibility Guardrails.
//
// Architecture:
// - session.transcript[] = clean array of {role, text} pairs
// - Each LLM call gets the FULL transcript as readable text
// - Phase advancement: ALL checklist items + min turns + explicit gate
// - LLM generates buttons but system validates them
// - Profile updates extracted by LLM, validated by system
// - Benchmark data loaded from api/benchmarks/saas-stages.json
// ═══════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ═══════════════════════════════════════════════════════════════════════════════
// BENCHMARK DATA — loaded from local JSON snapshot library
// ═══════════════════════════════════════════════════════════════════════════════

let BENCHMARKS = null;
function loadBenchmarks() {
  if (BENCHMARKS) return BENCHMARKS;
  try {
    // Vercel: __dirname not available in ESM, use import.meta.url
    let base;
    try { base = dirname(fileURLToPath(import.meta.url)); } catch { base = process.cwd() + '/api'; }
    const raw = readFileSync(join(base, 'benchmarks', 'saas-stages.json'), 'utf-8');
    BENCHMARKS = JSON.parse(raw);
  } catch (e) {
    console.warn('[Benchmarks] Could not load saas-stages.json:', e.message);
    BENCHMARKS = { stages: {}, marketContext2026: {} };
  }
  return BENCHMARKS;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE RESOLUTION — maps free-text stage to canonical key
// ═══════════════════════════════════════════════════════════════════════════════

function resolveStage(rawStage) {
  if (!rawStage) return null;
  const s = rawStage.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const map = {
    'pre_seed_idea': ['pre-seed', 'pre seed', 'idea', 'concept', 'pre-revenue', 'prerevenue', 'pre revenue', 'just started', 'no revenue', 'prototype'],
    'seed_startup': ['seed', 'startup', 'early', 'pre-series-a', 'pre series a', 'angel', 'bootstrap', 'bootstrapped', 'friends and family', 'accelerator', 'incubator'],
    'early_scale': ['series a', 'series-a', 'growth', 'scaling', 'scale', 'early scale', 'growing', 'scaleup', 'scale-up', 'expansion stage'],
    'expansion_enterprise': ['series b', 'series-b', 'series c', 'series-c', 'enterprise', 'expansion', 'mature', 'ipo', 'late stage', 'public']
  };
  for (const [key, aliases] of Object.entries(map)) {
    if (aliases.some(a => s.includes(a))) return key;
  }
  // Fallback heuristics based on revenue keywords
  if (/\b(0|zero|nothing)\b/.test(s)) return 'pre_seed_idea';
  if (/\b(10k|20k|30k|50k)\b/.test(s) && !/100k|200k/.test(s)) return 'seed_startup';
  if (/\b(100k|200k|500k|1m)\b/.test(s)) return 'early_scale';
  if (/\b(5m|10m|50m|100m|ipo)\b/.test(s)) return 'expansion_enterprise';
  return 'seed_startup'; // safe default
}

// Get the full playbook + benchmarks for a stage
function getStagePlaybook(stageKey) {
  const bm = loadBenchmarks();
  return bm.stages?.[stageKey] || bm.stages?.seed_startup || null;
}

function getMarketContext() {
  const bm = loadBenchmarks();
  return bm.marketContext2026 || {};
}

// Format benchmarks into readable text for prompts
function formatBenchmarksForPrompt(stageKey) {
  const playbook = getStagePlaybook(stageKey);
  if (!playbook) return '(No benchmark data available)';

  const lines = [`STAGE: ${playbook.label}`, ''];

  // Benchmarks
  if (playbook.benchmarks) {
    lines.push('KEY BENCHMARKS (use these to evaluate the company):');
    for (const [metric, data] of Object.entries(playbook.benchmarks)) {
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
  }

  // Playbook guidance
  if (playbook.playbook) {
    const pb = playbook.playbook;
    lines.push('');
    lines.push(`FOCUS: ${pb.focus}`);
    lines.push(`SALES APPROACH: ${pb.salesApproach}`);
    lines.push(`RECOMMENDED TECH STACK: ${pb.techStack?.join(', ')}`);
    lines.push(`KEY METRICS TO TRACK: ${pb.keyMetrics?.join(', ')}`);
    if (pb.antiPatterns?.length) {
      lines.push('ANTI-PATTERNS (things to AVOID at this stage):');
      pb.antiPatterns.forEach(ap => lines.push(`  ⛔ ${ap}`));
    }
    if (pb.budgetGuidance) {
      const bg = pb.budgetGuidance;
      lines.push(`BUDGET GUIDANCE: Tools max ~€${bg.toolSpend?.max || '?'}/mo, Marketing max ~€${bg.marketingSpend?.max || '?'}/mo`);
    }
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASES — each has a checklist, minimum turns, and depth topics
// ═══════════════════════════════════════════════════════════════════════════════

const PHASES = {
  welcome: {
    display: 'welcome', next: 'company', minTurns: 1,
    checklist: [],
    description: 'Present findings from website scan, make assumptions, get confirmation/correction.'
  },
  company: {
    display: 'company', next: 'gtm', minTurns: 4,
    checklist: ['businessModel', 'stage', 'revenue', 'teamSize', 'funding'],
    depthTopics: [
      'Current company situation: what is working well today and what feels broken or stuck',
      'Organisational structure and decision-making dynamics — who owns what, where are the dependencies',
      'Team composition: not just numbers but roles, morale, capability gaps, founder dependency',
      'Revenue model, pricing structure and packaging strategy',
      'Revenue trajectory, seasonality, and burn-rate implications',
      'Competitive landscape, differentiation and market positioning',
      'Internal systems and tools: what they use today, what is manual, what is automated',
      'Roadmap and future plans: where the company wants to be in 6-12 months'
    ],
    description: 'Deep-dive into company DNA: situation, people, model, revenue, team, funding, systems, roadmap.'
  },
  gtm: {
    display: 'gtm', next: 'sales', minTurns: 4,
    checklist: ['icpTitle', 'salesMotion', 'channels', 'avgDealSize'],
    depthTopics: [
      'Current GTM reality: what the day-to-day looks like for the people running it',
      'ICP specificity: buyer persona, decision-making unit, budget authority',
      'Channel effectiveness: which channel has best ROI and why — and who actually runs each channel',
      'Content/marketing strategy and lead generation — resources, cadence, ownership',
      'Competitive positioning: why customers choose them and why they sometimes don\'t',
      'Marketing and sales tooling: what systems support GTM today, gaps and friction points',
      'Future GTM plans: new channels, new segments, new hires being considered'
    ],
    description: 'Map Go-to-Market: current reality, ICP depth, channels, people, systems, positioning, lead gen.'
  },
  sales: {
    display: 'sales', next: 'diagnosis', minTurns: 4,
    checklist: ['salesProcess', 'whoCloses', 'mainBottleneck'],
    depthTopics: [
      'Current sales reality: a typical week for the person/people who sell — what it actually looks like',
      'Full sales process walkthrough: each stage, exit criteria, where deals stall',
      'Founder dependency and delegation readiness — who could take over, what would need to change',
      'Win/loss analysis: why deals close or die — recent concrete examples',
      'Team enablement: training, playbooks, coaching — how new hires ramp',
      'Tech stack and CRM/automation maturity — what is truly used vs shelfware',
      'Post-sale: onboarding, retention, expansion — who owns the customer after signature',
      'Planned changes: hires, process improvements, tool migrations on the horizon'
    ],
    description: 'Analyze Sales Engine: current reality, process, people, enablement, tools, retention, plans.'
  },
  diagnosis: {
    display: 'diagnosis', next: 'pre_finish', minTurns: 2,
    checklist: ['diagnosedProblems', 'userPriority'],
    description: 'Present diagnosis, validate with user, get priority and context on past attempts.'
  },
  pre_finish: {
    display: 'pre_finish', next: null, minTurns: 1,
    checklist: [],
    description: 'Final summary, offer report generation.'
  }
};

const PHASE_ORDER = ['welcome', 'company', 'gtm', 'sales', 'diagnosis', 'pre_finish'];

// ═══════════════════════════════════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════════════════════════════════

function createSession() {
  return {
    currentPhase: 'welcome',
    phaseTurns: 0,        // turns spent IN current phase
    totalTurns: 0,
    welcomeDone: false,
    diagnosisPresented: false,
    diagnosisValidated: false,
    // Clean transcript — the SINGLE SOURCE OF TRUTH for conversation context
    transcript: [],
    // Resolved stage key — drives playbook selection (set after company phase)
    resolvedStage: null,
    // Structured profile — what we've confirmed
    profile: {
      companyName: '', website: '', industry: '', businessModel: '', stage: '',
      companyStage: '',    // Canonical: pre_seed_idea | seed_startup | early_scale | expansion_enterprise
      revenue: '', revenueGrowth: '', teamSize: '', teamRoles: '', funding: '',
      runway: '', productDescription: '', pricingModel: '', pricingRange: '',
      competitiveLandscape: '', differentiator: '',
      // Situational / People / Operating Model fields
      currentSituation: '',       // What is working, what is broken/stuck
      orgStructure: '',           // How the company is structured, reporting lines
      decisionMaking: '',         // How decisions get made, bottlenecks
      keyDependencies: '',        // Key-person risks, founder dependency depth
      teamMorale: '',             // Culture, energy, retention, hiring challenges
      systemsLandscape: '',       // Tools, integrations, manual vs automated
      roadmap: '',                // Where the company wants to be in 6-12 months
      plannedChanges: '',         // Hires, process or tool changes on the horizon
      icpTitle: '', icpCompanySize: '', icpIndustry: '', icpPainPoints: '',
      icpDecisionProcess: '', icpBudget: '',
      salesMotion: '', channels: '', bestChannel: '', channelROI: '',
      avgDealSize: '', salesCycle: '', cac: '', ltv: '',
      contentStrategy: '', leadGenMethod: '',
      salesProcess: '', processStages: '', processDocumented: '',
      whoCloses: '', founderInvolvement: '',
      winRate: '', lostDealReasons: '', mainObjections: '',
      mainBottleneck: '', secondaryBottleneck: '',
      churnRate: '', churnReasons: '', expansionRevenue: '',
      nrr: '',              // Net Revenue Retention (percentage, e.g. "110")
      crm: '', tools: '', automationLevel: '',
      onboardingProcess: '', customerSuccess: '',
      teamEnablement: '',         // Training, playbooks, coaching quality
      diagnosedProblems: [], rootCauses: [], validatedProblems: [],
      userPriority: '', pastAttempts: '', constraints: '', additionalContext: '',
      growthTarget: '', budgetLevel: '' // for feasibility checks
    },
    scrapedSummary: ''
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSCRIPT BUILDER — creates readable conversation for the LLM
// ═══════════════════════════════════════════════════════════════════════════════

function buildTranscript(session) {
  if (session.transcript.length === 0) return '(No conversation yet)';
  return session.transcript.map((t, i) => {
    const prefix = t.role === 'user' ? '👤 USER' : '🤖 REVENUE ARCHITECT';
    return `[Turn ${Math.floor(i / 2) + 1}] ${prefix}:\n${t.text}`;
  }).join('\n\n---\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE CONTEXT — what we know vs what we don't
// ═══════════════════════════════════════════════════════════════════════════════

function buildProfileContext(session) {
  const p = session.profile;
  const lines = [];

  const fields = [
    ['Company', p.companyName], ['Website', p.website], ['Industry', p.industry],
    ['Business Model', p.businessModel], ['Stage', p.stage], ['Company Stage', p.companyStage],
    ['Revenue', p.revenue],
    ['Revenue Growth', p.revenueGrowth], ['Team Size', p.teamSize], ['Team Roles', p.teamRoles],
    ['Funding', p.funding], ['Runway', p.runway],
    ['Product', p.productDescription], ['Pricing', `${p.pricingModel || ''} ${p.pricingRange || ''}`.trim()],
    ['Competitive Landscape', p.competitiveLandscape], ['Differentiator', p.differentiator],
    ['Current Situation', p.currentSituation], ['Org Structure', p.orgStructure],
    ['Decision Making', p.decisionMaking], ['Key Dependencies', p.keyDependencies],
    ['Team Morale/Culture', p.teamMorale], ['Systems Landscape', p.systemsLandscape],
    ['Roadmap', p.roadmap], ['Planned Changes', p.plannedChanges],
    ['ICP Buyer', p.icpTitle], ['ICP Company Size', p.icpCompanySize],
    ['ICP Industry', p.icpIndustry], ['ICP Pain Points', p.icpPainPoints],
    ['ICP Decision Process', p.icpDecisionProcess], ['ICP Budget', p.icpBudget],
    ['Sales Motion', p.salesMotion], ['Channels', p.channels],
    ['Best Channel', p.bestChannel], ['Channel ROI', p.channelROI],
    ['Deal Size', p.avgDealSize], ['Sales Cycle', p.salesCycle], ['CAC', p.cac], ['LTV', p.ltv],
    ['Content Strategy', p.contentStrategy], ['Lead Gen', p.leadGenMethod],
    ['Sales Process', p.salesProcess], ['Process Stages', p.processStages],
    ['Documented', p.processDocumented], ['Who Closes', p.whoCloses],
    ['Founder Role', p.founderInvolvement], ['Win Rate', p.winRate],
    ['Lost Deal Reasons', p.lostDealReasons], ['Objections', p.mainObjections],
    ['Main Bottleneck', p.mainBottleneck], ['Secondary Bottleneck', p.secondaryBottleneck],
    ['Churn Rate', p.churnRate], ['Churn Reasons', p.churnReasons],
    ['Expansion Revenue', p.expansionRevenue], ['NRR', p.nrr],
    ['CRM', p.crm], ['Tools', p.tools], ['Automation Level', p.automationLevel],
    ['Onboarding', p.onboardingProcess], ['Customer Success', p.customerSuccess],
    ['Team Enablement', p.teamEnablement],
    ['Diagnosed Problems', (p.diagnosedProblems || []).join('; ')],
    ['Root Causes', (p.rootCauses || []).join('; ')],
    ['User Priority', p.userPriority], ['Past Attempts', p.pastAttempts],
    ['Budget Level', p.budgetLevel], ['Growth Target', p.growthTarget],
    ['Constraints', p.constraints], ['Additional Context', p.additionalContext]
  ];

  const known = [];
  const missing = [];
  for (const [label, value] of fields) {
    const has = Array.isArray(value) ? value.length > 0 : (value && value.trim() !== '');
    if (has) known.push(`✅ ${label}: ${value}`);
  }

  // Missing for CURRENT phase
  const phase = PHASES[session.currentPhase];
  if (phase?.checklist) {
    for (const k of phase.checklist) {
      const v = p[k];
      const empty = Array.isArray(v) ? v.length === 0 : (!v || v.trim() === '');
      if (empty) missing.push(k);
    }
  }

  lines.push('CONFIRMED DATA:');
  if (known.length > 0) lines.push(known.join('\n'));
  else lines.push('(nothing yet)');

  if (missing.length > 0) {
    const labels = {
      businessModel: 'Business Model', stage: 'Stage', revenue: 'Revenue',
      teamSize: 'Team Size', funding: 'Funding', icpTitle: 'ICP/Buyer',
      salesMotion: 'Sales Motion', channels: 'Channels', avgDealSize: 'Deal Size',
      salesProcess: 'Sales Process', whoCloses: 'Who Closes',
      mainBottleneck: 'Bottleneck', diagnosedProblems: 'Diagnosis', userPriority: 'Priority'
    };
    lines.push('\nSTILL REQUIRED for ' + session.currentPhase.toUpperCase() + ':');
    missing.forEach(k => lines.push(`❓ ${labels[k] || k}`));
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE LOGIC
// ═══════════════════════════════════════════════════════════════════════════════

function canAdvancePhase(S) {
  const phase = PHASES[S.currentPhase];
  if (!phase) return false;

  // Minimum turns gate
  if (S.phaseTurns < phase.minTurns) return false;

  // Phase-specific gates
  if (S.currentPhase === 'welcome') return S.welcomeDone;
  if (S.currentPhase === 'pre_finish') return false;
  if (S.currentPhase === 'diagnosis') {
    return S.diagnosisPresented && S.diagnosisValidated && S.profile.userPriority !== '';
  }

  // Normal phases: ALL checklist items must be filled
  if (phase.checklist && phase.checklist.length > 0) {
    const p = S.profile;
    const allFilled = phase.checklist.every(k => {
      const v = p[k];
      return Array.isArray(v) ? v.length > 0 : (v && v.trim() !== '');
    });
    return allFilled;
  }

  return true;
}

function doAdvance(S) {
  const phase = PHASES[S.currentPhase];
  if (phase?.next) {
    S.currentPhase = phase.next;
    S.phaseTurns = 0;
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPING
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeWebsite(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const c = new AbortController(); setTimeout(() => c.abort(), 15000);
    const r = await fetch(u.href, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: c.signal, redirect: 'follow'
    });
    const html = await r.text();
    const ex = (re) => (html.match(re) || [null, ''])[1]?.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() || '';
    const exAll = (re, n = 8) => [...html.matchAll(re)].map(m => m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()).filter(t => t.length > 2 && t.length < 300).slice(0, n);
    return {
      url: u.href, title: ex(/<title[^>]*>([^<]+)<\/title>/i),
      desc: ex(/<meta[^>]*name="description"[^>]*content="([^"]*)"/i) || ex(/<meta[^>]*content="([^"]*)"[^>]*name="description"/i),
      h1s: exAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi),
      h2s: exAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, 12),
      paras: [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(t => t.length > 30 && t.length < 600).slice(0, 6),
      prices: [...new Set(html.match(/(\$|€|£)\s*\d+[,.]?\d*/g) || [])].slice(0, 8),
      proof: [...(html.match(/(\d+[,.]?\d*[kK]?\+?)\s*(customers?|users?|companies|clients|teams?)/gi) || [])].slice(0, 4),
      ctas: [...html.matchAll(/<(?:a|button)[^>]*>([\s\S]*?)<\/(?:a|button)>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(t => t.length > 3 && t.length < 50 && /(?:start|try|get|sign|book|demo|free|contact|buy|subscribe)/i.test(t)).slice(0, 5),
      navLinks: [...html.matchAll(/<nav[\s\S]*?<\/nav>/gi)].flatMap(m => [...m[0].matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]).map(m => m[1].replace(/<[^>]*>/g, '').trim()).filter(t => t.length > 1 && t.length < 40).slice(0, 10)
    };
  } catch (e) { console.error('[Scrape]', e.message); return null; }
}

async function scrapeLinkedIn(url, key) {
  if (!url || !key) return null;
  try {
    const slug = url.match(/linkedin\.com\/company\/([^\/\?]+)/i)?.[1];
    if (!slug) return null;
    const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: key, query: `"${slug}" site:linkedin.com company`, search_depth: "advanced", max_results: 3, include_answer: true }) });
    if (!r.ok) return null;
    const d = await r.json();
    return { name: slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), employees: d.answer?.match(/(\d+[\-–]?\d*)\s*(employees?|people)/i)?.[0] || '', industry: d.answer?.match(/(?:industry|sector):\s*([^.]+)/i)?.[1]?.trim() || '', desc: d.answer?.slice(0, 500) || '' };
  } catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LLM CALL — sends transcript as readable text, NOT JSON history
// ═══════════════════════════════════════════════════════════════════════════════

async function callGemini(prompt, key) {
  // Single-turn call with full context in the prompt itself
  // This avoids the multi-turn confusion where Gemini loses track
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`,
    {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.75,
          responseMimeType: "application/json",
          maxOutputTokens: 4000
        }
      })
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text().catch(() => '?')}`);
  const d = await r.json();
  let t = d.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!t) throw new Error("Empty response from Gemini");
  t = t.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(t);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE-SPECIFIC INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE-SPECIFIC QUESTION SETS — tailored discovery per company maturity
// ═══════════════════════════════════════════════════════════════════════════════

const QUESTION_SETS = {
  pre_seed_idea: [
    'What problem are you solving, and who has this problem most acutely?',
    'Have you spoken to potential customers? What did you learn?',
    'What makes your approach different from existing solutions?',
    'What would it take to get your first 10 paying customers?',
  ],
  seed_startup: [
    'Who are your first customers and how did you find them?',
    'What\'s your current conversion rate from interest to paid?',
    'What\'s the #1 reason deals don\'t close?',
  ],
  early_scale: [
    'Walk me through your current sales process — from first touch to close.',
    'Which channel drives the most revenue today, and who owns it?',
    'What breaks down first when volume increases?',
  ],
  expansion_enterprise: [
    'What\'s your Net Revenue Retention? Where is expansion revenue coming from?',
    'How does your RevOps function operate — who owns data, tools, and process?',
    'Which enterprise segments are you winning in, and which are you losing?',
  ],
};

export function getQuestionSet(stageKey) {
  return QUESTION_SETS[stageKey] || QUESTION_SETS.seed_startup;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT-AWARE QUESTION SEQUENCING
// Ensures the agent follows a logical progression: identity → GTM → metrics.
// The returned instruction is injected into the system prompt each turn.
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// ASSUMPTION SUMMARY — builds a plain-language list of what we believe so far
// ═══════════════════════════════════════════════════════════════════════════════

function buildAssumptionSummary(profile) {
  const a = [];
  if (profile.companyName && profile.industry)
    a.push(`${profile.companyName} is a ${profile.stage || 'early-stage'} ${profile.industry} company`);
  if (profile.revenue)
    a.push(`Current revenue: ${profile.revenue}`);
  if (profile.teamSize)
    a.push(`Team size: ${profile.teamSize}`);
  if (profile.businessModel)
    a.push(`Business model: ${profile.businessModel}`);
  if (profile.salesMotion)
    a.push(`Sales motion: ${profile.salesMotion}`);
  if (profile.channels)
    a.push(`Primary channels: ${profile.channels}`);
  if (profile.icpTitle)
    a.push(`ICP / buyer: ${profile.icpTitle}`);
  if (profile.avgDealSize)
    a.push(`Avg deal size: ${profile.avgDealSize}`);
  if (profile.mainBottleneck)
    a.push(`Primary challenge: ${profile.mainBottleneck}`);
  if (profile.whoCloses)
    a.push(`Sales currently closed by: ${profile.whoCloses}`);
  if (profile.churnRate)
    a.push(`Churn rate: ${profile.churnRate}`);
  if (profile.funding)
    a.push(`Funding: ${profile.funding}`);
  return a;
}

function getNextQuestionContext(profile, conversationLength) {
  // Don't ask about metrics until we know basic identity
  const hasIdentity = profile.companyName && profile.industry && profile.stage;
  const hasGTM = profile.salesMotion || profile.channels;

  if (!hasIdentity && conversationLength > 0) {
    return {
      phase: 'identity',
      maxQuestions: 2,
      instruction: 'Focus ONLY on company identity (company name, industry, stage). Do not ask about metrics or GTM yet.'
    };
  }
  if (hasIdentity && !hasGTM) {
    return {
      phase: 'gtm',
      maxQuestions: 2,
      instruction: 'Identity is confirmed. Focus on sales motion and channels. Do not jump to detailed metrics yet.'
    };
  }
  if (hasGTM) {
    return {
      phase: 'metrics',
      maxQuestions: 2,
      instruction: 'Identity and GTM are confirmed. You may now collect specific metrics (churn, CAC, deal size, win rate, etc.).'
    };
  }
  return null;
}

function getPhasePrompt(S) {
  const p = S.profile;
  const phase = PHASES[S.currentPhase];
  const turnsLeft = (phase.minTurns || 1) - S.phaseTurns;

  // Stage-aware benchmark injection
  const stageKey = S.resolvedStage || resolveStage(p.stage || p.companyStage) || 'seed_startup';
  const stageBenchmarks = formatBenchmarksForPrompt(stageKey);
  const stagePlaybook = getStagePlaybook(stageKey);
  const antiPatterns = stagePlaybook?.playbook?.antiPatterns || [];
  const marketCtx = getMarketContext();
  const stageQuestions = getQuestionSet(stageKey);

  switch (S.currentPhase) {
    case 'welcome': {
      const hasWebsite = !!(S.scrapedSummary && S.scrapedSummary.trim() && !S.scrapedSummary.startsWith('USER DESCRIPTION:'));
      const hasWebsiteOrDesc = !!(S.scrapedSummary && S.scrapedSummary.trim());

      if (hasWebsite) {
        return `PHASE: WELCOME (Turn ${S.phaseTurns + 1})

YOUR TASK:
- Reference 3-4 SPECIFIC things from their website data (headlines, pricing, features, CTAs — quote them)
- Make 3 bold assumptions about: (a) their revenue model, (b) their target customer, (c) their growth stage
- Ask them to validate: "Ho capito bene? Cosa devo correggere?" / "Did I get this right?"
- Generate confirmation buttons

AFTER this turn, set phase_signals.welcome_done=true in your next response (when the user replies).
This is your first impression — make it count. Show you did your homework.`;
      }

      // No website — stage-aware welcome
      return `PHASE: WELCOME (Turn ${S.phaseTurns + 1})
COMPANY STAGE: ${stagePlaybook?.label || stageKey}

${hasWebsiteOrDesc ? 'The user provided a business description but no website.' : 'No website or description provided.'}

YOUR TASK:
${hasWebsiteOrDesc ? '- Reference what they described about their business' : '- Introduce yourself warmly and explain the diagnostic process'}
- Acknowledge their stage: "${stagePlaybook?.label || 'Your stage'}" — and what that means for the diagnostic
- Ask the FIRST stage-appropriate question to kick off discovery:
  ${stageQuestions.map((q, i) => `${i + 1}. "${q}"`).join('\n  ')}
- Pick the most natural opening question from the list above
- Generate relevant buttons

AFTER this turn, set phase_signals.welcome_done=true in your next response (when the user replies).
Make this warm and stage-appropriate. Pre-seed founders need encouragement, not interrogation.`;
    }

    case 'company':
      return `PHASE: COMPANY DNA (Turn ${S.phaseTurns + 1} of minimum ${phase.minTurns})
${turnsLeft > 0 ? `You need at least ${turnsLeft} more turn(s) in this phase. Take your time.` : 'You can transition soon if all checklist items are filled.'}

═══ STAGE-AWARE BENCHMARKS FOR THIS COMPANY ═══
${stageBenchmarks}

═══ STAGE-APPROPRIATE DISCOVERY QUESTIONS ═══
Use these as inspiration for the questions you ask at this stage:
${stageQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}

TOPICS TO EXPLORE (one or two per turn, go deep — LEAD WITH SITUATION before numbers):
${phase.depthTopics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

CHECKLIST STATUS:
${phase.checklist.map(k => {
  const v = p[k]; const has = v && v.trim();
  return has ? `  ✅ ${k}: ${v} (DONE — don't re-ask)` : `  ❓ ${k}: NOT YET COLLECTED`;
}).join('\n')}

STRATEGY — SITUATION-FIRST DISCOVERY:
- OPEN WITH THE CURRENT SITUATION: before you ask for numbers, ask what their world looks like right now. "Paint me a picture of a typical week — what's working, what feels stuck?" This naturally surfaces the numbers AND the context around them.
- When you DO ask for a number, always ask for the STORY behind it. Don't just collect "€20K MRR" — ask how it got there, who drives it, what would break if that person left.
- Explore PEOPLE dynamics: org structure, who owns what, where decisions get bottlenecked, key-person dependencies. These shape the operating model.
- Explore SYSTEMS: what tools do they use, what is manual, what is automated, where do things fall through the cracks.
- Explore ROADMAP: where do they want to be in 6-12 months? What changes are they planning? This reveals ambition vs. capacity gaps.
- Ask about ONE missing checklist item per turn — but frame it through the lens of their current situation, not as a data-collection exercise.
- When the user shares their stage, SET profile_updates.companyStage to one of: "pre_seed_idea", "seed_startup", "early_scale", "expansion_enterprise"
- COMPARE their answers to the BENCHMARKS above. E.g., "Your €15K MRR puts you in the Seed bracket where median churn is 5% — how does yours compare?"
- If they mention tools/spending that conflicts with their stage, flag it diplomatically.
- Always connect your question to WHY it matters for their operating model and revenue strategy.
- Extract situational data into: currentSituation, orgStructure, decisionMaking, keyDependencies, teamMorale, systemsLandscape, roadmap, plannedChanges

DO NOT rush. This phase should feel like a thoughtful conversation, not an interrogation.`;

    case 'gtm':
      return `PHASE: GO-TO-MARKET (Turn ${S.phaseTurns + 1} of minimum ${phase.minTurns})
${turnsLeft > 0 ? `At least ${turnsLeft} more turn(s) needed.` : 'Can transition if checklist complete.'}

COMPANY CONTEXT FOR YOUR REFERENCE:
Model: ${p.businessModel || '?'} | Stage: ${p.stage || '?'} (${stagePlaybook?.label || '?'}) | Revenue: ${p.revenue || '?'} | Team: ${p.teamSize || '?'}

═══ STAGE-AWARE BENCHMARKS ═══
${stageBenchmarks}

═══ MARKET CONTEXT 2026 ═══
- B2B SaaS Market: ${marketCtx.globalSaaSMarket?.size || 'N/A'} at ${marketCtx.globalSaaSMarket?.growthRate || 'N/A'} CAGR
- Avg B2B stakeholders in purchase: ${marketCtx.b2bBuyingBehavior?.avgStakeholders || 'N/A'}
- Self-serve research preference: ${marketCtx.b2bBuyingBehavior?.selfServePreference || 'N/A'}
- Companies using AI in sales: ${marketCtx.aiImpact?.companiesUsingAIinSales || 'N/A'}

TOPICS TO EXPLORE:
${phase.depthTopics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

CHECKLIST:
${phase.checklist.map(k => {
  const v = p[k]; const has = v && v.trim();
  return has ? `  ✅ ${k}: ${v} (DONE)` : `  ❓ ${k}: NEEDED`;
}).join('\n')}

STRATEGY — PEOPLE & SYSTEMS LENS ON GTM:
- Start this phase with a brief transition: summarize company DNA, then pivot to GTM
- LEAD WITH REALITY: "Walk me through what a lead's journey actually looks like today — from the moment they hear about you to first conversation." This surfaces process AND people AND systems.
- For ICP: push for specificity. Not "marketing people" but "Head of Demand Gen at B2B SaaS, 50-200 employees, Series A funded." Ask WHO in their team knows the ICP best and why.
- For channels: don't just ask WHICH channels — ask WHO runs each channel, what SYSTEMS support it, and where things break down.
- COMPARE to stage benchmarks: e.g., "At ${stagePlaybook?.label || 'your stage'}, median deal size is €${stagePlaybook?.benchmarks?.avgDealSize?.median || '?'} — yours is ${p.avgDealSize || 'unknown'}"
- Probe GTM SYSTEMS: What tools support marketing and sales handoff? Is there a CRM? How are leads tracked? What's manual vs. automated?
- Ask about PLANNED GTM CHANGES: new channels, new hires, new tools being evaluated.
- Reference April Dunford positioning framework, Jobs-to-be-Done
- Ask about competitive wins/losses: "When you lose a deal, who do you lose to and why?"
- FLAG ANTI-PATTERNS if detected: ${antiPatterns.slice(0, 3).join('; ')}
- Extract into: systemsLandscape, plannedChanges, teamMorale where relevant`;

    case 'sales':
      return `PHASE: SALES ENGINE (Turn ${S.phaseTurns + 1} of minimum ${phase.minTurns})
${turnsLeft > 0 ? `At least ${turnsLeft} more turn(s) needed.` : 'Can transition if checklist complete.'}

CONTEXT:
Model: ${p.businessModel || '?'} | ICP: ${p.icpTitle || '?'} | Motion: ${p.salesMotion || '?'} | Deal: ${p.avgDealSize || '?'}

═══ STAGE-AWARE BENCHMARKS ═══
${stageBenchmarks}

RECOMMENDED TECH STACK FOR THEIR STAGE: ${stagePlaybook?.playbook?.techStack?.join(', ') || 'N/A'}

TOPICS TO EXPLORE:
${phase.depthTopics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

CHECKLIST:
${phase.checklist.map(k => {
  const v = p[k]; const has = v && v.trim();
  return has ? `  ✅ ${k}: ${v} (DONE)` : `  ❓ ${k}: NEEDED`;
}).join('\n')}

STRATEGY — ENABLEMENT, REALITY & OPERATING MODEL:
- Ask for a WALKTHROUGH: "Take me through a recent deal from first touch to signature — who was involved at each step?"
- Focus on PEOPLE: Who actually does the selling? How enabled are they — do they have playbooks, training, coaching? What happens when the founder steps away?
- Focus on SYSTEMS: What\'s in the CRM vs. what\'s in someone\'s head? What is truly used vs. shelfware? Where does data fall through?
- COMPARE their sales metrics to benchmarks: win rate (median ${stagePlaybook?.benchmarks?.winRate?.median || '?'}%), sales cycle (median ${stagePlaybook?.benchmarks?.salesCycleDays?.median || '?'} days), CAC (median €${stagePlaybook?.benchmarks?.cac?.median || '?'})
- For bottleneck: make a HYPOTHESIS first, then ask: "Based on everything, I suspect [X] because [Y]. Am I right?"
- Ask about post-sale: onboarding, churn, expansion — WHO owns the customer after signature?
- EXTRACT NRR: when the user mentions Net Revenue Retention (NRR), dollar retention, or expansion rate as a PERCENTAGE (e.g. "110%", "95%"), set profile_updates.nrr to that number as a string (e.g. "110"). NRR is NOT the same as expansion revenue in absolute terms — it is the percentage of recurring revenue retained + expanded after 12 months. If the user only mentions expansion in currency (e.g. "€5K/month expansion"), store that in expansionRevenue but do NOT put it in nrr.
- Probe PLANNED CHANGES: new hires, process overhauls, tool migrations they are considering.
- Reference MEDDPICC for process evaluation
- FLAG ANTI-PATTERNS: ${antiPatterns.slice(0, 3).join('; ')}
- Extract into: teamEnablement, keyDependencies, systemsLandscape, plannedChanges, nrr where relevant
- This is the last discovery phase before diagnosis — make it count`;

    case 'diagnosis':
      if (!S.diagnosisPresented) {
        return `PHASE: DIAGNOSIS — PRESENT YOUR FINDINGS

You have gathered enough data. NOW present your diagnostic.

═══ STAGE-AWARE BENCHMARKS ═══
${stageBenchmarks}

═══ ANTI-PATTERNS FOR ${stagePlaybook?.label || 'THEIR STAGE'} ═══
${antiPatterns.map(ap => `  ⛔ ${ap}`).join('\n')}

STRUCTURE (follow exactly):
1. Opening: "Ecco la mia diagnosi" / "Here is my diagnostic assessment"
2. COMPANY SNAPSHOT: 4-5 sentences summarizing everything using ONLY ✅ confirmed data — include the human and operational reality, not just the numbers.
3. THREE REVENUE PROBLEMS — for each:
   - **Bold problem name** with a finding_id (F1, F2, F3)
   - Why it exists (root cause — reference what USER told you specifically, including people/systems/process factors)
   - Revenue impact (estimate with reasoning, or qualitative if no data)
   - **Benchmark comparison**: compare their reality to stage benchmarks above
   - Severity: 🔴 Critical / 🟡 High / 🟢 Medium
   - **Anti-pattern check**: flag if this problem maps to a known anti-pattern for their stage
   - **Operating model implication**: briefly note how this problem relates to their org structure, people, or systems
4. OPERATING MODEL OBSERVATION: 2-3 sentences on how their current org structure, decision-making, and systems landscape either enable or constrain their revenue engine. Reference confirmed data about people, key dependencies, and tools.
5. CORE HYPOTHESIS: one bold sentence connecting all three problems AND the operating model observation.
6. Ask: "Does this resonate? What did I get right, and what did I miss?"

Set phase_signals.diagnosis_presented = true
Set profile_updates.diagnosedProblems = ["F1: Problem 1 name", "F2: Problem 2 name", "F3: Problem 3 name"]
Set profile_updates.rootCauses = ["Cause 1", "Cause 2", "Cause 3"]

THIS MUST BE YOUR LONGEST MESSAGE. At least 15 sentences.
ONLY reference confirmed data. DO NOT invent metrics.`;
      }
      if (!S.diagnosisValidated) {
        return `PHASE: DIAGNOSIS — VALIDATION

User responded to your diagnosis. React to their feedback:
- If they agreed: validate, suggest priority order, ask which is #1
- If they disagreed: ask what's wrong, adjust, show flexibility
- Ask: "Which problem is your #1 priority? And what have you already tried to fix it?"
- Also ask about constraints: "Any budget or resource constraints I should factor in?"

Set phase_signals.diagnosis_validated = true when they confirm
Extract userPriority, constraints, and budgetLevel from their response
For budgetLevel use: "limited", "moderate", "flexible"`;
      }
      return `Diagnosis complete. Transition to final summary.`;

    case 'pre_finish':
      return `PHASE: FINAL SUMMARY

═══ STAGE-AWARE CONTEXT ═══
Company Stage: ${stagePlaybook?.label || '?'}
Focus for this stage: ${stagePlaybook?.playbook?.focus || '?'}

Present complete picture using ONLY confirmed data:
1. Company snapshot — include both the numbers AND the human/operational reality
2. Three diagnosed problems in priority order (reference finding IDs: F1, F2, F3)
3. For each problem, tease ONE actionable recommendation appropriate to their stage — connect it to people, process, or systems where relevant
4. Operating Model snapshot: 2-3 sentences on how their current org design, decision flows, and systems either support or hinder growth
5. Preview: "Your Strategic Growth Plan will include: strategic narrative, diagnostic findings with benchmark comparison, **Operating Model Design** (org structure recommendations, role clarity, decision-flow optimisation, systems architecture), 90-day roadmap with second-order effects, metrics dashboard, tool recommendations calibrated to your ${stagePlaybook?.label || ''} stage"
6. Ask: "Ready to generate?"

MUST include button: {"key":"generate_report","label":"📥 Generate Strategic Growth Plan"}
Also: {"key":"add_context","label":"I want to add more context first"}`;

    default:
      return 'Continue the conversation naturally.';
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { choice, history = [], contextData, sessionData: input, attachments = [] } = req.body;
    const gKey = process.env.GEMINI_API_KEY;
    const tKey = process.env.TAVILY_API_KEY;
    if (!gKey) return res.status(200).json({ message: '⚠️ GEMINI_API_KEY missing.', options: [{ key: 'restart', label: 'Retry' }], session_data: null, current_phase: 'error' });

    let S = input || createSession();
    // Ensure asked_fields tracking array exists
    if (!S.askedFields) S.askedFields = [];
    S.totalTurns++;
    S.phaseTurns++;

    // Process attachments if present
    let attachmentContext = '';
    if (attachments && attachments.length > 0) {
      attachmentContext = '\n\n═══ USER ATTACHED FILES ═══\n';
      attachments.forEach((file, idx) => {
        attachmentContext += `File ${idx + 1}: "${file.name}" (${file.type}, ${Math.round(file.size / 1024)} KB)\n`;
        // For images, note that they can be analyzed; for documents, note content may need extraction
        if (file.type.startsWith('image/')) {
          attachmentContext += '  → Image file: User may be sharing visual context (screenshots, diagrams, analytics, etc.)\n';
        } else if (file.type.includes('pdf')) {
          attachmentContext += '  → PDF document: May contain reports, slides, documentation\n';
        } else {
          attachmentContext += '  → Document file: May contain business data, reports, or context\n';
        }
      });
      attachmentContext += 'NOTE: Acknowledge the files and ask the user to briefly explain what they contain and why they shared them.\n';
      
      // Store attachment metadata in session for reference
      if (!S.profile.additionalContext) S.profile.additionalContext = '';
      const fileList = attachments.map(f => f.name).join(', ');
      S.profile.additionalContext += `\n[Files attached: ${fileList}]`;
    }

    // ══════════════════════════════════════════════════
    // SPECIAL ACTIONS
    // ══════════════════════════════════════════════════

    if (choice === 'generate_report' || choice === 'update_and_generate') {
      const depth = calculateDiagnosticDepth(S.profile);
      return res.status(200).json({
        step_id: 'GENERATE', message: 'Generating...', mode: 'buttons', options: [],
        allow_text: false, session_data: S, current_phase: 'finish',
        turn_count: S.totalTurns, confidence_state: calcConf(S),
        diagnostic_depth: depth
      });
    }

    // ══════════════════════════════════════════════════
    // INIT: SCRAPE + WELCOME
    // ══════════════════════════════════════════════════

    if (choice === 'SNAPSHOT_INIT') {
      S.currentPhase = 'welcome';
      S.phaseTurns = 0;

      // Resolve stage from intake form
      if (contextData?.stage) {
        const intakeStageMap = {
          'pre_seed': 'pre_seed_idea', 'seed': 'seed_startup',
          'early_scale': 'early_scale', 'expansion': 'expansion_enterprise'
        };
        const mapped = intakeStageMap[contextData.stage] || resolveStage(contextData.stage);
        S.resolvedStage = mapped;
        S.profile.companyStage = mapped;
        S.profile.stage = contextData.stage;
      }

      if (contextData) {
        S.profile.website = contextData.website || '';
        if (contextData.description) S.profile.productDescription = contextData.description;

        const [web, li] = await Promise.all([
          contextData.website ? scrapeWebsite(contextData.website) : null,
          contextData.linkedin ? scrapeLinkedIn(contextData.linkedin, tKey) : null
        ]);

        let sc = '';
        if (contextData.description) sc += `USER DESCRIPTION: "${contextData.description}"\n`;
        if (web) {
          sc += `WEBSITE: ${web.url}\nTITLE: ${web.title}\nDESCRIPTION: ${web.desc}\n`;
          sc += `NAV: ${web.navLinks?.join(' | ') || '-'}\nH1: ${web.h1s?.join(' | ') || '-'}\nH2: ${web.h2s?.join(' | ') || '-'}\n`;
          sc += `CONTENT:\n${web.paras?.map((p, i) => `  ${i + 1}. ${p}`).join('\n') || '-'}\n`;
          sc += `PRICING: ${web.prices?.join(', ') || 'none'}\nPROOF: ${web.proof?.join(' | ') || 'none'}\nCTAs: ${web.ctas?.join(' | ') || '-'}\n`;
          if (web.title) { const n = web.title.split(/[|\-–—:]/)[0].trim(); if (n.length > 1 && n.length < 50) S.profile.companyName = n; }
          if (web.prices?.length) S.profile.pricingRange = web.prices.join(', ');
        }
        if (li) {
          sc += `LINKEDIN: ${li.name}, ${li.employees || '?'} empl, ${li.industry || '?'}\nLI DESC: ${li.desc}\n`;
          if (li.name) S.profile.companyName = li.name;
          if (li.industry) S.profile.industry = li.industry;
          if (li.employees) S.profile.teamSize = li.employees;
        }
        S.scrapedSummary = sc;
      }
    } else {
      // Record user message in transcript
      S.transcript.push({ role: 'user', text: choice });

      // Handle welcome_done on user's REPLY to welcome
      if (S.currentPhase === 'welcome' && S.phaseTurns >= 1) {
        S.welcomeDone = true;
      }

      // Handle add_context — just let them keep talking, don't change phase
      if (choice === 'add_context' || choice === 'adjust') {
        // Stay in current phase, AI will respond naturally
      }
    }

    // ══════════════════════════════════════════════════
    // CHECK PHASE ADVANCEMENT
    // ══════════════════════════════════════════════════

    if (choice !== 'SNAPSHOT_INIT') {
      if (canAdvancePhase(S)) {
        doAdvance(S);
        console.log(`[v12] Phase → ${S.currentPhase}`);
      }
    }

    // ══════════════════════════════════════════════════
    // BUILD THE FULL PROMPT
    // ══════════════════════════════════════════════════

    // ══════════════════════════════════════════════════
    // DEDUPLICATION — build list of already-collected fields
    // ══════════════════════════════════════════════════
    const alreadyCollected = Object.entries(S.profile)
      .filter(([k, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v && typeof v === 'string' && v.trim() !== '';
      })
      .map(([k]) => k);
    // Merge into askedFields (dedup)
    S.askedFields = [...new Set([...S.askedFields, ...alreadyCollected])];

    const transcript = buildTranscript(S);
    const profileCtx = buildProfileContext(S);
    const phasePrompt = getPhasePrompt(S);

    // ══════════════════════════════════════════════════════════════════════════
    // CONTEXT-AWARE SEQUENCING — gate what the agent may ask about this turn
    // ══════════════════════════════════════════════════════════════════════════
    const questionContext = getNextQuestionContext(S.profile, S.transcript.length);
    const sequencingDirective = questionContext
      ? `\n═══ QUESTION SEQUENCING DIRECTIVE (phase: ${questionContext.phase}, max ${questionContext.maxQuestions} questions) ═══\n${questionContext.instruction}\n`
      : '';

    const fullPrompt = `You are the REVENUE ARCHITECT, a senior B2B revenue strategist and operating-model advisor (20+ years). You conduct deep discovery calls with founders and revenue leaders. Your style blends the rigour of a top-tier consultant with the warmth of a trusted advisor: **gentle** in tone, **clever** in the connections you draw, and **concise** in your questions — one sharp question is worth five generic ones.

You are not just a data collector. You are an INPUT EXTRACTOR: you help founders articulate what they often struggle to put into words — the real situation behind the numbers. You listen for what is said AND what is left unsaid. When something feels incomplete, you probe with curiosity, not pressure.

Your discovery philosophy: SITUATION FIRST, NUMBERS SECOND. Understand the current reality — people, systems, decision-making, culture, roadmap — and the metrics will land with meaning. A number without context is just noise.

You know: MEDDPICC, Bow-Tie funnel, T2D3, SaaStr benchmarks, April Dunford positioning, Pirate Metrics (AARRR), David Sacks metrics (Burn Multiple, Magic Number, Rule of 40), Operating Model Canvas. You reference these naturally.

You have access to NARROW BENCHMARK DATA from KBCM SaaS Survey, Statista, Pavilion/BenchSights, OpenView, and Bessemer Cloud Index. USE THESE to validate or challenge the user's claims. Compare their numbers to stage-appropriate medians.

═══ LANGUAGE ═══
Match the user's language exactly. If they write Italian, respond 100% in Italian. English → English.

═══ CONVERSATION TRANSCRIPT (read this carefully — your FULL conversation so far) ═══
${transcript}

═══ CONFIRMED PROFILE DATA ═══
${profileCtx}

═══ COMPANY STAGE ═══
Resolved: ${S.resolvedStage || 'not yet determined'}
${S.resolvedStage ? formatBenchmarksForPrompt(S.resolvedStage) : '(Stage not yet identified — ask about it)'}

═══ WEBSITE SCAN DATA ═══
${S.scrapedSummary
  ? S.scrapedSummary
  : (S.resolvedStage === 'pre_seed_idea'
    ? '(Pre-seed stage — no website available. Focus on idea validation and customer discovery.)'
    : '(No website data — base discovery on conversation only)')}
${attachmentContext}

═══ CURRENT STATE ═══
Phase: ${S.currentPhase} | Phase turn: ${S.phaseTurns} | Total turns: ${S.totalTurns}

═══ YOUR INSTRUCTIONS ═══
${phasePrompt}

═══ ALREADY COLLECTED FIELDS (DO NOT re-ask these) ═══
${S.askedFields.length > 0 ? S.askedFields.join(', ') : '(none yet)'}
Before asking a question, check this list. If the data point is here, SKIP it entirely.
${sequencingDirective}
${(S.totalTurns > 0 && S.totalTurns % 4 === 0 && S.currentPhase !== 'welcome' && S.currentPhase !== 'pre_finish') ? `
═══ ASSUMPTION VERIFICATION CHECK (every ~4 turns) ═══
Before your main question this turn, prepend a brief assumption check.
Use this format: "Quick check — here's my current understanding:\n${buildAssumptionSummary(S.profile).map(a => '• ' + a).join('\n')}\nIs anything off?"
Then continue with your normal phase question. Keep the check compact (2-3 lines max).
` : ''}

${choice !== 'SNAPSHOT_INIT' ? `═══ USER'S LATEST MESSAGE ═══\n"${choice}"` : '═══ This is the FIRST message — welcome them ═══'}

═══ RESPONSE FORMAT (valid JSON) ═══
{
  "message": "Your markdown response. Thorough and specific.",
  "options": [
    {"key": "short_key", "label": "Button text (max 60 chars)"}
  ],
  "profile_updates": {
    "fieldName": "value you extracted from the user's latest message"
  },
  "phase_signals": {
    "welcome_done": false,
    "diagnosis_presented": false,
    "diagnosis_validated": false
  }
}

═══ RESPONSE RULES ═══
- Maximum 2 questions per turn. Never ask 3+.
- Maximum 160 words per response.
- Never repeat information the user has already provided.
- Do not ask for clarification if you have sufficient context to proceed.
- If user gives a vague answer, make a reasonable assumption, STATE it explicitly, and move on.

═══ RULES ═══
1. READ THE TRANSCRIPT. Never ask something that was already discussed. If the transcript shows you already asked about revenue and the user answered, DO NOT ask about revenue again.
2. Acknowledge the user's SPECIFIC answer before moving on. "You said [X] — that tells me [Y]."
3. Go DEEP, not wide. Don't rush through a checklist. Ask follow-ups.
4. Generate 3-5 buttons that match YOUR question — not generic options.
5. profile_updates: extract facts from the user's latest message. Use these field names: ${Object.keys(S.profile).join(', ')}
6. For arrays (diagnosedProblems, rootCauses): provide ["item1", "item2"]
7. phase_signals: only set to true when the event ACTUALLY happened this turn.
8. Never invent data. Only reference ✅ confirmed data or scraped website data.
9. Minimum 5 sentences per response. This is a premium consulting experience.
10. Never use filler: "interesting", "great", "that's helpful", "let me understand", "tell me more".
11. Every turn should teach the user something — a benchmark, a framework, an insight about their business.
12. If the user attached files, acknowledge them first and ask what they contain and why they're relevant.
13. When extracting stage info, set profile_updates.companyStage to one of: "pre_seed_idea", "seed_startup", "early_scale", "expansion_enterprise"
14. Always compare the user's numbers to STAGE-APPROPRIATE benchmarks. E.g., "Your 7% monthly churn is above the ${S.resolvedStage ? getStagePlaybook(S.resolvedStage)?.label : 'stage'} median of X%"
15. Flag ANTI-PATTERNS: if the user describes behavior that conflicts with their stage's playbook, call it out diplomatically.
16. SITUATION BEFORE NUMBERS: always seek to understand WHY a number is what it is. Ask about the people, processes, and systems behind it. "Who drives that revenue?" is as important as "How much revenue?"
17. EXTRACT OPERATING MODEL DATA: when the user describes their team, roles, decision-making, org structure, or tools — capture it in profile_updates using: currentSituation, orgStructure, decisionMaking, keyDependencies, teamMorale, systemsLandscape, roadmap, plannedChanges, teamEnablement.
18. BE CONCISE IN YOUR QUESTIONS: ask one powerful question per topic, not three weak ones. Let the founder talk. Your job is to draw out clarity, not to fill silence.
19. GENTLE CHALLENGE: when something doesn't add up, challenge with curiosity not confrontation. "That's an unusual pattern at your stage — help me understand what's driving it."`;


    // ══════════════════════════════════════════════════
    // CALL LLM
    // ══════════════════════════════════════════════════

    let llm;
    try {
      llm = await callGemini(fullPrompt, gKey);
    } catch (e) {
      console.error(`[v11] LLM error:`, e.message);
      llm = buildFallback(S);
    }

    // ══════════════════════════════════════════════════
    // UPDATE PROFILE
    // ══════════════════════════════════════════════════

    if (llm.profile_updates && typeof llm.profile_updates === 'object') {
      for (const [k, v] of Object.entries(llm.profile_updates)) {
        if (v == null || !S.profile.hasOwnProperty(k)) continue;
        if (Array.isArray(S.profile[k])) {
          const items = Array.isArray(v) ? v : [v];
          S.profile[k] = [...new Set([...S.profile[k], ...items.filter(i => i && String(i).trim())])];
        } else if (typeof v === 'string' && v.trim()) {
          S.profile[k] = v.trim();
        }
      }
    }

    // Process signals
    if (llm.phase_signals) {
      if (llm.phase_signals.welcome_done === true) S.welcomeDone = true;
      if (llm.phase_signals.diagnosis_presented === true) S.diagnosisPresented = true;
      if (llm.phase_signals.diagnosis_validated === true) S.diagnosisValidated = true;
    }

    // ══════════════════════════════════════════════════
    // STAGE RESOLUTION — update resolvedStage when stage/companyStage changes
    // ══════════════════════════════════════════════════
    if (S.profile.companyStage || S.profile.stage) {
      const newStage = resolveStage(S.profile.companyStage || S.profile.stage);
      if (newStage && newStage !== S.resolvedStage) {
        S.resolvedStage = newStage;
        S.profile.companyStage = newStage;
        console.log(`[v12] Stage resolved → ${newStage}`);
      }
    }

    // Record AI message in transcript
    const aiMsg = llm.message || '';
    S.transcript.push({ role: 'assistant', text: aiMsg });

    // Post-update phase check
    if (canAdvancePhase(S)) { doAdvance(S); }

    // ══════════════════════════════════════════════════
    // SANITIZE + RESPOND
    // ══════════════════════════════════════════════════

    const options = sanitizeOptions(llm.options, S);
    const isFinish = S.currentPhase === 'pre_finish';
    const hasGen = options.some(o => o.key === 'generate_report');
    const mode = (isFinish && hasGen) ? 'buttons' : 'mixed';

    const depthScore = calculateDiagnosticDepth(S.profile);
    console.log(`[v12] T${S.totalTurns} phase:${S.currentPhase} pt:${S.phaseTurns} stage:${S.resolvedStage || '?'} opts:${options.length} depth:${depthScore}%`);

    // Build assumptions for the frontend "What I know" panel
    const assumptions = buildAssumptionSummary(S.profile);

    return res.status(200).json({
      step_id: S.currentPhase,
      message: aiMsg,
      mode, options,
      allow_text: mode !== 'buttons',
      session_data: S,
      current_phase: PHASES[S.currentPhase]?.display || S.currentPhase,
      turn_count: S.totalTurns,
      confidence_state: calcConf(S),
      diagnostic_depth: depthScore,
      assumptions
    });

  } catch (e) {
    console.error('[v11 FATAL]', e);
    return res.status(200).json({
      step_id: 'error', message: 'Something went wrong. Tell me about your business.',
      mode: 'mixed', options: [{ key: 'restart', label: 'Start over' }],
      allow_text: true, session_data: null, current_phase: 'welcome'
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPTIONS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════════

function sanitizeOptions(raw, S) {
  if (!Array.isArray(raw) || raw.length === 0) return getDefaults(S);
  const valid = raw.filter(o => o && typeof o.key === 'string' && typeof o.label === 'string' && o.key.length > 0 && o.label.length > 0)
    .map(o => ({ key: o.key.slice(0, 80), label: o.label.slice(0, 120) }))
    .slice(0, 6);
  return valid.length >= 2 ? valid : getDefaults(S);
}

function getDefaults(S) {
  if (S.currentPhase === 'welcome') return [{ key: 'correct', label: 'Yes, mostly correct' }, { key: 'partial', label: 'Partially — let me clarify' }, { key: 'wrong', label: 'Not quite right' }];
  if (S.currentPhase === 'pre_finish') return [{ key: 'generate_report', label: '📥 Generate Strategic Growth Plan' }, { key: 'add_context', label: 'Add more context first' }];
  return [{ key: 'continue', label: 'Continue →' }, { key: 'explain', label: 'Let me explain in detail' }];
}

// ═══════════════════════════════════════════════════════════════════════════════
// FALLBACK (when LLM fails)
// ═══════════════════════════════════════════════════════════════════════════════

function buildFallback(S) {
  const p = S.profile;
  const checks = PHASES[S.currentPhase]?.checklist || [];
  const missing = checks.find(k => { const v = p[k]; return Array.isArray(v) ? v.length === 0 : (!v || v.trim() === ''); });
  const fb = {
    businessModel: { m: "Let's talk about your revenue model. How do you charge customers?", o: [{ key: 'saas', label: 'SaaS subscription' }, { key: 'services', label: 'Services' }, { key: 'marketplace', label: 'Marketplace' }, { key: 'other', label: 'Other' }] },
    stage: { m: "What growth stage are you at?", o: [{ key: 'pre', label: 'Pre-revenue' }, { key: 'early', label: 'Early (< €10K MRR)' }, { key: 'growing', label: 'Growing (€10-50K)' }, { key: 'scaling', label: 'Scaling (€50K+)' }] },
    revenue: { m: "What's your current monthly recurring revenue?", o: [{ key: 'low', label: '< €5K MRR' }, { key: 'mid', label: '€5-20K MRR' }, { key: 'high', label: '€20-100K MRR' }, { key: 'top', label: '€100K+ MRR' }] },
    teamSize: { m: "How large is your team?", o: [{ key: 'solo', label: '1-2 people' }, { key: 'small', label: '3-10' }, { key: 'mid', label: '10-50' }, { key: 'large', label: '50+' }] },
    funding: { m: "What's your funding status?", o: [{ key: 'boot', label: 'Bootstrapped' }, { key: 'seed', label: 'Seed' }, { key: 'a', label: 'Series A+' }, { key: 'other', label: 'Other' }] },
    icpTitle: { m: "Who is your ideal buyer?", o: [{ key: 'smb', label: 'SMB owners' }, { key: 'mid', label: 'Mid-market' }, { key: 'ent', label: 'Enterprise' }, { key: 'dev', label: 'Technical' }] },
    salesMotion: { m: "How do you sell?", o: [{ key: 'in', label: 'Inbound' }, { key: 'out', label: 'Outbound' }, { key: 'plg', label: 'Product-led' }, { key: 'mix', label: 'Mix' }] },
    channels: { m: "Which channels work best?", o: [{ key: 'seo', label: 'Content/SEO' }, { key: 'social', label: 'LinkedIn' }, { key: 'paid', label: 'Paid ads' }, { key: 'ref', label: 'Referrals' }] },
    avgDealSize: { m: "What's your average deal size?", o: [{ key: 's', label: '< €1K' }, { key: 'm', label: '€1-10K' }, { key: 'l', label: '€10-50K' }, { key: 'xl', label: '€50K+' }] },
    salesProcess: { m: "Describe your sales process.", o: [{ key: 'none', label: 'No process' }, { key: 'basic', label: 'Basic' }, { key: 'doc', label: 'Documented' }, { key: 'self', label: 'Self-serve' }] },
    whoCloses: { m: "Who closes deals?", o: [{ key: 'f', label: 'Founder' }, { key: 'fm', label: 'Mostly founder' }, { key: 't', label: 'Sales team' }, { key: 's', label: 'Self-serve' }] },
    mainBottleneck: { m: "Where's the biggest bottleneck?", o: [{ key: 'l', label: 'Lead gen' }, { key: 'c', label: 'Conversion' }, { key: 'ch', label: 'Churn' }, { key: 'sc', label: 'Scaling' }] }
  };
  const f = fb[missing] || { m: 'Tell me more about your business.', o: [{ key: 'c', label: 'Continue' }] };
  return { message: f.m, options: f.o, profile_updates: {}, phase_signals: {} };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC DEPTH — weighted scoring based on field importance, not question count
// ═══════════════════════════════════════════════════════════════════════════════

function calculateDiagnosticDepth(profile) {
  // Weighted fields — not all questions are equal
  const weights = {
    // Identity (required): 30 points total
    companyName: 5, industry: 8, stage: 8, teamSize: 5, revenue: 4,
    // GTM (high value): 25 points total
    mainBottleneck: 10, salesMotion: 8, icpTitle: 7,
    // Metrics (high value): 25 points total
    churnRate: 8, avgDealSize: 7, winRate: 5, cac: 5,
    // Operating model: 10 points total
    whoCloses: 5, crm: 3, tools: 2,
    // Context: 10 points total
    diagnosedProblems: 5, userPriority: 5,
  };

  let score = 0;
  let max = 0;
  for (const [field, weight] of Object.entries(weights)) {
    max += weight;
    const val = profile[field];
    if (val && typeof val === 'string' && val.trim().length > 0) score += weight;
    if (Array.isArray(val) && val.length > 0) score += weight;
  }

  return Math.round((score / max) * 100);
}

// Backward-compatible wrapper used in responses
function calcConf(S) {
  const depth = calculateDiagnosticDepth(S.profile);
  return { total: depth };
}
