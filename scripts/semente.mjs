// Gera migrations/0002_contas_demo.sql: contas públicas de demonstração, sem pimenta.
// A pimenta entra no primeiro login. Não use estas contas fora da demonstração.
import { webcrypto as c } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const N = 100000;
const contas = [
  ['cliente@exemplo.com.br', 'Mercado Exemplo Ltda (fictício)', 'cliente', 'demonstracao-cliente'],
  ['outra.loja@exemplo.com.br', 'Outra Loja Exemplo (fictícia)', 'cliente', 'demonstracao-outra-loja'],
  ['gestor@exemplo.com.br', 'Gestor de Exemplo', 'gestor', 'demonstracao-gestor'],
];
const b64 = (b) => Buffer.from(b).toString('base64');
let sql = '-- Contas públicas de demonstração, com senhas publicadas na própria página.\n';
for (const [email, nome, papel, senha] of contas) {
  const salt = c.getRandomValues(new Uint8Array(16));
  const k = await c.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits']);
  const d = await c.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: N }, k, 256);
  sql += `INSERT INTO usuarios (email, nome, papel, salt, senha_hash, iteracoes, com_pimenta, demo) VALUES ('${email}', '${nome}', '${papel}', '${b64(salt)}', '${b64(d)}', ${N}, 0, 1);\n`;
}
writeFileSync(new URL('../migrations/0002_contas_demo.sql', import.meta.url), sql);
