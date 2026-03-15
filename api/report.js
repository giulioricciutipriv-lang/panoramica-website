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
// ARCHETYPE LIBRARY
// ═══════════════════════════════════════════════════════════════════════════════

let ARCHETYPES = null;
function loadArchetypes() {
  if (ARCHETYPES) return ARCHETYPES;
  try {
    let base;
    try { base = dirname(fileURLToPath(import.meta.url)); } catch { base = process.cwd() + '/api'; }
    const raw = readFileSync(join(base, 'benchmarks', 'archetypes.json'), 'utf-8');
    ARCHETYPES = JSON.parse(raw);
  } catch (e) {
    console.warn('[Report] Could not load archetypes:', e.message);
    ARCHETYPES = { archetypes: [] };
  }
  return ARCHETYPES;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COHORT PATTERN MATCHING — find archetypes that resemble this company
// ═══════════════════════════════════════════════════════════════════════════════

function matchArchetypes(profile, stageKey) {
  const lib = loadArchetypes();
  const archetypes = lib.archetypes || [];
  if (archetypes.length === 0) return { matches: [], block: '' };

  const p = profile;
  const num = (v) => {
    if (!v) return null;
    const s = String(v).replace(/[^0-9.,]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  const mrr = num(p.revenue);
  const teamSize = num(p.teamSize);
  const normalizedStage = stageKey || 'seed_startup';

  // Normalize text fields for keyword matching
  const allText = [
    p.mainBottleneck, p.secondaryBottleneck, p.salesMotion, p.whoCloses,
    p.founderInvolvement, p.salesProcess, p.channels, p.leadGenMethod,
    p.churnReasons, p.lostDealReasons, p.mainObjections, p.crm, p.tools,
    p.automationLevel, p.currentSituation, p.keyDependencies,
    ...(p.diagnosedProblems || []),
    ...(p.rootCauses || [])
  ].filter(Boolean).join(' ').toLowerCase();

  // Score each archetype
  const scored = archetypes.map(arch => {
    let score = 0;
    const reasons = [];

    // ── Stage match (strong signal) ──
    if (arch.profile.stages.includes(normalizedStage)) {
      score += 30;
      reasons.push('stage');
    } else {
      // Adjacent stage still gets partial credit
      const stageOrder = ['pre_seed_idea', 'seed_startup', 'early_scale', 'expansion_enterprise'];
      const userIdx = stageOrder.indexOf(normalizedStage);
      const archIdxs = arch.profile.stages.map(s => stageOrder.indexOf(s));
      if (archIdxs.some(i => Math.abs(i - userIdx) === 1)) {
        score += 10;
        reasons.push('adjacent_stage');
      }
    }

    // ── MRR range match ──
    if (mrr !== null && arch.profile.mrrRange) {
      const { min, max } = arch.profile.mrrRange;
      if (mrr >= min && mrr <= max) {
        score += 20;
        reasons.push('mrr_range');
      } else if (mrr >= min * 0.5 && mrr <= max * 1.5) {
        score += 8;
        reasons.push('mrr_adjacent');
      }
    }

    // ── Team size match ──
    if (teamSize !== null && arch.profile.teamSize) {
      const { min, max } = arch.profile.teamSize;
      if (teamSize >= min && teamSize <= max) {
        score += 15;
        reasons.push('team_size');
      } else if (teamSize >= min * 0.5 && teamSize <= max * 2) {
        score += 5;
        reasons.push('team_size_adjacent');
      }
    }

    // ── Constraint pattern matching (strongest signal) ──
    const constraintKeywords = {
      founder_dependency: ['founder', 'founder-led', 'i close', 'i sell', 'only i', 'depend on me', 'key person'],
      capacity_ceiling: ['capacity', 'bandwidth', 'too busy', 'overloaded', 'can\'t take more', 'maxed out'],
      no_sales_process: ['no process', 'no playbook', 'ad hoc', 'informal', 'no documentation', 'gut feel'],
      high_churn: ['churn', 'losing customers', 'cancellation', 'retention', 'leaving', 'churned'],
      acquisition_over_retention: ['acquisition', 'new customers', 'growth over retention'],
      weak_onboarding: ['onboarding', 'activation', 'time to value', 'drop off', 'first month'],
      scaling_before_pmf: ['premature', 'too early', 'not ready', 'product market fit', 'pmf'],
      high_cac: ['cac', 'acquisition cost', 'expensive', 'cost per lead', 'cost per customer'],
      low_win_rate: ['win rate', 'conversion', 'close rate', 'losing deals'],
      no_pipeline_visibility: ['no crm', 'no pipeline', 'spreadsheet', 'head', 'gut', 'don\'t know how many'],
      no_crm_discipline: ['crm', 'not updated', 'empty crm', 'nobody uses'],
      underpricing: ['pricing', 'too cheap', 'underpric', 'charge more', 'value based'],
      too_many_channels: ['too many channels', 'everywhere', 'spread thin', 'scattered'],
      plg_conversion_gap: ['free', 'freemium', 'trial', 'self-serve', 'conversion', 'sign up'],
      delivery_over_sales: ['delivery', 'fulfillment', 'service', 'billable', 'client work'],
      long_sales_cycle: ['long cycle', 'slow', 'takes forever', 'months to close', 'enterprise cycle'],
      single_ae_dependency: ['one ae', 'single rep', 'one person selling', 'solo'],
      no_expansion_motion: ['expansion', 'upsell', 'nrr', 'no upsell', 'flat revenue', 'no growth'],
      outbound_only_dependency: ['outbound only', 'no inbound', 'cold only', 'all outbound'],
      tool_sprawl: ['too many tools', 'disconnected', 'silos', 'manual reporting', 'fragmented'],
      burn_rate_mismatch: ['burn', 'runway', 'cash', 'spending', 'overhired'],
      strategic_drift: ['too many priorities', 'can\'t focus', 'everything', 'shifting priorities', 'post-funding'],
      single_gtm_motion: ['same process', 'one size', 'no segmentation', 'all customers same'],
      undefined_icp: ['icp', 'ideal customer', 'anyone', 'everyone', 'no target', 'broad'],
      no_unit_economics: ['unit economics', 'don\'t know cac', 'don\'t know ltv', 'no metrics']
    };

    const constraintTypes = [
      arch.constraintPattern.primary,
      arch.constraintPattern.secondary,
      arch.constraintPattern.tertiary
    ];

    for (const cType of constraintTypes) {
      const keywords = constraintKeywords[cType] || [];
      const matchCount = keywords.filter(kw => allText.includes(kw)).length;
      if (matchCount > 0) {
        const weight = cType === arch.constraintPattern.primary ? 25 : 12;
        score += Math.min(weight, matchCount * (weight / 2));
        reasons.push(cType);
      }
    }

    // ── GTM motion match ──
    if (p.salesMotion) {
      const userMotion = p.salesMotion.toLowerCase();
      const motionMatch = arch.profile.gtmMotion.some(m =>
        userMotion.includes(m) || (m === 'founder-led' && userMotion.includes('founder'))
      ) || arch.profile.salesMotion.some(m =>
        userMotion.includes(m) || (m === 'founder-led' && userMotion.includes('founder'))
      );
      if (motionMatch) {
        score += 10;
        reasons.push('gtm_motion');
      }
    }

    // ── Industry/vertical match ──
    if (p.industry) {
      const userIndustry = p.industry.toLowerCase();
      const verticalMatch = arch.profile.verticals.some(v => {
        const vNorm = v.replace(/_/g, ' ');
        return userIndustry.includes(vNorm) || vNorm.includes('b2b_saas') && userIndustry.includes('saas');
      });
      if (verticalMatch) {
        score += 5;
        reasons.push('vertical');
      }
    }

    return { archetype: arch, score, reasons };
  });

  // Sort by score descending, take top 3
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter(s => s.score >= 30).slice(0, 3);

  if (top.length === 0) {
    return {
      matches: [],
      block: '\n═══════════════════════════════════════════\n📊 COHORT PATTERN MATCHES\n═══════════════════════════════════════════\nNo strong archetype matches found for this profile. Use general stage benchmarks for recommendations.\n'
    };
  }

  // Build prompt block
  let block = '\n═══════════════════════════════════════════\n📊 COHORT PATTERN MATCHES (use in recommendations)\n═══════════════════════════════════════════\n';
  block += `Matched ${top.length} archetype(s) from a library of ${archetypes.length} company patterns.\n\n`;

  top.forEach((match, i) => {
    const a = match.archetype;
    block += `PATTERN ${i + 1}: "${a.name}" (match score: ${match.score}, signals: ${match.reasons.join(', ')})\n`;
    block += `  Profile: ${a.profile.stages.join('/')} stage, ${a.profile.teamSize.min}-${a.profile.teamSize.max} people, €${a.profile.mrrRange.min.toLocaleString('de-DE')}-€${a.profile.mrrRange.max.toLocaleString('de-DE')} MRR, ${a.profile.gtmMotion.join('/')}\n`;
    block += `  Constraint Pattern: ${a.constraintPattern.description}\n`;
    block += `  Intervention Sequence:\n`;
    a.intervention.sequence.forEach(step => { block += `    → ${step}\n`; });
    block += `  Key Action: ${a.intervention.keyAction}\n`;
    block += `  90-Day Outcome: ${a.outcome.days90}\n`;
    block += `  6-Month Outcome: ${a.outcome.months6}\n`;
    block += `  Key Lesson: ${a.keyLesson}\n\n`;
  });

  block += `INSTRUCTION: For EACH strategic priority/recommendation, include a "Pattern Match" callout:\n`;
  block += `"📊 Pattern Match: We've observed this constraint pattern in similar companies ([describe matching profile]). [Key insight from archetype]. [Quantified outcome]."\n`;
  block += `Use the matched archetypes above to write these — pick the most relevant pattern for each recommendation.\n`;
  block += `DO NOT name the archetypes by their IDs. Describe them naturally: "similar companies at your stage" or "B2B SaaS companies with 5-10 people and founder-led sales."\n`;
  block += `The key lesson from each archetype should inform the recommendation — these are non-obvious insights the user cannot Google.\n`;

  return {
    matches: top.map(m => ({
      id: m.archetype.id,
      name: m.archetype.name,
      score: m.score,
      reasons: m.reasons,
      keyLesson: m.archetype.keyLesson
    })),
    block
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUYER PSYCHOLOGY PROFILING — classifies decision-making style from conversation
// ═══════════════════════════════════════════════════════════════════════════════

const BUYER_KEYWORDS = {
  operator: [
    'data', 'metrics', 'measure', 'track', 'percentage', 'ratio', 'formula',
    'unit economics', 'benchmark', 'kpi', 'dashboard', 'analytics', 'spreadsheet',
    'roi', 'model', 'calculate', 'quantify', 'numbers', 'process', 'documented',
    'systematic', 'framework', 'methodology', 'structured', 'audit', 'funnel',
    'cohort', 'margin', 'conversion rate', 'payback',
    // Italian
    'dati', 'metriche', 'misurare', 'percentuale', 'rapporto', 'calcolare',
    'processo', 'documentato', 'strutturato', 'numeri', 'margine', 'modello'
  ],
  visionary: [
    'vision', 'strategy', 'transform', 'disrupt', 'market', 'opportunity',
    'potential', 'scale', 'long-term', 'big picture', 'narrative', 'story',
    'imagine', 'future', 'industry', 'revolution', 'movement', 'category',
    'position', 'brand', 'ecosystem', 'platform', 'moat', 'flywheel',
    'network effect', 'paradigm', 'thesis', 'landscape',
    // Italian
    'visione', 'strategia', 'trasformare', 'opportunità', 'potenziale',
    'lungo termine', 'futuro', 'settore', 'ecosistema', 'mercato', 'posizionamento'
  ],
  pragmatist: [
    'quick', 'fast', 'now', 'immediately', 'this week', 'tomorrow', 'asap',
    'just', 'simple', 'shortcut', 'hack', 'skip', 'prioritize', 'focus',
    'action', 'execute', 'ship', 'launch', 'move', 'next step',
    'practical', 'concrete', 'specific', 'what exactly', 'how exactly',
    'bottom line', 'get it done', 'start',
    // Italian
    'subito', 'veloce', 'adesso', 'questa settimana', 'domani', 'semplice',
    'pratico', 'concreto', 'specifico', 'azione', 'priorità', 'focus', 'lanciare'
  ],
  validator: [
    'others', 'competitors', 'industry standard', 'best practice', 'benchmark',
    'careful', 'safe', 'proven', 'validate', 'consensus',
    'align', 'stakeholder', 'board', 'investors', 'comparable', 'case study',
    'evidence', 'track record', 'reference', 'similar companies', 'what do you see',
    'what have you seen', 'other companies', 'typical', 'normal',
    // Italian
    'altri', 'concorrenti', 'standard', 'rischio', 'sicuro', 'validare',
    'team', 'consenso', 'investitori', 'aziende simili', 'cosa vedete', 'provato'
  ]
};

const BLAME_EXTERNAL = [
  'market', 'economy', 'competition', 'competitor', 'timing', 'luck',
  'team can\'t', 'they don\'t', 'customers don\'t', 'hard to find', 'nobody wants',
  'saturated', 'crowded', 'noisy',
  'mercato', 'economia', 'concorrenza', 'il team non', 'i clienti non'
];
const BLAME_INTERNAL = [
  'our process', 'we should', 'i need to', 'we haven\'t', 'my fault',
  'we failed', 'we missed', 'our mistake', 'we didn\'t', 'i didn\'t',
  'we lack', 'our weakness', 'we dropped',
  'il nostro processo', 'dovremmo', 'devo', 'non abbiamo', 'il mio errore'
];

const TIME_SHORT = [
  'this week', 'this month', 'right now', 'immediately', 'next 30 days',
  'next week', 'today', 'by friday', 'monday',
  'questa settimana', 'questo mese', 'subito', 'prossimi 30 giorni', 'oggi'
];
const TIME_LONG = [
  'this year', 'next year', '12 months', 'long term', '3 years', '5 years',
  'in a year', 'annual', 'roadmap', 'over time', 'eventually',
  'quest\'anno', 'prossimo anno', '12 mesi', 'lungo termine', 'nel tempo'
];

const RISK_AVERSE = [
  'careful', 'risk', 'safe', 'conservative', 'worried', 'concerned',
  'cautious', 'stable', 'predictable', 'proven', 'afraid', 'uncertain',
  'attento', 'rischio', 'sicuro', 'preoccupato', 'stabile', 'provato'
];
const RISK_TOLERANT = [
  'move fast', 'aggressive', 'bold', 'bet', 'experiment', 'try',
  'test', 'iterate', 'fail fast', 'pivot', 'disrupt', 'break',
  'veloce', 'aggressivo', 'sperimentare', 'provare', 'testare'
];

const ADAPTATION_INSTRUCTIONS = {
  operator: `
ADAPTATION — THE OPERATOR (data-driven, process-focused buyer)
This buyer thinks in spreadsheets and systems. They want to see the math before they trust the narrative.

SEQUENCING ADJUSTMENTS:
1. Before/After Summary: LEAD with this. Make the numbers prominent and precise. Add a "Methodology" footnote explaining how each target was calculated.
2. Financial Impact Analysis boxes: Make these the ANCHOR of every finding section. Expand the formula explanations. Show your work.
3. Benchmark Scorecard: ELEVATE this section. Add percentile context. This buyer will spend 5 minutes on this table.
4. Strategic Narrative: COMPRESS to 60% of normal length. Remove analogies. Keep it factual and causal.
5. 90-Day Roadmap: EXPAND with specific KPI targets per week. Add "How to Measure" column. This buyer needs to see the measurement mechanism.
6. Operating Model Design: EXPAND. This buyer cares deeply about process design, decision flows, and systems architecture.
7. Quick Wins: Lead with estimated impact per action. Sort by ROI, not ease.
8. Cost of Inaction: Show the math explicitly with cumulative calculations.
9. Recommended Tools: EXPAND the workflow architecture section. Add integration details.
10. Scenario Modeling: EXPAND with detailed math. Show recovery formulas for each scenario. Add confidence intervals to MRR projections. The comparison table should include additional rows: payback period, resource cost per scenario, ROI per path.

TONE: Precise, analytical, evidence-first. Use "the data suggests" not "we believe". Cite sources aggressively. Minimize adjectives. Let numbers speak.`,

  visionary: `
ADAPTATION — THE VISIONARY (strategic, narrative-driven buyer)
This buyer thinks in market movements and competitive positioning. They want to see where this leads.

SEQUENCING ADJUSTMENTS:
1. Strategic Narrative: LEAD with this and EXPAND to 150% of normal length. Open with market context. Use analogies. Paint the transformation arc.
2. Market Context Illustration: ELEVATE and EXPAND. This buyer feeds on trends and positioning insights. Connect every trend to the company's specific opportunity.
3. Before/After Summary: Frame as "transformation narrative" not just a comparison table. Add a "Strategic Position Shift" row.
4. Cohort Pattern Matches: ELEVATE. This buyer loves hearing about other companies' journeys. Expand with more narrative detail.
5. Operating Model Design: Frame as "building the machine for scale". Focus on the TARGET model vision, less on current gaps.
6. Financial Impact: Present but COMPRESS the formulas. Lead with the headline number and the narrative of what it unlocks.
7. 90-Day Roadmap: Frame months as "chapters in a transformation story". Add a strategic outcome narrative after each month.
8. Quick Wins: Frame as "strategic signals" — early moves that signal the transformation to customers, team, and market.
9. Scenario Modeling: Frame as "three strategic futures." EXPAND narrative for each path — describe what the company looks like at Day 90 under each scenario. Compress the math. Lead with the transformation story for each path.

TONE: Visionary but grounded. Use market analogies. Frame problems as "strategic constraints" not failures. Inspire without losing credibility.`,

  pragmatist: `
ADAPTATION — THE PRAGMATIST (action-oriented, time-constrained buyer)
This buyer has 30 minutes to read this and wants to start executing tomorrow morning. Minimize theory, maximize action.

SEQUENCING ADJUSTMENTS:
1. Quick Wins: MOVE TO TOP (immediately after Before/After Summary). This buyer reads quick wins FIRST. Make them exceptional.
2. Before/After Summary: Make it punchy. Bold the numbers. If they stop here, they should know the 3 things to do.
3. Strategic Narrative: COMPRESS to 40% of normal length. Start with "Here is what is broken and what to do about it." No market context in this section.
4. 90-Day Roadmap: RESTRUCTURE as "Week 1 / Week 2 / Week 3..." for the first month. Every action is a clear verb: "Call", "Set up", "Build", "Hire". No strategic framing.
5. Diagnostic Findings: COMPRESS root cause analysis. Each finding: problem (1 sentence), impact (1 number), fix (1 action).
6. Recommended Tools: Lead with "Set up X by Friday" format. One tool per problem.
7. Operating Model Design: COMPRESS. Use "Stop / Start / Continue" format instead of full assessment table.
8. Cost of Inaction: COMPRESS to one paragraph with the headline number.
9. Financial Impact: Show the total only. Skip individual formula breakdowns.
10. Scenario Modeling: COMPRESS to the comparison table only plus a bold callout: "**Our recommendation: Path 2. Start with [specific first action] on Monday.**" Skip detailed assumptions for each path.

TONE: Direct, urgent, no-nonsense. Imperative mood: "Do this." Short sentences. Bullet points over paragraphs. Zero filler.`,

  validator: `
ADAPTATION — THE VALIDATOR (consensus-seeking, risk-averse buyer)
This buyer needs to convince others and manage risk. They want proof that this works elsewhere and a clear risk mitigation plan.

SEQUENCING ADJUSTMENTS:
1. Cohort Pattern Matches: ELEVATE and EXPAND. For every recommendation, the pattern match callout should be prominent. Add specifics: "Companies at your stage who made this change saw X% improvement."
2. Benchmark Scorecard: ELEVATE. This buyer uses benchmarks as social proof. Add context about sample sizes and sources.
3. Risk Mitigation: ELEVATE and EXPAND to 150% of normal length. Add "Rollback Plan" for each risk. Frame every recommendation with "Minimum Viable Experiment".
4. Strategic Narrative: Frame around "what the data tells us" and "what comparable companies have done". Remove speculative language.
5. Before/After Summary: Add a "Confidence Level" column (High/Medium/Low) for each 90-day target.
6. 90-Day Roadmap: Add a "Risk/Dependency" column. Month 1 emphasizes low-risk, high-evidence actions. Sequence safest to boldest.
7. Operating Model Design: Frame as "industry-standard operating model for your stage" — emphasize that this is what mature companies do.
8. Quick Wins: Lead with proven, low-risk actions. Add "Precedent" notes for each.
9. Financial Impact: Present conservatively. Use ranges instead of point estimates.
10. Scenario Modeling: EXPAND risk analysis for each scenario. Add "Precedent" notes from archetype data for each path. Frame Base Case as "the validated path — here is what similar companies did." Add rollback triggers: "If [metric] hasn't improved by Week 4, revert to Conservative path."

TONE: Reassuring, evidence-based, collaborative. Use "companies at your stage typically..." language. Frame recommendations as "validated approaches". Address objections preemptively.`
};

function classifyBuyerPsychology(transcript, profile, runningProfile) {
  const userMessages = (transcript || []).filter(t => t.role === 'user').map(t => t.text || '');
  const allUserText = userMessages.join(' ').toLowerCase();
  const wordCount = allUserText.split(/\s+/).filter(Boolean).length;
  const signals = [];

  let scores = { operator: 0, visionary: 0, pragmatist: 0, validator: 0 };

  // ── A. Response Length ──
  if (userMessages.length > 0) {
    const avgLen = userMessages.reduce((s, m) => s + m.split(/\s+/).filter(Boolean).length, 0) / userMessages.length;
    if (avgLen < 15) {
      scores.pragmatist += 15;
      signals.push(`Short avg response (${Math.round(avgLen)} words) → action-oriented`);
    } else if (avgLen > 40) {
      scores.operator += 10;
      scores.validator += 5;
      signals.push(`Long avg response (${Math.round(avgLen)} words) → detail-oriented`);
    }
  }

  // ── B. Numerical Density ──
  if (wordCount > 0) {
    const nums = (allUserText.match(/\d+[%€$kKmM]?|\b\d+[.,]\d+/g) || []).length;
    const density = nums / wordCount;
    if (density > 0.08) {
      scores.operator += 20;
      signals.push(`High number density (${(density * 100).toFixed(1)}%) → data-driven`);
    } else if (density > 0.04) {
      scores.operator += 8;
      scores.pragmatist += 5;
    } else if (wordCount > 50) {
      scores.visionary += 10;
      signals.push('Low number density → narrative-oriented');
    }
  }

  // ── C. Keyword Matching ──
  for (const [profile, keywords] of Object.entries(BUYER_KEYWORDS)) {
    let hits = 0;
    for (const kw of keywords) {
      const regex = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      const matches = allUserText.match(regex);
      if (matches) hits += matches.length;
    }
    if (hits > 0) {
      scores[profile] += hits * 3;
      if (hits >= 3) signals.push(`${hits} ${profile} keywords detected`);
    }
  }

  // ── D. Blame Attribution ──
  const extCount = BLAME_EXTERNAL.reduce((c, phrase) => c + (allUserText.includes(phrase.toLowerCase()) ? 1 : 0), 0);
  const intCount = BLAME_INTERNAL.reduce((c, phrase) => c + (allUserText.includes(phrase.toLowerCase()) ? 1 : 0), 0);
  if (extCount > intCount && extCount >= 2) {
    scores.visionary += 5;
    signals.push('External blame attribution → big-picture thinker');
  } else if (intCount > extCount && intCount >= 2) {
    scores.operator += 5;
    signals.push('Internal blame attribution → process-focused');
  }

  // ── E. Time Horizon ──
  const shortCount = TIME_SHORT.reduce((c, p) => c + (allUserText.includes(p.toLowerCase()) ? 1 : 0), 0);
  const longCount = TIME_LONG.reduce((c, p) => c + (allUserText.includes(p.toLowerCase()) ? 1 : 0), 0);
  if (shortCount > longCount && shortCount >= 2) {
    scores.pragmatist += 10;
    signals.push('Short time horizon → action-oriented');
  } else if (longCount > shortCount && longCount >= 2) {
    scores.visionary += 8;
    scores.operator += 3;
    signals.push('Long time horizon → strategic thinker');
  }

  // ── F. Risk Language ──
  const averse = RISK_AVERSE.reduce((c, w) => c + (allUserText.includes(w.toLowerCase()) ? 1 : 0), 0);
  const tolerant = RISK_TOLERANT.reduce((c, w) => c + (allUserText.includes(w.toLowerCase()) ? 1 : 0), 0);
  if (averse > tolerant && averse >= 2) {
    scores.validator += 12;
    signals.push('Risk-averse language → consensus-seeker');
  } else if (tolerant > averse && tolerant >= 2) {
    scores.pragmatist += 6;
    scores.visionary += 4;
    signals.push('Risk-tolerant language → bias to action');
  }

  // ── G. Question Style ──
  const askData = (allUserText.match(/how (much|many)|what(?:'s| is) the (number|percentage|rate|cost|average)/gi) || []).length;
  const askOpinion = (allUserText.match(/what do you (think|recommend|suggest)|what would you|in your (experience|opinion)/gi) || []).length;
  const askExamples = (allUserText.match(/example|case study|who else|other companies|similar|what have you seen/gi) || []).length;
  if (askData > 0) { scores.operator += askData * 5; signals.push(`Asks for data (${askData}x)`); }
  if (askOpinion > 0) { scores.visionary += askOpinion * 4; }
  if (askExamples > 0) { scores.validator += askExamples * 5; signals.push(`Asks for examples/precedent (${askExamples}x)`); }

  // ── H. Profile Field Signals ──
  const priority = (profile.userPriority || '').toLowerCase();
  const constraints = (profile.constraints || '').toLowerCase();
  if (/this week|immediately|asap|fast|subito|quick/.test(priority)) scores.pragmatist += 8;
  if (/long.?term|year|strategic|vision/.test(priority)) scores.visionary += 8;
  if (/risk|careful|safe|proven|rischio/.test(constraints)) scores.validator += 8;
  if (/data|process|systematic|measure/.test(priority)) scores.operator += 8;

  // ── Incorporate running profile (30% weight) ──
  if (runningProfile && runningProfile.scores) {
    const runMax = Math.max(...Object.values(runningProfile.scores), 1);
    const curMax = Math.max(...Object.values(scores), 1);
    for (const key of Object.keys(scores)) {
      const normalized = (runningProfile.scores[key] / runMax) * curMax * 0.3;
      scores[key] += Math.round(normalized);
    }
  }

  // ── Resolve ──
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][0];
  const secondary = sorted[1][0];
  const total = sorted.reduce((s, [, v]) => s + v, 0);
  const confidence = total > 0 ? Math.round(((sorted[0][1] - sorted[1][1]) / total) * 100) : 0;

  const labels = {
    operator: 'The Operator (data-driven, process-focused)',
    visionary: 'The Visionary (strategic, narrative-driven)',
    pragmatist: 'The Pragmatist (action-oriented, time-constrained)',
    validator: 'The Validator (consensus-seeking, risk-averse)'
  };

  // ── Build prompt block ──
  let block = `\n${'='.repeat(43)}\n`;
  block += `BUYER PSYCHOLOGY PROFILE\n`;
  block += `${'='.repeat(43)}\n`;
  block += `Primary: ${labels[primary]} (score: ${scores[primary]}, confidence: ${confidence}%)\n`;
  block += `Secondary: ${labels[secondary]} (score: ${scores[secondary]})\n`;
  if (signals.length > 0) block += `Signals: ${signals.join('; ')}\n`;
  block += '\n';

  if (confidence >= 20 && total >= 10) {
    block += ADAPTATION_INSTRUCTIONS[primary];
  } else {
    block += 'ADAPTATION: Insufficient conversational signal for confident profiling. Use default balanced presentation — give equal weight to all report sections. Do not skew emphasis in any direction.';
  }

  return { primary, secondary, scores, confidence, signals, block };
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
  lines.push('| Metric | Your Value | Stage Median | Good | Assessment | Visual | Source |');
  lines.push('|--------|-----------|-------------|------|------------|--------|--------|');

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
    const sourceDisplay = bmData.source || '—';

    lines.push(`| ${m.label} | ${userDisplay} | ${medDisplay} | ${goodDisplay} | ${assessment} | ${visual} | ${sourceDisplay} |`);
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
// FINANCIAL TRANSLATION ENGINE — converts findings into monthly revenue impact
// ═══════════════════════════════════════════════════════════════════════════════

function buildFinancialImpact(profile, stageData) {
  const num = (v) => {
    if (!v) return null;
    const s = String(v).replace(/[^0-9.,]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  const p = profile;
  const bm = stageData?.benchmarks || {};
  const impacts = [];
  let totalMonthly = 0;

  // Parse core financial metrics
  const mrr = num(p.revenue);
  const acv = num(p.avgDealSize);
  const teamSize = num(p.teamSize);
  const winRate = num(p.winRate);
  const churnRate = num(p.churnRate);
  const nrr = num(p.nrr);
  const salesCycle = num(p.salesCycle);

  // Derive ACV/12 for monthly deal value (if ACV looks annual, divide; if monthly, use as-is)
  // Heuristic: if avgDealSize > 12x MRR and MRR exists, it's likely annual
  const monthlyDealValue = acv
    ? (mrr && acv > mrr * 3 ? acv / 12 : acv)
    : (mrr && teamSize ? mrr / Math.max(teamSize, 1) : null);

  // Use stage medians as fallback for calculations
  const medianWinRate = bm.winRate?.median || 25;
  const medianChurn = bm.churnMonthly?.median || 3;
  const medianAcv = bm.avgDealSize?.median || 10000;

  // ── 1. DELIVERY CONSTRAINT (capacity ceiling) ──
  // If team is small and revenue exists, estimate capacity gap
  if (mrr && teamSize) {
    // Revenue per person — compare to stage benchmark
    const revPerPerson = mrr / teamSize;
    const benchmarkRevPerPerson = bm.revenuePerEmployee?.median
      ? bm.revenuePerEmployee.median / 12
      : null;

    if (benchmarkRevPerPerson && revPerPerson < benchmarkRevPerPerson * 0.7) {
      // Team is underperforming vs benchmark — but this could also be a capacity issue
      const potentialMrr = benchmarkRevPerPerson * teamSize;
      const gap = Math.round(potentialMrr - mrr);
      if (gap > 0) {
        impacts.push({
          type: 'delivery_constraint',
          label: 'Delivery / Capacity Constraint',
          formula: `(Team of ${teamSize} × €${Math.round(benchmarkRevPerPerson).toLocaleString('de-DE')}/person stage median) – Current MRR €${mrr.toLocaleString('de-DE')}`,
          monthlyImpact: gap,
          explanation: `At your stage, the median revenue per team member is ~€${Math.round(benchmarkRevPerPerson).toLocaleString('de-DE')}/mo. Your team of ${teamSize} could support ~€${Math.round(potentialMrr).toLocaleString('de-DE')}/mo in MRR, but you're at €${mrr.toLocaleString('de-DE')}/mo — a gap of €${gap.toLocaleString('de-DE')}/mo in unrealized capacity.`
        });
        totalMonthly += gap;
      }
    }
  }

  // ── 2. GTM CONSTRAINT (pipeline/win rate gap) ──
  // If win rate is below median, calculate lost revenue
  if (winRate !== null && mrr) {
    const effectiveWinRate = winRate / 100;
    const medianRate = medianWinRate / 100;

    if (effectiveWinRate < medianRate && acv) {
      // Estimate: with same pipeline but median win rate, how much more revenue?
      // Current deals won per month ≈ MRR / monthly deal value
      const currentDealsPerMonth = monthlyDealValue ? mrr / monthlyDealValue : null;
      if (currentDealsPerMonth && currentDealsPerMonth > 0) {
        // Pipeline = deals won / win rate
        const estimatedPipeline = currentDealsPerMonth / effectiveWinRate;
        const dealsAtMedian = estimatedPipeline * medianRate;
        const additionalDeals = dealsAtMedian - currentDealsPerMonth;
        const gap = Math.round(additionalDeals * (monthlyDealValue || medianAcv / 12));
        if (gap > 0) {
          impacts.push({
            type: 'gtm_constraint',
            label: 'GTM / Pipeline Constraint (Win Rate Gap)',
            formula: `Pipeline of ~${Math.round(estimatedPipeline)} opps/mo × (${medianWinRate}% median – ${winRate}% actual) × €${Math.round(monthlyDealValue || medianAcv / 12).toLocaleString('de-DE')}/deal`,
            monthlyImpact: gap,
            explanation: `Your win rate of ${winRate}% is below the ${stageData?.label || 'stage'} median of ${medianWinRate}%. Closing at the median rate on your existing pipeline would generate ~€${gap.toLocaleString('de-DE')}/mo in additional revenue.`
          });
          totalMonthly += gap;
        }
      }
    }
  }

  // ── 3. GTM CONSTRAINT (sales cycle drag) ──
  if (salesCycle !== null && mrr && bm.salesCycleDays?.median) {
    const medianCycle = bm.salesCycleDays.median;
    if (salesCycle > medianCycle * 1.3) {
      // Longer cycle = fewer deals closed per period
      const cycleRatio = medianCycle / salesCycle;
      const lostDealVelocity = mrr * (1 - cycleRatio);
      const gap = Math.round(lostDealVelocity);
      if (gap > 0) {
        impacts.push({
          type: 'gtm_constraint',
          label: 'GTM Constraint (Sales Cycle Drag)',
          formula: `Current MRR €${mrr.toLocaleString('de-DE')} × (1 – ${medianCycle}d median / ${salesCycle}d actual cycle)`,
          monthlyImpact: gap,
          explanation: `Your sales cycle of ${salesCycle} days is ${Math.round((salesCycle / medianCycle - 1) * 100)}% longer than the ${stageData?.label || 'stage'} median of ${medianCycle} days. Faster cycles at the same pipeline would unlock ~€${gap.toLocaleString('de-DE')}/mo in accelerated revenue.`
        });
        totalMonthly += gap;
      }
    }
  }

  // ── 4. CHURN / VALUE CONSTRAINT ──
  if (churnRate !== null && mrr) {
    const monthlyChurnRevenue = Math.round(mrr * (churnRate / 100));
    const medianChurnRevenue = Math.round(mrr * (medianChurn / 100));

    if (churnRate > medianChurn) {
      const excessChurn = monthlyChurnRevenue - medianChurnRevenue;
      if (excessChurn > 0) {
        impacts.push({
          type: 'churn_constraint',
          label: 'Churn / Retention Constraint',
          formula: `MRR €${mrr.toLocaleString('de-DE')} × (${churnRate}% actual – ${medianChurn}% median churn)`,
          monthlyImpact: excessChurn,
          explanation: `At ${churnRate}% monthly churn, you're losing ~€${monthlyChurnRevenue.toLocaleString('de-DE')}/mo. Reducing to the ${stageData?.label || 'stage'} median of ${medianChurn}% would save €${excessChurn.toLocaleString('de-DE')}/mo — that's €${(excessChurn * 12).toLocaleString('de-DE')} per year in retained revenue.`
        });
        totalMonthly += excessChurn;
      }
    } else if (monthlyChurnRevenue > 0) {
      // Even at-median churn has a cost worth mentioning
      impacts.push({
        type: 'churn_constraint',
        label: 'Churn / Retention Cost (At Benchmark)',
        formula: `MRR €${mrr.toLocaleString('de-DE')} × ${churnRate}% monthly churn`,
        monthlyImpact: monthlyChurnRevenue,
        explanation: `Your churn rate of ${churnRate}% is near the ${stageData?.label || 'stage'} median, but still costs €${monthlyChurnRevenue.toLocaleString('de-DE')}/mo in lost revenue (€${(monthlyChurnRevenue * 12).toLocaleString('de-DE')}/yr).`
      });
      // Don't add at-median churn to total gap — it's not excess
    }
  }

  // ── 5. NRR EXPANSION GAP ──
  if (nrr !== null && mrr && bm.netRevenueRetention?.median) {
    const medianNrr = bm.netRevenueRetention.median;
    if (nrr < medianNrr) {
      const nrrGap = (medianNrr - nrr) / 100;
      const monthlyGap = Math.round(mrr * nrrGap);
      if (monthlyGap > 0) {
        impacts.push({
          type: 'expansion_constraint',
          label: 'Expansion Revenue Gap (NRR)',
          formula: `MRR €${mrr.toLocaleString('de-DE')} × (${medianNrr}% median NRR – ${nrr}% actual NRR)`,
          monthlyImpact: monthlyGap,
          explanation: `Your NRR of ${nrr}% falls below the ${stageData?.label || 'stage'} median of ${medianNrr}%. Reaching the median would mean €${monthlyGap.toLocaleString('de-DE')}/mo in additional expansion revenue.`
        });
        totalMonthly += monthlyGap;
      }
    }
  }

  // Build the output block for the prompt
  if (impacts.length === 0 && mrr) {
    return {
      block: '\n═══════════════════════════════════════════\n💰 FINANCIAL IMPACT ANALYSIS\n═══════════════════════════════════════════\nInsufficient data to compute precise financial impact. Use available metrics to estimate revenue impact qualitatively in each finding section.\n',
      impacts: [],
      totalMonthly: 0,
      totalAnnual: 0
    };
  }

  if (impacts.length === 0) {
    return {
      block: '\n═══════════════════════════════════════════\n💰 FINANCIAL IMPACT ANALYSIS\n═══════════════════════════════════════════\nCore financial metrics (MRR) not disclosed. Prompt the report to estimate conservatively based on stage medians.\n',
      impacts: [],
      totalMonthly: 0,
      totalAnnual: 0
    };
  }

  let block = '\n═══════════════════════════════════════════\n💰 FINANCIAL IMPACT ANALYSIS (pre-computed — embed in report)\n═══════════════════════════════════════════\n';
  block += `Total Estimated Cost of Identified Constraints: €${totalMonthly.toLocaleString('de-DE')}/month (€${(totalMonthly * 12).toLocaleString('de-DE')}/year)\n\n`;

  impacts.forEach((imp, i) => {
    block += `IMPACT ${i + 1}: ${imp.label}\n`;
    block += `  Formula: ${imp.formula}\n`;
    block += `  Monthly Impact: €${imp.monthlyImpact.toLocaleString('de-DE')}/month (€${(imp.monthlyImpact * 12).toLocaleString('de-DE')}/year)\n`;
    block += `  ${imp.explanation}\n\n`;
  });

  block += `INSTRUCTION: For EACH diagnostic finding (F1, F2, F3), include a highlighted box at the end:\n`;
  block += `"💰 Estimated Monthly Impact: €X,XXX/month in unrealized revenue. Over 12 months, this constraint costs approximately €XX,XXX if unresolved."\n`;
  block += `Map each finding to the most relevant impact calculation above. If a finding maps to multiple impacts, sum them.\n`;
  block += `In the report SUMMARY, include the total: "Total estimated cost of identified constraints: €${totalMonthly.toLocaleString('de-DE')}/month (€${(totalMonthly * 12).toLocaleString('de-DE')}/year)."\n`;

  return { block, impacts, totalMonthly, totalAnnual: totalMonthly * 12 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO MODELING — 3 paths (conservative, base case, aggressive)
// ═══════════════════════════════════════════════════════════════════════════════

function buildScenarioModeling(profile, stageData, financialImpact, cohortMatch, feasibilityFlags) {
  const p = profile;
  const num = (v) => {
    if (!v) return null;
    const s = String(v).replace(/[^0-9.,]/g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  };

  const mrr = num(p.revenue);
  const teamSize = num(p.teamSize);
  const stageKey = stageData?.label || 'Startup';

  // ── Early exit: no MRR ──
  if (!mrr) {
    const isPreSeed = /pre.?seed|idea|concept|pre.?revenue/i.test(p.companyStage || p.stage || '');
    const qualBlock = isPreSeed
      ? `\n${'═'.repeat(43)}\n🎯 SCENARIO MODELING DATA\n${'═'.repeat(43)}\nPre-revenue stage. Scenarios should focus on:\n  1. Conservative: Validate with 3 design partners before building. Target: 1 paying pilot in 90 days.\n  2. Base Case: Build MVP in Month 1, onboard 2 design partners in Month 2, convert 1 to paid in Month 3.\n  3. Aggressive: Parallel build + sell. Target: 3 paid pilots in 90 days. Requires co-founder or contractor.\nINSTRUCTION: Write qualitative scenarios using milestones (design partners, pilots, first revenue) instead of MRR projections.\n`
      : `\n${'═'.repeat(43)}\n🎯 SCENARIO MODELING DATA\n${'═'.repeat(43)}\nRevenue not disclosed. Use qualitative scenario framing based on bottleneck resolution speed.\nINSTRUCTION: Write scenarios using qualitative milestones instead of MRR projections. Reference confirmed constraints and diagnosed problems.\n`;
    return { block: qualBlock, scenarios: null, decisionModel: null, constraintPriority: [] };
  }

  // ── Rank constraints by financial impact ──
  const rankedConstraints = [...(financialImpact.impacts || [])]
    .filter(i => i.monthlyImpact > 0)
    .sort((a, b) => b.monthlyImpact - a.monthlyImpact);

  const constraintLabels = {
    delivery_constraint: 'Delivery / Capacity',
    gtm_constraint: 'GTM / Pipeline',
    churn_constraint: 'Churn / Retention',
    expansion_constraint: 'Expansion Revenue'
  };

  // ── Compute recovery ranges ──
  let conservative = { low: 0.20, high: 0.30 };
  let baseCase     = { low: 0.50, high: 0.80 };
  let aggressive   = { low: 0.80, high: 1.20 };

  // Budget adjustments
  const budget = (p.budgetLevel || '').toLowerCase();
  if (/limited|minimal|tight|low|no budget/i.test(budget)) {
    conservative.low -= 0.05; conservative.high -= 0.05;
    baseCase.low -= 0.10; baseCase.high -= 0.10;
    aggressive.low -= 0.20; aggressive.high -= 0.20;
  } else if (/significant|growth|large|well.?funded/i.test(budget)) {
    conservative.low += 0.05; conservative.high += 0.05;
    baseCase.low += 0.05; baseCase.high += 0.05;
    aggressive.low += 0.10; aggressive.high += 0.10;
  }

  // Team size adjustments
  if (teamSize !== null) {
    if (teamSize <= 2) {
      aggressive.low -= 0.15; aggressive.high -= 0.15;
    } else if (teamSize <= 5) {
      aggressive.low -= 0.05; aggressive.high -= 0.05;
    } else if (teamSize > 10) {
      aggressive.low += 0.05; aggressive.high += 0.05;
    }
  }

  // Feasibility flag adjustments
  const flags = feasibilityFlags || [];
  for (const f of flags) {
    if (f.severity === 'high') {
      aggressive.low -= 0.10; aggressive.high -= 0.10;
      baseCase.low -= 0.05; baseCase.high -= 0.05;
    } else if (f.severity === 'medium') {
      aggressive.low -= 0.05; aggressive.high -= 0.05;
    }
  }

  // Clamp ranges
  const clamp = (v) => Math.max(0.05, Math.min(1.50, v));
  conservative = { low: clamp(conservative.low), high: clamp(conservative.high) };
  baseCase     = { low: clamp(baseCase.low), high: clamp(baseCase.high) };
  aggressive   = { low: clamp(aggressive.low), high: clamp(aggressive.high) };

  // ── Impact base for projections ──
  const totalImpact = financialImpact.totalMonthly || 0;
  const growthPct = num(p.growthTarget);
  const fallbackImpact = growthPct ? mrr * (Math.min(growthPct, 300) / 100) : mrr * 0.30;
  const impactBase = totalImpact > 0 ? totalImpact : fallbackImpact;

  // ── Success probabilities ──
  let probConservative = 80;
  let probBaseCase = 60;
  let probAggressive = 35;

  // Archetype calibration
  const matches = cohortMatch?.matches || [];
  if (matches.length > 0 && matches[0].score >= 50) {
    probConservative += 5;
    probBaseCase += 8;
    probAggressive += 5;
  } else if (matches.length > 0 && matches[0].score >= 30) {
    probConservative += 3;
    probBaseCase += 5;
    probAggressive += 3;
  }

  // Feasibility flag penalties
  for (const f of flags) {
    if (f.severity === 'high') {
      probAggressive -= 5;
      probBaseCase -= 3;
    } else if (f.severity === 'medium') {
      probAggressive -= 3;
    }
  }

  // Bootstrap without runway = riskier aggressive path
  const isBoot = /bootstrap|self.?funded|no funding/i.test(p.funding || '');
  if (isBoot && mrr < 10000) {
    probAggressive -= 5;
  }

  const clampProb = (v) => Math.max(15, Math.min(95, v));
  probConservative = clampProb(probConservative);
  probBaseCase = clampProb(probBaseCase);
  probAggressive = clampProb(probAggressive);

  // ── Build 3 scenarios ──
  const f1 = rankedConstraints[0] || null;
  const f2 = rankedConstraints[1] || null;
  const f1Label = f1 ? (constraintLabels[f1.type] || f1.label) : (p.mainBottleneck || 'primary constraint');
  const f2Label = f2 ? (constraintLabels[f2.type] || f2.label) : (p.secondaryBottleneck || 'secondary constraint');

  const salesMotion = p.salesMotion || 'founder-led';
  const fundingDesc = p.funding || 'not disclosed';
  const teamDesc = teamSize ? `team of ${teamSize}` : 'current team';

  const scenarios = [
    {
      name: 'Conservative',
      mrrCurrent: mrr,
      mrrGainLow: Math.round(impactBase * conservative.low),
      mrrGainHigh: Math.round(impactBase * conservative.high),
      mrrProjectedLow: Math.round(mrr + impactBase * conservative.low),
      mrrProjectedHigh: Math.round(mrr + impactBase * conservative.high),
      changePercentLow: Math.round((impactBase * conservative.low / mrr) * 100),
      changePercentHigh: Math.round((impactBase * conservative.high / mrr) * 100),
      riskLevel: 'Low',
      successProbability: probConservative,
      focus: `Fix ${f1Label} exclusively for 60 days before expanding`,
      assumptions: [
        `Focus 100% on ${f1Label} for first 60 days — no new GTM or channel experiments`,
        `No new hires; ${teamDesc} reallocates internally`,
        `Add 1 client from existing network or referrals only`,
        `${f2Label} addressed only in Month 3 after foundation is stable`,
        isBoot ? 'Bootstrapped — zero additional cash outlay beyond current operations' : `Budget: ${budget || 'current allocation'} — no increase`
      ],
      keyDependencies: [
        `${f1Label} can be resolved with current resources`,
        'Existing clients retained through transition period',
        `Referral pipeline generates at least 1 qualified opportunity`
      ]
    },
    {
      name: 'Base Case',
      mrrCurrent: mrr,
      mrrGainLow: Math.round(impactBase * baseCase.low),
      mrrGainHigh: Math.round(impactBase * baseCase.high),
      mrrProjectedLow: Math.round(mrr + impactBase * baseCase.low),
      mrrProjectedHigh: Math.round(mrr + impactBase * baseCase.high),
      changePercentLow: Math.round((impactBase * baseCase.low / mrr) * 100),
      changePercentHigh: Math.round((impactBase * baseCase.high / mrr) * 100),
      riskLevel: 'Moderate',
      successProbability: probBaseCase,
      focus: `Productize ${f1Label} fix in Month 1, launch ${f2Label} intervention in Month 2`,
      assumptions: [
        `${f1Label} stabilized/productized in Month 1 (Weeks 1-4)`,
        `${f2Label} intervention launched in Month 2 (Weeks 5-8)`,
        `Add 1-2 new clients via ${salesMotion} + one expanded channel`,
        teamSize && teamSize < 10 ? 'One tactical hire or part-time contractor for execution support' : 'Internal team reallocation with clear ownership changes',
        `${matches.length > 0 ? 'Follows intervention sequence validated by similar companies at this stage' : 'Sequential execution: each month builds on prior month\'s foundation'}`
      ],
      keyDependencies: [
        `${f1Label} fix shows measurable progress by Week 4`,
        `${teamDesc} has bandwidth for Month 2 channel expansion`,
        'No major client churn event during transition'
      ]
    },
    {
      name: 'Aggressive',
      mrrCurrent: mrr,
      mrrGainLow: Math.round(impactBase * aggressive.low),
      mrrGainHigh: Math.round(impactBase * aggressive.high),
      mrrProjectedLow: Math.round(mrr + impactBase * aggressive.low),
      mrrProjectedHigh: Math.round(mrr + impactBase * aggressive.high),
      changePercentLow: Math.round((impactBase * aggressive.low / mrr) * 100),
      changePercentHigh: Math.round((impactBase * aggressive.high / mrr) * 100),
      riskLevel: 'High',
      successProbability: probAggressive,
      focus: `Parallel execution: ${f1Label} + ${f2Label} simultaneously from Day 1`,
      assumptions: [
        `${f1Label} and ${f2Label} addressed in parallel from Week 1`,
        'Hire contractor or part-time ops support immediately',
        `Launch new GTM channel (${/outbound/i.test(salesMotion) ? 'add inbound/partner channel' : 'add outbound/partner channel'}) in Month 1`,
        `Target: ${growthPct ? growthPct + '% growth' : '2x pipeline'} in 90 days`,
        isBoot ? 'Requires reinvesting all revenue + potential bridge funding/credit line' : `Requires deploying capital: ${fundingDesc}`
      ],
      keyDependencies: [
        `Founder bandwidth for parallel workstreams (or co-founder/senior hire available)`,
        `${isBoot ? 'Cash runway sufficient for 90+ days at increased burn' : 'Capital available for accelerated hiring + tools'}`,
        `No quality degradation in delivery while scaling GTM`
      ]
    }
  ];

  // ── Decision model ──
  const probDelta = probBaseCase - probAggressive;
  const decisionModel = {
    sequentialPath: {
      action: `Fix ${f1Label} first (Month 1-2), then address ${f2Label} (Month 2-3)`,
      probability: probBaseCase,
      rationale: 'Sequential execution reduces risk and builds on a stabilized foundation'
    },
    parallelPath: {
      action: `Address ${f1Label} and ${f2Label} simultaneously from Month 1`,
      probability: probAggressive,
      rationale: 'Faster potential payoff but requires more resources and carries higher failure risk'
    },
    f1Label,
    f2Label,
    f1Impact: f1?.monthlyImpact || 0,
    f2Impact: f2?.monthlyImpact || 0,
    probabilityDelta: probDelta
  };

  // ── Build prompt block ──
  let block = `\n${'═'.repeat(43)}\n`;
  block += `🎯 SCENARIO MODELING DATA (pre-computed — use in Scenario Modeling section)\n`;
  block += `${'═'.repeat(43)}\n\n`;

  block += `Current MRR: €${mrr.toLocaleString('de-DE')}/mo\n`;
  block += `Total Addressable Financial Impact: €${(totalImpact > 0 ? totalImpact : 0).toLocaleString('de-DE')}/mo\n`;
  block += `Impact Base Used for Projections: €${Math.round(impactBase).toLocaleString('de-DE')}/mo${totalImpact === 0 ? ' (estimated — no constraint-level data)' : ''}\n`;

  if (rankedConstraints.length > 0) {
    block += `\nConstraint Priority Order (fix in this sequence):\n`;
    rankedConstraints.forEach((c, i) => {
      block += `  ${i + 1}. ${c.label}: €${c.monthlyImpact.toLocaleString('de-DE')}/mo impact\n`;
    });
  }

  block += '\n';
  scenarios.forEach(s => {
    block += `SCENARIO: ${s.name}${s.name === 'Base Case' ? ' (RECOMMENDED)' : ''}\n`;
    block += `  MRR Projection: €${s.mrrProjectedLow.toLocaleString('de-DE')} – €${s.mrrProjectedHigh.toLocaleString('de-DE')}/mo\n`;
    block += `  MRR Change: +${s.changePercentLow}% – +${s.changePercentHigh}%\n`;
    block += `  Risk Level: ${s.riskLevel}\n`;
    block += `  Success Probability: ~${s.successProbability}%\n`;
    block += `  Focus: ${s.focus}\n`;
    block += `  Assumptions:\n`;
    s.assumptions.forEach(a => { block += `    • ${a}\n`; });
    block += `  Key Dependencies:\n`;
    s.keyDependencies.forEach(d => { block += `    • ${d}\n`; });
    block += '\n';
  });

  block += `DECISION MODEL:\n`;
  block += `  Sequential Path (Base Case): ${decisionModel.sequentialPath.action}\n`;
  block += `    → Success probability: ~${decisionModel.sequentialPath.probability}%\n`;
  block += `  Parallel Path (Aggressive): ${decisionModel.parallelPath.action}\n`;
  block += `    → Success probability: ~${decisionModel.parallelPath.probability}%\n`;
  block += `  Key Insight: Fixing ${f1Label}${f1 ? ` (€${f1.monthlyImpact.toLocaleString('de-DE')}/mo)` : ''} before ${f2Label} increases overall success probability by ~${probDelta} percentage points.\n`;

  if (matches.length > 0) {
    block += '\nARCHETYPE CALIBRATION:\n';
    matches.slice(0, 2).forEach(m => {
      block += `  Pattern "${m.name}" (match score: ${m.score}): ${m.keyLesson}\n`;
    });
  }

  if (flags.length > 0) {
    block += '\nFEASIBILITY WARNINGS (affect Aggressive scenario most):\n';
    flags.forEach(f => {
      block += `  ⚠️ ${f.issue} [${f.severity}]: ${f.detail.slice(0, 150)}\n`;
    });
  }

  block += `\nINSTRUCTION: Write the Scenario Modeling section using EXACTLY these pre-computed values. All MRR projections, probabilities, and percentages must match the data above. Write assumptions in the company's specific context. For the decision model, use natural language like: "If you fix [X] before [Y], the probability of [positive outcome] is ~[Z]%." Do NOT invent different numbers.\n`;

  return {
    block,
    scenarios,
    decisionModel,
    constraintPriority: rankedConstraints.map(c => ({ type: c.type, label: c.label, monthlyImpact: c.monthlyImpact }))
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
// PRE-REPORT CONFIRMATION SCREEN — validates data accuracy before generation
// ═══════════════════════════════════════════════════════════════════════════════

export function buildConfirmationScreen(profile) {
  const criticalParams = [
    { label: 'Company', value: profile.companyName, field: 'companyName', editable: true },
    { label: 'Industry', value: profile.industry, field: 'industry', editable: true },
    { label: 'Stage', value: profile.companyStage || profile.stage, field: 'stage', editable: true },
    { label: 'Team Size', value: profile.teamSize, field: 'teamSize', editable: true,
      requiresExact: /\d+[-–]\d+/.test(profile.teamSize || '') },
    { label: 'Monthly Revenue', value: profile.revenue, field: 'revenue', editable: true,
      requiresExact: /range|approx|about|~/i.test((profile.revenue || '').toLowerCase()) },
    { label: 'Main Bottleneck', value: profile.mainBottleneck, field: 'mainBottleneck', editable: true },
    { label: 'Primary Goal', value: profile.userPriority, field: 'userPriority', editable: true },
  ];

  const needsClarification = criticalParams.filter(p => p.requiresExact);

  return { params: criticalParams, needsClarification };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIRECT QUOTE EXTRACTION — pull notable user statements for report personalization
// ═══════════════════════════════════════════════════════════════════════════════

function extractDirectQuotes(transcript) {
  if (!transcript || transcript.length === 0) return { quotes: [], block: '' };

  const userMessages = transcript
    .filter(t => t.role === 'user')
    .map(t => t.text)
    .filter(Boolean);

  if (userMessages.length === 0) return { quotes: [], block: '' };

  // Signal phrases that indicate emotionally or strategically significant statements
  const signalPatterns = [
    /(?:we(?:'re| are)\s+)(?:struggling|drowning|stuck|losing|wasting|spending too much|burning|behind)/i,
    /(?:our\s+(?:biggest|main|key|primary|major|real)\s+(?:problem|challenge|issue|bottleneck|pain|struggle))/i,
    /(?:can(?:'t| not)\s+(?:seem to|figure out|get|keep|scale|grow|close|hire|retain))/i,
    /(?:I(?:'m| am)\s+(?:worried|concerned|frustrated|tired of|afraid|scared))/i,
    /(?:we(?:'ve| have)\s+(?:tried|attempted|already|been doing|spent))/i,
    /(?:the (?:real|biggest|main) (?:reason|problem|issue) is)/i,
    /(?:what (?:keeps me up|I need|we need|would help))/i,
    /(?:nobody|no one|nothing|never|always|every time)/i,
    /(?:too (?:much|many|little|few|slow|expensive|complicated))/i,
    /(?:depends? (?:entirely|completely|totally) on (?:me|the founder|one person))/i,
  ];

  const quotes = [];

  for (const msg of userMessages) {
    // Split into sentences
    const sentences = msg.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 300);

    for (const sentence of sentences) {
      for (const pattern of signalPatterns) {
        if (pattern.test(sentence)) {
          // Avoid duplicates
          const lower = sentence.toLowerCase();
          if (!quotes.some(q => q.toLowerCase() === lower)) {
            quotes.push(sentence);
          }
          break; // one match per sentence is enough
        }
      }
    }
  }

  // Cap at 8 most notable quotes
  const selected = quotes.slice(0, 8);

  if (selected.length === 0) return { quotes: [], block: '' };

  const block = `\n═══════════════════════════════════════════
CUSTOMER DIRECT QUOTES (use these verbatim in the report)
═══════════════════════════════════════════
The following are exact statements from the user during the diagnostic conversation.
Weave these into the report to make it feel custom-built, not template-filled.
Format: 'As you described it, "[exact quote]." Our analysis confirms...'

${selected.map((q, i) => `Q${i + 1}: "${q}"`).join('\n')}

INSTRUCTION: Reference at least 3 of these quotes in the report — in the Strategic Narrative,
Diagnostic Findings, or Recommendations sections. Always use quotation marks and the
phrase "As you described it" or "In your words" to signal the quote is from the user.`;

  return { quotes: selected, block };
}

// ═══════════════════════════════════════════════════════════════════════════════
// QA CLEANUP — post-generation structural dedup and polish
// ═══════════════════════════════════════════════════════════════════════════════

function qaCleanup(md) {
  // 1. Remove duplicate headings: if the same heading text appears at the same
  //    or lower level consecutively (e.g., "# Title\n## Title"), collapse to one.
  const lines = md.split('\n');
  const cleaned = [];
  const seenHeadings = new Set();
  let prevHeadingText = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const headingText = headingMatch[2].trim().replace(/[*_`]/g, '');
      // Deduplicate: skip if this exact heading text just appeared (within last 3 lines)
      const normalizedText = headingText.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
      if (normalizedText === prevHeadingText && normalizedText.length > 0) {
        continue; // skip duplicate
      }
      prevHeadingText = normalizedText;
      cleaned.push(line);
    } else {
      if (line.trim() !== '') prevHeadingText = ''; // reset on non-empty non-heading
      cleaned.push(line);
    }
  }

  let result = cleaned.join('\n');

  // 2. Remove empty chart/placeholder sections (heading followed by nothing before next heading)
  result = result.replace(/^(#{1,4}\s+.+)\n+(?=#{1,4}\s)/gm, '$1\n\n');

  // 3. Collapse excessive blank lines (3+ → 2)
  result = result.replace(/\n{4,}/g, '\n\n\n');

  // 4. Strip the top-level title if duplicated by the HTML header
  //    (the report HTML header already shows "Strategic Growth Plan" + company name)
  result = result.replace(/^# Strategic Growth Plan\s*\n+(?:##\s+.+\|\s+.+\n+)?---\n*/i, '');

  return result.trim();
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

    // ── Financial Impact Analysis ──
    const financialImpact = buildFinancialImpact(p, stageData);
    const financialBlock = financialImpact.block;

    // ── Cohort Pattern Matching ──
    const cohortMatch = matchArchetypes(p, stageKey);
    const cohortBlock = cohortMatch.block;

    // ── Buyer Psychology Classification ──
    const buyerPsych = classifyBuyerPsychology(
      sessionData?.transcript || [],
      p,
      sessionData?.buyerProfile || null
    );
    const buyerBlock = buyerPsych.block;
    console.log(`[Report v12] Buyer: ${buyerPsych.primary} (${buyerPsych.confidence}% confidence)`);

    // ── Scenario Modeling ──
    const scenarioModeling = buildScenarioModeling(p, stageData, financialImpact, cohortMatch, feasibilityFlags);
    const scenarioBlock = scenarioModeling.block;
    console.log(`[Report v12] Scenarios: ${scenarioModeling.scenarios ? scenarioModeling.scenarios.length : 0} paths`);

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

    // ── Context Sufficiency Gate ──
    const MINIMUM_REQUIRED_FIELDS = [
      'companyName', 'industry', 'stage', 'revenue', 'mainBottleneck', 'teamSize'
    ];
    const missingCritical = MINIMUM_REQUIRED_FIELDS.filter(f => !has(p[f]));
    if (missingCritical.length > 2) {
      return res.status(400).json({
        error: 'insufficient_context',
        missing: missingCritical,
        message: `Report quality requires: ${missingCritical.join(', ')}`
      });
    }

    // ── Transcript ──
    let transcript = '(no conversation recorded)';
    if (sessionData?.transcript?.length > 0) {
      transcript = sessionData.transcript.map((t, i) => {
        const who = t.role === 'user' ? 'USER' : 'REVENUE ARCHITECT';
        return `[Turn ${Math.floor(i / 2) + 1}] ${who}:\n${t.text}`;
      }).join('\n\n---\n\n');
    }

    // ── Direct Quote Extraction ──
    const directQuotes = extractDirectQuotes(sessionData?.transcript || []);
    const quotesBlock = directQuotes.block;

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
${financialBlock}
${cohortBlock}
${buyerBlock}
${scenarioBlock}
${quotesBlock}

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
${sessionData?.scrapedSummary
  ? sessionData.scrapedSummary
  : stageKey === 'pre_seed_idea'
    ? '(Pre-seed stage — no website required. Focus diagnostic on idea validation, not optimization.)'
    : '(Website not provided — base analysis on conversation data only)'}

═══════════════════════════════════════════
REPORT STRUCTURE — v12 STRATEGIC NARRATIVE FORMAT
═══════════════════════════════════════════

# Strategic Growth Plan
## ${companyName} | ${today}

---

## Executive Summary

This is the ONE PAGE that gets forwarded to co-founders, investors, or board members. It must stand completely alone — someone reading ONLY this page should understand the full picture.

Write this section as a concise, high-impact executive brief:

**Total Financial Cost of Identified Constraints:** Open with the single headline number from the FINANCIAL IMPACT ANALYSIS: "€X,XXX/month (€XX,XXX/year) in unrealized revenue." This is the anchor.

**Three Key Findings (one sentence each):**
1. **F1 — [Finding Name]:** [One sentence describing the constraint and its measured impact]
2. **F2 — [Finding Name]:** [One sentence describing the constraint and its measured impact]
3. **F3 — [Finding Name]:** [One sentence describing the constraint and its measured impact]

**Recommended Sequence:** [One sentence summarizing the 90-day approach — e.g., "Fix [F1] in Month 1 to unlock [X], then launch [F2 intervention] in Month 2, scaling [F3] in Month 3."]

**Projected 90-Day Outcome:** [One sentence with the base-case scenario numbers — e.g., "MRR from €X to €Y (+Z%), with [primary constraint] resolved and [secondary metric] improved by N%."]

RULES for Executive Summary:
- Maximum 150 words total. Ruthlessly concise.
- Every number must come from pre-computed data (FINANCIAL IMPACT, SCENARIO MODELING).
- No filler, no methodology explanation, no disclaimers.
- Write for a time-poor executive who will spend 30 seconds on this page.
- Use bold formatting for the headline cost figure and the projected outcome.

---

## Before/After Transformation Summary

Create this compact 2-column comparison IMMEDIATELY — this is the first thing leadership will look at:

| Dimension | Today | In 90 Days |
|-----------|-------|------------|
| [Core metric 1 — e.g. MRR, Revenue] | [current confirmed value] | [target value + % improvement] |
| [Core metric 2 — e.g. Churn, CAC] | [current confirmed value] | [target value] |
| [Core metric 3 — e.g. Win Rate, Deal Size] | [current confirmed value] | [target value] |
| [Core metric 4 — e.g. Sales Cycle] | [current confirmed value] | [target value] |
| Biggest bottleneck | [current state from mainBottleneck] | [resolved state after 90-day plan] |
| **Cost of constraints** | **€X,XXX/month unrealized** | **Recovered through plan execution** |

Use ONLY confirmed data for "Today." Use 90-day targets from the roadmap for "In 90 Days."
If a metric is unknown, use the stage median and label it "(est. \${${stageData?.label || 'stage'}} median)".
For the "Cost of constraints" row, use the TOTAL from the FINANCIAL IMPACT ANALYSIS section above.

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

> 💰 **Estimated Monthly Impact: €X,XXX/month** in unrealized revenue. Over 12 months, this constraint costs approximately **€XX,XXX** if unresolved.

(Use the pre-computed FINANCIAL IMPACT ANALYSIS data above to fill in real numbers. Map each finding to the relevant constraint type. If no pre-computed data is available for this finding, estimate conservatively using confirmed metrics and label as estimate.)

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
- **resources_required:** [people needed (FTE or hours/week), tools (with monthly cost), budget range €X-Y]
- **success_metric:** One measurable KPI that proves this priority is working by end of its window
- **prerequisite_for:** What does completing this enable in Priority 2?
- Week-by-week plan with specific actions, deliverables, success metrics

> 📊 **Pattern Match:** We've observed this constraint pattern in similar companies ([matching profile description from COHORT PATTERN MATCHES above]). [Key insight]. [Quantified outcome from the archetype].

### Priority 2 — Weeks 4-8
- **parent_finding_id:** F[N]
- **the_obvious_play:** [standard approach]
- **the_creative_edge:** [the unconventional angle]
- **trade_off / negative_externality:** [specific tension]
- **resources_required:** [people needed (FTE or hours/week), tools (with monthly cost), budget range €X-Y]
- **success_metric:** One measurable KPI that proves this priority is working by end of its window
- **depends_on:** What from Priority 1 must be done first?
- **prerequisite_for:** What does this enable in Priority 3?

> 📊 **Pattern Match:** [Use the most relevant archetype for this priority. Describe the pattern naturally.]

### Priority 3 — Weeks 8-12
- **parent_finding_id:** F[N]
- **the_obvious_play:** [standard approach]
- **the_creative_edge:** [the unconventional angle]
- **trade_off / negative_externality:** [specific tension]
- **resources_required:** [people needed (FTE or hours/week), tools (with monthly cost), budget range €X-Y]
- **success_metric:** One measurable KPI that proves this priority is working by end of its window
- **depends_on:** What from Priority 2 must be done first?

> 📊 **Pattern Match:** [Use the most relevant archetype for this priority. Describe the pattern naturally.]

---

## Cost of Inaction (30/60/90 Days)

> 💰 **Total estimated cost of identified constraints: €X,XXX/month (€XX,XXX/year).**
> This single number represents the revenue your company leaves on the table every month these constraints remain unresolved.

(Use the TOTAL from the FINANCIAL IMPACT ANALYSIS above. This is the anchor for the entire section.)

Based on the diagnosed findings, calculate what staying in the current state costs:

- **30 days of inaction:** [specific consequence — e.g., "At current churn of X%, you lose ~€Y MRR this month"]
- **60 days of inaction:** [compounding effect — show how the damage accelerates]
- **90 days of inaction:** [critical threshold — where does this problem become irreversible or structurally harder to fix?]

Use ONLY confirmed metrics for calculations. If a metric is unknown, use the stage median benchmark and label clearly: "(est. based on ${stageData?.label || 'stage'} median)".
Be specific and data-grounded. This section creates legitimate urgency, not fear — anchor every claim in numbers.
Reference the per-finding financial impact boxes from the Diagnostic Findings section to build cumulative cost projections.

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

## Scenario Modeling — 3 Paths Forward

Present three scenarios for ${companyName}'s 90-day trajectory. Use the pre-computed SCENARIO MODELING DATA above for ALL numbers — do not invent different projections.

### Path 1: Conservative — Stabilize First
- **Approach:** Focus exclusively on fixing the highest-impact constraint before any expansion.
- **Assumptions:** [Use the Conservative scenario assumptions from the SCENARIO MODELING DATA. Write them in ${companyName}'s specific context.]
- **Decision Logic:** Write a clear conditional: "If you fix [F1 constraint] completely before addressing [F2 constraint], your probability of [retaining clients / hitting target / stabilizing] is ~[X]%."
- **90-Day Projected Outcome:**
  - MRR: €[current] → €[projected range from data] (+[X–Y]%)
  - Risk Level: [from data]
  - Key Dependencies: [from data — list 2-3]

### Path 2: Base Case (Recommended) — Sequenced Acceleration
- **Approach:** Fix the primary constraint in Month 1, launch the secondary intervention in Month 2, expand in Month 3.
- **Assumptions:** [Use Base Case assumptions from the SCENARIO MODELING DATA. Reference archetype patterns if available.]
- **Decision Logic:** "With [F1] stabilized by Week 6, launching [F2 intervention] has ~[X]% probability of reaching [target metric]."
- **Why Recommended:** Explain specifically why this path balances speed and risk for THIS company given their constraints, team size, and resources.
- **90-Day Projected Outcome:**
  - MRR: €[current] → €[projected range from data] (+[X–Y]%)
  - Risk Level: [from data]
  - Key Dependencies: [from data — list 2-3]

### Path 3: Aggressive — Parallel Execution
- **Approach:** Address all constraints simultaneously. Hire support. Launch new channels immediately.
- **Assumptions:** [Use Aggressive assumptions from the SCENARIO MODELING DATA. Be honest about resource requirements.]
- **Decision Logic:** "If you try to [scale F2] without first fixing [F1], historical patterns suggest a ~[X]% probability of a [negative outcome — e.g., churn event, delivery failure] that erases the new revenue."
- **90-Day Projected Outcome:**
  - MRR: €[current] → €[projected range from data] (+[X–Y]%)
  - Risk Level: [from data]
  - Key Dependencies: [from data — list 2-3]
  - **Warning:** [If feasibility flags exist, surface the specific contradictions that make this path risky]

### Scenario Comparison

| Dimension | Conservative | Base Case (Rec.) | Aggressive |
|-----------|-------------|------------------|------------|
| MRR Target | €[low]–€[high] | €[low]–€[high] | €[low]–€[high] |
| MRR Change | +[X–Y]% | +[X–Y]% | +[X–Y]% |
| Risk Level | [level] | [level] | [level] |
| Success Probability | ~[X]% | ~[X]% | ~[X]% |
| First Hire Needed | [No / Yes — when] | [Yes — role] | [Yes — roles] |
| Primary Focus | [F1 only] | [F1 → F2 sequential] | [F1 + F2 + F3 parallel] |

All numbers in this table MUST match the SCENARIO MODELING DATA block exactly. Frame the comparison around ${companyName}'s specific situation, not generic advice.

---

## Benchmark Scorecard — ${companyName} vs. ${stageData?.label || 'Stage'} Median

Embed the pre-computed BENCHMARK SCORECARD above as-is (it contains visual gauge indicators and full source citations).
Then ADD a brief narrative (3-5 sentences) interpreting the scorecard:
- Which metrics are strengths?
- Which are critical gaps?
- How do the gaps connect to the diagnosed findings (F1, F2, F3)?
- What does this pattern tell us about the company's stage-readiness?

IMPORTANT: The report includes a visual Performance Radar chart and Health Score bar chart rendered alongside this text (generated by the system from the same benchmark data). Reference these charts explicitly in your narrative: "As shown in the Performance Radar above..." or "The Health Score comparison illustrates..." This makes the visual and textual elements feel integrated, not separate.

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
13. Use NARROW BENCHMARK DATA from KBCM, Statista, Pavilion. Cite the FULL source including year and sample size for EVERY benchmark number. Format: "Stage Median: €80k (KBCM 2024 SaaS Survey, n=400, Seed cohort)." If a benchmark is a composite or estimate, say so explicitly: "(Panoramica estimate based on KBCM + OpenView data)."
14. BENCHMARK SCORECARD: Embed the pre-computed scorecard with visual gauges. Add narrative interpretation connecting gaps to findings.
15. OPERATING MODEL: Use confirmed operating model data to design a concrete target model. For gaps, flag them as assessment areas. Every OM recommendation must trace to a finding_id.
16. MARKET ILLUSTRATIONS: When citing market data (SaaS market size, AI adoption, RevOps trends), frame it as context that impacts the company's specific situation. Don't just cite — connect it to their 90-day plan.
17. For companies with disclosed metrics, generate a BENCHMARK POSITION narrative: "Your [metric] of [X] places you in the [top/bottom] [N]th percentile for ${stageData?.label || 'your'} stage companies (source: [benchmark])." Use this to validate urgency.
21. FINANCIAL IMPACT: Every diagnostic finding MUST end with a highlighted "💰 Estimated Monthly Impact" box showing the euro cost of that constraint per month and per year. Use the pre-computed FINANCIAL IMPACT ANALYSIS data. The Cost of Inaction section MUST open with the total figure. Think in euros — leadership reads euros, not severity emojis.
22. COHORT PATTERN MATCHING: Every strategic priority MUST end with a "📊 Pattern Match" callout using the COHORT PATTERN MATCHES data above. Describe matching companies naturally (e.g., "similar B2B SaaS companies with 5-10 people at seed stage") — do NOT use archetype IDs or quote them verbatim. Include the quantified outcome and key lesson. If no strong match exists for a priority, omit the pattern match for that one.
23. BUYER PSYCHOLOGY: Follow the BUYER PSYCHOLOGY PROFILE adaptation instructions EXACTLY. Do NOT mention the buyer profile classification to the user — it should be invisible. The report structure stays identical; only the emphasis, length, and sequencing of sections change. If adaptation says "COMPRESS" a section, cut it to 40-60% of default length. If it says "EXPAND", add 50% more detail and depth. If it says "ELEVATE", move the section earlier in its parent section and add extra interpretive detail.
24. SCENARIO MODELING: Use the pre-computed SCENARIO MODELING DATA for ALL numbers in the Scenario Modeling section. Do NOT generate different MRR projections, probabilities, or percentages — they must match the data block exactly. The comparison table must use the pre-computed values. Frame each scenario with company-specific context from the confirmed profile data. If scenario data says "qualitative only", write milestone-based scenarios without inventing revenue numbers.
25. DIRECT QUOTES: If CUSTOMER DIRECT QUOTES are provided above, weave at least 3 of them verbatim into the report. Use the format: 'As you described it, "[exact quote]."' Place them in the Strategic Narrative (The Hard Truth), Diagnostic Findings (Evidence), and Recommendations sections. This makes the report feel personally crafted, not template-generated.`;

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${geminiKey}`,
      {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 20000 }
        })
      }
    );

    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const data = await resp.json();
    let md = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!md) throw new Error('Empty report');
    md = md.replace(/^```(?:markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();

    // ── QA Pass: eliminate structural redundancy ──
    md = qaCleanup(md);

    return res.status(200).json({
      report: md,
      filename: `Growth_Plan_${companyName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`,
      pdf_base64: null,
      feasibility_flags: feasibilityFlags,
      stage: stageKey,
      chart_data: chartData,
      dashboard_data: dashboardData,
      financial_impact: {
        total_monthly: financialImpact.totalMonthly,
        total_annual: financialImpact.totalAnnual,
        constraints: financialImpact.impacts.map(i => ({
          type: i.type,
          label: i.label,
          monthly: i.monthlyImpact,
          annual: i.monthlyImpact * 12
        }))
      },
      cohort_matches: cohortMatch.matches,
      buyer_profile: {
        primary: buyerPsych.primary,
        secondary: buyerPsych.secondary,
        confidence: buyerPsych.confidence,
        signals: buyerPsych.signals
      },
      scenario_data: scenarioModeling.scenarios ? {
        scenarios: scenarioModeling.scenarios.map(s => ({
          name: s.name,
          mrrCurrent: s.mrrCurrent,
          mrrProjectedLow: s.mrrProjectedLow,
          mrrProjectedHigh: s.mrrProjectedHigh,
          changePercentLow: s.changePercentLow,
          changePercentHigh: s.changePercentHigh,
          riskLevel: s.riskLevel,
          successProbability: s.successProbability,
          focus: s.focus,
          assumptions: s.assumptions,
          keyDependencies: s.keyDependencies
        })),
        decisionModel: scenarioModeling.decisionModel,
        constraintPriority: scenarioModeling.constraintPriority
      } : null
    });

  } catch (e) {
    console.error('[Report v12]', e);
    return res.status(500).json({ error: e.message });
  }
}
