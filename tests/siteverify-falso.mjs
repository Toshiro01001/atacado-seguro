// Siteverify de mentira, só para os testes locais (o contêiner não alcança a Cloudflare).
// Fichas: "ok-..." passam uma vez; "acao-..." voltam com outra ação; "host-..." com outro endereço;
// "quebra-..." fazem o Siteverify responder 500; o resto é recusado.
import { createServer } from 'node:http';
export const SEGREDO_TESTE = '1x0000000000000000000000000000000AA';
export function iniciarSiteverify(porta = 8788) {
  const usadas = new Set();
  const pedidos = [];
  const srv = createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      const p = new URLSearchParams(corpo);
      const ficha = p.get('response') || '';
      pedidos.push({ ficha, ip: p.get('remoteip') });
      const responder = (o, st = 200) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (p.get('secret') !== SEGREDO_TESTE) return responder({ success: false, 'error-codes': ['invalid-input-secret'] });
      if (ficha.startsWith('quebra-')) return responder({ erro: 'fora' }, 500);
      if (usadas.has(ficha)) return responder({ success: false, 'error-codes': ['timeout-or-duplicate'] });
      usadas.add(ficha);
      if (ficha.startsWith('ok-')) return responder({ success: true, action: 'login', hostname: 'localhost' });
      if (ficha.startsWith('acao-')) return responder({ success: true, action: 'cadastro', hostname: 'localhost' });
      if (ficha.startsWith('host-')) return responder({ success: true, action: 'login', hostname: 'site-alheio.example' });
      return responder({ success: false, 'error-codes': ['invalid-input-response'] });
    });
  });
  return new Promise((ok) => srv.listen(porta, '127.0.0.1', () => ok({ srv, pedidos })));
}
