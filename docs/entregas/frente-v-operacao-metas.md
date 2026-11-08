# Frente V — Operação (F29) e painel das metas do ETP (F32)

Entrega da frente V do plano (`docs/PLANO-NOVAS-FUNCOES.md`, F29 e F32): autoescalonamento, homologação desligada fora do expediente, teste de carga reproduzível, medição de disponibilidade (IMR-01) e o painel que mede os resultados pretendidos do ETP contra as metas do órgão.

## 1. O que foi feito

### F29 — Operação (RNF-10)

**Kubernetes (`deploy/k8s/`)**

- `autoescalonamento.yaml`: três `HorizontalPodAutoscaler` (`autoscaling/v2`):

  | Carga | Mínimo | Máximo | Métrica | Devolução das réplicas |
  |---|---:|---:|---|---|
  | API (`agora`) | 2 | 6 | CPU 70% e memória 80% | 1 réplica a cada 2 min, depois de 5 min estável |
  | Trabalhador (`agora-trabalhador`) | 2 | 4 | CPU 70% | 1 réplica a cada 5 min, depois de 10 min estável |
  | OCR (`agora-ocr`) | 1 | 4 | CPU 65% | 1 réplica a cada 2 min, depois de 5 min estável |

  - Os pedidos e limites de recursos que o HPA usa já estão nos Deployments (`agora.yaml`, `fila-trabalhador.yaml` e `documentos-ocr.yaml`); o arquivo explica a relação.
  - Os mínimos respeitam os PodDisruptionBudgets e mantêm duas réplicas da API e do trabalhador.
- `homologacao-expediente.yaml`: desliga a homologação fora do expediente e a religa.
  - Dois `CronJob` com `timeZone: America/Sao_Paulo`: desligar às 20h e religar às 7h, de segunda a sexta. O horário é o campo `schedule` de cada um.
  - Os alvos ficam no ConfigMap `agora-expediente` (fila, API, trabalhador e OCR).
  - Ao desligar, o número de réplicas fica guardado numa anotação do próprio Deployment ou StatefulSet e é restaurado ao religar. Com réplicas em zero, o HPA fica inativo.
  - ServiceAccount com Role mínima (ler, anotar e escalar na própria namespace), contêiner sem root, sistema de arquivos só leitura e imagem do kubectl do registro do órgão.
- `agora.yaml` ganhou `AGORA_OPERACAO_SONDA_SEGUNDOS` no ConfigMap e a indicação da meta.

**Teste de carga reproduzível**

- Executor próprio em Node, sem dependência nova: `npm run carga -w @agora/api` (`apps/api/src/cli/carga.ts`).
  - Sem `--url`, sobe a Ágora no próprio processo (PGlite em memória, carga sintética, trabalhador embutido, integrações offline).
  - Com `--url`, mede um ambiente no ar (homologação), com a conta de `AGORA_CARGA_EMAIL` e `AGORA_CARGA_SENHA`.
- Cenários:
  - **listagens**: processos, contratos, fornecedores, atas e painel;
  - **jornada**: autuação, DFD e consulta do processo;
  - **publicação pela fila**: cada operação publica um processo diferente no PNCP (simulado) e espera a primeira execução do trabalhador;
  - **upload de documentos**: PDF sintético, conferido e gravado pelo servidor.
- Os volumes de referência vêm de `deploy/carga/carga.json`, ou de outro arquivo com `--config` ou `AGORA_CARGA_CONFIG`, e podem ser sobrepostos por `AGORA_CARGA_PROCESSOS_ANO`, `AGORA_CARGA_DOCUMENTOS_ANO` e `AGORA_CARGA_USUARIOS_SIMULTANEOS`. O arquivo do repositório tem **valores sintéticos**.
- A vazão exigida no pico é calculada pelo domínio (`dimensionarCarga`); os percentis, por `estatisticasLatencia`.
- Relatório gerado em `docs/operacao/teste-carga.md`: ambiente, volumes, memória de cálculo, vazão medida × exigida, p50/p95/p99 contra o limite configurado e situação de cada cenário. Na execução desta entrega, os quatro cenários atenderam, sem erros.

**Medição de disponibilidade (IMR-01)**

- **Sonda no servidor** (`apps/api/src/modulos/operacao/sonda.ts`), a cada `AGORA_OPERACAO_SONDA_SEGUNDOS` (padrão 60), no processo da API. Verifica:
  - a API (o processo respondeu);
  - o banco, com a latência;
  - a fila de integrações: transporte conectado e nenhuma tarefa pronta parada há mais de `AGORA_OPERACAO_FILA_ATRASO_MINUTOS`;
  - a última sincronização com o PNCP: não falhou e, se configurado, não está mais velha que `AGORA_OPERACAO_SINCRONIZACAO_ATRASO_HORAS`;
  - tarefas do PNCP aguardando nova tentativa, que marcam a janela de manutenção do PNCP detectada pela fila.
- Sondagens seguidas com o mesmo resultado viram um intervalo (`operacao_sondagens`), o que mantém a tabela pequena. Com várias réplicas, uma estende o intervalo da outra. Se o banco cai, as sondagens ficam na memória e são gravadas quando ele volta.
- **Relatório mensal** (`calcularDisponibilidade`): minutos considerados, disponíveis, indisponíveis e sem sondagem, percentual por componente, ocorrências e janelas do PNCP, com as tarefas absorvidas pela fila e as que foram para a fila de erro. Exportação em CSV, dia a dia.
- **Janelas de manutenção do PNCP**: registradas pelo administrador ou detectadas pela fila (`detectarJanelasPncp`).
- **Tela Operação** (`/operacao`), descrita no item 7.

### F32 — Painel das metas do ETP (RF-39)

Tela **Resultados e operação › Metas do ETP** (`/metas-etp`), com filtro por UASG e período (padrão: 12 meses até hoje) e exportação em CSV. O servidor mede no escopo de UASG do usuário.

- **(a) Tempo de instrução da fase preparatória por etapa** (`medirTempoInstrucao`):
  - calculado pela trilha de auditoria: a autuação abre a etapa 1 e cada `processo.avancar` abre a seguinte;
  - conta a permanência de cada etapa da instrução (etapas 1 a 4: DFD, instrução e equipe, ETP com riscos e preços, TR com edital e minuta) cuja saída caiu no período;
  - mostra, por etapa e para a fase: processos medidos, média, mediana, **linha de base**, **alvo** (linha de base reduzida pela meta), redução obtida e situação.
- **(b) Erros formais barrados pelas travas** (`avaliarMitigacaoTravas`):
  - cada bloqueio aplicado vira o evento `trava.bloqueio` na trilha, com as regras, a UASG, a etapa e quem tentou o ato;
  - travas ligadas:
    - RN-04 e as demais travas de avanço de etapa;
    - RN-01, na geração de minuta com item de luxo sem justificativa;
    - RN-06 e RN-21, na aprovação de documento;
    - RF-15, na publicação sem parecer favorável;
    - RN-09 (CEIS/CNEP) e RN-30, na assinatura do contrato;
    - RN-09, na prorrogação;
  - mostra bloqueios, processos afetados, erros que passaram e a mitigação = bloqueios ÷ (bloqueios + erros que passaram). Os erros que passaram são os contratos gerados pela jornada sem a consulta prévia ao CEIS/CNEP registrada;
  - contagem por regra e por ponto da jornada.
- **(c) Economia** (`medirEconomia`):
  - diferença entre o valor estimado (DFD e cesta de preços) e o valor do contrato gerado ou, sem contrato, da proposta homologada; por processo e no total, ponderada pelo valor;
  - **à parte**, o efeito dos expurgos da cesta (`efeitoExpurgosCesta`): a média com e sem as cotações descartadas e a diferença projetada na quantidade do item de referência.
- **O painel diz o que mede e o que não mede**, em cada indicador. A economia **não é atribuída à IA** nem a nenhuma ferramenta, e o efeito dos expurgos não se soma a ela.
- **Configuração das metas** pelo órgão (botão **Configurar metas**, permissão `metas:configurar`): redução do tempo (%), linha de base de cada etapa (dias), mitigação mínima (%) e economia mínima (%). Ficam na tabela `metas_etp`, são validadas no domínio (`validarMetasEtp`) e a alteração vai para a trilha com o antes e o depois.

**Auxiliar único das travas** (`apps/api/src/compartilhado/travas.ts`):

- o ponto de bloqueio marca o erro com `travaAplicada(alvo, erro)` ou envolve a verificação existente com `comTrava(alvo, () => ...)`;
- o gancho `onError` da API grava o evento numa transação própria, depois que a transação da ação foi desfeita e antes da resposta 422;
- cada ponto de bloqueio mudou em uma linha: `jornada/rotas.ts` (gerar, aprovar, publicar, avançar e contratar) e `regularidade/rotas.ts` (prorrogação).

## 2. Linhas da conversa atendidas

| Linha | Pedido | Onde está |
|---|---|---|
| 341 | Dimensionamento para o volume anual de processos e de documentos | Teste de carga: volumes configuráveis, vazão de pico por cenário |
| 421–429 | Demonstrativo dos resultados pretendidos (art. 18, § 1º, IX): tempo de instrução, erros formais e economia | Painel das metas do ETP (RF-39) |
| 464 | TI verde: autoescalonamento e desligamento da homologação fora do expediente | `autoescalonamento.yaml` e `homologacao-expediente.yaml` |
| 573 | Atraso ou queda do SLA como risco da execução contratual | Medição contínua de disponibilidade e relatório mensal |
| 734–760 | IMR-01: disponibilidade da plataforma e da sincronização PNCP, pela fórmula dos minutos | Sonda, `calcularDisponibilidade`, relatório mensal e CSV |
| 1697 | RNF-04: alta disponibilidade e fila que absorve as janelas de manutenção do PNCP | Janelas registradas e detectadas, tarefas absorvidas pela fila; HPA e PDB |

Os valores numéricos da conversa (metas, volumes e o percentual do IMR) **não estão no código**. As metas são configuradas pelo órgão na tela de metas; a meta de disponibilidade, em `AGORA_OPERACAO_META_DISPONIBILIDADE`; os volumes, no arquivo de carga. O seed e `deploy/carga/carga.json` usam valores sintéticos.

## 3. Equivalentes lícitos adotados

| Pedido ao pé da letra | O que foi feito | Motivo |
|---|---|---|
| Economia "obtida pela IA" e "saneamento automatizado" (429) | Economia medida como estimado × contratado; efeito dos expurgos à parte; o painel diz que não atribui a economia à IA | A economia tem várias causas, como mercado, competição e qualidade da estimativa. Atribuí-la à IA seria número sem base verificável (regra 5) |
| Glosa automática pelas faixas do IMR-01 | O relatório mede e indica a meta; a glosa fica com o fiscal do contrato | Glosa é ato do fiscal sobre a fatura, com contraditório. A plataforma não decide (regra 5) |
| Tempo de instrução "com IA" | Tempo medido pela trilha (avanços de etapa), sem separar ferramenta | O que se pode provar é o tempo entre atos registrados |
| "Mitigação de 100% dos erros formais" | Mitigação = bloqueios ÷ (bloqueios + erros que passaram), contra a meta que o órgão configurar | Só se conta o que a trava conhece; erro de mérito não é erro formal |

Premissa da disponibilidade (registrada no relatório e no manual): falha **só da sincronização** dentro de janela de manutenção do PNCP não conta contra a plataforma, porque a fila guarda e reenvia as transações (RNF-04). Minuto sem sondagem conta como indisponível. As duas premissas podem ser revistas pelo fiscal.

## 4. Regras novas

| Código | Título | Tela |
|---|---|---|
| RNF-10 | Operação sustentável e medição de disponibilidade (IMR-01) | `operacao` |
| RF-39 | Painel das metas do ETP (resultados pretendidos) | `metas` |

Funções do domínio, todas puras e testadas:

- `packages/dominio/src/lei14133/metas-etp.ts`: `medirTempoInstrucao`, `avaliarMitigacaoTravas`, `medirEconomia`, `efeitoExpurgosCesta`, `validarMetasEtp` e `situacaoMeta`;
- `packages/dominio/src/operacao/disponibilidade.ts`: `calcularDisponibilidade` e `detectarJanelasPncp`;
- `packages/dominio/src/operacao/carga.ts`: `dimensionarCarga` e `estatisticasLatencia`.

## 5. Rotas novas

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /api/v1/operacao/situacao` | `operacao:ler` | Última sondagem e situação de cada componente |
| `POST /api/v1/operacao/sondar` | `operacao:administrar` | Sondagem manual (auditada: `operacao.sondar`) |
| `GET /api/v1/operacao/disponibilidade?mes=AAAA-MM` | `operacao:ler` | Relatório mensal (IMR-01) |
| `GET /api/v1/operacao/disponibilidade.csv?mes=AAAA-MM` | `operacao:ler` | CSV dia a dia, com o mês e as janelas (auditada: `operacao.relatorio.exportar`) |
| `POST /api/v1/operacao/janelas` | `operacao:administrar` | Registra janela de manutenção do PNCP (auditada: `operacao.janela.registrar`) |
| `GET /api/v1/metas-etp?uasg&de&ate` | `metas:ler` | Painel das metas no escopo de UASG |
| `GET /api/v1/metas-etp/exportar.csv?uasg&de&ate` | `metas:ler` | CSV do painel (auditada: `metas.exportar`) |
| `GET /api/v1/metas-etp/configuracao` | `metas:ler` | Metas configuradas |
| `PUT /api/v1/metas-etp/configuracao` | `metas:configurar` | Altera as metas (auditada: `metas.configurar`, com antes e depois) |

Novo evento da trilha: `trava.bloqueio` (cada bloqueio aplicado por uma trava).

Permissões novas, no fim de `TODAS_PERMISSOES` e do tipo `Permissao`:

| Permissão | Perfis |
|---|---|
| `operacao:ler` | administrador; o auditor recebe pelas permissões de leitura |
| `operacao:administrar` | administrador |
| `metas:ler` | gestor de contratos, planejamento, controle interno e administrador; o auditor recebe pelas permissões de leitura |
| `metas:configurar` | administrador |

Migração `031_operacao_metas_etp.sql`: tabelas `operacao_sondagens`, `operacao_janelas_manutencao` e `metas_etp`, e o índice `auditoria_eventos (acao, ocorrido_em)` para as consultas do painel.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_OPERACAO_SONDA_SEGUNDOS` | 60 | Intervalo da sonda; 0 desliga a sonda periódica (fica a sondagem manual) |
| `AGORA_OPERACAO_FILA_ATRASO_MINUTOS` | 15 | Tarefa pronta parada há mais que isso deixa a fila indisponível |
| `AGORA_OPERACAO_SINCRONIZACAO_ATRASO_HORAS` | 0 (sem limite) | Idade máxima da última sincronização do PNCP com sucesso |
| `AGORA_OPERACAO_META_DISPONIBILIDADE` | sem meta | Meta de disponibilidade do contrato da plataforma (%), informada pelo órgão |
| `AGORA_CARGA_CONFIG` | `deploy/carga/carga.json` | Arquivo de volumes e parâmetros do teste de carga |
| `AGORA_CARGA_PROCESSOS_ANO`, `AGORA_CARGA_DOCUMENTOS_ANO`, `AGORA_CARGA_USUARIOS_SIMULTANEOS` | do arquivo | Sobrepõem os volumes de referência |
| `AGORA_CARGA_EMAIL`, `AGORA_CARGA_SENHA` | — | Conta de homologação para `npm run carga -- --url ...` |

## 7. Seção para o manual do usuário

### Metas do ETP

Perfis: gestor de contratos, planejamento, controle interno, auditor e administrador. Só o administrador altera as metas.

Em **Resultados e operação › Metas do ETP**, a Ágora mede os três resultados que o Estudo Técnico Preliminar promete no demonstrativo de resultados (art. 18, § 1º, IX):

- **Tempo de instrução:** quantos dias cada processo passou em cada etapa da fase preparatória, do DFD ao termo de referência. A tabela mostra o tempo atual, a **linha de base** (o tempo antes da plataforma, informado pelo órgão) e o **alvo** (a linha de base reduzida pela meta).
- **Erros formais barrados:** quantas vezes uma trava impediu um ato com erro formal. Exemplos: ETP sem os elementos obrigatórios, artigo de luxo sem justificativa, assinatura sem a consulta ao CEIS e ao CNEP. O painel também mostra se algum contrato foi gerado sem essa consulta.
- **Economia:** a diferença entre o valor estimado e o valor contratado, ou homologado enquanto não há contrato. Logo abaixo, à parte, aparece o efeito dos preços descartados da cesta: a média das cotações com e sem os descartes.

Cada indicador traz uma etiqueta: **Meta atingida**, **Meta não atingida**, **Sem meta** ou **Sem dados no período**. Também explica **o que mede e o que não mede**. A economia não é atribuída à IA: ela pode vir do mercado, da competição ou da qualidade da estimativa.

Use os filtros **UASG**, **De** e **Até** para mudar o recorte. O padrão é os últimos 12 meses, em todas as UASGs do seu escopo. **Baixar CSV** exporta o painel, e a exportação fica registrada na trilha.

Para configurar as metas (administrador):

1. Clique em **Configurar metas**.
2. Informe a **redução pretendida** do tempo de instrução (%) e a **linha de base** de cada etapa, em dias.
3. Informe a **mitigação mínima** de erros formais (%) e a **economia mínima** sobre o estimado (%).
4. Deixe em branco o que não tiver meta e clique em **Salvar metas**. A alteração fica na trilha de auditoria, com os valores anteriores.

### Operação

Perfis: administrador; o auditor só consulta.

Em **Resultados e operação › Operação**, a Ágora mostra se a plataforma está de pé e mede a disponibilidade do mês. É o indicador IMR-01 do contrato da plataforma.

- **Situação agora:** a última verificação da API, do banco de dados, da fila de integrações e da sincronização com o PNCP. Cada um aparece como **Disponível** ou **Indisponível**, com o detalhe. A verificação é automática, a cada minuto. **Sondar agora** força uma verificação.
- **Disponibilidade no mês:** os minutos considerados, os indisponíveis e os sem verificação, o percentual e a meta do contrato. Minuto sem verificação conta como indisponível. Escolha outro **Mês** para ver meses anteriores.
- **Ocorrências de indisponibilidade:** início, fim, duração e causa de cada queda.
- **Janelas de manutenção do PNCP:** as informadas pelo órgão e as detectadas pela fila, com as tarefas que a fila guardou e reenviou depois. Durante uma janela do PNCP, a falha só da sincronização não conta contra a plataforma.

Para registrar uma janela programada que o PNCP divulgou:

1. Clique em **Registrar janela do PNCP**.
2. Informe **Início**, **Fim** e **Descrição** e clique em **Registrar janela**. O registro fica na trilha de auditoria.

**Baixar relatório do mês (CSV)** traz a disponibilidade dia a dia, o total do mês e as janelas. O relatório mede; a glosa, se houver, é decisão do fiscal do contrato.

## 8. Limitações e o que depende de acesso externo

- **Kubernetes:** os manifestos não foram aplicados num cluster nesta entrega, porque não há cluster do órgão disponível. Dependem de metrics-server, da imagem do kubectl no registro do órgão e da namespace `agora-homologacao`. A sintaxe segue os manifestos existentes.
- **Teste de carga:** o relatório em `docs/operacao/teste-carga.md` foi gerado no modo em processo (PGlite em memória, uma máquina). Serve para comparar versões, não como capacidade da produção. O laudo do órgão sai rodando com `--url` contra a homologação (PostgreSQL e trabalhador separado), com os volumes reais do ETP no arquivo de carga.
- **Publicação no teste de carga:** usa cópias sintéticas do processo da etapa 5 da carga de demonstração e o PNCP simulado. Contra um ambiente no ar, publica só os processos publicáveis que encontrar.
- **Sonda:** mede de dentro do servidor. Queda total da rede entre o usuário e o órgão não aparece; para isso, use uma sonda externa do órgão em `/saude/pronto`. Os minutos sem verificação já contam como indisponíveis.
- **Janelas detectadas** dependem de haver tarefa do PNCP na fila no momento. Sem envio pendente, a manutenção do PNCP não é percebida, e também não afeta a plataforma.
- **Erros que passaram pelas travas:** hoje só se detecta o contrato gerado sem a consulta ao CEIS/CNEP registrada. Outras falhas formais descobertas depois, como em auditoria, não têm registro estruturado para entrar na conta.
- **Linha de base do tempo:** é informada pelo órgão. A plataforma não mede o tempo dos processos feitos antes dela.
