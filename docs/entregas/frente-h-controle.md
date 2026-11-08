# Frente H — Três linhas de defesa e controle externo (F8 e F2)

Entrega da frente H do plano (`docs/PLANO-NOVAS-FUNCOES.md`, F8 e F2), com a revisão trimestral da matriz de riscos dos contratos pedida na matriz de riscos do cliente.

## 1. O que foi feito

### F8 — Painel das três linhas de defesa (art. 169) — RF-23

Tela **Controle › Linhas de defesa** (`/controle`), com uma aba por linha. Cada aba só aparece para o perfil da linha, e cada painel é montado pelo servidor no escopo de UASG do usuário. Pedir o painel de outra linha responde 403.

- **1ª linha (gestão e fiscalização):**
  - pendências vencidas;
  - tarefas do plano de gestão em atraso;
  - notas fiscais com atesto atrasado;
  - processos da jornada com bloqueio, avaliados pelas mesmas regras do avanço;
  - contratos com a revisão trimestral da matriz de riscos vencida ou a vencer;
  - medidas do controle externo com prazo aberto ou suspensão em vigor.
- **2ª linha (assessoria jurídica e controle interno):**
  - pareceres pendentes (processos na etapa 5 sem parecer);
  - **matriz de achados preventivos**:
    - alterações perto ou acima do limite do art. 125;
    - contrato sem fiscal ou sem gestor designado;
    - divulgação no PNCP vencida;
    - sanção aplicada sem registro no CEIS/CNEP;
    - pagamento preterido na ordem cronológica (art. 141);
    - processo bloqueado há mais de 15 dias;
    - revisão de riscos vencida;
  - **exceções justificadas** nos processos: compra fora do catálogo, artigo de luxo, ETP sem algum elemento e cotação expurgada;
  - sanções em andamento;
  - medidas do controle externo não revogadas.
- **3ª linha (auditoria, CGU e TCU):**
  - leitura ampla;
  - todas as medidas de controle com prazos;
  - integridade da trilha de auditoria, verificada a cada consulta;
  - eventos da trilha por recurso e os últimos eventos do período;
  - acessos a dados pessoais no período;
  - resumo da 1ª e da 2ª linha.
- **Relatório executivo de auditoria em PDF** (`GET /controle/relatorio.pdf`):
  - gerado pelo gerador de texto que já existe (`compartilhado/pdf-texto.ts`);
  - traz órgão, período, data e hora da emissão, emitente, escopo, fontes e ressalvas;
  - a emissão entra na trilha (`controle.relatorio.emitir`), com o hash SHA-256 do arquivo entregue.
- **Dados reaproveitados, sem duplicar cálculo:**
  - pendências (`listarPendencias`), sanções (`listarSancoes`) e verificação da trilha (`verificarCadeia`);
  - processos da jornada (`avaliarProcesso`), vigência e divulgação no PNCP (`situacaoDivulgacaoPncp`);
  - limite do art. 125 (`avaliarAditivo`, chamado por `avaliarLimiteAditivos`).

### F2 — Controle externo (art. 171) — RF-24 e RN-30

Tela **Controle › Controle externo** (`/controle-externo`).

- **Registro da medida**, no processo da jornada ou no contrato, com:
  - órgão (TCU ou CGU) e tipo (medida cautelar, determinação, diligência ou recomendação);
  - número da decisão ou do ofício;
  - datas da decisão e da ciência;
  - objeto;
  - efeito suspensivo (só na cautelar).
- **Prazo de resposta do órgão em dias úteis**, contado da ciência na forma do art. 183, com os feriados locais cadastrados:
  - na suspensão cautelar, o prazo legal de **10 dias úteis**, admitida a prorrogação (art. 171, § 2º);
  - nas demais medidas, o prazo fixado na comunicação; sem prazo fixado, a referência de 10 dias úteis.
- **Semáforo do prazo**:
  - vencido;
  - crítico (até 2 dias úteis);
  - atenção (até 5 dias úteis);
  - regular;
  - concluído.

  A explicação lembra o § 4º (apuração de responsabilidade) quando o prazo vence.
- **Registro da prorrogação, da resposta e da revogação**, cada um com data e texto, e travas de estado: não se responde duas vezes, não se prorroga o que já foi respondido e não se revoga duas vezes.
- **Prazo do tribunal para decidir o mérito**: na suspensão respondida, 25 dias úteis da resposta (art. 171, § 1º), em caráter informativo.
- **RN-30 — cautelar suspensiva em vigor** impede:
  - **avançar o processo**: o bloqueio aparece na lista de bloqueios da jornada e `POST /processos/:id/avancar` responde 422;
  - **gerar e assinar o contrato**: `POST /processos/:id/contratar` responde 422 com o detalhe `RN-30`.

  O aviso cita o órgão, o número da decisão e a data da ciência. A revogação libera o processo na hora.
- **Função de verificação para outras frentes**, em `apps/api/src/compartilhado/controle-externo.ts`:
  - `verificarControleExterno(executor, { processoId?, contratoId? }, hoje)` → `{ bloqueado, mensagem, fundamento, medidas }`;
  - `exigirSemCautelarSuspensiva(...)` lança 422 (`RN-30`);
  - `bloqueiosControleExterno(...)` devolve os bloqueios para `avaliarProcesso`;
  - com `contratoId`, a verificação considera as medidas sobre o contrato e sobre o processo que o gerou. Use-a no checklist pré-assinatura (frente C) e na assinatura de aditivos e prorrogações.
- **Ligação com a jornada**, com mudança mínima:
  - uma linha em `jornada/repositorio.ts#avaliarProcesso`, que acrescenta o bloqueio RN-30;
  - uma linha em `jornada/rotas.ts` (`contratar`), que chama `exigirSemCautelarSuspensiva`.
- **Auditoria**: todas as escritas são transacionais e auditadas (`medida_controle.registrar`, `.prorrogar`, `.responder` e `.revogar`). Medidas sobre contrato entram também no histórico do contrato.

### RN-29 — Revisão trimestral da matriz de riscos do contrato

Aba **Matriz de riscos** no detalhe do contrato (`/contratos/:id?aba=riscos`).

- **Matriz vigente**: a da última revisão; sem revisão, a do processo da jornada que gerou o contrato; sem nenhuma das duas, a primeira revisão registra a matriz.
- **Prazo**: a revisão vence 3 meses após a última, ou após o início da vigência quando ainda não houve revisão. O alerta "a vencer" aparece 15 dias antes; contrato com vigência encerrada não exige revisão.
- **Alertas**: a revisão vencida aparece no contrato, no painel da 1ª linha e como achado na 2ª linha.
- **Registro da revisão** (`POST /contratos/:id/riscos/revisoes`):
  - leva a matriz atualizada inteira e a observação;
  - a linha de defesa é decidida no servidor: o perfil Controle interno registra como 2ª linha, e gestão e fiscalização como 1ª;
  - fica no histórico do contrato e na trilha (`contrato.riscos.revisar`).

### Perfil e permissões

- **Novo perfil `controle_interno`**, "Controle interno": unidade de controle interno e gestão de riscos, 2ª linha de defesa.
  - Usuário de demonstração: `controle@agora.demo`, escopo de todas as UASGs.
- **Nova conta de demonstração da 3ª linha:** `auditoria.externa@agora.demo`, com o perfil **Auditor**, que já existia. Ela representa o auditor da CGU ou do TCU.
- As duas contas são criadas por uma etapa própria da carga (`seed/controle.ts`), com PRNG próprio, e não alteram a sequência dos dados já existentes.
- **Novas permissões**, acrescentadas no fim de `TODAS_PERMISSOES` e do tipo `Permissao`:

  | Permissão | Perfis |
  |---|---|
  | `controle:primeira_linha` | gestor de contratos, fiscal, financeiro, planejamento, agente de contratação, auditor |
  | `controle:segunda_linha` | assessoria jurídica, controle interno, auditor |
  | `controle:terceira_linha` | auditor |
  | `controle_externo:ler` | gestor, fiscal, planejamento, agente, jurídico, controle interno; o auditor recebe pelas permissões de leitura |
  | `controle_externo:registrar` | controle interno |
  | `riscos:revisar` | gestor de contratos, fiscal, controle interno |

  O administrador tem todas, como antes.

## 2. Linhas da conversa atendidas

| Linha | Pedido | Onde está |
|---|---|---|
| 498 | Matriz de riscos fundamentada também no art. 169 | RN-29 |
| 592 | Matriz revisada trimestralmente pela 1ª linha (gestão e fiscalização) e pela 2ª (controle interno e gestão de riscos) | RN-29, com a linha registrada em cada revisão |
| 644 | Ferramentas de controle preventivo contínuo para a 1ª e a 2ª linha (art. 169) | RF-23, painéis da 1ª e da 2ª linha |
| 1134–1139 e 1299–1309 | Painel nas três linhas: alertas para fiscais e gestores; conformidade da CONJUR e do controle interno; visão de auditoria para CGU e TCU com prazo de 10 dias úteis para a manifestação do órgão (art. 171, § 2º) | RF-23, RF-24 e RN-30 |
| 1140 e 1311 | Matriz de achados preventivos (aditivo acima de 25%/50%, ausência de fiscal designado etc.) | Matriz de achados da 2ª linha. O "superfaturamento na medição" depende do IMR (F7) |
| 1358 | Auditoria preventiva nas 3 linhas e bloqueio de aditivo acima de 25% | Achado "acima do limite" na 2ª linha. A trava na assinatura do aditivo é da execução contratual (F22 e frente C) |
| 1546 | RF-04.3: painéis segregados por linha e alerta do prazo de 10 dias úteis na suspensão cautelar | RF-23, RF-24 e RN-30 |

O texto dos arts. 169, 170 e 171 foi conferido pela redação vigente da Lei 14.133/2021: incisos I a III do art. 169, § 2º do art. 169 (acesso irrestrito dos órgãos de controle), §§ 1º, 2º e 4º do art. 171 e § 1º do art. 141.

O planalto.gov.br recusou o acesso automatizado nesta sessão, com a página "Acesso negado". Vale uma última conferência manual no portal.

## 3. Equivalentes lícitos e decisões

| Pedido | O que foi feito | Por quê |
|---|---|---|
| "Visão de Auditoria para CGU e TCU" | A 3ª linha usa o perfil **Auditor**, que já existe, com acesso a todas as UASGs. Os auditores da CGU e do TCU recebem contas com esse perfil; a conta de demonstração é `auditoria.externa@agora.demo`. | O art. 169, § 2º, garante acesso irrestrito aos órgãos de controle. O perfil separado "Controle externo" continua como decisão aberta no plano (§ 9, item 1). |
| Exceção justificada da ordem cronológica (art. 141) | O sistema ainda não registra a alteração justificada da ordem; esse registro é parte de F22. A 2ª linha mostra o **pagamento preterido** como achado para conferência: nota exigível sem pagamento enquanto notas posteriores da mesma fonte foram pagas. | A alteração só vale com justificativa prévia e comunicação ao controle (art. 141, § 1º). O sinal não acusa ninguém: a justificativa pode existir fora do sistema. |
| Bloqueio automático de aditivo acima de 25% (linha 1358) | Achado na 2ª linha; o simulador de aditivo continua informando o limite. | Não há assinatura de aditivo na Ágora. A trava entra com F22 e com o checklist da frente C. |
| Prazo de resposta | 10 dias úteis só para a ordem de suspensão. As demais medidas usam o prazo da comunicação; sem prazo fixado, a referência de 10 dias úteis. | É o que diz o art. 171, § 2º. |
| Achados preventivos | Determinísticos, sem IA, com o fundamento legal em cada um e o aviso de que não constituem conclusão. | Regra 5: a IA não decide, e o achado não é decisão. |

## 4. Regras novas no catálogo

- **RF-23 — Painel das três linhas de defesa.** Art. 169, I a III e § 2º. Tela `controle`.
- **RF-24 — Controle externo: medidas de controle e cautelares.** Art. 171, §§ 1º, 2º e 4º. Tela `controle.externo`.
- **RN-29 — Revisão trimestral da matriz de riscos do contrato.** Arts. 22 e 169. Etapa 7; telas `contratos.detalhe` e `controle`.
- **RN-30 — Cautelar suspensiva impede avançar e contratar.** Art. 171, §§ 1º e 2º. Telas `controle.externo` e `jornada.detalhe`.

Funções do domínio, em `packages/dominio/src/lei14133/controle.ts`, todas com testes:

- `prazoRespostaCautelar` e `prazoRespostaMedida`;
- `prazoDecisaoMerito` e `situacaoMedidaControle`;
- `bloqueioControleExterno` e `situacaoRevisaoRiscos`;
- `avaliarLimiteAditivos` e `pagamentosPreteridos`.

## 5. Rotas novas

| Método e rota | Permissão |
|---|---|
| `GET /controle/primeira-linha?uasg` | `controle:primeira_linha` |
| `GET /controle/segunda-linha?uasg` | `controle:segunda_linha` |
| `GET /controle/terceira-linha?uasg&de&ate` (padrão: últimos 90 dias; máximo de 2 anos) | `controle:terceira_linha` |
| `GET /controle/relatorio.pdf?uasg&de&ate` | `controle:terceira_linha` (auditada) |
| `GET /medidas-controle?situacao&orgao&alvo&alvoId&uasg&busca&pagina&tamanhoPagina` | `controle_externo:ler` |
| `GET /medidas-controle/:id` | `controle_externo:ler` |
| `POST /medidas-controle` | `controle_externo:registrar` |
| `POST /medidas-controle/:id/prorrogacao` | `controle_externo:registrar` |
| `POST /medidas-controle/:id/resposta` | `controle_externo:registrar` |
| `POST /medidas-controle/:id/revogacao` | `controle_externo:registrar` |
| `GET /contratos/:id/riscos` | `contratos:ler` |
| `POST /contratos/:id/riscos/revisoes` | `riscos:revisar` |

Todas aplicam o escopo de UASG no servidor; o que está fora do escopo responde 404.

**Banco: migração `017_controle_linhas_defesa.sql`**

- Tabela `medidas_controle`, com restrições de coerência:
  - alvo único (processo ou contrato);
  - efeito suspensivo só em cautelar;
  - ciência a partir da decisão;
  - prorrogação, resposta e revogação coerentes.
- Tabela `revisoes_matriz_riscos`.
- Inclusão de `controle_interno` na lista de perfis aceitos. A lista atual é lida do catálogo do banco, então a migração preserva perfis que outras migrações tenham acrescentado antes dela.

## 6. Variáveis de ambiente

Nenhuma nova.

## 7. Seção pronta para o manual do usuário

> Sugestão de inclusão como nova seção, depois de "12. Auditoria". Acrescente também a linha do perfil na tabela da seção 3:
>
> | Controle interno | Acompanha a conformidade das contratações (2ª linha de defesa), registra as medidas do TCU e da CGU, com as respostas e as revogações, e revisa a matriz de riscos dos contratos. |

### Linhas de defesa e controle externo

A Lei 14.133/2021 organiza o controle das contratações em três linhas de defesa (art. 169). Na Ágora, cada linha tem o seu painel, em **Controle › Linhas de defesa**. Você só vê a aba da sua linha, e só com os dados das UASGs do seu escopo.

| Linha | Quem | O que o painel mostra |
|---|---|---|
| 1ª linha | Gestor de contratos, fiscal, financeiro, planejamento e agente de contratação | Pendências vencidas, tarefas em atraso, notas com atesto atrasado, processos com bloqueio, revisões da matriz de riscos e medidas do controle externo |
| 2ª linha | Assessoria jurídica e controle interno | Pareceres pendentes, matriz de achados preventivos, exceções justificadas, sanções em andamento e medidas do controle externo |
| 3ª linha | Auditor (CGU e TCU) | As três linhas, integridade da trilha de auditoria, eventos do período, acessos a dados pessoais e o relatório executivo de auditoria |

Use o campo **UASG** para olhar uma unidade só.

Os **achados preventivos** são sinais para conferência. Por exemplo: aditivos perto do limite legal, contrato sem fiscal, divulgação vencida no PNCP ou pagamento fora da ordem cronológica. Eles não são conclusão de irregularidade.

#### Baixar o relatório executivo de auditoria

Perfis: auditor e administrador.

1. Em **Linhas de defesa**, abra a aba **3ª linha — auditoria (CGU e TCU)**.
2. Informe o período em **De** e **Até**. Sem datas, valem os últimos 90 dias.
3. Clique em **Baixar relatório executivo (PDF)**.

O relatório traz o período, a data de emissão, quem emitiu, as fontes dos dados e as ressalvas. A emissão fica registrada na trilha de auditoria.

#### Registrar uma medida do TCU ou da CGU

Perfis: controle interno e administrador. Os demais perfis com acesso só consultam.

1. Em **Controle › Controle externo**, clique em **Registrar medida**.
2. Escolha o **Órgão de controle** e o **Tipo de medida**.
3. Na medida cautelar, mantenha marcado **Com efeito suspensivo** quando ela suspender o processo ou a assinatura.
4. Informe o **Número da decisão ou do ofício**, a **Data da decisão** e a **Data da ciência pelo órgão**.
5. Em **A medida atinge**, escolha processo ou contrato e busque pelo número ou pelo objeto.
6. Descreva o **Objeto da medida** e clique em **Registrar medida**.

O prazo de resposta é calculado em dias úteis a partir da ciência:

- na suspensão cautelar, 10 dias úteis, admitida a prorrogação (art. 171, § 2º);
- nas demais medidas, o prazo fixado na comunicação.

O semáforo avisa quando faltam 5 dias úteis ou menos.

> **Atenção.** Enquanto houver cautelar com efeito suspensivo em vigor:
>
> - o processo **não avança de etapa** e **não gera o contrato**; o motivo aparece em **Bloqueios**, na página do processo;
> - no contrato, a assinatura de termos fica bloqueada.

#### Registrar prorrogação, resposta e revogação

1. Na lista de medidas, clique em **Detalhes**.
2. Escolha **Prorrogação**, **Resposta** ou **Revogação**.
3. Informe a data e o texto e confirme.

A resposta registra as medidas adotadas e as informações prestadas. Na suspensão cautelar respondida, a Ágora informa o prazo do tribunal para decidir o mérito (art. 171, § 1º).

A revogação libera o processo na hora. Todos os registros ficam na trilha de auditoria.

#### Revisar a matriz de riscos do contrato (revisão trimestral)

Perfis: gestor de contratos, fiscal de contrato, controle interno e administrador.

A matriz de riscos de cada contrato é revisada a cada três meses pela equipe de gestão e fiscalização e pela unidade de controle interno. A revisão vencida aparece no painel da 1ª linha e na aba **Matriz de riscos** do contrato.

1. No contrato, abra a aba **Matriz de riscos**.
2. Clique em **Registrar revisão trimestral**.
3. Confira cada risco. Ajuste a probabilidade, o impacto, a alocação e o tratamento; inclua ou remova riscos.
4. Escreva a **Observação da revisão** e clique em **Registrar revisão**.

A próxima revisão passa a vencer três meses depois. A revisão fica no histórico do contrato, com a linha de defesa de quem revisou.

## 8. Limitações e o que depende de acesso externo

- **Registro das medidas**:
  - é manual: não há integração com os sistemas do TCU ou da CGU para receber as comunicações;
  - integrar depende de acordo e de API dos órgãos de controle, a ser providenciado pelo MJSP.
- **Assinatura do relatório**:
  - o relatório não leva assinatura ICP-Brasil (RN-04 da conversa, linha 1142); depende de F12;
  - a integridade vem da trilha encadeada por hash e do registro do hash do PDF.
- **Fora desta frente**:
  - o "Auditor IA contínuo" (RIA-04 da conversa, linha 1143), que depende de F24 e do LLM do órgão;
  - o achado de superfaturamento na medição, que depende do IMR (F7).
- **Ordem cronológica**: o sinal usa a data de vencimento como data de exigibilidade, como a lista de pagamentos já faz. O registro da alteração justificada da ordem é parte de F22.
- **Pontos de fusão com outras frentes**:
  - `perfis.ts`, `packages/contratos/src/index.ts` (`CodigoPerfil` e `Permissao`), `registro.ts`, `rotas.ts`, `navegacao.ts`, `catalogo-regras.ts` e o teste dele, e o índice do seed: só acréscimos no fim;
  - `apps/api/test/autorizacao.test.ts`: a contagem de perfis e permissões passou a vir de `PERFIS` e `TODAS_PERMISSOES`;
  - `jornada.test.ts`, `lgpd.test.ts` e `listas.test.ts`: a contagem de usuários soma `USUARIOS_DEMONSTRACAO_ADICIONAIS`;
  - `seed/usuarios-demonstracao.ts` ganhou essa lista, para outras frentes acrescentarem usuários sem mudar a sequência da carga;
  - `configuracao/rotas.ts` mostra os usuários da lista na tela de entrada;
  - a frente A (jornada) recebe duas linhas: `avaliarProcesso` e `contratar`;
  - a frente C deve chamar `verificarControleExterno` com `contratoId` no checklist pré-assinatura.
