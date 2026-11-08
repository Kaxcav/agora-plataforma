# Ágora — Plataforma Integrada de Contratações Públicas

Gestão de atas, contratos, financeiro e da jornada completa de contratação da Lei 14.133/2021, auto-hospedável na infraestrutura do órgão.

- **Soberana**: roda em contêiner ou servidor do próprio órgão (PostgreSQL + Node.js). Nenhum serviço estrangeiro em tempo de execução; o navegador só fala com a própria plataforma.
- **Segura**: autorização no servidor por perfil e por UASG, sessão em cookie `HttpOnly`, CSRF, CSP estrita, trilha de auditoria encadeada por hash com verificação de integridade.
- **Aderente à LGPD**: dados pessoais mascarados por padrão, revelação com finalidade registrada, sem dado de negócio no navegador.
- **Regras da Lei 14.133 testadas**: um pacote de domínio com centenas de testes automatizados, fonte única das regras (prazos do art. 183, dispensa do art. 75, aditivos do art. 125, dosimetria do art. 156, desempate do art. 60, ETP do art. 18, cesta de preços do art. 23 e outras).
- **Padrão Digital de Governo**: gov.br DS 3.7, Rawline, contraste AA, teclado, leitor de tela.
- **Código cedido ao órgão** (art. 93): pilha aberta, sem licença por usuário.

## Começar em 1 minuto (demonstração)

Requisitos: Node.js 24+.

```bash
npm ci
npm run build
npm start            # http://localhost:3000
```

Sem `AGORA_BANCO_URL`, a Ágora usa PostgreSQL embutido (PGlite) em `./.data/` e carrega **dados 100% sintéticos** na primeira execução.

Contas de demonstração (senha `Agora@Demo2026`):

| E-mail | Perfil |
|---|---|
| `admin@agora.demo` | Administrador |
| `gestor@agora.demo` | Gestor de contratos |
| `fiscal@agora.demo` | Fiscal |
| `financeiro@agora.demo` | Financeiro |
| `planejamento@agora.demo` | Planejamento (requisitante) |
| `agente@agora.demo` | Agente de contratação |
| `juridico@agora.demo` | Jurídico (CONJUR) |
| `auditor@agora.demo` | Auditor (controle interno) |
| `consulta@agora.demo` | Consulta (escopo de 2 UASGs) |

## Implantar no órgão

```bash
cp .env.exemplo .env      # defina AGORA_SEGREDO_SESSAO e POSTGRES_PASSWORD
docker compose -f deploy/docker-compose.yml --env-file .env up -d --build
```

- Kubernetes: `deploy/k8s/agora.yaml` (Deployment com 2 réplicas, probes, contêiner não-root somente leitura, NetworkPolicy, PDB, Ingress com TLS).
- Produção: `AGORA_AMBIENTE=producao`, `AGORA_COOKIE_SEGURO=true` (TLS obrigatório) e `AGORA_SEED_DEMONSTRACAO=false`. O primeiro administrador é criado com:

  ```bash
  npm run criar-admin -w @agora/api -- --email ... --nome ... --cpf ...
  ```
- Login Único gov.br: defina `AGORA_GOVBR_*` com as credenciais emitidas para o órgão.
- Integrações online (PNCP): `AGORA_INTEGRACOES=online` e `AGORA_ORGAO_CNPJ`.
- IA opcional, somente auto-hospedada: `AGORA_IA_PROVEDOR=openai_compativel` e `AGORA_IA_URL`.

## Ambiente de demonstração (Railway)

A Railway serve **apenas para demonstração, com dados 100% sintéticos**. Dados reais e a produção ficam na infraestrutura do órgão (seção anterior).

- Cada push na branch `master` publica uma nova versão. A configuração está em `railway.json`: imagem `deploy/Dockerfile` e verificação de saúde em `/saude/pronto`.
- Serviços: `agora` (esta aplicação) e `Postgres`.
- Variáveis do serviço `agora`:
  - `AGORA_BANCO_URL=${{Postgres.DATABASE_URL}}`
  - `AGORA_SEGREDO_SESSAO` (aleatório, ≥ 32 bytes)
  - `AGORA_AMBIENTE=demonstracao`
  - `AGORA_SEED_DEMONSTRACAO=true`
  - `AGORA_COOKIE_SEGURO=true`
  - `AGORA_CONFIAR_PROXY=true`
  - `AGORA_INTEGRACOES=offline`
  - `AGORA_IA_PROVEDOR=nenhum`
  - `PORT=3000`

## Estrutura

```
packages/dominio     regras da Lei 14.133 (TypeScript puro, zero dependências, testado)
packages/contratos   tipos da API compartilhados por servidor e interface
apps/api             servidor Fastify: API, autenticação, RBAC, auditoria, LGPD, integrações, seed sintético
apps/web             interface React (gov.br DS), servida pela própria API
e2e                  testes ponta a ponta e de acessibilidade (Playwright + axe)
deploy               Dockerfile, docker-compose, Kubernetes
docs                 arquitetura, interface, jornada, segurança, LGPD
```

## Comandos

| Comando | O que faz |
|---|---|
| `npm run build` | compila domínio, contratos, interface e API |
| `npm start` | inicia a plataforma compilada |
| `npm run dev` | API em modo observação (use `npm run dev -w @agora/web` para a interface com recarga) |
| `npm test` | testes do domínio e da API |
| `npm run typecheck` | checagem de tipos de todos os pacotes |
| `npm run e2e` | testes ponta a ponta e de acessibilidade (requer `npm run build` e `npx playwright install chromium`) |
| `npm run seed -w @agora/api -- --reset` | recria os dados sintéticos (só em demonstração) |

## Documentação

- [Manual do usuário](docs/MANUAL-DO-USUARIO.md)
- [Arquitetura técnica](docs/ARQUITETURA.md)
- [Interface e acessibilidade](docs/INTERFACE.md)
- [Jornada da contratação (7 etapas)](docs/JORNADA.md)
- [Segurança da informação](docs/SEGURANCA.md)
- [Proteção de dados pessoais (LGPD)](docs/LGPD.md)
- [Especificação das regras de domínio](packages/dominio/ESPECIFICACAO.md)
- Caderno de regras (RF/RN/RIA/RNF): página `/regras` da própria plataforma.

## Avisos

- Os dados da demonstração são fictícios. Não há nenhum dado real de órgão, servidor ou fornecedor.
- Documentos gerados (DFD, ETP, TR, edital, minuta) são rascunhos que exigem revisão humana. A plataforma nunca decide sanção, habilitação ou fraude.
- A tabela de limites de dispensa (art. 75) vai até o Decreto 12.343/2024. Inclua o decreto de atualização vigente ao implantar (`packages/dominio/src/lei14133/limites.ts`).
- A integração real com o SEI e a assinatura ICP-Brasil dependem da API do SEI e dos certificados do órgão. A plataforma traz o fluxo simulado e os pontos de integração.
