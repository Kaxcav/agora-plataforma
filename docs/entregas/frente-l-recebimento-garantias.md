# Frente L — Execução contratual como ato, parte 2 (F22): fiscalização, recebimentos, garantias e prazos de pagamento

## 1. O que foi feito

### F22 (parte 2) — Fiscalização (art. 117)

- **Designação** do gestor, dos fiscais técnico, administrativo e requisitante e dos membros da **comissão de recebimento definitivo**, com o ato (portaria no SEI), a data de início e, se for o caso, o substituto.
  - Uma designação nova substitui o titular anterior do mesmo papel; a anterior fica encerrada no histórico, com o motivo.
  - O servidor confere a **segregação de funções**: gestor e fiscal técnico não podem ser a mesma pessoa (art. 7º, § 1º; mesma regra da RN-03).
  - Só pode ser designado quem tem perfil de gestão ou de fiscalização e a UASG do contrato no escopo.
  - O gestor e o fiscal técnico titulares são espelhados nas colunas do contrato que o resto da Ágora já usa (central de notificações, achado "contrato sem fiscal", painel).
  - No contrato sem designação registrada, a primeira mudança importa o gestor e o fiscal do cadastro.
- **Livro de ocorrências** (art. 117, § 1º): tipo, data do fato, relato, providência determinada e prazo para regularização.
  - Com prazo, a contratada é **sempre notificada pela central da frente J** (e-mail e registro no processo SEI); sem prazo, a notificação é opcional.
  - O registro não aplica penalidade; a regularização fica anotada.
  - Só gestor ou fiscal designado no contrato registra.

### F22 (parte 2) — Recebimentos (art. 140; RN-34)

- **Prazos do contrato**: recebimento provisório, definitivo e correção em dias úteis; liquidação em dias úteis; pagamento em dias corridos, contado do recebimento definitivo ou da liquidação; índice e juros da atualização monetária; garantia técnica do objeto (meses). Contagem do art. 183.
- **Entregas da contratada**, com a nota fiscal ligada (opcional) e o prazo do provisório.
- **Termo provisório** pelo fiscal (ou gestor) designado; **termo definitivo** pelo gestor ou por membro da comissão, **nunca por quem lavrou o provisório** da mesma entrega.
- **Ressalva ou rejeição** exigem a descrição do desacordo, abrem o **prazo de correção ou substituição** (art. 140, § 1º, e art. 119), registram uma ocorrência no livro e notificam a contratada pela central J. Depois da correção, o mesmo exame é refeito.
- **Termos em PDF**, gerados no servidor pelo gerador de texto da Ágora (sem dependência nova). O SHA-256 do PDF fica no registro, e o PDF baixado depois confere com ele.
- **O definitivo libera a liquidação**: a nota fiscal ligada é atestada no mesmo ato, pelo **fluxo único de atesto** (`apps/api/src/modulos/financeiro/atesto.ts`), com o **recheque de regularidade da frente C** (RN-23) e a pendência quando há restrição. Enquanto a entrega não é recebida definitivamente, o atesto direto da nota na tela Pagamentos responde 409.
- **Garantia técnica do objeto** contada do definitivo (conversa, linha 1013).

### F22 (parte 2) — Garantias (arts. 96 a 102; RN-35)

- **Exigência** com percentual e base de cálculo (valor inicial ou, nos contínuos acima de um ano, o valor anual — art. 98, parágrafo único):
  - até 5% sem condição;
  - até 10% com justificativa da complexidade técnica e dos riscos;
  - até 30% só em obra ou serviço de engenharia de grande vulto, em seguro-garantia com cláusula de retomada (arts. 99 e 102);
  - **garantia adicional do pagamento antecipado**, até 100% do valor antecipado (art. 145, § 2º; conversa, linha 1008).
- A exigência abre **pendência** com o prazo de apresentação e **notifica a contratada** pela central J.
- **Apresentação**: modalidade escolhida pela contratada — caução em dinheiro ou em títulos da dívida pública, seguro-garantia, fiança bancária e **título de capitalização** (art. 96, § 1º, IV, incluído pela Lei 14.770/2023) —, valor, emissor, documento e validade. Valor menor que o exigido é recusado; validade que não cobre a vigência gera aviso (art. 97).
- **Alerta de vencimento pela central J**: a garantia de execução vigente é espelhada no contrato, e a varredura diária da frente J avisa 30 dias antes. Na apresentação ou renovação com validade já dentro dos 30 dias, o aviso sai na hora, **com a mesma chave de idempotência da varredura** (não duplica).
- **Renovação**, com endosso e complementação (recomposição) do valor.
- **Liberação** só depois da fiel execução (vigência encerrada, todas as entregas recebidas e nenhuma ocorrência aberta) ou da extinção por culpa exclusiva da Administração, sem multa por descontar; a **caução em dinheiro é restituída atualizada** pelo IPCA gravado no servidor (art. 100).
- **Execução** da garantia por decisão registrada da autoridade (art. 139, III): ressarcimento de prejuízos, verbas trabalhistas ou retomada pela seguradora. A contratada é notificada para recompor.
- **Desconto de multa** (art. 156, § 8º): por decisão registrada da autoridade (nome e cargo, ato, data e justificativa), o valor decidido é retido **primeiro dos pagamentos devidos** (notas atestadas ou liquidadas e não pagas), **depois da garantia**; o restante fica para cobrança judicial. A tela mostra o plano antes de confirmar; a contratada é notificada.

### F22 (parte 2) — Pagamentos

- **Tela Prazos de pagamento** (Financeiro): para cada parcela, o marco (recebimento definitivo, atesto das notas anteriores aos termos, ou liquidação), o limite de liquidação, o limite de pagamento e a situação (no prazo, vence hoje, vencido, pago no prazo, pago com atraso, aguardando o marco).
- **Atualização monetária estimada** das parcelas vencidas ou pagas com atraso (art. 92, V): correção pelo índice do contrato, pro rata die, desde o adimplemento, e juros simples pro rata die, com memória de cálculo. É apoio: confirmar que o atraso é imputável à Administração.
- **Alteração justificada da ordem cronológica** (art. 141, § 1º): hipótese (incisos I a V), justificativa, autoridade, ato e data; decisão posterior ao pagamento é recusada (não é prévia); comunicação posterior ao **controle interno** e ao **tribunal de contas**, com protocolo.
- **Ligação com a 2ª linha da frente H**: a alteração registrada aparece como **exceção justificada**; a nota preterida cujas notas pagas antes dela estão todas justificadas deixa de ser achado de risco e, sem as comunicações, vira achado de **atenção**.

### Ordem de serviço e reservas legais de cargos (art. 92, § 2º e XVII)

A frente K deixou estes dois pontos da F22 para esta parte (`docs/entregas/frente-k-alteracoes-contratuais.md`).

- **Período antecedente à ordem de serviço** (art. 92, § 2º): os prazos do contrato trazem o período, em dias úteis da assinatura, e a aba Recebimentos registra as **ordens de serviço**. A ordem expedida antes do fim do período fica marcada, com aviso para registrar a concordância da contratada.
- **Reservas legais de cargos** (art. 92, XVII; conversa, linha 1042): os prazos do contrato trazem o percentual de vagas para mulheres vítimas de violência doméstica exigido no edital (Decreto 11.430/2023, mantido na execução pelo art. 3º, § 2º) e se o edital exigiu vagas para pessoas presas ou egressas (Decreto 9.450/2018, 3% a 6% conforme o número de empregados, art. 6º). Na aba Fiscalização, o fiscal registra a **verificação mensal**: empregados no contrato, vagas ocupadas e a comprovação das cotas da empresa (pessoas com deficiência, Lei 8.213/1991, art. 93; aprendizes, CLT, art. 429). Com pendência, a verificação entra no livro de ocorrências; a providência é do fiscal.

### Registro de desempenho (art. 88, § 3º)

- Os atos da fiscalização alimentam os indicadores do IDC (RN-02, tabela `fornecedores_indicadores`): cada recebimento definitivo conta, e conta como aprovado quando a entrega não teve ressalva nem rejeição; cada ocorrência registrada conta, e a regularizada até o prazo conta como resolvida no prazo.

### Telas (RF-28)

- Contrato: abas **Fiscalização**, **Recebimentos** e **Garantias**.
- Financeiro: tela **Prazos de pagamento** (`/financeiro/prazos`), no menu Financeiro.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde |
|---|---|---|
| 67 e 208 | Termos de recebimento provisório e definitivo; controle de garantias | Abas Recebimentos e Garantias; RN-34 e RN-35 |
| 401 e 661 | Módulo 4: controle de vigências e garantias; registro de desempenho (art. 88, § 3º) | Garantias e alerta pela central J; recebimentos e ocorrências alimentam os indicadores do IDC (o certificado de atesto é de outra frente) |
| 715–725 | Gestor, fiscais técnico, requisitante e administrativo, com segregação | Aba Fiscalização; designações |
| 732 e 958 | Pagamento em ordem cronológica, contado do recebimento definitivo; prazo de liquidação | Prazos do contrato e tela Prazos de pagamento |
| 950 | Atualização monetária por atraso imputável à Administração | Atualização estimada (art. 92, V) |
| 982 | Prazos de recebimento provisório e definitivo, por comissão | Prazos do contrato; termo definitivo pelo gestor ou pela comissão |
| 1005–1010 | Garantia contratual, modalidades, prazo de apresentação; garantia adicional na antecipação | Exigência e apresentação; finalidade "antecipação" |
| 1011–1013 | Garantia técnica do objeto contada do recebimento definitivo | Prazos do contrato e coluna da entrega |
| 942 | Período antecedente à expedição da ordem de serviço (art. 92, § 2º) | Prazos do contrato e ordens de serviço |
| 1041 | Manter as condições de habilitação na execução | Recheque de regularidade no definitivo (frente C) |
| 1042 | Reservas de cargos e percentuais do Decreto 11.430/2023 na execução | Verificação mensal das reservas legais de cargos |
| 1104–1110 e 1236–1246 | Cockpit: ordem cronológica de pagamentos e validade das apólices; notificações | Prazos de pagamento, alteração da ordem e alerta de garantia |
| 1129 | Desconto da multa na garantia ou na fatura | Desconto de multa (art. 156, § 8º), com decisão humana |
| 1532 | RF-04.1: garantias, termos de recebimento, ordem cronológica | RF-28 |

## 3. Equivalentes lícitos adotados

- **"Desconto automático na garantia ou na fatura" (linha 1129).** O desconto não é automático: depende de decisão registrada da autoridade competente (regra 5; art. 156, § 8º). A Ágora só calcula o plano, na **ordem da lei** — pagamentos devidos, depois a garantia, depois cobrança judicial. Não é possível descontar da garantia o que os pagamentos devidos cobrem.
- **Pagamentos são do SIAFI.** A Ágora não paga nem liquida: o recebimento definitivo atesta a nota (libera a liquidação), e o prazo e a atualização são calculados para acompanhamento. A data da liquidação (`pagamentos.liquidado_em`) é carregada pela integração; na demonstração, pela carga sintética.
- **Notas anteriores aos termos.** Para notas atestadas antes do registro dos termos (dados legados), o marco do prazo é a data do atesto, indicada como tal na tela. Notas sem entrega ligada continuam podendo ser atestadas direto na tela Pagamentos, como antes; as ligadas a uma entrega só pelo termo definitivo.
- **Comunicação ao controle (art. 141, § 1º).** O controle interno passa a ver a alteração no painel da 2ª linha assim que é registrada; o envio oficial ao controle interno e ao tribunal de contas é feito fora da Ágora e registrado com o protocolo.
- **Índice da atualização.** A série disponível no servidor é o IPCA (frente I). Para outro índice no contrato (ex.: IPCA-E), a tela calcula só os juros e avisa que a série não está disponível.
- **Assinatura dos termos.** O PDF é o termo gerado pela Ágora, com hash; a assinatura formal é feita no processo SEI do contrato.
- **Reservas de cargos sem dado pessoal.** A condição de vítima de violência doméstica ou de egresso do sistema prisional é dado pessoal sensível (LGPD, art. 5º, II, e art. 11). A Ágora registra só as **quantidades** declaradas e a comprovação conferida pelo fiscal, nunca nomes ou documentos dessas pessoas; a documentação fica com a contratada e no processo.

## 4. Regras novas

- **RN-34** — Recebimento provisório e definitivo, liquidação e prazo de pagamento (`prazoRecebimentoProvisorio`, `avaliarTermoRecebimento`, `calcularGarantiaObjeto`, `calcularPrazoPagamento`, `calcularAtualizacaoMonetaria`, `corrigirPorIndice`).
- **RN-35** — Garantias contratuais e desconto de multa (`baseCalculoGarantia`, `avaliarPercentualGarantia`, `validarApresentacaoGarantia`, `situacaoGarantia`, `avaliarLiberacaoGarantia`, `atualizarCaucaoDinheiro`, `avaliarExecucaoGarantia`, `planejarDescontoMulta`, `validarDecisaoAutoridade`).
- **RF-28** — Execução do contrato: fiscalização, recebimentos, garantias e prazos de pagamento (`verificarDesignacoesContrato`, `validarOcorrencia`, `validarAlteracaoOrdemCronologica`, `classificarPreteridosComAlteracoes`, `avaliarOrdemServico`, `avaliarReservasCargos`). Telas `contratos.detalhe` e `pagamentos.prazos`.

Domínio: `packages/dominio/src/lei14133/execucao-contratual.ts` e `garantias.ts` (49 testes novos, mais 4 no catálogo). API: `apps/api/test/execucao-contratual.test.ts` (11 testes). E2e: `e2e/testes/execucao-recebimento-garantias.spec.ts` (4 cenários, com verificação axe).

## 5. Rotas novas (`/api/v1`)

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /contratos/:id/execucao` | `contratos:ler` | Dados das abas Fiscalização, Recebimentos e Garantias |
| `PUT /contratos/:id/parametros-execucao` | `fiscalizacao:designar` | Prazos de recebimento, liquidação e pagamento; índice e juros; garantia do objeto |
| `GET /contratos/:id/designaveis` | `fiscalizacao:designar` | Servidores que podem ser designados (só id, nome e perfis) |
| `POST /contratos/:id/designacoes` | `fiscalizacao:designar` | Designa gestor, fiscal ou membro da comissão (segregação conferida) |
| `POST /designacoes/:id/encerrar` | `fiscalizacao:designar` | Encerra a designação |
| `POST /contratos/:id/ocorrencias` | `fiscalizacao:registrar` | Ocorrência no livro (designado); notifica a contratada |
| `POST /ocorrencias/:id/regularizar` | `fiscalizacao:registrar` | Registra a regularização |
| `POST /contratos/:id/ordens-servico` | `fiscalizacao:designar` | Ordem de serviço, com o período antecedente |
| `POST /contratos/:id/reservas-cargos` | `fiscalizacao:registrar` | Verificação mensal das reservas legais de cargos (designado) |
| `POST /contratos/:id/recebimentos` | `recebimentos:registrar` | Entrega da contratada (designado) |
| `POST /recebimentos/:id/termos` | `recebimentos:registrar` | Termo provisório ou definitivo; o definitivo atesta a nota |
| `GET /recebimentos/termos/:id/termo.pdf` | `contratos:ler` | PDF do termo |
| `POST /contratos/:id/garantias` | `garantias:registrar` | Exigência (execução ou antecipação) |
| `POST /garantias/:id/apresentacao` | `garantias:registrar` | Apresentação pela contratada |
| `POST /garantias/:id/renovacao` | `garantias:registrar` | Renovação e complementação |
| `POST /garantias/:id/liberacao` | `garantias:registrar` | Liberação (art. 100) |
| `POST /garantias/:id/execucao` | `garantias:executar` | Execução por decisão da autoridade |
| `POST /sancoes/:id/descontos` | `garantias:executar` | Desconto de multa aplicada (art. 156, § 8º) |
| `GET /pagamentos/prazos` | `pagamentos:ler` | Prazos, situação e atualização estimada, com resumo |
| `GET /alteracoes-ordem` | `pagamentos:ler` | Alterações justificadas da ordem cronológica |
| `POST /pagamentos/:id/alteracoes-ordem` | `pagamentos:ordem_cronologica` | Registra a alteração (prévia) |
| `POST /alteracoes-ordem/:id/comunicacoes` | `pagamentos:ordem_cronologica` | Comunicação ao controle interno ou ao tribunal de contas |

Mudaram respostas existentes:

- `POST /pagamentos/:id/atestar` responde **409** quando a nota está ligada a entrega sem recebimento definitivo; o fluxo foi movido para `financeiro/atesto.ts`, usado também pelo termo definitivo.
- `GET /controle/segunda-linha`: exceções do tipo `ordem_cronologica`; achado de risco só para a nota preterida sem justificativa registrada.

**Permissões novas**, no fim de `TODAS_PERMISSOES`:

| Permissão | Perfis |
|---|---|
| `fiscalizacao:designar` | gestor de contratos, administrador |
| `fiscalizacao:registrar` | gestor de contratos, fiscal, administrador |
| `recebimentos:registrar` | gestor de contratos, fiscal, administrador |
| `garantias:registrar` | gestor de contratos, financeiro, administrador |
| `garantias:executar` | gestor de contratos (autoridade designada), administrador |
| `pagamentos:ordem_cronologica` | gestor de contratos, administrador |

Além da permissão, o servidor exige a **designação no contrato** para registrar ocorrências, entregas e termos.

**Migração:** `021_execucao_recebimento_garantias.sql` — `contratos_parametros_execucao`, `contratos_designacoes`, `contratos_ocorrencias`, `contratos_recebimentos`, `recebimentos_termos`, `contratos_ordens_servico`, `contratos_reservas_cargos`, `contratos_garantias`, `garantias_movimentos`, `multas_descontos`, `alteracoes_ordem_cronologica`, `alteracoes_ordem_comunicacoes` e a coluna `pagamentos.liquidado_em`.

**Carga sintética** (`apps/api/src/seed/execucao-contratual.ts`, PRNG próprio): prazos de todos os contratos, designação do gestor e do fiscal cadastrados, garantias registradas a partir das colunas do contrato, data de liquidação das notas liquidadas e pagas, três entregas aguardando o provisório e duas ocorrências. A conta **fiscal.tecnico@agora.demo**, usada no e2e, é criada pela carga da frente M.

**Ajustes em arquivos de outras frentes:** `notificacoes/servico.ts` (exporta `resolverDestinatarios` e `Destinatario`), `controle/paineis.ts` (achado e exceção da ordem cronológica), `controle/LinhasDefesa.tsx` (texto da seção de exceções) e `componentes/Dialogo.tsx` (a legenda de tabela deixa de receber o foco de refúgio, o que quebrava a estrutura ARIA da tabela).

## 6. Variáveis de ambiente

Nenhuma nova. Os avisos usam a configuração da central de notificações (frente J), e a atualização monetária usa a série do IPCA gravada pela integração de índices (frente I).

## 7. Seção pronta para o manual do usuário

> ## Execução do contrato: fiscalização, recebimentos e garantias
>
> No contrato, as abas **Fiscalização**, **Recebimentos** e **Garantias** registram os atos da execução. No menu **Financeiro**, a tela **Prazos de pagamento** acompanha o prazo de cada parcela.
>
> **Quem faz o quê:**
>
> - gestor de contratos: designa a equipe, define os prazos do contrato, registra as ordens de serviço, exige e acompanha garantias, registra o desconto de multa e a execução da garantia (como autoridade designada) e a alteração justificada da ordem cronológica;
> - fiscal de contrato: registra ocorrências, entregas, o recebimento provisório e a verificação das reservas de cargos;
> - gestor ou membro da comissão de recebimento: lavra o recebimento definitivo;
> - financeiro: registra a apresentação, a renovação e a liberação de garantias e acompanha os prazos de pagamento;
> - auditor, controle interno e consulta: consultam.
>
> Para registrar ocorrências, entregas e termos, além do perfil é preciso estar **designado no contrato**.
>
> ### Fiscalização
>
> 1. Na aba **Fiscalização**, clique em **Designar**.
> 2. Escolha o **Papel** (gestor, fiscal técnico, administrativo ou requisitante, ou comissão de recebimento definitivo), o **Servidor**, o **Ato de designação** e o **Início**.
> 3. Clique em **Registrar designação**. A designação nova substitui o titular anterior do mesmo papel.
>
> Gestor e fiscal técnico não podem ser a mesma pessoa. Para anotar um fato da execução, clique em **Registrar ocorrência**, descreva o fato e, se for o caso, informe a providência e o **Prazo para regularização**. Com prazo, a contratada é notificada por e-mail e no processo SEI. Quando a falha for corrigida, clique em **Regularizar**.
>
> ### Recebimentos
>
> 1. Confira os **Prazos do contrato**. O gestor pode clicar em **Alterar prazos**.
> 2. Quando a contratada entregar, clique em **Registrar entrega**, descreva a entrega, escolha a **Nota fiscal** (se já houver) e informe o valor e a data.
> 3. O fiscal clica em **Termo provisório**, escolhe o **Resultado** e clica em **Registrar termo**.
> 4. Depois, o gestor ou um membro da comissão clica em **Termo definitivo**. Quem lavrou o provisório não pode lavrar o definitivo.
>
> Com **ressalva** ou **rejeição**, descreva o que está em desacordo: a contratada recebe o prazo para corrigir ou substituir, e a ocorrência entra no livro. O termo definitivo aceito **atesta a nota fiscal** ligada, depois da nova consulta de regularidade do contratado, e o prazo de pagamento começa. Cada termo tem o seu PDF na coluna **Termos**.
>
> Na seção **Ordens de serviço**, o gestor registra o número, a data e o que cada ordem autoriza. Se o contrato prevê um período antes da ordem de serviço, a ordem expedida antes do fim desse período fica marcada.
>
> ### Reservas legais de cargos
>
> Todo mês, na aba **Fiscalização**, o fiscal clica em **Registrar verificação** e informa a competência, os empregados alocados no contrato, as vagas ocupadas por mulheres vítimas de violência doméstica e por pessoas presas ou egressas, e se a empresa comprovou as cotas de pessoas com deficiência e de aprendizes. Os percentuais exigidos vêm do edital, registrados nos prazos do contrato. Com pendência, a verificação entra no livro de ocorrências.
>
> ### Garantias
>
> 1. Clique em **Exigir garantia**, informe o percentual (até 5%; acima disso, justifique) e o **Prazo de apresentação**. A contratada é notificada.
> 2. Quando a contratada apresentar, clique em **Registrar apresentação** e informe a modalidade, o valor, a validade e o documento.
> 3. Antes do vencimento, use **Renovar**. Ao final da execução, use **Liberar**; a caução em dinheiro é devolvida com atualização.
>
> A Ágora avisa o gestor e o fiscal 30 dias antes da validade, pela central de notificações. Para descontar uma multa aplicada, em **Multas aplicadas** clique em **Descontar**: a tela mostra quanto sai dos pagamentos devidos, quanto sai da garantia e quanto fica para cobrança. Informe a autoridade, o ato e a justificativa e clique em **Registrar desconto**. A contratada é notificada para recompor a garantia.
>
> ### Prazos de pagamento
>
> A tela mostra, para cada parcela, a data que inicia o prazo, o limite para pagar e a situação. Nas parcelas vencidas, a coluna **Atualização estimada** traz o cálculo da correção e dos juros, que só são devidos se o atraso for da Administração.
>
> Para pagar uma nota fora da ordem cronológica:
>
> 1. Clique em **Alterar a ordem**.
> 2. Escolha a hipótese do art. 141, § 1º, e registre a justificativa, a autoridade e o ato, antes do pagamento.
> 3. Depois, em **Alterações justificadas da ordem cronológica**, registre a comunicação ao controle interno e ao tribunal de contas.
>
> O controle interno vê a alteração no painel da 2ª linha de defesa, entre as exceções justificadas.

## 8. Limitações e o que depende de acesso externo

- **Base legal conferida:** o texto do Planalto bloqueou o acesso automatizado (e o portal de legislação da Presidência estava indisponível). Os arts. 96 a 102 e 140 foram conferidos pelo portal de licitações do TCU e o art. 141, § 1º, por fontes secundárias. Os arts. 92, 117, 119 e 156, § 8º, seguem o texto conhecido da lei. **Vale uma conferência humana no texto oficial**, sobretudo do art. 96, § 1º, IV (título de capitalização) e do art. 99.
- **Liquidação e pagamento** acontecem no SIAFI; a data da liquidação depende da integração (na demonstração, carga sintética).
- **Notificação ao emitente da garantia** quando se apura descumprimento (art. 137, § 4º): não há cadastro de contato de seguradoras e bancos; fica para a integração.
- **Publicação mensal da ordem cronológica e das justificativas** no portal (art. 141, § 3º): os dados estão registrados, mas a página de transparência não foi alterada nesta frente.
- **Garantia adicional da antecipação**: sem aviso automático de vencimento (o aviso usa a garantia de execução espelhada no contrato).
- O "contínuo" da base anual da garantia é inferido pela vigência acima de um ano (o cadastro do contrato não tem o campo).
- **Reservas de cargos:** os percentuais do Decreto 11.430/2023 (8%, com 25 colaboradores ou mais, e percentual menor admitido pelo Decreto 12.516/2025) e as faixas do Decreto 9.450/2018 (3% a 6%) foram conferidos em fontes secundárias; o percentual efetivo vem do edital e é informado no contrato. O arredondamento para cima precisa de confirmação.

### Pontos de ligação com as frentes K e M (não tratados aqui)

- **K (aditivos, prorrogação, reajuste e extinção):** a prorrogação deve chamar a renovação da garantia (`POST /garantias/:id/renovacao`) e a extinção, a liberação (`POST /garantias/:id/liberacao` com `extincaoCulpaAdministracao`) ou a execução. O acréscimo ou a supressão devem atualizar a garantia na mesma proporção, e o reajuste pode reaproveitar `corrigirPorIndice`.
- **M (IMR e conferência da nota fiscal):** já ligada na integração. O fluxo único de atesto (`registrarAtesto`, `apps/api/src/modulos/financeiro/atesto.ts`) aplica a trava da conferência (RN-36) e o valor a liquidar, tanto na tela Pagamentos quanto no termo definitivo. Sem a conferência liberada, o definitivo é registrado, a nota fica prevista e o aviso orienta a atestá-la depois da conferência. As glosas do IMR podem entrar no cálculo de `pagamentosDevidos` (desconto de multa) quando forem retenções da nota.
