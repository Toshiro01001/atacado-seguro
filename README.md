# Atacado Seguro

![Painel do gestor no Atacado Seguro](docs/tela.webp)

**Ver funcionando:** https://atacado-seguro.contato-aea.workers.dev

Fiz esta demonstração para mostrar um sistema de atacado com servidor de verdade, em Cloudflare Workers e banco D1. Empresa, produtos e dados são fictícios. As contas de teste são públicas e estão na própria página.

## Como testar em dois minutos

1. Entre como **Cliente**, escolha quantidades no catálogo e envie um pedido.
2. Em **Dados cifrados**, salve um documento fictício e veja o texto cifrado que fica no banco.
3. Entre como **Outra loja** e tente abrir o pedido anterior pelo número: o servidor nega.
4. Entre como **Gestor**, mude a situação do pedido e veja tudo anotado no registro de acesso.

## O que ele mostra

| Requisito | Como foi feito |
| --- | --- |
| Banco com acesso restrito | O navegador só fala com a API, e o banco só é alcançado pelo Worker, com consultas parametrizadas |
| Login | Sessão em cookie `__Host-`, HttpOnly, Secure e SameSite=Strict, com hash do token no banco |
| Senhas | PBKDF2-SHA-256 com salt e pimenta (HMAC com segredo fora do banco) |
| Permissões | Cliente e gestor conferidos no servidor em cada rota, com proteção contra CSRF e checagem de Origin |
| Criptografia de campos | AES-256-GCM, com o campo e o usuário como dados autenticados |
| Registro de acesso | Logins, negativas e mudanças, sem senhas e com o IP em hash, por 30 dias |
| Cópia de segurança | Time Travel do D1 e `scripts/backup.sh` para exportar |
| Cabeçalhos | HSTS, CSP, `frame-ancestors`, X-Frame-Options, Permissions-Policy e outros em `public/_headers` e na API |
| Pedidos simultâneos | O número do pedido nasce dentro da transação, então vários pedidos ao mesmo tempo não se atrapalham |

## Limitações conhecidas

- A Web Crypto dos Workers em produção aceita até 100.000 rodadas de PBKDF2, abaixo das 600.000 recomendadas pela OWASP. A pimenta compensa em parte, se só o banco vazar. Para senhas de clientes reais, avalie Argon2id ou um serviço de login gerenciado.
- O plano gratuito limita o tempo de CPU por requisição, e o login pode exceder esse limite. Um sistema real deve usar o plano pago.
- As contas de demonstração têm senhas públicas. Não reutilize este arquivo de contas.
- Não houve teste de invasão independente.

## Como rodar

```sh
npm install
# crie .dev.vars com PIMENTA e CHAVE_DADOS, cada uma com 32 bytes em base64
npm run banco:local
npm run dev
```

Testes: com o servidor local no ar, `BASE=http://localhost:8787 npm run testar`. Precisam de Playwright e axe-core instalados.

## Como publicar

Cada envio na `main` publica pelo Workers Builds da Cloudflare, com `npx wrangler d1 migrations apply atacado-seguro --remote` na compilação e `npx wrangler deploy` na publicação.

Para outra conta: crie o banco D1 `atacado-seguro`, coloque o `database_id` em `wrangler.jsonc` e cadastre os segredos `PIMENTA` e `CHAVE_DADOS` no Worker. Sem esses segredos, o catálogo abre e o login fica travado.

Desenvolvi este projeto e usei o Claude, da Anthropic, como ferramenta durante o desenvolvimento.
