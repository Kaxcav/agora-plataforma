# Entrega da frente S — rotas de contratação, dispensa eletrônica, Sicx e cartão de pagamento (F9)

Regras novas: **RN-41** (dispensa eletrônica), **RN-42** (Sicx) e **RF-34** (rotas de contratação). Migração: `028_rotas_contratacao_sicx_cartao.sql`.

## 1. O que foi feito (F9, ampliada com o cartão de pagamento)

### Base legal conferida

| Norma | O que foi conferido | Fonte |
|---|---|---|
| Lei 14.133/2021, arts. 72, 74, 75, 79, 86 e 94 | Instrução da contratação direta, hipóteses de inexigibilidade, dispensa por valor, aviso de 3 dias úteis (§ 3º), cartão de pagamento (§ 4º), adesão e seus limites (§§ 2º a 5º e 8º), prazo de divulgação do contrato direto (10 dias úteis) | O Planalto bloqueou a consulta automatizada e o portal da Câmara limitou as requisições. A redação do art. 75, §§ 3º e 4º, e do art. 86, §§ 4º, 5º e 8º, foi conferida em transcrições publicadas por tribunais e órgãos; os arts. 72, 74 e 94 seguem a redação já usada no domínio. **Convém uma conferência final no texto compilado do Planalto** |
| Lei 15.266/2025 | Inclui o art. 79, IV (comércio eletrônico no Sicx), o § 1º, VII, "a" a "f" (regulamento: admissão de fornecedores, preços, entrega e recebimento, uso da plataforma, pagamento em até 30 dias do recebimento, sanções), o § 2º (outros compradores) e o art. 174, § 3º, VII (Sicx como funcionalidade do PNCP) | Publicação original na Câmara dos Deputados (DOU de 24/11/2025) |
| Decreto 13.106/2026 | **Regulamento do Sicx**, assinado em 24/8/2026, DOU de 25/8/2026, em vigor desde 8/9/2026. Usados: arts. 11 (ofertas por localidade e preço escalonado), 12 a 15 (ETP específico ou abrangente, reserva de limite, dispensa de TR e edital), 16 e 36 (estimativa pelas ofertas), 17 e 18 (ranqueamento automático, Cadin, desempate e sorteio), 19 (melhor oferta sem justificativa; outra com justificativa), 20 (agentes distintos para a ordem e a conclusão, salvo autorização prévia), 21 (conclusão = contratação), 22 (recebimento provisório em 2 dias úteis, definitivo em 10 dias, tácito no silêncio), 23 e 37 (pagamento com o recebimento definitivo, em até 30 dias) e 30 (reputação só auxiliar) | Publicação original na Câmara dos Deputados |
| Decreto 12.807/2025 | Limites de 2026: R$ 130.984,20 (art. 75, I) e R$ 65.492,11 (art. 75, II), em vigor em 1º/1/2026, revogado o Decreto 12.343/2024 | Câmara dos Deputados (publicação original, DOU de 30/12/2025, p. 17) e três fontes técnicas concordantes para os valores do anexo. A atualização de 2027 ainda não foi publicada |
| Decreto 11.462/2023 | Adesão: aceite do fornecedor antes da anuência (art. 31, § 1º); contratação em até 90 dias da anuência, na vigência da ata (art. 31, § 2º); limites (art. 32) | Reprodução do texto do decreto |

`LIMITES_DISPENSA` ganhou a linha do Decreto 12.807/2025. O teste que fixava a norma vigente em 2026 foi corrigido.

### Escolha da rota de contratação (RF-34)

- Na etapa 1, o processo escolhe a rota: licitação, dispensa, inexigibilidade, adesão a ata ou Sicx. Sem escolha, o processo segue a licitação, e nada muda nos processos existentes.
- `adaptacaoDaRota` (domínio) diz o que cada rota exige: documentos do art. 72 (obrigatório, facultativo ou não se aplica), edital, disputa, aviso, autorização da autoridade, contrato na jornada e prazo de divulgação.
- **Mudança mínima na jornada.** Um único ponto, `aplicarRotaContratacao`, é chamado por `avaliarProcesso`. Ele retira os bloqueios que a rota dispensa e acrescenta os da rota. As regras das etapas não mudaram. Outras edições na jornada:
  - travas que impedem publicar o edital e registrar a disputa fora da licitação, e gerar contrato no Sicx (`exigirAcaoNaRota`);
  - ajuste do contrato gerado nas rotas diretas (`ajustarContratoPelaRota`): origem "contratação direta", modalidade da rota, ata na adesão e prazo de divulgação de 10 dias úteis (art. 94, II);
  - campo `contratacaoDireta` em `processos.selecao`, que `vencedorDoProcesso` usa como contratado;
  - na interface, o painel da etapa é envolvido por `PainelRota`, e a etapa 5 esconde a publicação do edital nas rotas diretas. A rota direta é reconhecida pela modalidade prevista que o servidor grava ao salvar a rota; assim, os processos de licitação não fazem consulta a mais nas etapas 2 a 7, e o painel da etapa nunca é remontado quando a rota chega.
- **O que cada rota muda:**

| Rota | Etapa 3 | Etapa 4 | Etapa 5 | Etapa 6 | Etapa 7 |
|---|---|---|---|---|---|
| Licitação | sem mudança | sem mudança | sem mudança | sem mudança | sem mudança |
| Dispensa por valor (art. 75, I e II) | ETP e matriz de riscos facultativos (IN SEGES/ME 58/2022, art. 14, I) | sem edital; minuta facultativa (art. 95, I) | parecer + **aviso de 3 dias úteis** (no lugar do edital) | julgamento das propostas + autorização (art. 72, VIII) | contrato direto, divulgação em 10 dias úteis |
| Outras dispensas (art. 75, III a XVI) | sem mudança | sem edital | parecer | autorização | idem |
| Inexigibilidade (art. 74) | sem mudança | sem edital + **comprovação da hipótese** | parecer | autorização | idem |
| Adesão a ata (art. 86, § 2º) | sem mudança (vantagem e preços) | sem TR próprio nem edital | parecer + aceite do fornecedor + anuência do gerenciador | autorização (contratado = fornecedor do item) | 90 dias da anuência |
| Sicx (art. 79, IV) | cesta facultativa (estimativa pelas ofertas) | sem TR, edital nem minuta (Decreto, art. 15) | parecer facultativo | compra na vitrine | sem contrato: recebimento e pagamento |

### Dispensa eletrônica (RN-41)

- **Limite por valor:** valor acima do limite vigente bloqueia a rota (Decreto 12.807/2025).
- **Fracionamento por exercício e por objeto, integrado à RIA-01:** o processo informa o ramo de atividade. `avaliarFracionamentoPorObjeto` soma as dispensas por valor do mesmo ramo, da mesma UASG e do mesmo exercício, inclusive as compras com cartão de pagamento.
  - Atenção a partir de 80% do limite; risco acima dele.
  - Com risco, o processo só avança com a análise do agente registrada (a decisão continua humana).
  - Compras pelo Sicx e licitações não entram na soma.
- **Aviso:** `POST /processos/:id/dispensa/aviso` publica no PNCP pela fila da frente B (`pncp.contratacao_direta`).
  - O prazo de 3 dias úteis (`situacaoAvisoDispensa`, sobre `adicionarDiasUteis`) conta da publicação, com feriados.
  - O envio aparece nos **Envios ao PNCP** da etapa 5.
  - A etapa 5 só avança depois do encerramento do aviso.
- **Propostas:** a proposta registrada antes do aviso é "inicial"; durante o aviso, é "adicional". Depois do encerramento, o servidor recusa novas propostas.
- **Julgamento:** `julgarPropostasDispensa` escolhe o menor preço dentro do limite; no empate, a proposta recebida primeiro. Proposta acima do limite é desclassificada; acima do valor estimado vira sinal para a justificativa de preço.
- **Autorização:** a autoridade competente designada registra a razão da escolha, a justificativa de preço e a habilitação verificada (art. 72, V a VIII). O contrato é gerado pela etapa 7 da jornada, com a checagem de CEIS, CNEP e certidões (RN-09).

### Inexigibilidade (art. 74)

- Hipóteses I a V.
- `validarInexigibilidade` confere, por hipótese:
  - exclusividade: documento de exclusividade e vedação de preferência por marca (§ 1º);
  - artista: consagração e exclusividade permanente do empresário (§ 2º);
  - notória especialização: alínea, elementos do § 3º e vedação de publicidade;
  - credenciamento: edital de chamamento;
  - imóvel: requisitos do § 5º.
- As pendências bloqueiam a etapa 4.
- Sem aviso publicado, a autorização enfileira a divulgação do **ato que autoriza a contratação direta** (art. 72, parágrafo único). Ela também serve de "compra" no PNCP para a divulgação do contrato.

### Adesão a ata (art. 86, §§ 2º a 5º e 8º)

- `avaliarAdesaoAta` aplica as regras:
  - até 50% do registrado por órgão aderente;
  - o dobro no total das adesões;
  - ata vigente e com previsão de adesão;
  - participante não adere;
  - órgão federal não adere a ata estadual, distrital ou municipal.
- **Pedido acima do limite é recusado (422)**, nunca cortado em silêncio.
- Fluxo: pedido, aceite do fornecedor, anuência do gerenciador (`POST /atas/adesoes/:id/anuencia`, com `atas:editar` e a UASG da ata no escopo, que reconfere os limites) e contratação em até 90 dias (`prazoContratacaoAdesao`).

### Sicx — comércio eletrônico (RN-42)

- **Vitrine simulada no modo offline:** 6 itens comuns padronizados com 5 ofertas sintéticas cada. Há preço escalonado, uma oferta com restrição no Cadin e uma que não atende ao DF.
- **Ranqueamento** (`ranquearOfertasSicx`) só com ofertas aptas: credenciada, sem Cadin, na UF da UASG e com pagamento em até 30 dias. Ordena pelo valor total na quantidade; desempata pela reputação e, persistindo o empate, por sorteio determinístico com semente auditável.
- **Ordem de compra e conclusão** (`validarCompraSicx`):
  - fora da 1ª posição, a justificativa é obrigatória;
  - quem emite a ordem não conclui a compra, salvo autorização prévia na reserva do ETP abrangente;
  - a compra se liga a um processo da rota Sicx (etapa 6, ETP específico) ou a uma reserva de limite do ETP abrangente (`avaliarReservaSicx`, controle de valores).
- **Prazos** (`prazosCompraSicx`): recebimento provisório em 2 dias úteis da entrega, definitivo em 10 dias, tácito no silêncio, e pagamento em até 30 dias do recebimento definitivo.

### Cartão de pagamento (art. 75, § 4º)

- Registro de compras pagas com cartão (`validarCompraCartao`): só dispensa por valor, dentro do limite e com o ramo de atividade.
- Cada compra devolve o sinal de fracionamento do ramo.
- Extrato mensal (`montarExtratoCartao`) com hash SHA-256, divulgado no PNCP pela fila (`pncp.extrato_cartao`).
- Depois do extrato divulgado, a competência fecha para novas compras.

### Telas (RF-34)

- **Etapa 1:** quadro **Rota de contratação**, com rota, hipótese, ramo de atividade, justificativa, limite vigente, sinal de fracionamento, pendências e quadro de documentos e travas do art. 72. Na adesão, inclui a busca de atas que aceitam adesão, com os saldos por órgão e no total.
- **Etapa 4:** aviso de quais documentos se aplicam e, na inexigibilidade, o formulário **Comprovação da inexigibilidade**.
- **Etapa 5:** **Aviso de dispensa eletrônica**, com publicação, prévia e **contagem dos dias úteis**, número de controle, protocolo e registro de propostas. Na adesão, **Aceite do fornecedor e anuência**.
- **Etapa 6, rotas diretas:** julgamento das propostas e **Autorização da contratação**. No Sicx: compras do processo e o link para a vitrine.
- **Etapa 7, Sicx:** compras e prazos, sem contrato.
- **Novas páginas:** `/sicx` (vitrine do Sicx), `/cartao-pagamento` (cartão de pagamento) e `/atas/adesoes` (adesões às atas, para o gerenciador), na seção de menu **Contratação direta**.

### Testes

- **Domínio:** `packages/dominio/test/rotas-contratacao.test.ts`, com 30 casos, e `limites.test.ts`, que ganhou o Decreto 12.807/2025.
- **API:** `apps/api/test/rotas-contratacao.test.ts`, com 9 testes:
  - dispensa de ponta a ponta com relógio controlado (aviso, propostas, julgamento, autorização, contrato e prazo de 10 dias úteis);
  - fracionamento;
  - inexigibilidade;
  - adesão com limites de 50% e do dobro;
  - Sicx: vitrine, segregação, reserva, recebimento e pagamento;
  - cartão: limite, sinal e extrato;
  - processo na rota Sicx.
- **e2e:** `e2e/testes/rotas-contratacao.spec.ts`, com verificação axe:
  - dispensa com aviso de 3 dias úteis e proposta adicional; o avanço é recusado enquanto o aviso está aberto;
  - fracionamento sinalizado;
  - adesão acima do limite recusada;
  - compra pela vitrine do Sicx;
  - telas do cartão de pagamento e das adesões às atas sem violações graves de acessibilidade.
- Os testes da API e do e2e levam a dispensa até a etapa 5 pelas mesmas chamadas da interface. Depois da integração com a frente P, isso inclui a dotação e a declaração de adequação orçamentária aprovada pela autoridade designada (RN-39, etapa 4), exigida também na contratação direta (art. 72, IV).

### Integração com as frentes da leva 2

- **Fila de integrações.** A migração 020 (frente K) incluiu `pncp.termo` no `CHECK` de `fila_tarefas.tipo`, a 024 (frente O) incluiu `pncp.pca`, e a 029 (frente T) refaz a lista com `sei.envio`, `sei.assinaturas` e `dou.conferencia`. Como a 029 roda depois da 028, ela apagaria os tipos desta frente:
  - a 028 passou a repetir os tipos da 020 e da 024 mais `pncp.contratacao_direta` e `pncp.extrato_cartao`;
  - **a lista da 029 recebeu os dois tipos desta frente** (edição de uma linha em arquivo de outra frente, necessária para o aviso e o extrato funcionarem). A frente O já tinha incluído `pncp.pca` na mesma lista, e as duas inclusões foram unidas.
  - Banco local em que a 029 já foi aplicada acusa migração alterada na inicialização: recrie o banco de demonstração. Nenhum ambiente de produção recebeu a 029.
- **Frente P (dotação e peças complementares).** O bloqueio RN-39 da etapa 4 vale para todas as rotas. Na tela do processo, as peças complementares continuam depois do painel da rota.
- **Arquivos compartilhados.** Em perfis, registro de módulos, seed, contratos, catálogo, índice do domínio, rotas e menu da web, as entradas desta frente ficaram depois das entradas das frentes já integradas.
- **Frente R (sigilo).** O teste `sigilo.test.ts` conferia as 5 últimas permissões da matriz e quebrava com `pagamentos:registrar` no fim da lista. Prevaleceu a correção do coordenador na integração, que confere o bloco das permissões do sigilo onde quer que esteja.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde está |
|---|---|---|
| 58, 190 | Módulo de contratação direta e dispensa eletrônica com aviso de 3 dias úteis para propostas adicionais; vitrine do Sicx | RN-41 (aviso, propostas, julgamento) e RN-42 (vitrine) |
| 263 | Aba de dispensa eletrônica com aviso de 3 dias úteis e vitrine do Sicx | Etapa 5 da jornada (aviso) e `/sicx` |
| 398, 658 | Dispensa com aviso mínimo de 3 dias úteis; integração ao Sicx (art. 79, IV, e art. 174, § 3º, VII) | RN-41; RN-42 com o regulamento (Decreto 13.106/2026) |
| 1494–1497 (RF-03.2) | Publicação automática do aviso por 3 dias úteis; cartão de pagamento com extrato no PNCP (art. 75, § 4º); Sicx para bens e serviços comuns padronizados com pagamento em até 30 dias (art. 79, § 1º, VII, "e") | Aviso pela fila do PNCP; `/cartao-pagamento` com extrato pela fila; prazos do Sicx |
| 1817 | Etapa 6: módulo de dispensa eletrônica (aviso mínimo de 3 dias úteis) e vitrine do Sicx | Etapa 6 adaptada à rota e link para a vitrine |
| 702 | Entrega do módulo com dispensa eletrônica e Sicx | Esta frente |

## 3. Equivalentes lícitos adotados e motivo

- **"Publicação automática do aviso" → publicação por ato humano, pela fila.** O agente com `jornada:publicar` aciona o envio depois do parecer favorável. Tudo o mais é automático: envio pela fila com novas tentativas, contagem do prazo a partir da publicação e travas. O ato de divulgar é de agente público (art. 8º), e a Ágora não o pratica sozinha.
- **Fracionamento: sinal, não decisão.** Acima do limite no mesmo ramo, a Ágora não proíbe a dispensa: exige a análise do agente por escrito. Classificar "mesma natureza" é juízo humano (art. 75, § 1º, II). O sinal continua visível no processo.
- **Compras pelo Sicx fora da soma do fracionamento.** O § 1º do art. 75 trata só das dispensas dos incisos I e II. O Sicx é hipótese de credenciamento (art. 79, IV), e o Decreto 13.106/2026 não cria limite por valor. O controle de valores do Sicx é a reserva de limite do ETP abrangente (art. 13, § 1º). Se o órgão central disciplinar o contrário, a regra muda em `avaliarFracionamentoPorObjeto`.
- **Integração com a plataforma do Sicx → vitrine simulada.**
  - A plataforma e as normas complementares da SGI ainda não estão disponíveis: credenciamento eletrônico, adesão de compradores, critérios e pesos do ranqueamento, reputação e API.
  - O modo offline simula a vitrine. Entrega e recebimento são registrados por agente (na plataforma real, a entrega vem do fornecedor).
  - Os critérios de ranqueamento seguem o que o decreto já fixa: Cadin, localidade, desempate e sorteio.
- **Pagamento em até 30 dias.** A lei fixa o teto (art. 79, § 1º, VII, "e"). Enquanto o Sicx não liberar o pagamento automático, vale o art. 37 do decreto: rito ordinário, em até 30 dias do recebimento. A Ágora controla esse prazo.
- **Extrato do cartão no PNCP.** O PNCP não tem serviço para o extrato do cartão de pagamento. No modo offline, a divulgação é simulada com protocolo e hash. No modo online, a tarefa vai para a fila de erro com o motivo, para reprocessar quando o serviço existir. O extrato fica registrado e consultável na Ágora.
- **Ato que autoriza a contratação direta no PNCP.** Para inexigibilidade e demais dispensas, a autorização enfileira a divulgação do ato (art. 72, parágrafo único), e ela serve de base para divulgar o contrato (art. 94, II). A divulgação do contrato da adesão continua pela compra da ata do gerenciador.

## 4. Regras novas (catálogo)

| Código | Título | Etapa | Implementação |
|---|---|---|---|
| RN-41 | Dispensa eletrônica: aviso de 3 dias úteis, propostas adicionais, limites e fracionamento | 5 | `situacaoAvisoDispensa`, `prazoAvisoDispensaEletronica`, `julgarPropostasDispensa`, `avaliarFracionamentoPorObjeto`, `validarCompraCartao`, `montarExtratoCartao`, `limiteDispensaVigente` |
| RN-42 | Comércio eletrônico pelo Sicx: ranqueamento, segregação, recebimento e pagamento em até 30 dias | 6 | `ranquearOfertasSicx`, `validarCompraSicx`, `prazosCompraSicx`, `avaliarReservaSicx` |
| RF-34 | Rotas de contratação: licitação, dispensa, inexigibilidade, adesão a ata e Sicx | 1 | `adaptacaoDaRota`, `validarEscolhaRota`, `validarInexigibilidade`, `avaliarAdesaoAta`, `prazoContratacaoAdesao` |

Também nova no domínio: `categoriaProcessoPncp`, que dá a categoria do contrato no PNCP sem depender da modalidade. Com ela, a divulgação do contrato de uma contratação direta deixou de falhar em `codigosContratacaoPncp`.

## 5. Rotas novas (`/api/v1`)

| Método e caminho | Permissão | O que faz |
|---|---|---|
| `GET /processos/:id/rota` | `jornada:ler` | Rota, documentos e travas, limite, fracionamento, aviso, propostas, adesão, autorização e compras do Sicx |
| `PUT /processos/:id/rota` | `jornada:editar` (etapa 1) | Escolhe a rota e a hipótese; atualiza a modalidade prevista |
| `POST /processos/:id/dispensa/aviso` | `jornada:publicar` (etapa 5, parecer favorável) | Publica o aviso no PNCP pela fila |
| `POST /processos/:id/dispensa/propostas` | `jornada:editar` (etapa 5) | Registra proposta inicial ou adicional; recusa depois do encerramento |
| `POST /processos/:id/dispensa/julgamento` | `jornada:editar` (etapa 6, aviso encerrado) | Julga e classifica as propostas |
| `PUT /processos/:id/inexigibilidade` | `jornada:editar` (até a etapa 5) | Comprovação da hipótese do art. 74 |
| `GET /processos/:id/adesao/atas-disponiveis` | `jornada:ler` | Atas vigentes que aceitam adesão, de outra UASG, com saldos |
| `POST /processos/:id/adesao` | `jornada:editar` (até a etapa 4) | Pede a adesão; acima dos limites, 422 |
| `POST /processos/:id/adesao/aceite-fornecedor` | `jornada:editar` | Aceite do fornecedor |
| `GET /atas/adesoes` | `atas:ler` | Pedidos de adesão às atas das UASGs do usuário |
| `POST /atas/adesoes/:id/anuencia` | `atas:editar` + UASG da ata no escopo | Anuência ou recusa do gerenciador |
| `POST /processos/:id/contratacao-direta/autorizacao` | `jornada:homologar` + autoridade designada (etapa 6) | Autorização da contratação (art. 72, VIII) |
| `GET /sicx/ofertas?uasg&busca&quantidade` | `jornada:ler` | Vitrine ranqueada para a UF da UASG |
| `GET /sicx/reservas`, `POST /sicx/reservas` | `jornada:ler` / `jornada:editar` | Reservas de limite do ETP abrangente |
| `GET /sicx/compras`, `POST /sicx/compras` | `jornada:ler` / `jornada:editar` | Compras; ordem de compra |
| `POST /sicx/compras/:id/conclusao` e `/entrega` | `jornada:editar` | Conclusão (outro agente) e entrega |
| `POST /sicx/compras/:id/recebimento` | `pagamentos:atestar` ou `jornada:editar` | Recebimento provisório e definitivo |
| `POST /sicx/compras/:id/pagamento` | `pagamentos:registrar` | Pagamento (liberado com o recebimento definitivo) |
| `GET /cartao-pagamento/compras`, `GET /cartao-pagamento/extratos` | `pagamentos:ler` | Compras e extratos do cartão |
| `POST /cartao-pagamento/compras`, `POST /cartao-pagamento/extratos` | `pagamentos:registrar` | Registro de compra (com sinal de fracionamento) e divulgação do extrato |

**Permissão nova:** `pagamentos:registrar`, no fim de `TODAS_PERMISSOES`, no perfil **Financeiro** e no tipo `Permissao`. Toda escrita gera evento na trilha encadeada:

- `processo.rota.escolher`, `processo.dispensa.*`, `processo.inexigibilidade.registrar`, `processo.adesao.*`, `ata.adesao.*` e `processo.contratacao_direta.autorizar`;
- `sicx.*`, `cartao_pagamento.*`;
- `pncp.aviso_dispensa`, `pncp.ato_contratacao_direta` e `pncp.extrato_cartao`.

**Fila (frente B):** novos tipos `pncp.contratacao_direta` e `pncp.extrato_cartao`, com manipuladores em `modulos/fila/manipuladores.ts`. O `CHECK` de `fila_tarefas.tipo` foi unido ao das migrações 020 e 029 (seção 1, "Integração com as frentes da leva 2"). Se outra frente incluir novos tipos de tarefa depois da 029, a lista dela precisa repetir os tipos desta frente.

## 6. Variáveis de ambiente

Nenhuma nova. Valem `AGORA_INTEGRACOES` (`offline`, o padrão, ou `online`) e as credenciais do PNCP da frente B.

## 7. Seção para o manual do usuário

> Para entrar na seção 9 (Jornada da contratação), depois de **Etapa 1 — Demanda e PCA**, e como nova seção **Contratação direta** no menu.

**Escolher a rota de contratação.** Com os perfis **Planejamento** ou **Agente de contratação**, na etapa 1:

1. Em **Rota de contratação**, escolha como o órgão vai contratar:
   - **Licitação**: pregão ou concorrência, como hoje;
   - **Dispensa de licitação**;
   - **Inexigibilidade**;
   - **Adesão a ata de registro de preços**;
   - **Comércio eletrônico (Sicx)**.
2. Na dispensa, escolha a hipótese. **Por valor** é para compras pequenas: até R$ 65.492,11 em compras e serviços e até R$ 130.984,20 em obras e engenharia, em 2026. Informe o **Ramo de atividade do objeto** (por exemplo, "material de expediente"). Em **Outra hipótese do art. 75**, informe o inciso.
3. Na inexigibilidade, escolha a hipótese do art. 74.
4. Escreva a **Justificativa da escolha da rota** e clique em **Salvar rota**.

A Ágora mostra o limite vigente, a **soma do mesmo ramo no exercício** (dispensas e compras com cartão) e os **documentos e travas da rota**.

- Se a soma passar do limite, aparece o **sinal de fracionamento**. Registre a **Análise do agente** para seguir, ou licite o objeto.
- A rota adapta as etapas seguintes: na dispensa e na inexigibilidade não há edital nem disputa; na dispensa por valor, ETP e matriz de riscos são facultativos.

**Dispensa eletrônica.** Na etapa 5, depois do parecer jurídico favorável:

1. Quem tem o perfil **Agente de contratação** clica em **Publicar aviso no PNCP**. A tela mostra até quando o aviso fica aberto e quantos dias úteis faltam. São no mínimo 3 dias úteis.
2. Enquanto o aviso estiver aberto, registre as **propostas adicionais** recebidas: fornecedor e valor. Depois do encerramento, novas propostas são recusadas.
3. Encerrado o aviso, avance para a etapa 6 e clique em **Julgar propostas**. A Ágora classifica pelo menor preço dentro do limite e desclassifica o que passar dele.
4. A **autoridade competente** designada (perfil **Gestor de contratos**) preenche a razão da escolha e a justificativa de preço, confirma a habilitação e clica em **Autorizar contratação**.
5. Na etapa 7, gere o contrato. Divulgue-o no PNCP em até 10 dias úteis.

**Inexigibilidade.** Nas etapas 4 e 5, preencha a **Comprovação da inexigibilidade**. A tela pede o que a hipótese exige: documento de exclusividade sem preferência por marca, elementos da notória especialização, edital de chamamento, avaliação do imóvel ou consagração do artista. A conclusão é do agente e do parecer jurídico. Na etapa 6, a autoridade autoriza a contratação.

**Adesão a ata.** Na etapa 1, depois de salvar a rota de adesão:

1. Busque o item em **Item da ata**. Aparecem só atas vigentes, de outra UASG, que aceitam adesão, com o saldo por órgão e no total.
2. Informe a quantidade e a justificativa da vantagem e clique em **Solicitar adesão**. Acima de 50% do registrado para o órgão, ou além do dobro no total, a adesão é recusada.
3. Na etapa 5, registre o **aceite do fornecedor**.
4. O gestor da ata (perfil com edição de atas, na UASG gerenciadora) dá a anuência em **Contratação direta › Adesões às atas**.
5. Contrate em até 90 dias da anuência.

**Vitrine do Sicx.** Em **Contratação direta › Vitrine do Sicx**, com os perfis **Planejamento** ou **Agente de contratação**:

1. Informe a UASG, o item e a quantidade. A vitrine mostra as ofertas aptas em ordem de valor total. As inaptas aparecem com o motivo: Cadin, localidade ou prazo de pagamento.
2. Clique em **Selecionar** na oferta e escolha a **reserva de limite do ETP abrangente**. Se a compra vier de um processo na rota Sicx, use o botão da etapa 6. Fora da 1ª posição, justifique a escolha.
3. Clique em **Emitir ordem de compra**. Outro agente clica em **Concluir compra**. A mesma pessoa só conclui se a reserva tiver autorização prévia.
4. Registre a entrega e os recebimentos provisório e definitivo. Sem manifestação no prazo, o recebimento é tácito.
5. O **Financeiro** registra o pagamento em até 30 dias do recebimento.

No modo de demonstração, a vitrine é simulada.

**Cartão de pagamento.** Em **Contratação direta › Cartão de pagamento**, o perfil **Financeiro** registra as compras pagas com o cartão: data, fornecedor, valor, objeto e ramo de atividade.

- A compra precisa caber no limite da dispensa por valor.
- A tela mostra o sinal de fracionamento do ramo.
- No fim do mês, clique em **Divulgar extrato da competência no PNCP**. Depois disso, a competência não aceita novas compras.
- Os demais perfis com leitura de pagamentos consultam as compras e os extratos.

## 8. Limitações e o que depende de acesso externo

- **Plataforma e API do Sicx:** dependem da disponibilização pelo órgão central e das normas complementares da SGI (Decreto 13.106/2026, arts. 3º, 4º, 9º, 17, § 2º, 19, 28, 30, 31 e 38). A vitrine, o ranqueamento e os prazos estão prontos sobre dados simulados; a integração real entra quando a API for publicada.
- **Publicação real no PNCP da contratação direta:** o PNCP passou a servir as tabelas de domínio só pelo portal (pncp.gov.br/app/entidades-dominio), inclusive os códigos de amparo legal do art. 72, 74 e 75. Por isso, no modo online, a tarefa vai para a fila de erro com o motivo, até que esses códigos sejam conferidos e configurados. O modo offline funciona de ponta a ponta.
- **Extrato do cartão no PNCP:** não há serviço do PNCP para ele (seção 3).
- **Divulgação do contrato da adesão:** depende da compra da ata no PNCP, do gerenciador.
- **Esfera da ata:** o cadastro de atas não guarda a esfera do gerenciador. Todas as atas são tratadas como federais, e a vedação do § 8º está pronta no domínio para quando houver atas de outras esferas.
- **Agências executivas (art. 75, § 2º):** o limite em dobro não foi implementado, porque as UASGs do MJSP não são agências executivas.
- **Limites de 2027:** o decreto de atualização ainda não foi publicado. Ao sair, basta incluir a linha em `LIMITES_DISPENSA`. O Decreto 12.807/2025 delega as próximas atualizações ao ministério.
