// Teste ponta a ponta: API ClickUp falsa (com paginação) -> extract() -> servidor.mjs -> /data.json
import http from 'node:http';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const now = Date.now(), D = 864e5;
const CLIENTES = [{id:'c0',name:'Dr. Gustavo',orderindex:0},{id:'c1',name:'Mercantil Avenida',orderindex:1}];
const EXT = [{id:'e0',label:'Luka',orderindex:0},{id:'e1',label:'Coutinho',orderindex:1}];
const f = {
  designer:(n)=>({name:'Designer',type:'users',value:[{username:n}]}),
  cliente:(i)=>({name:'Cliente',type:'drop_down',value:i,type_config:{options:CLIENTES}}),
  ext:(id)=>({name:'Editor Externo',type:'labels',value:[id],type_config:{options:EXT}}),
  fin:(ms)=>({name:'Data da Finalização',type:'date',value:String(ms)}),
};
const tasks = [];
for (let i = 0; i < 230; i++) tasks.push({ id:'t'+i, name:'[DG] peça '+i, url:'u', list:{id:'901311633960'}, status:{status:'agendado',type:'custom'}, tags:[{name:'feed carrossel'}], assignees:[{username:'Lara'}], custom_item_id:1026, date_created:now-9*D, date_updated:now-D,
  custom_fields:[i%3===0?f.ext('e0'):f.designer('Lailla Souza'), f.cliente(i%2), f.fin(now-(i%20)*D)] });
tasks.push({ id:'novo', name:'[ZZ] cliente novo sem cadastro', url:'u', list:{id:'901311633960'}, status:{status:'postado',type:'closed'}, tags:[], assignees:[], custom_item_id:1026, date_created:now-5*D, date_updated:now-D, custom_fields:[f.designer('Mateus'), f.fin(now-2*D)] });
tasks.push({ id:'cap', name:'Captação DG', url:'u', list:{id:'901311449594'}, status:{status:'concluído',type:'closed'}, tags:[{name:'captação'}], assignees:[{username:'Andres'}], due_date:now-3*D, date_created:now-9*D, date_updated:now-D, custom_fields:[] });

let calls = [], bulkCalls = [], histOff = false, pageSize = 100;
const api = http.createServer((req,res)=>{
  const u = new URL(req.url,'http://x'); calls.push(u.search);
  assert.equal(req.headers.authorization,'pk_test');
  if (u.pathname.endsWith('/task/bulk_time_in_status/task_ids')) {
    bulkCalls.push(u.searchParams.getAll('task_ids').length);
    if (histOff) { res.statusCode = 403; return res.end(JSON.stringify({err:'ClickApp desligado'})); }
    const out = {}; for (const id of u.searchParams.getAll('task_ids')) out[id] = { current_status:{status:'postado',total_time:{since:'1'}}, status_history:[{status:'aprovado',total_time:{since:String(now-2*D)}}] };
    res.setHeader('content-type','application/json'); return res.end(JSON.stringify(out));
  }
  const lists = u.searchParams.getAll('list_ids[]'); const page = +u.searchParams.get('page');
  const pool = tasks.filter(t=>lists.includes(t.list.id));
  const slice = pool.slice(page*pageSize,page*pageSize+pageSize);
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({tasks:slice,last_page:(page+1)*pageSize>=pool.length}));
}).listen(0);
await new Promise(r=>api.on('listening',r));
const base = `http://127.0.0.1:${api.address().port}`;
process.env.CLICKUP_API_BASE = base + '/api/v2';
const { extract } = await import('./extrair-clickup.mjs');
const data = await extract({ token:'pk_test', days:60 });
const byId = Object.fromEntries(data.production.map(p=>[p.id,p]));
assert.equal(data.production.length, 231, 'paginação: 3 páginas devem trazer tudo, sem duplicar');
assert.equal(byId.t0.owners[0],'Luka');            // labels (Editor Externo) resolvidos
assert.equal(byId.t1.owners[0],'Lailla Souza');
assert.equal(byId.t0.client,'Dr. Gustavo'); assert.equal(byId.t1.client,'Mercantil Avenida'); // drop_down por orderindex (0 incluso)
assert.equal(byId.novo.client,'Sem cliente');       // cliente novo sem cadastro NÃO é inventado
assert.equal(data.captacoes.length,1);
assert.equal(byId.novo.approvedFrom,'historico'); assert.equal(byId.novo.approvedMs,now-2*D);   // histórico em lote lido
assert.ok(bulkCalls.length>=3 && bulkCalls.every(n=>n<=100), 'histórico pedido em lotes de até 100: '+bulkCalls);
histOff = true; const logs=[];
const sem = await extract({ token:'pk_test', days:60, log:(m)=>logs.push(m) });
assert.equal(sem.production.length, 231, 'sem o ClickApp ligado a extração continua');
assert.ok(logs.some(l=>/Histórico de status indisponível/.test(l)), 'avisa que o histórico falhou');
histOff = false;
// a API real às vezes devolve página com 99 itens no meio (last_page:false): não pode parar ali
pageSize = 99;
const curta = await extract({ token:'pk_test', days:60 });
assert.equal(curta.production.length, 231, 'página com menos de 100 itens no meio não encerra a paginação');
pageSize = 100;
console.log('extract() ok —', data.production.length, 'itens;', calls.length, 'chamadas à API');

// servidor
const PORT = 3917;
const srv = spawn(process.execPath,['servidor.mjs'],{env:{...process.env,CLICKUP_TOKEN:'pk_test',PORT,PAINEL_USER:'u',PAINEL_PASS:'p:com:dois',REFRESH_MIN:'1',DAYS:'60'},stdio:['ignore','pipe','pipe']});
let out=''; srv.stdout.on('data',d=>out+=d); srv.stderr.on('data',d=>out+=d);
await new Promise(r=>{const t=setInterval(()=>{ if(out.includes('Painel em')){clearInterval(t);r();} },100);});
const get=(p,auth)=>fetch(`http://127.0.0.1:${PORT}${p}`,{headers:auth?{Authorization:'Basic '+Buffer.from('u:p:com:dois').toString('base64')}:{}});
assert.equal((await get('/data.json',false)).status,401);
// o servidor sobe antes da primeira busca: espera o 200 (antes disso responde 503 "carregando")
let code = 0; for (let i=0;i<100 && code!==200;i++){ code=(await get('/data.json',true)).status; if(code!==200) await new Promise(r=>setTimeout(r,100)); }
assert.equal(code,200);
// URL malformada não pode derrubar o servidor (antes: "GET //" encerrava o processo)
import net from 'node:net';
const raw = (line)=>new Promise((res)=>{ const c=net.connect(PORT,'127.0.0.1',()=>c.write(`GET ${line} HTTP/1.1\r\nHost: x\r\nAuthorization: Basic ${Buffer.from('u:p:com:dois').toString('base64')}\r\nConnection: close\r\n\r\n`)); let d=''; c.on('data',x=>d+=x); c.on('close',()=>res(d.split('\r\n')[0])); c.on('error',()=>res('erro')); });
assert.match(await raw('//'),/ 400 /); assert.match(await raw('/\\'),/ 400 /);
assert.equal((await get('/status',true)).status,200);   // continua vivo
const j = await (await get('/data.json',true)).json(); assert.equal(j.production.length,231);
const html = await (await get('/',true)).text(); assert.ok(html.includes('Olhos da Equipe'));
const st = await (await get('/status',true)).json(); assert.equal(st.ok,true);
console.log('servidor ok: 401 sem senha, 200 com senha, /status ok');
srv.kill(); api.close();
