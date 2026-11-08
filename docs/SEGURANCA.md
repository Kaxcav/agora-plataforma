# Ágora — segurança da informação

## 1. Princípios

1. **O navegador nunca fala com o banco nem com terceiros.** Ele só chama a API da própria Ágora, na mesma origem.
2. **O servidor decide a autorização.** A interface só esconde o que o servidor já nega.
3. **Dados oficiais entram pelo servidor.** As integrações rodam em jobs no servidor, com proveniência. O usuário não consegue gravar um "dado do SIAFI/PNCP".
4. **Tudo que altera estado deixa rastro verificável** (trilha encadeada por hash).
5. **Mínimo privilégio em todas as camadas**: perfis, escopo por UASG, contêiner sem root, sistema de arquivos somente leitura e rede de saída restrita.

## 2. Controles

| Ameaça | Controle |
|---|---|
| Roubo de sessão por XSS | Cookie `HttpOnly`; CSP `script-src 'self'` sem `unsafe-inline`; nenhum token em `localStorage` |
| CSRF | Cookie `SameSite=Strict` e cabeçalho `X-Agora-CSRF` obrigatório em toda escrita (comparação em tempo constante) |
| Clickjacking | `frame-ancestors 'none'` e `X-Frame-Options: DENY` |
| Força bruta | 5 tentativas por e-mail+IP a cada 15 min; limite global por IP; mensagem de erro genérica |
| Senhas vazadas | scrypt (N=16384, r=8, p=1) com sal; mínimo de 12 caracteres; Login Único gov.br como alternativa |
| Escalada de privilégio | Matriz de permissões no servidor; `exigir(permissão)` em toda rota; escopo por UASG aplicado no SQL; id fora do escopo responde 404 |
| Injeção de SQL | Consultas parametrizadas e listas de colunas explícitas |
| Entrada malformada | Validação zod em toda rota; erros padronizados |
| Adulteração de registros | Trilha append-only (gatilho bloqueia `UPDATE`/`DELETE`) encadeada por SHA-256, com verificação pela interface |
| Vazamento de dado pessoal | Mascaramento padrão; revelação com permissão, finalidade e registro; logs com redação |
| Dados forjados de integração | Integração só no servidor, com hash do conteúdo recebido e *upsert* idempotente |
| Proxy aberto | Inexistente: o navegador não repassa chamadas a APIs externas |
| Dependência de terceiros em tempo de execução | Fontes e ícones empacotados; CSP `connect-src 'self'` impede chamadas externas do navegador |
| Comprometimento do contêiner | Usuário `node` (não-root), raiz somente leitura, `cap_drop: ALL`, `no-new-privileges`; NetworkPolicy de saída |

## 3. Cabeçalhos HTTP

`Content-Security-Policy`, `Strict-Transport-Security` (com TLS), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`. A API responde com `Cache-Control: no-store`.

## 4. Responsabilidades do órgão na implantação

- Terminação TLS (Ingress ou proxy reverso) e `AGORA_COOKIE_SEGURO=true`.
- `AGORA_SEGREDO_SESSAO` com pelo menos 32 bytes aleatórios, guardado em cofre de segredos.
- PostgreSQL com TLS, backup e restauração testados.
- Credenciais do Login Único gov.br emitidas para o órgão.
- Coleta dos logs JSON pelo SIEM do órgão.
- Teste de intrusão autorizado antes da produção e a cada versão relevante.

## 5. Verificações automatizadas

- Testes da API cobrem: autenticação, limite de tentativas, CSRF, RBAC, escopo por UASG, cadeia de auditoria (inclusive detecção de adulteração), registro LGPD, mascaramento e cabeçalhos.
- Testes ponta a ponta com axe (acessibilidade) nas telas principais.
- Travas da Fábrica Kaxcav antes de cada entrega: zero-slop, ciclos, camadas e DLP de segredos.
