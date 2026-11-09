# Frente Y — Costura transversal

Entrega da frente Y: amarração transversal dos módulos da plataforma Ágora (Lei 14.133/2021). Integra os avisos ao cidadão na gestão compartilhada à central de notificações, estende a proteção de sigilo da LAI às telas e buscas internas de processos e contratos, formaliza o modo de disputa e a tabela de qualificação técnica (art. 67) no edital, consolida o relatório unificado de acessos LGPD e garante acessibilidade e conformidade digital em todas as telas e fluxos.

Migração associada: `apps/api/migracoes/033_costura_transversal.sql`.

## 1. O que foi feito

### a) Avisos ao cidadão na gestão compartilhada
- **Disparo automático pela central de notificações:** Tanto a decisão da moderação (aprovação com publicação ou recusa com justificativa) quanto o registro de resposta à manifestação (emitida pela Administração ou pelo preposto do contratado) geram e enviam automaticamente avisos por e-mail ao cidadão autor (`notificarCidadaoManifestacao`).
- **Versão tarjada no e-mail (LGPD):** O e-mail encaminhado ao cidadão contém a versão pública tarjada da resposta (`resposta.textoPublico`), nunca o texto interno em claro (`resposta.texto`), assegurando que dados de terceiros ou termos internos protegidos não sejam vazados na comunicação externa.
- **Endereço mascarado na central:** No detalhe da notificação exibido na central interna (`/api/v1/notificacoes/:id`), o e-mail do cidadão aparece mascarado (só a primeira letra e o domínio ficam visíveis), preservando a privacidade do titular perante os operadores do sistema.
- **Base legal e natureza obrigatória:** O envio registra na trilha e no registro de envios o fundamento legal da Lei 13.709/2018 (LGPD) e do art. 174, § 3º, VI, da Lei 14.133/2021. No domínio (`notificacoes.ts`), o tipo `manifestacao` com papel `cidadao` é classificado como aviso obrigatório (`avisoObrigatorio`), que não pode ser desativado nas preferências de notificação.

### b) Sigilo nas telas internas (LAI e segurança pública)
- **Rótulo nas listas internas:** Nas listas internas de processos (jornada) e de contratos (`/contratos` e listas aninhadas, como as de atas e fornecedores), usuários que não possuem credencial ativa e válida no respectivo processo visualizam `"Informação classificada (grau)"` (ex.: `"Informação classificada (secreta)"`), gerado por `rotuloInformacaoClassificada`, no lugar do título do processo ou do objeto do contrato.
- **Busca textual cega:** A busca textual por termos (`busca=termo`) é cega ao texto real para quem não possui credencial. Pesquisar termos presentes no título ou objeto real do processo ou contrato classificado não retorna o registro e não altera a contagem total de itens. A busca pelo número formal continua funcionando (número SEI, no caso do processo; número do contrato, no caso do contrato) e retorna o registro com o rótulo protegido.
- **Ponto de checagem e bloqueio 403 em contratos sigilosos:** O detalhe do contrato sigiloso (`GET /api/v1/contratos/:id`) e seus sub-recursos (como itens do contrato `/itens`) contam com hook `preHandler` em `apps/api/src/modulos/sigilo/rotas.ts`. Usuários sem credencial ativa válida no processo de origem recebem resposta HTTP 403 (`SEM_PERMISSAO`). A tentativa negada é registrada em `sigilo_acessos` e na trilha de auditoria (`sigilo.acesso_negado`).
- **Acesso dos órgãos de controle:** Servidores com perfil Auditor (`auditor`) ou Controle interno (`controle_interno`) possuem a prerrogativa legal `sigilo:controle` (Lei 14.133/2021, art. 24, I, e art. 169, § 2º; LAI, art. 25). Eles visualizam os títulos e objetos reais nas listas e acessam o detalhe dos contratos sem restrição. Cada acesso é registrado com `permitido = true`, `base = 'controle'`, `alvo = 'contrato'` ou `'processo'`.

### c) Edital com modo de disputa e tabela do art. 67
- **Modo de disputa no TR e no edital:** O parâmetro `modoDisputa` (`aberto`, `fechado`, `aberto_fechado` ou `fechado_aberto`) dos parâmetros do edital (`parametros-edital.ts`) é inserido de forma padronizada no preâmbulo do edital e na seção de seleção do fornecedor do Termo de Referência (TR), conforme os arts. 33 e 56 da Lei 14.133/2021.
- **Amarração de versão:** O modo de disputa integra o hash determinístico SHA-256 dos parâmetros do edital (`hashParametrosDocumento`). Se for modificado posteriormente, o documento gerado é identificado como desatualizado (`geradoComParametrosAnteriores`), exigindo nova geração e aprovação antes do avanço para a publicação (etapa 5).
- **Tabela de qualificação técnica (art. 67, § 2º):** Na seção 6.4 (Habilitação técnica) do edital, quando existem parcelas de maior relevância cadastradas no processo (`qualificacaoTecnica`), o sistema gera automaticamente a tabela estruturada contendo:
  - Parcela de maior relevância;
  - Unidade;
  - Quantidade no objeto;
  - Valor estimado;
  - Quantitativo mínimo exigido (art. 67, § 2º).
  As exigências de quantitativos mínimos permanecem limitadas ao teto legal de até 50% das parcelas do objeto licitado.

### d) Relatório LGPD com três origens consolidadas
- **Visão consolidada:** O endpoint `GET /api/v1/lgpd/acessos` (tela `/auditoria/lgpd`, restrito à permissão `lgpd:relatorio`, que têm os perfis Administrador e Auditor) unifica em consulta única (`UNIAO_ACESSOS`) três origens de registros de acesso:
  1. `dado_pessoal` (tabela `lgpd_acessos`): campos mascarados que foram revelados por usuários autorizados (CPF, e-mail, telefone de fornecedores, usuários e credores de empenho), registrando usuário, momento e finalidade;
  2. `documento` (tabela `processos_arquivos_acessos`): visualizações e downloads de arquivos e documentos do processo marcados com `contem_dado_pessoal = true`, registrando usuário e finalidade;
  3. `sigilo` (tabela `sigilo_acessos`): consultas, downloads do cofre e emissão de PDFs marcados de informações sigilosas e orçamentos protegidos, registrando permissões ou negações, a base legal aplicada (`ROTULO_BASE`) e o motivo/finalidade.
- **Proteção do titular sem exposição de CPF:** O relatório não exibe nem trafega CPF em texto claro, preservando os princípios de segurança e minimização da LGPD (art. 6º, III, e art. 37).
- **Filtros e rastreabilidade:** Suporta paginação e filtros opcionais por `usuario` e por `origem` (`dado_pessoal`, `documento`, `sigilo`), ordenados cronologicamente do mais recente para o mais antigo.

### e) Navegação e testes de acessibilidade
- **Acessibilidade automatizada (WCAG 2.1 AA):** As novas telas e estados integrados pela costura transversal foram cobertos pelas rotinas de teste automatizado de ponta a ponta (`e2e/testes/costura-transversal.spec.ts` e `e2e/testes/navegacao.spec.ts`), utilizando a biblioteca Axe (`verificarAcessibilidade`).
- **Estados verificados:** Os testes cobrem a navegação com lista contendo processo classificado (`/jornada com processo classificado`) e a tela de relatório de auditoria com registros de acesso a documentos (`/auditoria/lgpd com acessos de documento`), assegurando ausência de violações graves ou críticas.
- **Varredura por perfil:** O arquivo `navegacao.spec.ts` realiza a verificação de todas as rotas e telas mapeadas por perfil (`TELAS_POR_PERFIL` e `ROTAS`), com a verificação automática de acessibilidade (axe), sem violações graves ou críticas.

## 2. Arquivos principais

| Módulo / Camada | Arquivo | Finalidade |
|---|---|---|
| **Banco de dados** | `apps/api/migracoes/033_costura_transversal.sql` | Migração DDL que atualiza as constraints CHECK de notificações. |
| **Domínio** | `packages/dominio/src/notificacoes.ts` | Definição de `TipoNotificacao`, `PapelDestinatario`, obrigatoriedade de aviso (`avisoObrigatorio`) e fundamentos legais. |
| **Sigilo / Acesso** | `apps/api/src/modulos/sigilo/acesso.ts` | Funções `processosSemAcesso`, `contratosSemAcesso`, `mascararContratosSigilosos`, `rotuloInformacaoClassificada`, catálogo `ROTULO_BASE` e registro em `sigilo_acessos`. |
| **Sigilo / Rotas** | `apps/api/src/modulos/sigilo/rotas.ts` | Hooks `preHandler` para bloqueio 403 e auditoria em contratos e processos sigilosos; hook `preSerialization` para documento classificado no detalhe. |
| **LGPD / Rotas** | `apps/api/src/modulos/lgpd/rotas.ts` | Consulta unificada `UNIAO_ACESSOS` no endpoint `GET /lgpd/acessos`, revelação em `POST /lgpd/revelar` e supressão de CPF. |
| **Sociedade / Rotas** | `apps/api/src/modulos/sociedade/rotas.ts` | Disparo de avisos ao cidadão via `notificarCidadaoManifestacao` em moderação e respostas, garantindo uso do `textoPublico` tarjado. |
| **Jornada / Parâmetros** | `apps/api/src/modulos/jornada/parametros-edital.ts` | Inclusão de `modoDisputa` no hash determinístico dos parâmetros do edital (`hashParametrosDocumento`). |
| **Jornada / Documentos** | `apps/api/src/modulos/jornada/documentos.ts` | Modelos de geração do edital e TR com `modoDisputa` e tabela analítica de qualificação técnica do art. 67, § 2º, na seção de habilitação. |
| **Web / UI** | `apps/web/src/paginas/auditoria/AcessosLgpd.tsx` | Interface da tela de auditoria LGPD exibindo registros paginados das três origens com resumo e identificadores abreviados. |
| **Testes de integração** | `apps/api/test/costura-transversal.test.ts` | Suíte de integração cobrindo moderação/respostas com aviso, listas com sigilo, busca cega, detalhe 403, relatório LGPD e geração de edital. |
| **Testes e2e** | `e2e/testes/costura-transversal.spec.ts` | Testes ponta a ponta simulando visualização de sigilo, busca cega, relatório LGPD e acessibilidade WCAG 2.1 AA. |
| **Testes de navegação** | `e2e/testes/navegacao.spec.ts` | Varredura de telas da aplicação por perfil com conferência automatizada de acessibilidade. |

## 3. Banco de dados

A migração `apps/api/migracoes/033_costura_transversal.sql` ajusta as restrições (`CHECK`) do subsistema de notificações:

1. **`notificacoes_tipo_check`:**
   - Atualizada na tabela `notificacoes`:
   - `CHECK (tipo IN ('vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia', 'manifestacao'))`.
   - Adiciona o tipo `'manifestacao'` para permitir o registro de avisos originados da gestão compartilhada.
2. **`notificacoes_envios_papel_check`:**
   - Atualizada na tabela `notificacoes_envios`:
   - `CHECK (papel IN ('gestor', 'fiscal', 'contratada', 'responsavel', 'emitente_garantia', 'cidadao'))`.
   - Inclui o papel `'cidadao'`, preservando expressamente o papel `'emitente_garantia'` criado na migração anterior (`032_costura_execucao.sql`, da costura X).
3. **`notificacoes_preferencias_tipo_check`:**
   - Atualizada na tabela `notificacoes_preferencias`:
   - `CHECK (tipo IN ('vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia', 'manifestacao'))`.
   - Garante consistência de tipos na configuração de preferências de notificações.

## 4. Limitações

- **Canal de notificação ao cidadão:** Os avisos ao cidadão na gestão compartilhada são enviados exclusivamente pelo canal `email`. Os canais `sei` e `govbr` permanecem dedicados a notificações de servidores e comunicações administrativas.
- **Endereço técnico quando sem e-mail:** Cidadãos autenticados via Login gov.br sem e-mail fornecido recebem um endereço técnico interno não roteável. Nesses casos, o envio externo não é realizado, devendo o cidadão acompanhar a manifestação na tela "Minhas manifestações".
- **Alcance da busca cega:** A busca cega impede a localização por termos inseridos no título ou objeto classificado. A busca pelo número formal (número SEI do processo ou número do contrato) continua localizando o registro, exibindo o resultado com o rótulo mascarado `"Informação classificada (grau)"`.
- **Independência das tabelas do relatório LGPD:** A visualização unificada em `/lgpd/acessos` baseia-se em `UNION ALL` entre as tabelas `lgpd_acessos`, `processos_arquivos_acessos` e `sigilo_acessos`. Cada tabela preserva seu próprio ciclo de vida, transações e índices no banco de dados.
- **Preenchimento prévio das parcelas do art. 67:** A tabela de qualificação técnica só é gerada no edital se as parcelas de maior relevância tiverem sido cadastradas na instrução preparatória (`qualificacaoTecnica`). Sem cadastro prévio, o edital exibe o texto padrão com aviso de pendência para preenchimento.

## 5. Seção pronta para o manual do usuário

Esta seção está pronta para inclusão direta no Manual do Usuário da plataforma Ágora.

---

### Gestão Compartilhada, Sigilo Processual, Edital e Auditoria LGPD

#### Perfis e Responsabilidades

| Perfil | O que faz neste fluxo |
|---|---|
| **Cidadão (`cidadao`)** | Envia manifestações na página pública de contratos vigentes, acompanha a moderação e respostas em "Minhas manifestações" e recebe avisos por e-mail com a versão pública tarjada da resposta. Sem acesso interno. |
| **Gestor de contratos (`gestor_contratos`)** | Modera manifestações (publicar ou recusar com justificativa), emite respostas da Administração ou registra respostas do preposto do contratado e visualiza envios na central de notificações. |
| **Fiscal de contrato (`fiscal`)** | Responde às manifestações sobre os contratos que fiscaliza; a resposta sai identificada como "Fiscal do contrato". |
| **Agente de contratação (`agente_contratacao`) e Planejamento (`planejamento`)** | Definem o modo de disputa (art. 56) e as parcelas de qualificação técnica (art. 67, § 2º) nos parâmetros do edital, gerando os documentos vinculados e aprovados. |
| **Assessoria jurídica (`juridico`)** | Analisa a conformidade jurídica dos editais e minutas contratuais; consulta listas de processos e contratos com proteção por rótulo mascarado caso não possua credencial de sigilo. |
| **Auditor (`auditor`) e Controle interno (`controle_interno`)** | Acessam processos e contratos sigilosos (`sigilo:controle`), e cada acesso fica registrado. O Auditor também consulta o relatório unificado de acessos LGPD (`/auditoria/lgpd`). |
| **Administrador (`administrador`)** | Concede e revoga credenciais de sigilo em processos; gerencia permissões e configurações globais de auditoria. |

#### Instruções Operacionais

##### 1. Avisos ao Cidadão na Gestão Compartilhada
- Ao enviar uma manifestação sobre a execução de um contrato, o cidadão receberá notificações automáticas em seu e-mail sempre que a manifestação for avaliada pela moderação (aprovada ou recusada com motivo) ou quando uma resposta oficial for registrada.
- O e-mail recebido conterá apenas o texto público tarjado, resguardando dados pessoais e informações sensíveis.
- Os servidores autorizados que consultam o histórico de notificações verão o endereço de e-mail do cidadão mascarado, protegendo a identidade do titular.

##### 2. Sigilo nas Listagens e Detalhe de Contratos
- Servidores sem credencial ativa em processo classificado pela Lei de Acesso à Informação verão o texto `"Informação classificada (grau)"` no lugar do título ou objeto nas listas de processos e contratos.
- A ferramenta de busca textual não localiza processos ou contratos sigilosos pelos termos do seu objeto real se o usuário não possuir credencial. A busca pelo número SEI (processo) ou pelo número do contrato localiza o registro, porém com o rótulo mascarado.
- Caso um usuário sem credencial tente acessar o detalhe ou os itens de um contrato sigiloso, o sistema apresentará aviso de acesso negado (código 403) e registrará a tentativa na trilha de auditoria.
- Os perfis de controle (Auditor e Controle interno) possuem acesso irrestrito aos contratos e processos sigilosos; cada consulta realizada é gravada na trilha de auditoria para fins de transparência interna.

##### 3. Configuração do Modo de Disputa e Qualificação Técnica no Edital
- Ao elaborar o edital na fase preparatória, selecione o modo de disputa pretendido (Aberto, Fechado, Aberto e Fechado ou Fechado e Aberto, nos termos do art. 56 da Lei 14.133/2021). A indicação constará automaticamente no preâmbulo do edital e no Termo de Referência.
- Se houver necessidade de comprovação de qualificação técnica para parcelas de maior relevância técnica e valor significativo (art. 67, § 2º), preencha as parcelas na etapa preparatória. O edital incluirá automaticamente a tabela com as descrições, quantidades do objeto, valores estimados e o quantitativo mínimo exigido (limitado a 50%).
- Qualquer alteração posterior no modo de disputa exigirá a geração de nova versão do edital antes do prosseguimento do processo.

##### 4. Consulta ao Relatório de Acessos a Dados Pessoais (LGPD)
- O relatório está disponível no menu **Auditoria › Acessos a dados pessoais** (`/auditoria/lgpd`) para os perfis Administrador e Auditor.
- A tela consolida três origens de dados:
  1. *Dado pessoal revelado:* operações em que um dado mascarado (CPF, e-mail, telefone) foi revelado por um servidor mediante justificativa.
  2. *Documento com dado pessoal:* consultas e downloads de documentos do processo classificados com presença de dados de titulares.
  3. *Informação sigilosa:* acessos e tentativas de acesso a informações e contratos classificados pela LAI ou orçamentos sob sigilo, indicando se foram permitidos ou negados e a respectiva base legal.
- Em conformidade com o art. 37 da LGPD, o relatório não exibe CPFs em texto claro, com paginação cronológica; os filtros por usuário e por origem estão na API.
