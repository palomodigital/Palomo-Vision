#!/usr/bin/env node
// Servidor do painel: serve o painel.html e mantém os dados atualizados sozinho.
//
//   CLICKUP_TOKEN=pk_xxx PAINEL_USER=palomo PAINEL_PASS=troque-esta-senha node servidor.mjs
//
// Variáveis:
//   CLICKUP_TOKEN   token pessoal do ClickUp (obrigatório)
//   PORT            porta (padrão 3000)
//   REFRESH_MIN     de quantos em quantos minutos puxar o ClickUp (padrão 5)
//   DAYS            janela de dados em dias (padrão 180)
//   PAINEL_USER / PAINEL_PASS   usuário e senha (HTTP Basic). Se omitidos, o painel fica ABERTO.
//
// O painel (painel.html) consulta /data.json a cada minuto e se atualiza sozinho.

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { extract, saveData } from './extrair-clickup.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const REFRESH_MIN = Number(process.env.REFRESH_MIN || 5);
const DAYS = Number(process.env.DAYS || 180);
const USER = process.env.PAINEL_USER, PASS = process.env.PAINEL_PASS;
const token = process.env.CLICKUP_TOKEN;
if (!token) { console.error('Defina CLICKUP_TOKEN.'); process.exit(1); }
if (!USER || !PASS) console.warn('⚠ PAINEL_USER/PAINEL_PASS não definidos: o painel está aberto para qualquer um que acessar a URL.');

let cache = null, lastError = null, lastOkAt = null, running = false;

async function refresh() {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    cache = await extract({ token, days: DAYS });
    lastOkAt = Date.now(); lastError = null;
    try { saveData(cache, join(here, 'data.json')); } catch {}
    console.log(`[${new Date().toISOString()}] atualizado em ${((Date.now() - t0) / 1000).toFixed(1)}s: ${cache.production.length} produção, ${cache.captacoes.length} captações, ${cache.stories.length} stories`);
  } catch (e) {
    lastError = e.message;
    console.error(`[${new Date().toISOString()}] falha ao atualizar: ${e.message}`);
  } finally { running = false; }
}

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
function authorized(req) {
  if (!USER || !PASS) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [u, ...p] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  return same(u, USER) && same(p.join(':'), PASS);
}

const server = http.createServer((req, res) => {
  try {
    if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Painel Palomo"' }); return res.end('Acesso restrito'); }
    let path;
    try { path = new URL(req.url, 'http://x').pathname; } catch { res.writeHead(400); return res.end('Pedido inválido'); }   // ex.: "//" derrubava o servidor
    if (path === '/data.json') {
      if (!cache) { res.writeHead(503, { 'Retry-After': '5', 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'carregando', lastError })); }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(cache));
    }
    if (path === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: !!cache && !lastError, lastOkAt, lastError, refreshMin: REFRESH_MIN }));
    }
    if (path === '/' || path === '/painel.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(join(here, 'painel.html')));
    }
    res.writeHead(404); res.end('Não encontrado');
  } catch (e) {
    console.error(`[${new Date().toISOString()}] erro ao atender ${req.url}: ${e.message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end('Erro interno');
  }
});

// sobe o servidor antes da primeira busca: se o ClickUp demorar, o painel mostra "carregando" em vez de ficar fora do ar
server.listen(PORT, () => console.log(`Painel em http://localhost:${PORT}  (atualiza a cada ${REFRESH_MIN} min)`));
refresh();
setInterval(refresh, REFRESH_MIN * 60_000);
