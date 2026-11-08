# Frente I — consulta automática de preços e projeções (F23)

Entrega da função F23 do plano: consulta automatizada e combinada dos parâmetros do art. 23 da Lei 14.133/2021 (RF-25) e projeção de variação cambial e inflacionária do valor estimado (RIA-11).

## 1. O que foi feito (F23)

**Consulta automática e combinada de preços (RF-25).** Na etapa 3, a seção **Consulta automática de preços** pesquisa o item de referência da cesta (item 1 do DFD, como já define a regra da cesta). O servidor consulta cada fonte de forma independente, e a falha de uma não impede as outras:

| Fonte | Parâmetro | Como é consultada |
|---|---|---|
| Painel de Preços | art. 23, § 1º, I | API de dados abertos do Compras.gov.br, módulo de pesquisa de preço (`1_consultarMaterial` para bens, `3_consultarServico` para serviços), pelo CATMAT/CATSER, compras dos últimos 12 meses |
| Contratações similares | § 1º, II, ou § 2º, III | itens com resultado de contratações da Lei 14.133 divulgadas no PNCP, pela API de dados abertos (`modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133`), último ano |
| Notas fiscais eletrônicas | § 1º, V, ou § 2º, IV | API do Portal da Transparência (`/notas-fiscais` e `/notas-fiscais-por-chave`), com chave de acesso; notas de até 1 ano |
| Sinapi e Sicro | § 2º, I | tabela oficial importada no servidor (não há API pública), lote mais recente da UF do processo |

- **Enquadramento.** Cada amostra passa por `selecionarSugestoesPrecos` (domínio), que faz quatro coisas:
  - enquadra a amostra no inciso conforme o tipo de objeto (`enquadrarAmostraArt23`);
  - descarta, com o motivo, a amostra fora do prazo legal, de data futura, sem valor, repetida ou de fonte não prevista para o objeto;
  - ordena na ordem legal (incisos I e II primeiro, IN 65/2021, art. 5º, § 1º; em obras, a ordem do § 2º);
  - emite alertas: falta de parâmetro prioritário, falta de Sinapi/Sicro em obras e menos de três preços.
- **Proveniência.** Cada consulta grava, por fonte, a situação, o modo, o horário, a quantidade, o hash SHA-256 do conteúdo recebido e o endereço consultado (sem a chave). Grava também as sugestões e as amostras descartadas, e registra o evento `processo.precos.consultar` na trilha.
- **Inclusão na cesta.** O agente marca as sugestões e clica em **Incluir N preços na cesta**. Cada uma vira cotação da cesta existente com:
  - o parâmetro da cesta (`painel_precos`, `contratacao_similar`, `nota_fiscal`; Sinapi e Sicro entram como `midia_especializada`, tabela de referência oficial);
  - o valor unitário e a data da fonte;
  - a identificação, com a fonte, o registro, a unidade compradora e o inciso.

  A sugestão fica marcada como incluída (sem inclusão duplicada) e o evento `processo.cesta.incluir_sugestoes` registra cada cotação criada. A análise estatística e a importação da cesta não foram alteradas: a cesta só é alimentada.
- **Tabelas de obras.** A tabela do Sinapi ou do Sicro é importada por lote (sistema, UF, data-base e desoneração), em CSV com as colunas código, descrição, unidade e preço. A importação tem hash, validação por linha e o evento `precos.referencias.importar` na trilha.

**Projeção cambial e inflacionária (RIA-11).** Na seção **Projeção do valor estimado**, o agente informa a **data prevista da contratação** e a **parcela do valor sujeita ao câmbio**. O servidor obtém os índices e `projetarValorEstimado` (domínio) faz o cálculo:

- **Índices.** IPCA do IBGE (SIDRA, tabela 1737, variável 63) e dólar de venda, média mensal, do Banco Central (SGS, série 3698).
- **Cálculo.** Média geométrica mensal dos 12 últimos meses divulgados, até a data prevista (no máximo 36 meses). A parcela cambial segue a variação média do dólar e o restante segue o IPCA. A faixa usa a média mais ou menos um desvio-padrão.
- **Resultado.** O valor projetado do processo e o unitário da cesta, a variação, a faixa, as premissas, a memória de cálculo, as fontes (série, período, horário, modo e hash) e um sinal de atenção a partir de 5%. Traz também a etiqueta **Requer revisão humana**.
- **Efeito.** A projeção não altera o valor estimado nem a cesta. Fica registrada no processo e na trilha (`processo.precos.projetar`).
- **Falha da fonte.** No modo online, se a fonte falhar, usa-se a última série gravada no servidor, com o aviso nas premissas.

**Modo offline (padrão) e dados de demonstração.**

- **Fontes de preço.** Painel, contratações similares e notas fiscais são simulados de forma determinística, pelo PRNG do seed, a partir do item e do termo. A mesma pesquisa devolve as mesmas amostras, com identificadores `DEMO`, e uma contratação similar fora do prazo de 1 ano demonstra o descarte.
- **Séries e tabelas.** O seed grava 24 meses de séries sintéticas de IPCA e câmbio e tabelas sintéticas do Sinapi e do Sicro (códigos `DEMO-…`) para as UFs das UASGs de demonstração. Nada vem das fontes reais nem de `reference/`.

## 2. Linhas da conversa atendidas

| Linhas | Pedido (resumo) | Onde está |
|---|---|---|
| 50, 174 | Cesta de preços automatizada com integração (simulada) ao painel de preços, à base nacional de NF-e, às contratações similares dos últimos 12 meses e ao Sinapi/Sicro | RF-25: conectores online, simulação offline e tabelas de obras |
| 55, 183 | IA de saneamento estatístico (já existente, RIA-03) e projeção de variação cambial/inflacionária | RIA-11 |
| 371 | Estimativa do valor com os parâmetros do art. 23, § 1º, combinados | enquadramento por inciso, ordem legal e inclusão combinada na cesta |
| 395 | Módulo 2: coleta automatizada no painel de preços, NF-e e Sinapi/Sicro | RF-25 |
| 555 | Matriz de riscos: risco de variação cambial e de inflação | RIA-11, como sinal com premissas, para apoiar a alocação do risco e o reajuste |
| 655 | RF-02.1, compositor multiparamétrico: consulta automatizada e combinada nos §§ 1º e 2º (painel, similares de 1 ano, mídia e tabelas, NF-e, Sicro/Sinapi) | RF-25. Mídia especializada e pesquisa direta continuam manuais ou por planilha, pois não têm fonte de dados aberta |
| 1460–1475, 1793 | Etapa 3: compositor multiparamétrico da cesta conectado às mesmas fontes | seções **Consulta automática de preços** e **Projeção do valor estimado** da etapa 3 |

## 3. Equivalentes lícitos adotados e motivo

- **Base nacional de NF-e.** A base completa não é pública: está protegida por sigilo fiscal, e o art. 23, § 1º, V, remete a regulamento.
  - O que foi feito: conector para a API pública do Portal da Transparência, que cobre as NF-e destinadas a órgãos do Poder Executivo federal. A API exige chave gratuita (`AGORA_TRANSPARENCIA_CHAVE`).
  - Sem a chave, a fonte aparece como **Depende de acesso**. A base nacional inteira depende de convênio com a Receita Federal e as Secretarias de Fazenda.
  - Em demonstração, a fonte é simulada, como a conversa pede ("integração simulada").
- **Sinapi e Sicro.** Não têm API pública: Caixa e DNIT publicam planilhas.
  - O que foi feito: importação da tabela oficial no servidor, com proveniência e trilha.
  - Na cesta, a cotação entra no parâmetro existente de tabela de referência oficial (`midia_especializada`), com o inciso "art. 23, § 2º, I" registrado na identificação. Assim o enum da cesta, a análise e a importação por planilha não mudam.
- **Inclusão automática de preços e "IA" que decide.** Nada entra na cesta sem a escolha do agente. A projeção é estatística e determinística, sem LLM, e é sinal com fontes, premissas, data e "requer revisão humana" (regra 5).
- **"Painel de Preços do PNCP".** O art. 23, § 1º, I, fala do painel de consulta de preços. Os dados abertos oficiais desse painel estão na API do Compras.gov.br (módulo de pesquisa de preço), que é a fonte usada.
- **Contratações similares.** Vêm dos itens de contratações da Lei 14.133 divulgadas no PNCP, pela mesma API de dados abertos. O conector `pncp.ts` existente (contratos por órgão, sem preço por item) não serve para isso e não foi alterado.
- **Painel em obras.** O § 2º não prevê o painel para obras e serviços de engenharia: a fonte aparece como **Não se aplica**.
- **LGPD.** As sugestões não guardam nome nem documento de fornecedor, que pode ser pessoa física ou MEI. A amostra identifica a compra, a unidade compradora e a data.
- **Permissões.** Nenhuma permissão nova foi criada, para não mexer na matriz compartilhada:
  - pesquisar, incluir e projetar exigem `jornada:editar`, com o escopo de UASG do processo;
  - ler exige `jornada:ler`;
  - importar a tabela do Sinapi/Sicro (carga de dado oficial externo, global) exige `integracoes:executar`.

## 4. Regras novas

- **RF-25 — Consulta automática e combinada de preços** (etapa 3; `selecionarSugestoesPrecos`, `enquadrarAmostraArt23`; art. 23, §§ 1º e 2º; IN SEGES/ME 65/2021, art. 5º).
- **RIA-11 — Projeção de variação cambial e inflacionária do valor estimado** (etapa 3; `projetarValorEstimado`; art. 23 e art. 25, § 7º; IN SEGES/ME 65/2021, art. 5º, I e II).

Testes de domínio: `packages/dominio/test/pesquisa-precos.test.ts`.

## 5. Rotas novas (`/api/v1`)

| Método e rota | Permissão | Resposta |
|---|---|---|
| `GET /processos/:id/pesquisa-precos` | `jornada:ler` | `PesquisaPrecosProcesso`: item de referência, termo sugerido, últimas 5 consultas, última projeção e tabelas de obras da UF |
| `POST /processos/:id/pesquisa-precos/consultas` | `jornada:editar` | 201 `ConsultaPrecos` (etapa até 3) |
| `POST /processos/:id/pesquisa-precos/consultas/:consultaId/incluir` | `jornada:editar` | `ProcessoDetalhe` (422 se a sugestão já foi incluída ou se passar de 50 cotações) |
| `POST /processos/:id/pesquisa-precos/projecao` | `jornada:editar` | 201 `ProjecaoValorEstimado` (422 sem valor estimado, sem série ou com data inválida) |
| `GET /pesquisa-precos/referencias-engenharia` | `jornada:ler` | `TabelaReferenciaEngenharia[]` |
| `POST /pesquisa-precos/referencias-engenharia/importacao` | `integracoes:executar` | `ResultadoImportacaoReferencias` (422 com os erros por linha) |

Migração `018_pesquisa_precos.sql`: tabelas `consultas_precos`, `indices_economicos`, `projecoes_valor_estimado`, `referencias_engenharia_lotes` e `referencias_engenharia`.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_INTEGRACOES` (existente) | `offline` | `online` liga os conectores reais; `offline` usa a simulação e as séries do seed |
| `AGORA_COMPRAS_DADOS_URL` | `https://dadosabertos.compras.gov.br` | painel de preços e contratações similares |
| `AGORA_TRANSPARENCIA_URL` | `https://api.portaldatransparencia.gov.br/api-de-dados` | notas fiscais |
| `AGORA_TRANSPARENCIA_CHAVE` | (vazia) | chave da API do Portal da Transparência, enviada só no cabeçalho `chave-api-dados` |
| `AGORA_IBGE_SIDRA_URL` | `https://apisidra.ibge.gov.br` | IPCA |
| `AGORA_BCB_SGS_URL` | `https://api.bcb.gov.br/dados/serie` | câmbio |
| `AGORA_PRECOS_TIMEOUT_MS` | `15000` | tempo máximo por requisição (com 2 novas tentativas em 429/5xx) |

## 7. Seção para o manual do usuário

> Para entrar na seção 9 (Jornada da contratação), dentro de **Etapa 3 — ETP, riscos e preços**, depois de **Importar a cesta de uma planilha**.

**Consultar preços automaticamente (art. 23).** Quem tem os perfis **Planejamento** ou **Agente de contratação** busca preços nas fontes oficiais e escolhe quais entram na cesta. **Gestor de contratos**, **Assessoria jurídica** e **Auditor** veem o resultado, sem alterar.

1. Na etapa 3, vá até **Consulta automática de preços**. A Ágora mostra o item de referência da cesta (item 1 do DFD) e preenche o **Termo de busca** e o **Código CATMAT/CATSER**. Ajuste-os se precisar.
2. Clique em **Buscar preços**. O servidor consulta o painel de preços, as contratações similares do último ano no PNCP e as notas fiscais eletrônicas. Em obras e serviços de engenharia, consulta também o Sinapi ou o Sicro.
3. A tabela **Fontes consultadas pelo servidor** mostra, para cada fonte:
   - a situação: **Consultada**, **Sem resultado**, **Falhou**, **Depende de acesso** ou **Não se aplica**;
   - quantos preços vieram;
   - a proveniência: modo, data e hora e código do conteúdo recebido.
4. Em **Preços sugeridos**, cada preço traz:
   - a fonte, o valor, a data e o inciso do art. 23;
   - o registro de origem: compra, contratação no PNCP, nota fiscal ou código da tabela.

   Marque os que servem e clique em **Incluir N preços na cesta**. Eles entram na cesta com a fonte e o inciso, e a análise estatística é recalculada.
5. Em **Amostras descartadas**, veja o que a Ágora deixou de fora e por quê (por exemplo, contratação similar com mais de 1 ano).

A Ágora nunca põe um preço na cesta sozinha. Analise cada amostra: unidade, especificação e contexto da compra.

**Projetar o valor estimado.** Com os perfis **Planejamento** ou **Agente de contratação**:

1. Em **Projeção do valor estimado**, informe a **Data prevista da contratação** e a **Parcela do valor sujeita ao câmbio (%)**. Use 0 quando nada depender do dólar.
2. Clique em **Projetar valor**.

O resultado mostra:

- o valor estimado hoje, o valor projetado para a data prevista, a variação e a faixa provável;
- as premissas e a memória de cálculo;
- as fontes: IPCA do IBGE e dólar do Banco Central, com o período e a data da consulta.

A projeção é um sinal para a sua análise: **requer revisão humana** e não altera o valor estimado nem a cesta. Variação de 5% ou mais aparece como atenção, para avaliar se convém atualizar a pesquisa perto da divulgação do edital e conferir o índice de reajuste.

**Importar a tabela do Sinapi ou do Sicro.** O Sinapi (Caixa) e o Sicro (DNIT) não têm consulta automática: a tabela oficial é carregada no servidor. A importação cabe aos perfis **Administrador** e **Financeiro**, que executam integrações.

1. Abra um processo de obra ou serviço de engenharia na etapa 3 e clique em **Importar tabela do Sinapi ou do Sicro**.
2. Escolha o **Sistema**: Sinapi para as demais obras ou Sicro para infraestrutura de transportes.
3. Informe a **UF**, o **Mês de referência (data-base)** e se a tabela é **desonerada**.
4. Escolha o arquivo CSV ou cole o conteúdo. As colunas são código, descrição, unidade e preço.
5. Clique em **Importar tabela**. Uma linha com erro impede a importação, e a mensagem aponta a linha. A tabela da mesma UF, data-base e desoneração é substituída, e a importação fica na trilha de auditoria.

## 8. Limitações e o que depende de acesso externo

- **Conectores online.** Foram escritos sobre a especificação OpenAPI publicada das APIs:
  - dados abertos do Compras.gov.br e Portal da Transparência, conferidos em 08/11/2026;
  - SIDRA e SGS, cujo formato foi conferido com chamadas reais nessa data.

  Os testes usam `fetch` falso. Os conectores não foram exercitados contra os serviços reais com `AGORA_INTEGRACOES=online`. Os nomes de alguns campos de unidade compradora nos itens de contratações do PNCP foram inferidos; campos ausentes são tolerados.
- **Volume consultado.** Painel e contratações similares: uma página de até 100 registros por consulta. Notas fiscais: a primeira página da lista e até 5 notas do último ano detalhadas.
- **Código do catálogo.** Painel e contratações similares exigem o CATMAT/CATSER; sem o código, a fonte volta como **Sem resultado**, com orientação.
- **Notas fiscais.** Dependem de `AGORA_TRANSPARENCIA_CHAVE`. A cobertura é a das NF-e destinadas ao Poder Executivo federal. A base nacional completa depende de convênio.
- **Sinapi e Sicro.**
  - A importação aceita até 5.000 linhas (cerca de 900 KB) por lote; tabelas maiores precisam ser recortadas.
  - Só composições com preço: BDI e encargos não são tratados.
  - A busca é textual e exige ao menos metade das palavras do termo.
- **Projeção.**
  - É extrapolação da tendência dos últimos 12 meses, não previsão de mercado: as expectativas Focus não são usadas. O câmbio considera só o dólar.
  - A atualização automática de amostras antigas por índice (IN 65/2021, art. 5º, I e II) não foi feita: o agente decide.
- **Interface.** Mostra as sugestões da última consulta; as 5 últimas ficam disponíveis pela API.
- **Gate DLP da Fábrica.** Aponta `db_uri` em `apps/api/src/config.ts`. É a mensagem que mostra o formato esperado de `AGORA_BANCO_URL`, que já existia antes desta frente, e não um segredo.
