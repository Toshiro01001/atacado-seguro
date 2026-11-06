// Testes de ponta a ponta contra `wrangler dev` local.
// Uso: BASE=http://localhost:8787 node tests/e2e.mjs
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { iniciarSiteverify } from './siteverify-falso.mjs';
const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8787';
const SAI = process.env.SAI || 'capturas';
mkdirSync(SAI, { recursive: true });
let ok = 0; const falhas = [];
const c = (x, m) => { if (x) ok++; else falhas.push(m); };
const ORI = { Origin: BASE };
const sv = await iniciarSiteverify();
const ficha = (p = 'ok') => `${p}-${Math.random().toString(36).slice(2)}${Date.now()}`;
async function req(metodo, rota, { corpo, cookie, csrf, origem = true, tipo = 'application/json' } = {}) {
  const h = {};
  if (origem) Object.assign(h, ORI);
  if (corpo !== undefined) h['Content-Type'] = tipo;
  if (cookie) h.Cookie = cookie;
  if (csrf) h['X-CSRF-Token'] = csrf;
  const r = await fetch(BASE + rota, { method: metodo, headers: h, body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)), redirect: 'manual' });
  let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch { /* não é json */ }
  return { s: r.status, h: r.headers, j, t };
}
async function entrar(email, senha) {
  const r = await req('POST', '/api/login', { corpo: { email, senha, turnstile: ficha() } });
  const sc = r.h.get('set-cookie') || '';
  return { ...r, cookie: sc.split(';')[0], sc, csrf: r.j && r.j.csrf };
}
const sql = (q) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'atacado-seguro', '--local', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0].results;

/* cabeçalhos */
let r = await fetch(BASE + '/');
for (const [k, v] of [['strict-transport-security', 'max-age'], ['x-frame-options', 'DENY'], ['x-content-type-options', 'nosniff'], ['content-security-policy', "frame-ancestors 'none'"], ['referrer-policy', 'no-referrer']]) c((r.headers.get(k) || '').includes(v), 'página sem ' + k);
c(!(r.headers.get('content-security-policy') || '').includes('unsafe'), 'CSP frouxa');
const csp = r.headers.get('content-security-policy') || '';
c(/script-src 'self' https:\/\/challenges\.cloudflare\.com;/.test(csp) && /frame-src https:\/\/challenges\.cloudflare\.com;/.test(csp), 'CSP sem o Turnstile');
c(!/script-src[^;]*\*/.test(csp), 'CSP com curinga');
r = await req('GET', '/api/produtos');
c(r.s === 200 && r.j.produtos.length === 8, 'catálogo');
c(r.h.get('cache-control') === 'no-store' && (r.h.get('x-frame-options') === 'DENY'), 'API sem cabeçalhos');
c((await req('GET', '/api/nada')).s === 404, 'rota 404');
c((await req('GET', '/.dev.vars')).t.indexOf('PIMENTA') < 0, 'segredo exposto');
c((await req('GET', '/src/index.js')).t.indexOf('PBKDF2') < 0, 'código do servidor exposto');

/* Turnstile antes do login */
r = await req('GET', '/api/sessao');
c(r.s === 200 && r.j.turnstile === '1x00000000000000000000AA', 'sessão entrega a chave pública do Turnstile');
const regAntes = sql("SELECT COUNT(*) n FROM registro_acesso")[0].n;
const robo = (t) => req('POST', '/api/login', { corpo: { email: 'cliente@exemplo.com.br', senha: 'demonstracao-cliente', turnstile: t } });
r = await req('POST', '/api/login', { corpo: { email: 'cliente@exemplo.com.br', senha: 'demonstracao-cliente' } });
c(r.s === 403 && r.j.codigo === 'verificacao', 'login sem ficha do Turnstile ' + r.s);
c((await robo('ruim-123')).s === 403, 'ficha inválida');
c((await robo(ficha('acao'))).s === 403, 'ficha de outra ação');
c((await robo(ficha('host'))).s === 403, 'ficha de outro endereço');
c((await robo('x'.repeat(3000))).s === 403, 'ficha grande demais');
r = await robo(ficha('quebra'));
c(r.s === 503 && r.j.codigo === 'verificacao_fora', 'Siteverify fora do ar fecha o login ' + r.s);
const repetida = ficha();
c((await robo(repetida)).s === 200, 'ficha válida entra');
c((await robo(repetida)).s === 403, 'ficha reaproveitada');
c(sql("SELECT COUNT(*) n FROM registro_acesso")[0].n === regAntes + 1, 'robô recusado antes do banco');
let semTrava = true;
for (let i = 0; i < 14; i++) if ((await robo('ruim-' + i)).s !== 403) semTrava = false;
c(semTrava, 'robô não gasta tentativas da conta');
c(sv.pedidos.some((x) => x.ficha.startsWith('ok-')), 'servidor consultou o Siteverify');

/* login */
r = await entrar('cliente@exemplo.com.br', 'errada');
c(r.s === 401 && r.j.erro === 'E-mail ou senha incorretos.', 'senha errada');
const inexistente = await entrar('ninguem@exemplo.com.br', 'x');
c(inexistente.s === 401 && inexistente.j.erro === r.j.erro, 'mensagem igual para e-mail inexistente');
c((await req('POST', '/api/login', { corpo: { email: 'a@b.c', senha: 'x' }, origem: false })).s === 403, 'login sem Origin');
c((await req('POST', '/api/login', { corpo: 'x=1', tipo: 'application/x-www-form-urlencoded' })).s === 415, 'login sem JSON');
c((await req('POST', '/api/login', { corpo: '{' })).s === 400, 'JSON quebrado');
c((await req('POST', '/api/login', { corpo: { email: 'x'.repeat(20000), senha: 'x' } })).s === 413, 'corpo grande');
r = await entrar("' OR 1=1 --", "' OR 1=1 --");
c(r.s === 401, 'injeção de SQL no login');
const cli = await entrar('cliente@exemplo.com.br', 'demonstracao-cliente');
c(cli.s === 200 && cli.csrf, 'login do cliente ' + cli.t);
for (const f of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', '__Host-sessao']) c(cli.sc.includes(f), 'cookie sem ' + f);
const outra = await entrar('outra.loja@exemplo.com.br', 'demonstracao-outra-loja');
const ges = await entrar('gestor@exemplo.com.br', 'demonstracao-gestor');
c(outra.s === 200 && ges.s === 200, 'logins');
const u0 = sql("SELECT email, senha_hash, com_pimenta FROM usuarios WHERE email='cliente@exemplo.com.br'")[0];
c(u0.com_pimenta === 1, 'pimenta aplicada no primeiro login');
c(!/demonstracao/.test(JSON.stringify(sql('SELECT * FROM usuarios'))), 'senha aberta no banco');
const tok = cli.cookie.split('=')[1];
c(!JSON.stringify(sql('SELECT token_hash FROM sessoes')).includes(tok), 'token aberto no banco');
c((await entrar('cliente@exemplo.com.br', 'demonstracao-cliente')).s === 200, 'login com pimenta');

/* sessão e CSRF */
c((await req('GET', '/api/pedidos')).s === 401, 'pedidos sem login');
c((await req('GET', '/api/perfil', { cookie: '__Host-sessao=falso' })).s === 401, 'cookie falso');
c((await req('POST', '/api/pedidos', { cookie: cli.cookie, corpo: { itens: [{ produto_id: 1, quantidade: 1 }] } })).s === 403, 'pedido sem CSRF');
c((await req('POST', '/api/pedidos', { cookie: cli.cookie, csrf: outra.csrf, corpo: { itens: [{ produto_id: 1, quantidade: 1 }] } })).s === 403, 'CSRF de outra sessão');
c((await req('POST', '/api/pedidos', { cookie: cli.cookie, csrf: cli.csrf, origem: false, corpo: { itens: [{ produto_id: 1, quantidade: 1 }] } })).s === 403, 'pedido sem Origin');

/* pedidos, papéis e estoque */
const est = async (id) => sql(`SELECT estoque e FROM produtos WHERE id=${id}`)[0].e;
const e1 = await est(1);
r = await req('POST', '/api/pedidos', { cookie: cli.cookie, csrf: cli.csrf, corpo: { itens: [{ produto_id: 1, quantidade: 2 }, { produto_id: 4, quantidade: 1 }], preco: 1, total_centavos: 1 } });
c(r.s === 201 && r.j.total_centavos === 2 * 16490 + 4190, 'preço vem do servidor ' + r.t);
const pid = r.j.id;
c(await est(1) === e1 - 2, 'estoque baixou');
const e2 = await est(1);
r = await req('POST', '/api/pedidos', { cookie: cli.cookie, csrf: cli.csrf, corpo: { itens: [{ produto_id: 1, quantidade: 1 }, { produto_id: 8, quantidade: 99 }] } });
c(r.s === 409, 'sem estoque ' + r.t);
c(await est(1) === e2, 'pedido sem estoque desfeito por inteiro');
for (const q of [0, -1, 1.5, '1', 100000]) c((await req('POST', '/api/pedidos', { cookie: cli.cookie, csrf: cli.csrf, corpo: { itens: [{ produto_id: 1, quantidade: q }] } })).s === 422, 'quantidade ' + q);
c((await req('POST', '/api/pedidos', { cookie: cli.cookie, csrf: cli.csrf, corpo: { itens: [{ produto_id: 999, quantidade: 1 }] } })).s === 422, 'produto inexistente');
c((await req('POST', '/api/pedidos', { cookie: ges.cookie, csrf: ges.csrf, corpo: { itens: [{ produto_id: 1, quantidade: 1 }] } })).s === 403, 'gestor não faz pedido');
c((await req('GET', `/api/pedidos/${pid}`, { cookie: cli.cookie })).s === 200, 'dono vê pedido');
c((await req('GET', `/api/pedidos/${pid}`, { cookie: outra.cookie })).s === 404, 'IDOR: outra loja vê pedido');
c((await req('GET', `/api/pedidos/${pid}`, { cookie: ges.cookie })).s === 200, 'gestor vê pedido');
r = await req('GET', '/api/pedidos', { cookie: outra.cookie }); c(r.j.pedidos.length === 0, 'outra loja lista vazia');
c((await req('POST', `/api/pedidos/${pid}/situacao`, { cookie: cli.cookie, csrf: cli.csrf, corpo: { situacao: 'enviado' } })).s === 403, 'cliente muda situação');
c((await req('POST', `/api/pedidos/${pid}/situacao`, { cookie: ges.cookie, csrf: ges.csrf, corpo: { situacao: 'xpto' } })).s === 422, 'situação inválida');
c((await req('POST', `/api/pedidos/${pid}/situacao`, { cookie: ges.cookie, csrf: ges.csrf, corpo: { situacao: 'enviado' } })).s === 200, 'gestor muda situação');
c((await req('GET', '/api/registro', { cookie: cli.cookie })).s === 403, 'cliente lê registro');
r = await req('GET', '/api/registro', { cookie: ges.cookie });
c(r.s === 200 && r.j.registro.some((x) => x.acao === 'mudar_situacao') && r.j.registro.some((x) => x.acao === 'ver_pedido' && x.resultado === 'negado') && r.j.registro.some((x) => x.acao === 'login' && x.resultado === 'falha'), 'registro de acesso');
c(!/demonstracao|PIMENTA|127\.0\.0\.1/.test(r.t), 'registro vaza dado');

/* cifra */
const DOC = '00.000.000/0001-00', TEL = '(65) 90000-0000';
r = await req('POST', '/api/perfil', { cookie: cli.cookie, csrf: cli.csrf, corpo: { documento: DOC, telefone: TEL } });
c(r.s === 200, 'salvar perfil');
const crua = sql("SELECT documento_cifrado d, telefone_cifrado t FROM usuarios WHERE email='cliente@exemplo.com.br'")[0];
c(crua.d.startsWith('v1.') && !crua.d.includes(DOC) && !crua.t.includes('90000'), 'campo aberto no banco');
r = await req('GET', '/api/perfil', { cookie: cli.cookie });
c(r.j.documento === DOC && r.j.telefone === TEL, 'decifra para o dono');
c((await req('GET', '/api/perfil', { cookie: outra.cookie })).j.documento === null, 'perfil de outro');
await req('POST', '/api/perfil', { cookie: cli.cookie, csrf: cli.csrf, corpo: { documento: DOC, telefone: TEL } });
c(sql("SELECT documento_cifrado d FROM usuarios WHERE email='cliente@exemplo.com.br'")[0].d !== crua.d, 'IV repetido');
sql(`UPDATE usuarios SET documento_cifrado='${crua.d}' WHERE email='outra.loja@exemplo.com.br'`);
c((await req('GET', '/api/perfil', { cookie: outra.cookie })).s === 500, 'cifra copiada para outra conta abriu');
sql("UPDATE usuarios SET documento_cifrado=NULL WHERE email='outra.loja@exemplo.com.br'");

/* interface */
const b = await chromium.launch();
for (const [nome, ctx] of [['computador', { viewport: { width: 1366, height: 800 } }], ['celular', { ...devices['iPhone 13'] }], ['p320', { viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true }]]) {
  const C = await b.newContext({ ...ctx, locale: 'pt-BR', reducedMotion: 'reduce', timezoneId: 'America/Cuiaba' });
  await C.route(/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/, (rt) => {
    const cb = new URL(rt.request().url()).searchParams.get('onload');
    rt.fulfill({ contentType: 'text/javascript', body: `window.turnstile={render:function(s,o){window.__o=o;var e=document.querySelector(s);var d=document.createElement('div');d.style.cssText='width:300px;max-width:100%;height:65px;border:1px solid #ccc';e.appendChild(d);setTimeout(function(){o.callback('ok-'+Math.random().toString(36).slice(2))},30);return 'w1'},reset:function(){setTimeout(function(){window.__o.callback('ok-'+Math.random().toString(36).slice(2))},30)}};window['${cb}']();` });
  });
  const p = await C.newPage(); const er = [];
  p.on('pageerror', (e) => er.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) er.push(m.text()); });
  await p.goto(BASE + '/');
  await p.waitForSelector('#produtos tr');
  c(await p.isDisabled('#enviar'), nome + ' enviar desligado sem login');
  await p.waitForFunction(() => document.querySelector('#verificacao div') && !document.getElementById('m-robo').textContent);
  c(true, nome + ' widget do Turnstile');
  await p.click('.atalhos [data-s="demonstracao-cliente"]');
  await p.waitForSelector('#logado:not([hidden])');
  await p.locator('#produtos input').first().fill('2');
  c((await p.textContent('#total')).includes('329,80'), nome + ' total');
  await p.click('#enviar');
  await p.waitForFunction(() => document.getElementById('m-pedido').textContent.includes('enviado'));
  c(await p.locator('#pedidos li b').count() >= 1, nome + ' lista pedido');
  await p.fill('#doc', '<img src=x onerror=window.__x=1>');
  await p.click('#salvar');
  await p.waitForFunction(() => document.getElementById('banco').textContent.includes('v1.'));
  c(await p.evaluate(() => !window.__x && !document.querySelector('#banco img')), nome + ' XSS');
  c(await p.inputValue('#doc') === '<img src=x onerror=window.__x=1>', nome + ' texto preservado');
  const cook = await C.cookies();
  c(cook.some((k) => k.name === '__Host-sessao' && k.httpOnly && k.sameSite === 'Strict'), nome + ' cookie no navegador');
  c(await p.evaluate(() => !document.cookie.includes('sessao')), nome + ' cookie legível por script');
  const lateral = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  c(lateral <= 1, nome + ' rolagem lateral ' + lateral);
  await p.reload(); await p.waitForSelector('#logado:not([hidden])');
  c(true, 'sessão mantida');
  if (nome !== 'p320') await p.screenshot({ path: `${SAI}/cliente-${nome}.png`, fullPage: true });
  await p.click('#sair'); await p.waitForSelector('#f-login:not([hidden])');
  c(await p.isVisible('#verificacao'), nome + ' widget volta depois de sair');
  await p.fill('#email', 'cliente@exemplo.com.br'); await p.fill('#senha', 'errada'); await p.click('#f-login button');
  await p.waitForFunction(() => document.getElementById('e-login').textContent.includes('incorretos'));
  await p.waitForTimeout(120);
  await p.click('.atalhos [data-s="demonstracao-gestor"]');
  await p.waitForSelector('#s-registro:not([hidden])');
  await p.waitForSelector('#registro tr');
  c(await p.locator('#pedidos select').count() >= 1, nome + ' gestor muda situação');
  if (nome !== 'p320') await p.screenshot({ path: `${SAI}/gestor-${nome}.png`, fullPage: true });
  const AXE = require('axe-core').source;
  await p.evaluate(AXE).catch(() => {});
  const ax = await p.evaluate(async () => { if (!window.axe) return null; const a = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }); return a.violations.map((v) => `${v.id}:${v.nodes[0].target}`); }).catch(() => null);
  if (ax) c(ax.length === 0, nome + ' axe ' + ax.join('|'));
  c(er.length === 0, nome + ' erros ' + er.slice(0, 2));
  await C.close();
}
await b.close();

/* achados da vistoria de 06/11 */
r = await req('GET', '/api/saude');
c(r.s === 200 && r.j.ok === true, 'saúde responde');
c((r.h.get('permissions-policy') || '').includes('camera=()'), 'Permissions-Policy na API');
const cc = await entrar('cliente@exemplo.com.br', 'demonstracao-cliente');
r = await req('POST', '/api/pedidos', { cookie: cc.cookie, csrf: '!'.repeat(cc.csrf.length), corpo: { itens: [{ produto_id: 1, quantidade: 1 }] } });
c(r.s === 403, 'CSRF malformado dá 403, veio ' + r.s);
const juntos = await Promise.all(Array.from({ length: 8 }, () => req('POST', '/api/pedidos', { cookie: cc.cookie, csrf: cc.csrf, corpo: { itens: [{ produto_id: 2, quantidade: 1 }, { produto_id: 3, quantidade: 1 }] } })));
c(juntos.every((x) => x.s === 201), 'pedidos simultâneos: ' + juntos.map((x) => x.s).join(','));
c(new Set(juntos.map((x) => x.j && x.j.id)).size === 8, 'pedidos simultâneos com números diferentes');
for (const x of juntos) { const dt = await req('GET', `/api/pedidos/${x.j.id}`, { cookie: cc.cookie }); c(dt.s === 200 && dt.j.itens.length === 2, 'pedido simultâneo com os próprios itens'); }
r = await fetch(BASE + '/nao-existe');
c(r.status === 404 && (await r.text()).includes('Página não encontrada'), 'página 404');
r = await fetch(BASE + '/favicon.svg'); c(r.status === 200, 'favicon');
r = await fetch(BASE + '/og.png'); c(r.status === 200, 'imagem de compartilhamento');

/* sem a chave secreta do Turnstile: login fecha, o resto abre */
const B2 = process.env.BASE_SEM_TURNSTILE;
c(Boolean(B2), 'faltou BASE_SEM_TURNSTILE para testar o servidor sem chave');
if (B2) {
  const o2 = { Origin: B2, 'Content-Type': 'application/json' };
  const g = async (rota) => { const x = await fetch(B2 + rota); return { s: x.status, j: await x.json().catch(() => null) }; };
  c((await g('/api/saude')).s === 200, 'sem chave: saúde');
  const pr = await g('/api/produtos'); c(pr.s === 200 && pr.j.produtos.length === 8, 'sem chave: catálogo');
  const se = await g('/api/sessao'); c(se.s === 200 && se.j.turnstile === null, 'sem chave: sessão sem Turnstile');
  const lg = await fetch(B2 + '/api/login', { method: 'POST', headers: o2, body: JSON.stringify({ email: 'cliente@exemplo.com.br', senha: 'demonstracao-cliente', turnstile: ficha() }) });
  const lj = await lg.json();
  c(lg.status === 503 && lj.codigo === 'configuracao' && lj.erro.includes('robôs'), 'sem chave: login recusado ' + lg.status);
}

/* faxina pelo agendamento */
r = await fetch(BASE + '/__scheduled?cron=17+7+*+*+*');
c(r.status === 200, 'faxina respondeu');
await new Promise((o) => setTimeout(o, 800));
c(sql('SELECT COUNT(*) n FROM pedidos')[0].n === 0, 'faxina limpa pedidos');
c(sql('SELECT COUNT(*) n FROM produtos WHERE estoque<>estoque_inicial')[0].n === 0, 'faxina repõe estoque');

/* força bruta por origem */
let bloqueou = false;
for (let i = 0; i < 14 && !bloqueou; i++) bloqueou = (await entrar('gestor@exemplo.com.br', 'palpite' + i)).s === 429;
c(bloqueou, 'força bruta não bloqueou');

sv.srv.close();
console.log(`conferências ok: ${ok}, falhas: ${falhas.length}`);
falhas.forEach((f) => console.log(' -', String(f).slice(0, 240)));
process.exit(falhas.length ? 1 : 0);
