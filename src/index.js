// Atacado Seguro: API em Cloudflare Workers com banco D1.
// Dados fictícios. Regras: consultas parametrizadas, sessão em cookie protegido,
// CSRF, papéis, campos cifrados e registro de acesso.
const cod = new TextEncoder();
const dec = new TextDecoder();
const CABECALHOS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Strict-Transport-Security': 'max-age=31536000',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};
const SESSAO_S = 8 * 60 * 60;
const JANELA_MS = 15 * 60 * 1000;
const MAX_FALHAS_ORIGEM = 10;
const MAX_FALHAS_CONTA = 30;
const MAX_ITENS = 30;
const MAX_CORPO = 16 * 1024;
const NOME_COOKIE = '__Host-sessao';

class ErroApi extends Error {
  constructor(status, codigo, mensagem) { super(mensagem); this.status = status; this.codigo = codigo; }
}
function resposta(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), { status, headers: { ...CABECALHOS, ...extra } });
}
function b64(bytes) { let s = ''; new Uint8Array(bytes).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); }
function deB64(t) { return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); }
function aleatorio(n) { return crypto.getRandomValues(new Uint8Array(n)); }
async function sha256(t) { return b64(await crypto.subtle.digest('SHA-256', cod.encode(t))); }
function iguais(a, b) {
  let x, y;
  try { x = deB64(a); y = deB64(b); } catch (e) { return false; }
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}
function iteracoes(env) {
  const n = Number(env.ITERACOES_SENHA);
  if (!Number.isInteger(n) || n < 10000 || n > 100000) throw new ErroApi(500, 'config', 'Configuração inválida.');
  return n;
}
function exigeSegredo(env, nome) {
  if (!env[nome] || env[nome].length < 32) throw new ErroApi(500, 'config', 'Login indisponível: as chaves do servidor ainda não foram configuradas.');
  return env[nome];
}

/* senhas: PBKDF2 mais pimenta (HMAC com segredo fora do banco) */
async function derivar(senha, saltB64, n) {
  const base = await crypto.subtle.importKey('raw', cod.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: deB64(saltB64), iterations: n }, base, 256);
}
async function comPimenta(env, bytes) {
  const k = await crypto.subtle.importKey('raw', cod.encode(exigeSegredo(env, 'PIMENTA')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, bytes));
}
async function conferirSenha(env, u, senha) {
  const d = await derivar(senha, u.salt, u.iteracoes);
  const calc = u.com_pimenta ? await comPimenta(env, d) : b64(d);
  const ok = iguais(calc, u.senha_hash);
  return { ok, derivado: d };
}

/* campos cifrados: AES-256-GCM, com o id do usuário como dado autenticado */
async function chaveDados(env) {
  const bruta = deB64(exigeSegredo(env, 'CHAVE_DADOS'));
  if (bruta.byteLength !== 32) throw new ErroApi(500, 'config', 'Dados cifrados indisponíveis: a chave do servidor está em formato errado.');
  return crypto.subtle.importKey('raw', bruta, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function cifrar(env, texto, contexto) {
  const iv = aleatorio(12);
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: cod.encode(contexto) }, await chaveDados(env), cod.encode(texto));
  return `v1.${b64(iv)}.${b64(c)}`;
}
async function decifrar(env, valor, contexto) {
  if (!valor) return null;
  const [v, iv, c] = valor.split('.');
  if (v !== 'v1') throw new ErroApi(500, 'dados', 'Dado em formato desconhecido.');
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv), additionalData: cod.encode(contexto) }, await chaveDados(env), deB64(c));
  return dec.decode(p);
}

/* apoio */
async function origemHash(env, req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  return (await sha256(`${exigeSegredo(env, 'PIMENTA')}|${ip}`)).slice(0, 22);
}
async function registrar(env, c, acao, resultado, alvo = null) {
  c.origem ??= await origemHash(env, c.req);
  await env.DB.prepare('INSERT INTO registro_acesso (quando, usuario_id, acao, resultado, alvo, origem_hash) VALUES (?,?,?,?,?,?)')
    .bind(Date.now(), c.usuario ? c.usuario.id : (c.usuarioId || null), acao, resultado, alvo, c.origem).run();
}
async function lerJson(req) {
  const tipo = req.headers.get('Content-Type') || '';
  if (!tipo.startsWith('application/json')) throw new ErroApi(415, 'tipo', 'Envie JSON.');
  const n = Number(req.headers.get('Content-Length') || 0);
  if (n > MAX_CORPO) throw new ErroApi(413, 'grande', 'Dados grandes demais.');
  const t = await req.text();
  if (t.length > MAX_CORPO) throw new ErroApi(413, 'grande', 'Dados grandes demais.');
  try { const j = JSON.parse(t); if (j && typeof j === 'object' && !Array.isArray(j)) return j; } catch (e) { /* abaixo */ }
  throw new ErroApi(400, 'json', 'JSON inválido.');
}
function conferirOrigem(req) {
  const o = req.headers.get('Origin');
  if (!o || o !== new URL(req.url).origin) throw new ErroApi(403, 'origem', 'Origem não permitida.');
}
function lerCookie(req) {
  const h = req.headers.get('Cookie') || '';
  for (const p of h.split(';')) {
    const [k, ...v] = p.trim().split('=');
    if (k === NOME_COOKIE) return v.join('=');
  }
  return null;
}
function cookie(valor, maxAge) {
  return `${NOME_COOKIE}=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
async function carregarSessao(env, req, c) {
  const t = lerCookie(req);
  if (!t || t.length > 100) return;
  const s = await env.DB.prepare('SELECT s.csrf, s.expira_em, s.token_hash, u.id, u.nome, u.email, u.papel FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token_hash = ?')
    .bind(await sha256(t)).first();
  if (!s || s.expira_em < Date.now()) return;
  c.usuario = { id: s.id, nome: s.nome, email: s.email, papel: s.papel };
  c.csrf = s.csrf; c.tokenHash = s.token_hash;
}
function exigirLogin(c) { if (!c.usuario) throw new ErroApi(401, 'login', 'Entre para continuar.'); }
function exigirGestor(c) { exigirLogin(c); if (c.usuario.papel !== 'gestor') throw new ErroApi(403, 'papel', 'Só o gestor pode fazer isso.'); }
function conferirCsrf(req, c) {
  const h = req.headers.get('X-CSRF-Token');
  if (!h || !c.csrf || h.length !== c.csrf.length || !iguais(h, c.csrf)) throw new ErroApi(403, 'csrf', 'Token de segurança inválido. Recarregue a página.');
}
function texto(v, min, max, msg) {
  if (typeof v !== 'string') throw new ErroApi(422, 'campo', msg);
  const t = v.trim();
  if (t.length < min || t.length > max) throw new ErroApi(422, 'campo', msg);
  return t;
}
function mascarar(v) { if (!v) return null; const d = v.replace(/\D/g, ''); return d.length < 4 ? '****' : `****${d.slice(-2)}`; }

/* rotas */
async function login(env, req, c) {
  conferirOrigem(req);
  const b = await lerJson(req);
  const email = texto(b.email, 3, 120, 'E-mail ou senha incorretos.').toLowerCase();
  const senha = texto(b.senha, 1, 200, 'E-mail ou senha incorretos.');
  const desde = Date.now() - JANELA_MS;
  c.origem ??= await origemHash(env, req);
  const porOrigem = await env.DB.prepare("SELECT COUNT(*) n FROM registro_acesso WHERE origem_hash = ? AND acao = 'login' AND resultado = 'falha' AND quando > ?").bind(c.origem, desde).first();
  if (porOrigem.n >= MAX_FALHAS_ORIGEM) { await registrar(env, c, 'login', 'bloqueado'); throw new ErroApi(429, 'tentativas', 'Muitas tentativas. Espere 15 minutos.'); }
  const u = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?').bind(email).first();
  if (u) {
    const porConta = await env.DB.prepare("SELECT COUNT(*) n FROM registro_acesso WHERE usuario_id = ? AND acao = 'login' AND resultado = 'falha' AND quando > ?").bind(u.id, desde).first();
    if (porConta.n >= MAX_FALHAS_CONTA) { c.usuarioId = u.id; await registrar(env, c, 'login', 'bloqueado'); throw new ErroApi(429, 'tentativas', 'Muitas tentativas. Espere 15 minutos.'); }
  }
  const alvo = u || { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iteracoes: iteracoes(env), com_pimenta: 0, senha_hash: b64(new Uint8Array(32)) };
  const r = await conferirSenha(env, alvo, senha);
  if (!u || !r.ok) { c.usuarioId = u ? u.id : null; await registrar(env, c, 'login', 'falha'); throw new ErroApi(401, 'credenciais', 'E-mail ou senha incorretos.'); }
  const token = b64(aleatorio(32)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const csrf = b64(aleatorio(32));
  const lote = [
    env.DB.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND expira_em < ?').bind(u.id, Date.now()),
    env.DB.prepare('INSERT INTO sessoes (token_hash, usuario_id, csrf, expira_em) VALUES (?,?,?,?)').bind(await sha256(token), u.id, csrf, Date.now() + SESSAO_S * 1000),
  ];
  if (!u.com_pimenta) lote.push(env.DB.prepare('UPDATE usuarios SET senha_hash = ?, com_pimenta = 1 WHERE id = ?').bind(await comPimenta(env, r.derivado), u.id));
  await env.DB.batch(lote);
  c.usuarioId = u.id; await registrar(env, c, 'login', 'ok');
  return resposta({ usuario: { nome: u.nome, email: u.email, papel: u.papel }, csrf }, 200, { 'Set-Cookie': cookie(token, SESSAO_S) });
}
async function sair(env, req, c) {
  conferirOrigem(req); exigirLogin(c); conferirCsrf(req, c);
  await env.DB.prepare('DELETE FROM sessoes WHERE token_hash = ?').bind(c.tokenHash).run();
  await registrar(env, c, 'logout', 'ok');
  return resposta({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
}
async function listarProdutos(env) {
  const { results } = await env.DB.prepare('SELECT id, codigo, nome, unidade, preco_centavos, estoque FROM produtos ORDER BY codigo').all();
  return resposta({ produtos: results });
}
async function criarPedido(env, req, c) {
  conferirOrigem(req); exigirLogin(c); conferirCsrf(req, c);
  if (c.usuario.papel !== 'cliente') throw new ErroApi(403, 'papel', 'Só clientes fazem pedidos.');
  const b = await lerJson(req);
  if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > MAX_ITENS) throw new ErroApi(422, 'itens', 'Escolha de 1 a 30 itens.');
  const vistos = new Set();
  for (const i of b.itens) {
    if (!Number.isInteger(i.produto_id) || !Number.isInteger(i.quantidade) || i.quantidade < 1 || i.quantidade > 9999 || vistos.has(i.produto_id)) throw new ErroApi(422, 'itens', 'Item inválido.');
    vistos.add(i.produto_id);
  }
  const marcas = b.itens.map(() => '?').join(',');
  const { results: ps } = await env.DB.prepare(`SELECT id, preco_centavos FROM produtos WHERE id IN (${marcas})`).bind(...b.itens.map((i) => i.produto_id)).all();
  if (ps.length !== b.itens.length) throw new ErroApi(422, 'itens', 'Produto inexistente.');
  const preco = new Map(ps.map((p) => [p.id, p.preco_centavos]));
  const total = b.itens.reduce((s, i) => s + preco.get(i.produto_id) * i.quantidade, 0);
  // O lote é uma transação: o banco escolhe o número, e os itens acham o pedido que acabou de nascer.
  const lote = [env.DB.prepare('INSERT INTO pedidos (usuario_id, total_centavos, criado_em) VALUES (?,?,?) RETURNING id').bind(c.usuario.id, total, Date.now())];
  for (const i of b.itens) {
    lote.push(env.DB.prepare('INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_centavos) VALUES ((SELECT MAX(id) FROM pedidos WHERE usuario_id = ?),?,?,?)').bind(c.usuario.id, i.produto_id, i.quantidade, preco.get(i.produto_id)));
    lote.push(env.DB.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?').bind(i.quantidade, i.produto_id));
  }
  let id;
  try { id = (await env.DB.batch(lote))[0].results[0].id; } catch (e) {
    await registrar(env, c, 'pedido', 'recusado');
    if (/CHECK/i.test(String(e.message))) throw new ErroApi(409, 'estoque', 'Estoque insuficiente. Nada foi reservado.');
    throw e;
  }
  await registrar(env, c, 'pedido', 'ok', `pedido:${id}`);
  return resposta({ id, total_centavos: total }, 201);
}
async function listarPedidos(env, c) {
  exigirLogin(c);
  const gestor = c.usuario.papel === 'gestor';
  const q = gestor
    ? env.DB.prepare('SELECT p.id, p.total_centavos, p.situacao, p.criado_em, u.nome cliente FROM pedidos p JOIN usuarios u ON u.id = p.usuario_id ORDER BY p.id DESC LIMIT 100')
    : env.DB.prepare('SELECT p.id, p.total_centavos, p.situacao, p.criado_em FROM pedidos p WHERE p.usuario_id = ? ORDER BY p.id DESC LIMIT 100').bind(c.usuario.id);
  const { results } = await q.all();
  if (gestor) await registrar(env, c, 'ver_pedidos', 'ok');
  return resposta({ pedidos: results });
}
async function verPedido(env, c, id) {
  exigirLogin(c);
  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p || (c.usuario.papel !== 'gestor' && p.usuario_id !== c.usuario.id)) {
    await registrar(env, c, 'ver_pedido', 'negado', `pedido:${id}`);
    throw new ErroApi(404, 'pedido', 'Pedido não encontrado.');
  }
  const { results } = await env.DB.prepare('SELECT i.quantidade, i.preco_centavos, d.nome FROM itens_pedido i JOIN produtos d ON d.id = i.produto_id WHERE i.pedido_id = ?').bind(id).all();
  return resposta({ pedido: { id: p.id, total_centavos: p.total_centavos, situacao: p.situacao, criado_em: p.criado_em }, itens: results });
}
async function mudarSituacao(env, req, c, id) {
  conferirOrigem(req); exigirGestor(c); conferirCsrf(req, c);
  const b = await lerJson(req);
  if (!['recebido', 'separando', 'enviado', 'cancelado'].includes(b.situacao)) throw new ErroApi(422, 'situacao', 'Situação inválida.');
  const r = await env.DB.prepare('UPDATE pedidos SET situacao = ? WHERE id = ?').bind(b.situacao, id).run();
  if (!r.meta.changes) throw new ErroApi(404, 'pedido', 'Pedido não encontrado.');
  await registrar(env, c, 'mudar_situacao', 'ok', `pedido:${id}:${b.situacao}`);
  return resposta({ ok: true });
}
async function verPerfil(env, c) {
  exigirLogin(c);
  const u = await env.DB.prepare('SELECT documento_cifrado, telefone_cifrado FROM usuarios WHERE id = ?').bind(c.usuario.id).first();
  const ctx = `usuario:${c.usuario.id}`;
  return resposta({
    documento: await decifrar(env, u.documento_cifrado, `${ctx}:documento`),
    telefone: await decifrar(env, u.telefone_cifrado, `${ctx}:telefone`),
    no_banco: { documento: u.documento_cifrado, telefone: u.telefone_cifrado },
  });
}
async function salvarPerfil(env, req, c) {
  conferirOrigem(req); exigirLogin(c); conferirCsrf(req, c);
  const b = await lerJson(req);
  const doc = texto(b.documento, 0, 40, 'Documento muito longo.');
  const tel = texto(b.telefone, 0, 30, 'Telefone muito longo.');
  const ctx = `usuario:${c.usuario.id}`;
  await env.DB.prepare('UPDATE usuarios SET documento_cifrado = ?, telefone_cifrado = ? WHERE id = ?')
    .bind(doc ? await cifrar(env, doc, `${ctx}:documento`) : null, tel ? await cifrar(env, tel, `${ctx}:telefone`) : null, c.usuario.id).run();
  await registrar(env, c, 'salvar_perfil', 'ok');
  return resposta({ ok: true });
}
async function verRegistro(env, c) {
  exigirGestor(c);
  const { results } = await env.DB.prepare('SELECT r.quando, r.acao, r.resultado, r.alvo, u.nome usuario FROM registro_acesso r LEFT JOIN usuarios u ON u.id = r.usuario_id ORDER BY r.id DESC LIMIT 60').all();
  return resposta({ registro: results });
}

async function tratar(req, env) {
  const url = new URL(req.url);
  const rota = url.pathname;
  const m = req.method;
  if (!rota.startsWith('/api/')) {
    // Só chega aqui o que não é arquivo estático: mostra a página 404 com os cabeçalhos dela.
    const pagina = await env.ASSETS.fetch(new Request(new URL('/404', req.url)));
    return new Response(pagina.body, { status: 404, headers: pagina.headers });
  }
  const c = { usuario: null, req };
  if (rota === '/api/saude' && m === 'GET') return resposta({ ok: true });
  if (rota === '/api/produtos' && m === 'GET') return listarProdutos(env);
  if (rota === '/api/login' && m === 'POST') return login(env, req, c);
  await carregarSessao(env, req, c);
  if (rota === '/api/sessao' && m === 'GET') {
    return resposta(c.usuario ? { usuario: { nome: c.usuario.nome, email: c.usuario.email, papel: c.usuario.papel }, csrf: c.csrf } : { usuario: null });
  }
  if (rota === '/api/logout' && m === 'POST') return sair(env, req, c);
  if (rota === '/api/pedidos' && m === 'GET') return listarPedidos(env, c);
  if (rota === '/api/pedidos' && m === 'POST') return criarPedido(env, req, c);
  const pid = rota.match(/^\/api\/pedidos\/(\d{1,9})(\/situacao)?$/);
  if (pid && m === 'GET' && !pid[2]) return verPedido(env, c, Number(pid[1]));
  if (pid && m === 'POST' && pid[2]) return mudarSituacao(env, req, c, Number(pid[1]));
  if (rota === '/api/perfil' && m === 'GET') return verPerfil(env, c);
  if (rota === '/api/perfil' && m === 'POST') return salvarPerfil(env, req, c);
  if (rota === '/api/registro' && m === 'GET') return verRegistro(env, c);
  throw new ErroApi(404, 'rota', 'Endereço não encontrado.');
}

async function faxina(env) {
  const trinta = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const lote = [
    env.DB.prepare('DELETE FROM sessoes WHERE expira_em < ?').bind(Date.now()),
    env.DB.prepare('DELETE FROM registro_acesso WHERE quando < ?').bind(trinta),
  ];
  if (env.MODO_DEMO === '1') {
    lote.push(env.DB.prepare('DELETE FROM itens_pedido'), env.DB.prepare('DELETE FROM pedidos'),
      env.DB.prepare('UPDATE produtos SET estoque = estoque_inicial'),
      env.DB.prepare('UPDATE usuarios SET documento_cifrado = NULL, telefone_cifrado = NULL WHERE demo = 1'));
  }
  await env.DB.batch(lote);
}

export default {
  async fetch(req, env) {
    try {
      return await tratar(req, env);
    } catch (e) {
      if (e instanceof ErroApi) return resposta({ erro: e.message, codigo: e.codigo }, e.status);
      console.error(JSON.stringify({ evento: 'erro', nome: e.name, mensagem: String(e.message).slice(0, 200) }));
      return resposta({ erro: 'Erro interno. Tente de novo em instantes.', codigo: 'interno' }, 500);
    }
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(faxina(env)); },
};
