# Ágora — arquitetura técnica

Plataforma Integrada de Contratações Públicas (Lei 14.133/2021). Auto-hospedável na infraestrutura do órgão, sem serviços estrangeiros em tempo de execução.

```
 Navegador (SPA React, estático)
      │  HTTPS — só fala com a própria Ágora (cookie HttpOnly + cabeçalho CSRF)
      ▼
 ┌──────────────────────── Processo Node.js (Fastify) ─────────────────────────┐
 │  /api/v1/*  rotas → serviços → repositórios (SQL explícito)                 │
 │  autenticação · RBAC + escopo UASG · auditoria encadeada · LGPD             │
 │  @agora/dominio (regras da Lei 14.133, puro e testado)                       │
 │  integrações (PNCP / Compras.gov.br / Contratos.gov.br) em jobs no servidor │
 │  IA opcional: só endpoint auto-hospedado (compatível com OpenAI)            │
 │  arquivos estáticos do front-end com CSP estrita                            │
 └──────────────┬──────────────────────────────────────────────────────────────┘
                ▼
     PostgreSQL 16 (produção)  |  PGlite embutido (demonstração/desenvolvimento)
```

## 1. Pilha

| Camada | Escolha | Por quê |
|---|---|---|
| Runtime | Node.js 24 LTS | LTS, imagem oficial, sem licença |
| HTTP | Fastify 5 + @fastify/cookie, @fastify/static, @fastify/helmet, @fastify/rate-limit | maduro, rápido, plugins oficiais |
| Validação | zod 4 | um esquema por rota |
| Banco | PostgreSQL 16 via `pg`; PGlite (`@electric-sql/pglite`) no modo demonstração | mesmo dialeto SQL nos dois modos |
| Front-end | React 19 + React Router 7 + TanStack Query 5, Vite 7 | sem biblioteca de UI externa: componentes próprios no padrão gov.br DS |
| Ícones | lucide-react (empacotado) | sem CDN |
| Fontes | Rawline e Raleway servidas pela própria aplicação | sem Google Fonts |
| Testes | `node:test` (domínio e API, PGlite em memória), Playwright + axe (ponta a ponta e acessibilidade) | |
| Entrega | Dockerfile multiestágio (usuário não-root), docker-compose com PostgreSQL, manifestos Kubernetes | nuvem do órgão |

Monorepo npm workspaces:

```
packages/dominio     regras puras (zero dependências)
packages/contratos   tipos da API compartilhados por API e web
apps/api             servidor Fastify (serve também o front-end compilado)
apps/web             SPA React
deploy/              Dockerfile, compose, k8s
docs/                arquitetura, segurança, LGPD, operação
```

Regras de camada: `apps/web` só importa `@agora/contratos`, `@agora/dominio` e bibliotecas de UI. Nunca `apps/api`. `@agora/dominio` não importa nada.

## 2. Configuração (variáveis de ambiente)

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_AMBIENTE` | `demonstracao` | `demonstracao` \| `homologacao` \| `producao` |
| `AGORA_PORTA` | `3000` | porta HTTP |
| `AGORA_HOST` | `0.0.0.0` | |
| `AGORA_BANCO_URL` | vazio | `postgres://…` usa PostgreSQL; vazio usa PGlite em `AGORA_DADOS_DIR` |
| `AGORA_DADOS_DIR` | `./.data/pglite` | diretório do PGlite |
| `AGORA_SEGREDO_SESSAO` | obrigatório em produção (≥ 32 bytes) | assina o cookie; em demonstração é gerado e persistido em `AGORA_DADOS_DIR/segredo` |
| `AGORA_COOKIE_SEGURO` | `true` em produção | atributo `Secure` |
| `AGORA_SEED_DEMONSTRACAO` | `true` em demonstração | popula dados sintéticos se o banco estiver vazio |
| `AGORA_INTEGRACOES` | `offline` | `offline` (fixtures sintéticas) \| `online` (APIs públicas do governo, chamadas pelo servidor) |
| `AGORA_IA_PROVEDOR` | `nenhum` | `nenhum` \| `openai_compativel` |
| `AGORA_IA_URL`, `AGORA_IA_MODELO`, `AGORA_IA_CHAVE` | | endpoint auto-hospedado (vLLM, Ollama etc.) |
| `AGORA_GOVBR_CLIENT_ID`, `AGORA_GOVBR_CLIENT_SECRET`, `AGORA_GOVBR_EMISSOR`, `AGORA_GOVBR_REDIRECT` | | Login Único gov.br (OIDC + PKCE); habilitado se todos definidos |
| `AGORA_ORGAO_NOME`, `AGORA_ORGAO_SIGLA`, `AGORA_ORGAO_UNIDADE` | MJSP / SENASP | identificação no cabeçalho |
| `AGORA_ENCARREGADO_NOME`, `AGORA_ENCARREGADO_EMAIL` | | encarregado LGPD exibido na página de privacidade |
| `AGORA_LOG_NIVEL` | `info` | |
| `AGORA_ORGAO_CNPJ` | vazio | CNPJ do órgão; obrigatório para a sincronização online com o PNCP |
| `AGORA_CONFIAR_PROXY` | `false` | `true` atrás de Ingress/proxy reverso, para usar o IP real do cliente (`X-Forwarded-For`) |
| `AGORA_LIMITE_REQUISICOES_MINUTO` | `300` | limite global por IP na API |
| `AGORA_WEB_DIR` | `apps/web/dist` | diretório do front-end compilado |

Configuração validada com zod na inicialização; falha → o processo encerra com mensagem clara.

## 3. Segurança

### 3.1 Cabeçalhos (todas as respostas)
- `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests`. Em `demonstracao` sem HTTPS, omitir `upgrade-insecure-requests`.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (quando `AGORA_COOKIE_SEGURO`)
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`
- Sem CORS (mesma origem). Respostas da API com `Cache-Control: no-store`.

### 3.2 Sessão e autenticação
- Tabela `sessoes` (id = 32 bytes aleatórios em base64url, guardado como SHA-256), `usuario_id`, `csrf_token`, `criada_em`, `expira_em` (8 h, renovação deslizante até 12 h absolutas), `ip_hash`, `agente`.
- Cookie `agora_sessao`: `HttpOnly; SameSite=Strict; Path=/; Secure` (conforme config), assinado.
- CSRF: toda requisição não-GET em `/api/v1` exige o cabeçalho `X-Agora-CSRF` igual ao `csrf_token` da sessão (comparação em tempo constante). Exceção: `POST /sessao` (login).
- Senhas: `scrypt` (N=16384, r=8, p=1, 64 bytes) com sal de 16 bytes; formato `scrypt$N$r$p$sal$hash`. Comparação em tempo constante. Política: mínimo 12 caracteres.
- Limite: 5 tentativas de login por e-mail+IP em 15 min → 429 `LIMITE_TENTATIVAS`. Rate limit global de 300 req/min por IP na API.
- Mensagem de falha de login genérica ("E-mail ou senha inválidos").
- Login Único gov.br: OIDC Authorization Code + PKCE (S256), `state` e `nonce` em cookie temporário assinado; o `sub`/CPF do gov.br vincula a um usuário existente e ativo (nunca cria usuário automaticamente).

### 3.3 Autorização
- Perfis e permissões (matriz fixa no código, exibida em `GET /perfis`):

| Perfil | Permissões |
|---|---|
| administrador | todas |
| gestor_contratos | painel:ler, pendencias:resolver, atas:ler, atas:editar, contratos:ler, contratos:editar, itens:ler, empenhos:ler, pagamentos:ler, vinculos:editar, tarefas:editar, fornecedores:ler, sancoes:ler, sancoes:instruir, jornada:ler |
| fiscal | painel:ler, pendencias:resolver, atas:ler, contratos:ler, itens:ler, empenhos:ler, pagamentos:ler, pagamentos:atestar, tarefas:editar, fornecedores:ler, sancoes:ler |
| financeiro | painel:ler, atas:ler, contratos:ler, itens:ler, empenhos:ler, pagamentos:ler, vinculos:editar, integracoes:executar, fornecedores:ler |
| planejamento | painel:ler, atas:ler, contratos:ler, itens:ler, fornecedores:ler, jornada:ler, jornada:editar |
| agente_contratacao | painel:ler, atas:ler, contratos:ler, itens:ler, fornecedores:ler, sancoes:ler, jornada:ler, jornada:editar, jornada:publicar |
| juridico | painel:ler, atas:ler, contratos:ler, fornecedores:ler, sancoes:ler, jornada:ler, jornada:aprovar_juridico |
| auditor | todas as `:ler`, auditoria:ler, lgpd:revelar, lgpd:relatorio |
| consulta | painel:ler, atas:ler, contratos:ler, itens:ler, empenhos:ler, pagamentos:ler, fornecedores:ler |

- Toda rota declara a permissão exigida (`preHandler: exigir('contratos:ler')`). Sem sessão → 401; sem permissão → 403 `SEM_PERMISSAO`.
- Escopo por UASG: usuários sem `todasUasgs` só veem registros das UASGs em `usuarios_uasgs`, filtradas no SQL (`WHERE uasg = ANY($n)`). Acesso a um id fora do escopo → 404 (não revela existência).
- `ajustes:editar` e `admin:usuarios`: só administrador. `lgpd:revelar`: administrador e auditor.

### 3.4 Trilha de auditoria (append-only, encadeada)
Tabela `auditoria_eventos`: `sequencia BIGSERIAL`, `id uuid`, `ocorrido_em timestamptz`, `usuario_id`, `acao`, `recurso`, `recurso_id`, `resumo`, `dados jsonb` (antes/depois sem dados pessoais em claro), `ip_hash`, `hash_anterior`, `hash`.
- `hash = sha256(hash_anterior + '|' + sequencia + '|' + ocorrido_em ISO + '|' + (usuario_id ?? '') + '|' + acao + '|' + recurso + '|' + (recurso_id ?? '') + '|' + JSON canônico(dados))`. Primeiro evento: `hash_anterior = '0' × 64`.
- Inserção serializada (advisory lock `pg_advisory_xact_lock` ou transação com `SELECT … FOR UPDATE` do último evento).
- Trigger SQL que bloqueia `UPDATE` e `DELETE` em `auditoria_eventos`.
- `GET /auditoria/verificacao` recalcula a cadeia inteira.
- Eventos obrigatórios: login (sucesso/falha), logout, toda escrita, toda revelação LGPD, execução de sincronização, alteração de usuário/perfil.

### 3.5 LGPD
- Dados pessoais: CPF (usuários, credores PF, sócios), e-mail, telefone, nome de PF.
- Respostas mascaram com `@agora/dominio` (`mascararCpf`, `mascararEmail`, `mascararTelefone`, `mascararNome`). Exceção: o próprio usuário vê os seus dados em `/sessao`.
- `POST /lgpd/revelar` exige `lgpd:revelar` e finalidade; grava em `lgpd_acessos` e na auditoria.
- Logs (pino) com `redact` de `req.headers.cookie`, `req.headers.authorization`, `senha`, `cpf`, `email`, `x-agora-csrf`.
- `ip_hash` = sha256(ip + segredo) — nunca IP em claro.
- Sem dados de negócio no `localStorage` do navegador.

## 4. Banco de dados

Migrações SQL versionadas em `apps/api/migracoes/NNN_nome.sql`, aplicadas em ordem na inicialização (tabela `migracoes_aplicadas`, cada uma em transação). Nomes em português, `snake_case`. Chaves `uuid DEFAULT gen_random_uuid()`. Dinheiro `bigint` (centavos). Datas `date`; instantes `timestamptz`.

Tabelas mínimas:
`uasgs`, `unidades_internas`, `grupos_uasg`, `grupos_uasg_membros`, `usuarios` (nome, email único, cpf, senha_hash, ativo, unidade_interna_id, todas_uasgs, ultimo_acesso_em), `usuarios_perfis`, `usuarios_uasgs`, `sessoes`, `tentativas_login`, `fornecedores` (documento, tipo_pessoa, razao_social, porte, uf, telefone, email), `fornecedores_socios` (fornecedor_id, cpf, nome), `fornecedores_indicadores` (entregas_no_prazo…), `atas`, `itens_ata`, `atas_a_montar`, `contratos` (com `ata_id` nulo), `itens_contrato`, `aditivos`, `reajustes_ciclos`, `empenhos` (contrato_id nulo), `empenhos_itens`, `pagamentos`, `pendencias`, `tarefas` (instrumento_tipo, instrumento_id), `modelos_gestao`, `modelos_gestao_tarefas`, `feriados_locais`, `sancoes`, `auditoria_eventos`, `lgpd_acessos`, `sincronizacoes`, `processos` (+ colunas jsonb para dfd, etp, riscos, cesta, parecer, publicacao, disputa), `processos_equipe`, `documentos_gerados`, `migracoes_aplicadas`.

Índices nas colunas de filtro (uasg, situacao, vigencia_fim, contrato_id, fornecedor_id) e busca textual simples com `ILIKE` sobre colunas normalizadas (`unaccent` não está disponível no PGlite: normalizar no aplicativo e guardar `busca_normalizada`).

## 5. Dados sintéticos (seed)

- Gerador determinístico (PRNG mulberry32, semente fixa) relativo à data de execução (`hoje`), para os prazos parecerem atuais.
- **Nenhum dado real**: nomes de pessoas e empresas inventados; CNPJ/CPF com dígitos verificadores válidos gerados; códigos de UASG fictícios na faixa 9xxxxx; nomes das unidades descritivos ("Polícia Federal — Diretoria de Administração e Logística (demonstração)").
- Volumes: 12 UASGs, 8 unidades internas, 4 grupos, 30 fornecedores (25 PJ, 5 PF), 40 atas (≈ 320 itens), 60 contratos (≈ 45 vinculados a atas), 220 empenhos (≈ 15 sem contrato), 480 pagamentos, 120 pendências, 6 modelos de gestão, 6 sanções, 8 processos na jornada distribuídos pelas 7 etapas, cotações de preços realistas para objetos de segurança pública (viaturas, coletes balísticos, rádios, licenças de software de perícia, EPIs, munição de treinamento, drones).
- Distribuição de vigências que exercite todo o semáforo (vencidos, ≤30, ≤60, ≤90, >90) e contratos com divulgação PNCP pendente e vencida.
- Usuários de demonstração (só em `demonstracao`), senha única `Agora@Demo2026`: `admin@agora.demo`, `gestor@agora.demo`, `fiscal@agora.demo`, `financeiro@agora.demo`, `planejamento@agora.demo`, `agente@agora.demo`, `juridico@agora.demo`, `auditor@agora.demo`, `consulta@agora.demo` (o de consulta com escopo de 2 UASGs).
- Em `producao`: sem seed; `npm run criar-admin -w @agora/api -- --email … --nome … --cpf …` cria o primeiro administrador e imprime senha temporária.

## 6. Integrações (servidor)

Interface `Conector { fonte: FonteDados; conjunto: string; executar(ctx): Promise<{ registros: number; hash: string; mensagem: string }> }`.
- `offline`: regenera o snapshot sintético do conjunto (idempotente) e registra proveniência.
- `online`: PNCP — API pública de consulta (`https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=AAAAMMDD&dataFinal=AAAAMMDD&cnpjOrgao=…&pagina=N`), timeout 15 s, 2 novas tentativas com espera exponencial, limite de páginas, gravação em staging e *upsert* idempotente que nunca sobrescreve campos editados por usuários. Proveniência: fonte, horário, hash SHA-256 do conteúdo recebido, quantidade.
- Nunca há proxy aberto: o navegador não chama nem repassa requisições para APIs externas.

## 7. IA (opcional)

`ProvedorIa { gerar(prompt, contexto): Promise<{ texto: string; modelo: string }> }`.
- `nenhum` (padrão): documentos (DFD, ETP, TR, edital, minuta, nota técnica) gerados por **modelos de texto determinísticos** preenchidos com os dados do processo, com premissas e fontes listadas.
- `openai_compativel`: `POST {AGORA_IA_URL}/v1/chat/completions`, timeout 60 s; o texto volta como rascunho, sempre com o aviso "Rascunho gerado por IA — requer revisão humana" e a lista de fontes do contexto.
- IA nunca decide sanção, habilitação, fraude ou multa.

## 8. Operação

- `GET /saude/vivo` e `GET /saude/pronto` (verifica banco).
- Encerramento gracioso em SIGTERM/SIGINT (fecha HTTP e banco).
- Logs JSON em stdout com `idRequisicao`.
- Front-end compilado servido de `apps/web/dist`: arquivos com hash `Cache-Control: public, max-age=31536000, immutable`; `index.html` `no-cache`; rotas não-API caem no `index.html`.
