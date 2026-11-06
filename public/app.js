'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var csrf = null, usuario = null, produtos = [];
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = txt; return e; }
  function rs(c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  var ROT = { recebido: 'Recebido', separando: 'Separando', enviado: 'Enviado', cancelado: 'Cancelado' };
  var ACOES = { login: 'Entrada', logout: 'Saída', pedido: 'Enviou pedido', ver_pedidos: 'Listou pedidos', ver_pedido: 'Tentou abrir pedido', mudar_situacao: 'Mudou situação', salvar_perfil: 'Salvou dados cifrados' };
  var RES = { ok: 'Permitido', falha: 'Senha errada', bloqueado: 'Bloqueado', negado: 'Negado', recusado: 'Sem estoque' };
  function celula(rotulo, cls, txt) { var td = el('td', cls, txt); td.setAttribute('role', 'cell'); td.dataset.rot = rotulo; return td; }
  function linhaTab() { var tr = el('tr'); tr.setAttribute('role', 'row'); return tr; }
  function alvoLegivel(a) {
    if (!a) return '';
    var p = a.split(':');
    return p[0] === 'pedido' ? 'Pedido ' + p[1] + (p[2] ? ', ' + (ROT[p[2]] || p[2]) : '') : a;
  }
  function ocupado(btn, sim) { if (btn) { btn.disabled = sim; btn.setAttribute('aria-busy', sim ? 'true' : 'false'); } }

  async function api(metodo, rota, corpo) {
    var op = { method: metodo, credentials: 'same-origin', headers: {} };
    if (corpo !== undefined) { op.headers['Content-Type'] = 'application/json'; op.body = JSON.stringify(corpo); }
    if (metodo !== 'GET' && csrf) op.headers['X-CSRF-Token'] = csrf;
    var r;
    try { r = await fetch(rota, op); } catch (e) { throw new Error('Sem conexão com o servidor. Tente de novo.'); }
    var j = {};
    try { j = await r.json(); } catch (e) { /* resposta vazia */ }
    if (!r.ok) { var er = new Error(j.erro || 'Erro no servidor. Tente de novo.'); er.status = r.status; throw er; }
    return j;
  }

  function pintarProdutos() {
    var tb = $('produtos');
    var valores = {};
    tb.querySelectorAll('input').forEach(function (i) { valores[i.dataset.id] = i.value; });
    tb.textContent = '';
    produtos.forEach(function (p) {
      var tr = linhaTab();
      tr.appendChild(celula('Código', '', p.codigo));
      var nome = celula('Produto'); var cx = el('span'); cx.appendChild(el('b', '', p.nome)); cx.appendChild(el('span', 'unid', p.unidade)); nome.appendChild(cx); tr.appendChild(nome);
      tr.appendChild(celula('Preço', 'num', rs(p.preco_centavos)));
      var est = celula('Estoque', 'num'); var ce = el('span', '', String(p.estoque));
      if (p.estoque <= 10) ce.appendChild(el('span', 'baixo', 'Estoque baixo'));
      est.appendChild(ce); tr.appendChild(est);
      var q = celula('Quantidade', 'col-q'), i = el('input');
      i.type = 'number'; i.min = '0'; i.max = '9999'; i.step = '1'; i.inputMode = 'numeric'; i.dataset.id = p.id; i.value = valores[p.id] || '';
      i.setAttribute('aria-label', 'Quantidade de ' + p.nome);
      q.appendChild(i); tr.appendChild(q);
      tb.appendChild(tr);
    });
    pintarTotal();
  }
  function itensEscolhidos() {
    var its = [];
    $('produtos').querySelectorAll('input').forEach(function (i) {
      var n = Number(i.value);
      if (i.value !== '' && Number.isInteger(n) && n > 0) its.push({ produto_id: Number(i.dataset.id), quantidade: n });
    });
    return its;
  }
  function pintarTotal() {
    var t = itensEscolhidos().reduce(function (s, i) {
      var p = produtos.filter(function (x) { return x.id === i.produto_id; })[0];
      return s + (p ? p.preco_centavos * i.quantidade : 0);
    }, 0);
    var un = itensEscolhidos().reduce(function (s, i) { return s + i.quantidade; }, 0);
    $('total').textContent = 'Total do pedido: ' + rs(t) + (un ? ', ' + un + (un === 1 ? ' unidade' : ' unidades') : '');
    $('produtos').querySelectorAll('tr').forEach(function (l) { var c = l.querySelector('input'); l.classList.toggle('marcado', !!c && Number(c.value) > 0); });
  }
  async function carregarProdutos() { produtos = (await api('GET', '/api/produtos')).produtos; pintarProdutos(); }
  function catalogoFora(msg) {
    var tb = $('produtos'), tr = el('tr'), td = el('td', 'vazio-t', 'O catálogo não abriu agora. Recarregue a página em alguns instantes.');
    tb.textContent = ''; td.colSpan = 5; tr.appendChild(td); tb.appendChild(tr);
    $('m-pedido').className = 'msg ruim'; $('m-pedido').textContent = msg;
  }

  async function carregarPedidos() {
    var d = await api('GET', '/api/pedidos'), ul = $('pedidos'), gestor = usuario.papel === 'gestor';
    ul.textContent = '';
    $('d-ped').textContent = gestor ? 'O gestor vê os pedidos de todas as lojas e muda a situação.' : 'Você vê só os pedidos desta loja.';
    if (!d.pedidos.length) ul.appendChild(el('li', 'vazio', gestor ? 'Nenhum pedido ainda. Entre como cliente e envie um para ver ele chegar aqui.' : 'Nenhum pedido ainda. Escolha quantidades no catálogo e envie o primeiro.'));
    d.pedidos.forEach(function (p) {
      var li = el('li');
      li.appendChild(el('b', '', 'Pedido ' + p.id));
      li.appendChild(el('span', '', (p.cliente ? p.cliente + ', ' : '') + rs(p.total_centavos) + ', ' + new Date(p.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })));
      if (gestor) {
        var s = el('select'); s.dataset.pedido = p.id; s.setAttribute('aria-label', 'Situação do pedido ' + p.id);
        Object.keys(ROT).forEach(function (k) { var o = el('option', '', ROT[k]); o.value = k; s.appendChild(o); });
        s.value = p.situacao; li.appendChild(s);
      } else li.appendChild(el('span', 'sit sit-' + p.situacao, ROT[p.situacao]));
      ul.appendChild(li);
    });
  }
  async function carregarPerfil() {
    var d = await api('GET', '/api/perfil');
    $('doc').value = d.documento || ''; $('tel').value = d.telefone || '';
    var linhas = [];
    if (d.no_banco.documento) linhas.push('documento_cifrado:\n' + d.no_banco.documento);
    if (d.no_banco.telefone) linhas.push('telefone_cifrado:\n' + d.no_banco.telefone);
    $('banco').textContent = linhas.join('\n\n') || 'Nada gravado ainda.';
  }
  async function carregarRegistro() {
    var d = await api('GET', '/api/registro'), tb = $('registro');
    tb.textContent = '';
    d.registro.forEach(function (r) {
      var tr = linhaTab(), ruim = r.resultado !== 'ok';
      tr.appendChild(celula('Quando', '', new Date(r.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })));
      tr.appendChild(celula('Quem', '', r.usuario || 'Desconhecido'));
      tr.appendChild(celula('Ação', '', ACOES[r.acao] || r.acao));
      tr.appendChild(celula('Resultado', 'res ' + (ruim ? 'res-ruim' : 'res-ok'), RES[r.resultado] || r.resultado));
      tr.appendChild(celula('Alvo', '', alvoLegivel(r.alvo)));
      tb.appendChild(tr);
    });
  }
  async function aplicarSessao() {
    var logado = !!usuario;
    $('f-login').hidden = logado;
    document.querySelector('.atalhos').hidden = logado;
    document.querySelector('.atalhos-t').hidden = logado;
    $('logado').hidden = !logado;
    $('t-acesso').textContent = logado ? 'Sessão' : 'Entrar';
    $('s-pedidos').hidden = !logado;
    $('s-perfil').hidden = !logado;
    $('s-registro').hidden = !(logado && usuario.papel === 'gestor');
    document.querySelectorAll('[data-sessao]').forEach(function (a) { a.hidden = !logado; });
    document.querySelectorAll('[data-gestor]').forEach(function (a) { a.hidden = !(logado && usuario.papel === 'gestor'); });
    $('enviar').disabled = !logado || usuario.papel !== 'cliente';
    $('m-pedido').textContent = !logado ? 'Entre como cliente para enviar um pedido.' : usuario.papel === 'cliente' ? '' : 'Gestor não faz pedidos.';
    if (!logado) return;
    $('u-nome').textContent = usuario.nome;
    $('u-papel').textContent = usuario.papel;
    $('guia').textContent = usuario.papel === 'gestor' ? 'Agora mude a situação de um pedido e veja a mudança anotada no registro de acesso.' : 'Agora escolha quantidades no catálogo, envie um pedido e tente abrir o pedido de outra loja pelo número.';
    await carregarPedidos();
    await carregarPerfil();
    if (usuario.papel === 'gestor') await carregarRegistro();
  }
  async function entrar(email, senha, btn) {
    $('e-login').textContent = '';
    ocupado(btn, true);
    try {
      var d = await api('POST', '/api/login', { email: email, senha: senha });
      usuario = d.usuario; csrf = d.csrf;
      $('senha').value = '';
      await aplicarSessao();
    } catch (e) { $('e-login').textContent = e.message; }
    finally { ocupado(btn, false); }
  }

  $('f-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!$('email').value || !$('senha').value) { $('e-login').textContent = 'Preencha o e-mail e a senha.'; return; }
    entrar($('email').value, $('senha').value, this.querySelector('button'));
  });
  document.querySelector('.atalhos').addEventListener('click', function (e) { if (e.target.dataset.e) entrar(e.target.dataset.e, e.target.dataset.s, e.target); });
  $('sair').addEventListener('click', async function () {
    try { await api('POST', '/api/logout'); } catch (e) { /* a sessão expira de qualquer forma */ }
    usuario = null; csrf = null; await aplicarSessao();
  });
  $('produtos').addEventListener('input', pintarTotal);
  $('enviar').addEventListener('click', async function () {
    var m = $('m-pedido'), its = itensEscolhidos();
    m.className = 'msg';
    if (!its.length) { m.className = 'msg ruim'; m.textContent = 'Coloque a quantidade de pelo menos um produto.'; return; }
    ocupado($('enviar'), true);
    try {
      var r = await api('POST', '/api/pedidos', { itens: its });
      m.className = 'msg bom'; m.textContent = 'Pedido ' + r.id + ' enviado: ' + rs(r.total_centavos) + '.';
      $('produtos').querySelectorAll('input').forEach(function (i) { i.value = ''; });
      await carregarProdutos(); await carregarPedidos();
    } catch (e) { m.className = 'msg ruim'; m.textContent = e.message; await carregarProdutos(); }
    finally { ocupado($('enviar'), false); }
  });
  $('pedidos').addEventListener('change', async function (e) {
    if (!e.target.dataset.pedido) return;
    try { await api('POST', '/api/pedidos/' + e.target.dataset.pedido + '/situacao', { situacao: e.target.value }); await carregarRegistro(); }
    catch (er) { $('d-ped').textContent = er.message; }
  });
  $('abrir-num').addEventListener('click', async function () {
    var r = $('r-num'), n = Number($('num').value);
    r.className = 'msg';
    if (!Number.isInteger(n) || n < 1) { r.className = 'msg ruim'; r.textContent = 'Digite o número de um pedido.'; return; }
    try {
      var d = await api('GET', '/api/pedidos/' + n);
      r.className = 'msg bom';
      r.textContent = 'Pedido ' + d.pedido.id + ': ' + d.itens.map(function (i) { return i.quantidade + ' x ' + i.nome; }).join(', ') + '. Total ' + rs(d.pedido.total_centavos) + '.';
    } catch (e) { r.className = 'msg ruim'; r.textContent = e.message; }
  });
  $('salvar').addEventListener('click', async function () {
    var m = $('m-perfil');
    try {
      await api('POST', '/api/perfil', { documento: $('doc').value, telefone: $('tel').value });
      m.className = 'msg bom'; m.textContent = 'Salvo e cifrado no banco.';
      await carregarPerfil();
    } catch (e) { m.className = 'msg ruim'; m.textContent = e.message; }
  });

  (async function () {
    try { await carregarProdutos(); } catch (e) { catalogoFora(e.message); }
    try {
      var s = await api('GET', '/api/sessao');
      if (s.usuario) { usuario = s.usuario; csrf = s.csrf; }
      await aplicarSessao();
    } catch (e) { $('m-pedido').className = 'msg ruim'; $('m-pedido').textContent = e.message; }
  })();
})();
