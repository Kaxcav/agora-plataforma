# Frente O — planejamento: PCA, catálogo e registro de preços compartilhado (F10, F19 e F5)

Regras novas: **RF-31** (telas do planejamento e conferência do DFD com o PCA), **RIA-13** (sugestão do código do catálogo) e **RN-38** (IRP aberta por pelo menos 8 dias úteis). Migração: `024_planejamento_pca_catalogo_irp.sql`.

## 1. O que foi feito

### F10 — plano de contratações anual (RF-31)

**Tela "Plano de contratações"** (`/planejamento/pca`, menu **Planejamento**). Lista os planos de cada UASG e exercício no escopo do usuário, com situação, demandas, itens, valor e número no PNCP. Ao abrir um plano:

- **Demandas das unidades** (Decreto 10.947/2022, art. 8º): unidade requisitante, descrição, código CATMAT/CATSER, unidade de fornecimento, quantidade, valor unitário estimado, data desejada (dentro do exercício), grau de prioridade (baixo, médio, alto) e categoria do item (tabela 5.16 do PNCP). O servidor valida cada demanda (`validarDemandaPca`).
- **Consolidação** pelo setor de contratações (art. 11): `consolidarPca` agrega as demandas de mesmo código do catálogo, unidade de fornecimento e categoria, soma quantidades e valores, fica com a data desejada mais cedo e a prioridade mais alta e numera os itens pelo calendário de contratação (prioridade, depois data). Itens sem código ficam como itens próprios.
- **Aprovação pela autoridade competente** (art. 12), com `pca:aprovar`. **Quem consolidou não aprova** (segregação de funções, art. 7º, § 1º). A autoridade pode **devolver para ajustes** (art. 12, § 1º), com o motivo; a consolidação é desfeita.
- **Publicação no PNCP pela fila da frente B** (art. 12, § 2º, e art. 14): a aprovação enfileira a tarefa `pncp.pca` (chave `pncp:pca:<plano>`). O trabalhador chama `POST /v1/orgaos/{cnpj}/pca` (Manual de Integração PNCP 2.2.7, seção 6.7.1; conferido também no Swagger `pncp.gov.br/api/pncp/v3/api-docs`, operação `incluirPlano`) com `codigoUnidade`, `anoPca` e `itensPlano` montados por `itemPlanoContratacoesPncp` (categoria, catálogo 1 = CNBS ou 2 = outros, classe do material ou grupo do serviço, valores em reais). O número de controle do PCA (`CNPJ-0-SEQUENCIAL/ANO`, seção 4.3) é lido do `location`; `interpretarLocalizacaoPncp` e `numeroControlePncp` passaram a reconhecer o registro `pca`. A prova do envio (protocolo, número, hash SHA-256 do conteúdo e modo) fica gravada no plano logo depois da resposta, e a nova tentativa não reenvia. Recusa do PNCP vai para a fila de erro e volta com **Publicar no PNCP**.
- **Modo offline** (padrão): publicação simulada e determinística (protocolo `SIMULADO-…`), avisada na tela.

**Conferência do DFD com o PCA publicado** (art. 18, § 1º, II), na etapa 1 da jornada, seção **Plano de contratações anual (PCA)**:

- O DFD aponta o **item do PCA publicado** da UASG (exercício corrente ou seguinte) ou registra **"Não consta do PCA"** com a justificativa da contratação não planejada (mínimo de 30 caracteres).
- `conferirDfdComPca` decide: quando a UASG tem PCA publicado para o exercício, o DFD sem item nem justificativa **não avança da etapa 1** (bloqueio RF-31). Também bloqueia item de PCA não publicado ou de outra UASG e a marcação "Demanda prevista no PCA" que não confere com o vínculo. Valor do DFD acima do planejado no item é sinal de atenção; a demanda fora do plano gera o sinal de revisão do PCA.
- A marcação "Demanda prevista no PCA" do DFD passa a acompanhar o vínculo registrado (o servidor a ajusta).
- **Consulta do PCA publicado no PNCP pelo conector do servidor** (`apps/api/src/integracoes/pncp-pca.ts`): API pública de consulta, `GET /v1/pca/atualizacao?dataInicio&dataFim&cnpj&codigoUnidade&pagina&tamanhoPagina` (Swagger `pncp.gov.br/api/consulta/v3/api-docs`), com tempo máximo, novas tentativas e paginação. Os planos encontrados entram como planos de origem `pncp` (somente leitura), com os itens atualizados pelo número. No modo offline, os planos publicados da carga sintética e os publicados pela Ágora fazem o papel do PNCP. Cada consulta grava modo, endereço, quantidade e hash, e o evento `pca.consultar_pncp`.

### F19 — catálogo CATMAT/CATSER (RIA-13)

- **Conector do catálogo oficial** (`apps/api/src/integracoes/catalogo-compras.ts`), na API de dados abertos de compras (`AGORA_COMPRAS_DADOS_URL`):
  - materiais: `/modulo-material/4_consultarItemMaterial` por `descricaoItem` ou `codigoItem`, só itens ativos;
  - serviços: `/modulo-servico/6_consultarItemServico` por `codigoServico`. A API não filtra serviços por texto; a busca textual de serviços usa a cópia local, com aviso.
- **Cache** em `catalogo_itens`, com validade de `AGORA_CATALOGO_CACHE_HORAS` (padrão 168 h). Cada consulta que não vem do cache grava a proveniência em `catalogo_consultas` e o evento `catalogo.consultar`. Com o catálogo oficial fora do ar, a resposta vem do cache, com aviso. O modo offline responde pela cópia local sintética.
- **Sugestão do código no DFD** (`sugerirItensCatalogo`): termos sem acentos, sem palavras vazias e com plurais reduzidos (`termosCatalogo`), comparados pelo coeficiente de Dice, com bônus quando o termo principal coincide. É determinística e só considera itens ativos. A resposta traz a pontuação, os termos em comum, as fontes, as premissas e "Requer revisão humana".
- **Quem escolhe é o agente**: **Usar o código N no item M** grava o código no item do DFD salvo, confere no cache que o código existe e está ativo, e registra `processo.dfd.catalogo` com origem, pontuação e `decisao: humana`.
- **Integração com a RN-02**: com "Itens identificados no catálogo" marcado, item sem código vira sinal RN-02 ("use a sugestão ou justifique"). Código ausente da cópia local vira sinal RIA-13 para conferência. A justificativa formal ao desmarcar o catálogo continua sendo exigida pela RN-02 existente.

### F5 — IRP e registro de preços compartilhado (RN-38, com a RIA-01)

- **Sinal de registro de preços compartilhado (RIA-01)**: `consolidarDemandas` agrupa, por código do catálogo, as demandas de UASGs diferentes no exercício (DFDs de processos nas etapas 1 a 3 e itens de PCAs aprovados ou publicados). `sugerirRegistroPrecosCompartilhado` aponta, para os itens do processo, as outras unidades e quantidades. O sinal aparece na etapa 1 ao lado do alerta de fracionamento (RN-14), e a seção **Registro de preços compartilhado** oferece **Propor intenção de registro de preços**, que abre o formulário da IRP já preenchido. A decisão é do agente, e nenhum percentual de economia é estimado.
- **Tela "Intenções de registro de preços"** (`/planejamento/irp`):
  - **abertura** pelo gerenciador (`irp:gerenciar`). O servidor conta os dias úteis com o calendário do órgão (`verificarPrazoIrp`, `prazoMinimoIrp`) e **recusa período menor que 8 dias úteis** ou abertura no passado (422, detalhe `RN-38`). A tabela também guarda os dias úteis com `CHECK (dias_uteis >= 8)`;
  - **adesão** das UASGs participantes (`irp:aderir`), só com a IRP aberta e de UASG diferente da gerenciadora, no escopo do usuário; a retificação substitui a anterior;
  - **consolidação das quantidades** depois do encerramento (`consolidarQuantidadesIrp`), com a participação de cada unidade (art. 86, caput).
- Toda escrita fica na trilha: `irp.abrir`, `irp.aderir` e `irp.consolidar`.

### Telas e permissões

| Tela | Rota | Quem vê | Quem age |
|---|---|---|---|
| Plano de contratações | `/planejamento/pca` | `pca:ler` | demandas e consolidação: `pca:editar`; aprovação, devolução e reenvio: `pca:aprovar` |
| Intenções de registro de preços | `/planejamento/irp` | `pca:ler` | abrir e consolidar: `irp:gerenciar`; aderir: `irp:aderir` |
| DFD (etapa 1), seções PCA, catálogo e registro compartilhado | `/jornada/:id` | `jornada:ler` | `jornada:editar` (etapa 1) |

Permissões novas, no fim de `TODAS_PERMISSOES`:

- `pca:ler`: planejamento, gestor de contratos, agente de contratação, controle interno, auditor e administrador;
- `pca:editar`: planejamento;
- `pca:aprovar`: gestor de contratos, como autoridade competente;
- `irp:gerenciar`: planejamento e agente de contratação;
- `irp:aderir`: planejamento e gestor de contratos.

O administrador tem todas.

### Carga de demonstração (`apps/api/src/seed/planejamento.ts`, sintética e determinística)

- 41 itens sintéticos no catálogo local (35 materiais, um deles inativo, e 6 serviços).
- PCA do exercício corrente **publicado** nas UASGs 910002, 930002, 940002 e 950002.
- PCA do exercício seguinte:
  - **em elaboração** na 950001, com 7 demandas que viram 5 itens: papel e mesas aparecem repetidos para mostrar a consolidação;
  - em elaboração também na 930001;
  - **consolidado, aguardando aprovação** na 920001.
- O processo dos coletes (FNSP) aponta o item do PCA publicado.
- Luvas táticas previstas nos PCAs de 930002 e 940002: o processo de EPIs da SENASP (etapa 1) recebe o sinal RIA-01.
- Duas IRPs:
  - uma encerrada, com duas adesões, pronta para consolidar;
  - uma aberta para adesões, com mais 8 dias úteis pela frente.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde está |
|---|---|---|
| 40, 154 | Painel do PCA no módulo de planejamento | Tela **Plano de contratações** |
| 44, 161 | "Vinculação automática ao Catálogo Eletrônico de Padronização" | Sugestão do código (RIA-13) com escolha do agente; RN-02 para a não utilização |
| 47, 167 | IA classificadora: sugestão de códigos CATMAT/CATSER e alerta de fracionamento | RIA-13 (determinística) e RIA-01/RN-14 com o registro compartilhado |
| 302–308 | Demonstração da previsão no PCA no ETP, com o ID do item no PCA/PNCP | Vínculo do DFD com o identificador do item e o número de controle do PCA no PNCP |
| 392, 652 | Consolidação do PCA e das demandas no módulo 1 | Consolidação (`consolidarPca`) |
| 1410 (RF-01.1) | Consolidador do PCA a partir dos DFDs das unidades, com publicação direta no PNCP (art. 12, § 1º) | Demandas, consolidação, aprovação e publicação pela fila |
| 1445 (RIA-01.2) | Sugestão do item padronizado, com justificativa se não for adotado, e alerta de somatório | RIA-13 + RN-02 + RN-14 |
| 1775, 1919 | DFD conectado ao CATMAT/CATSER (art. 19, II) e ao PCA (art. 12, VII e § 1º) | Seções **PCA** e **Código do catálogo** na etapa 1 |
| 1779, 1927 | RN-02: sem catálogo, justificativa por escrito | RN-02 existente, com o sinal de item sem código |
| 1780, 1929 | RIA-01: agrupar demandas semelhantes entre PF, PRF, SENASP e SENAPPEN para economia de escala | Sinal de registro de preços compartilhado + IRP (RN-38) |

## 3. Equivalentes lícitos e decisões

- **"Vinculação automática" e "IA classificadora" → sugestão com escolha humana.** A IA só sinaliza (regra 5). A sugestão é determinística, por semelhança de texto, sem modelo de linguagem, e mostra fontes, premissas e "requer revisão humana". O código só entra no DFD por ação do agente, registrada na trilha.
- **"Agrupa demandas entre órgãos" → sinal + IRP.** A Ágora não junta processos sozinha. Ela aponta as demandas semelhantes e oferece a intenção de registro de preços, que é o procedimento legal para compras compartilhadas (art. 86): a IRP fica aberta por 8 dias úteis e conta com a adesão e as quantidades informadas pelas unidades. Não há percentual de economia inventado.
- **"Publicação direta no PNCP" → pela fila de integrações, depois da aprovação.** O Decreto 10.947/2022, art. 12, exige a aprovação da autoridade competente. O navegador nunca fala com o PNCP: o envio sai do servidor, pela fila, com novas tentativas e fila de erro.
- **Conferência só quando o PCA foi elaborado.** O art. 18, § 1º, II, pede a demonstração "sempre que elaborado". Por isso o bloqueio vale quando a UASG tem PCA publicado para o exercício; nas demais, o DFD recebe um sinal informativo. Isso também mantém os fluxos já existentes das outras frentes.
- **Item sem código com o catálogo marcado → sinal, não bloqueio.** O art. 19, § 2º, exige justificativa quando o catálogo não é usado, e isso continua bloqueado pela RN-02 ao desmarcar o catálogo. O item que ainda não tem código recebe o sinal com a sugestão, para não travar fluxos em andamento.
- **Segregação na aprovação do PCA.** Quem consolidou não aprova (art. 7º, § 1º), como na homologação da seleção.
- **IRP entre as UASGs do órgão.** As unidades do MJSP aderem pela Ágora. A divulgação no SRP digital (Compras.gov.br) e a adesão de órgãos de fora dependem de integração não disponível; ver limitações.

## 4. Regras novas (catálogo)

| Código | Título | Implementação |
|---|---|---|
| RN-38 | IRP aberta por pelo menos 8 dias úteis (art. 86; Decreto 11.462/2023, art. 9º) | `verificarPrazoIrp`, `prazoMinimoIrp`, `situacaoIrp`, `consolidarQuantidadesIrp`; telas `planejamento.irp` e `jornada.dfd` |
| RF-31 | Plano de contratações anual, conferência do DFD e intenções de registro de preços | `consolidarPca`, `validarDemandaPca`, `validarTransicaoPca`, `itemPlanoContratacoesPncp`, `conferirDfdComPca`, `identificadorItemPca`; telas `planejamento.pca`, `planejamento.irp` e `jornada.dfd`; etapa 1 |
| RIA-13 | Sugestão do código do catálogo CATMAT/CATSER | `sugerirItensCatalogo`, `termosCatalogo`; tela `jornada.dfd`; etapa 1 |

A RIA-01 passou a citar também `consolidarDemandas` e `sugerirRegistroPrecosCompartilhado`.

Domínio novo, em `packages/dominio/src/lei14133/planejamento.ts`, com testes em `packages/dominio/test/planejamento.test.ts`:

- `CATEGORIAS_ITEM_PCA` e `DIAS_UTEIS_MINIMOS_IRP`;
- as funções citadas na tabela acima.

## 5. Rotas novas

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /pca?ano&uasg` | `pca:ler` | Planos no escopo de UASG |
| `POST /pca` | `pca:editar` | Abre a elaboração do plano de uma UASG e exercício (409 se já existe) |
| `GET /pca/:id` | `pca:ler` | Demandas, itens consolidados, aprovação e publicação |
| `POST /pca/:id/demandas` · `DELETE /pca/:id/demandas/:demandaId` | `pca:editar` | Registra ou remove demanda (plano em elaboração) |
| `POST /pca/:id/consolidar` | `pca:editar` | Consolida as demandas em itens |
| `POST /pca/:id/devolver` | `pca:aprovar` | Devolve para ajustes, com motivo |
| `POST /pca/:id/aprovar` | `pca:aprovar` | Aprova (segregação) e enfileira a publicação no PNCP |
| `POST /pca/:id/publicar` | `pca:aprovar` | Reabre a publicação que foi para a fila de erro |
| `GET /processos/:id/pca` | `jornada:ler` | Painel do DFD: vínculo, conferência, itens publicados, consulta ao PNCP, registro compartilhado e IRPs |
| `PUT /processos/:id/pca` | `jornada:editar` | Vincula o item do PCA ou registra a justificativa (etapa 1) |
| `POST /processos/:id/pca/consultar` | `jornada:editar` | Consulta o PCA publicado no PNCP pelo conector |
| `PUT /processos/:id/dfd/itens/:indice/catalogo` | `jornada:editar` | Escolha do código do catálogo de um item (etapa 1) |
| `GET /catalogo/itens?busca&tipo` | `jornada:ler` ou `pca:ler` | Consulta ao catálogo, com proveniência |
| `GET /catalogo/sugestoes?descricao&tipo` | `jornada:ler` ou `pca:ler` | Sugestão do código (RIA-13) |
| `GET /irps` · `GET /irps/:id` | `pca:ler` | Intenções com situação, adesões e consolidação |
| `POST /irps` | `irp:gerenciar` | Abre a IRP (422 `RN-38` com menos de 8 dias úteis) |
| `POST /irps/:id/adesoes` | `irp:aderir` | Adesão de UASG participante, com a IRP aberta |
| `POST /irps/:id/consolidar` | `irp:gerenciar` | Consolida as quantidades depois do encerramento |

Fila: o tipo de tarefa `pncp.pca` entrou em `TipoTarefaFila`, no manipulador do trabalhador e no `CHECK` de `fila_tarefas`.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_PNCP_CONSULTA_URL` | `https://pncp.gov.br/api/consulta` | API pública de consulta do PNCP (PCA publicado) |
| `AGORA_CATALOGO_CACHE_HORAS` | `168` | Validade do cache do catálogo no modo online (0 = sempre consulta) |
| `AGORA_COMPRAS_DADOS_URL` (já existia) | `https://dadosabertos.compras.gov.br` | Catálogo CATMAT/CATSER |
| `AGORA_PNCP_PUBLICACAO_URL`, `AGORA_PNCP_USUARIO`, `AGORA_PNCP_SENHA`, `AGORA_ORGAO_CNPJ`, `AGORA_INTEGRACOES` (já existiam) | — | Publicação do PCA e modo online |

## 7. Seção pronta para o manual do usuário

### Plano de contratações anual (Planejamento › Plano de contratações)

**Quem faz:**

- o **planejamento** registra as demandas e consolida o plano;
- o **gestor de contratos**, como **autoridade competente**, aprova ou devolve o plano;
- agente de contratação, controle interno e auditor consultam.

Cada usuário vê só os planos das UASGs do seu escopo.

1. Na lista, use **Abrir** no plano da UASG e do exercício. Para começar um plano novo, use **Abrir plano**.
2. Com o plano **Em elaboração**, use **Registrar demanda** e informe:
   - a unidade requisitante;
   - a descrição e o código do catálogo (CATMAT ou CATSER), se houver;
   - a unidade de fornecimento, a quantidade e o valor unitário estimado;
   - a data desejada, dentro do exercício;
   - o grau de prioridade e a categoria.

   Para tirar uma demanda, use **Remover**.
3. Quando as demandas estiverem completas, use **Consolidar demandas** e confirme. As demandas de mesmo código, unidade de fornecimento e categoria viram um só item, com as quantidades somadas, a data mais cedo e a prioridade mais alta.
4. A autoridade abre o plano consolidado e:
   - usa **Aprovar e publicar no PNCP** para aprovar. Quem consolidou não pode aprovar;
   - ou usa **Devolver para ajustes** e explica o que deve mudar.
5. Aprovado, o plano é enviado ao PNCP pela fila de integrações. A seção mostra **Publicado no PNCP**, com o número de controle. Se o PNCP recusar, o motivo aparece e o botão **Publicar no PNCP** reenvia.

Em demonstração, a publicação é simulada e a tela avisa.

### O PCA e o catálogo no DFD (jornada, etapa 1)

**Quem faz:** quem edita a jornada (planejamento e agente de contratação).

- **Plano de contratações anual (PCA):**
  - Quando a UASG tem PCA publicado para o exercício, escolha **Item do PCA publicado** e o item, ou **Não consta do PCA** e escreva a justificativa (mínimo de 30 caracteres). Depois, use **Registrar vínculo com o PCA**.
  - Sem isso, o processo não avança (RF-31).
  - **Consultar o PCA no PNCP** atualiza os itens publicados da UASG.
  - A marcação "Demanda prevista no PCA" acompanha o vínculo.
- **Código do catálogo:**
  - Em cada item salvo, use **Sugerir código para o item N**. A Ágora mostra os itens do catálogo mais parecidos, com a semelhança em porcentagem.
  - Confira a descrição e use **Usar o código … no item N**. A escolha é sua e fica na trilha.
- **Registro de preços compartilhado:**
  - Quando outras unidades preveem o mesmo item, a seção mostra as unidades e as quantidades.
  - **Propor intenção de registro de preços** abre o formulário da IRP já preenchido.

Antes de usar essas seções, salve ou descarte as alterações do DFD.

### Intenções de registro de preços (Planejamento › Intenções de registro de preços)

**Quem faz:**

- o **planejamento** e o **agente de contratação** abrem e consolidam as intenções;
- o **planejamento** e o **gestor de contratos** registram a adesão das suas unidades;
- todos com acesso ao planejamento consultam.

1. Use **Abrir intenção de registro de preços** e informe:
   - a UASG gerenciadora, o objeto, o código do catálogo e a unidade de fornecimento;
   - a quantidade do gerenciador;
   - as datas de abertura e de encerramento.

   A intenção fica aberta por **pelo menos 8 dias úteis** (art. 86). Com período menor, a Ágora recusa e informa a data mínima de encerramento.
2. Com a intenção **Aberta para adesões**, cada unidade participante usa **Registrar adesão**, com a quantidade e a manifestação de interesse.
3. Depois do encerramento, o gerenciador usa **Consolidar quantidades**. A Ágora soma o gerenciador e as adesões e mostra a participação de cada unidade.

## 8. Limitações e o que depende de acesso externo

- **Sem chamada real.** Os testes usam PNCP e dados abertos simulados (`fetch` falso). Os endpoints foram conferidos:
  - no Swagger do PNCP (manutenção e consulta);
  - no Swagger da API de dados abertos de compras;
  - no Manual de Integração PNCP 2.2.7 (seções 4.3, 5.16 e 6.7.1).

  O envio real do PCA depende do credenciamento do sistema no PNCP, do CNPJ do órgão entre os entes autorizados e das UASGs cadastradas como unidades.
- **Base legal.** O Planalto bloqueou a leitura automática da Lei 14.133 e do Decreto 11.462. O art. 9º do decreto (IRP de 8 dias úteis; dispensa quando o gerenciador é o único contratante) foi conferido em fontes secundárias, e o Decreto 10.947 no texto atualizado da Câmara (arts. 6º a 17).
- **IRP sem divulgação externa.** A IRP não é publicada no SRP digital do Compras.gov.br, que não tem API nesta fase, e a adesão é das UASGs do próprio órgão. A dispensa da IRP quando o gerenciador é o único contratante (§ 1º) fica a critério do gerenciador: a Ágora não abre a IRP sozinha.
- **Alteração do PCA publicado** (Decreto 10.947/2022, arts. 15 e 16) não foi implementada. O PNCP oferece retificação e exclusão de itens. A demanda fora do plano gera o sinal de revisão.
- **Planos lidos do PNCP:** itens retirados do PNCP não são apagados localmente, porque o DFD pode apontá-los. A importação não sobrescreve plano elaborado na Ágora para o mesmo exercício.
- **Catálogo:** a busca textual de serviços usa só a cópia local, porque a API não oferece o filtro. A carga de demonstração tem códigos sintéticos.
- **Item sem classe do catálogo** vai ao PNCP como catálogo "outros" (2), com o nome da categoria na classificação superior. O PNCP pode exigir a classe; conferir no ambiente de treinamento.
- **Para o coordenador:**
  - a migração 024 recria o `CHECK` de `fila_tarefas.tipo` com `pncp.pca`. Se outra frente acrescentar tipo de tarefa em migração própria, junte as listas, porque vale a última migração;
  - o teste `apps/api/test/fila.test.ts` ganhou `'pncp.pca'` no mapa de manipuladores, exigido pelo tipo `Manipuladores`.
