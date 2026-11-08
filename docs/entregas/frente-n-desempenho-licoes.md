# Frente N — Avaliação de desempenho do contratado (F3) e lições aprendidas (F6)

Reservas usadas: migração `023`, regras **RN-37**, **RF-30** e **RIA-12**, porta e2e `3114`.

## 1. O que foi feito

### F3 — Avaliação de desempenho do contratado (RN-37, RF-30)

**Domínio** (`packages/dominio/src/lei14133/avaliacao-desempenho.ts`, funções puras com "hoje" como parâmetro):

| Função | O que faz |
|---|---|
| `avaliarDesempenhoContratado` | Calcula a avaliação de um período (etapa ou conclusão) com os mesmos componentes e pesos do IDC (`calcularIdc`): pontualidade das entregas, recebimentos definitivos sem ressalva e ocorrências resolvidas no prazo, com desconto das sanções aplicadas no período. Exige período dentro da vigência e não futuro, motivação de 50 caracteres e ao menos uma entrega ou um recebimento aferido. Fixa o prazo de manifestação do contratado (5 dias úteis). |
| `situacaoAvaliacaoDesempenho` | Em prazo de manifestação, manifestada (discordância aguardando análise) ou definitiva (análise, concordância ou prazo decorrido). |
| `validarManifestacaoContratado`, `validarAnaliseManifestacao` | Manifestação dentro do prazo e análise motivada (mantida ou revista). |
| `consolidarRegistroDesempenho` | Nota do registro cadastral: avaliações definitivas com período encerrado nos últimos 36 meses; por contrato vale a final ou, sem ela, a parcial mais recente; média simples por contrato. Devolve a versão do registro (código que muda quando o registro muda). |
| `avaliarIncentivoDesempenho` | Critério objetivo do incentivo: certificado com nota de ao menos 90 (faixa diamante) e sem impedimento ou inidoneidade vigente; declaração com ao menos uma avaliação definitiva. Validade de 12 meses ou até o registro mudar. |
| `validarCriterioDesempenhoTecnica`, `comporNotaTecnicaComDesempenho`, `clausulaCriterioDesempenhoEdital` | Fórmula do edital: parte da nota técnica (1% a 100%) vem da nota do registro; quem não tem histórico recebe a nota fixada no edital; só na técnica e preço ou na melhor técnica, e com o regulamento indicado. |
| `simularImpactoDesempenho` | Simulador de impacto em editais futuros: empate desfeito pelo art. 60, II (`aplicarDesempate`) e técnica e preço com a nota composta (`pontuarTecnicaEPreco`). |
| `redigirDocumentoAvaliacaoDesempenho`, `redigirCertificadoDesempenho` | Documento comprobatório da avaliação (art. 88, § 3º) e certificado ou declaração, em Markdown, com protocolo ou código de verificação e fundamentos. |

**Ligações com o que já existia:**

- `faixaDaNota` (score.ts) passou a ser exportada, para que o registro use os mesmos selos do IDC (Diamante, Ouro, Prata, Em observação, Crítico e Sem histórico).
- **Desempate do art. 60, II, com a nota do registro, não digitada:**
  - `PUT /processos/:id/disputa` substitui a nota enviada pelo navegador pela nota do registro;
  - a etapa 6 mostra a nota do registro em vez do campo numérico;
  - a sala de disputa (frente E) grava a nota do registro em cada participante (`ParticipanteDisputa.notaDesempenhoPrevio`, `paraLicitante`) e a leva ao processo no encerramento.
- **Técnica e preço (art. 37, III, e art. 36, § 3º):**
  - na criação da sessão de técnica e preço, se o edital adotou a fórmula, a nota técnica de cada participante passa a ser a composta, e a composição fica guardada no participante;
  - a fórmula entra como cláusula no TR e no edital gerados.

**Banco** (`023_desempenho_licoes.sql`):

- `avaliacoes_desempenho`: registro cadastral, com protocolo `RCD-AAAA-NNNNNN`, documento, hash, manifestação, análise e versões anteriores;
- `certificados_desempenho`;
- `criterios_desempenho_edital`.

**Interface:**

- **Contrato → aba "Avaliação de desempenho":**
  - emitir, com a prévia das ocorrências e sanções do período;
  - registrar a manifestação do contratado e analisá-la;
  - baixar o documento em PDF.
- **Fornecedor → aba "Desempenho registrado":** nota do registro, histórico, emissão e download do certificado e da declaração em PDF.
- **Tela "Desempenho"** (menu Fornecedores, `/desempenho`): ranking pelo registro e simulador de impacto em editais futuros.
- **Etapa 4 → seção "Desempenho anterior na pontuação técnica"**, com a fórmula do edital.
- **Etapa 6 → coluna "Desempenho registrado (art. 60, II)"**, somente leitura.

### F6 — Lições aprendidas (RIA-12)

**Domínio** (`packages/dominio/src/lei14133/licoes-aprendidas.ts`):

| Função | O que faz |
|---|---|
| `derivarFatosExecucao` | Fatos sem digitação nova: aditivo de acréscimo acima de 15% do valor inicial (quantitativo); sanção aplicada no contrato (art. 155: incisos I a III → garantia, VII → prazo, demais → fiscalização); avaliação definitiva abaixo de 60 (fiscalização); rescisão assinada no registro das alterações contratuais da frente K (garantia). |
| `categoriaPadraoFato` | Categoria de cada tipo registrado pela fiscalização (atraso → prazo; glosa → níveis de serviço; rescisão → garantia; ocorrência → qualidade). |
| `termosObjeto`, `semelhancaObjeto` | Objeto semelhante: mesmo código do catálogo ou termos em comum (sem acentos, sem palavras vazias, plural reduzido), com ao menos 2 termos e 50% do menor conjunto. Explicável: devolve o motivo e os termos. |
| `sugerirClausulasLicoes` | Uma sugestão por categoria com cláusula prevista para o documento (DFD, ETP ou TR): prazos (cronograma e multa moratória), qualidade (amostra ou prova de conceito e critérios de aceitação), níveis de serviço (IMR), garantia (até 5%, majorável a 10%), quantidades (memória de cálculo) e fiscalização (modelo de gestão). Cada uma com as fontes (contratos e fatos), as premissas, a data e "requer revisão humana". |
| `secaoLicoesAceitas` | Seção do rascunho com as lições aceitas, a origem e quem decidiu. |

**Banco:**

- `ocorrencias_execucao`: ocorrências, glosas, atrasos e rescisões registrados pela fiscalização (art. 117), com a solução;
- `licoes_decisoes`: decisão do agente, com a sugestão guardada como foi apresentada.

**Interface:**

- **Contrato → aba "Ocorrências da execução":** registrar o fato e a solução, e ver os fatos derivados.
- **Painel "Lições aprendidas de contratos anteriores (RIA-12)"**, nas etapas 1 (DFD), 3 (ETP) e 4 (TR):
  - mostra as fontes;
  - tem os botões "Considerar no DFD/ETP/TR" e "Não considerar" (este exige motivo);
  - só o que foi aceito entra no rascunho seguinte do documento (`gerarModelo` → `anexarAoModelo`).
- **Mudança mínima nas telas da jornada:** uma importação e uma linha em cada etapa (1, 3 e 4), e a coluna da etapa 6.

### Seed (`apps/api/src/seed/desempenho.ts`, PRNG próprio, etapa no fim de `ETAPAS_SEED`)

- **Avaliações definitivas** dos fornecedores que disputam os processos sintéticos da jornada. As notas são exatamente as que a carga da jornada usou nessas disputas (Escudo 92, Rota 90, Guardião 88, Fortaleza 86, Boreal 85, Horizonte 71). Assim, o registro passa a ser a fonte delas, e os testes de jornada e de desempate continuam iguais.
- **27 ocorrências sintéticas** em contratos de coletes, viaturas, manutenção, rádios, pneus e munição.
- Fornecedores de outros cenários (PoC-03, rádios e Planalto, usado no e2e) ficam sem avaliação de propósito.

### Testes

- **Domínio:**
  - `test/avaliacao-desempenho.test.ts` (17 testes);
  - `test/licoes-aprendidas.test.ts` (9 testes);
  - acréscimos em `test/catalogo-regras.test.ts`.
- **API:** `test/desempenho-licoes.test.ts` (10 testes):
  - autorização e designação;
  - validações;
  - emissão, concordância e entrada no registro;
  - discordância e revisão com nova versão;
  - certificado e declaração por critério;
  - desempate com a nota do registro, mesmo com nota digitada;
  - simulador;
  - fórmula do edital no TR e na sala;
  - ocorrências com escopo de UASG;
  - lições no DFD, com decisão e rascunho.
- **E2E:** `e2e/testes/desempenho-licoes.spec.ts` (3 testes, 5 verificações axe).
- O passo do `jornada-completa.spec.ts` que digitava a nota passou a conferir a nota do registro (86).

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Como foi atendido |
|---|---|---|
| 886 | Desempate pelo desempenho contratual prévio, com os registros cadastrais de atesto (art. 60, II; art. 88, §§ 3º e 4º) | Nota do registro no `PUT /processos/:id/disputa`, na etapa 6 e na sala de disputa |
| 1113–1115, 1259 | Ranking com IDC de 0 a 100 e selos | Tela "Desempenho" (ranking pelo registro) com os selos do IDC; "Impedido" continua como etiqueta à parte (não é selo de desempenho) |
| 1116–1117, 1261–1263 | Simulador: empate no pregão vence a maior nota de desempenho atestado | Simulador de impacto em editais futuros (`POST /desempenho/simulacao`) |
| 1118, 1265 | Conversão do score em nota técnica (art. 37, III) | Fórmula configurável no edital (etapa 4), aplicada na sala de técnica e preço e no simulador |
| 1119, 1267 | Certificado de atesto de cumprimento de obrigações | Certificado de desempenho e declaração, em PDF, com critério objetivo (ver equivalentes lícitos) |
| 1120, 1269 | Base de conhecimento que sugere cláusulas mais rigorosas de SLA e amostras | RIA-12 no DFD, no ETP e no TR |
| 1122 | Nota só por indicadores objetivos (prazos, recebimento definitivo, IMR/SLA, ausência de sanções) | `avaliarDesempenhoContratado` com os indicadores do IDC; a motivação não altera a nota |
| 1776, 1921 | DFD mostra lições aprendidas de contratos anteriores ao escolher o objeto | Painel RIA-12 na etapa 1, consultado com o objeto e os itens salvos |
| 1827 | Certificado de atesto e Score alimentando a etapa 1 e a etapa 6 | Registro → desempate (etapa 6) e lições (etapa 1) |
| 799–802, 2304 | Técnica e preço 70/30 com desempenho anterior | Peso técnico até 70% (frente E) com a parte de desempenho na nota técnica |

## 3. Equivalentes lícitos adotados

1. **"Certificado Oficial de Atesto integrado ao PNCP", emitido automaticamente → registro com protocolo e certificado por critério objetivo.**
   - O art. 88, § 4º, condiciona a anotação à implantação e à regulamentação do cadastro de atesto.
   - O Manual de Integração do PNCP (versão vigente, consultada em 08/11/2026) não tem serviço para o registro cadastral nem para o atesto. As seções são: usuário, PCA, IRP, contratação, atas, contratos, empenhos, órgãos e suporte.
   - Por isso a avaliação fica no registro cadastral da Ágora com protocolo `RCD-AAAA-NNNNNN` e a situação "aguardando cadastro de atesto do PNCP".
   - Quando o serviço existir, o envio entra na fila de integrações da frente B: é um novo tipo de tarefa em `fila/`, com o protocolo já guardado.
   - O certificado é emitido a pedido do gestor e só quando o critério objetivo é atendido. Não é automático, porque emissão automática sem verificação do servidor contrariaria a regra de decisão humana nos atos.
2. **Score na pontuação técnica → só com fórmula no edital e regulamento indicado.**
   - O art. 36, § 3º, manda considerar o desempenho pretérito "observado o disposto nos §§ 3º e 4º do art. 88 desta Lei e em regulamento".
   - O TCU julgou irregular o uso sem regulamentação prévia, por ser norma de eficácia limitada (Acórdão 7695/2024-2ª Câmara).
   - A Ágora recusa a fórmula sem o regulamento, só a aceita na técnica e preço ou na melhor técnica e cita o regulamento no edital e no TR.
   - A nota de quem não tem histórico é fixada no edital, para não excluir quem nunca contratou com a Administração.
3. **Nota de desempenho digitada no desempate → nota do registro.** O navegador não define a nota: o servidor substitui o valor enviado pelo do registro.
4. **"IA" que sugere cláusulas → sinal determinístico com fontes, decisão humana.**
   - A semelhança é por código do catálogo ou por termos em comum, explicável.
   - Nada entra no TR sem o agente aceitar, e a recusa exige motivo.
   - As duas decisões ficam na trilha.
5. **Selo "Impedido" no ranking → etiqueta de sanção, não selo de desempenho.** Impedimento decorre de sanção aplicada em processo (art. 156), não da nota. O ranking usa os selos do IDC, e o certificado é negado a quem tem impedimento vigente.
6. **Manifestação do contratado.**
   - O fornecedor não tem acesso à Ágora. O gestor ou o fiscal registra a manifestação recebida por SEI, e-mail ou ofício, com a data de recebimento.
   - O prazo é de 5 dias úteis, a partir do art. 24 da Lei 9.784/1999 (5 dias, sem prazo específico na Lei 14.133), contado em dias úteis em favor do contratado.

**Base legal conferida:**

- O planalto.gov.br recusou o acesso automatizado.
- Os textos dos arts. 36, § 3º, 37, III, 87, caput, e 88, §§ 2º a 4º, foram conferidos no manual de licitações e contratos do TCU (licitacoesecontratos.tcu.gov.br, seções 3.4.4 e 5.9.5), que reproduz a lei.
- O art. 60, II, foi conferido em modeloinicial.com.br.
- Vale uma última conferência manual no Planalto.

## 4. Regras novas

| Regra | Título | Implementação |
|---|---|---|
| RN-37 | Avaliação de desempenho do contratado e registro cadastral de atestos | `avaliarDesempenhoContratado`, `situacaoAvaliacaoDesempenho`, `validarManifestacaoContratado`, `validarAnaliseManifestacao`, `consolidarRegistroDesempenho`, `avaliarIncentivoDesempenho`, `validarCriterioDesempenhoTecnica`, `comporNotaTecnicaComDesempenho`, `clausulaCriterioDesempenhoEdital`, `aplicarDesempate` |
| RF-30 | Avaliação de desempenho, histórico do fornecedor e certificado | `redigirDocumentoAvaliacaoDesempenho`, `redigirCertificadoDesempenho`, `simularImpactoDesempenho`, `rotuloFaixaDesempenho` |
| RIA-12 | Lições aprendidas da execução no DFD, no ETP e no TR | `sugerirClausulasLicoes`, `semelhancaObjeto`, `termosObjeto`, `derivarFatosExecucao`, `categoriaPadraoFato`, `secaoLicoesAceitas`, `rotuloCategoriaLicao` |

**Parâmetros:**

| Parâmetro | Valor | Fundamento ou motivo |
|---|---|---|
| Motivação mínima | 50 caracteres | Avaliação motivada (art. 88, § 3º) |
| Prazo de manifestação | 5 dias úteis | Lei 9.784/1999, art. 24 |
| Janela do registro | 36 meses | A mesma janela das sanções no IDC |
| Certificado | Nota ≥ 90, sem impedimento vigente | Art. 88, § 4º ("ótimo desempenho"); faixa diamante |
| Validade do certificado | 12 meses ou até o registro mudar | Art. 88, § 2º |
| Aditivo que vira lição | Acréscimo acima de 15% do valor inicial | Plano F6 |
| Avaliação que vira lição | Nota abaixo de 60 | Plano F6 |
| Semelhança mínima | 2 termos e 50% do menor conjunto, ou o mesmo código do catálogo | Explicável e determinística |

## 5. Rotas novas

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /contratos/:id/avaliacoes-desempenho` | `contratos:ler` | Avaliações do contrato e se o usuário pode avaliar |
| `GET /contratos/:id/avaliacoes-desempenho/previa` | `contratos:ler` | Ocorrências e sanções do período |
| `POST /contratos/:id/avaliacoes-desempenho` | `desempenho:avaliar` | Emite a avaliação (gestor ou fiscal designado; 422 RN-37 fora disso) |
| `POST /avaliacoes-desempenho/:id/manifestacao` | `desempenho:avaliar` | Registra a manifestação do contratado |
| `POST /avaliacoes-desempenho/:id/analise` | `desempenho:avaliar` | Mantém ou revisa (nova versão) |
| `GET /avaliacoes-desempenho/:id/documento.pdf` | `fornecedores:ler` | Documento da avaliação |
| `GET /fornecedores/:id/desempenho` | `fornecedores:ler` | Registro cadastral de desempenho |
| `POST /fornecedores/:id/certificados-desempenho` | `desempenho:certificar` | Certificado ou declaração (422 sem critério) |
| `GET /certificados-desempenho/:id/documento.pdf` | `fornecedores:ler` | PDF com código de verificação |
| `GET /desempenho/notas?fornecedores=` | `fornecedores:ler` | Notas do registro (etapa 6) |
| `GET /desempenho/ranking` | `fornecedores:ler` | Ranking pelo registro |
| `POST /desempenho/simulacao` | `fornecedores:ler` | Simulador (somente leitura) |
| `GET` e `PUT /processos/:id/criterio-desempenho` | `jornada:ler` / `jornada:editar` | Fórmula do edital (até a etapa 4) |
| `GET /contratos/:id/ocorrencias-execucao` | `contratos:ler` | Ocorrências e fatos derivados |
| `POST /contratos/:id/ocorrencias-execucao` | `licoes:registrar` | Registra a ocorrência |
| `POST /ocorrencias-execucao/:id/solucao` | `licoes:registrar` | Registra a solução |
| `GET /processos/:id/licoes-aprendidas?documento=` | `jornada:ler` | Sugestões do DFD, do ETP ou do TR |
| `POST /processos/:id/licoes-aprendidas/decisoes` | `jornada:editar` | Aceita ou recusa (com motivo), na etapa do documento |

**Trilha de auditoria.** Toda escrita é transacional e auditada. As ações registradas são:

- `desempenho.avaliacao.emitir`, `.manifestacao` e `.analisar`;
- `desempenho.certificado.emitir` e `desempenho.declaracao.emitir`;
- `execucao.ocorrencia.registrar` e `.solucionar`;
- `processo.licao.decidir` e `processo.criterio_desempenho.definir`.

**Permissões novas** (no fim de `TODAS_PERMISSOES`):

- `desempenho:avaliar`: gestor de contratos e fiscal;
- `desempenho:certificar`: gestor de contratos;
- `licoes:registrar`: gestor de contratos e fiscal.

O administrador tem todas.

## 6. Variáveis de ambiente

Nenhuma. Não há integração externa ativa: o cadastro de atesto do PNCP não tem serviço no manual.

## 7. Seção pronta para o manual do usuário

### Avaliação de desempenho do contratado

Ao final de cada etapa da execução, ou na conclusão do contrato, o **gestor** ou o **fiscal** designado avalia o desempenho do contratado (Lei 14.133/2021, art. 88, § 3º).

**Emitir a avaliação.**

1. Abra o contrato e a aba **Avaliação de desempenho**. Clique em **Emitir avaliação de desempenho**.
2. Escolha o momento: **final de etapa (parcial)** ou **conclusão do contrato (final)**. Informe o início e o fim do período.
3. Confira os **dados do período registrados na Ágora**: ocorrências da fiscalização e sanções aplicadas. Eles entram na nota sem digitação.
4. Informe as contagens aferidas nos termos de recebimento:
   - entregas no prazo e total de entregas;
   - recebimentos definitivos sem ressalva e total de recebimentos.

   Indique as **evidências** (os documentos que comprovam as contagens).
5. Escreva a **avaliação motivada** e clique em **Emitir avaliação**.

A Ágora calcula a nota com os mesmos indicadores do IDC e gera o documento em PDF, com o protocolo do registro. A motivação explica os fatos, mas não altera a nota.

**Manifestação do contratado.**

- O contratado tem **5 dias úteis** para se manifestar.
- Recebida a manifestação por SEI, e-mail ou ofício, clique em **Registrar manifestação do contratado** e informe se ele concorda.
- Se **discordar**, clique em **Analisar manifestação** e mantenha a avaliação ou revise as contagens, com motivação. A nota é recalculada e o documento ganha nova versão.
- Sem manifestação no prazo, a avaliação fica **definitiva**.

**Registro do fornecedor.**

- Só a avaliação **definitiva** entra na nota do registro. A aba **Desempenho registrado** do fornecedor mostra:
  - a nota do registro: média por contrato, nos últimos 36 meses;
  - o histórico das avaliações, com o PDF de cada uma.
- A nota do registro é usada no desempate do art. 60, II, e, quando o edital prevê, na pontuação técnica. Ela não é sanção, e a falta de avaliação não penaliza.
- O **IDC**, no alto da página do fornecedor, continua sendo o índice de acompanhamento da execução. A **nota do registro** é a das avaliações formais.

**Certificado e declaração (art. 88, § 4º).**

- Na aba **Desempenho registrado**, o **gestor de contratos** emite:
  - o **certificado de desempenho**, para quem tem nota do registro de ao menos 90 e nenhum impedimento vigente;
  - a **declaração de desempenho registrado**, para uso em licitações, para quem tem ao menos uma avaliação definitiva.
- Os dois valem 12 meses ou até o registro mudar. A etiqueta **Registro atualizado: renove** avisa quando é preciso emitir de novo.

**Envio ao PNCP.** O cadastro de atesto do PNCP ainda não tem serviço de integração. A avaliação fica no registro da Ágora, com protocolo, até lá.

### Desempenho de fornecedores e simulador

Em **Fornecedores → Desempenho**, qualquer perfil com acesso aos fornecedores vê o ranking pelo registro. No **Simulador de impacto em editais futuros**:

1. Marque dois ou mais fornecedores e clique em **Simular**. A Ágora mostra quem vence um empate no pregão pelo desempenho registrado (art. 60, II).
2. Para ver a técnica e preço, ligue **Simular também a técnica e preço**, informe a fórmula e o regulamento e simule de novo.

A simulação não registra nada.

### Desempenho na pontuação técnica do edital

Na etapa 4 da jornada, o **planejamento** ou o **agente de contratação** pode adotar o desempenho anterior na nota técnica. Isso só vale para a técnica e preço e a melhor técnica.

1. Informe a parte da nota técnica que vem do registro e a nota de quem não tem histórico.
2. Indique o **regulamento** que disciplina o critério. Sem ele a Ágora recusa, porque a lei exige regulamento (art. 36, § 3º).
3. Gere de novo o TR e o edital: a cláusula entra no rascunho.

Na sala de disputa de técnica e preço, a nota técnica de cada licitante passa a considerar a nota do registro.

### Desempate na etapa 6

A coluna **Desempenho registrado (art. 60, II)** mostra a nota do registro de cada licitante. Ela não é digitada: o servidor usa sempre a nota do registro.

### Ocorrências da execução e lições aprendidas

**Registrar ocorrências.** Na aba **Ocorrências da execução** do contrato, o **fiscal** ou o **gestor** registra ocorrências, glosas, atrasos e rescisões e, depois, a solução (no prazo ou fora dele). A aba também mostra os fatos que a Ágora deriva sozinha: aditivos acima de 15%, sanções aplicadas, avaliações abaixo de 60 e rescisões assinadas na aba de alterações do contrato.

**Lições aprendidas no DFD, no ETP e no TR.**

- Nas etapas 1, 3 e 4, o painel **Lições aprendidas de contratos anteriores** compara o objeto do processo com os contratos do órgão e sugere cláusulas mais rigorosas: prazos, amostras, níveis de serviço, garantia, quantidades e fiscalização.
- Cada sugestão mostra as **fontes** (quais contratos e fatos) e o aviso **requer revisão humana**.
- O responsável pela etapa (**planejamento** ou **agente de contratação**) clica em **Considerar no DFD/ETP/TR** ou em **Não considerar**, informando o motivo.
- A decisão fica na trilha. Só o que foi considerado entra no próximo rascunho do documento, com a origem.

## 8. Limitações e o que depende de acesso externo

- **Cadastro de atesto do PNCP:**
  - depende de regulamento e de serviço no Manual de Integração do PNCP (art. 88, § 4º);
  - até lá, fica o protocolo do registro na Ágora;
  - o desenho prevê o envio pela fila da frente B, sem mudar as tabelas.
- **Recebimentos (frente L):**
  - os recebimentos provisório e definitivo ainda não estavam na `integracao` quando esta frente foi unida;
  - por isso as contagens de entregas e de recebimentos são aferidas pelo avaliador nos termos de recebimento, com as evidências citadas;
  - as ocorrências e as sanções vêm dos registros;
  - **Ligação prevista:** quando a frente L estiver na `integracao`, `derivadosDoPeriodo` (`apps/api/src/modulos/desempenho/repositorio.ts`) passa a contar também os termos de recebimento do período, e o diálogo de emissão os mostra preenchidos.
- **Rescisões (frente K):** a base de conhecimento lê, só para consulta, as rescisões assinadas em `alteracoes_contratuais`. As registradas na aba de ocorrências continuam valendo.
- **Regulamento do desempenho pretérito na pontuação técnica:**
  - a Ágora exige que o edital cite o ato;
  - não confere se o ato existe nem se é válido; essa é a análise da assessoria jurídica.
- **Escopo do registro:** o registro cadastral é do órgão (art. 87).
  - A nota e o histórico resumido (contrato, período, nota) aparecem a todo perfil com acesso aos fornecedores, de qualquer UASG, para que o desempate seja igual para todos.
  - A emissão, a manifestação, a análise e as ocorrências respeitam o escopo de UASG do contrato.
  - A base das lições aprendidas usa só os contratos do escopo do usuário.
- **Semelhança de objeto:**
  - é por código do catálogo ou por termos em comum (plural simples);
  - sinônimos não são reconhecidos;
  - o agente confere se o contrato de origem é comparável.
- **Fórmula adotada depois da geração do TR:** a fórmula do edital fica em tabela própria, fora dos parâmetros do edital da etapa 4. Por isso a regra RN-06 não marca como desatualizado o TR ou o edital gerado antes da mudança. Gere de novo depois de mudar a fórmula; a tela avisa ao salvar.
- **Tarefa de avaliação no modelo de gestão de encerramento**, prevista no plano F3: não foi criada, para não alterar os modelos de gestão de outras frentes. A aba do contrato concentra a avaliação.
- **Arquivos compartilhados alterados** (só acréscimos no fim):
  - `perfis.ts`, `registro.ts`, `contratos/src/index.ts`, `catalogo-regras.ts` e o teste dele, `dominio/src/index.ts`;
  - `web/src/app/rotas.ts`, `navegacao.ts`, `web/src/sessao/permissoes.ts` e o índice do seed.
- **Mudanças mínimas em código de outras frentes:**
  - jornada: o PUT da disputa com a nota do registro; os anexos no `gerarModelo`; os campos opcionais `anexos` em `ContextoJornada` e `DadosDocumento`; uma linha nas etapas 1, 3 e 4; a coluna da etapa 6;
  - sala de disputa: a nota do registro e a composição técnica na criação da sessão, `definicaoDe` e `registrarResultadoNoProcesso`;
  - `score.ts`: exportação de `faixaDaNota`;
  - abas novas em `ContratoDetalhe.tsx` e `FornecedorDetalhe.tsx`;
  - um passo do `jornada-completa.spec.ts`.
