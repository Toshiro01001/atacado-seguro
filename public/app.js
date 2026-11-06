'use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var csrf = null, usuario = null, produtos = [];
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = txt; return e; }
  function rs(c) { return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  var ROT = { recebido: 'Recebido', separando: 'Separando', enviado: 'Enviado', cancelado: 'Cancelado' };

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
      var tr = el('tr');
      tr.appendChild(el('td', '', p.codigo));
      var nome = el('td'); nome.appendChild(el('b', '', p.nome)); nome.appendChild(el('span', 'unid', p.unidade)); tr.appendChild(nome);
      tr.appendChild(el('td', 'num', rs(p.preco_centavos)));
      tr.appendChild(el('td', 'num', String(p.estoque)));
      var q = el('td', 'col-q'), i = el('input');
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
    $('total').textContent = 'Total do pedido: ' + rs(t);
  }
  async function carregarProdutos() { produtos = (await api('GET', '/api/produtos')).produtos; pintarProdutos(); }

  async function carregarPedidos() {
    var d = await api('GET', '/api/pedidos'), ul = $('pedidos'), gestor = usuario.papel === 'gestor';
    ul.textContent = '';
    $('d-ped').textContent = gestor ? 'O gestor vê os pedidos de todas as lojas e muda a situação.' : 'Você vê só os pedidos desta loja.';
    if (!d.pedidos.length) ul.appendChild(el('li', 'vazio', 'Nenhum pedido ainda.'));
    d.pedidos.forEach(function (p) {
      var li = el('li');
      li.appendChild(el('b', '', 'Pedido ' + p.id));
      li.appendChild(el('span', '', (p.cliente ? p.cliente + ', ' : '') + rs(p.total_centavos) + ', ' + new Date(p.criado_em).toLocaleString('pt-BR')));
      if (gestor) {
        var s = el('select'); s.dataset.pedido = p.id; s.setAttribute('aria-label', 'Situação do pedido ' + p.id);
        Object.keys(ROT).forEach(function (k) { var o = el('option', '', ROT[k]); o.value = k; s.appendChild(o); });
        s.value = p.situacao; li.appendChild(s);
      } else li.appendChild(el('span', 'sit', ROT[p.situacao]));
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
      var tr = el('tr');
      [new Date(r.quando).toLocaleString('pt-BR'), r.usuario || 'Desconhecido', r.acao, r.resultado, r.alvo || ''].forEach(function (v) { tr.appendChild(el('td', '', v)); });
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
    $('enviar').disabled = !logado || usuario.papel !== 'cliente';
    $('m-pedido').textContent = !logado ? 'Entre como cliente para enviar um pedido.' : usuario.papel === 'cliente' ? '' : 'Gestor não faz pedidos.';
    if (!logado) return;
    $('u-nome').textContent = usuario.nome;
    $('u-papel').textContent = usuario.papel;
    await carregarPedidos();
    await carregarPerfil();
    if (usuario.papel === 'gestor') await carregarRegistro();
  }
  async function entrar(email, senha) {
    $('e-login').textContent = '';
    try {
      var d = await api('POST', '/api/login', { email: email, senha: senha });
      usuario = d.usuario; csrf = d.csrf;
      $('senha').value = '';
      await aplicarSessao();
    } catch (e) { $('e-login').textContent = e.message; }
  }

  $('f-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (!$('email').value || !$('senha').value) { $('e-login').textContent = 'Preencha o e-mail e a senha.'; return; }
    entrar($('email').value, $('senha').value);
  });
  document.querySelector('.atalhos').addEventListener('click', function (e) { if (e.target.dataset.e) entrar(e.target.dataset.e, e.target.dataset.s); });
  $('sair').addEventListener('click', async function () {
    try { await api('POST', '/api/logout'); } catch (e) { /* a sessão expira de qualquer forma */ }
    usuario = null; csrf = null; await aplicarSessao();
  });
  $('produtos').addEventListener('input', pintarTotal);
  $('enviar').addEventListener('click', async function () {
    var m = $('m-pedido'), its = itensEscolhidos();
    m.className = 'msg';
    if (!its.length) { m.className = 'msg ruim'; m.textContent = 'Coloque a quantidade de pelo menos um produto.'; return; }
    try {
      var r = await api('POST', '/api/pedidos', { itens: its });
      m.className = 'msg bom'; m.textContent = 'Pedido ' + r.id + ' enviado: ' + rs(r.total_centavos) + '.';
      $('produtos').querySelectorAll('input').forEach(function (i) { i.value = ''; });
      await carregarProdutos(); await carregarPedidos();
    } catch (e) { m.className = 'msg ruim'; m.textContent = e.message; await carregarProdutos(); }
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
    try {
      await carregarProdutos();
      var s = await api('GET', '/api/sessao');
      if (s.usuario) { usuario = s.usuario; csrf = s.csrf; }
      await aplicarSessao();
    } catch (e) { $('m-pedido').className = 'msg ruim'; $('m-pedido').textContent = e.message; }
  })();
})();
