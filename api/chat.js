// ═══════════════════════════════════════════════════════════════════════════════
// REVENUE ARCHITECT v13 — HOLISTIC KYC + OPERATING MODEL DESIGN
//
// v13 additions over v12:
// 1. Rebalanced KYC: discovery now covers people, systems, culture,
//    roadmap & operating model alongside financial metrics.
// 2. Quantification-First Persona: concise, analytical questioning
//    that demands numbers, percentages, and measurable metrics —
//    behaves like a consultant who sizes problems, not a therapist.
// 3. Operating Model Design: new actionable output section that maps
//    org structure, decision flows, team roles & system architecture.
// 4. Anti-Redundancy: once a problem is identified, moves forward
//    immediately to quantify impact rather than re-exploring.
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
    checklist: ['industry', 'growthTarget', 'businessModel', 'stage', 'revenue', 'teamSize', 'funding'],
    depthTopics: [
      'Industry/sector: exact vertical, sub-segment, and market size estimate',
      'Primary business objective: the ONE measurable goal for the next 6-12 months (revenue target, customer count, funding round)',
      'Current revenue number and month-over-month growth rate — exact figures',
      'Team size and how many are in revenue-generating vs support roles — headcount split',
      'Burn rate and runway — months of cash remaining at current spend',
      'Revenue model and pricing: ACV, number of tiers, conversion rate from free to paid',
      'Customer count: total active, paying, churned in last 90 days',
      'Competitive landscape: how many direct competitors, win rate against them',
      'Current tool stack: what they spend monthly on SaaS tools, what is manual vs automated'
    ],
    description: 'Deep-dive into company DNA: industry, primary objective, model, revenue, team, funding, systems.'
  },
  gtm: {
    display: 'gtm', next: 'sales', minTurns: 4,
    checklist: ['icpTitle', 'salesMotion', 'channels', 'avgDealSize'],
    depthTopics: [
      'ICP quantified: how many target companies exist, average contract value, decision-maker job title',
      'Channel ROI: cost per lead by channel, conversion rates, which has the best CAC payback',
      'Pipeline metrics: how many leads/month, qualified opportunities, pipeline value',
      'Content/marketing spend and measurable output: leads generated, cost per MQL',
      'Competitive win rate: % of deals won vs lost to specific competitors',
      'Marketing and sales tooling: monthly spend, utilization rate, gaps costing revenue',
      'Future GTM investment: planned budget increase, expected ROI, hiring timeline'
    ],
    description: 'Map Go-to-Market: current reality, ICP depth, channels, people, systems, positioning, lead gen.'
  },
  sales: {
    display: 'sales', next: 'diagnosis', minTurns: 4,
    checklist: ['salesProcess', 'whoCloses', 'mainBottleneck'],
    depthTopics: [
      'Sales process metrics: number of stages, conversion rate stage-to-stage, average days per stage',
      'Founder dependency quantified: what % of deals require founder involvement, and at which stage',
      'Win/loss: exact win rate %, top 3 reasons for lost deals with frequency',
      'Ramp time: how many days for a new rep to reach quota, what % actually make it',
      'Tech stack utilization: CRM adoption %, how many tools are shelfware, monthly cost',
      'Post-sale economics: onboarding cost per customer, time to value, NRR %',
      'Churn quantified: monthly churn rate %, revenue lost to churn per month, top reason with frequency',
      'Planned hires: how many, which roles, expected ramp time and cost'
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
    // Buyer psychology profiling — running scores updated each turn
    buyerProfile: {
      scores: { operator: 0, visionary: 0, pragmatist: 0, validator: 0 },
      primary: null,      // 'operator' | 'visionary' | 'pragmatist' | 'validator'
      secondary: null,
      confidence: 0,      // 0-100
      signals: []
    },
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
      industry: 'Industry/Sector', growthTarget: 'Primary Business Objective',
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
// COLLECTED SUMMARY — semantic topic groups with values for cross-phase memory
// ═══════════════════════════════════════════════════════════════════════════════

function buildCollectedSummary(profile) {
  const p = profile;
  const groups = [
    {
      topic: 'COMPANY IDENTITY',
      fields: [
        ['Company Name', p.companyName], ['Website', p.website], ['Industry', p.industry],
        ['Business Model', p.businessModel], ['Stage', p.stage || p.companyStage],
        ['Product', p.productDescription], ['Pricing', `${p.pricingModel || ''} ${p.pricingRange || ''}`.trim()],
        ['Competitive Landscape', p.competitiveLandscape], ['Differentiator', p.differentiator]
      ]
    },
    {
      topic: 'FINANCIALS',
      fields: [
        ['Revenue', p.revenue], ['Revenue Growth', p.revenueGrowth],
        ['Funding', p.funding], ['Runway', p.runway],
        ['Budget Level', p.budgetLevel], ['Growth Target', p.growthTarget]
      ]
    },
    {
      topic: 'PEOPLE & TEAM',
      fields: [
        ['Team Size', p.teamSize], ['Team Roles', p.teamRoles],
        ['Org Structure', p.orgStructure], ['Decision Making', p.decisionMaking],
        ['Key Dependencies', p.keyDependencies], ['Team Morale/Culture', p.teamMorale],
        ['Founder Role in Sales', p.founderInvolvement], ['Who Closes Deals', p.whoCloses],
        ['Team Enablement', p.teamEnablement]
      ]
    },
    {
      topic: 'SITUATION & OPERATIONS',
      fields: [
        ['Current Situation', p.currentSituation], ['Systems/Tools', p.systemsLandscape],
        ['CRM', p.crm], ['Tools', p.tools], ['Automation Level', p.automationLevel],
        ['Roadmap', p.roadmap], ['Planned Changes', p.plannedChanges]
      ]
    },
    {
      topic: 'GO-TO-MARKET',
      fields: [
        ['ICP/Buyer', p.icpTitle], ['ICP Company Size', p.icpCompanySize],
        ['ICP Industry', p.icpIndustry], ['ICP Pain Points', p.icpPainPoints],
        ['ICP Decision Process', p.icpDecisionProcess], ['ICP Budget', p.icpBudget],
        ['Sales Motion', p.salesMotion], ['Channels', p.channels],
        ['Best Channel', p.bestChannel], ['Channel ROI', p.channelROI],
        ['Deal Size', p.avgDealSize], ['Sales Cycle', p.salesCycle],
        ['Content Strategy', p.contentStrategy], ['Lead Gen', p.leadGenMethod],
        ['CAC', p.cac], ['LTV', p.ltv]
      ]
    },
    {
      topic: 'SALES ENGINE',
      fields: [
        ['Sales Process', p.salesProcess], ['Process Stages', p.processStages],
        ['Process Documented', p.processDocumented],
        ['Win Rate', p.winRate], ['Lost Deal Reasons', p.lostDealReasons],
        ['Main Objections', p.mainObjections],
        ['Main Bottleneck', p.mainBottleneck], ['Secondary Bottleneck', p.secondaryBottleneck]
      ]
    },
    {
      topic: 'RETENTION & EXPANSION',
      fields: [
        ['Churn Rate', p.churnRate], ['Churn Reasons', p.churnReasons],
        ['Expansion Revenue', p.expansionRevenue], ['NRR', p.nrr],
        ['Onboarding', p.onboardingProcess], ['Customer Success', p.customerSuccess]
      ]
    }
  ];

  const result = [];
  for (const g of groups) {
    const filled = g.fields.filter(([, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return v && typeof v === 'string' && v.trim() !== '';
    });
    if (filled.length > 0) {
      result.push(`📋 ${g.topic}: ${filled.map(([label, val]) => `${label} = ${val}`).join(' | ')}`);
    }
  }

  return result.length > 0 ? result.join('\n') : '(nothing collected yet)';
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUYER PSYCHOLOGY PROFILING — running classification updated each turn
// ═══════════════════════════════════════════════════════════════════════════════

const BUYER_KW = {
  operator: [
    'data', 'metrics', 'measure', 'track', 'percentage', 'ratio', 'formula',
    'unit economics', 'benchmark', 'kpi', 'dashboard', 'analytics', 'spreadsheet',
    'roi', 'model', 'calculate', 'quantify', 'numbers', 'process', 'documented',
    'systematic', 'framework', 'methodology', 'structured', 'audit', 'funnel',
    'dati', 'metriche', 'misurare', 'percentuale', 'calcolare', 'processo',
    'documentato', 'strutturato', 'numeri', 'modello'
  ],
  visionary: [
    'vision', 'strategy', 'transform', 'disrupt', 'market', 'opportunity',
    'potential', 'scale', 'long-term', 'big picture', 'narrative', 'story',
    'imagine', 'future', 'industry', 'revolution', 'category', 'position',
    'brand', 'ecosystem', 'platform', 'moat', 'flywheel',
    'visione', 'strategia', 'trasformare', 'opportunità', 'potenziale',
    'lungo termine', 'futuro', 'settore', 'ecosistema', 'mercato'
  ],
  pragmatist: [
    'quick', 'fast', 'now', 'immediately', 'this week', 'tomorrow', 'asap',
    'just', 'simple', 'shortcut', 'hack', 'skip', 'prioritize', 'focus',
    'action', 'execute', 'ship', 'launch', 'move', 'next step',
    'practical', 'concrete', 'specific', 'bottom line',
    'subito', 'veloce', 'adesso', 'questa settimana', 'domani', 'semplice',
    'pratico', 'concreto', 'specifico', 'azione', 'priorità', 'focus'
  ],
  validator: [
    'others', 'competitors', 'industry standard', 'best practice', 'benchmark',
    'careful', 'safe', 'proven', 'validate', 'consensus', 'align',
    'stakeholder', 'board', 'investors', 'comparable', 'case study',
    'evidence', 'track record', 'similar companies', 'what do you see',
    'altri', 'concorrenti', 'standard', 'rischio', 'sicuro', 'validare',
    'consenso', 'investitori', 'aziende simili', 'cosa vedete', 'provato'
  ]
};

function updateBuyerProfile(session) {
  const userMessages = session.transcript.filter(t => t.role === 'user').map(t => t.text || '');
  const allText = userMessages.join(' ').toLowerCase();
  const wordCount = allText.split(/\s+/).filter(Boolean).length;
  const signals = [];

  let scores = { operator: 0, visionary: 0, pragmatist: 0, validator: 0 };

  // Response length
  if (userMessages.length > 0) {
    const avgLen = userMessages.reduce((s, m) => s + m.split(/\s+/).filter(Boolean).length, 0) / userMessages.length;
    if (avgLen < 15) { scores.pragmatist += 15; signals.push('short responses'); }
    else if (avgLen > 40) { scores.operator += 10; scores.validator += 5; signals.push('detailed responses'); }
  }

  // Numerical density
  if (wordCount > 0) {
    const nums = (allText.match(/\d+[%€$kKmM]?|\b\d+[.,]\d+/g) || []).length;
    const density = nums / wordCount;
    if (density > 0.08) { scores.operator += 20; signals.push('high number density'); }
    else if (density > 0.04) { scores.operator += 8; scores.pragmatist += 5; }
    else if (wordCount > 50) { scores.visionary += 10; }
  }

  // Keyword matching
  for (const [prof, keywords] of Object.entries(BUYER_KW)) {
    let hits = 0;
    for (const kw of keywords) {
      const regex = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      const matches = allText.match(regex);
      if (matches) hits += matches.length;
    }
    scores[prof] += hits * 3;
  }

  // Time horizon
  const shortPhrases = ['this week', 'this month', 'right now', 'immediately', 'next week', 'questa settimana', 'subito'];
  const longPhrases = ['this year', 'next year', '12 months', 'long term', '3 years', 'quest\'anno', 'lungo termine'];
  const shortHits = shortPhrases.reduce((c, p) => c + (allText.includes(p) ? 1 : 0), 0);
  const longHits = longPhrases.reduce((c, p) => c + (allText.includes(p) ? 1 : 0), 0);
  if (shortHits > longHits && shortHits >= 1) { scores.pragmatist += 10; signals.push('short time horizon'); }
  else if (longHits > shortHits && longHits >= 1) { scores.visionary += 8; scores.operator += 3; signals.push('long time horizon'); }

  // Risk language
  const aversePhrases = ['careful', 'risk', 'safe', 'conservative', 'worried', 'cautious', 'attento', 'rischio', 'sicuro'];
  const tolerantPhrases = ['move fast', 'aggressive', 'bold', 'experiment', 'fail fast', 'veloce', 'aggressivo', 'sperimentare'];
  const av = aversePhrases.reduce((c, w) => c + (allText.includes(w) ? 1 : 0), 0);
  const tol = tolerantPhrases.reduce((c, w) => c + (allText.includes(w) ? 1 : 0), 0);
  if (av > tol && av >= 2) { scores.validator += 12; signals.push('risk-averse'); }
  else if (tol > av && tol >= 1) { scores.pragmatist += 6; scores.visionary += 4; signals.push('risk-tolerant'); }

  // Resolve
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][0];
  const secondary = sorted[1][0];
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const confidence = total > 0 ? Math.round(((sorted[0][1] - sorted[1][1]) / total) * 100) : 0;

  return { scores, primary, secondary, confidence, signals };
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
  // PRIORITY GATE: industry and primary objective MUST come first
  const hasIndustry = profile.industry && profile.industry.trim();
  const hasObjective = profile.growthTarget && profile.growthTarget.trim();
  const hasIdentity = profile.companyName && hasIndustry && profile.stage && hasObjective;
  const hasGTM = profile.salesMotion || profile.channels;

  // Gate 1: Industry + objective are non-negotiable first
  if (!hasIndustry && conversationLength > 0) {
    return {
      phase: 'identity',
      maxQuestions: 1,
      instruction: 'INDUSTRY IS MISSING. This is the #1 priority. Ask: "In che settore operi?" / "What industry/sector are you in?". Do NOT ask about anything else until industry is established.'
    };
  }
  if (hasIndustry && !hasObjective && conversationLength > 0) {
    return {
      phase: 'identity',
      maxQuestions: 1,
      instruction: 'PRIMARY OBJECTIVE IS MISSING. This is the #2 priority. Ask: "Qual è il tuo obiettivo principale nei prossimi 6-12 mesi?" / "What is your #1 business goal for the next 6-12 months?". Do NOT proceed to metrics until this is clear.'
    };
  }
  if (!hasIdentity && conversationLength > 0) {
    return {
      phase: 'identity',
      maxQuestions: 1,
      instruction: 'Focus on completing company identity (company name, industry, stage, primary objective). Do not ask about metrics or GTM yet.'
    };
  }
  if (hasIdentity && !hasGTM) {
    return {
      phase: 'gtm',
      maxQuestions: 1,
      instruction: 'Identity is confirmed (industry: ' + profile.industry + ', objective: ' + profile.growthTarget + '). Focus on sales motion and channels. Do not jump to detailed metrics yet.'
    };
  }
  if (hasGTM) {
    return {
      phase: 'metrics',
      maxQuestions: 1,
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
- Make 3 bold assumptions about: (a) their INDUSTRY/SECTOR, (b) their revenue model, (c) their target customer
- Try to EXTRACT the industry from the website data and set profile_updates.industry
- Ask them to validate: "Ho capito bene? Cosa devo correggere? E qual è il tuo obiettivo principale nei prossimi 6-12 mesi?" / "Did I get this right? And what's your primary goal for the next 6-12 months?"
- Generate confirmation buttons that include industry-related options

CRITICAL: Industry and primary objective are the FIRST things you need to establish. They shape the entire diagnostic.
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
- Your FIRST question must establish: in che settore operi / what industry are you in? This is the #1 priority.
- If the description already reveals the industry, extract it (set profile_updates.industry) and instead ask: qual è il tuo obiettivo principale nei prossimi 6-12 mesi? / What is your primary business goal for the next 6-12 months?
- Generate relevant buttons (include industry-specific options if possible)

PRIORITY ORDER for first questions: 1) Industry/sector 2) Primary objective 3) Everything else.
AFTER this turn, set phase_signals.welcome_done=true in your next response (when the user replies).
Make this warm and stage-appropriate. Pre-seed founders need encouragement, not interrogation.`;
    }

    case 'company':
      return `PHASE: COMPANY DNA (Turn ${S.phaseTurns + 1} of minimum ${phase.minTurns})
${turnsLeft > 0 ? `You need at least ${turnsLeft} more turn(s) in this phase.` : 'Can transition if all checklist items are filled.'}

═══ BENCHMARKS ═══
${stageBenchmarks}

═══ STAGE-APPROPRIATE QUESTIONS (use as inspiration) ═══
${stageQuestions.map((q, i) => `  ${i + 1}. ${q}`).join('\n')}

DEPTH TOPICS (choose ONE per turn):
${phase.depthTopics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

CHECKLIST (in PRIORITY ORDER — follow this sequence):
${phase.checklist.map(k => {
        const v = p[k]; const has = v && v.trim();
        return has ? `  ✅ ${k}: ${v} (DONE)` : `  ❓ ${k}: NOT YET COLLECTED`;
      }).join('\n')}

═══ PRIORITY RULE ═══
The checklist is ORDERED. You MUST collect items FROM TOP TO BOTTOM.
- ❓ industry: FIRST. Without it, the entire diagnostic is blind. Ask immediately.
- ❓ growthTarget: SECOND. The primary objective shapes every recommendation.
- Then businessModel, stage, revenue, teamSize, funding in order.
Do NOT skip ahead to revenue or teamSize if industry and growthTarget are still missing.

THIS TURN — SINGLE-TOPIC INSTRUCTIONS:
1. Look at the CHECKLIST above. Pick the FIRST ❓ item from the TOP (priority order).
2. Write a bold **Topic Header** for that item (e.g. **Industry**, **Primary Objective**, **Revenue**).
3. Write ONE sentence of context: explain WHY you need this NUMBER and how it feeds the diagnostic.
4. Ask exactly ONE question — and it MUST demand a concrete answer: a number, a percentage, a currency amount, or a measurable fact. For industry: "In che settore operi esattamente?" / "What specific industry/vertical are you in?". For growthTarget: "Qual è il tuo obiettivo #1 misurabile nei prossimi 6-12 mesi?" / "What is your #1 measurable goal for the next 6-12 months?".
5. If the user shared a number in their last message, briefly acknowledge it with a benchmark comparison before your question.
6. If the user already described a problem qualitatively, do NOT ask them to elaborate. Instead, ask them to QUANTIFY it: "How often does this happen?", "How many customers are affected?", "What's the €/month impact?".
7. When the user shares their stage, SET profile_updates.companyStage to one of: "pre_seed_idea", "seed_startup", "early_scale", "expansion_enterprise"
8. Extract data into the matching profile fields, including: industry, growthTarget, currentSituation, orgStructure, decisionMaking, keyDependencies, teamMorale, systemsLandscape, roadmap, plannedChanges

DO NOT ask about two topics. ONE topic, ONE question per message. Once a topic is answered, MOVE ON — never circle back.`;

    case 'gtm':
      return `PHASE: GO-TO-MARKET (Turn ${S.phaseTurns + 1} of minimum ${phase.minTurns})
${turnsLeft > 0 ? `At least ${turnsLeft} more turn(s) needed.` : 'Can transition if checklist complete.'}

COMPANY CONTEXT:
Model: ${p.businessModel || '?'} | Stage: ${p.stage || '?'} (${stagePlaybook?.label || '?'}) | Revenue: ${p.revenue || '?'} | Team: ${p.teamSize || '?'}

═══ BENCHMARKS ═══
${stageBenchmarks}

DEPTH TOPICS (choose ONE per turn):
${phase.depthTopics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

CHECKLIST:
${phase.checklist.map(k => {
        const v = p[k]; const has = v && v.trim();
        return has ? `  ✅ ${k}: ${v} (DONE)` : `  ❓ ${k}: NEEDED`;
      }).join('\n')}

THIS TURN — SINGLE-TOPIC INSTRUCTIONS:
1. If this is the FIRST turn of GTM phase, start with a brief 1-sentence transition from company DNA, then move to your question.
2. Look at the CHECKLIST. Pick the SINGLE most important ❓ item not yet collected.
3. Write a bold **Topic Header** (e.g. **Ideal Customer**, **Sales Channels**, **Deal Size**).
4. Write ONE sentence of context: why this NUMBER matters for their GTM diagnostic.
5. Ask exactly ONE question that demands a MEASURABLE answer. Push for specificity and numbers: not "who is your customer" → "What's the job title and company size of your best 3 customers?". Not "which channels work" → "What % of your pipeline comes from each channel?". Not "how is lead gen" → "How many qualified leads per month, and what's the cost per lead?".
6. If comparing to benchmarks, weave it naturally into the context line.
7. If the user gave a qualitative answer last turn, don't ask them to elaborate — ask for the NUMBER behind it: "You said outbound is slow. How many outbound touches per week, and what's the reply rate?".
8. FLAG ANTI-PATTERNS if detected: ${antiPatterns.slice(0, 3).join('; ')}
9. Extract into: systemsLandscape, plannedChanges, teamMorale where relevant

ONE topic, ONE question per message. Never combine two checklist items. Once a topic is sized, MOVE ON.`;

    case 'sales':
      return `PHASE: SALES ENGINE (Turn ${S.phaseTurns + 1} of minimum ${phase.minTurns})
${turnsLeft > 0 ? `At least ${turnsLeft} more turn(s) needed.` : 'Can transition if checklist complete.'}

CONTEXT:
Model: ${p.businessModel || '?'} | ICP: ${p.icpTitle || '?'} | Motion: ${p.salesMotion || '?'} | Deal: ${p.avgDealSize || '?'}

═══ BENCHMARKS ═══
${stageBenchmarks}
Recommended tech stack: ${stagePlaybook?.playbook?.techStack?.join(', ') || 'N/A'}

DEPTH TOPICS (choose ONE per turn):
${phase.depthTopics.map((t, i) => `  ${i + 1}. ${t}`).join('\n')}

CHECKLIST:
${phase.checklist.map(k => {
        const v = p[k]; const has = v && v.trim();
        return has ? `  ✅ ${k}: ${v} (DONE)` : `  ❓ ${k}: NEEDED`;
      }).join('\n')}

THIS TURN — SINGLE-TOPIC INSTRUCTIONS:
1. Look at the CHECKLIST. Pick the SINGLE most important ❓ item not yet collected.
2. Write a bold **Topic Header** (e.g. **Sales Process**, **Who Closes Deals**, **Main Bottleneck**).
3. Write ONE sentence of context: why this NUMBER matters for the sales diagnostic.
4. Ask exactly ONE question that demands a CONCRETE METRIC. Not "describe your sales process" → "How many stages, what's the average time from first call to close, and what % of deals stall at each stage?". Not "what's the biggest challenge" → "Where do you lose the most revenue today — and how much per month?". For bottleneck: make a hypothesis with a number, then ask for validation.
5. Compare to benchmarks when relevant: win rate median ${stagePlaybook?.benchmarks?.winRate?.median || '?'}%, sales cycle median ${stagePlaybook?.benchmarks?.salesCycleDays?.median || '?'} days, CAC median €${stagePlaybook?.benchmarks?.cac?.median || '?'}
6. If the user described a problem qualitatively in previous turns, DO NOT re-explore it. Ask: "How much does this cost you today?" or "What's the monthly revenue impact?".
7. EXTRACT NRR: when user mentions NRR as a percentage (e.g. "110%"), set profile_updates.nrr. If they mention expansion in currency, use expansionRevenue instead.
8. FLAG ANTI-PATTERNS: ${antiPatterns.slice(0, 3).join('; ')}
9. Extract into: teamEnablement, keyDependencies, systemsLandscape, plannedChanges, nrr

This is the last discovery phase before diagnosis. ONE topic, ONE question per message. Once sized, MOVE ON.`;

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
      const depth = calculateDiagnosticDepth(S.profile, S.currentPhase);
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
        if (contextData.industry) S.profile.industry = contextData.industry;

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

    const fullPrompt = `You are the REVENUE ARCHITECT, a senior B2B revenue strategist and operating-model advisor (20+ years). You conduct deep discovery calls with founders and revenue leaders. Your style: **gentle** in tone, **clever** in connections, **concise** in questions.

You are a QUANTIFICATION CONSULTANT: you help founders turn vague intuitions into measurable facts. You listen for what is said AND what is left unsaid — then you PUT A NUMBER ON IT.

Your discovery philosophy: QUANTIFY FAST, MOVE FORWARD. Once a problem area is identified, don't linger — immediately ask for the NUMBER that sizes it: how many customers, what percentage, how much revenue, what frequency. You are a consultant who quantifies, not a therapist who riformula.

You know: MEDDPICC, Bow-Tie funnel, T2D3, SaaStr benchmarks, April Dunford positioning, Pirate Metrics (AARRR), David Sacks metrics, Operating Model Canvas.

You have BENCHMARK DATA from KBCM SaaS Survey, Statista, Pavilion/BenchSights, OpenView, Bessemer Cloud Index. Compare their numbers to stage-appropriate medians.

═══ YOUR CORE COMMUNICATION PRINCIPLE: ONE TOPIC PER MESSAGE — QUANTIFY, DON'T EXPLORE ═══
Every message you write MUST follow this structure:
1. **Short acknowledgment** (ONLY if user just answered): max 1 short line. Do NOT rephrase, summarize, or repeat what the user said — they just wrote it, they know. Instead, react with a brief insight, a benchmark comparison, or a simple "Noted." Examples: "€30K MRR — above median for Seed stage." or "Founder-led sales — common at your stage." NEVER write "You mentioned that..." or "So you're saying..."
2. **Topic header**: bold label (e.g. **Revenue Model**) for the NEXT topic
3. **Context line**: one sentence explaining WHY you need this NUMBER and how it feeds the diagnostic
4. **One question**: exactly ONE clear, QUANTIFIABLE question. Always prefer questions that demand a number, a percentage, a frequency, or a concrete metric. Examples: "How many active customers do you have today?" not "Tell me about your customers". "What % of leads convert to paid?" not "How is your conversion going?". "How much revenue do you lose monthly to churn?" not "Tell me about your retention challenges".
5. **Buttons**: minimum 3 options, maximum 5. ALWAYS include one open-ended escape option as the LAST button (e.g. "Other — let me explain", "Altro — spiego io", "None of these") so the user is never forced into choices that don't fit. Never present only 2 binary options.
Every word must add value. If a sentence only restates what the user said, DELETE it.

═══ ANTI-REDUNDANCY RULE ═══
Once a problem area is understood (user confirmed it, or you have enough data to size it), STOP ASKING about it. Move to the NEXT topic immediately. Never ask a second clarifying question about the same issue. The user's time is limited — every question must unlock NEW information, not deepen what you already know.
BANNED question patterns: "Can you tell me more about...", "How would you describe...", "Walk me through how that feels...", "What does that look like day to day?". REPLACE with: "How many?", "What percentage?", "How much does that cost you per month?", "What's the frequency?".

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

═══ CROSS-PHASE MEMORY — EVERYTHING ALREADY COLLECTED (DO NOT re-ask ANY of this) ═══
${buildCollectedSummary(S.profile)}

BEFORE asking ANY question, scan the memory above. If the information is already there — even partially — DO NOT ask about it again. This applies across ALL phases, not just the current one. For example:
- If Team Size is known from the Company phase, NEVER ask about team size again in GTM or Sales.
- If Who Closes Deals was answered, do not ask "who handles sales" in a different way.
- If Channels were discussed, do not ask "how do customers find you" — it's the same data.
Violating this rule creates a terrible user experience.
${sequencingDirective}
${(S.totalTurns > 0 && S.totalTurns % 4 === 0 && S.currentPhase !== 'welcome' && S.currentPhase !== 'pre_finish') ? `
═══ ASSUMPTION VERIFICATION CHECK (every ~4 turns) ═══
AFTER your main question this turn, append a brief assumption check at the end of your message.
Use this format at the end: "Quick check — my current understanding:\n${buildAssumptionSummary(S.profile).map(a => '• ' + a).join('\n')}\nIs anything off?"
Keep the check compact. Your main question with its topic header comes FIRST.
` : ''}

${choice !== 'SNAPSHOT_INIT' ? `═══ USER'S LATEST MESSAGE ═══\n"${choice}"` : '═══ This is the FIRST message — welcome them ═══'}

═══ RESPONSE FORMAT (valid JSON) ═══
{
  "message": "Your markdown response — short, focused, one topic only.",
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
- EXACTLY 1 question per message. NEVER ask 2 or more questions.
- Maximum 80 words per response. Every word must earn its place.
- Each message MUST start with the short acknowledgment (if user just answered), then the bold **Topic Header**.
- Each message MUST include a 1-sentence context line BEFORE the question.
- NEVER rephrase, paraphrase, or summarize what the user just said. They know what they wrote.
- NEVER start with "You mentioned...", "So you're saying...", "Based on what you told me...", "From what you described...". These waste the user's time.
- If the user gives a vague answer, DO NOT ask them to elaborate. Make a reasonable assumption, STATE it in one line with a number, and MOVE TO THE NEXT TOPIC.
- ALWAYS prefer quantifiable questions over exploratory ones. "How much?", "How many?", "What %?", "What's the €/month cost?" > "Tell me more", "How would you describe", "What does that look like".
- Once a topic area has been answered (even partially), NEVER return to it. Progress is forward-only.
- Do NOT use option_groups. Always use the flat "options" array.

═══ ZERO-DUPLICATION RULE ═══
Before writing your question, perform this mental check:
1. Is this data point ALREADY in the CROSS-PHASE MEMORY above? → SKIP IT.
2. Did the user ALREADY mention this in the transcript? → SKIP IT.
3. Is this semantically the SAME question asked in a different way? → SKIP IT.
If all checklist items for the current phase are filled and there is nothing new to ask, signal readiness to advance.

═══ AGGRESSIVE EXTRACTION RULE ═══
When the user answers, they often reveal MULTIPLE data points in a single response. Extract ALL of them into profile_updates — not just the one you asked about. For example:
- If you asked about revenue and they say "We do €30K MRR with a team of 5, mostly inbound sales" → extract revenue, teamSize, AND salesMotion.
- If they mention roles ("I close all deals myself, my co-founder does product") → extract whoCloses, founderInvolvement, teamRoles, orgStructure.
- Always scan the full answer for: team size, revenue, funding, channels, tools, roles, process details.

═══ RULES ═══
1. READ THE TRANSCRIPT AND CROSS-PHASE MEMORY. Never re-ask something already discussed or collected.
2. Acknowledgment: max 1 short line — a benchmark reaction or "Noted." NEVER rephrase the user's words. NEVER summarize their situation back to them.
3. Generate 3-5 buttons matching YOUR single question. The LAST option must ALWAYS be an open-ended escape (e.g. "Other — let me explain"). Never present only 2 binary options.
4. profile_updates: extract ALL facts from the user's latest message, not just the one you asked about. Fields: ${Object.keys(S.profile).join(', ')}
5. For arrays (diagnosedProblems, rootCauses): provide ["item1", "item2"]
6. phase_signals: only set to true when the event ACTUALLY happened this turn.
7. Never invent data. Only reference ✅ confirmed data or scraped website data.
8. Never use filler: "interesting", "great", "that's helpful", "let me understand", "tell me more".
9. When relevant, teach the user something — a benchmark or an insight about their business.
10. If the user attached files, acknowledge them first.
11. When extracting stage info, set profile_updates.companyStage to one of: "pre_seed_idea", "seed_startup", "early_scale", "expansion_enterprise"
12. Compare the user's numbers to STAGE-APPROPRIATE benchmarks when you have them.
13. Flag ANTI-PATTERNS diplomatically if the user's behavior conflicts with their stage playbook.
14. NUMBERS FIRST, THEN SITUATION: always get the metric before exploring why. If you already have the qualitative picture, skip straight to "how much does this cost you?".
15. EXTRACT OPERATING MODEL DATA into: currentSituation, orgStructure, decisionMaking, keyDependencies, teamMorale, systemsLandscape, roadmap, plannedChanges, teamEnablement.
16. GENTLE CHALLENGE: when something doesn't add up, challenge with a number — "You said churn is low but NRR is 85%. That means you're losing 15% annually — is that intentional?".
17. ANTI-LOOPING: if you catch yourself about to ask a question that explores the same problem area the user already described, STOP. Ask for the financial/metric dimension instead, or move to the next topic entirely.
18. CONSULTANT MINDSET: every question you ask should help you SIZE the opportunity or the problem. Less "raccontami di più sul problema", more "quanto ti costa questo problema oggi?".`;


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
    // BUYER PSYCHOLOGY — update running classification
    // ══════════════════════════════════════════════════
    if (S.transcript.filter(t => t.role === 'user').length >= 2) {
      S.buyerProfile = updateBuyerProfile(S);
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

    const depthScore = calculateDiagnosticDepth(S.profile, S.currentPhase);
    console.log(`[v12] T${S.totalTurns} phase:${S.currentPhase} pt:${S.phaseTurns} stage:${S.resolvedStage || '?'} opts:${options.length} depth:${depthScore}%`);

    // Build assumptions for the frontend "What I know" panel
    const assumptions = buildAssumptionSummary(S.profile);

    // Pass option_groups from LLM if present
    const optionGroups = Array.isArray(llm.option_groups) && llm.option_groups.length > 0
      ? llm.option_groups.map(g => ({
        question_ref: (g.question_ref || '').slice(0, 80),
        options: sanitizeOptions(g.options, S)
      }))
      : null;

    return res.status(200).json({
      step_id: S.currentPhase,
      message: aiMsg,
      mode, options,
      option_groups: optionGroups,
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
  if (valid.length < 2) return getDefaults(S);

  // Auto-append an "Other" escape option when only 2 non-special options exist,
  // so the user is never forced into a binary choice
  const specialKeys = ['generate_report', 'update_and_generate', 'restart', 'download_again', 'open_dashboard', 'add_context'];
  const nonSpecial = valid.filter(o => !specialKeys.includes(o.key));
  const hasEscape = nonSpecial.some(o => /\b(other|altro|none|neither|spiego|explain|diverso|my own)\b/i.test(o.label));
  if (nonSpecial.length >= 2 && nonSpecial.length <= 2 && !hasEscape) {
    valid.push({ key: 'other_explain', label: 'Other — let me explain' });
  }

  return valid;
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
// DIAGNOSTIC DEPTH — phase-aware scoring that stays in sync with phase dots
// ═══════════════════════════════════════════════════════════════════════════════

// Each phase gets a slice of 0-100%. Progress within a phase is based on
// checklist field completion, so the percentage always matches the active dot.
const PHASE_RANGES = {
  welcome: { min: 0, max: 5 },
  company: { min: 5, max: 30 },
  gtm: { min: 30, max: 55 },
  sales: { min: 55, max: 80 },
  diagnosis: { min: 80, max: 95 },
  pre_finish: { min: 95, max: 100 },
};

function calculateDiagnosticDepth(profile, currentPhase) {
  const range = PHASE_RANGES[currentPhase] || PHASE_RANGES.welcome;
  const phase = PHASES[currentPhase];

  // If the phase has no checklist, return the min of the range
  if (!phase || !phase.checklist || phase.checklist.length === 0) {
    return range.min;
  }

  // Calculate completion within this phase's checklist
  let filled = 0;
  for (const k of phase.checklist) {
    const v = profile[k];
    const has = Array.isArray(v) ? v.length > 0 : (v && typeof v === 'string' && v.trim() !== '');
    if (has) filled++;
  }

  const phaseProgress = filled / phase.checklist.length; // 0..1
  const pct = Math.round(range.min + phaseProgress * (range.max - range.min));
  return Math.min(pct, range.max);
}

// Backward-compatible wrapper used in responses
function calcConf(S) {
  const depth = calculateDiagnosticDepth(S.profile, S.currentPhase);
  return { total: depth };
}
