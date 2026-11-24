import { transform, CONFIG, approvalFromHistory } from './extrair-clickup.mjs';
import assert from 'node:assert/strict';
const now = Date.parse('2026-11-18T12:00:00Z'), D = 864e5, cutoff = now - 30*D;
const opt = (id,label)=>({id,label,name:label});
const cf = (name,type,value,type_config)=>({name,type,value,type_config});
const mk = (o)=>({ id:o.id, name:o.name, url:'u', list:{id:o.list}, status:{status:o.status||'postado',type:o.st||'closed'}, tags:(o.tags||[]).map(n=>({name:n})), assignees:(o.as||[]).map(u=>({username:u})), custom_item_id:o.item??0, custom_fields:o.cf||[], due_date:o.due??null, date_closed:o.closed??null, date_done:o.done??null, date_created:now-10*D, date_updated:o.upd??now-D, start_date:o.start??null });
const designer = (n)=>cf('Designer','users',[{username:n}]);
const fin = (ms)=>cf('Data da Finalização','date',String(ms));
const cliente = (n)=>cf('Cliente','labels',['x'],{options:[{id:'x',label:n}]});
const tasks = [
  mk({id:'1',name:'[DG] Carrossel',list:'901311633960',item:1026,as:['Lara Silva'],cf:[designer('Lailla Souza'),fin(now-2*D),cliente('Dr. Gustavo')],tags:['feed carrossel']}),
  mk({id:'1',name:'[DG] Carrossel (duplicado)',list:'901311633948',item:1026}),            // mesma id -> dedup (vence o último)
  mk({id:'2',name:'[MA] Reels',list:'901311633960',item:1027,as:['Lara Silva'],cf:[cf('Editor de Vídeo','users',[{username:'Arthur'}]),fin(now-5*D)],tags:['reels']}),
  mk({id:'3',name:'[RD] Estático',list:'901311633960',item:1026,as:['Eloiza X'],cf:[cf('Editor Externo','drop_down',0,{options:[{orderindex:0,name:'Luka'}]}),fin(now-1*D)]}),
  mk({id:'4',name:'[IM] Antigo',list:'901311633960',item:1026,cf:[designer('Mateus'),fin(now-60*D)]}),   // fora da janela
  mk({id:'5',name:'[UP] Em fila',list:'901311633948',item:1026,status:'p/ aprovação do cliente',st:'custom',as:['Lara'],cf:[designer('Lailla')],due:now-3*D}),
  mk({id:'6',name:'[PD] Sem dono',list:'901311633960',item:1026,closed:now-4*D,as:['Lara']}),
  mk({id:'7',name:'Captação DM',list:'901311449594',tags:['captação'],as:['Andres'],due:now-6*D}),
  mk({id:'8',name:'Reunião qualquer',list:'901311449594',tags:['reunião'],due:now-6*D}),         // não é captação
  mk({id:'9',name:'[DG] story',list:'901325282790',status:'postado',as:['Eloiza'],due:now-1*D}),
];
const r = transform(tasks,{cutoffMs:cutoff,nowMs:now});
const P = Object.fromEntries(r.production.map(p=>[p.id,p]));
assert.equal(r.production.length, 5);                     // 1,2,3,5,6  (4 fora da janela; 1 deduplicado)
assert.equal(P['1'].name, '[DG] Carrossel (duplicado)');   // dedup por id
assert.deepEqual(P['2'].owners, ['Arthur']); assert.equal(P['2'].kind,'Vídeo');
assert.deepEqual(P['3'].owners, ['Luka']);  assert.equal(P['3'].ownerSource,'externo');
assert.equal(P['5'].deliveredMs, null);     assert.equal(P['5'].list,'Design');
assert.equal(P['6'].ownerSource,'nenhum');  assert.equal(P['6'].deliveredFrom,'fechamento');
assert.equal(P['6'].client,'Palomo Digital');            // cliente pelo prefixo do título
assert.equal(r.captacoes.length,1); assert.deepEqual(r.captacoes[0].assignees,['Andres']);
assert.equal(r.stories.length,1);
// caso do campo Designer preenchido junto com externo: designer tem prioridade
const t2 = transform([mk({id:'a',name:'[DG] x',list:'901311633948',item:1026,cf:[designer('Lailla Souza'),cf('Editor Externo','drop_down',0,{options:[{orderindex:0,name:'Luka'}]}),fin(now-D)]})],{cutoffMs:cutoff,nowMs:now});
assert.deepEqual(t2.production[0].owners,['Lailla Souza']);
console.log('transform: todos os testes passaram'); console.log(r.production.map(p=>`${p.id} ${p.kind} ${p.owners.join('+')||'-'} ${p.client}`).join('\n'));

// ---- publicações (formato real observado no ClickUp da Palomo) ----
const url = (v)=>cf('URL 1','url',v);
const pubd = (ms)=>cf('Data da Publicação','date',String(ms));
const canais = cf('Canais de Publicação','labels',['i'],{options:[{id:'i',label:'Instagram'}]});
const social = (n)=>cf('Social Media','users',[{username:n}]);
const pt = transform([
  mk({id:'p1',name:'[RD] Post 04',list:'901311633960',item:1026,status:'postado',st:'done',tags:['feed estático'],due:now-6*D,upd:now-1*D,cf:[pubd(now-1*D-60000),social('Lara Castro'),canais,url('https://instagram.com/p/x'),cliente('RD Xavier')]}),
  mk({id:'p2',name:'[MA] Post 08',list:'901311633960',item:1027,status:'agendado',st:'custom',tags:['reels'],due:now+2*D}),
  mk({id:'p3',name:'[DG] erro',list:'901311633960',item:1027,status:'erro na postagem',st:'custom',tags:['reels'],due:now-D}),
  mk({id:'p4',name:'[IM] pronto',list:'901311633960',item:1026,status:'conteúdo pronto',st:'open',due:now-3*D}),
  mk({id:'p5',name:'[IM] velho',list:'901311633960',item:1026,status:'postado',st:'done',due:now-90*D,upd:now-90*D}), // fora da janela
],{cutoffMs:cutoff,nowMs:now});
const Q = Object.fromEntries(pt.publications.map(p=>[p.id,p]));
assert.equal(pt.publications.length,4);
assert.equal(Q.p1.stage,'publicado'); assert.equal(Q.p1.publishedMs,now-D-60000); assert.equal(Q.p1.plannedMs,now-6*D);
assert.equal(Q.p1.postUrl,'https://instagram.com/p/x'); assert.deepEqual(Q.p1.channels,['Instagram']); assert.deepEqual(Q.p1.socialMedia,['Lara Castro']);
assert.equal(Q.p2.stage,'agendado'); assert.equal(Q.p3.stage,'erro'); assert.equal(Q.p4.stage,'pronto');
assert.equal(Q.p2.publishedMs,null);
console.log('publicações: testes passaram');

// ---- CRM como fonte oficial dos clientes ----
const crmTask = (id,name,status,st,extra=[])=>mk({id,name,list:'901311632406',status,st,cf:extra});
const ddown = (n,opts,idx)=>cf(n,'drop_down',idx,{options:opts.map((o,i)=>({id:'o'+i,name:o,orderindex:i}))});
const crmT = transform([
  crmTask('k1','Dr. Gustavo Leocádio','ativo','done',[ddown('Plano',['Domínio','Comando'],1), cf('Gestor de Projetos','users',[{username:'Wellison Favonny (Gestor)'}])]),
  crmTask('k2','Dr. Fabio Lyra','ativo','done',[cf('Quantidade de Postagens','labels',['q12'],{options:[{id:'q8',label:'8'},{id:'q12',label:'12'}]})]),
  crmTask('k3','Unipeças','em cancelamento','done'),
  crmTask('k4','Novo Cliente Ltda','novo cliente','open'),
  mk({id:'x1',name:'[DG] a',list:'901311633960',item:1026,cf:[designer('Lailla'),fin(now-D),ddown('Cliente',['Dr. Gustavo','Fábio Lyra','UniPeças','Mege'],0)]}),
  mk({id:'x2',name:'[FL] b',list:'901311633960',item:1026,cf:[designer('Lailla'),fin(now-D),ddown('Cliente',['Dr. Gustavo','Fábio Lyra','UniPeças','Mege'],1)]}),
  mk({id:'x3',name:'[UP] c',list:'901311633960',item:1026,cf:[designer('Lailla'),fin(now-D),ddown('Cliente',['Dr. Gustavo','Fábio Lyra','UniPeças','Mege'],2)]}),
  mk({id:'x4',name:'[ME] d',list:'901311633960',item:1026,cf:[designer('Lailla'),fin(now-D),ddown('Cliente',['Dr. Gustavo','Fábio Lyra','UniPeças','Mege'],3)]}),
  mk({id:'x5',name:'[DG] sem campo',list:'901311633960',item:1026,cf:[designer('Lailla'),fin(now-D)]}),  // prefixo DG -> "Dr. Gustavo" -> CRM
],{cutoffMs:cutoff,nowMs:now});
const K = Object.fromEntries(crmT.production.map(p=>[p.id,p.client]));
assert.equal(crmT.clients.length,4);
assert.equal(crmT.clients[1].postsPerMonth,12);   // etiqueta "12" -> número
assert.equal(crmT.clients[0].postsPerMonth,null);  // sem campo (tráfego) -> null
assert.equal(crmT.clients[0].plan,'Comando'); assert.deepEqual(crmT.clients[0].managers,['Wellison Favonny']);
assert.equal(K.x1,'Dr. Gustavo Leocádio');   // "Dr. Gustavo" -> nome oficial do CRM
assert.equal(K.x2,'Dr. Fabio Lyra');          // acento diferente
assert.equal(K.x3,'Unipeças');                // maiúscula diferente
assert.equal(K.x4,'Mege');                    // fora do CRM: mantém o nome (o painel acusa)
assert.equal(K.x5,'Dr. Gustavo Leocádio');
assert.ok(crmT.clients.some(c=>c.name==='Novo Cliente Ltda' && c.status==='novo cliente'));
assert.equal(crmT.production.length,5);        // as tarefas do CRM não viram "produção"
console.log('CRM: testes passaram');

// ---- aprovação do cliente ----
const apr = (ms)=>cf('Data da Aprovação','date',String(ms));
const at = transform([
  mk({id:'a1',name:'[DG] aprovado por status',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-3*D,closed:null,cf:[designer('Lailla'),fin(now-6*D)]}),
  mk({id:'a2',name:'[DG] aprovado com campo',list:'901311633948',item:1026,status:'complete',st:'closed',closed:now-D,done:now-4*D,cf:[designer('Lailla'),fin(now-7*D),apr(now-2*D)]}),
  mk({id:'a3',name:'[DG] na publicação sem campo',list:'901311633960',item:1026,status:'conteúdo pronto',st:'open',cf:[designer('Lailla'),fin(now-5*D)]}),
  mk({id:'a4',name:'[DG] postado (data de status = publicação, não aprovação)',list:'901311633960',item:1026,status:'postado',st:'done',done:now-D,cf:[designer('Lailla'),fin(now-5*D)]}),
  mk({id:'a5',name:'[DG] finalizado antes, aprovado na janela',list:'901311633948',item:1026,status:'complete',st:'closed',closed:now-2*D,cf:[designer('Lailla'),fin(now-50*D),apr(now-2*D)]}),
  mk({id:'a6',name:'[DG] fechada sem date_done',list:'901311633948',item:1026,status:'complete',st:'closed',closed:now-3*D,cf:[designer('Lailla'),fin(now-9*D)]}),
  mk({id:'a7',name:'[DG] aguardando cliente',list:'901311633948',item:1026,status:'p/ aprovação do cliente',st:'custom',cf:[designer('Lailla')]}),
],{cutoffMs:cutoff,nowMs:now});
const A = Object.fromEntries(at.production.map(p=>[p.id,p]));
assert.equal(A.a1.approvedMs,now-3*D); assert.equal(A.a1.approvedFrom,'status'); assert.equal(A.a1.approved,true);
assert.equal(A.a2.approvedMs,now-2*D); assert.equal(A.a2.approvedFrom,'campo');      // o campo vence o status
assert.equal(A.a3.approved,true); assert.equal(A.a3.approvedMs,null); assert.equal(A.a3.approvedFrom,null);
assert.equal(A.a4.approvedMs,null);                                                  // "postado" não é aprovação
assert.ok(A.a5, 'peça finalizada antes da janela mas aprovada dentro dela entra'); assert.equal(A.a5.approvedFrom,'campo');
assert.equal(A.a6.approvedMs,now-3*D); assert.equal(A.a6.approvedFrom,'fechamento');
assert.equal(A.a7.approved,false); assert.equal(A.a7.approvedMs,null);
console.log('aprovação: testes passaram');

// ---- correções da varredura de bugs ----
const bt = transform([
  mk({id:'b1',name:'[DG] sem Data da Publicação',list:'901311633960',item:1026,status:'postado',st:'done',done:now-3*D,upd:now-D,due:now-3*D}),
  mk({id:'b2',name:'[DG] link malicioso',list:'901311633960',item:1026,status:'postado',st:'done',done:now-D,cf:[url('javascript:alert(1)'),pubd(now-D)]}),
  mk({id:'b3',name:'[DG] link com espaço',list:'901311633960',item:1026,status:'postado',st:'done',done:now-D,cf:[url('  https://instagram.com/p/z  '),pubd(now-D)]}),
],{cutoffMs:cutoff,nowMs:now});
const B = Object.fromEntries(bt.publications.map(p=>[p.id,p]));
assert.equal(B.b1.publishedMs, now-3*D);          // date_done, não a última edição
assert.equal(B.b2.postUrl, null);                  // só http(s)
assert.equal(B.b3.postUrl, 'https://instagram.com/p/z');
console.log('varredura: testes passaram');

// ---- dados estranhos do ClickUp não derrubam a extração ----
const junk = [
  { ...mk({id:'j1',name:'[DG] tag sem nome',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D,cf:[designer('Lailla')]}), tags:[{}, {name:null}, {name:'Reels'}] },
  { ...mk({id:'j2',name:'[DG] campo de pessoas torto',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D}), custom_fields:[{name:'Designer',type:'users',value:'não-é-lista'}, {name:'Data da Finalização',type:'date',value:'xx'}] },
  { ...mk({id:'j3',name:'[DG] campos nulos',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D}), custom_fields:null, tags:null, assignees:null },
  mk({id:'j4',name:'[DG] normal depois das tortas',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D,cf:[designer('Mateus')]}),
];
const jt = transform(junk,{cutoffMs:cutoff,nowMs:now});
assert.ok(jt.production.find(p=>p.id==='j4'), 'uma tarefa torta não impede as demais');
console.log('dados tortos: testes passaram');

// ---- aprovação pelo histórico de status ----

assert.equal(approvalFromHistory({current_status:{status:'postado',since:'9'},status_history:[{status:'aprovado',since:'1794853039158'}]}), 1794853039158);
assert.equal(approvalFromHistory({current_status:{status:'aprovado',since:'1794853039158'},status_history:[]}), 1794853039158);
assert.equal(approvalFromHistory({status_history:[{status:'Aprovado',total_time:{since:'1794853039158'}}]}), 1794853039158); // formato REST
assert.equal(approvalFromHistory({status_history:[{status:'revisado',since:'1'}]}), null);
assert.equal(approvalFromHistory(null), null); assert.equal(approvalFromHistory({status_history:'x'}), null);
const hm = new Map([['h1', now-2*D],['h2', now-5*D],['h3', now-4*D],['h4', now-9*D]]);
const ht = transform([
  mk({id:'h1',name:'[DG] postado, aprovado há 2 dias',list:'901311633960',item:1026,status:'postado',st:'done',done:now-D,cf:[designer('Lailla'),fin(now-6*D)]}),
  mk({id:'h2',name:'[DG] campo vence histórico',list:'901311633960',item:1026,status:'agendado',st:'custom',cf:[designer('Lailla'),fin(now-8*D),apr(now-3*D)]}),
  mk({id:'h3',name:'[DG] voltou para alteração depois de aprovada',list:'901311633948',item:1026,status:'alteração e reajustes',st:'custom',cf:[designer('Lailla'),fin(now-8*D)]}),
  mk({id:'h4',name:'[DG] na produção, aprovada e concluída',list:'901311633948',item:1026,status:'complete',st:'closed',closed:now-D,done:now-D,cf:[designer('Lailla'),fin(now-12*D)]}),
  mk({id:'h5',name:'[DG] postada sem passar por aprovado',list:'901311633960',item:1026,status:'postado',st:'done',done:now-D,cf:[designer('Lailla'),fin(now-6*D)]}),
],{cutoffMs:cutoff,nowMs:now},{...CONFIG, approvedAt:hm});
const H = Object.fromEntries(ht.production.map(p=>[p.id,p]));
assert.equal(H.h1.approvedMs,now-2*D); assert.equal(H.h1.approvedFrom,'historico');
assert.equal(H.h2.approvedFrom,'campo'); assert.equal(H.h2.approvedMs,now-3*D);
assert.equal(H.h3.approved,false); assert.equal(H.h3.approvedMs,null);        // aprovada antes, mas reaberta: não conta como aprovada
assert.equal(H.h4.approvedFrom,'historico'); assert.equal(H.h4.approvedMs,now-9*D); // histórico vence a estimativa por date_done
assert.equal(H.h5.approved,true); assert.equal(H.h5.approvedFrom,null);       // sem registro: o painel avisa
console.log('histórico de aprovação: testes passaram');

// ---- colaboradores externos ----
const extF = (...labels)=>cf('Editor Externo','labels',labels.map((_,i)=>'e'+i),{options:labels.map((l,i)=>({id:'e'+i,label:l}))});
const et = transform([
  mk({id:'x1',name:'[DG] designer + externo',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D,cf:[designer('Lailla'),extF('Luka'),fin(now-3*D)]}),
  mk({id:'x2',name:'[DG] só externo',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D,cf:[extF('Coutinho','Izaias'),fin(now-3*D)]}),
  mk({id:'x3',name:'[DG] sem externo',list:'901311633948',item:1026,status:'aprovado',st:'done',done:now-D,cf:[designer('Mateus'),fin(now-3*D)]}),
],{cutoffMs:cutoff,nowMs:now});
const X = Object.fromEntries(et.production.map(p=>[p.id,p]));
assert.deepEqual(X.x1.externals,['Luka']); assert.deepEqual(X.x1.owners,['Lailla']);   // externo aparece sem tirar o crédito do designer
assert.deepEqual(X.x2.externals,['Gabriel Coutinho','Izaias']); assert.deepEqual(X.x2.owners,['Gabriel Coutinho','Izaias']); assert.equal(X.x2.ownerSource,'externo');
assert.deepEqual(X.x3.externals,[]);
console.log('externos: testes passaram');

// ---------- páginas (Landing Pages/Site) ----------
{
  const PL = CONFIG.PAGES_LIST;
  const tipo = cf('Tipo de LP','labels',['t1'],{options:[{id:'t1',label:'Vendas'}]});
  const pg = [
    mk({id:'p1',name:'[DG] LP Vendas',list:PL,status:'ativo',st:'done',cf:[tipo,cliente('Dr. Gustavo'),cf('URL 1','url','https://www.drgustavo.com.br/lp'),cf('Data da Publicação','date',String(now-5*D))]}),
    mk({id:'p2',name:'[DM] LP Antiga',list:PL,status:'complete',st:'closed'}),
    mk({id:'p3',name:'[IM] LP Nova',list:PL,status:'alteraçõs e ajustes',st:'custom',due:now-2*D,upd:now-9*D}),
    mk({id:'p5',name:'[DG] LP Sem data',list:PL,status:'ativo',st:'done',done:now-7*D}),
    mk({id:'p4',name:'[UP] LP Estranha',list:PL,status:'status novo',st:'custom'}),
  ];
  const since = new Map([['p3', now-4*D]]);
  const rp = transform(pg,{cutoffMs:cutoff,nowMs:now},{...CONFIG,pageSince:since});
  const G = Object.fromEntries(rp.pages.map(p=>[p.id,p]));
  assert.equal(rp.pages.length, 5);
  assert.equal(G.p5.liveMs, now-7*D); assert.equal(G.p5.liveFrom,'status');
  assert.equal(G.p1.stage,'ativo'); assert.equal(G.p1.domain,'drgustavo.com.br'); assert.equal(G.p1.type,'Vendas');
  assert.equal(G.p1.liveMs, now-5*D); assert.equal(G.p1.liveUrl,'https://www.drgustavo.com.br/lp'); assert.equal(G.p1.client,'Dr. Gustavo');
  assert.equal(G.p1.liveFrom,'campo');
  assert.equal(G.p2.stage,'concluido');                   // complete NÃO é página no ar
  assert.equal(G.p3.stage,'ajustes');                     // grafia do ClickUp sem o "e"
  assert.equal(G.p3.sinceMs, now-4*D); assert.equal(G.p3.sinceFrom,'historico');
  assert.equal(G.p4.stage,'outro'); assert.equal(G.p4.sinceFrom,'atualizacao');
  assert.equal(G.p4.client,'Unipeças');                   // cliente pelo prefixo
  assert.equal(rp.production.length, 0);                  // páginas não viram produção
  console.log('páginas: testes passaram');
}
