'use strict';

/* ============================================================
   Custos Pessoais — controle de gastos + calculadora de investimento
   Lógica baseada na planilha "CUSTOS - PESSOAIS":
   - SALDO (1ª col.) = entradas do dia
   - SAÍDAS          = débitos à vista (células verde-claro = investimento)
   - C6 / LATAM      = compras no cartão; NÃO alteram o saldo do dia.
                       O total do mês vira fatura, debitada no vencimento
                       do mês seguinte (LATAM dia 1, C6 dia 10).
   - SALDO (última)  = saldo anterior + entradas − saídas
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
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function parseNum(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  return parseFloat(s);
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- Estado ---------------- */
function estadoPadrao() {
  const d = new Date();
  return {
    saldoInicial: { data: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`, valor: 0 },
    cartoes: [
      { id: 'c6', nome: 'C6', fecha: 31, vence: 10 },
      { id: 'latam', nome: 'LATAM', fecha: 31, vence: 1 },
    ],
    lancs: [],
    recs: [],
  };
}
let S;
try { S = JSON.parse(localStorage.getItem(KEY)) || estadoPadrao(); } catch { S = estadoPadrao(); }
const salvar = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { alert('Não foi possível salvar: ' + e.message); } render(); };

/* ---------------- Motor de cálculo ---------------- */

// Gera ocorrências de recorrências até o mês (a, m) inclusive
function ocorrenciasRec(ateA, ateM) {
  const out = [];
  for (const r of S.recs) {
    let [a, m] = r.inicio.split('-').map(Number);
    const dia = Number(r.inicio.split('-')[2]);
    let guard = 0;
    while ((a < ateA || (a === ateA && m <= ateM)) && guard++ < 1200) {
      const ym = ymStr(a, m);
      if (r.fim && ym > r.fim) break;
      if (!(r.pular || []).includes(ym)) {
        out.push({ ...r, id: `rec:${r.id}:${ym}`, recId: r.id, data: `${ym}-${pad(Math.min(dia, diasNoMes(a, m)))}` });
      }
      [a, m] = addMes(a, m, 1);
    }
  }
  return out;
}

// Data de pagamento da fatura de uma compra no cartão
function vencimento(compraData, cartao) {
  let [a, m, d] = compraData.split('-').map(Number);
  const fechaEste = Math.min(cartao.fecha, diasNoMes(a, m));
  let [fa, fm] = d <= fechaEste ? [a, m] : addMes(a, m, 1);
  const diaFecha = Math.min(cartao.fecha, diasNoMes(fa, fm));
  let [va, vm] = cartao.vence > diaFecha ? [fa, fm] : addMes(fa, fm, 1);
  return `${ymStr(va, vm)}-${pad(Math.min(cartao.vence, diasNoMes(va, vm)))}`;
}

// Todos os lançamentos (avulsos + recorrentes) até o mês informado
function todosLancs(ateA, ateM) {
  return [...S.lancs, ...ocorrenciasRec(ateA, ateM)];
}

/* Calcula, para um intervalo, os movimentos por dia e o saldo final de cada dia.
   Retorna { porDia: Map(data -> {itens, faturas, delta}), saldoAte(data) } */
function calcular(ateA, ateM) {
  const [xa, xm] = addMes(ateA, ateM, 0);
  const lancs = todosLancs(xa, xm);
  const cartoes = Object.fromEntries(S.cartoes.map(c => [c.id, c]));
  const porDia = new Map();
  const get = d => { if (!porDia.has(d)) porDia.set(d, { itens: [], faturas: {}, delta: 0 }); return porDia.get(d); };

  for (const l of lancs) {
    if (l.tipo === 'cartao') {
      get(l.data).itens.push(l);
      const c = cartoes[l.cartao];
      if (!c) continue;
      const v = vencimento(l.data, c);
      const dd = get(v);
      dd.faturas[c.id] = (dd.faturas[c.id] || 0) + l.valor;
    } else {
      get(l.data).itens.push(l);
    }
  }
  const ini = S.saldoInicial.data;
  for (const [d, o] of porDia) {
    if (d < ini) { o.delta = 0; continue; }
    let delta = 0;
    for (const l of o.itens) {
      if (l.tipo === 'entrada') delta += l.valor;
      else if (l.tipo === 'saida' || l.tipo === 'investimento') delta -= l.valor;
    }
    for (const v of Object.values(o.faturas)) delta -= v;
    o.delta = delta;
  }
  const datas = [...porDia.keys()].filter(d => d >= ini).sort();
  const acum = []; let s = S.saldoInicial.valor;
  for (const d of datas) { s += porDia.get(d).delta; acum.push([d, s]); }
  function saldoAte(data) {          // saldo no fim do dia "data"
    if (data < ini) return null;
    let r = S.saldoInicial.valor;
    for (const [d, v] of acum) { if (d <= data) r = v; else break; }
    return r;
  }
  return { porDia, saldoAte, lancs };
}

/* ---------------- UI: navegação ---------------- */
let verA, verM;
{ const d = new Date(); verA = d.getFullYear(); verM = d.getMonth() + 1; }

$$('.tabs button').forEach(b => b.onclick = () => {
  $$('.tabs button').forEach(x => x.classList.toggle('ativa', x === b));
  $$('.tela').forEach(t => t.classList.toggle('ativa', t.id === 'tela-' + b.dataset.tela));
  $('#fab').hidden = !['mes', 'proj'].includes(b.dataset.tela);
  render();
});
$('#mes-ant').onclick = () => { [verA, verM] = addMes(verA, verM, -1); render(); };
$('#mes-prox').onclick = () => { [verA, verM] = addMes(verA, verM, 1); render(); };

/* ---------------- UI: Mês ---------------- */
const nomeCartao = id => (S.cartoes.find(c => c.id === id) || { nome: '?' }).nome;
const ROTULO = { entrada: 'Entrada', saida: 'Saída', cartao: 'Cartão', investimento: 'Investimento' };

function renderMes() {
  $('#mes-nome').textContent = `${MESES[verM - 1]} ${verA}`;
  const C = calcular(verA, verM);
  const ym = ymStr(verA, verM);
  const [pa, pm] = addMes(verA, verM, -1);
  const fimAnt = `${ymStr(pa, pm)}-${pad(diasNoMes(pa, pm))}`;
  const fimMes = `${ym}-${pad(diasNoMes(verA, verM))}`;
  const ini = S.saldoInicial.data;

  let ent = 0, sai = 0, inv = 0, fat = 0; const cartMes = {}; const fatMes = {};
  const dias = [...C.porDia.keys()].filter(d => d.startsWith(ym)).sort();
  for (const d of dias) {
    const o = C.porDia.get(d);
    for (const l of o.itens) {
      if (l.tipo === 'cartao') { cartMes[l.cartao] = (cartMes[l.cartao] || 0) + l.valor; continue; }
      if (d < ini) continue;
      if (l.tipo === 'entrada') ent += l.valor;
      if (l.tipo === 'saida') sai += l.valor;
      if (l.tipo === 'investimento') inv += l.valor;
    }
    if (d >= ini) for (const [c, v] of Object.entries(o.faturas)) { fat += v; fatMes[c] = (fatMes[c] || 0) + v; }
  }
  const sIni = fimAnt < ini ? (ym === ini.slice(0, 7) ? S.saldoInicial.valor : null) : C.saldoAte(fimAnt);
  const sFim = C.saldoAte(fimMes);

  $('#resumo').innerHTML = `
    <div class="kpi destaque"><small>Saldo no fim do mês</small><b>${sFim == null ? '—' : fmt(sFim)}</b></div>
    <div class="kpi"><small>Saldo inicial do mês</small><b>${sIni == null ? '—' : fmt(sIni)}</b></div>
    <div class="kpi"><small>Entradas</small><b class="pos">${fmt(ent)}</b></div>
    <div class="kpi"><small>Saídas à vista</small><b class="neg">${fmt(sai)}</b></div>
    <div class="kpi"><small>Faturas pagas</small><b class="fat-cor">${fmt(fat)}</b></div>
    <div class="kpi inv"><small>Investido no mês</small><b class="inv-cor">${fmt(inv)}</b></div>
    <div class="kpi"><small>Gastos no cartão</small><b class="cartao-cor">${fmt(Object.values(cartMes).reduce((a, b) => a + b, 0))}</b></div>`;

  const linhasCart = S.cartoes.map(c => {
    const g = cartMes[c.id] || 0, f = fatMes[c.id] || 0;
    return (g || f) ? `<div class="item"><div><b>${esc(c.nome)}</b><small>fecha dia ${c.fecha} · vence dia ${c.vence}</small></div>
      <div style="text-align:right"><small>compras no mês</small><span class="cartao-cor">${fmt(g)}</span><small>fatura paga no mês</small><span class="fat-cor">${fmt(f)}</span></div></div>` : '';
  }).join('');
  $('#faturas').innerHTML = linhasCart ? `<div class="card"><h3>Cartões</h3>${linhasCart}</div>` : '';

  if (ini > fimMes) {
    $('#dias').innerHTML = `<div class="vazio">Este mês é anterior ao saldo inicial (${ini.split('-').reverse().join('/')}).</div>`;
    return;
  }
  if (!dias.length) { $('#dias').innerHTML = '<div class="vazio">Nenhum lançamento neste mês.<br>Toque em + para adicionar.</div>'; return; }

  $('#dias').innerHTML = dias.map(d => {
    const o = C.porDia.get(d);
    const saldo = C.saldoAte(d);
    const itens = o.itens.slice().sort((a, b) => 'entrada saida investimento cartao'.indexOf(a.tipo) - 'entrada saida investimento cartao'.indexOf(b.tipo))
      .map(l => {
        const sinal = l.tipo === 'entrada' ? '+' : l.tipo === 'cartao' ? '' : '−';
        const cls = { entrada: 'pos', saida: 'neg', investimento: 'inv-cor', cartao: 'cartao-cor' }[l.tipo];
        const tag = l.tipo === 'cartao' ? nomeCartao(l.cartao) : ROTULO[l.tipo];
        return `<div class="lanc click ${l.tipo}" data-id="${esc(l.id)}">
          <span class="desc"><span class="tag">${esc(tag)}</span>${l.recId ? '↻ ' : ''}${esc(l.descricao || '')}</span>
          <span class="v ${cls}">${sinal}${fmt(l.valor)}</span></div>`;
      }).join('');
    const fats = Object.entries(o.faturas).map(([c, v]) =>
      `<div class="lanc"><span class="desc"><span class="tag">Fatura</span>${esc(nomeCartao(c))}</span><span class="v fat-cor">−${fmt(v)}</span></div>`).join('');
    const [, , dd] = d.split('-');
    return `<div class="dia"><div class="dia-head"><span>Dia ${Number(dd)}</span><span>saldo <b>${saldo == null ? '—' : fmt(saldo)}</b></span></div>${itens}${fats}</div>`;
  }).join('');

  $$('#dias .lanc.click').forEach(el => el.onclick = () => abrirLanc(el.dataset.id, C.lancs));
}

/* ---------------- UI: Projeção ---------------- */
function renderProj() {
  const d = new Date();
  let [a, m] = [d.getFullYear(), d.getMonth() + 1];
  const [fa, fm] = addMes(a, m, 11);
  const C = calcular(fa, fm);
  const linhas = [];
  for (let k = 0; k < 12; k++) {
    const [ya, ym] = addMes(a, m, k);
    linhas.push([`${MESES[ym - 1].slice(0, 3)}/${String(ya).slice(2)}`, C.saldoAte(`${ymStr(ya, ym)}-${pad(diasNoMes(ya, ym))}`)]);
  }
  const max = Math.max(1, ...linhas.map(([, v]) => Math.abs(v ?? 0)));
  $('#proj').innerHTML = `<div class="card">${linhas.map(([n, v]) => `
    <div class="barra"><span>${n}</span><div class="trilho"><div class="fill ${v < 0 ? 'neg' : ''}" style="width:${v == null ? 0 : Math.abs(v) / max * 100}%"></div></div>
    <b class="${v < 0 ? 'neg' : ''}">${v == null ? '—' : fmt(v)}</b></div>`).join('')}</div>`;
}

/* ---------------- UI: Investimentos ---------------- */
function aportesRegistrados() {
  const h = hojeStr();
  const d = new Date();
  const C = todosLancs(d.getFullYear(), d.getMonth() + 1).filter(l => l.tipo === 'investimento' && l.data <= h);
  const total = C.reduce((s, l) => s + l.valor, 0);
  const [a6, m6] = addMes(d.getFullYear(), d.getMonth() + 1, -5);
  const desde = `${ymStr(a6, m6)}-01`;
  const ult6 = C.filter(l => l.data >= desde).reduce((s, l) => s + l.valor, 0);
  return { total, n: C.length, mediaMensal: ult6 / 6 };
}

function renderInv() {
  const r = aportesRegistrados();
  $('#inv-resumo').innerHTML = `
    <div class="resumo">
      <div class="kpi inv"><small>Total aportado até hoje</small><b class="inv-cor">${fmt(r.total)}</b></div>
      <div class="kpi"><small>Média mensal (últ. 6 meses)</small><b>${fmt(r.mediaMensal)}</b></div>
    </div>
    <p class="hint">Soma dos lançamentos do tipo “Investimento” (as células verde-claro da planilha). Não inclui rendimentos.</p>`;
}

$('#calc-usar-aportes').onclick = () => {
  const r = aportesRegistrados();
  const f = $('#calc');
  f.inicial.value = r.total.toFixed(2).replace('.', ',');
  f.aporte.value = r.mediaMensal.toFixed(2).replace('.', ',');
  calcularInvestimento();
};
$('#calc').onsubmit = e => { e.preventDefault(); calcularInvestimento(); };

function calcularInvestimento() {
  const f = $('#calc');
  const inicial = parseNum(f.inicial.value) || 0;
  const aporte = parseNum(f.aporte.value) || 0;
  const taxa = parseNum(f.taxa.value) || 0;
  const ir = Math.min(100, Math.max(0, parseNum(f.ir.value) || 0));
  let n = Math.round(parseNum(f.prazo.value) || 0);
  if (f.unidade.value === 'a') n *= 12;
  if (n <= 0 || n > 1200) { $('#calc-out').innerHTML = '<div class="card">Informe um prazo entre 1 e 1200 meses.</div>'; return; }
  const im = f.periodo.value === 'am' ? taxa / 100 : Math.pow(1 + taxa / 100, 1 / 12) - 1;
  const ia = Math.pow(1 + im, 12) - 1;

  // Aporte feito no fim de cada mês; juros compostos mensais
  let saldo = inicial; const serie = [[0, inicial, inicial]];
  for (let k = 1; k <= n; k++) {
    saldo = saldo * (1 + im) + aporte;
    serie.push([k, inicial + aporte * k, saldo]);
  }
  const investido = inicial + aporte * n;
  const juros = saldo - investido;
  const imposto = juros > 0 ? juros * ir / 100 : 0;
  const liquido = saldo - imposto;

  // Gráfico SVG
  const W = 600, H = 220, P = 8;
  const maxV = Math.max(1, ...serie.map(s => Math.max(s[1], s[2])));
  const x = k => P + (W - 2 * P) * k / n, y = v => H - P - (H - 2 * P) * v / maxV;
  const linha = i => serie.map(s => `${x(s[0]).toFixed(1)},${y(s[i]).toFixed(1)}`).join(' ');
  const area = `${P},${H - P} ${linha(2)} ${x(n)},${H - P}`;

  const passo = n > 36 ? 12 : 1;
  const linhasTab = serie.filter(s => s[0] > 0 && (s[0] % passo === 0 || s[0] === n)).map(s =>
    `<tr><td>${passo === 12 ? `Ano ${(s[0] / 12).toFixed(s[0] % 12 ? 1 : 0)}` : `Mês ${s[0]}`}</td><td>${fmt(s[1])}</td><td>${fmt(s[2] - s[1])}</td><td>${fmt(s[2])}</td></tr>`).join('');

  $('#calc-out').innerHTML = `
    <div class="card">
      <div class="resumo">
        <div class="kpi destaque"><small>Valor final ${ir ? 'líquido' : 'bruto'} em ${n} meses</small><b>${fmt(ir ? liquido : saldo)}</b></div>
        <div class="kpi"><small>Total investido</small><b>${fmt(investido)}</b></div>
        <div class="kpi inv"><small>Juros (bruto)</small><b class="inv-cor">${fmt(juros)}</b></div>
        ${ir ? `<div class="kpi"><small>Imposto (${ir}%)</small><b class="neg">−${fmt(imposto)}</b></div>
                <div class="kpi"><small>Valor bruto</small><b>${fmt(saldo)}</b></div>` : ''}
      </div>
      <p class="hint">Taxa equivalente: ${(im * 100).toFixed(4).replace('.', ',')}% a.m. = ${(ia * 100).toFixed(2).replace('.', ',')}% a.a.</p>
      <svg class="graf" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do investimento">
        <polygon points="${area}" fill="var(--verde-claro)"/>
        <polyline points="${linha(2)}" fill="none" stroke="var(--verde-inv)" stroke-width="3"/>
        <polyline points="${linha(1)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="6 5"/>
      </svg>
      <div class="legenda"><span><i style="background:var(--verde-inv)"></i>Saldo com juros</span><span><i style="background:var(--muted)"></i>Total investido</span></div>
    </div>
    <div class="card"><h3>Evolução</h3><div class="scroll"><table class="tab">
      <thead><tr><th></th><th>Investido</th><th>Juros</th><th>Saldo</th></tr></thead><tbody>${linhasTab}</tbody></table></div></div>`;
}

/* ---------------- UI: Ajustes ---------------- */
function renderCfg() {
  const f = $('#cfg-saldo');
  f.data.value = S.saldoInicial.data;
  f.valor.value = String(S.saldoInicial.valor).replace('.', ',');

  $('#lista-cartoes').innerHTML = S.cartoes.map(c => `<div class="item"><div><b>${esc(c.nome)}</b><small>fecha dia ${c.fecha} · vence dia ${c.vence}</small></div>
    <button class="perigo" data-delcart="${esc(c.id)}" style="margin:0">Remover</button></div>`).join('') || '<p class="hint">Nenhum cartão.</p>';
  $$('[data-delcart]').forEach(b => b.onclick = () => {
    const id = b.dataset.delcart;
    const usado = S.lancs.some(l => l.cartao === id) || S.recs.some(r => r.cartao === id);
    if (!confirm(usado ? 'Este cartão tem lançamentos. Remover o cartão também apaga esses lançamentos. Continuar?' : 'Remover cartão?')) return;
    S.cartoes = S.cartoes.filter(c => c.id !== id);
    S.lancs = S.lancs.filter(l => l.cartao !== id);
    S.recs = S.recs.filter(r => r.cartao !== id);
    salvar();
  });

  $('#lista-rec').innerHTML = S.recs.map(r => `<div class="item"><div><b>${esc(r.descricao || ROTULO[r.tipo])}</b>
    <small>${r.tipo === 'cartao' ? esc(nomeCartao(r.cartao)) : ROTULO[r.tipo]} · dia ${Number(r.inicio.slice(8))} · desde ${r.inicio.slice(5, 7)}/${r.inicio.slice(0, 4)}${r.fim ? ' até ' + r.fim.slice(5) + '/' + r.fim.slice(0, 4) : ''}</small></div>
    <span>${fmt(r.valor)}</span></div>`).join('') || '<p class="hint">Nenhuma recorrência. Marque “Repetir todo mês” ao lançar.</p>';
}

$('#cfg-saldo').onsubmit = e => {
  e.preventDefault();
  const v = parseNum(e.target.valor.value);
  if (isNaN(v)) return alert('Valor inválido');
  S.saldoInicial = { data: e.target.data.value, valor: v };
  salvar();
};
$('#form-cartao').onsubmit = e => {
  e.preventDefault();
  const f = e.target;
  const fecha = parseInt(f.fecha.value), vence = parseInt(f.vence.value);
  if (!(fecha >= 1 && fecha <= 31 && vence >= 1 && vence <= 31)) return alert('Dias devem estar entre 1 e 31');
  S.cartoes.push({ id: uid(), nome: f.nome.value.trim(), fecha, vence });
  f.reset(); f.fecha.value = 31; f.vence.value = 10;
  salvar();
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
    S = { recs: [], ...d }; salvar();
  } catch (err) { alert('Erro ao importar: ' + err.message); }
  e.target.value = '';
};
$('#apagar').onclick = () => { if (confirm('Apagar TODOS os dados? Isso não pode ser desfeito.')) { S = estadoPadrao(); salvar(); } };

/* ---------------- Diálogo de lançamento ---------------- */
const dlg = $('#dlg'), fl = $('#form-lanc');
let editando = null;   // { id } avulso | { recId, ym } recorrente

function atualizarCamposDlg() {
  $('#campo-cartao').hidden = fl.tipo.value !== 'cartao';
  $('#campo-fim').hidden = !fl.recorrente.checked;
}
fl.addEventListener('change', atualizarCamposDlg);

function abrirLanc(id, lista) {
  fl.reset();
  fl.cartao.innerHTML = S.cartoes.map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  const l = id ? (lista || S.lancs).find(x => x.id === id) : null;
  editando = null;
  $('#dlg-excluir').hidden = !l;
  $('#dlg-excluir').textContent = 'Excluir';
  $('#dlg-titulo').textContent = l ? (l.recId ? 'Editar recorrência' : 'Editar lançamento') : 'Novo lançamento';
  $$('.pular-btn').forEach(b => b.remove());
  if (l) {
    fl.tipo.value = l.tipo;
    fl.valor.value = String(l.valor).replace('.', ',');
    fl.descricao.value = l.descricao || '';
    if (l.cartao) fl.cartao.value = l.cartao;
    if (l.recId) {
      const r = S.recs.find(x => x.id === l.recId);
      editando = { recId: l.recId, ym: l.data.slice(0, 7) };
      fl.data.value = r.inicio;
      fl.recorrente.checked = true;
      fl.fim.value = r.fim || '';
      $('#dlg-excluir').textContent = 'Excluir todas';
      const pular = document.createElement('button');
      pular.type = 'button'; pular.className = 'sec-btn pular-btn'; pular.textContent = 'Pular só este mês';
      pular.style.cssText = 'width:100%;margin-bottom:8px';
      pular.onclick = () => { r.pular = [...(r.pular || []), editando.ym]; dlg.close(); salvar(); };
      $('#dlg-salvar').parentElement.before(pular);
    } else {
      editando = { id: l.id };
      fl.data.value = l.data;
    }
  } else {
    const h = hojeStr();
    fl.data.value = h.startsWith(ymStr(verA, verM)) ? h : `${ymStr(verA, verM)}-01`;
  }
  if (!S.cartoes.length) fl.querySelector('input[value="cartao"]').disabled = true;
  atualizarCamposDlg();
  dlg.showModal();
  if (!l) fl.valor.focus();
}

$('#fab').onclick = () => abrirLanc(null);
$('#dlg-cancelar').onclick = () => dlg.close();
$('#dlg-excluir').onclick = () => {
  if (!editando) return;
  if (editando.recId) {
    if (!confirm('Excluir esta recorrência em todos os meses?')) return;
    S.recs = S.recs.filter(r => r.id !== editando.recId);
  } else S.lancs = S.lancs.filter(l => l.id !== editando.id);
  dlg.close(); salvar();
};
fl.onsubmit = e => {
  e.preventDefault();
  const valor = parseNum(fl.valor.value);
  if (!(valor > 0)) return alert('Informe um valor maior que zero');
  const tipo = fl.tipo.value;
  const base = { tipo, valor, descricao: fl.descricao.value.trim(), cartao: tipo === 'cartao' ? fl.cartao.value : undefined };
  const rec = fl.recorrente.checked;

  // remove o registro anterior (se mudou de avulso <-> recorrente)
  if (editando?.id) S.lancs = S.lancs.filter(l => l.id !== editando.id);
  const recAnt = editando?.recId ? S.recs.find(r => r.id === editando.recId) : null;
  if (recAnt && !rec) S.recs = S.recs.filter(r => r.id !== recAnt.id);

  if (rec) {
    const obj = { ...base, inicio: fl.data.value, fim: fl.fim.value || '', pular: recAnt?.pular || [] };
    if (recAnt) Object.assign(recAnt, obj); else S.recs.push({ id: uid(), ...obj });
  } else {
    S.lancs.push({ id: editando?.id || uid(), ...base, data: fl.data.value });
  }
  if (!recAnt) [verA, verM] = fl.data.value.split('-').map(Number);
  dlg.close(); salvar();
};

/* ---------------- Render ---------------- */
function render() {
  const t = $('.tabs button.ativa').dataset.tela;
  if (t === 'mes') renderMes();
  if (t === 'proj') renderProj();
  if (t === 'inv') renderInv();
  if (t === 'cfg') renderCfg();
}
render();
calcularInvestimento();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
