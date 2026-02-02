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
═══ PROFILO BUSINESS ═══
Azienda: ${p.companyName || '?'} | Website: ${p.website || '?'}
Settore: ${p.industry || '?'} | Modello: ${p.businessModel || '?'}
Stage: ${p.stage || '?'} | Revenue: ${p.revenue || '?'} | Team: ${p.teamSize || '?'} | Funding: ${p.funding || '?'}
ICP: ${p.icp || '?'} | Motion: ${p.salesMotion || '?'} | Canali: ${p.channels || '?'}
Deal size: ${p.avgDealSize || '?'} | Ciclo: ${p.salesCycle || '?'}
Processo vendita: ${p.salesProcess || '?'} | Chi chiude: ${p.whoCloses || '?'}
Bottleneck: ${p.bottleneck || '?'} | Churn: ${p.churnRate || '?'} | Tools: ${p.tools || '?'}
Problemi diagnosticati: ${(p.diagnosedProblems||[]).join(', ') || '?'}
Priorità utente: ${p.userPriority || '?'}
Contesto extra: ${p.additionalContext || 'nessuno'}

═══ DATI SCRAPING ═══
${session.scrapedData || 'Nessun dato'}

═══ DOMANDE GIÀ FATTE (NON RIPETERE) ═══
${session.questionsAsked.length > 0 ? session.questionsAsked.join('\n') : 'Nessuna ancora'}

═══ INSIGHT CHIAVE ═══
${session.insights.slice(-5).join('\n') || 'Nessuno'}

═══ FASE: ${session.currentPhase} | TURNO: ${session.turnCount} ═══`;
}

const PROMPTS = {
  welcome: `Sei il Revenue Architect. Hai appena analizzato il sito web dell'utente.

COMPITO: Crea un messaggio di benvenuto personalizzato.
1. Saluta e cita 3-4 elementi SPECIFICI dal sito (titoli, prezzi, feature)
2. Fai 2-3 assunzioni audaci sul loro business
3. Chiedi conferma: "Ho capito bene? Cosa devo correggere?"

Sii sicuro, specifico, come un consulente che ha fatto i compiti.`,

  company: `Sei nella fase COMPANY. Devi capire i fondamentali dell'azienda.

TEMI DA ESPLORARE (uno alla volta):
- Modello di business (SaaS, servizi, marketplace?)
- Stage e revenue (pre-revenue, early, growth?)
- Team (quanti? che ruoli?)
- Funding (bootstrap, funded?)

REGOLE:
- Non ripetere domande già fatte
- Una domanda per turno
- Includi un benchmark o esempio reale
- Le opzioni devono essere risposte specifiche alla tua domanda`,

  gtm: `Sei nella fase GTM. Devi capire la strategia go-to-market.

TEMI DA ESPLORARE:
- ICP: chi compra? che ruolo? che aziende?
- Sales motion: inbound, outbound, PLG?
- Canali: quali funzionano? quali no?
- Metriche: ACV, ciclo di vendita, CAC

REGOLE:
- Connetti alle info già raccolte sull'azienda
- Una domanda per turno
- Benchmark specifici per il loro settore`,

  sales: `Sei nella fase SALES. Devi capire il motore di vendita e trovare i bottleneck.

TEMI DA ESPLORARE:
- Processo di vendita attuale
- Chi chiude i deal? Founder o team?
- Dove si bloccano i deal?
- Win rate, obiezioni, churn

INSIGHTS DA CERCARE:
- "Founder-Led Sales Trap": se il founder chiude >60% dei deal, c'è un problema di scaling
- Processo non documentato = ogni nuovo sales riparte da zero
- Se non misurano, non possono migliorare

Sii provocatorio ma rispettoso.`,

  diagnosis: `Sei nella fase DIAGNOSIS. HAI ABBASTANZA INFORMAZIONI.

NON fare altre domande di discovery. PRESENTA LA TUA DIAGNOSI.

STRUTTURA:
1. "Ecco la mia diagnosi:"
2. TOP 3 problemi che bloccano il revenue, per ognuno:
   - Nome del problema
   - Causa radice
   - Impatto stimato
3. Ipotesi centrale in una frase
4. Chiedi: "Questa diagnosi risuona?"

Usa TUTTI i dati raccolti. Sii specifico, cita numeri reali.`,

  pre_finish: `Sei pronto a generare il report.

COMPITO: Presenta il riepilogo finale.
1. Snapshot dell'azienda (3 frasi)
2. I 3 problemi diagnosticati
3. Priorità suggerite
4. Preview del report: "Il tuo piano includerà: executive summary, diagnosi, roadmap 90 giorni, metriche, tools."
5. "Sei pronto a generare?"

OPZIONI OBBLIGATORIE:
- { "key": "generate_report", "label": "📥 Genera il Growth Plan" }
- { "key": "add_context", "label": "Aspetta, voglio aggiungere qualcosa" }`
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

LINGUA: Rispondi nella STESSA lingua dell'utente. Se scrive in italiano, rispondi in italiano. Se in inglese, in inglese.

INPUT UTENTE: "${userMessage}"

RISPONDI IN JSON:
{
  "message": "Il tuo messaggio (markdown). Minimo 3-4 frasi.",
  "options": [{"key": "chiave", "label": "Testo opzione"}, ...],
  "profile_updates": {"campo": "valore"},
  "question_asked": "breve descrizione della domanda fatta",
  "insight": "insight chiave da questo turno"
}`;

  const messages = [
    { role: 'user', parts: [{ text: fullPrompt }] },
    { role: 'model', parts: [{ text: 'OK, rispondo in JSON.' }] }
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
    if (!geminiKey) return res.status(200).json({ message: 'API key mancante', options: [] });

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
        message: '📥 Generazione in corso...', mode: 'buttons',
        options: [{ key: 'generating', label: '⏳ Generazione...' }],
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
      prompt = `L'utente vuole aggiungere contesto. Chiedi cosa vuole aggiungere o correggere. Sii accogliente. Quando ha finito, offri di generare il report con l'opzione generate_report.`;
    }

    // Call LLM
    const context = buildContext(session);
    let llm;
    try {
      llm = await callLLM(prompt, choice, context, history, geminiKey);
    } catch (e) {
      console.error('[LLM Error]', e.message);
      llm = {
        message: "Continuiamo l'analisi. Qual è la tua sfida principale?",
        options: [{ key: 'continue', label: 'Continua' }],
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
      options = [{ key: 'continue', label: 'Continua' }];
    }
    
    // Force generate option in pre_finish
    if (session.currentPhase === 'pre_finish' && !options.some(o => o.key === 'generate_report')) {
      options.unshift({ key: 'generate_report', label: '📥 Genera il Growth Plan' });
    }

    console.log(`[v10] Turn ${session.turnCount} | Phase: ${session.currentPhase}`);

    return res.status(200).json({
      message: llm.message || 'Continuiamo.',
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
      message: "Errore. Qual è la tua sfida principale?",
      options: [{ key: 'retry', label: 'Riprova' }],
      mode: 'mixed', allow_text: true
    });
  }
}
