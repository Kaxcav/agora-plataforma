# Frente E — Sala de disputa (F30, PoC-03)

Reservas usadas: migração `015`, regras **RF-22**, **RN-26** e **RIA-09**, porta e2e `3105`.

## 1. O que foi feito (F30)

A sala de disputa tem dois usos, conforme a decisão de equivalente lícito:

- **Simulação**, para treino e para a prova de conceito (PoC-03). Licitantes sintéticos dão lances determinísticos; o agente de contratação pode adiantar o relógio da simulação.
- **Acompanhamento da sessão oficial**, que para a administração federal acontece no Compras.gov.br. O servidor consulta os dados abertos da compra e do resultado, com proveniência, e o agente pode transcrever os lances do relatório oficial para os sinais.

### Domínio (`@agora/dominio`, funções puras e determinísticas)

| Arquivo | O que faz |
|---|---|
| `lei14133/disputa.ts` | Rito (RN-26): `validarModoDisputa` (art. 56, §§ 1º e 2º), `parametrosPadraoDisputa` e `validarParametrosDisputa` (IN SEGES/ME 73/2022, arts. 23 a 25; padrões citando a norma), `validarLance` (art. 57 e IN 73, art. 21, § 2º; lance intermediário do art. 56, § 3º), `calcularEstadoSessao` (abertura, prorrogação automática, fechamento iminente sorteado, lance final e fechado, encerramento, reinício e negociação, recalculados a partir dos eventos), `selecionarLicitantesFaixa` (faixa de 10% ou 3 melhores), `classificarOfertas` e `classificarSessaoDisputa` (ordem de registro para valores iguais, art. 60 por `aplicarDesempate` para empate sem lance, art. 59, III como sinal), `pontuarTecnicaEPreco` (art. 36, § 2º, peso técnico até 70%), `avaliarReinicioDisputa` (art. 56, § 4º), `verificarAcaoSessao`, `sorteioDeterministico`. |
| `lei14133/simulador-disputa.ts` | Licitantes sintéticos: perfis competitivo, lance tardio, robô, combinado e conservador; `proximoLanceSimulado`, `calcularEstadoSessaoSimulada`, `propostasIniciaisSimuladas`, `perfisCenarioSimulacao` (cenário "Conluio e robô de lances (PoC-03)"). |
| `lei14133/padroes-lances.ts` | RIA-09: `detectarPadroesLances` (intervalos regulares, reduções idênticas, alternância da melhor oferta entre dois licitantes, lances de mesmo valor) e `cruzarPadroesComVinculos` (reforço pelo sócio em comum da RIA-06). |
| `lei14133/ata-disputa.ts` | `redigirAtaSessaoDisputa`: ata em Markdown com parâmetros e fundamentos, participantes, cronologia, lances, classificação, desempate, negociação (art. 61, § 2º), sinais, fontes, premissas, data e "requer revisão humana". |

### API (módulo `disputa`)

- Sessões em `sessoes_disputa` (migração `015_sala_disputa.sql`): definição, participantes com chave anônima, eventos no relógio da sessão, semente, adiantamento do relógio, dados oficiais e ata.
- O estado é recalculado a cada leitura pelo domínio; a sala consulta `GET /sessoes-disputa/:id` a cada 2 segundos durante a etapa de lances (consulta periódica), e o cronômetro anda no navegador entre as consultas.
- Sigilo: durante a etapa de lances da simulação, participantes, lances e sinais aparecem como "Licitante N" (IN 73, art. 21, § 6º); o lance final e fechado fica oculto até o fim do prazo; a ata não é gerada enquanto há sigilo.
- Ao encerrar, a classificação substitui o registro da disputa do processo (`montarDisputa` + classificação da sessão), a ata é emitida e a trilha recebe `disputa.sessao.encerrar` e `processo.disputa.registrar`.
- Conector `integracoes/compras-gov-sessao.ts`: timeout de 15 s, 2 novas tentativas com espera exponencial, SHA-256 do conteúdo, quantidade de registros e hora; modo offline determinístico (padrão).
- Permissão nova `disputa:conduzir`, só para o agente de contratação (e o administrador). O planejamento não conduz a sessão (segregação, RN-03).

### Interface

- Página `/jornada/:id/disputa` (tela `jornada.disputa`): lista de sessões, criação (uso, critério, modo permitido pelo critério, cenário, participantes do cadastro, intervalo mínimo), sala com placar (cronômetro, melhor oferta, lances, prorrogações), comandos, quadro de participantes e de lances, sinais, classificação, dados oficiais, cronologia e ata.
- Botão **Abrir sala de disputa** na etapa 6 da jornada (única mudança nos arquivos da jornada).
- Tudo funciona só com teclado; regiões de tabela focáveis, cronômetro com `role="timer"` e mudanças de situação anunciadas em região `aria-live`.

### Seed e testes

- Seed `seed/disputa.ts`: sócio sintético em comum entre duas empresas sintéticas (Ária e Atlas), com semente própria, para a PoC-03. O par não disputa junto nenhum processo sintético.
- Domínio: `test/disputa.test.ts` e `test/padroes-lances.test.ts` (49 testes) e acréscimos em `test/catalogo-regras.test.ts`.
- API: `test/sala-disputa.test.ts` (11 testes): autorização, validação, sigilo, abertura, relógio, lance recusado e aceito, encerramento com sinais reforçados, negociação, registro no processo, trilha, escopo de UASG (404), acompanhamento offline e online com `fetch` falso.
- E2E: `e2e/testes/sala-disputa.spec.ts` (PoC-03 com 4 empresas, só com teclado, 4 verificações axe).

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Como foi atendido |
|---|---|---|
| 58, 190 | Sala de disputa eletrônica (modos aberto e fechado) | Simulação com os modos aberto, aberto e fechado, fechado e aberto e fechado (técnica e preço) |
| 63, 199, 1509 | Monitoramento em tempo real da sessão para conluio, robôs de lances, vínculos societários | RIA-09 sobre os lances da sala (intervalos regulares, reduções idênticas, alternância, lances iguais) cruzada com o sócio em comum (RIA-06); consulta periódica ao vivo |
| 263 | Sala de disputa com grafo do Sentinela detectando conluio, IP idêntico e vínculo societário | Sinais com evidências e reforço por vínculo; IP não (ver equivalentes lícitos) |
| 658 | Sala de disputa eletrônica no Módulo 3 | Página `/jornada/:id/disputa` |
| 687 | PoC-03: sessão de lances entre 4 empresas, duas com quadro societário cruzado | Cenário "Conluio e robô de lances (PoC-03)" e e2e com 4 empresas, duas com sócio em comum |
| 799–802 | Pregão eletrônico por menor preço ou concorrência por técnica e preço 70/30 | Critérios menor preço, maior desconto e técnica e preço com peso técnico padrão de 70% e máximo de 70% |
| 1117 | Desempate automático (art. 60, II) | `aplicarDesempate` no julgamento da sessão |
| 1479–1500 | RF-03.1 (sala e rito, modos aberto e fechado, técnica e preço até 70%), RN-03.1 (cascata do art. 60), RIA-03.1 (motor antifraude com QSA e IP) | RN-26, RF-22 e RIA-09 |
| 1817 | Etapa 6: sala de disputa eletrônica | Botão na etapa 6 e sala com registro do resultado |

## 3. Equivalentes lícitos adotados

1. **Sala própria de lances → simulação e acompanhamento.** Para a administração federal direta, a sessão pública oficial acontece no Compras.gov.br. A Ágora não recebe propostas nem lances de fornecedores. A sala simula a sessão para treino e PoC e acompanha a oficial com os dados abertos.
2. **Lances ao vivo da sessão oficial → dados abertos + transcrição.** A API de dados abertos (`https://dadosabertos.compras.gov.br`) expõe a compra (`/modulo-contratacoes/1.1_consultarContratacoes_PNCP_14133_Id`) e o resultado por item (`/modulo-contratacoes/3.1_consultarResultadoItensContratacoes_PNCP_14133_Id`), mas não os lances nem o andamento ao vivo da sessão. O agente pode transcrever os lances do relatório oficial (CNPJ; valor; data e hora) para obter os sinais RIA-09.
3. **IP idêntico e bots em tempo real → padrões de lances.** A Ágora não recebe IP de licitantes (e coletá-lo seria tratamento de dado pessoal sem base). O equivalente é o padrão dos lances: intervalos regulares e reduções idênticas indicam automação; alternância e lances iguais indicam possível cobertura. O lance automático parametrizado no próprio sistema é permitido (IN 73, art. 19), o que o sinal informa.
4. **IA que alerta sobre conluio → sinal, nunca decisão.** Todo sinal traz evidências, fundamento e "requer revisão humana"; não desclassifica, não impede e não constitui acusação. A oferta acima do valor estimado (art. 59, III) também é só sinal para o agente.
5. **Parentesco até 3º grau.** Fica com a frente F (vínculos informados). A sala usa `vinculosEntreLicitantes`, a mesma função do registro da disputa: o que a frente F acrescentar lá aparece na sala sem mudança.

## 4. Regras novas

| Regra | Título | Implementação |
|---|---|---|
| RN-26 | Rito da sessão de disputa: modos, lances, prorrogação, encerramento e julgamento | `validarModoDisputa`, `parametrosPadraoDisputa`, `validarLance`, `calcularEstadoSessao`, `classificarSessaoDisputa`, `avaliarReinicioDisputa`, `pontuarTecnicaEPreco`, `aplicarDesempate` |
| RIA-09 | Sinal de padrão de lances na sessão de disputa | `detectarPadroesLances`, `cruzarPadroesComVinculos` |
| RF-22 | Sala de disputa: simulação e acompanhamento da sessão oficial | `calcularEstadoSessaoSimulada`, `proximoLanceSimulado`, `redigirAtaSessaoDisputa` |

Parâmetros padrão e fundamento:

| Parâmetro | Padrão | Fundamento |
|---|---|---|
| Etapa aberta | 10 min (15 min no aberto e fechado) | IN 73/2022, art. 23, caput, e art. 24, caput |
| Prorrogação | 2 min por lance nos 2 min finais, sucessiva, inclusive intermediário | IN 73/2022, art. 23, caput e § 1º |
| Fechamento iminente | sorteado em até 10 min (sigiloso) | IN 73/2022, art. 24, § 1º |
| Lance final e fechado | até 5 min | IN 73/2022, art. 24, § 2º |
| Faixa e mínimo | 10% (20% com margem de preferência), mínimo de 3 ofertas | IN 73/2022, art. 24, §§ 2º, 4º e 6º, e art. 25 |
| Reinício | diferença de ao menos 5% entre 1ª e 2ª | Lei 14.133/2021, art. 56, § 4º; IN 73/2022, art. 23, § 3º |
| Intervalo mínimo | conforme o edital | Lei 14.133/2021, art. 57; IN 73/2022, art. 22, § 1º |
| Peso técnico | 70% (máximo) | Lei 14.133/2021, art. 36, § 2º |

## 5. Rotas novas

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /processos/:id/sessoes-disputa` | `jornada:ler` | Lista as sessões do processo |
| `POST /processos/:id/sessoes-disputa` | `disputa:conduzir` | Cria a sessão (etapa 6) |
| `GET /sessoes-disputa/:id` | `jornada:ler` | Estado da sessão (consulta periódica da sala) |
| `GET /sessoes-disputa/:id/ata` | `jornada:ler` | Ata (prévia até a conclusão; nunca durante os lances) |
| `POST /sessoes-disputa/:id/abertura` | `disputa:conduzir` | Abre a sessão simulada |
| `POST /sessoes-disputa/:id/relogio` | `disputa:conduzir` | Adianta o relógio da simulação (1 minuto ou até o fim da etapa) |
| `POST /sessoes-disputa/:id/lances` | `disputa:conduzir` | Lance de treino em nome de um participante (422 `LANCE_RECUSADO`) |
| `POST /sessoes-disputa/:id/lances/transcricao` | `disputa:conduzir` | Lances transcritos da sessão oficial |
| `POST /sessoes-disputa/:id/sincronizacao` | `disputa:conduzir` | Consulta o Compras.gov.br no servidor (503 se indisponível) |
| `POST /sessoes-disputa/:id/reinicio` | `disputa:conduzir` | Reinício da disputa aberta, com justificativa |
| `POST /sessoes-disputa/:id/negociacao` | `disputa:conduzir` | Negociação com o primeiro colocado |
| `POST /sessoes-disputa/:id/encerramento` | `disputa:conduzir` | Ata definitiva e registro da disputa no processo |

Toda escrita é transacional e auditada (`disputa.sessao.criar`, `.abrir`, `.relogio`, `.reiniciar`, `.negociar`, `.sincronizar`, `.encerrar`, `disputa.lance.registrar`, `disputa.lances.transcrever` e `processo.disputa.registrar`).

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_COMPRAS_GOV_URL` | `https://dadosabertos.compras.gov.br` | Base da API de dados abertos do Compras.gov.br, validada como URL. Usada só com `AGORA_INTEGRACOES=online`. |

`AGORA_INTEGRACOES` (já existente) decide entre a resposta simulada (offline, padrão) e a consulta real.

## 7. Seção pronta para o manual do usuário

### Sala de disputa

A sala de disputa fica na etapa 6 do processo, no botão **Abrir sala de disputa**. Ela tem dois usos:

- **Simulação**, para treinar o rito da sessão pública e para a prova de conceito. As empresas dão lances sintéticos, sempre os mesmos para a mesma sessão.
- **Acompanhamento da sessão oficial.** Para órgãos federais, a sessão pública acontece no Compras.gov.br. A Ágora traz a situação e o resultado da compra pelos dados abertos, consultados pelo servidor.

**Quem faz o quê.** O **agente de contratação** cria, conduz e encerra a sessão. Os demais perfis com acesso à jornada (planejamento, jurídico, gestor, auditor) acompanham a sala em modo de consulta. O administrador tem todas as permissões.

**Criar uma simulação.**

1. Em **Uso da sala**, escolha **Simulação (treino e PoC)**.
2. Escolha o **Critério de julgamento** e o **Modo de disputa**. A Ágora só oferece os modos permitidos: na técnica e preço, só o fechado (art. 56, § 2º); no menor preço e no maior desconto, o fechado isolado não é permitido (art. 56, § 1º).
3. Escolha o **Cenário da simulação**. O cenário **Conluio e robô de lances (PoC-03)** faz duas empresas alternarem lances combinados e uma usar robô.
4. Inclua de 2 a 20 participantes pela busca do cadastro de fornecedores, ou use **Incluir os licitantes registrados no processo**.
5. Se o edital fixar intervalo mínimo entre lances, informe o percentual. Clique em **Criar sessão**.

**Conduzir a simulação.**

1. Clique em **Abrir sessão**. O cronômetro mostra o tempo restante da etapa de lances.
2. Durante os lances, as empresas aparecem como "Licitante 1, 2…", sem identificação, como no sistema oficial.
3. Use **Adiantar 1 minuto** ou **Avançar até o fim da etapa** para não esperar o tempo real. Um lance nos 2 minutos finais prorroga a etapa por mais 2 minutos.
4. Para treinar, registre um **Lance de treino** em nome de um participante. A Ágora recusa o lance que não melhora o último do próprio licitante ou que não respeita o intervalo mínimo, e mostra o motivo.
5. Encerrados os lances, a sala identifica as empresas e mostra a **Classificação e julgamento**. Se a primeira oferta for ao menos 5% melhor que a segunda, você pode **Reiniciar a disputa aberta** para definir as demais colocações. Também pode **Registrar negociação** com o primeiro colocado.
6. Clique em **Encerrar e registrar resultado**. A classificação passa para o registro da disputa da etapa 6, e a ata é emitida.

**Acompanhar a sessão oficial.**

1. Em **Uso da sala**, escolha **Acompanhar a sessão oficial** e informe o identificador da compra no Compras.gov.br.
2. Clique em **Consultar o Compras.gov.br**. A sala mostra a situação, os fornecedores do resultado, a hora da consulta e o código de verificação (hash) do conteúdo recebido.
3. Para analisar os lances, cole o relatório de lances em **Transcrever lances** (uma linha por lance: CNPJ; valor; data e hora).
4. Clique em **Encerrar e registrar resultado** para levar a classificação ao processo.

**Sinais para análise.** A sala aponta lances em intervalos regulares, reduções sempre iguais, alternância da melhor oferta entre duas empresas, lances de mesmo valor e sócio em comum. Quando o padrão envolve empresas com sócio em comum, o sinal aparece como **Reforçado por vínculo societário**. Todo sinal **requer revisão humana**: não desclassifica, não impede e não é acusação. A apuração é do agente de contratação, com contraditório.

**Ata.** Em **Ata da sessão**, clique em **Ver ata**. Antes do encerramento, é uma prévia; depois, a ata definitiva. A ata é um rascunho gerado a partir dos registros da sessão e deve ser revisada antes de ser juntada ao processo. Na simulação, ela informa que não substitui a sessão oficial.

## 8. Limitações e o que depende de acesso externo

- **Sessão oficial ao vivo:** os dados abertos do Compras.gov.br não trazem lances nem o andamento da sessão; o acompanhamento traz a compra e o resultado (fornecedor e valor homologado por item), e os lances só entram por transcrição.
- **Consulta online:** depende de acesso de saída do servidor a `dadosabertos.compras.gov.br` e de `AGORA_INTEGRACOES=online`. O formato das respostas foi conferido na documentação OpenAPI da API em novembro de 2026; os testes usam `fetch` falso.
- **Maior desconto no acompanhamento:** o resultado oficial é convertido em desconto equivalente sobre o valor estimado do processo.
- **Técnica e preço:** depois do registro, editar a disputa pela etapa 6 recalcula a classificação por menor preço (comportamento já existente do registro manual).
- **Exclusão de lance em 15 segundos** (IN 73, art. 21, § 3º) e **lance automático parametrizado** (art. 19) não são simulados: são ações do licitante no sistema oficial.
- **Negociação com os demais colocados** (art. 61, § 1º) depende da desclassificação do primeiro, que é decisão do agente fora da sala; a sala negocia com o primeiro colocado.
- **Atualização ao vivo** por consulta periódica (2 s), não por SSE.
- **Teste de acessibilidade** com axe nas telas da sala; o teste manual com leitor de tela não foi feito nesta frente.
- **Gates da Fábrica:** o `config.ts` já tinha, na mensagem de validação de `AGORA_BANCO_URL`, um exemplo de URL de banco com usuário e senha, que o DLP lê como URI de banco ao inspecionar o arquivo alterado. Foi criado `.fabrica-dlp-allow.json` com essa única exceção e o motivo; qualquer frente que mexa no `config.ts` encontraria o mesmo achado.
- **Arquivos compartilhados alterados** (só acréscimos no fim): `perfis.ts` (`disputa:conduzir`), `registro.ts`, `contratos/src/index.ts`, `catalogo-regras.ts` e o teste dele, `dominio/src/index.ts`, `web/src/app/rotas.ts`, índice do seed, `config.ts`, `web/src/sessao/permissoes.ts` (rótulo da permissão) e `autorizacao.test.ts` (a contagem de permissões do administrador passou a usar `TODAS_PERMISSOES.length`, para não conflitar com outras frentes).
