#!/usr/bin/env node
// Extrator ClickUp -> data.json  (Palomo Digital · painel "Olhos da equipe")
//
// Uso:
//   CLICKUP_TOKEN=pk_xxx node extrair-clickup.mjs --days 90 --out data.json
//
// Token pessoal: ClickUp > Configurações > Apps > API Token.
// Roda no seu computador/servidor (não no navegador): o token nunca vai para o HTML.
//
// Regras descobertas no ClickUp da Palomo (workspace 9013629745):
//  - Cada post é UMA tarefa que muda de lista: Design / Edição de Vídeo -> Agendamentos & Publicações.
//    Por isso "entregas" não podem ser contadas só nas listas Design/Edição.
//  - O responsável (assignee) frequentemente é a social media; quem produziu está nos
//    campos Designer / Editor de Vídeo / Editor Externo.
//  - "Data da Finalização" marca quando a produção terminou -> é a data de ENTREGA.
//  - Captação = tarefa com tag "captação" na lista Agenda comercial (tipo Reunião).

import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

export const CONFIG = {
  TEAM_ID: '9013629745',
  LISTS: {
    '901311633948': 'Design',
    '901324583464': 'Edição de Vídeo',
    '901311633960': 'Agendamentos & Publicações',
  },
  PRODUCTION_LIST_IDS: ['901311633948', '901324583464'], // listas onde o trabalho está "em fila"
  STORY_LIST: '901325282790',
  PUBLISH_LIST: '901311633960',
  APPROVAL_STATUS: 'aprovado',               // o dia em que a tarefa entrou nele (ClickApp "Tempo total em Status") é a data da aprovação
  CRM_LIST: '901311632406',       // Comercial > CRM > Clientes Ativos: FONTE OFICIAL da lista de clientes   // Agendamentos & Publicações: conteúdo pronto -> agendado -> postado
  CAPTACAO_LIST: '901311449594',
  CAPTACAO_TAG: 'captação',
  // tipos de tarefa (custom_item_id) -> tipo
  KIND_BY_ITEM_ID: { 1026: 'Design', 1027: 'Vídeo' },
  FIELD: {
    designer: 'Designer',
    editor: 'Editor de Vídeo',
    external: 'Editor Externo',
    client: 'Cliente',
    finished: 'Data da Finalização',     // automação: preenchida quando o designer/editor move a peça de status
    approved: 'Data da Aprovação',       // opcional: se existir e estiver preenchida, vence o histórico de status
    published: 'Data da Publicação',   // preenchida quando a peça vai para "postado"
    social: 'Social Media',
    channels: 'Canais de Publicação',
    postUrl: 'URL 1',                   // link do post no Instagram etc.
  },
  // nomes diferentes para a mesma pessoa (campo "Editor Externo" x usuário do ClickUp)
  ALIASES: { Coutinho: 'Gabriel Coutinho' },
  // Quando o nome na tarefa não bate com o do CRM, mapeie aqui: 'nome na tarefa': 'nome no CRM'.
  // (variações de acento, maiúsculas e títulos Dr./Dra. já são tratadas sozinhas)
  CLIENT_ALIASES: {},
  // prefixo do título -> cliente (usado só quando a tarefa não tem cliente nenhum)
  CLIENT_PREFIX: {
    DG: 'Dr. Gustavo', DM: 'Dr. Macário', MA: 'Mercantil Avenida', RD: 'RD Xavier',
    UP: 'Unipeças', IM: 'Imagem +', 'I+': 'Imagem +', MK: 'Malhas Kid', FL: 'Fábio Lyra',
    VC: 'Vênus Clínica', ICC: 'Instituto Cérebro e Coluna', PD: 'Palomo Digital',
    Palomo: 'Palomo Digital', UT: 'Usina Temperare', VNP: 'Silvio Pinto', IF: 'Instituto Fiim',
  },
  // CRM > Clientes Ativos: campo (etiqueta numérica: 8, 10, 12, 16…) com os posts/mês do contrato
  CRM_POSTS_FIELD: 'Quantidade de Postagens',
  FORMAT_TAGS: [
    'feed carrossel', 'feed estático', 'reels', 'capa reels', 'story estático', 'story carrossel',
    'story vídeo', 'stories', 'capa de grupo', 'capa youtube', 'vídeo', 'curso digital',
    'design personalizado', 'panfleto', 'cartão de visita', 'outros',
  ],
};

// ---------- utilidades puras (testáveis sem rede) ----------
export const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\(.*?\)/g, ' ').replace(/\b(dr|dra|doutor|doutora)\b\.?/g, ' ').replace(/[^a-z0-9+]+/g, ' ').trim();

// Liga o nome que vem nas tarefas ao nome oficial no CRM (Clientes Ativos).
// Regras: igual sem acento/título; ou todas as palavras do nome da tarefa estão em UM único cliente do CRM
// (ex.: "Dr. Gustavo" -> "Dr. Gustavo Leocádio"). Sem correspondência: devolve o nome como veio.
export function makeMatcher(crmNames, aliases = {}) {
  const keys = crmNames.map((n) => ({ name: n, k: norm(n), t: new Set(norm(n).split(' ').filter(Boolean)) }));
  const al = Object.fromEntries(Object.entries(aliases).map(([a, b]) => [norm(a), b]));
  return (raw) => {
    const name = String(raw || '').trim(); if (!name) return name;
    const k = norm(name); if (al[k]) return al[k];
    const exact = keys.find((x) => x.k === k); if (exact) return exact.name;
    const rt = k.split(' ').filter(Boolean); if (!rt.length) return name;
    const cand = keys.filter((x) => rt.every((t) => x.t.has(t)));
    return cand.length === 1 ? cand[0].name : name;
  };
}
const strip = (s) => String(s || '').replace(/\(.*?\)/g, '').trim();
export function personName(raw, cfg = CONFIG) {
  const n = strip(raw).split(/\s+/).slice(0, 2).join(' ');
  return cfg.ALIASES[n] || n;
}

export function fieldValue(f) {
  if (!f) return null;
  const v = f.value;
  if (v === undefined || v === null || v === '') return null;
  const opts = Array.isArray(f.type_config?.options) ? f.type_config.options : [];
  switch (f.type) {
    case 'users': return Array.isArray(v) ? v.map((u) => u?.username || u?.email || String(u?.id ?? '')).filter(Boolean) : null;
    case 'labels': return Array.isArray(v) ? v.map((id) => opts.find((o) => o.id === id)?.label).filter(Boolean) : null;
    case 'drop_down': {
      if (v && typeof v === 'object') return v.name || v.label ? [v.name || v.label] : [];
      const o = opts.find((o) => o.id === v) || opts.find((o) => o.orderindex === v);
      return o ? [o.name || o.label] : [];
    }
    case 'date': return Number(v);
    default: return v;
  }
}

function getField(task, name) {
  return (Array.isArray(task.custom_fields) ? task.custom_fields : []).find((f) => f?.name === name);
}
const tagNames = (task) => (Array.isArray(task.tags) ? task.tags : []).map((t) => String(t?.name || ''));
const names = (task, fieldName, cfg) => {
  const v = fieldValue(getField(task, fieldName));
  return Array.isArray(v) ? v.map((n) => personName(n, cfg)) : [];
};
const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));

export function clientOf(task, cfg = CONFIG) {
  let raw = null;
  const c = fieldValue(getField(task, cfg.FIELD.client));
  if (Array.isArray(c) && c[0]) raw = String(c[0]).trim();
  else {
    // Sem cliente na tarefa: tenta o prefixo do título ([DG], [MA]…). Prefixo desconhecido NÃO é inventado.
    const m = String(task.name || '').match(/^\s*\[([^\]]+)\]/);
    if (m && cfg.CLIENT_PREFIX[m[1].trim()]) raw = cfg.CLIENT_PREFIX[m[1].trim()];
  }
  if (!raw) return 'Sem cliente';
  return cfg.matcher ? cfg.matcher(raw) : raw;   // nome oficial do CRM, quando existir
}

export function kindOf(task, cfg = CONFIG) {
  if (cfg.KIND_BY_ITEM_ID[task.custom_item_id]) return cfg.KIND_BY_ITEM_ID[task.custom_item_id];
  const tags = tagNames(task);
  if (tags.some((t) => /reels|v[ií]deo/.test(t))) return 'Vídeo';
  return 'Design';
}

export function formatOf(task, cfg = CONFIG) {
  const tags = tagNames(task).filter(Boolean);
  return tags.find((t) => cfg.FORMAT_TAGS.includes(t)) || tags[0] || 'sem tag';
}

export function toProduction(task, cfg = CONFIG) {
  const kind = kindOf(task, cfg);
  const designer = names(task, cfg.FIELD.designer, cfg);
  const editor = names(task, cfg.FIELD.editor, cfg);
  const external = names(task, cfg.FIELD.external, cfg);
  const primary = kind === 'Vídeo' ? editor : designer;
  const owners = primary.length ? primary : external;
  const finished = num(fieldValue(getField(task, cfg.FIELD.finished)));
  const closed = num(task.date_closed);
  // Aprovação do cliente. Melhor fonte: o campo "Data da Aprovação". Sem ele, estima pelo momento em que a tarefa
  // entrou num status "feito" (date_done) ou foi fechada. Peça que já está na lista Agendamentos & Publicações
  // foi aprovada por definição, mas sem o campo não há como saber quando.
  const stType = task.status?.type || '';
  const inPub = task.list?.id === cfg.PUBLISH_LIST;
  const aprField = num(fieldValue(getField(task, cfg.FIELD.approved)));
  const statusDone = !inPub && ['done', 'closed'].includes(stType);
  const aprStatus = statusDone ? (num(task.date_done) ?? closed) : null;
  // histórico de status (ClickApp "Tempo total em Status"): dia exato em que entrou em "aprovado"
  const aprHist = cfg.approvedAt instanceof Map ? num(cfg.approvedAt.get(task.id)) : null;
  const isApproved = inPub || statusDone || aprField !== null;
  const approvedMs = aprField ?? (isApproved ? aprHist : null) ?? aprStatus;
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    client: clientOf(task, cfg),
    kind,
    format: formatOf(task, cfg),
    list: cfg.LISTS[task.list?.id] || task.list?.name || '',
    status: task.status?.status || '',
    statusType: task.status?.type || '',
    owners,                                   // quem produziu (campos)
    externals: external,                      // colaboradores externos (campo Editor Externo), sempre, mesmo com Designer/Editor preenchido
    ownerSource: primary.length ? 'campo' : external.length ? 'externo' : 'nenhum',
    assignees: (Array.isArray(task.assignees) ? task.assignees : []).map((a) => personName(a?.username, cfg)),
    dueMs: num(task.due_date),
    deliveredMs: finished ?? closed,          // data de entrega
    deliveredFrom: finished ? 'finalizacao' : closed ? 'fechamento' : null,
    approved: isApproved,   // já passou pela aprovação do cliente?
    approvedMs,
    approvedFrom: aprField !== null ? 'campo' : (isApproved && aprHist) ? 'historico' : aprStatus ? (num(task.date_done) ? 'status' : 'fechamento') : null,
    createdMs: num(task.date_created),
    updatedMs: num(task.date_updated),
  };
}

// Publicação = tarefa na lista Agendamentos & Publicações.
//  planejada = prazo (due_date); realizada = campo Data da Publicação (preenchido ao postar), senão a última atualização.
export function toPublication(task, cfg = CONFIG) {
  const statusType = task.status?.type || '';
  const status = task.status?.status || '';
  const done = ['done', 'closed'].includes(statusType);
  const stage = done ? 'publicado' : /erro/i.test(status) ? 'erro' : /agendad/i.test(status) ? 'agendado' : 'pronto';
  const pubField = num(fieldValue(getField(task, cfg.FIELD.published)));
  const dueMs = num(task.due_date);
  const url = fieldValue(getField(task, cfg.FIELD.postUrl));
  const ch = fieldValue(getField(task, cfg.FIELD.channels));
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    client: clientOf(task, cfg),
    kind: kindOf(task, cfg),
    format: formatOf(task, cfg),
    channels: Array.isArray(ch) ? ch : [],
    status, statusType, stage,
    socialMedia: names(task, cfg.FIELD.social, cfg),
    assignees: (Array.isArray(task.assignees) ? task.assignees : []).map((a) => personName(a?.username, cfg)),
    plannedMs: dueMs ?? (stage === 'publicado' ? null : pubField),
    // Data da Publicação; sem ela, o momento em que a tarefa entrou em "postado" (date_done) ou foi fechada. date_updated só em último caso: muda a cada edição.
    publishedMs: done ? (pubField ?? num(task.date_done) ?? num(task.date_closed) ?? num(task.date_updated)) : null,
    postUrl: typeof url === 'string' && /^https?:\/\//i.test(url.trim()) ? url.trim() : null,
    updatedMs: num(task.date_updated),
  };
}

// Cliente = tarefa na lista Comercial > CRM > Clientes Ativos
export function toClient(task, cfg = CONFIG) {
  const one = (n) => { const v = fieldValue(getField(task, n)); return Array.isArray(v) ? (v[0] ?? null) : null; };
  const mgr = names(task, 'Gestor de Projetos', cfg);
  // etiquetas como "12" -> 12. Mais de uma marcada = ambíguo: vale a primeira (o painel não soma).
  const q = fieldValue(getField(task, cfg.CRM_POSTS_FIELD));
  const nums = (Array.isArray(q) ? q : []).map((x) => parseInt(String(x), 10)).filter((n) => n > 0);
  return {
    id: task.id,
    name: String(task.name || '').trim(),
    url: task.url,
    status: task.status?.status || '',
    statusType: task.status?.type || '',
    plan: one('Plano'), niche: one('Nicho'), origin: one('Origem'),
    postsPerMonth: nums[0] ?? null,
    managers: mgr.length ? mgr : (Array.isArray(task.assignees) ? task.assignees : []).map((a) => personName(a?.username, cfg)),
    sinceMs: num(task.date_created),
  };
}

export function toStory(task, cfg = CONFIG) {
  return {
    id: task.id,
    client: clientOf(task, cfg),
    dateMs: num(task.due_date),
    status: task.status?.status || '',
    statusType: task.status?.type || '',
    assignees: (Array.isArray(task.assignees) ? task.assignees : []).map((a) => personName(a?.username, cfg)),
  };
}

export function toCaptacao(task, cfg = CONFIG) {
  return {
    id: task.id,
    name: task.name,
    url: task.url,
    client: clientOf(task, cfg),
    status: task.status?.status || '',
    atMs: num(task.start_date) ?? num(task.due_date),
    closedMs: num(task.date_closed),
    assignees: (Array.isArray(task.assignees) ? task.assignees : []).map((a) => personName(a?.username, cfg)),
  };
}

export function isCaptacao(task, cfg = CONFIG) {
  const tags = tagNames(task).map((t) => t.toLowerCase());
  return tags.includes(cfg.CAPTACAO_TAG) || /capta[cç][aã]o/i.test(String(task.name || ''));
}

export function transform(tasks, { cutoffMs, nowMs = Date.now() }, cfg = CONFIG) {
  const byId = new Map();
  for (const t of tasks) byId.set(t.id, t); // sem duplicatas
  const clients = [...byId.values()].filter((t) => t.list?.id === cfg.CRM_LIST).map((t) => toClient(t, cfg));
  cfg = { ...cfg, matcher: makeMatcher(clients.map((c) => c.name), cfg.CLIENT_ALIASES) };
  const production = [], stories = [], captacoes = [], publications = [], skipped = [];
  for (const t of byId.values()) {
   try {
    const listId = t.list?.id;
    if (listId === cfg.STORY_LIST) {
      const s = toStory(t, cfg);
      if (s.dateMs && s.dateMs >= cutoffMs) stories.push(s);
    } else if (listId === cfg.CAPTACAO_LIST) {
      if (!isCaptacao(t, cfg)) continue;
      const c = toCaptacao(t, cfg);
      if (!c.atMs || c.atMs >= cutoffMs) captacoes.push(c);
    } else if (cfg.LISTS[listId]) {
      const p = toProduction(t, cfg);
      const open = !['done', 'closed'].includes(p.statusType);
      const inWindow = (p.deliveredMs && p.deliveredMs >= cutoffMs) || (p.approvedMs && p.approvedMs >= cutoffMs);
      const recent = num(t.date_updated) >= cutoffMs;
      const queueList = cfg.PRODUCTION_LIST_IDS.includes(listId);
      if (inWindow || (open && queueList) || (recent && !p.deliveredMs)) production.push(p);
      if (listId === cfg.PUBLISH_LIST) {
        const pub = toPublication(t, cfg);
        // publicadas: só as da janela; abertas (pronto/agendado/erro): sempre, para acusar atrasos
        if (pub.stage !== 'publicado' || (pub.publishedMs && pub.publishedMs >= cutoffMs)) publications.push(pub);
      }
    }
   } catch (e) {
    // uma tarefa com dado estranho não pode derrubar a extração inteira: fica de fora e o painel avisa
    skipped.push({ id: String(t?.id ?? '?'), name: String(t?.name ?? ''), why: String(e?.message ?? e).slice(0, 80) });
   }
  }
  return {
    generatedAt: new Date(nowMs).toISOString(),
    windowStartMs: cutoffMs,
    rules: {
      entrega: 'Data da Finalização (campo) ou, se vazia, data de fechamento da tarefa',
      aprovacao: 'dia em que a tarefa entrou no status “aprovado” (histórico do ClickUp); sem histórico, estimativa pelo status concluído',
      dono: 'Designer / Editor de Vídeo (campo); se vazio, Editor Externo; se vazio, responsável da tarefa',
      clientes: 'Comercial › CRM › Clientes Ativos (um cliente novo aparece assim que é criado lá)',
      captacao: 'Tarefas com tag "captação" na lista Agenda comercial; data = início/prazo',
      publicacao: 'Lista Agendamentos & Publicações: publicado = status postado/complete, data = campo Data da Publicação; no prazo = publicado até o dia do prazo',
    },
    production, stories, captacoes, publications, clients,
    skipped: skipped.slice(0, 50),
  };
}

// ---------- acesso à API (só roda via CLI) ----------
const BASE = process.env.CLICKUP_API_BASE || 'https://api.clickup.com/api/v2';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(token, path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else if (v !== undefined) url.searchParams.set(k, String(v));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: token } });
    if (res.status === 429) { await sleep(30000); continue; }
    if (!res.ok) throw new Error(`ClickUp ${res.status} em ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }
  throw new Error('ClickUp: limite de requisições (429) persistente');
}

async function fetchTasks(token, cfg, listIds, extra = {}) {
  const all = [];
  for (let page = 0; page < 500; page++) {   // limite de segurança: 500 páginas = 50 mil tarefas
    const r = await api(token, `/team/${cfg.TEAM_ID}/task`, {
      page, subtasks: true, include_closed: true, order_by: 'updated', reverse: true,
      'list_ids[]': listIds, ...extra,
    });
    all.push(...r.tasks);
    // só last_page encerra: a API devolve páginas com 99 itens no meio da listagem (visto em 23/11/2026)
    if (r.last_page === true || !r.tasks.length) break;
    await sleep(700);
  }
  return all;
}

// Histórico de status em lote (até 100 tarefas por chamada). Devolve Map id -> ms em que entrou em "aprovado".
// Tolerante: se o ClickApp estiver desligado ou a chamada falhar, devolve o que conseguiu e segue sem histórico.
export function approvalFromHistory(entry, cfg = CONFIG) {
  if (!entry || typeof entry !== 'object') return null;
  const want = norm(cfg.APPROVAL_STATUS);
  const rows = [entry.current_status, ...(Array.isArray(entry.status_history) ? entry.status_history : [])];
  for (const h of rows) {
    if (!h || norm(h.status) !== want) continue;
    const since = num(h.since ?? h.total_time?.since);
    if (since) return since;
  }
  return null;
}
async function fetchApprovalHistory(token, cfg, ids, log) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      const r = await api(token, '/task/bulk_time_in_status/task_ids', { task_ids: ids.slice(i, i + 100), custom_task_ids: undefined });
      for (const [id, entry] of Object.entries(r || {})) {
        const ms = approvalFromHistory(entry, cfg);
        if (ms) out.set(id, ms);
      }
    } catch (e) {
      log(`Histórico de status indisponível (${String(e.message).slice(0, 90)}). Ligue o ClickApp "Tempo total em Status". Seguindo com estimativa.`);
      return out;
    }
    await sleep(500);
  }
  return out;
}

export async function extract({ token, days = 180, cfg = CONFIG, log = () => {} }) {
  const nowMs = Date.now();
  const cutoffMs = nowMs - days * 864e5;
  log(`Buscando últimos ${days} dias…`);
  const recent = await fetchTasks(token, cfg, [...Object.keys(cfg.LISTS), cfg.STORY_LIST], { date_updated_gt: cutoffMs });
  const open = await fetchTasks(token, cfg, cfg.PRODUCTION_LIST_IDS, { include_closed: false });
  const meetings = await fetchTasks(token, cfg, [cfg.CAPTACAO_LIST]);
  const crm = await fetchTasks(token, cfg, [cfg.CRM_LIST]);
  const all = [...recent, ...open, ...meetings, ...crm];
  // histórico só para peças de produção/publicação já aprovadas (o resto ainda não passou por "aprovado")
  const ids = [...new Set(all.filter((t) => cfg.LISTS[t.list?.id] && (t.list.id === cfg.PUBLISH_LIST || ['done', 'closed'].includes(t.status?.type))).map((t) => t.id))];
  log(`Lendo histórico de status de ${ids.length} tarefas…`);
  const approvedAt = await fetchApprovalHistory(token, cfg, ids, log);
  return transform(all, { cutoffMs, nowMs }, { ...cfg, approvedAt });
}

export function saveData(data, out = 'data.json') {
  writeFileSync(out, JSON.stringify(data));
  // data.js permite abrir o painel.html com duplo clique (file://), onde o navegador bloqueia fetch()
  const jsOut = out.replace(/\.json$/i, '') + '.js';
  writeFileSync(jsOut, 'window.PALOMO_DATA = ' + JSON.stringify(data) + ';\n');
  return jsOut;
}

async function main() {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) { console.error('Defina CLICKUP_TOKEN (token pessoal do ClickUp).'); process.exit(1); }
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
  const out = arg('--out', 'data.json');
  const data = await extract({ token, days: Number(arg('--days', 180)), log: console.log });
  const jsOut = saveData(data, out);
  console.log(`OK: ${data.production.length} itens de produção, ${data.captacoes.length} captações, ${data.stories.length} stories -> ${out} e ${jsOut}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
