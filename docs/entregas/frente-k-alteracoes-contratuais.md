# Frente K — Execução contratual como ato, parte 1 (F22a)

Termo aditivo como ato registrado, com a trava do art. 125 (RN-32); prorrogação com os limites dos arts. 105 a 114
(RN-33); reajuste e repactuação por apostila, reequilíbrio econômico-financeiro e extinção do contrato, reunidos na aba
**Alterações** do contrato (RF-27). Migração `020_alteracoes_contratuais.sql`. Porta do e2e: 3111.

## 1. O que foi feito (F22a)

| Item | Entrega |
|---|---|
| Termo aditivo como ato (RN-32) | Ciclo completo: **proposta** com justificativa → **parecer jurídico** (art. 53, § 4º) → **assinatura** pela autoridade competente → **divulgação no PNCP** pela fila de integrações (frente B). Tipos: acréscimo e supressão quantitativa, alteração qualitativa (com ou sem reflexo no valor), prazo e reequilíbrio. O simulador `POST /contratos/:id/aditivos/simular` continua existindo para estudo. |
| Trava do art. 125 | `avaliarTermoAditivo` (domínio) soma acréscimos e supressões separadamente, sem compensação, sobre o valor inicial atualizado (valor inicial + reajustes e repactuações). Limite de 25%, ou 50% para acréscimos em reforma de edifício ou de equipamento. O reflexo financeiro da alteração qualitativa conta no limite. **Acima do limite a API recusa (422, detalhes `RN-32`) na proposta e de novo na assinatura**, com a linha do contrato travada na transação — duas propostas que cabem sozinhas, mas não somadas, não passam. |
| Assinatura auditada com o checklist da frente C | A assinatura chama `verificarRegularidade` (momento `assinatura`, ou `prorrogacao` no termo de prazo): nova consulta ao CEIS/CNEP e conferência das certidões; restrição bloqueia (422, `RN-09`). O termo assinado vai para o livro `aditivos` (que compõe o valor global) e fica ligado ao ato, com o número ("3º Termo Aditivo"), quem assinou, a data e a verificação. |
| Divulgação no PNCP (art. 94) | Nova tarefa `pncp.termo` na fila da frente B: `POST /v1/orgaos/{cnpj}/contratos/{ano}/{sequencial}/termos` com o `IncluirTermoContratoDTO` (campos conferidos na especificação OpenAPI pública do PNCP, `pncp.gov.br/api/pncp/v3/api-docs`). O prazo do art. 94 vale para o aditivo (20 dias úteis na licitação, 10 na contratação direta, contados da assinatura) e aparece em cada termo (`situacaoDivulgacaoTermoPncp`). Apostila e rescisão também são divulgadas, para transparência (art. 174), sem prazo de eficácia. Recusa do PNCP vai para a fila de erro; **Reenviar ao PNCP** reabre a tarefa. |
| Termo em PDF | `GET /contratos/:id/alteracoes/:alteracaoId/termo.pdf`, gerado pelo `pdf-texto.ts`: partes (CNPJ e nome de pessoa física mascarados), objeto, condições, travas conferidas, parecer, contraditório, decisão e a verificação de regularidade. |
| Prorrogação com travas (RN-33) | `avaliarProrrogacao`: contínuos até 10 anos contados do início, com previsão no edital, vantajosidade atestada pela autoridade e preço compatível (art. 107); TI estruturante até 15 anos (art. 114); receita até 10 ou 35 anos (art. 110); escopo predefinido com prorrogação automática quando o atraso é sem culpa do contratado e, com culpa, só com a mora constituída (art. 111); crédito orçamentário (art. 105). **A rota da frente C (`POST /contratos/:id/prorrogacoes`) foi estendida, sem duplicação**: confere a RN-33 antes da RN-09 e usa o mesmo serviço do termo de prazo (`efetivarProrrogacao`), que grava o livro, a vigência, o ato na aba Alterações e pede a divulgação. A natureza do contrato fica em `contratos.natureza_duracao` (a primeira prorrogação a registra, se faltar). |
| Alertas de 120 dias e de limite de prorrogação | Pela central da frente J: a varredura diária acrescenta ao aviso de vencimento do contrato (faixas de 120, 90, 60 e 30 dias, ao gestor e ao fiscal) a linha **"Prorrogação: …"** — prorrogação possível até tal data, próxima prorrogação limitada pela vigência máxima, **"não cabe nova prorrogação — inicie a nova licitação"**, ou o lembrete do escopo (`avaliarAlertaProrrogacao`). Sem aviso duplicado: é o mesmo aviso de vencimento, com o texto a mais. |
| Reajuste por apostila | `avaliarReajuste`: anualidade contada da data do orçamento estimado (`data_base_reajuste`), de 12 em 12 meses; **antes do aniversário é recusado (422)**; depois, o índice do contrato (variação informada pela autoridade, com a fonte) incide sobre o saldo a executar. Grava a apostila ("1º Apostilamento"), o ciclo em `reajustes_ciclos` e o livro (art. 136, I). |
| Repactuação (art. 135) | `avaliarRepactuacao`: só com dedicação exclusiva ou predominância de mão de obra; demonstração analítica por componente da planilha (mão de obra ou insumos), cada um com o interregno de 1 ano contado da sua data-base (§ 3º) e o documento que fundamenta (§ 6º); confirmação de que cláusulas coletivas não trabalhistas foram desconsideradas (§§ 1º e 2º). Impacto = variação mensal × meses de vigência a partir dos efeitos. Apostila. |
| Reequilíbrio (art. 124, II, "d") | Instrução: enquadramento (força maior, caso fortuito, fato do príncipe, fato imprevisível ou de consequências incalculáveis, tributo superveniente, alteração unilateral), risco da matriz de riscos do contrato (frente H), datas do evento e do pedido, sentido, valor e demonstração. **Risco alocado à contratada é vedado**, salvo tributo superveniente e alteração unilateral (art. 103, § 5º); pedido fora da vigência ou depois da prorrogação seguinte ao evento é recusado (art. 131, parágrafo único). Decisão: parecer jurídico → a autoridade **defere** (total ou parcialmente, com o valor reconhecido) ou **indefere**. Não conta no limite do art. 125; soma ao valor global. |
| Extinção (arts. 137 a 139) | Abertura motivada: unilateral só pelos motivos do art. 137, I a IX, nunca por falta da própria Administração (art. 138, I), com prazo de defesa e **notificação ao contratado pela central de notificações** (e-mail e SEI); consensual com interesse da Administração; judicial ou arbitral com a referência. Defesa registrada (ou ausência de manifestação depois do prazo). Decisão da autoridade: extinguir (data dos efeitos, culpa da Administração, efeitos do art. 139 ou direitos do art. 138, § 2º; ocupação do local exige autorização do ministro) ou arquivar. Extinto: vigência encerrada na data dos efeitos, `contratos.extinto_em`, propostas pendentes arquivadas, termo de rescisão em PDF e divulgado. |
| Tela (RF-27) | Aba **Alterações** no contrato (substitui a aba Aditivos): **Limites de alteração (art. 125)** com as barras de acréscimos e supressões frente ao limite e as margens; **Prorrogação e reajuste**; **Histórico de alterações** com termos aditivos, apostilas, reequilíbrios e extinção (inclusive os termos importados), situação, divulgação no PNCP e o detalhe de cada ato com os próximos passos; a seção de prorrogação da frente C, agora com as travas da RN-33; e o simulador. |
| Carga sintética | `seed/alteracoes.ts` (PRNG próprio): natureza de cada contrato (serviço licitado → contínuo; demais → escopo), regime de mão de obra dos contínuos e um acréscimo de 5% aguardando parecer. |
| Testes | Domínio: `test/alteracoes-contratuais.test.ts` (39) e o catálogo. API: `test/alteracoes-contratuais.test.ts` (11). e2e: `testes/alteracoes-contratuais.spec.ts` (3, com axe). |

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde |
|---|---|---|
| 67, 208, 1532 | Painel de vigência contratual e gestão do contrato (Módulo 4; RF-04.1) | Aba Alterações, prorrogação e alertas. Recebimento e garantias são da frente L |
| 78, 229 | Controle de prazos legais de divulgação de contratos **e aditivos** | Prazo do art. 94 por termo, divulgação pela fila e situação na tela |
| 401, 661 | Verificação automática pré-assinatura e pré-prorrogação (art. 91, § 4º) | Assinatura de todo termo aditivo e prorrogação com o checklist da frente C |
| 586, 994 | Vedação de aditivos por riscos alocados à contratada na matriz | Trava do reequilíbrio com a matriz de riscos do contrato (art. 103, § 5º) |
| 638 | Prorrogação com maior vantagem econômica e regularidade verificada | RN-33 (vantajosidade, preço, edital, crédito) + RN-09 |
| 942–1001 | Reajuste com data-base do orçamento estimado e índice; repactuação e reequilíbrio com prazos de resposta | Reajuste e repactuação por apostila; reequilíbrio com instrução e decisão (o prazo de resposta do contrato fica com o gestor — ver limitações) |
| 1058 | Extinção nas hipóteses dos arts. 137 a 139, com contraditório e ampla defesa | Extinção com contraditório, decisão e efeitos |
| 1104–1110, 1236–1246 | Cockpit de vigências (arts. 91, 92, 106), avisos de vencimento e reajuste; RN-01 trava pré-prorrogação do termo aditivo | Alertas da central com a situação da prorrogação; trava do termo de prazo |
| 1111 | Alerta quando a prorrogação exigir novo processo licitatório | "Não cabe nova prorrogação — inicie a nova licitação" (aviso e aba) |
| 1358, 1829 | Bloqueio automático de aditivos acima de 25%/50% (art. 125) | RN-32 na proposta e na assinatura |

## 3. Equivalentes lícitos adotados

1. **Assinatura "auditada", não assinatura digital.** A Ágora registra o ato da autoridade competente, com usuário, data, verificação de regularidade e trilha encadeada por hash, e gera o termo em PDF para assinatura e juntada no SEI. Não há assinatura eletrônica qualificada nem integração de escrita com o SEI nesta fase.
2. **Trava do art. 125 também nas alterações consensuais.** A Lei 14.133 não repete a exceção da Lei 8.666 (supressão acima de 25% por acordo); a trava vale para todo acréscimo e supressão, inclusive o reflexo de alteração qualitativa, conforme a leitura do TCU sobre os limites. A supressão acima do limite pedida pela Administração é motivo de extinção a pedido do contratado (art. 137, § 2º, I), registrado na extinção.
3. **Prorrogação automática do escopo (art. 111) como registro declaratório.** O sistema não sabe se o objeto foi concluído nem de quem é a culpa: o alerta lembra a regra e o gestor registra a prorrogação, declarando a causa. Com culpa do contratado, o registro exige a mora constituída; a extinção alternativa fica com a autoridade.
4. **Prazo de defesa na extinção.** A lei exige contraditório, mas não fixa prazo: a autoridade fixa de 1 a 60 dias úteis; a tela sugere 15, como o da defesa no processo de responsabilização (art. 158). **Precisa de confirmação do usuário.**
5. **Notificação do contratado** pela central da frente J, como aviso de ocorrência (e-mail institucional e registro no SEI, hoje simulados), com o prazo de defesa no texto.
6. **Efeitos da extinção** (assunção do objeto, execução da garantia, retenção de créditos) são **decisões registradas**, não executadas automaticamente: a execução da garantia e a retenção seguem nos fluxos de garantias e pagamentos (frente L). Nada é decidido por IA.
7. **Índice do reajuste informado pela autoridade.** A variação acumulada do índice (IPCA, ICTI…) é informada com a fonte; a Ágora confere a anualidade e calcula. A coleta automática das séries no IBGE/IPEA é integração externa de servidor, não feita aqui.
8. **Alertas sem novo tipo de aviso.** Para não duplicar avisos nem mudar o modelo da central, a situação da prorrogação entra como uma linha a mais no aviso de vencimento já existente (faixas de 120, 90, 60 e 30 dias).

## 4. Regras novas

| Regra | Título | Implementação |
|---|---|---|
| RN-32 | Termo aditivo como ato, com a trava do art. 125 | `avaliarTermoAditivo`, `avaliarAditivo`, `numeroTermoContratual`, `situacaoDivulgacaoTermoPncp`, `tipoTermoContratoPncp` |
| RN-33 | Prorrogação com os limites dos arts. 105 a 114 | `avaliarProrrogacao`, `avaliarAlertaProrrogacao`, `situacaoProrrogacao`, `vigenciaMaximaAnos` |
| RF-27 | Alterações do contrato: aditivos, apostilas, reajustes e extinção | `avaliarReajuste`, `avaliarRepactuacao`, `avaliarReequilibrio`, `avaliarInstauracaoExtincao`, `avaliarDecisaoExtincao`, `avaliarLimiteAditivos` |

Funções novas do domínio em `packages/dominio/src/lei14133/alteracoes-contratuais.ts`, mais
`interpretarLocalizacaoTermoPncp` e as constantes `NATUREZAS_DURACAO`, `MOTIVOS_EXTINCAO` e `EFEITOS_EXTINCAO`.

Permissões novas (fim de `TODAS_PERMISSOES` e do tipo `Permissao`): `alteracoes:parecer` (assessoria jurídica e
administrador) e `alteracoes:decidir` (gestor de contratos, quando autoridade competente, e administrador).

## 5. Rotas novas e alteradas

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /contratos/:id/alteracoes` | `contratos:ler` | Limites do art. 125, prorrogação, reajuste e histórico |
| `POST /contratos/:id/alteracoes` | `contratos:editar` | Propõe termo aditivo (acréscimo, supressão, qualitativa, prazo, reequilíbrio); 422 `RN-32`, `RN-33` ou `RF-27` |
| `POST /contratos/:id/alteracoes/:alteracaoId/parecer` | `alteracoes:parecer` | Parecer jurídico (favorável, com ressalvas ou desfavorável) |
| `POST /contratos/:id/alteracoes/:alteracaoId/assinar` | `alteracoes:decidir` | Confere as travas e a regularidade, assina, grava o livro e envia ao PNCP |
| `POST /contratos/:id/alteracoes/:alteracaoId/indeferir` | `alteracoes:decidir` | Indefere a proposta ou o reequilíbrio |
| `POST /contratos/:id/reajustes` | `alteracoes:decidir` | Reajuste por apostila (422 antes de 12 meses) |
| `POST /contratos/:id/repactuacoes` | `alteracoes:decidir` | Repactuação por apostila |
| `POST /contratos/:id/extincao` | `contratos:editar` | Abre o processo de extinção (notifica o contratado na unilateral) |
| `POST /contratos/:id/alteracoes/:alteracaoId/defesa` | `contratos:editar` | Registra a defesa ou a ausência de manifestação |
| `POST /contratos/:id/alteracoes/:alteracaoId/decidir-extincao` | `alteracoes:decidir` | Extingue (efeitos) ou arquiva |
| `GET /contratos/:id/alteracoes/:alteracaoId/termo.pdf` | `contratos:ler` | Termo assinado em PDF |
| `POST /contratos/:id/alteracoes/:alteracaoId/divulgar-pncp` | `alteracoes:decidir` | Reabre a divulgação que está na fila de erro |
| `POST /contratos/:id/prorrogacoes` (frente C, alterada) | `contratos:editar` | Agora confere a RN-33, registra o ato na aba Alterações e divulga no PNCP |

Banco (`020_alteracoes_contratuais.sql`): tabela `alteracoes_contratuais`; colunas `natureza_duracao`,
`regime_mao_obra` e `extinto_em` em `contratos`; tipos `qualitativa` e `reequilibrio` (e valor negativo para
reequilíbrio e reajuste) no livro `aditivos`; tipo `pncp.termo` em `fila_tarefas`; `vw_contratos_valores` passa a somar
o reequilíbrio ao valor global (coluna nova `reequilibrios`, no fim).

## 6. Variáveis de ambiente

Nenhuma nova. A divulgação dos termos usa as da frente B (`AGORA_INTEGRACOES`, `AGORA_PNCP_PUBLICACAO_URL`,
`AGORA_PNCP_USUARIO`, `AGORA_PNCP_SENHA`, `AGORA_ORGAO_CNPJ`) e a notificação, as da frente J.

## 7. Seção pronta para o manual do usuário

### Alterações do contrato: aditivos, apostilas, reequilíbrio e extinção

No contrato, abra a aba **Alterações**. Ela mostra:

- **Limites de alteração (art. 125)**: quanto já foi acrescido e suprimido, em percentual do valor inicial atualizado, frente ao limite de 25% (50% para acréscimos em reforma de edifício ou de equipamento), e a margem que resta;
- **Prorrogação e reajuste**: a natureza do contrato, até quando cabe prorrogar (ou se é preciso nova licitação), o índice, a data-base e quando o próximo reajuste fica disponível;
- **Histórico de alterações**: termos aditivos, apostilas, reequilíbrios e extinção, com a situação, a divulgação no PNCP e o termo em PDF. Clique no número do termo (ou em **Proposta**) para ver o detalhe e os próximos passos.

**Quem faz o quê:**

- gestor de contratos: propõe termos aditivos, registra prorrogações, abre a extinção e registra a defesa do contratado;
- gestor de contratos designado autoridade competente e administrador: assinam termos aditivos, apostilam reajustes e repactuações, decidem reequilíbrio e extinção e reenviam a divulgação ao PNCP;
- assessoria jurídica: emite o parecer jurídico de cada termo aditivo;
- os demais perfis com acesso ao contrato: consultam a aba.

#### Propor um termo aditivo

1. Clique em **Propor termo aditivo** e escolha o tipo: acréscimo, supressão, alteração qualitativa, prorrogação da vigência ou reequilíbrio econômico-financeiro.
2. Preencha o valor (e, no reequilíbrio, o enquadramento, o risco da matriz de riscos, as datas e a demonstração) e a **Justificativa**.
3. Clique em **Propor termo aditivo**. A proposta fica **Aguardando parecer jurídico**.

> **Atenção:** acima do limite do art. 125 a Ágora **recusa** a alteração e mostra o motivo (RN-32). O risco que a
> matriz atribui à contratada não gera reequilíbrio, salvo tributo novo ou alteração unilateral.

#### Emitir o parecer jurídico

1. No histórico, abra a proposta e clique em **Registrar parecer jurídico**.
2. Escolha **Favorável**, **Favorável com ressalvas** ou **Desfavorável**, informe o número e a conclusão e clique em **Registrar parecer**.

Com parecer favorável, a proposta fica **Pronto para assinatura**; com parecer desfavorável, não pode ser assinada.

#### Assinar o termo aditivo

1. Abra a proposta e clique em **Assinar termo aditivo** (no reequilíbrio, **Deferir e assinar**, com o valor reconhecido).
2. Marque a confirmação e clique em **Assinar**.

A Ágora consulta de novo o CEIS e o CNEP, confere as certidões do contratado e repete as travas. Assinado, o termo
recebe o número, entra no valor do contrato e segue para o PNCP. O aditivo só produz efeitos depois de divulgado
(prazo de 20 dias úteis na licitação e 10 na contratação direta, art. 94). Se o PNCP recusar, o termo aparece **Na
fila de erro**: corrija a causa e clique em **Reenviar ao PNCP**.

#### Prorrogar a vigência

Use **Propor termo aditivo** › **Prorrogação da vigência** (com parecer jurídico) ou a seção **Prorrogação da
vigência (RN-09 e RN-33)**. Informe a nova data de fim e responda às travas da natureza do contrato:

- contínuo: previsão no edital, vantajosidade atestada pela autoridade, preço compatível com o mercado e crédito orçamentário — até 10 anos do início;
- TI estruturante: até 15 anos; contrato que gera receita: até 10 ou 35 anos;
- escopo: se o atraso é sem culpa do contratado, a vigência se prorroga automaticamente; com culpa, só depois de constituída a mora.

A partir de 120 dias do fim da vigência, o aviso de vencimento que chega ao gestor e ao fiscal diz se cabe prorrogar e
até quando, ou se é preciso iniciar nova licitação.

#### Registrar reajuste ou repactuação

- **Reajuste**: depois de 12 meses da data do orçamento estimado, o botão **Registrar reajuste** aparece. Informe a variação do índice e a fonte e clique em **Apostilar reajuste**. Antes de 12 meses, o reajuste é vedado.
- **Repactuação** (serviço com dedicação exclusiva ou predominância de mão de obra): clique em **Registrar repactuação**, informe o pedido, o início dos efeitos e cada componente da planilha (custo anterior e novo, data-base e documento) e clique em **Apostilar repactuação**.

#### Extinguir o contrato

1. Clique em **Abrir extinção**, escolha a forma (unilateral, consensual ou judicial/arbitral), o motivo do art. 137 e escreva a motivação. Na unilateral, fixe o prazo de defesa: o contratado é notificado.
2. Recebida a defesa, abra o processo e clique em **Registrar defesa** (ou marque que não houve manifestação depois do prazo).
3. A autoridade clica em **Decidir a extinção**, informa a data dos efeitos, os efeitos decididos e a fundamentação, e clica em **Registrar decisão** — ou arquiva o processo.

Extinto o contrato, a vigência termina na data dos efeitos, propostas pendentes são arquivadas e o termo de rescisão é
divulgado no PNCP. A execução da garantia e a retenção de créditos seguem nos fluxos de garantias e pagamentos.

## 8. Limitações e dependências externas

- **PNCP real.** O envio dos termos usa o endpoint e o esquema da especificação OpenAPI pública do PNCP; os códigos do tipo de termo (1 = rescisão, 2 = aditivo, 3 = apostilamento) seguem a tabela de domínio do manual e devem ser conferidos no credenciamento. Sem credenciais, o modo offline simula o envio (protocolo `SIMULADO-…`). O contrato precisa estar divulgado no PNCP antes do termo; senão a tarefa vai para a fila de erro com o motivo.
- **Assinatura e SEI.** Sem assinatura eletrônica qualificada e sem escrita no SEI: o PDF é juntado ao processo pelo servidor.
- **Índices de reajuste.** Sem coleta automática das séries (IBGE, IPEA): a autoridade informa a variação e a fonte.
- **Prazos de resposta a repactuação e reequilíbrio** (art. 92, X e XI) não são controlados como pendência: a data do pedido fica registrada no ato.
- **Visão `vw_contratos_valores`.** A migração 020 a recria para somar o reequilíbrio. Se outra frente recriar a visão, precisa manter a coluna `reequilibrios` e o reequilíbrio no valor global.
- **Natureza dos contratos da carga.** A carga sintética marca como contínuos só os serviços licitados; o restante fica como escopo. Contratos importados sem natureza a recebem na primeira prorrogação.
- **Fora desta parte (F22b e frente L):** recebimentos provisório e definitivo, garantias, prazos de liquidação e pagamento, fiscal requisitante, desconto de multa na garantia ou na fatura, percentuais do Decreto 11.430/2023 e período antes da ordem de serviço.

## 9. Verificações

Registradas no relatório final do coordenador (build, typecheck, testes do domínio e da API, e2e na porta 3111 e
gates da Fábrica).
