# Frente M — instrumento de medição de resultado e conferência da nota fiscal (F7)

Entrega da frente M: IMR configurável por contrato, medição periódica com evidência, glosa calculada com memória de cálculo e conferência da nota fiscal com trava no atesto. Base legal: Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A, como referência de IMR.

## 1. O que foi feito (F7)

### Domínio (`packages/dominio/src/lei14133/imr.ts`)

Funções puras, determinísticas e com testes (`packages/dominio/test/imr.test.ts`):

- `validarIndicadorImr`: confere e normaliza o indicador.
  - Toda faixa fica do lado de fora da meta, com limites distintos.
  - A glosa fixa não diminui quando o resultado piora.
  - Toda faixa tem efeito: glosa ou encaminhamento.
  - Percentuais e teto ficam entre 0 e 100.
- `calcularResultadoImr`: há duas formas de cálculo.
  - Percentual: numerador ÷ denominador × 100.
  - Valor medido: horas, ocorrências etc.
  - O resultado é arredondado a duas casas, e o valor arredondado é o comparado com a meta.
- `calcularAjustePagamento`: aplica a faixa mais severa alcançada.
  - Soma a glosa fixa e a glosa por unidade além do limite. A fração de unidade conta como unidade inteira.
  - Aplica o teto do indicador e o de 100%.
  - Com a base informada, devolve o valor em centavos.
  - Devolve a memória de cálculo, o fundamento e o aviso de que a glosa não é sanção.
- `medicaoImrDevida`: diz se a medição é devida na competência, pela periodicidade (mensal, bimestral, trimestral ou semestral) contada a partir da primeira competência.
- `conferirNotaFiscal` (RN-36):
  - valor devido = Σ preço contratado × quantidade recebida, menos a glosa do IMR;
  - cada glosa incide sobre os itens que o indicador alcança, e o total nunca passa do valor bruto;
  - aponta seis divergências: preço acima do contratado, quantidade cobrada maior que a recebida, quantidade acima do saldo do item, soma dos itens diferente do total, medição pendente e nota diferente do devido;
  - valor a liquidar = o menor entre a nota e o devido.
- `ehCompetencia` e `rotuloCompetencia`: utilitários de competência (AAAA-MM).

### Banco (`apps/api/migracoes/022_imr_conferencia_nota_fiscal.sql`)

- `imr_indicadores`: indicadores do IMR de cada contrato.
  - Campos: código, nome, forma e mecanismo de cálculo, rótulos do numerador e do denominador, unidade, sentido e valor da meta, periodicidade, primeira competência, fonte da medição, itens alcançados, faixas (JSON), teto e encerramento.
- `imr_medicoes`: uma medição por indicador e competência.
  - Guarda os dados informados, o resultado, a meta atingida ou não, a faixa, o percentual de glosa e o encaminhamento.
  - Guarda também a memória de cálculo, a evidência, a referência do documento e a pendência aberta.
- `conferencias_nota_fiscal`: uma conferência por parcela.
  - Dados da nota e itens, com a quantidade recebida.
  - Valor bruto, glosas, valor devido, diferença e valor a liquidar.
  - Divergências e memória de cálculo.
  - Situação (`conforme`, `divergente` ou `justificada`), justificativa e versão.

### API (`apps/api/src/modulos/imr/`)

- Configuração do IMR pelo gestor (`imr:configurar`):
  - o servidor valida o indicador pelo domínio;
  - os itens alcançados precisam ser do contrato, e a primeira competência precisa estar na vigência;
  - indicador com medição não é mais alterado: só encerrado a partir de uma competência, com justificativa, porque a mudança depende do contrato ou de aditivo.
- Medição pela fiscalização (`imr:medir`):
  - só em competência encerrada, com medição devida e ainda não registrada;
  - evidência obrigatória;
  - o servidor calcula o resultado e a glosa e grava a memória de cálculo;
  - faixa com encaminhamento abre pendência de alta prioridade para o gestor do contrato, com prazo de 10 dias úteis. Não instaura processo nem aplica sanção.
- Plano de gestão:
  - cada competência devida vira a tarefa "Registrar as medições do IMR — competência MM/AAAA", na macrotarefa "Fiscalização mensal", com o fiscal do contrato como responsável e prazo de 5 dias úteis após o fim do mês;
  - a tarefa é concluída sozinha quando todas as medições da competência estão registradas, e a da competência seguinte é criada.
- Recálculo: a medição registrada recalcula as conferências ainda não atestadas da mesma competência. Se o valor devido ou as divergências mudam, a justificativa anterior deixa de valer e a nota volta a "divergente".
- Conferência da nota (`pagamentos:conferir`):
  - registra ou corrige número, data de emissão, valor e itens;
  - a data de emissão não pode ser futura, e só a parcela ainda prevista é conferida;
  - o número conferido passa a identificar a parcela na fila e na busca de pagamentos.
- Justificativa da divergência (`pagamentos:conferir`): mínimo de 20 caracteres, só para conferência divergente. Fica na trilha.
- Atesto (`POST /pagamentos/:id/atestar`, rota que a frente C já tinha com o recheque de regularidade):
  - responde 422 (`RN-36`) se a conferência está divergente sem justificativa;
  - em contrato com IMR vigente na competência, responde 422 também sem conferência registrada;
  - a trava vem antes do recheque, para não consultar o CEIS/CNEP à toa, e é repetida dentro da transação;
  - com conferência, a parcela passa a valer o valor a liquidar, e o evento `pagamento.atestar` leva a conferência em `dados.conferenciaNota`.
- Todas as escritas são transacionais e geram evento na trilha encadeada:
  - `contrato.imr.indicador.criar`, `.alterar` e `.encerrar`;
  - `contrato.imr.medicao.registrar`;
  - `pagamento.conferencia.registrar`, `.recalcular` e `.justificar`.

O escopo de UASG é aplicado em todas as rotas: fora do escopo, a resposta é 404.

### Preparação: TR (etapa 4)

A seção "g) Critérios de medição e de pagamento" do termo de referência de serviços ganhou a estrutura do IMR (`apps/api/src/modulos/jornada/documentos.ts`):

- tabela com indicador, meta, mecanismo de cálculo, periodicidade e fonte, e faixas de glosa, com os valores "a definir";
- a regra do valor devido da nota fiscal.

### Interface

- **Contrato › aba "IMR e medições"** (`apps/web/src/paginas/contratos/AbaImrContrato.tsx`):
  - aviso de medições pendentes;
  - resumo com medições, na meta, com glosa e cumprimento das metas;
  - cartão de cada indicador, com meta, periodicidade, teto, mecanismo, fonte, base da glosa e faixas;
  - tabela das competências, com medições pendentes, glosa somada, link para a conferência da nota e a situação dela;
  - tabela das medições, com evidência e memória de cálculo;
  - diálogos para incluir, alterar e encerrar indicador (gestor) e para registrar a medição (fiscal).
- **Financeiro › Pagamentos**:
  - ação "Conferir nota" nas parcelas previstas;
  - a janela de atesto mostra "valor da nota × valor devido" e o valor a liquidar;
  - com a conferência bloqueando, o botão de confirmar fica desabilitado e o motivo aparece. O servidor recusa de qualquer modo.
- **Conferência da nota fiscal** (`/financeiro/pagamentos/:id/conferencia`, tela `pagamentos.conferencia`):
  - situação do atesto, dados da parcela e IMR da competência (glosas e medições pendentes);
  - resultado com valor da nota, valor devido, diferença e valor a liquidar, itens conferidos, glosas, divergências e memória de cálculo;
  - formulário da nota, com um grupo de campos por item do contrato, e formulário de justificativa.

### Perfis e permissões

| Permissão | Perfis |
|---|---|
| `imr:configurar` | Administrador, Gestor de contratos |
| `imr:medir` | Administrador, Gestor de contratos, Fiscal |
| `pagamentos:conferir` | Administrador, Gestor de contratos, Fiscal, Financeiro |

A leitura usa as permissões que já existiam: `contratos:ler` para a aba e `pagamentos:ler` para a conferência.

### Carga sintética (`apps/api/src/seed/imr.ts`)

- Conta nova de demonstração: `fiscal.tecnico@agora.demo` (Fiscal, todas as UASGs), com nome inventado.
- Escolha determinística de um contrato:
  - de preferência de serviço;
  - fora do escopo da conta `fiscal@`, porque outros testes atestam a primeira parcela prevista desse escopo;
  - sem restrição de regularidade e sem medida de controle externo.
- IMR do contrato:
  - IND-01, disponibilidade, percentual, mensal, desde três competências atrás: meta ≥ 97%; abaixo de 97%, glosa de 2,5%; abaixo de 93%, glosa de 7% e encaminhamento;
  - IND-02, prazo de atendimento, em horas, mensal, a partir da competência corrente: meta ≤ 6 h; 0,4% por hora além do limite, com teto de 4%.
  - Os valores são inventados e diferentes dos da conversa.
- Duas medições do IND-01:
  - uma dentro da meta (99,72%), com a nota conferida e conforme;
  - uma com glosa de 2,5% (95%), com a nota pelo valor cheio e a divergência justificada; a parcela foi liquidada pelo valor devido.
- A parcela da competência anterior fica prevista, com a tarefa de medição pendente no plano de gestão.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde está |
|---|---|---|
| 579 | Glosa automática no IMR como tratamento de risco | Glosa calculada pela faixa e aplicada no valor devido. "Automática" quer dizer calculada sem arbítrio; o atesto e a justificativa continuam humanos |
| 730–790 (758 e 790) | IMR do TR: indicador, meta, mecanismo de cálculo e faixas de ajuste no pagamento, inclusive "glosa + abertura de processo sancionatório", glosa por hora adicional e glosa por reincidência | Estrutura completa do indicador. A faixa por unidade cobre a hora adicional. A reincidência é um indicador de valor medido (ocorrências), com meta ≤ 1 e faixa acima disso. O encaminhamento sancionatório vira pendência para o gestor |
| 730–760 | Glosa sobre a fatura mensal, a OS, o item ou o valor mensal da sustentação | "Itens que formam a base da glosa": sem marcação, a nota inteira; com marcação, só os itens escolhidos |
| 732 (item 7.1) | Pagamento na ordem cronológica, com o IMR aplicado, depois do recebimento definitivo | A parcela atestada segue para liquidação pelo valor a liquidar, na fila do art. 141 que já existia. A ligação com o recebimento definitivo depende da frente L (seção 8) |
| 1403, 1453, 1482, 1525, 1575, 1620–1660 | Indicadores do IMR ligados aos módulos e fases do TR | O IMR é configurado por contrato, com código e nome livres, e pode medir qualquer entrega. O vínculo com módulos e fases fica no nome e na base da glosa (itens) |
| 1122 (RN-02) | "Nota média de IMR/SLA" no índice de desempenho | O resumo da aba mostra o percentual de medições na meta. A inclusão no IDC ficou como ponto de ligação (seção 8) |
| 1140 e 1143 | Risco de superfaturamento na medição; varredura de notas e medições | A conferência aponta preço acima do contratado, quantidade cobrada maior que a recebida e quantidade acima do saldo, em cada nota |
| 1802 (etapa 4) | IMR destacado no TR gerado | Estrutura do IMR na seção "g" do TR de serviços |

## 3. Equivalentes lícitos e decisões

| Pedido | O que foi feito | Por quê |
|---|---|---|
| "Glosa + abertura de processo sancionatório" (linha 754) | A faixa calcula a glosa e abre **pendência para o gestor avaliar** o encaminhamento. Não instaura processo nem registra sanção. | Sanção é decisão da autoridade competente, com contraditório e ampla defesa (arts. 157 e 158). Regra 5 do projeto. |
| "Glosa automática" | Cálculo determinístico, com memória de cálculo. A divergência entre a nota e o devido exige correção ou justificativa humana antes do atesto. | O atesto é ato do fiscal (art. 117). A glosa ajusta o pagamento e não é penalidade, por isso não depende de processo sancionatório. |
| Mudar o IMR no meio do contrato | Com medição registrada, o indicador só é encerrado (com justificativa) e outro é incluído. | Alterar critério de medição e pagamento depende do contrato ou de termo aditivo. Os aditivos são da frente K. |
| Atesto sem conferência | Fica livre em contrato sem IMR. Em contrato com IMR, é bloqueado. | Sem a conferência, a glosa da competência se perderia. Nos demais contratos, a conferência é recomendada, mas não muda o fluxo que já existia. |
| Nota maior que o devido | Com a justificativa, o atesto passa e a parcela fica pelo **valor a liquidar** (o menor entre a nota e o devido). | Nunca se paga acima do devido nem acima do que foi cobrado (arts. 140 e 141). |
| Valores do IMR | Os valores da carga são inventados, e o contrato define os seus. | Regra 3: a conversa dá a estrutura, não os valores. |

## 4. Regras novas no catálogo

- **RN-36 — Conferência da nota fiscal com o valor devido e o ajuste do IMR.**
  - Fundamento: Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A.
  - Telas: `pagamentos`, `pagamentos.conferencia` e `contratos.detalhe`.
  - Implementação: `conferirNotaFiscal` e `calcularAjustePagamento`.
- **RF-29 — Instrumento de medição de resultado (IMR) do contrato e medições periódicas.**
  - Fundamento: Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117 e 140; IN SEGES/MP 5/2017, anexo VIII-A.
  - Telas: `contratos.detalhe` e `pagamentos.conferencia`.
  - Implementação: `validarIndicadorImr`, `calcularResultadoImr`, `calcularAjustePagamento` e `medicaoImrDevida`.

## 5. Rotas novas

| Método e rota | Permissão |
|---|---|
| `GET /contratos/:id/imr` | `contratos:ler` |
| `POST /contratos/:id/imr/indicadores` | `imr:configurar` |
| `PUT /contratos/:id/imr/indicadores/:indicadorId` (só sem medições) | `imr:configurar` |
| `POST /contratos/:id/imr/indicadores/:indicadorId/encerrar` | `imr:configurar` |
| `POST /contratos/:id/imr/medicoes` | `imr:medir` |
| `GET /pagamentos/:id/conferencia` | `pagamentos:ler` |
| `POST /pagamentos/:id/conferencia` | `pagamentos:conferir` |
| `POST /pagamentos/:id/conferencia/justificativa` | `pagamentos:conferir` |

Rota alterada: `POST /pagamentos/:id/atestar` ganhou a trava da RN-36 e o ajuste do valor a liquidar.

Rota da interface: `/financeiro/pagamentos/:id/conferencia`.

## 6. Variáveis de ambiente

Nenhuma.

## 7. Seção pronta para o manual do usuário

> Sugestão de inclusão como subseção de "Contratos" e de "Pagamentos". Acrescente a conta `fiscal.tecnico@agora.demo` à lista de contas de demonstração.

### Instrumento de medição de resultado (IMR) e conferência da nota fiscal

O IMR mede, por indicadores objetivos, se o serviço foi entregue com a qualidade combinada. O pagamento é ajustado ao resultado (art. 6º, XXIII, "g"). Esse ajuste é a **glosa**: um desconto calculado pelas faixas do contrato. A glosa não é multa nem sanção.

**Quem faz o quê**

| Perfil | O que faz |
|---|---|
| Gestor de contratos | Configura os indicadores do IMR, registra medições, confere notas e avalia as pendências de encaminhamento sancionatório |
| Fiscal | Registra as medições com a evidência, confere a nota fiscal, justifica divergências e atesta |
| Financeiro | Confere a nota fiscal e justifica divergências antes da liquidação |
| Administrador | Tudo o que os perfis acima fazem |
| Demais perfis com acesso ao contrato | Consultam o IMR, as medições e as conferências |

**Configurar o IMR (gestor).** No contrato, abra a aba **IMR e medições** e use **Incluir indicador**. Informe:

- o código e o nome;
- a forma de cálculo: percentual (numerador ÷ denominador × 100) ou valor medido (horas, ocorrências);
- a meta e a periodicidade;
- a primeira competência medida e a fonte da medição;
- as **faixas de ajuste**. Cada faixa vale abaixo (ou acima) de um limite e pode ter:
  - glosa fixa;
  - glosa por unidade além do limite (por exemplo, por hora a mais);
  - encaminhamento para avaliar a abertura de processo sancionatório.

Se a glosa incidir só sobre alguns itens, marque-os em **Itens que formam a base da glosa**. Depois da primeira medição, o indicador não muda mais: use **Encerrar** e inclua um novo, se o contrato ou um aditivo previr a mudança.

**Registrar a medição (fiscal).** Quando o mês termina, a tarefa "Registrar as medições do IMR" aparece no plano de gestão do contrato.

1. Na aba **IMR e medições**, use **Registrar medição**.
2. Escolha a medição pendente e informe os números.
3. Descreva a **evidência**: relatório, sistema ou registro de onde vêm os números.

A Ágora calcula o resultado e a glosa e mostra a **memória de cálculo**. Se a faixa prevê encaminhamento, o gestor recebe uma pendência para avaliar o caso. A decisão de abrir processo é da autoridade competente.

**Conferir a nota fiscal (fiscal, gestor ou financeiro).** Em **Pagamentos**, use **Conferir nota** na parcela.

1. Informe o número, a data de emissão e o valor total da nota.
2. Para cada item, informe a quantidade recebida no período, a quantidade cobrada e o preço cobrado.

A Ágora compara o **valor da nota** com o **valor devido**: o preço contratado vezes a quantidade recebida, menos a glosa do IMR da competência. Ela também aponta:

- preço acima do contratado;
- quantidade cobrada maior que a recebida;
- quantidade acima do saldo do item;
- soma dos itens diferente do total;
- medição pendente.

**Atestar.** Enquanto a conferência estiver **Divergente**, o atesto fica bloqueado. Corrija a nota (registre-a de novo) ou escreva a **justificativa**, por exemplo: "glosa comunicada ao preposto e descontada na liquidação". Em contrato com IMR, o atesto também exige a conferência.

Na janela de atesto, você vê o valor da nota, o valor devido e o **valor a liquidar**: o menor entre os dois. A parcela segue para pagamento por esse valor. Medição, conferência, justificativa e atesto ficam na trilha de auditoria.

## 8. Limitações e o que depende de acesso externo

- **Recebimento definitivo (frente L).** A frente L ainda não estava na `integracao` quando esta frente começou. Até lá, a quantidade recebida é informada na conferência. O ponto de ligação está documentado:
  - `ContextoConferenciaNota.recebimentoDefinitivo` (hoje sempre `null`);
  - `calcularConferencia` e `situacaoAtestoConferencia`, em `apps/api/src/modulos/imr/servico.ts`.

  Quando a frente L juntar, a quantidade recebida deve vir do termo de recebimento definitivo da competência, e o atesto pode exigir esse termo. O saldo do item hoje desconta só as quantidades das notas conferidas na Ágora.
- **Evidência em arquivo.** A evidência da medição é a descrição obrigatória e a referência do documento (por exemplo, o número SEI). Anexar o arquivo pode reaproveitar o armazenamento seguro da frente D (`apps/api/src/armazenamento/`), mas aquele módulo está ligado a processos da jornada e não foi estendido aqui.
- **IMR no índice de desempenho (IDC, RF-13).** O resumo da aba mostra o percentual de medições na meta. Incluí-lo no `calcularIdc` muda a nota de todos os fornecedores e exige decidir o peso. Essa decisão fica para o usuário.
- **Sem acesso externo.** Nada desta frente chama sistema externo. O recheque de regularidade no atesto continua o da frente C.
