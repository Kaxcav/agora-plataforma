# Análise de arquitetura — portal ComprasSUSP (comprassusp.app)

Data da análise: 8 de novembro de 2026.
Base: 175 módulos JavaScript e 1 CSS públicos copiados em `reference/assets/`, cabeçalhos HTTP e HTML da página inicial, inventário de telas (`INVENTARIO.md`) e conversa de requisitos do demandante (`reference/gemini-compartilhado.txt`). Esse material de levantamento fica fora deste repositório, porque contém dados operacionais reais.
Ferramentas: Kaxcav Vortex (kvx) para os artefatos indexáveis; busca textual nos bundles minificados, que o kvx não indexa.

Legenda de evidência:
- **[Verificado]**: visto diretamente no código público ou nos cabeçalhos HTTP.
- **[Inferido]**: conclusão provável a partir do código, sem acesso ao servidor.
- **[Não verificável]**: depende de configuração interna que não pode ser auditada de fora sem autorização.

Nenhum teste de intrusão foi feito. Nada foi enviado ao banco do sistema original.

---

## 1. Como o sistema original é montado

| Camada | Tecnologia observada | Evidência |
|---|---|---|
| Front-end | SPA React + React Router + TanStack Query, empacotada com Vite/Rolldown | nomes de chunks, `__vite__mapDeps`, `rolldown-runtime` |
| Hospedagem do front-end | Vercel | cabeçalho `Server: Vercel`, `X-Vercel-Id: fra1::…` |
| Banco, autenticação e tempo real | Supabase hospedado (projeto `bouutpmxexvwppcmmhdi.supabase.co`) | URL e chave publicável no chunk `QueryClientProvider` |
| Acesso a dados | Navegador chama o PostgREST/RPC do Supabase diretamente | 138 relações em `.from()`, 123 funções em `.rpc()` |
| Funções de servidor | 2 Edge Functions do Supabase (`invite-user`, `manage-user`) | `functions.invoke(...)` |
| Integrações governamentais | Reescritas de caminho no host: `/api-arp`, `/api-pncp`, `/api-contratos-gov` | `fetch('/api-contratos-gov/api/contrato/{id}/empenhos')` etc. |
| Serviços de terceiros chamados pelo navegador | BrasilAPI (CNPJ, CEP, feriados), ViaCEP, Google Fonts, CDN do gov.br | URLs nos bundles e no `index.html` |

---

## 2. Problemas encontrados

### A. Soberania, hospedagem e conformidade

**A1. Dados e aplicação em plataformas estrangeiras sem caminho de implantação no órgão.** [Verificado/Inferido]
O front-end está no Vercel. A resposta observada saiu de um nó em Frankfurt (`fra1`); o nó varia conforme a rede de quem acessa. O banco, a autenticação e o tempo real estão em Supabase hospedado, cuja região não pode ser confirmada de fora. Não existe artefato para implantar em nuvem governamental (Dockerfile, IaC, manual).
*Impacto:* exige avaliação formal de transferência internacional de dados pessoais (LGPD, arts. 33 a 36) e dos requisitos de segurança para nuvem da administração federal (IN GSI/PR nº 5/2021). O ETP do próprio demandante pede "soberania digital", hospedagem na nuvem do MJSP e cessão do código (Lei 14.133, art. 93).
*Nota:* hospedar no Vercel não é, por si só, crime. O problema é de conformidade e governança, e a decisão cabe à área de segurança e à CONJUR do órgão.

**A2. Dependência de fornecedor (lock-in) profunda.** [Verificado]
A regra de negócio está espalhada por 138 tabelas/visões, 123 funções RPC, Supabase Auth, Supabase Realtime, Edge Functions e reescritas do Vercel. Migrar exige reescrever autenticação, camada de integração e boa parte das chamadas do cliente.

**A3. O navegador envia dados a terceiros.** [Verificado]
- Google Fonts: o endereço IP de cada servidor público vai para o Google a cada acesso.
- BrasilAPI: consultas de CNPJ e CEP feitas do navegador para uma API comunitária, sem contrato nem SLA.
- Links `wa.me` montados com telefones de beneficiários de emendas.

### B. Segurança

**B1. O banco de dados fica exposto diretamente ao navegador.** [Verificado]
Toda leitura e escrita sai do navegador para o PostgREST/RPC com a chave publicável. A segurança depende só de políticas RLS e de funções `SECURITY DEFINER` que não podem ser auditadas de fora [Não verificável]. Qualquer política faltante em uma das 138 relações vira vazamento. Há 95 chamadas `select('*')`, que trazem colunas que a tela não usa.

**B2. O perfil do usuário é decidido no cliente.** [Verificado]
O `AuthContext` lê `user_roles` no navegador e escolhe o papel (`admin` tem precedência). As telas "Acesso não autorizado" são decididas no cliente. Se o servidor não repetir cada checagem, o controle é contornável [Não verificável].

**B3. Dados financeiros "oficiais" são montados no navegador.** [Verificado]
O `empenhoSyncService` busca empenhos no Contratos.gov.br via proxy, monta o registro no cliente (credor, CNPJ/CPF, valores, `fonte_origem: 'CONTRATOSNET'`) e grava com `save_empenho_soberano_atomic`. Um usuário autenticado, ou uma extensão maliciosa no navegador, pode gravar valores falsos como se fossem do SIAFI, a menos que a função no banco busque tudo de novo [Não verificável].
A sincronização depende de alguém clicar em "Atualizar empenhos". Falhas parciais deixam o estado inconsistente; o próprio código registra "Empenho gravado, mas não vinculado ao contrato".

**B4. Faltam os cabeçalhos de segurança HTTP.** [Verificado]
Ausentes: `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors` (sem proteção contra clickjacking), `X-Content-Type-Options`, `Referrer-Policy` e `Permissions-Policy`. Presente e permissivo: `Access-Control-Allow-Origin: *`.

**B5. Autenticação fraca para um sistema de governo.** [Verificado]
O login é e-mail e senha (`signInWithPassword`), e o token de sessão fica no `localStorage` (padrão do supabase-js), onde qualquer XSS o rouba. Não há Login Único gov.br nem certificado ICP-Brasil, e não há evidência de MFA.

**B6. Proxies para APIs de governo.** [Inferido]
As reescritas `/api-arp`, `/api-pncp` e `/api-contratos-gov` repassam requisições a APIs públicas. Se não exigirem sessão, qualquer pessoa pode usar o domínio como proxy, e o abuso é atribuído ao domínio.

**B7. Sem trilha de auditoria verificável.** [Inferido]
Existe aba "Histórico", mas nada indica um registro imutável e encadeado de quem alterou o quê. A rastreabilidade é exigida pela Lei 14.133 (arts. 169 a 171) e pela LGPD (art. 37).

### C. Dados pessoais (LGPD)

**C1. Dados pessoais sem minimização visível.** [Verificado]
O cliente lida com CPF de credores pessoa física (`credor_cnpj_cpf`), e-mails, telefones e WhatsApp de beneficiários (somando, mais de 380 ocorrências no código). A interface não mostra máscara, aviso de privacidade nem canal do encarregado.

**C2. Cache local de dados de negócio.** [Verificado]
Metadados de itens de ata ficam no `localStorage` (`saldoarp-item-meta-*`) e persistem em computadores compartilhados.

### D. Engenharia de software

**D1. A regra de negócio está dividida em três lugares.** [Verificado]
- Serviços no navegador: `temporalEngineService`, `paymentFollowUpService`, `empenhoSyncService`, `prazos`.
- Cerca de 55 visões SQL (`v_*`).
- 123 funções RPC.

Isso dificulta testar, versionar e auditar. Limites legais como os do art. 75 ficam numa tabela editável por RPC (`limites_lei_14133_art75`), sem versionamento por decreto.

**D2. Cliente pesado.** [Verificado]
São 2,8 MB de JavaScript em 175 chunks. O chunk principal tem 514 KB, as rotas de detalhe têm de 150 a 210 KB e cerca de 20 módulos são pré-carregados na primeira tela. O ExcelJS roda no navegador. Isso pesa em máquinas modestas e em redes de órgãos.

**D3. Divergência entre esquema e cliente tratada em tempo de execução.** [Verificado]
O código detecta função RPC inexistente comparando a mensagem de erro com a expressão regular `Could not find the function`. Ou seja: cliente e banco saem de sincronia em produção.

**D4. Modelagem inconsistente.** [Verificado]
Nomes misturam inglês e português (`contract_payment_cycles` e `contratos_oficiais`; `ata_tasks` e `prazos_emendas`), há tabelas-cópia (`itens_ata_unidades_copia`) e o sufixo `_atomic` aparece em dezenas de funções. É sinal de crescimento sem governança de dados.

**D5. Diagnóstico solto em produção.** [Verificado]
Há 61 `console.warn` e 26 `console.error` no bundle, e nenhuma telemetria própria do órgão.

**D6. Defeitos de experiência observados.** [Verificado no inventário]
- Zeros aparecem como dado real durante "Atualizando...".
- O CSS declara `Inter` antes de `Rawline`.
- Algumas telas mudam de layout enquanto carregam.
- Há problema de acentuação em nome de fornecedor.
- Ações de escrita ficam misturadas com a navegação.

### E. Escopo funcional

**E1. Cobre só a execução contratual de uma secretaria.** [Verificado]
O portal trata atas, contratos, empenhos e pagamentos da SENASP. A visão do demandante pede o ciclo completo da Lei 14.133:
1. Demanda e PCA.
2. Integração com o SEI.
3. ETP, riscos e preços.
4. TR e edital.
5. Controle jurídico e publicação.
6. Seleção do fornecedor.
7. Contratos, auditoria e score de fornecedores.

---

## 3. Como a Ágora resolve cada ponto

| Problema | Resposta da Ágora |
|---|---|
| A1, A2 | Pilha aberta e auto-hospedável: Node.js + PostgreSQL + front-end estático servidos pelo mesmo processo. Imagem de contêiner, `docker-compose` e manifestos Kubernetes para a nuvem do órgão. Código cedido (art. 93). |
| A3 | Nenhuma chamada do navegador a terceiros. Fontes Rawline/Raleway e ícones empacotados. CNPJ e CEP consultados pelo servidor, com cache e registro. |
| B1, B2 | O navegador só fala com a API da Ágora. RBAC e escopo por UASG decididos no servidor, em toda rota. Consultas com colunas explícitas. |
| B3, B6 | Integrações rodam em jobs no servidor, com proveniência (fonte, horário, hash do conteúdo) e idempotência. O usuário não consegue injetar dados "oficiais". Não há proxy aberto. |
| B4 | CSP estrita sem `unsafe-inline` em scripts, `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy` e `Permissions-Policy`. CORS fechado. |
| B5 | Sessão em cookie `HttpOnly`/`SameSite=Strict`, proteção CSRF, senhas com scrypt, limite de tentativas. Adaptador OIDC para o Login Único gov.br. |
| B7 | Trilha de auditoria append-only encadeada por SHA-256, com verificação de integridade pela interface. |
| C1, C2 | CPF, e-mail e telefone mascarados por padrão. Revelar o dado exige permissão e gera registro de acesso. Nenhum dado de negócio no `localStorage`. Página de privacidade e de contato do encarregado. |
| D1 | Regras da Lei 14.133 num pacote de domínio puro (`@agora/dominio`), testado, com limites legais versionados por norma e vigência. |
| D2 | Bundle enxuto, sem biblioteca de UI externa. Exportações geradas no servidor. |
| D3, D4 | Esquema único em português, com migrações versionadas, tipos compartilhados entre API e interface (`@agora/contratos`) e validação de entrada e saída. |
| D5 | Logs estruturados em JSON no servidor, `/saude/vivo` e `/saude/pronto`, prontos para a observabilidade do órgão. |
| D6 | Estados distintos de carregamento, vazio, erro, sem permissão e dado parcial. Esqueleto sem números falsos. UTF-8 testado. Ações de escrita separadas e com confirmação. |
| E1 | Módulo "Jornada da Contratação" com as 7 etapas, as regras RN/RIA e o Modo Especificação Técnica. |
