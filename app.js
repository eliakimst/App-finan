'use strict';

/* ============================================================
   Custos Pessoais — controle de gastos + calculadora de investimento
   Lógica da planilha "CUSTOS - PESSOAIS":
   - Entradas somam no dia; saídas e investimentos subtraem no dia.
   - Compras no cartão não mexem no saldo do dia: viram fatura,
     debitada no vencimento.
       C6     fecha no último dia, vence dia 10 do mês seguinte
       LATAM  fecha no último dia, vence dia 1 do mês seguinte
       CAIXA  ciclo 28 → 27, vence dia 8 do mês seguinte
   - "Sobra": saldo no dia anterior aos recebimentos (padrão dia 4),
     depois de pagar as contas do início do mês. É o valor disponível
     para aplicar.
   ============================================================ */

const KEY = 'custos-pessoais-v1';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
let OCULTO = false;   // modo privacidade: esconde valores
const fmt = v => (OCULTO ? 'R$ •••••' : BRL.format(Math.round(v * 100) / 100 + 0));
const pad = n => String(n).padStart(2, '0');
const hojeStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const diasNoMes = (a, m) => new Date(a, m, 0).getDate();           // m = 1..12
const ymStr = (a, m) => `${a}-${pad(m)}`;
const addMes = (a, m, k) => { const t = a * 12 + (m - 1) + k; return [Math.floor(t / 12), (t % 12) + 1]; };
const fimDoMes = (a, m) => `${ymStr(a, m)}-${pad(diasNoMes(a, m))}`;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const dm = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const mesCurto = (a, m) => `${MESES[m - 1].slice(0, 3)}/${String(a).slice(2)}`;
const ROTULO = { entrada: 'Entrada', saida: 'Saída', cartao: 'Cartão', investimento: 'Investimento', fatura: 'Fatura' };

function parseNum(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return parseFloat(s);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Estado ---------------- */
const CARTOES_PADRAO = [
  { id: 'c6', nome: 'C6', fecha: 31, vence: 10 },
  { id: 'latam', nome: 'LATAM', fecha: 31, vence: 1 },
  { id: 'caixa', nome: 'CAIXA', fecha: 27, vence: 8 },
];
function estadoPadrao() {
  const d = new Date();
  return {
    saldoInicial: { data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, valor: 0 },
    config: { diaReceb: 5 },
    cartoes: CARTOES_PADRAO.map(c => ({ ...c })),
    lancs: [],
    recs: [],
  };
}
function migrar(s) {
  s.config = { diaReceb: 5, ...(s.config || {}) };
  s.recs = s.recs || [];
  if (!s.cartoes.some(c => c.nome.trim().toUpperCase() === 'CAIXA')) s.cartoes.push({ ...CARTOES_PADRAO[2] });
  return s;
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch { S = null; }
S = migrar(S || estadoPadrao());
OCULTO = !!S.config.oculto;
const salvar = () => {
  OCULTO = !!S.config.oculto;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Não foi possível salvar: ' + e.message); }
  render();
};

/* ---------------- Motor de cálculo ---------------- */

function totalParcelas(r) {
  if (r.parcelas) return r.parcelas;
  const [a, m] = r.inicio.split('-').map(Number), [fa, fm] = (r.fim || r.inicio).split('-').map(Number);
  return (fa * 12 + fm) - (a * 12 + m) + 1;
}
function ocorrenciasRec(st, ateA, ateM) {
  const out = [];
  for (const r of st.recs) {
    let [a, m, dia] = r.inicio.split('-').map(Number);
    let guard = 0, k = 0;
    const nParc = r.parcelado ? totalParcelas(r) : 0;
    while ((a < ateA || (a === ateA && m <= ateM)) && guard++ < 1200) {
      const ym = ymStr(a, m);
      if (r.fim && ym > r.fim) break;
      k++;
      if (!(r.pular || []).includes(ym)) {
        const o = { ...r, id: `rec:${r.id}:${ym}`, recId: r.id, previsto: (r.tipo === 'saida' || r.tipo === 'entrada'), data: `${ym}-${pad(Math.min(dia, diasNoMes(a, m)))}` };
        if (nParc) {
          o.parcela = `${k}/${nParc}`;
          // a última parcela absorve a diferença de centavos
          if (k === nParc && r.total) o.valor = Math.round((r.total - r.valor * (nParc - 1)) * 100) / 100;
        }
        out.push(o);
      }
      [a, m] = addMes(a, m, 1);
    }
  }
  return out;
}

// Data em que a compra no cartão sai do saldo (vencimento da fatura)
function vencimento(compraData, cartao) {
  const [a, m, d] = compraData.split('-').map(Number);
  const [fa, fm] = d <= Math.min(cartao.fecha, diasNoMes(a, m)) ? [a, m] : addMes(a, m, 1);
  const diaFecha = Math.min(cartao.fecha, diasNoMes(fa, fm));
  const [va, vm] = cartao.vence > diaFecha ? [fa, fm] : addMes(fa, fm, 1);
  return `${ymStr(va, vm)}-${pad(Math.min(cartao.vence, diasNoMes(va, vm)))}`;
}

// Data da "sobra" de um mês: véspera do dia de recebimentos
function dataSobra(st, a, m) {
  const r = Math.max(1, Math.min(31, st.config.diaReceb | 0));
  if (r === 1) { const [pa, pm] = addMes(a, m, -1); return fimDoMes(pa, pm); }
  return `${ymStr(a, m)}-${pad(Math.min(r - 1, diasNoMes(a, m)))}`;
}
// Primeira data de sobra igual ou posterior a "data"
function proximaSobra(st, data) {
  const [a, m] = data.split('-').map(Number);
  const s = dataSobra(st, a, m);
  if (s >= data) return s;
  const [na, nm] = addMes(a, m, 1);
  return dataSobra(st, na, nm);
}

/* Movimentos por dia e saldo ao fim de cada dia, até o mês (ateA, ateM). */
function calcular(st, ateA, ateM) {
  const lancs = [...st.lancs, ...ocorrenciasRec(st, ateA, ateM)];
  const cartoes = Object.fromEntries(st.cartoes.map(c => [c.id, c]));
  const porDia = new Map();
  const get = d => { if (!porDia.has(d)) porDia.set(d, { itens: [], faturas: {}, delta: 0 }); return porDia.get(d); };

  for (const l of lancs) {
    get(l.data).itens.push(l);
    if (l.tipo === 'cartao' && cartoes[l.cartao]) {
      const dd = get(vencimento(l.data, cartoes[l.cartao]));
      dd.faturas[l.cartao] = (dd.faturas[l.cartao] || 0) + l.valor;
    }
  }
  const ini = st.saldoInicial.data;
  for (const [d, o] of porDia) {
    if (d < ini) continue;
    let delta = 0;
    for (const l of o.itens) {
      if (l.tipo === 'entrada') delta += l.valor;
      else if (l.tipo === 'saida' || l.tipo === 'investimento') delta -= l.valor;
    }
    for (const v of Object.values(o.faturas)) delta -= v;
    o.delta = delta;
  }
  const datas = [...porDia.keys()].filter(d => d >= ini).sort();
  const acum = []; let s = st.saldoInicial.valor;
  for (const d of datas) { s += porDia.get(d).delta; acum.push([d, s]); }

  function saldoAte(data) {
    if (data < ini) return null;
    let lo = 0, hi = acum.length - 1, r = st.saldoInicial.valor;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (acum[mid][0] <= data) { r = acum[mid][1]; lo = mid + 1; } else hi = mid - 1; }
    return r;
  }
  // menor saldo e primeiro saldo negativo no intervalo [de, ate]
  function analisar(de, ate) {
    let min = { data: de, valor: saldoAte(de) }, neg = null;
    if (min.valor != null && min.valor < -0.004) neg = { ...min };
    for (const [d, v] of acum) {
      if (d < de) continue; if (d > ate) break;
      if (min.valor == null || v < min.valor) min = { data: d, valor: v };
      if (!neg && v < -0.004) neg = { data: d, valor: v };
    }
    return { min, neg };
  }
  return { porDia, saldoAte, analisar, lancs };
}

const horizonte = () => { const d = new Date(); return addMes(d.getFullYear(), d.getMonth() + 1, 12); };

/* ---------------- Navegação ---------------- */
let verA, verM;
{ const d = new Date(); verA = d.getFullYear(); verM = d.getMonth() + 1; }

$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('ativa', x === b));
  $$('.tela').forEach(t => t.classList.toggle('ativa', t.id === 'tela-' + b.dataset.tela));
  $('#fab').hidden = !['mes', 'proj'].includes(b.dataset.tela);
  window.scrollTo(0, 0);
  render();
});
$('#mes-ant').onclick = () => { [verA, verM] = addMes(verA, verM, -1); render(); };
$('#mes-prox').onclick = () => { [verA, verM] = addMes(verA, verM, 1); render(); };

const nomeCartao = id => (S.cartoes.find(c => c.id === id) || { nome: '?' }).nome;

/* ---------------- Tela: Mês ---------------- */
const SVGI = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
const EMOJI = {
  entrada: SVGI('<path d="M12 4v15M6 13l6 6 6-6"/>'),
  saida: SVGI('<path d="M12 20V5M6 11l6-6 6 6"/>'),
  cartao: SVGI('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10.5h18M7 15h3"/>'),
  investimento: SVGI('<path d="M4 17l5-5 4 4 7-7"/><path d="M15 9h5v5"/>'),
  fatura: SVGI('<path d="M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21z"/><path d="M10 8h4M10 12h4"/>'),
  previsto: SVGI('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
};
const ICON_OLHO = SVGI('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');
const ICON_OLHO_FECHADO = SVGI('<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>');
function alternarOculto() { S.config.oculto = !S.config.oculto; salvar(); }
// Mostra como a sobra é calculada: saldo no fim do mês + entradas − saídas − faturas até a data da sobra
function detalheSobra(C, fim, sobraD, na, nm) {
  const base = C.saldoAte(fim); if (base == null) return '';
  let ent = 0, sai = 0, inv = 0; const fats = []; const depois = [];
  for (const [d, o] of C.porDia) {
    if (d <= fim) continue;
    for (const [c, v] of Object.entries(o.faturas)) (d <= sobraD ? fats : depois).push({ d, c, v });
    if (d > sobraD) continue;
    for (const l of o.itens) {
      if (l.tipo === 'entrada') ent += l.valor;
      else if (l.tipo === 'saida') sai += l.valor;
      else if (l.tipo === 'investimento') inv += l.valor;
    }
  }
  const ymP = ymStr(na, nm);
  const tarde = depois.filter(f => f.d.startsWith(ymP)).sort((x, y) => x.d.localeCompare(y.d));
  const L = (t, v, cls = '') => `<div class="l"><span>${t}</span><b class="num ${cls}">${v}</b></div>`;
  const ate = dm(sobraD);
  return `<details class="det-sobra"><summary>Como é calculada</summary>
    ${L(`Saldo em ${dm(fim)}`, fmt(base))}
    ${ent ? L(`Entradas até ${ate}`, '+' + fmt(ent), 'pos') : ''}
    ${sai ? L(`Saídas até ${ate}`, '−' + fmt(sai)) : ''}
    ${inv ? L(`Investimentos até ${ate}`, '−' + fmt(inv)) : ''}
    ${fats.sort((x, y) => x.d.localeCompare(y.d)).map(f => L(`Fatura ${esc(nomeCartao(f.c))} (${dm(f.d)})`, '−' + fmt(f.v))).join('')}
    ${L('Sobra', fmt(C.saldoAte(sobraD)))}
    ${tarde.length ? `<p class="hint" style="margin:8px 0 0">Vencem depois dos recebimentos do dia ${S.config.diaReceb} e saem do saldo no mês: ${tarde.map(f => `${esc(nomeCartao(f.c))} ${dm(f.d)} (${fmt(f.v)})`).join(', ')}.</p>` : ''}
  </details>`;
}
function humor(v) {
  if (v < 0) return { c: 'ruim', t: 'Vai faltar', st: 'Negativo' };
  if (v < 500) return { c: 'apertado', t: 'Sobra para aplicar', st: 'Apertado' };
  return { c: '', t: 'Sobra para aplicar', st: 'Tudo certo' };
}
function renderMes() {
  const vazio = !S.lancs.length && !S.recs.length;
  $('#boas-vindas').innerHTML = !vazio ? '' : `<div class="cartao-bloco" style="text-align:center;padding:20px 16px">
      <h2 style="font-size:20px">Bem-vindo ao Posso gastar?</h2>
      <p class="hint" style="margin:6px 0 16px">Ainda não há dados neste aparelho. Importe o arquivo de backup (.json) ou comece a lançar.</p>
      <button class="primario" id="bv-importar">Importar backup</button>
      <button class="secundario" id="bv-lancar" style="margin-top:8px">Lançar manualmente</button>
    </div>`;
  if (vazio) { $('#bv-importar').onclick = () => $('#importar').click(); $('#bv-lancar').onclick = () => abrirLanc(null); }
  $('#mes-nome').textContent = `${MESES[verM - 1]} ${verA}`;
  const [na, nm] = addMes(verA, verM, 1);
  const C = calcular(S, na, nm);
  const ym = ymStr(verA, verM);
  const ini = S.saldoInicial.data;
  const hoje = hojeStr();
  const fim = fimDoMes(verA, verM);
  const sobraD = dataSobra(S, na, nm);
  const sobra = C.saldoAte(sobraD);
  const nomeProx = MESES[nm - 1];

  // 1º destaque: saldo atual (hoje), independe do mês exibido
  {
    const d0 = new Date(), hj = hojeStr();
    const CH = calcular(S, d0.getFullYear(), d0.getMonth() + 1);
    const saldoHoje = CH.saldoAte(hj);
    const prevHoje = CH.lancs.filter(l => (l.tipo === 'saida' || l.tipo === 'entrada') && l.previsto && l.data <= hj && l.data >= ini).length;
    const dataTxt = `${SEM[d0.getDay()]}, ${d0.getDate()} de ${MESES[d0.getMonth()]}`;
    $('#hoje').innerHTML = `<div class="hoje-topo"><span>Saldo atual</span><small>${dataTxt}</small>
        <button class="olho" id="btn-olho" aria-label="${OCULTO ? 'Mostrar valores' : 'Ocultar valores'}">${OCULTO ? ICON_OLHO_FECHADO : ICON_OLHO}</button></div>
      <div class="saldo-card">
        <div class="valor num ${saldoHoje < 0 ? 'neg' : ''}">${saldoHoje == null ? '—' : fmt(saldoHoje)}</div>
        <div class="sub">${saldoHoje == null ? `O saldo inicial é de ${dm(ini)}. Ajuste em Ajustes.` : prevHoje ? `Considera ${prevHoje} valor${prevHoje > 1 ? 'es' : ''} previsto${prevHoje > 1 ? 's' : ''} ainda não confirmado${prevHoje > 1 ? 's' : ''}.` : 'Atualizado com os lançamentos até hoje.'}</div>
      </div>`;
    $('#btn-olho').onclick = alternarOculto;
  }

  // 2º destaque: sobra para aplicar (início do mês seguinte ao exibido)
  if (sobra == null) $('#hero').innerHTML = '';
  else {
    const h = humor(sobra);
    $('#hero').innerHTML = `<div class="hero sobra ${h.c}">
      <div class="topo"><small>${h.t}</small><span class="status">${h.st}</span></div>
      <div class="valor num">${fmt(Math.abs(sobra))}</div>
      <div class="sub">em ${Number(sobraD.slice(8))} de ${nomeProx}, depois das contas do início do mês</div>
      ${detalheSobra(C, fim, sobraD, na, nm)}
    </div>`;
  }

  const de = `${ym}-01` < ini ? ini : `${ym}-01`;
  const { neg } = de <= sobraD ? C.analisar(de, sobraD) : { neg: null };
  $('#alerta').innerHTML = neg ? `<div class="alerta">Saldo fica negativo em ${dm(neg.data)} (${fmt(neg.valor)})</div>` : '';
  renderPendentes();

  let ent = 0, sai = 0, inv = 0, prevMes = 0, prevEnt = 0;
  const dias = [...C.porDia.keys()].filter(d => d.startsWith(ym)).sort();
  for (const d of dias) {
    if (d < ini) continue;
    const o = C.porDia.get(d);
    for (const l of o.itens) {
      if (l.tipo === 'entrada') { ent += l.valor; if (l.previsto) prevEnt += l.valor; }
      if (l.tipo === 'saida') { sai += l.valor; if (l.previsto) prevMes += l.valor; }
      if (l.tipo === 'investimento') inv += l.valor;
    }
    for (const v of Object.values(o.faturas)) sai += v;
  }
  const sFim = C.saldoAte(fim);
  $('#numeros').innerHTML = ini > fim ? '' : `<div class="numeros">
      <div><small>Entradas</small><b class="num pos">${fmt(ent)}</b></div>
      <div><small>Saídas</small><b class="num">${fmt(sai)}</b></div>
      <div><small>Saldo final</small><b class="num ${sFim < 0 ? 'neg' : ''}">${sFim == null ? '—' : fmt(sFim)}</b></div>
    </div>${(() => { const p = [inv ? `Investido: <b class="pos">${fmt(inv)}</b>` : '', prevEnt ? `Entradas previstas: <b>${fmt(prevEnt)}</b>` : '', prevMes ? `Saídas previstas: <b>${fmt(prevMes)}</b>` : ''].filter(Boolean);
      return p.length ? `<p class="resumo-extra">${p.join(' · ')}</p>` : ''; })()}`;

  // 1. faturas de todos os cartões que vencem no mês seguinte (mesmo zeradas)
  const ymProx = ymStr(na, nm);
  const fats = S.cartoes.map(c => {
    const venc = `${ymProx}-${pad(Math.min(c.vence, diasNoMes(na, nm)))}`;
    const v = C.porDia.get(venc)?.faturas[c.id] || 0;
    return { c, venc, v, ...cicloFatura(c, venc) };
  }).sort((x, y) => x.venc.localeCompare(y.venc));
  $('#faturas').innerHTML = fats.length ? `<p class="sec-titulo">Faturas de ${nomeProx}</p><div class="cartao-bloco" style="padding-top:2px;padding-bottom:2px">${fats.map(f => `
      <div class="linha click" data-fat="${esc(f.c.id)}" data-de="${f.iniC}" data-ate="${f.fech}"><div class="esq"><span class="av cartao">${EMOJI.cartao}</span><div style="min-width:0"><div class="t">${esc(f.c.nome)}</div><small>compras ${dm(f.iniC)} a ${dm(f.fech)} · vence ${dm(f.venc)}</small></div></div>
      <div class="dir num">${fmt(f.v)}<span class="chev">›</span></div></div>`).join('')}</div>` : '';
  $$('[data-fat]').forEach(el => el.onclick = () => abrirLista({ tipo: 'cartao', cartao: el.dataset.fat, periodo: 'ciclo', de: el.dataset.de, ate: el.dataset.ate }));

  // 2/3. lançamentos agregados por tipo; ao tocar, lista do mais recente ao mais antigo
  const antes = ini > fim ? `<div class="info">Histórico: este mês é anterior ao saldo inicial (${dm(ini)}/${ini.slice(0, 4)}), então não afeta o saldo.</div>` : '';
  const doMes = C.lancs.filter(l => l.data.startsWith(ym));
  const fatMes = pagamentosFatura(C).filter(l => l.data.startsWith(ym));
  const somaV = arr => arr.reduce((x, l) => x + l.valor, 0);
  const grupos = [['entrada', 'Entradas'], ['saida', 'Saídas'], ['cartao', 'Compras no cartão'], ['investimento', 'Investimentos']]
    .map(([t, nome]) => {
      const it = doMes.filter(l => l.tipo === t);
      const n = it.length, txt = `${n} lançamento${n === 1 ? '' : 's'}`;
      if (t !== 'saida') return { t, nome, txt, v: somaV(it) };
      // saídas = à vista + pagamento das faturas que vencem no mês
      return { t, nome, txt: fatMes.length ? `${txt} + ${fatMes.length} fatura${fatMes.length === 1 ? '' : 's'} (${fmt(somaV(fatMes))})` : txt, v: somaV(it) + somaV(fatMes) };
    });
  $('#dias').innerHTML = antes + `<p class="sec-titulo">Lançamentos de ${MESES[verM - 1]}</p>
    <div class="cartao-bloco" style="padding-top:2px;padding-bottom:2px">
      ${grupos.map(g => `<div class="linha click" data-grupo="${g.t}"><div class="esq"><span class="av ${g.t}">${EMOJI[g.t]}</span><div style="min-width:0"><div class="t">${g.nome}</div><small>${g.txt}</small></div></div>
        <div class="dir num ${g.t === 'entrada' ? 'pos' : ''}">${fmt(g.v)}<span class="chev">›</span></div></div>`).join('')}
      <div class="linha click" data-grupo="todos"><div class="esq"><span class="av previsto">${SVGI('<path d="M5 7h14M5 12h14M5 17h14"/>')}</span><div class="t">Ver todos</div></div><div class="dir"><span class="chev">›</span></div></div>
    </div>`;
  $$('[data-grupo]').forEach(el => el.onclick = () => abrirLista({ tipo: el.dataset.grupo, periodo: 'mes' }));
}

// Período de compras da fatura do cartão c que vence em `venc`
function cicloFatura(c, venc) {
  const [na, nm] = venc.split('-').map(Number);
  const [fa, fm] = c.vence > Math.min(c.fecha, diasNoMes(na, nm)) ? [na, nm] : addMes(na, nm, -1);
  const fech = `${ymStr(fa, fm)}-${pad(Math.min(c.fecha, diasNoMes(fa, fm)))}`;
  const [pa, pm] = addMes(fa, fm, -1);
  return { iniC: addDias(`${ymStr(pa, pm)}-${pad(Math.min(c.fecha, diasNoMes(pa, pm)))}`, 1), fech };
}
// Pagamentos de fatura (calculados a partir das compras) como itens de lista
function pagamentosFatura(C) {
  const out = [];
  for (const [d, o] of C.porDia) for (const [c, v] of Object.entries(o.faturas))
    out.push({ id: `fat:${c}:${d}`, tipo: 'fatura', cartao: c, valor: v, data: d, descricao: `Fatura ${nomeCartao(c)}` });
  return out;
}

// Linha de um lançamento (usada nas listas)
function htmlLanc(l) {
  if (l.tipo === 'fatura') {
    const [a, m, d] = l.data.split('-').map(Number);
    return `<div class="linha click" data-fatura="${esc(l.cartao)}" data-venc="${l.data}">
      <div class="esq"><span class="av fatura">${EMOJI.fatura}</span><div style="min-width:0"><div class="t">${esc(l.descricao)}</div><small>${SEM[new Date(a, m - 1, d).getDay()]}, ${dm(l.data)} · pagamento do cartão</small></div></div>
      <div class="dir num">−${fmt(l.valor)}<span class="chev">›</span></div></div>`;
  }
  const sinal = l.tipo === 'entrada' ? '+' : l.tipo === 'cartao' ? '' : '−';
  const cart = S.cartoes.find(c => c.id === l.cartao);
  const prev = (l.tipo === 'saida' || l.tipo === 'entrada') && l.previsto;
  const [a, m, d] = l.data.split('-').map(Number);
  const partes = [`${SEM[new Date(a, m - 1, d).getDay()]}, ${dm(l.data)}`];
  if (l.tipo === 'cartao') {
    partes.push(nomeCartao(l.cartao));
    if (l.parcela) partes.push(`parcela ${l.parcela}`);
    if (cart) partes.push(`fatura ${dm(vencimento(l.data, cart))}`);
  } else if (l.descricao) partes.push(ROTULO[l.tipo]);
  const selo = prev ? ' <span class="selo">previsto</span>' : (l.tipo === 'saida' || l.tipo === 'entrada') && (l.deRec || l.confirmado) ? ` <span class="selo ok">${l.tipo === 'entrada' ? 'recebido' : 'pago'} ✓</span>` : '';
  return `<div class="linha click ${prev ? 'previsto' : ''}" data-id="${esc(l.id)}">
    <div class="esq"><span class="av ${prev ? 'previsto' : l.tipo}">${prev ? EMOJI.previsto : EMOJI[l.tipo]}</span><div style="min-width:0"><div class="t">${esc(l.descricao || ROTULO[l.tipo])}${l.recId && !l.parcela || l.deRec ? ' <span class="rep">↻</span>' : ''}</div><small>${esc(partes.join(' · '))}${selo}</small></div></div>
    <div class="dir num ${l.tipo === 'entrada' || l.tipo === 'investimento' ? 'pos' : ''}" style="${l.tipo === 'cartao' ? 'color:var(--roxo)' : ''}">${sinal}${fmt(l.valor)}${prev ? `<button class="mini" data-conf="${esc(l.id)}">Confirmar</button>` : ''}</div></div>`;
}
function ligarLancs(raiz, lista) {
  raiz.querySelectorAll('[data-fatura]').forEach(el => el.onclick = () => {
    const c = S.cartoes.find(x => x.id === el.dataset.fatura); if (!c) return;
    const { iniC, fech } = cicloFatura(c, el.dataset.venc);
    abrirLista({ tipo: 'cartao', cartao: c.id, periodo: 'ciclo', de: iniC, ate: fech });
  });
  raiz.querySelectorAll('.linha.click[data-id]').forEach(el => el.onclick = () => abrirLanc(el.dataset.id, lista));
  raiz.querySelectorAll('[data-conf]').forEach(b => b.onclick = e => { e.stopPropagation(); abrirConfirmar(b.dataset.conf, lista); });
}

/* ---------------- Lista de lançamentos (filtros) ---------------- */
const dlL = $('#dlg-lista');
const LS = {};
const semAcento = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function abrirLista(opts) {
  Object.assign(LS, { tipo: 'todos', cartao: '', periodo: 'mes', status: '', busca: '', de: null, ate: null, a: verA, m: verM }, opts);
  const per = $('#lista-periodo');
  per.innerHTML = `<option value="mes">${mesCurto(LS.a, LS.m)}</option><option value="ate-hoje">Até hoje</option><option value="tudo">Tudo + 12 meses</option>`
    + (LS.periodo === 'ciclo' ? `<option value="ciclo">${dm(LS.de)}–${dm(LS.ate)}</option>` : '');
  per.value = LS.periodo;
  $('#lista-cartao').innerHTML = '<option value="">Todos os cartões</option>' + S.cartoes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  $('#lista-cartao').value = LS.cartao;
  $('#lista-status').value = LS.status;
  $('#lista-busca').value = '';
  $$('#lista-tipo input').forEach(i => { i.checked = i.value === LS.tipo; });
  renderLista();
  if (!dlL.open) dlL.showModal();
  dlL.scrollTop = 0;
}
function renderLista() {
  LS.tipo = $('#lista-tipo input:checked')?.value || 'todos';
  LS.periodo = $('#lista-periodo').value; LS.status = $('#lista-status').value;
  LS.cartao = $('#lista-cartao').value; LS.busca = semAcento($('#lista-busca').value.trim());
  $('#lista-campo-cartao').hidden = LS.tipo !== 'cartao';
  const [ha, hm] = horizonte();
  const ate = ymStr(LS.a, LS.m) > ymStr(ha, hm) ? [LS.a, LS.m] : [ha, hm];
  const C = calcular(S, ate[0], ate[1]);
  const hoje = hojeStr(), ymL = ymStr(LS.a, LS.m);
  const comFaturas = LS.tipo === 'todos' || LS.tipo === 'saida';
  let L = [...C.lancs, ...(comFaturas ? pagamentosFatura(C) : [])].filter(l => {
    if (LS.periodo === 'mes' && !l.data.startsWith(ymL)) return false;
    if (LS.periodo === 'ate-hoje' && l.data > hoje) return false;
    if (LS.periodo === 'ciclo' && (l.data < LS.de || l.data > LS.ate)) return false;
    if (LS.tipo !== 'todos' && l.tipo !== LS.tipo && !(LS.tipo === 'saida' && l.tipo === 'fatura')) return false;
    if (LS.tipo === 'cartao' && LS.cartao && l.cartao !== LS.cartao) return false;
    const prev = (l.tipo === 'saida' || l.tipo === 'entrada') && l.previsto;
    if (LS.status === 'previsto' && !prev) return false;
    if (LS.status === 'ok' && prev) return false;
    if (LS.busca && !semAcento(`${l.descricao} ${ROTULO[l.tipo]} ${l.cartao ? nomeCartao(l.cartao) : ''}`).includes(LS.busca)) return false;
    return true;
  });
  L.sort((x, y) => y.data.localeCompare(x.data) || String(y.id).localeCompare(String(x.id)));
  const ent = L.filter(l => l.tipo === 'entrada').reduce((x, l) => x + l.valor, 0);
  // compras no cartão não somam junto com as faturas (seriam contadas duas vezes)
  const temFat = L.some(l => l.tipo === 'fatura');
  const sai = L.filter(l => l.tipo !== 'entrada' && !(temFat && l.tipo === 'cartao')).reduce((x, l) => x + l.valor, 0);
  $('#lista-resumo').innerHTML = `${L.length} lançamento${L.length === 1 ? '' : 's'}` + (ent ? ` · entradas <b class="pos">${fmt(ent)}</b>` : '') + (sai ? ` · saídas <b>${fmt(sai)}</b>` : '');
  const box = $('#lista-itens');
  box.innerHTML = L.length ? L.map(htmlLanc).join('') : '<div class="vazio">Nada encontrado com esses filtros.</div>';
  ligarLancs(box, L);
}
$('#lista-fechar').onclick = () => dlL.close();
['#lista-periodo', '#lista-status', '#lista-cartao'].forEach(id => $(id).addEventListener('change', renderLista));
$('#lista-tipo').addEventListener('change', renderLista);
$('#lista-busca').addEventListener('input', renderLista);

/* ---------------- Tela: Posso gastar? ---------------- */
const fs = $('#sim');
fs.parcelas.innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i ? `${i + 1}x` : 'à vista (1x)'}</option>`).join('');
const addDias = (data, n) => { const [a, m, d] = data.split('-').map(Number); const t = new Date(a, m - 1, d + n); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };

// Estado com a compra simulada (n parcelas mensais)
function comCompra(st, p, valor) {
  const s2 = { ...st, lancs: st.lancs.slice() };
  if (!(valor > 0)) return s2;
  const [a, m, d] = p.data.split('-').map(Number);
  const parc = Math.round(valor / p.n * 100) / 100;
  for (let k = 0; k < p.n; k++) {
    const [pa, pm] = addMes(a, m, k);
    const v = k === p.n - 1 ? Math.round((valor - parc * (p.n - 1)) * 100) / 100 : parc;
    s2.lancs.push({ id: 'sim' + k, tipo: p.forma, cartao: p.forma === 'cartao' ? p.cartao : undefined, valor: v, descricao: p.descricao, data: `${ymStr(pa, pm)}-${pad(Math.min(d, diasNoMes(pa, pm)))}` });
  }
  return s2;
}
function paramsSim() {
  return { forma: fs.forma.value, cartao: fs.cartao.value, data: fs.data.value || hojeStr(), n: Number(fs.parcelas.value) || 1,
    descricao: fs.descricao.value.trim(), reserva: Math.max(0, parseNum(fs.reserva.value) || 0), valor: parseNum(fs.valor.value) };
}
function janelaSim() {
  const [ha, hm] = horizonte();
  return { ha, hm, de: [hojeStr(), S.saldoInicial.data].sort()[1], ate: fimDoMes(ha, hm) };
}
// Maior valor que mantém o saldo >= reserva em toda a janela
function maxGastavel(p) {
  const J = janelaSim();
  const ok = v => { const r = calcular(comCompra(S, p, v), J.ha, J.hm).analisar(J.de, J.ate); return r.min.valor == null || r.min.valor >= p.reserva - 0.004; };
  if (!ok(0)) return 0;
  const base = calcular(S, J.ha, J.hm);
  let hi = Math.max(1, ...[...base.porDia.keys()].map(d => base.saldoAte(d) || 0)) * p.n + 1;
  if (ok(hi)) return hi;
  let lo = 0;
  for (let i = 0; i < 50 && hi - lo > 0.005; i++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
  return Math.floor(lo * 100) / 100;
}
function renderSim() {
  fs.cartao.innerHTML = S.cartoes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('') || '<option value="">(nenhum cartão)</option>';
  if (!fs.data.value) fs.data.value = hojeStr();
  atualizarSim();
}
function atualizarSim() {
  $('#sim-campo-cartao').hidden = fs.forma.value !== 'cartao';
  const p = paramsSim();
  if (p.forma === 'cartao' && !S.cartoes.find(c => c.id === p.cartao)) { $('#sim-out').innerHTML = '<p class="hint">Cadastre um cartão em Ajustes.</p>'; $('#sim-limite').innerHTML = ''; return; }
  const J = janelaSim();
  const max = maxGastavel(p);
  const como = p.forma === 'cartao' ? `no ${esc(nomeCartao(p.cartao))}` : 'à vista';
  $('#sim-limite').innerHTML = `<div class="limite"><div><small>Dá para gastar ${como}${p.n > 1 ? ` em ${p.n}x` : ''} até${p.reserva ? ` (guardando ${fmt(p.reserva)})` : ''}</small><b class="num">${fmt(max)}</b></div></div>`;
  if (!(p.valor > 0)) { $('#sim-out').innerHTML = '<div class="vazio">Digite um valor para simular.</div>'; return; }

  const A = calcular(S, J.ha, J.hm), B = calcular(comCompra(S, p, p.valor), J.ha, J.hm);
  const rb = B.analisar(J.de, J.ate);
  const cart = S.cartoes.find(c => c.id === p.cartao);
  const debito = p.forma === 'cartao' ? vencimento(p.data, cart) : p.data;
  const sd = proximaSobra(S, debito);
  const abaixo = rb.min.valor != null && rb.min.valor < p.reserva - 0.004;
  let em, tit, txt;
  const IX = SVGI('<path d="M7 7l10 10M17 7L7 17"/>'), IOK = SVGI('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), IEX = SVGI('<path d="M12 6v8M12 18v.01"/>');
  if (rb.neg) { em = IX; tit = 'Melhor não'; txt = `O saldo fica negativo em ${dm(rb.neg.data)} (${fmt(rb.neg.valor)}).`; }
  else if (abaixo) { em = IEX; tit = 'Até dá, mas aperta'; txt = `O saldo cai para ${fmt(rb.min.valor)} em ${dm(rb.min.data)}, abaixo do mínimo que você quer guardar.`; }
  else { em = IOK; tit = 'Pode gastar'; txt = `O menor saldo fica em ${fmt(rb.min.valor)} (${dm(rb.min.data)}).`; }

  // gráfico: saldo antes x depois, de hoje até o horizonte
  const pts = []; for (let d = J.de, i = 0; d <= J.ate && i < 400; d = addDias(d, 3), i++) pts.push([d, A.saldoAte(d), B.saldoAte(d)]);
  const vals = pts.flatMap(x => [x[1], x[2]]).filter(v => v != null);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const W = 600, H = 190, P = 6;
  const x = i => P + (W - 2 * P) * i / Math.max(1, pts.length - 1), y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo);
  const linha = k => pts.map((q, i) => `${x(i).toFixed(1)},${y(q[k] ?? 0).toFixed(1)}`).join(' ');

  $('#sim-out').innerHTML = `
    <div class="veredito ${rb.neg ? 'ruim' : abaixo ? 'apertado' : ''}"><span class="em">${em}</span><b>${tit}</b><p>${txt}</p></div>
    <div class="cartao-bloco">
      <div class="impacto" style="background:none;padding:0;margin:0 0 6px">
        <div class="l"><span>${p.forma === 'cartao' ? 'Primeira fatura' : 'Sai do saldo em'}</span><b>${dm(debito)}</b></div>
        ${p.n > 1 ? `<div class="l"><span>Parcelas</span><b class="num">${p.n}x de ${fmt(p.valor / p.n)}</b></div>` : ''}
        <div class="l"><span>Sobra ${dm(sd)}</span><b class="num">${fmt(A.saldoAte(sd))} → <span class="${B.saldoAte(sd) < 0 ? 'neg' : ''}">${fmt(B.saldoAte(sd))}</span></b></div>
      </div>
      <svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo antes e depois da compra" style="stroke:none">
        <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" stroke="var(--neg)" stroke-width="1.5" stroke-dasharray="4 5" opacity=".6"/>
        <polyline points="${linha(1)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 5" opacity=".7"/>
        <polyline points="${linha(2)}" fill="none" stroke="${rb.neg ? 'var(--neg)' : 'var(--roxo)'}" stroke-width="3" stroke-linejoin="round"/>
      </svg>
      <div class="legenda"><span><i style="background:var(--muted)"></i>Sem a compra</span><span><i style="background:${rb.neg ? 'var(--neg)' : 'var(--roxo)'}"></i>Com a compra</span><span><i style="background:var(--neg)"></i>Zero</span></div>
      <button type="button" class="${rb.neg ? 'secundario' : 'primario'}" id="sim-registrar">Registrar esta compra</button>
    </div>`;
  $('#sim-registrar').onclick = () => {
    if (rb.neg && !confirm('Essa compra deixa o saldo negativo. Registrar mesmo assim?')) return;
    const base = { tipo: p.forma, valor: Math.round(p.valor / p.n * 100) / 100, descricao: p.descricao, cartao: p.forma === 'cartao' ? p.cartao : undefined };
    if (p.n === 1) S.lancs.push({ id: uid(), ...base, data: p.data });
    else { const [a, m] = p.data.split('-').map(Number); const [fa, fm] = addMes(a, m, p.n - 1); S.recs.push({ id: uid(), ...base, descricao: (p.descricao || 'Compra') + ` (${p.n}x)`, inicio: p.data, fim: ymStr(fa, fm), pular: [], parcelado: true, parcelas: p.n, total: p.valor }); }
    fs.valor.value = ''; fs.descricao.value = '';
    salvar();
    alert('Compra registrada.');
  };
}
let simTimer;
fs.addEventListener('input', () => { clearTimeout(simTimer); simTimer = setTimeout(atualizarSim, 150); });

/* ---------------- Tela: Projeção ---------------- */
// Média mensal de compras no cartão (avulsas + recorrentes) nos últimos 3 meses completos com dados
function mediaCartao() {
  const d = new Date(); const [a0, m0] = [d.getFullYear(), d.getMonth() + 1];
  const C = calcular(S, a0, m0);
  const primeira = C.lancs.reduce((mn, l) => (l.data < mn ? l.data : mn), '9999-99');
  const meses = [];
  for (let k = 3; k >= 1; k--) { const [a, m] = addMes(a0, m0, -k); if (ymStr(a, m) >= primeira.slice(0, 7)) meses.push([a, m]); }
  if (!meses.length) return { media: 0, meses };
  let tot = 0;
  for (const [a, m] of meses) tot += C.lancs.filter(l => l.tipo === 'cartao' && l.data.startsWith(ymStr(a, m))).reduce((s, l) => s + l.valor, 0);
  return { media: Math.round(tot / meses.length * 100) / 100, meses };
}
const ehParcelado = r => r.parcelado || /\(\d+x\)$/.test(r.descricao || '');

// "Mantendo o ritmo": recorrências continuam sem data de fim (exceto parcelamentos)
// e, se as compras no cartão de um mês ficarem abaixo da média, a diferença
// é descontada no dia 1 do mês seguinte (estimativa conservadora).
function estadoRitmo(media) {
  const st = { ...S, recs: S.recs.map(r => (ehParcelado(r) ? r : { ...r, fim: '' })), lancs: S.lancs.slice() };
  const d = new Date(); const [a0, m0] = [d.getFullYear(), d.getMonth() + 1];
  const [ha, hm] = horizonte();
  const C = calcular(st, ha, hm);
  for (let k = 0; k <= 12; k++) {
    const [a, m] = addMes(a0, m0, k); const ym = ymStr(a, m);
    const reg = C.lancs.filter(l => l.tipo === 'cartao' && l.data.startsWith(ym)).reduce((s, l) => s + l.valor, 0);
    const extra = Math.round(Math.max(0, media - reg) * 100) / 100;
    if (extra > 0) { const [na, nm] = addMes(a, m, 1); st.lancs.push({ id: 'ritmo' + k, tipo: 'saida', valor: extra, descricao: 'Média do cartão', data: `${ymStr(na, nm)}-01` }); }
  }
  return st;
}

function renderProj() {
  const d = new Date(); const [a0, m0] = [d.getFullYear(), d.getMonth() + 1];
  const [ha, hm] = horizonte();
  const modo = $('#proj-modo input:checked').value;
  const auto = mediaCartao();
  const media = S.config.mediaCartao ?? auto.media;
  const mi = $('#media-input');
  if (document.activeElement !== mi) mi.value = brNum(media);
  $('#media-hint').innerHTML = (auto.meses.length ? `Média automática: <b>${fmt(auto.media)}</b> (base: ${auto.meses.map(([a, m]) => mesCurto(a, m)).join(', ')}).` : 'Ainda não há meses completos para calcular a média.')
    + ' Se as compras do mês ficarem abaixo disso, a diferença é descontada no dia 1 do mês seguinte.'
    + (S.config.mediaCartao != null ? ' <a href="#" id="media-auto">Usar a automática</a>' : '');
  const la = $('#media-auto'); if (la) la.onclick = e => { e.preventDefault(); S.config.mediaCartao = null; salvar(); };
  $('#proj-media').hidden = modo !== 'ritmo';

  const CA = calcular(S, ha, hm), CR = calcular(estadoRitmo(media), ha, hm);
  const C = modo === 'ritmo' ? CR : CA;
  const hoje = hojeStr();
  const umAno = `${a0 + 1}-${pad(m0)}-${pad(Math.min(d.getDate(), diasNoMes(a0 + 1, m0)))}`;
  const de = [hoje, S.saldoInicial.data].sort()[1];

  const linhas = [];
  for (let k = 0; k < 12; k++) {
    const [a, m] = addMes(a0, m0, k);
    linhas.push({ a, m, sobra: C.saldoAte(dataSobra(S, a, m)), fim: C.saldoAte(fimDoMes(a, m)) });
  }
  const vR = CR.saldoAte(umAno), vA = CA.saldoAte(umAno);
  const sHoje = C.saldoAte(de);
  const mediaSobra = sHoje == null ? null : ((modo === 'ritmo' ? vR : vA) - sHoje) / 12;
  const { min, neg } = C.analisar(de, umAno);
  const v1 = modo === 'ritmo' ? vR : vA, v2 = modo === 'ritmo' ? vA : vR;
  $('#proj-resumo').innerHTML = `<div class="kpis">
      <div class="full ${v1 < 0 ? 'ruim' : ''}"><small>${modo === 'ritmo' ? 'Mantendo o ritmo, ' : 'Só com o cadastrado, '}em ${dm(umAno)}/${String(a0 + 1).slice(2)} você terá</small><b class="num">${v1 == null ? '—' : fmt(v1)}</b></div>
      <div><small>${modo === 'ritmo' ? 'Só o cadastrado' : 'Mantendo o ritmo'}</small><b class="num">${v2 == null ? '—' : fmt(v2)}</b></div>
      <div><small>Sobra por mês (média)</small><b class="num ${mediaSobra < 0 ? 'neg' : ''}">${mediaSobra == null ? '—' : fmt(mediaSobra)}</b></div>
    </div>
    ${neg ? `<div class="alerta">Nesse cenário o saldo fica negativo em ${dm(neg.data)} (${fmt(neg.valor)}).</div>` : min.valor != null ? `<p class="hint">Menor saldo no período: <b>${fmt(min.valor)}</b> em ${dm(min.data)}.</p>` : ''}`;

  // gráfico: saldo no fim de cada mês, dois cenários
  const pts = [];
  for (let k = 0; k <= 12; k++) { const [a, m] = addMes(a0, m0, k); const f = k === 12 ? umAno : fimDoMes(a, m); pts.push([mesCurto(a, m), CA.saldoAte(f), CR.saldoAte(f)]); }
  const vals = pts.flatMap(p => [p[1], p[2]]).filter(v => v != null);
  if (vals.length) {
    const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    const W = 600, H = 210, P = 8, B = 22;
    const x = i => P + (W - 2 * P) * i / 12, y = v => H - B - (H - B - P) * (v - lo) / (hi - lo);
    const linha = k => pts.map((p, i) => p[k] == null ? null : `${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`).filter(Boolean).join(' ');
    const corR = 'var(--roxo)', corA = 'var(--acc)';
    $('#proj-graf').innerHTML = `<svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo projetado" style="stroke:none">
        <line x1="${P}" x2="${W - P}" y1="${y(0)}" y2="${y(0)}" stroke="var(--neg)" stroke-width="1.5" stroke-dasharray="4 5" opacity=".6"/>
        <polyline points="${linha(1)}" fill="none" stroke="${corA}" stroke-width="${modo === 'cadastro' ? 3.5 : 2}" opacity="${modo === 'cadastro' ? 1 : .45}"/>
        <polyline points="${linha(2)}" fill="none" stroke="${corR}" stroke-width="${modo === 'ritmo' ? 3.5 : 2}" opacity="${modo === 'ritmo' ? 1 : .45}"/>
        ${pts.map((p, i) => i % 3 === 0 || i === 12 ? `<text x="${x(i)}" y="${H - 4}" font-size="15" fill="var(--muted)" text-anchor="${i === 0 ? 'start' : i === 12 ? 'end' : 'middle'}" font-family="-apple-system, sans-serif" font-weight="500">${p[0]}</text>` : '').join('')}
      </svg>
      <div class="legenda"><span><i style="background:${corR}"></i>Mantendo o ritmo</span><span><i style="background:${corA}"></i>Só o cadastrado</span></div>`;
  } else $('#proj-graf').innerHTML = '<p class="hint">Sem dados.</p>';

  const r = S.config.diaReceb;
  $('#proj-hint').textContent = `Sobra por mês · saldo no dia ${r - 1 || 'anterior'}`;
  const max = Math.max(1, ...linhas.map(l => Math.abs(l.sobra ?? 0)));
  $('#proj').innerHTML = linhas.map(l => `
    <div class="proj-row"><span>${mesCurto(l.a, l.m)}</span>
      <div class="trilho"><div class="fill ${l.sobra < 0 ? 'neg' : ''}" style="width:${l.sobra == null ? 0 : Math.abs(l.sobra) / max * 100}%"></div></div>
      <div class="dir"><b class="num ${l.sobra < 0 ? 'neg' : ''}">${l.sobra == null ? '—' : fmt(l.sobra)}</b><small>fim do mês ${l.fim == null ? '—' : fmt(l.fim)}</small></div>
    </div>`).join('');
}
$('#proj-modo').addEventListener('change', renderProj);
$('#media-input').addEventListener('input', e => {
  const v = parseNum(e.target.value);
  S.config.mediaCartao = isNaN(v) ? null : Math.max(0, v);
  clearTimeout(simTimer); simTimer = setTimeout(salvar, 300);
});

/* ---------------- Tela: Investir ---------------- */
const brNum = v => v.toFixed(2).replace('.', ',');
function renderInv() {
  const h = hojeStr(), ymH = h.slice(0, 7);
  const [ha, hm] = horizonte();
  const C = calcular(S, ha, hm);
  const invs = C.lancs.filter(l => l.tipo === 'investimento').sort((x, y) => y.data.localeCompare(x.data));
  const feitos = invs.filter(l => l.data <= h), futuros = invs.filter(l => l.data > h);
  const soma = arr => arr.reduce((x, l) => x + l.valor, 0);
  $('#inv-resumo').innerHTML = `<div class="kpis">
      <div class="full"><small>Total investido</small><b class="num">${fmt(soma(feitos))}</b></div>
      <div><small>Neste mês</small><b class="num">${fmt(soma(feitos.filter(l => l.data.startsWith(ymH))))}</b></div>
      <div><small>Programado</small><b class="num">${fmt(soma(futuros))}</b></div>
    </div>
    <button class="primario" id="novo-aporte">Novo aporte</button>
    <p class="hint">Cada aporte sai do saldo atual na data informada e soma no total investido.</p>
    <p class="sec-titulo">Aportes</p>
    <div class="cartao-bloco" id="lista-aportes" style="padding-top:2px;padding-bottom:2px">${invs.length ? invs.map(htmlLanc).join('') : '<div class="vazio">Nenhum aporte ainda.</div>'}</div>`;
  $('#novo-aporte').onclick = () => abrirLanc(null, null, 'investimento');
  ligarLancs($('#lista-aportes'), invs);
}

/* ---------------- Tela: Ajustes ---------------- */
const fc = $('#form-cartao');
function resetCartaoForm() {
  fc.reset(); fc.id.value = ''; fc.fecha.value = 31; fc.vence.value = 10;
  $('#cartao-salvar').textContent = 'Adicionar cartão'; $('#cartao-cancelar').hidden = true;
}
function renderCfg() {
  $('#alternar-oculto').textContent = OCULTO ? 'Mostrar valores' : 'Ocultar valores';
  const f = $('#cfg-geral');
  f.data.value = S.saldoInicial.data;
  f.valor.value = brNum(S.saldoInicial.valor);
  f.diaReceb.value = S.config.diaReceb;

  $('#lista-cartoes').innerHTML = S.cartoes.map(c => `
    <div class="linha click" data-cart="${esc(c.id)}"><div class="esq"><span class="av cartao">${EMOJI.cartao}</span><div><div class="t">${esc(c.nome)}</div>
    <small>${c.fecha >= 31 ? 'fecha no fim do mês' : `compras de ${c.fecha + 1} a ${c.fecha}`} · vence dia ${c.vence}</small></div></div>
    <div class="dir" style="color:var(--muted)">›</div></div>`).join('') || '<p class="hint">Nenhum cartão.</p>';
  $$('[data-cart]').forEach(el => el.onclick = () => {
    const c = S.cartoes.find(x => x.id === el.dataset.cart);
    fc.id.value = c.id; fc.nome.value = c.nome; fc.fecha.value = c.fecha; fc.vence.value = c.vence;
    $('#cartao-salvar').textContent = 'Salvar cartão'; $('#cartao-cancelar').hidden = false;
    $('#cartao-cancelar').textContent = 'Remover';
    $('#cartao-cancelar').onclick = () => removerCartao(c.id);
    fc.nome.focus();
  });

  $('#lista-rec').innerHTML = S.recs.map(r => `<div class="linha"><div class="esq"><span class="av ${r.tipo}">${EMOJI[r.tipo]}</span><div style="min-width:0"><div class="t">${esc(r.descricao || ROTULO[r.tipo])}</div>
    <small>${r.tipo === 'cartao' ? esc(nomeCartao(r.cartao)) : ROTULO[r.tipo]} · dia ${Number(r.inicio.slice(8))} · desde ${r.inicio.slice(5, 7)}/${r.inicio.slice(0, 4)}${r.fim ? ' até ' + r.fim.slice(5) + '/' + r.fim.slice(0, 4) : ''}</small></div></div>
    <div class="dir num">${fmt(r.valor)}</div></div>`).join('') || '<p class="hint">Nenhuma. Marque “Repetir todo mês” ao lançar.</p>';
}
function removerCartao(id) {
  const usado = S.lancs.some(l => l.cartao === id) || S.recs.some(r => r.cartao === id);
  if (!confirm(usado ? 'Este cartão tem lançamentos, que também serão apagados. Continuar?' : 'Remover cartão?')) return;
  S.cartoes = S.cartoes.filter(c => c.id !== id);
  S.lancs = S.lancs.filter(l => l.cartao !== id);
  S.recs = S.recs.filter(r => r.cartao !== id);
  resetCartaoForm(); salvar();
}
$('#cfg-geral').onsubmit = e => {
  e.preventDefault();
  const f = e.target, v = parseNum(f.valor.value), r = parseInt(f.diaReceb.value);
  if (isNaN(v)) return alert('Valor inválido');
  if (!(r >= 1 && r <= 28)) return alert('Dia de recebimento deve estar entre 1 e 28');
  S.saldoInicial = { data: f.data.value, valor: v };
  S.config.diaReceb = r;
  salvar();
};
fc.onsubmit = e => {
  e.preventDefault();
  const fecha = parseInt(fc.fecha.value), vence = parseInt(fc.vence.value);
  if (!(fecha >= 1 && fecha <= 31 && vence >= 1 && vence <= 31)) return alert('Dias devem estar entre 1 e 31');
  const dados = { nome: fc.nome.value.trim(), fecha, vence };
  const ex = S.cartoes.find(c => c.id === fc.id.value);
  if (ex) Object.assign(ex, dados); else S.cartoes.push({ id: uid(), ...dados });
  resetCartaoForm(); salvar();
};
$('#exportar').onclick = () => {
  const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `custos-backup-${hojeStr()}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('#importar').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.lancs) || !Array.isArray(d.cartoes) || !d.saldoInicial) throw new Error('arquivo não parece um backup deste app');
    if ((S.lancs.length || S.recs.length) && !confirm('Substituir todos os dados atuais pelo backup?')) return;
    S = migrar(d); salvar();
    { const d0 = new Date(); verA = d0.getFullYear(); verM = d0.getMonth() + 1; }
    $('.tabs button[data-tela="mes"]').click();
    alert(`Backup importado: ${S.lancs.length} lançamentos e ${S.recs.length} recorrências.`);
  } catch (err) { alert('Erro ao importar: ' + err.message); }
  e.target.value = '';
};
$('#apagar').onclick = () => { if (confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) { S = estadoPadrao(); salvar(); } };

/* ---------------- Lançamento ---------------- */
const dlg = $('#dlg'), fl = $('#form-lanc');
let editando = null;   // { id } avulso | { recId, ym } recorrente

// Monta o estado resultante do formulário (sem salvar)
function estadoDoForm() {
  const valor = parseNum(fl.valor.value);
  if (!(valor > 0) || !fl.data.value) return null;
  const tipo = fl.tipo.value;
  const base = { tipo, valor, descricao: fl.descricao.value.trim(), cartao: tipo === 'cartao' ? fl.cartao.value : undefined };
  const nParc = tipo === 'cartao' && !fl.recorrente.checked ? (Number(fl.parcelas.value) || 1) : 1;
  const st = structuredClone(S);
  const original = editando?.id ? S.lancs.find(l => l.id === editando.id) : null;
  if (editando?.id) st.lancs = st.lancs.filter(l => l.id !== editando.id);
  const recAnt = editando?.recId ? st.recs.find(r => r.id === editando.recId) : null;
  if (recAnt && !fl.recorrente.checked && nParc === 1) st.recs = st.recs.filter(r => r.id !== recAnt.id);
  let novo;
  if (nParc > 1) {
    // compra parcelada: valor informado é o total; cada parcela entra numa fatura
    const [a, m] = fl.data.value.split('-').map(Number), [fa, fm] = addMes(a, m, nParc - 1);
    novo = { ...base, valor: Math.round(valor / nParc * 100) / 100, total: valor, parcelado: true, parcelas: nParc, inicio: fl.data.value, fim: ymStr(fa, fm), pular: recAnt?.pular || [] };
    if (recAnt) Object.assign(recAnt, novo); else st.recs.push({ id: uid(), ...novo });
  } else if (fl.recorrente.checked) {
    novo = { ...base, inicio: fl.data.value, fim: fl.fim.value || '', pular: recAnt?.pular || [], parcelado: false, parcelas: 0, total: 0 };
    if (recAnt) Object.assign(recAnt, novo); else st.recs.push({ id: uid(), ...novo });
  } else {
    novo = { id: editando?.id || uid(), ...base, data: fl.data.value };
    if (tipo === 'saida' || tipo === 'entrada') novo.previsto = fl.previsto.checked;
    if (original?.deRec) { novo.deRec = original.deRec; novo.deYm = original.deYm; }
    st.lancs.push(novo);
  }
  return { st, base, recAnt };
}

function atualizarImpacto() {
  $('#campo-cartao').hidden = fl.tipo.value !== 'cartao';
  const nP = Number(fl.parcelas.value) || 1;
  $('#campo-parcelas').hidden = fl.tipo.value !== 'cartao' || fl.recorrente.checked;
  $('#campo-recorrente').hidden = fl.tipo.value === 'cartao' && nP > 1;
  if (fl.tipo.value === 'cartao' && nP > 1) fl.recorrente.checked = false;
  const vT = parseNum(fl.valor.value);
  $('#parc-info').textContent = fl.tipo.value === 'cartao' && nP > 1 && vT > 0 ? `${nP}x de ${fmt(vT / nP)} — informe o valor total da compra` : '';
  $('#campo-fim').hidden = !fl.recorrente.checked;
  $('#campo-previsto').hidden = !['saida', 'entrada'].includes(fl.tipo.value) || fl.recorrente.checked;
  $('#nota-rec-prev').hidden = !(['saida', 'entrada'].includes(fl.tipo.value) && fl.recorrente.checked);
  const r = estadoDoForm();
  if (!r) { $('#impacto').innerHTML = ''; return; }
  const { st, base } = r;
  const cartao = st.cartoes.find(c => c.id === base.cartao);
  const debito = base.tipo === 'cartao' && cartao ? vencimento(fl.data.value, cartao) : fl.data.value;
  const hoje = hojeStr();
  const [ha, hm] = horizonte();
  const de = [hoje, S.saldoInicial.data].sort()[1];
  const ate = fimDoMes(ha, hm);
  const A = calcular(S, ha, hm), B = calcular(st, ha, hm);
  const sd = proximaSobra(S, debito);
  const antes = A.saldoAte(sd), depois = B.saldoAte(sd);
  const nb = B.analisar(de, ate), na = A.analisar(de, ate);
  const ruim = nb.neg && (!na.neg || nb.neg.data < na.neg.data || nb.min.valor < na.min.valor - 0.004);

  let tit;
  if (nb.neg && ruim) tit = `Saldo fica negativo em ${dm(nb.neg.data)}`;
  else if (nb.neg) tit = `Saldo já ficava negativo em ${dm(nb.neg.data)}`;
  else tit = 'Saldo continua positivo nos próximos 12 meses';
  const sa = A.saldoAte(hoje), sb = B.saldoAte(hoje);
  const antesIni = fl.data.value < S.saldoInicial.data;
  $('#impacto').innerHTML = `<div class="impacto ${nb.neg ? 'ruim' : ''}">
    <div class="tit">${tit}</div>
    ${antesIni ? `<div class="l" style="color:var(--laranja)"><span>Data anterior ao saldo inicial (${dm(S.saldoInicial.data)}): não altera o saldo.</span></div>` : ''}
    ${sa != null && Math.abs(sa - sb) > 0.004 ? `<div class="l"><span>Saldo atual</span><b class="num">${fmt(sa)} → <span class="${sb < 0 ? 'neg' : ''}">${fmt(sb)}</span></b></div>` : ''}
    <div class="l"><span>${base.tipo === 'cartao' ? 'Fatura vence' : base.tipo === 'entrada' ? 'Entra em' : 'Sai em'}</span><b>${dm(debito)}</b></div>
    ${antes != null ? `<div class="l"><span>Sobra ${dm(sd)}</span><b class="num">${fmt(antes)} → <span class="${depois < 0 ? 'neg' : ''}">${fmt(depois)}</span></b></div>` : ''}
    ${nb.min.valor != null ? `<div class="l"><span>Menor saldo</span><b class="num ${nb.min.valor < 0 ? 'neg' : ''}">${fmt(nb.min.valor)} · ${dm(nb.min.data)}</b></div>` : ''}
  </div>`;
}
fl.addEventListener('input', atualizarImpacto);
let previstoTocado = false;
fl.previsto.addEventListener('change', () => { previstoTocado = true; });
fl.data.addEventListener('change', () => { if (!previstoTocado && !editando) fl.previsto.checked = fl.data.value > hojeStr(); });
fl.addEventListener('change', atualizarImpacto);

function abrirLanc(id, lista, tipoInicial) {
  fl.reset();
  fl.parcelas.value = '1';
  fl.cartao.innerHTML = S.cartoes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  fl.querySelector('input[value="cartao"]').disabled = !S.cartoes.length;
  const l = id ? (lista || S.lancs).find(x => x.id === id) : null;
  editando = null;
  $('#dlg-excluir').hidden = !l;
  $('#dlg-pular').hidden = !(l && l.recId);
  $('#dlg-titulo').textContent = l ? (l.recId ? 'Editar recorrência' : 'Editar lançamento') : 'Novo lançamento';
  if (l) {
    fl.tipo.value = l.tipo;
    fl.valor.value = brNum(l.valor);
    fl.descricao.value = l.descricao || '';
    fl.previsto.checked = !!l.previsto;
    if (l.cartao) fl.cartao.value = l.cartao;
    if (l.recId) {
      const r = S.recs.find(x => x.id === l.recId);
      editando = { recId: l.recId, ym: l.data.slice(0, 7) };
      fl.data.value = r.inicio;
      if (r.parcelado) {
        const n = totalParcelas(r);
        fl.parcelas.value = String(Math.min(48, n));
        fl.valor.value = brNum(r.total || r.valor * n);
        $('#dlg-titulo').textContent = 'Editar compra parcelada';
        $('#dlg-excluir').textContent = 'Excluir todas as parcelas';
        $('#dlg-pular').hidden = true;
      } else {
        fl.recorrente.checked = true; fl.fim.value = r.fim || '';
        $('#dlg-excluir').textContent = 'Excluir em todos os meses';
      }
    } else {
      editando = { id: l.id };
      fl.data.value = l.data;
      $('#dlg-excluir').textContent = 'Excluir';
    }
  } else {
    const h = hojeStr();
    fl.data.value = tipoInicial || h.startsWith(ymStr(verA, verM)) ? h : `${ymStr(verA, verM)}-01`;
    fl.previsto.checked = fl.data.value > h;
    if (tipoInicial) fl.tipo.value = tipoInicial;
  }
  previstoTocado = false;
  atualizarImpacto();
  dlg.showModal();
  if (!l) fl.valor.focus();
}

fl.parcelas.innerHTML = Array.from({ length: 48 }, (_, i) => `<option value="${i + 1}">${i ? `${i + 1}x` : 'À vista (1x)'}</option>`).join('');
$('#fab').onclick = () => abrirLanc(null);
$('#dlg-cancelar').onclick = () => dlg.close();
$('#dlg-pular').onclick = () => {
  const r = S.recs.find(x => x.id === editando?.recId); if (!r) return;
  r.pular = [...(r.pular || []), editando.ym]; dlg.close(); salvar();
};
$('#dlg-excluir').onclick = () => {
  if (!editando) return;
  if (editando.recId) {
    if (!confirm(S.recs.find(r => r.id === editando.recId)?.parcelado ? 'Excluir todas as parcelas desta compra?' : 'Excluir esta recorrência em todos os meses?')) return;
    S.recs = S.recs.filter(r => r.id !== editando.recId);
  } else {
    const l = S.lancs.find(x => x.id === editando.id);
    if (l?.deRec) { const r = S.recs.find(x => x.id === l.deRec); if (r) r.pular = (r.pular || []).filter(y => y !== l.deYm); }
    S.lancs = S.lancs.filter(x => x.id !== editando.id);
  }
  dlg.close(); salvar();
};
fl.onsubmit = e => {
  e.preventDefault();
  const r = estadoDoForm();
  if (!r) return alert('Informe um valor maior que zero');
  S = r.st;
  if (!r.recAnt) [verA, verM] = fl.data.value.split('-').map(Number);
  dlg.close(); salvar();
};

/* ---------------- Confirmar pagamento ---------------- */
const dc = $('#dlg-conf'), fcf = $('#form-conf');
let confItem = null;
function abrirConfirmar(id, lista) {
  const l = (lista || S.lancs).find(x => x.id === id); if (!l) return;
  confItem = l;
  const ent = l.tipo === 'entrada';
  $('#conf-titulo').textContent = ent ? 'Confirmar recebimento' : 'Confirmar pagamento';
  $('#conf-lbl-valor').firstChild.textContent = ent ? 'Valor recebido' : 'Valor pago';
  $('#conf-lbl-data').firstChild.textContent = ent ? 'Data do recebimento' : 'Data do pagamento';
  $('#conf-zero').textContent = ent ? 'Valor 0 = não recebeu neste mês.' : 'Valor 0 = não houve pagamento neste mês.';
  $('#conf-desc').textContent = l.descricao || ROTULO[l.tipo];
  $('#conf-prev').textContent = `Previsto: ${fmt(l.valor)} em ${dm(l.data)}`;
  fcf.valor.value = brNum(l.valor);
  fcf.data.value = l.data > hojeStr() ? hojeStr() : l.data;
  atualizarConf();
  dc.showModal();
  fcf.valor.select();
}
function atualizarConf() {
  const v = parseNum(fcf.valor.value);
  const dif = v - confItem.valor;
  const bom = confItem.tipo === 'entrada' ? dif > 0 : dif < 0;
  $('#conf-dif').innerHTML = !(v >= 0) ? '' : Math.abs(dif) < 0.005 ? 'Igual ao previsto'
    : `<span class="${bom ? 'pos' : 'neg'}">${fmt(Math.abs(dif))} a ${dif > 0 ? 'mais' : 'menos'} que o previsto</span>`;
}
fcf.addEventListener('input', atualizarConf);
$('#conf-cancelar').onclick = () => dc.close();
fcf.onsubmit = e => {
  e.preventDefault();
  const v = parseNum(fcf.valor.value);
  if (!(v >= 0) || !fcf.data.value) return alert('Informe o valor');
  const l = confItem;
  if (l.recId) {
    const r = S.recs.find(x => x.id === l.recId);
    const ym = l.data.slice(0, 7);
    r.pular = [...new Set([...(r.pular || []), ym])];
    if (v > 0) S.lancs.push({ id: uid(), tipo: r.tipo, valor: v, descricao: r.descricao, data: fcf.data.value, previsto: false, deRec: r.id, deYm: ym });
  } else {
    const a = S.lancs.find(x => x.id === l.id);
    if (v > 0) Object.assign(a, { valor: v, data: fcf.data.value, previsto: false, confirmado: true });
    else S.lancs = S.lancs.filter(x => x.id !== l.id);
  }
  dc.close(); salvar();
};
function pendentes() {
  const d = new Date();
  const C = calcular(S, d.getFullYear(), d.getMonth() + 1);
  const h = hojeStr(), ini = S.saldoInicial.data;
  return { C, lista: C.lancs.filter(l => (l.tipo === 'saida' || l.tipo === 'entrada') && l.previsto && l.data <= h && l.data >= ini).sort((a, b) => a.data.localeCompare(b.data)) };
}
function renderPendentes() {
  const { C, lista } = pendentes();
  $('#pendentes').innerHTML = !lista.length ? '' : `<div class="cartao-bloco pend"><h2>Para confirmar (${lista.length})</h2>
    <p class="hint" style="margin:0 0 4px">Valores previstos cuja data já chegou. Confirme quanto foi de verdade.</p>
    ${lista.map(l => `<div class="linha"><div class="esq"><span class="av previsto">${EMOJI.previsto}</span><div style="min-width:0"><div class="t">${esc(l.descricao || ROTULO[l.tipo])}</div><small>${dm(l.data)} · previsto ${fmt(l.valor)}</small></div></div>
      <div class="dir"><button class="mini forte" data-pend="${esc(l.id)}">Confirmar</button></div></div>`).join('')}</div>`;
  $$('[data-pend]').forEach(b => b.onclick = () => abrirConfirmar(b.dataset.pend, C.lancs));
}

/* ---------------- Render ---------------- */
function render() {
  const t = $('.tabs button.ativa').dataset.tela;
  if (t === 'mes') renderMes();
  if (t === 'sim') renderSim();
  if (t === 'proj') renderProj();
  if (t === 'inv') renderInv();
  if (t === 'cfg') renderCfg();
  if (dlL.open) renderLista();
}
render();

const VERSAO = '2026.11.20-8';
$('#versao-app').textContent = VERSAO;
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').then(reg => reg.update()).catch(() => {});
}
// Força baixar os arquivos novos: atualiza o service worker, limpa o cache
// dos arquivos do app (não os dados, que ficam no localStorage) e recarrega.
$('#atualizar-app').onclick = async () => {
  const b = $('#atualizar-app'); b.textContent = 'Atualizando…'; b.disabled = true;
  try {
    if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  } catch {}
  location.reload();
};

/* ---------------- Código de acesso ----------------
   Guarda só um hash (SHA-256 com sal) do código. Impede que outra pessoa
   abra o app no aparelho; não criptografa os dados salvos no navegador. */
const PIN_KEY = 'posso-gastar-pin';
async function hashPin(pin, salt) {
  const txt = salt + ':' + pin;
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 2166136261; for (const c of txt) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return 'fnv' + h.toString(16);
}
const lerPin = () => { try { return JSON.parse(localStorage.getItem(PIN_KEY)); } catch { return null; } };
const LK = { modo: 'entrar', digitos: '', novo: '', falhas: 0, bloqueadoAte: 0, alterando: false };
const LK_TITULO = { entrar: 'Digite o código', confirmar: 'Confirme o código', atual: 'Digite o código atual' };

function lkMostrar(modo, msg = '', erro = false) {
  LK.modo = modo; LK.digitos = '';
  document.body.classList.add('travado'); $('#lock').hidden = false;
  try { if (dlg.open) dlg.close(); if (dc.open) dc.close(); if (dlL.open) dlL.close(); } catch {}
  $('#lk-titulo').textContent = modo === 'criar' ? (LK.alterando ? 'Digite o novo código' : 'Crie um código de 4 dígitos') : LK_TITULO[modo];
  $('#lk-msg').textContent = msg || (modo === 'criar' && !LK.alterando ? 'Ele será pedido sempre que abrir o app.' : '');
  $('#lk-msg').classList.toggle('erro', erro);
  $('#lk-esqueci').hidden = modo !== 'entrar';
  $('#lk-cancelar').style.visibility = LK.alterando ? 'visible' : 'hidden';
  lkDots();
}
function lkDots() { $$('#lk-dots i').forEach((d, i) => d.classList.toggle('on', i < LK.digitos.length)); }
function lkErro(msg) {
  const d = $('#lk-dots'); d.classList.remove('treme'); void d.offsetWidth; d.classList.add('treme');
  try { navigator.vibrate?.(200); } catch {}
  LK.digitos = ''; lkDots();
  $('#lk-msg').textContent = msg; $('#lk-msg').classList.add('erro');
}
function lkAbrir() {
  document.body.classList.remove('travado'); $('#lock').hidden = true;
  LK.alterando = false; LK.falhas = 0; render();
}
async function lkCompleto() {
  const pin = LK.digitos;
  if (LK.modo === 'criar') { LK.novo = pin; return lkMostrar('confirmar'); }
  if (LK.modo === 'confirmar') {
    if (pin !== LK.novo) return lkMostrar('criar', 'Os códigos não coincidem. Tente de novo.', true);
    const salt = uid();
    localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
    const alterou = LK.alterando;
    lkAbrir();
    if (alterou) alert('Código alterado.');
    return;
  }
  const p = lerPin();
  if (p && await hashPin(pin, p.salt) === p.hash) { LK.falhas = 0; return LK.modo === 'atual' ? lkMostrar('criar') : lkAbrir(); }
  LK.falhas++;
  if (LK.falhas >= 5) {
    const seg = 30 * 2 ** (LK.falhas - 5);
    LK.bloqueadoAte = Date.now() + seg * 1000;
    return lkErro(`Muitas tentativas. Aguarde ${seg} s.`);
  }
  lkErro(`Código incorreto. ${5 - LK.falhas} tentativa${5 - LK.falhas > 1 ? 's' : ''} antes de bloquear.`);
}
$$('#lk-teclado [data-d]').forEach(b => b.onclick = () => {
  if (Date.now() < LK.bloqueadoAte) return lkErro(`Aguarde ${Math.ceil((LK.bloqueadoAte - Date.now()) / 1000)} s.`);
  if (LK.digitos.length >= 4) return;
  LK.digitos += b.dataset.d; lkDots();
  if (LK.digitos.length === 4) setTimeout(lkCompleto, 120);
});
$('#lk-apagar').onclick = () => { LK.digitos = LK.digitos.slice(0, -1); lkDots(); };
$('#lk-cancelar').onclick = () => lkAbrir();
$('#lk-esqueci').onclick = () => {
  if (!confirm('Sem o código não é possível abrir os dados.\n\nApagar TODOS os dados deste aparelho e criar um código novo? Se você tem um backup exportado, poderá importá-lo depois.')) return;
  localStorage.removeItem(PIN_KEY); localStorage.removeItem(KEY);
  S = estadoPadrao(); LK.falhas = 0; LK.bloqueadoAte = 0;
  lkMostrar('criar');
};
document.addEventListener('keydown', e => {
  if ($('#lock').hidden) return;
  if (/^\d$/.test(e.key)) $(`#lk-teclado [data-d="${e.key}"]`).click();
  else if (e.key === 'Backspace') $('#lk-apagar').click();
});
$('#alternar-oculto').onclick = alternarOculto;
$('#alterar-pin').onclick = () => { LK.alterando = true; lkMostrar('atual'); };
let saiuEm = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) saiuEm = Date.now();
  else if (saiuEm && Date.now() - saiuEm > 60000 && lerPin() && $('#lock').hidden) { LK.alterando = false; lkMostrar('entrar'); }
});
lkMostrar(lerPin() ? 'entrar' : 'criar');

/* ---------------- Teclado no iPhone ----------------
   As folhas acompanham a área visível (visualViewport): quando o teclado
   abre, a folha encolhe e o campo em foco é rolado para o meio da tela. */
function ajustarViewport() {
  const vv = window.visualViewport; if (!vv) return;
  document.documentElement.style.setProperty('--vvh', vv.height + 'px');
  document.documentElement.style.setProperty('--vvt', vv.offsetTop + 'px');
}
if (window.visualViewport) {
  visualViewport.addEventListener('resize', ajustarViewport);
  visualViewport.addEventListener('scroll', ajustarViewport);
  ajustarViewport();
}
document.addEventListener('focusin', e => {
  const el = e.target;
  if (!el.matches || !el.matches('input, select, textarea')) return;
  if (el.type === 'radio' || el.type === 'checkbox' || el.type === 'file') return;
  setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch {} }, 320);
});
