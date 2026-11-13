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
const fmt = v => BRL.format(Math.round(v * 100) / 100 + 0);
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
const ROTULO = { entrada: 'Entrada', saida: 'Saída', cartao: 'Cartão', investimento: 'Investimento' };

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
const salvar = () => {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Não foi possível salvar: ' + e.message); }
  render();
};

/* ---------------- Motor de cálculo ---------------- */

function ocorrenciasRec(st, ateA, ateM) {
  const out = [];
  for (const r of st.recs) {
    let [a, m, dia] = r.inicio.split('-').map(Number);
    let guard = 0;
    while ((a < ateA || (a === ateA && m <= ateM)) && guard++ < 1200) {
      const ym = ymStr(a, m);
      if (r.fim && ym > r.fim) break;
      if (!(r.pular || []).includes(ym)) {
        out.push({ ...r, id: `rec:${r.id}:${ym}`, recId: r.id, previsto: r.tipo === 'saida', data: `${ym}-${pad(Math.min(dia, diasNoMes(a, m)))}` });
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
const EMOJI = { entrada: '💰', saida: '💸', cartao: '💳', investimento: '🌱', fatura: '🧾' };
function humor(v) {
  if (v < 0) return { e: '😬', t: 'Vai faltar' };
  if (v < 500) return { e: '🙂', t: 'Sobra apertada' };
  if (v < 3000) return { e: '😄', t: 'Sobra para aplicar' };
  return { e: '🤑', t: 'Sobra para aplicar' };
}
function renderMes() {
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

  if (sobra == null) $('#hero').innerHTML = '';
  else {
    const h = humor(sobra);
    $('#hero').innerHTML = `<div class="hero ${sobra < 0 ? 'ruim' : ''}">
      <span class="emoji">${h.e}</span>
      <small>${h.t}</small>
      <div class="valor num">${fmt(Math.abs(sobra))}</div>
      <div class="sub">em ${Number(sobraD.slice(8))} de ${nomeProx}, depois das contas do início do mês</div>
    </div>`;
  }

  const de = `${ym}-01` < ini ? ini : `${ym}-01`;
  const { neg } = de <= sobraD ? C.analisar(de, sobraD) : { neg: null };
  $('#alerta').innerHTML = neg ? `<div class="alerta">🚨 Saldo fica negativo em ${dm(neg.data)} (${fmt(neg.valor)})</div>` : '';
  renderPendentes();

  let ent = 0, sai = 0, inv = 0, prevMes = 0;
  const dias = [...C.porDia.keys()].filter(d => d.startsWith(ym)).sort();
  for (const d of dias) {
    if (d < ini) continue;
    const o = C.porDia.get(d);
    for (const l of o.itens) {
      if (l.tipo === 'entrada') ent += l.valor;
      if (l.tipo === 'saida') { sai += l.valor; if (l.previsto) prevMes += l.valor; }
      if (l.tipo === 'investimento') inv += l.valor;
    }
    for (const v of Object.values(o.faturas)) sai += v;
  }
  const sFim = C.saldoAte(fim);
  $('#numeros').innerHTML = ini > fim ? '' : `<div class="numeros">
      <div><span class="ic">💰</span><small>Entradas</small><b class="num pos">${fmt(ent)}</b></div>
      <div><span class="ic">💸</span><small>Saídas</small><b class="num">${fmt(sai)}</b></div>
      <div><span class="ic">🏦</span><small>Saldo final</small><b class="num ${sFim < 0 ? 'neg' : ''}">${sFim == null ? '—' : fmt(sFim)}</b></div>
    </div>${inv || prevMes ? `<p class="hint" style="margin:-12px 0 20px;text-align:center">${inv ? `🌱 Investido no mês: <b class="pos">${fmt(inv)}</b>` : ''}${inv && prevMes ? ' · ' : ''}${prevMes ? `🕒 Saídas previstas: <b>${fmt(prevMes)}</b>` : ''}</p>` : ''}`;

  const fats = [];
  for (const [d, o] of C.porDia) {
    if (!d.startsWith(ymStr(na, nm))) continue;
    for (const [c, v] of Object.entries(o.faturas)) fats.push({ d, c, v });
  }
  fats.sort((a, b) => a.d.localeCompare(b.d));
  $('#faturas').innerHTML = fats.length ? `<div class="cartao-bloco"><h2>🧾 Faturas de ${nomeProx}</h2>${fats.map(f => `
      <div class="linha"><div class="esq"><span class="av fatura">💳</span><div><div class="t">${esc(nomeCartao(f.c))}</div><small>vence ${dm(f.d)}</small></div></div>
      <div class="dir num">${fmt(f.v)}</div></div>`).join('')}</div>` : '';

  const antes = ini > fim ? `<div class="info">📜 Histórico: este mês é anterior ao saldo inicial (${dm(ini)}/${ini.slice(0, 4)}), então não afeta o saldo.</div>` : '';
  if (!dias.length) { $('#dias').innerHTML = antes + '<div class="vazio"><span class="big">🍃</span>Nada por aqui ainda.<br>Toque no + para lançar.</div>'; return; }

  const ordem = 'entrada saida investimento cartao';
  $('#dias').innerHTML = antes + '<h2>📒 Lançamentos</h2>' + dias.map(d => {
    const o = C.porDia.get(d);
    const saldo = C.saldoAte(d);
    const [a, m, dd] = d.split('-').map(Number);
    const sem = SEM[new Date(a, m - 1, dd).getDay()];
    const itens = o.itens.slice().sort((x, y) => ordem.indexOf(x.tipo) - ordem.indexOf(y.tipo)).map(l => {
      const sinal = l.tipo === 'entrada' ? '+' : l.tipo === 'cartao' ? '' : '−';
      const cart = S.cartoes.find(c => c.id === l.cartao);
      const sub = l.tipo === 'cartao' ? `${nomeCartao(l.cartao)}${cart ? ' · fatura ' + dm(vencimento(l.data, cart)) : ''}` : (l.descricao ? ROTULO[l.tipo] : '');
      const prev = l.tipo === 'saida' && l.previsto;
      return `<div class="linha click ${prev ? 'previsto' : ''}" data-id="${esc(l.id)}">
        <div class="esq"><span class="av ${l.tipo}">${prev ? '🕒' : EMOJI[l.tipo]}</span><div style="min-width:0"><div class="t">${esc(l.descricao || ROTULO[l.tipo])}${l.recId || l.deRec ? ' 🔁' : ''}</div>${prev ? '<small><span class="selo">previsto</span></small>' : l.tipo === 'saida' && (l.deRec || l.confirmado) ? '<small><span class="selo ok">pago ✓</span></small>' : sub ? `<small>${esc(sub)}</small>` : ''}</div></div>
        <div class="dir num ${l.tipo === 'entrada' || l.tipo === 'investimento' ? 'pos' : ''}" style="${l.tipo === 'cartao' ? 'color:var(--roxo)' : ''}">${sinal}${fmt(l.valor)}${prev ? `<button class="mini" data-conf="${esc(l.id)}">Confirmar</button>` : ''}</div></div>`;
    }).join('');
    const fts = Object.entries(o.faturas).map(([c, v]) => `
      <div class="linha"><div class="esq"><span class="av fatura">🧾</span><div><div class="t">Fatura ${esc(nomeCartao(c))}</div><small>pagamento</small></div></div>
      <div class="dir num">−${fmt(v)}</div></div>`).join('');
    return `<div class="dia"><div class="dia-head${saldo != null && saldo < 0 ? ' neg' : ''}"><span class="${d === hoje ? 'hoje' : ''}">${d === hoje ? 'hoje' : sem}, ${dd}</span><span>saldo <b class="num">${saldo == null ? '—' : fmt(saldo)}</b></span></div>${itens}${fts}</div>`;
  }).join('');

  $$('#dias .linha.click').forEach(el => el.onclick = () => abrirLanc(el.dataset.id, C.lancs));
  $$('[data-conf]').forEach(b => b.onclick = e => { e.stopPropagation(); abrirConfirmar(b.dataset.conf, C.lancs); });
}

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
  $('#sim-limite').innerHTML = `<div class="limite"><span class="ic">🎯</span><div><small>Dá para gastar ${como}${p.n > 1 ? ` em ${p.n}x` : ''} até${p.reserva ? ` (guardando ${fmt(p.reserva)})` : ''}</small><b class="num">${fmt(max)}</b></div></div>`;
  if (!(p.valor > 0)) { $('#sim-out').innerHTML = '<div class="vazio"><span class="big">✍️</span>Digite um valor para simular.</div>'; return; }

  const A = calcular(S, J.ha, J.hm), B = calcular(comCompra(S, p, p.valor), J.ha, J.hm);
  const rb = B.analisar(J.de, J.ate);
  const cart = S.cartoes.find(c => c.id === p.cartao);
  const debito = p.forma === 'cartao' ? vencimento(p.data, cart) : p.data;
  const sd = proximaSobra(S, debito);
  const abaixo = rb.min.valor != null && rb.min.valor < p.reserva - 0.004;
  let em, tit, txt;
  if (rb.neg) { em = '😱'; tit = 'Melhor não!'; txt = `O saldo fica negativo em ${dm(rb.neg.data)} (${fmt(rb.neg.valor)}).`; }
  else if (abaixo) { em = '😅'; tit = 'Até dá, mas aperta'; txt = `O saldo cai para ${fmt(rb.min.valor)} em ${dm(rb.min.data)}, abaixo do mínimo que você quer guardar.`; }
  else { em = '🥳'; tit = 'Pode gastar!'; txt = `O menor saldo fica em ${fmt(rb.min.valor)} (${dm(rb.min.data)}).`; }

  // gráfico: saldo antes x depois, de hoje até o horizonte
  const pts = []; for (let d = J.de, i = 0; d <= J.ate && i < 400; d = addDias(d, 3), i++) pts.push([d, A.saldoAte(d), B.saldoAte(d)]);
  const vals = pts.flatMap(x => [x[1], x[2]]).filter(v => v != null);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const W = 600, H = 190, P = 6;
  const x = i => P + (W - 2 * P) * i / Math.max(1, pts.length - 1), y = v => H - P - (H - 2 * P) * (v - lo) / (hi - lo);
  const linha = k => pts.map((q, i) => `${x(i).toFixed(1)},${y(q[k] ?? 0).toFixed(1)}`).join(' ');

  $('#sim-out').innerHTML = `
    <div class="veredito ${rb.neg || abaixo ? 'ruim' : ''}"><span class="em">${em}</span><b>${tit}</b><p>${txt}</p></div>
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
    else { const [a, m] = p.data.split('-').map(Number); const [fa, fm] = addMes(a, m, p.n - 1); S.recs.push({ id: uid(), ...base, descricao: (p.descricao || 'Compra') + ` (${p.n}x)`, inicio: p.data, fim: ymStr(fa, fm), pular: [] }); }
    fs.valor.value = ''; fs.descricao.value = '';
    salvar();
    alert('Compra registrada! ✅');
  };
}
let simTimer;
fs.addEventListener('input', () => { clearTimeout(simTimer); simTimer = setTimeout(atualizarSim, 150); });

/* ---------------- Tela: Projeção ---------------- */
function renderProj() {
  const d = new Date();
  const [a0, m0] = [d.getFullYear(), d.getMonth() + 1];
  const [ha, hm] = horizonte();
  const C = calcular(S, ha, hm);
  const r = S.config.diaReceb;
  $('#proj-hint').textContent = r > 1
    ? `Sobra = saldo no dia ${r - 1}, depois das contas do início do mês e antes dos recebimentos do dia ${r}.`
    : 'Sobra = saldo no último dia do mês anterior.';
  const linhas = [];
  for (let k = 0; k < 12; k++) {
    const [a, m] = addMes(a0, m0, k);
    linhas.push({ a, m, sobra: C.saldoAte(dataSobra(S, a, m)), fim: C.saldoAte(fimDoMes(a, m)) });
  }
  const max = Math.max(1, ...linhas.map(l => Math.abs(l.sobra ?? 0)));
  $('#proj').innerHTML = linhas.map(l => `
    <div class="proj-row"><span>${mesCurto(l.a, l.m)}</span>
      <div class="trilho"><div class="fill ${l.sobra < 0 ? 'neg' : ''}" style="width:${l.sobra == null ? 0 : Math.abs(l.sobra) / max * 100}%"></div></div>
      <div class="dir"><b class="num ${l.sobra < 0 ? 'neg' : ''}">${l.sobra == null ? '—' : fmt(l.sobra)}</b><small>fim do mês ${l.fim == null ? '—' : fmt(l.fim)}</small></div>
    </div>`).join('');
}

/* ---------------- Tela: Investir ---------------- */
function infoInvest() {
  const h = hojeStr();
  const [ha, hm] = horizonte();
  const C = calcular(S, ha, hm);
  const invs = C.lancs.filter(l => l.tipo === 'investimento' && l.data <= h);
  const total = invs.reduce((s, l) => s + l.valor, 0);
  const sd = proximaSobra(S, h);
  return { total, sobraData: sd, sobra: C.saldoAte(sd) };
}
function renderInv() {
  const r = infoInvest();
  $('#inv-resumo').innerHTML = `<div class="kpis" style="margin-bottom:28px">
      <div><small>🌱 Já investido</small><b class="num pos">${fmt(r.total)}</b></div>
      <div><small>🎯 Sobra em ${dm(r.sobraData)}</small><b class="num ${r.sobra < 0 ? 'neg' : ''}">${r.sobra == null ? '—' : fmt(r.sobra)}</b></div>
    </div>`;
}
const brNum = v => v.toFixed(2).replace('.', ',');
$('#usar-sobra').onclick = () => { const r = infoInvest(); $('#calc').aporte.value = brNum(Math.max(0, r.sobra || 0)); calcularInvestimento(); };
$('#usar-aportes').onclick = () => { $('#calc').inicial.value = brNum(infoInvest().total); calcularInvestimento(); };
$('#calc').onsubmit = e => { e.preventDefault(); calcularInvestimento(); };

function calcularInvestimento() {
  const f = $('#calc');
  const inicial = parseNum(f.inicial.value) || 0;
  const aporte = parseNum(f.aporte.value) || 0;
  const taxa = parseNum(f.taxa.value) || 0;
  const ir = Math.min(100, Math.max(0, parseNum(f.ir.value) || 0));
  let n = Math.round(parseNum(f.prazo.value) || 0);
  if (f.unidade.value === 'a') n *= 12;
  if (n <= 0 || n > 1200) { $('#calc-out').innerHTML = '<p class="hint">Informe um prazo entre 1 e 1200 meses.</p>'; return; }
  const im = f.periodo.value === 'am' ? taxa / 100 : Math.pow(1 + taxa / 100, 1 / 12) - 1;
  const ia = Math.pow(1 + im, 12) - 1;

  // juros compostos mensais; aporte no fim de cada mês
  let saldo = inicial; const serie = [[0, inicial, inicial]];
  for (let k = 1; k <= n; k++) { saldo = saldo * (1 + im) + aporte; serie.push([k, inicial + aporte * k, saldo]); }
  const investido = inicial + aporte * n;
  const juros = saldo - investido;
  const imposto = juros > 0 ? juros * ir / 100 : 0;
  const liquido = saldo - imposto;

  const W = 600, H = 200, P = 4;
  const maxV = Math.max(1, ...serie.map(s => Math.max(s[1], s[2])));
  const x = k => P + (W - 2 * P) * k / n, y = v => H - P - (H - 2 * P) * v / maxV;
  const linha = i => serie.map(s => `${x(s[0]).toFixed(1)},${y(s[i]).toFixed(1)}`).join(' ');

  const passo = n > 36 ? 12 : 1;
  const tab = serie.filter(s => s[0] > 0 && (s[0] % passo === 0 || s[0] === n)).map(s =>
    `<tr><td>${passo === 12 ? `Ano ${+(s[0] / 12).toFixed(1)}` : `Mês ${s[0]}`}</td><td>${fmt(s[1])}</td><td>${fmt(s[2] - s[1])}</td><td>${fmt(s[2])}</td></tr>`).join('');

  $('#calc-out').innerHTML = `
    <div class="kpis">
      <div class="full"><small>Valor final ${ir ? 'líquido' : ''} em ${n} meses</small><b class="num">${fmt(ir ? liquido : saldo)}</b></div>
      <div><small>Total investido</small><b class="num">${fmt(investido)}</b></div>
      <div><small>Juros</small><b class="num pos">${fmt(juros)}</b></div>
      ${ir ? `<div><small>Imposto (${ir}%)</small><b class="num neg">−${fmt(imposto)}</b></div><div><small>Valor bruto</small><b class="num">${fmt(saldo)}</b></div>` : ''}
    </div>
    <p class="hint">Equivale a ${(im * 100).toFixed(4).replace('.', ',')}% a.m. ou ${(ia * 100).toFixed(2).replace('.', ',')}% a.a.</p>
    <svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do investimento" style="stroke:none">
      <polygon points="${P},${H - P} ${linha(2)} ${x(n)},${H - P}" fill="var(--acc-soft)"/>
      <polyline points="${linha(2)}" fill="none" stroke="var(--acc)" stroke-width="2.5"/>
      <polyline points="${linha(1)}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="5 5"/>
    </svg>
    <div class="legenda"><span><i style="background:var(--acc)"></i>Com juros</span><span><i style="background:var(--muted)"></i>Investido</span></div>
    <div class="scroll"><table class="tab"><thead><tr><th></th><th>Investido</th><th>Juros</th><th>Saldo</th></tr></thead><tbody>${tab}</tbody></table></div>`;
}

/* ---------------- Tela: Ajustes ---------------- */
const fc = $('#form-cartao');
function resetCartaoForm() {
  fc.reset(); fc.id.value = ''; fc.fecha.value = 31; fc.vence.value = 10;
  $('#cartao-salvar').textContent = 'Adicionar cartão'; $('#cartao-cancelar').hidden = true;
}
function renderCfg() {
  const f = $('#cfg-geral');
  f.data.value = S.saldoInicial.data;
  f.valor.value = brNum(S.saldoInicial.valor);
  f.diaReceb.value = S.config.diaReceb;

  $('#lista-cartoes').innerHTML = S.cartoes.map(c => `
    <div class="linha click" data-cart="${esc(c.id)}"><div class="esq"><span class="av cartao">💳</span><div><div class="t">${esc(c.nome)}</div>
    <small>${c.fecha >= 31 ? 'fecha no fim do mês' : `compras de ${c.fecha + 1} a ${c.fecha}`} · vence dia ${c.vence}</small></div></div>
    <div class="dir hint" style="margin:0">editar ✏️</div></div>`).join('') || '<p class="hint">Nenhum cartão.</p>';
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
    if (!confirm('Substituir todos os dados atuais pelo backup?')) return;
    S = migrar(d); salvar();
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
  const st = structuredClone(S);
  const original = editando?.id ? S.lancs.find(l => l.id === editando.id) : null;
  if (editando?.id) st.lancs = st.lancs.filter(l => l.id !== editando.id);
  const recAnt = editando?.recId ? st.recs.find(r => r.id === editando.recId) : null;
  if (recAnt && !fl.recorrente.checked) st.recs = st.recs.filter(r => r.id !== recAnt.id);
  let novo;
  if (fl.recorrente.checked) {
    novo = { ...base, inicio: fl.data.value, fim: fl.fim.value || '', pular: recAnt?.pular || [] };
    if (recAnt) Object.assign(recAnt, novo); else st.recs.push({ id: uid(), ...novo });
  } else {
    novo = { id: editando?.id || uid(), ...base, data: fl.data.value };
    if (tipo === 'saida') novo.previsto = fl.previsto.checked;
    if (original?.deRec) { novo.deRec = original.deRec; novo.deYm = original.deYm; }
    st.lancs.push(novo);
  }
  return { st, base, recAnt };
}

function atualizarImpacto() {
  $('#campo-cartao').hidden = fl.tipo.value !== 'cartao';
  $('#campo-fim').hidden = !fl.recorrente.checked;
  $('#campo-previsto').hidden = fl.tipo.value !== 'saida' || fl.recorrente.checked;
  $('#nota-rec-prev').hidden = !(fl.tipo.value === 'saida' && fl.recorrente.checked);
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
  $('#impacto').innerHTML = `<div class="impacto ${nb.neg ? 'ruim' : ''}">
    <div class="tit">${tit}</div>
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

function abrirLanc(id, lista) {
  fl.reset();
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
      fl.data.value = r.inicio; fl.recorrente.checked = true; fl.fim.value = r.fim || '';
      $('#dlg-excluir').textContent = 'Excluir em todos os meses';
    } else {
      editando = { id: l.id };
      fl.data.value = l.data;
      $('#dlg-excluir').textContent = 'Excluir';
    }
  } else {
    const h = hojeStr();
    fl.data.value = h.startsWith(ymStr(verA, verM)) ? h : `${ymStr(verA, verM)}-01`;
    fl.previsto.checked = fl.data.value > h;
  }
  previstoTocado = false;
  atualizarImpacto();
  dlg.showModal();
  if (!l) fl.valor.focus();
}

$('#fab').onclick = () => abrirLanc(null);
$('#dlg-cancelar').onclick = () => dlg.close();
$('#dlg-pular').onclick = () => {
  const r = S.recs.find(x => x.id === editando?.recId); if (!r) return;
  r.pular = [...(r.pular || []), editando.ym]; dlg.close(); salvar();
};
$('#dlg-excluir').onclick = () => {
  if (!editando) return;
  if (editando.recId) {
    if (!confirm('Excluir esta recorrência em todos os meses?')) return;
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
  $('#conf-desc').textContent = l.descricao || 'Saída';
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
  $('#conf-dif').innerHTML = !(v >= 0) ? '' : Math.abs(dif) < 0.005 ? '👌 Igual ao previsto'
    : dif > 0 ? `<span class="neg">😕 ${fmt(dif)} a mais que o previsto</span>` : `<span class="pos">🎉 ${fmt(-dif)} a menos que o previsto</span>`;
}
fcf.addEventListener('input', atualizarConf);
$('#conf-cancelar').onclick = () => dc.close();
fcf.onsubmit = e => {
  e.preventDefault();
  const v = parseNum(fcf.valor.value);
  if (!(v >= 0) || !fcf.data.value) return alert('Informe o valor pago');
  const l = confItem;
  if (l.recId) {
    const r = S.recs.find(x => x.id === l.recId);
    const ym = l.data.slice(0, 7);
    r.pular = [...new Set([...(r.pular || []), ym])];
    if (v > 0) S.lancs.push({ id: uid(), tipo: 'saida', valor: v, descricao: r.descricao, data: fcf.data.value, previsto: false, deRec: r.id, deYm: ym });
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
  return { C, lista: C.lancs.filter(l => l.tipo === 'saida' && l.previsto && l.data <= h && l.data >= ini).sort((a, b) => a.data.localeCompare(b.data)) };
}
function renderPendentes() {
  const { C, lista } = pendentes();
  $('#pendentes').innerHTML = !lista.length ? '' : `<div class="cartao-bloco pend"><h2>🔔 Para confirmar (${lista.length})</h2>
    <p class="hint" style="margin-top:-6px">Saídas previstas que já venceram. Confirme o valor que foi pago de verdade.</p>
    ${lista.map(l => `<div class="linha"><div class="esq"><span class="av saida">🕒</span><div style="min-width:0"><div class="t">${esc(l.descricao || 'Saída')}</div><small>${dm(l.data)} · previsto ${fmt(l.valor)}</small></div></div>
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
}
render();
calcularInvestimento();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
