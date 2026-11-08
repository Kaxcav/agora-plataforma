# Frente A — jornada da contratação (PoC-01, F1, F21 e F26)

Entrega da frente A do plano de novas funções. Tudo roda com dados sintéticos do seed; nenhum dado de `reference/` foi
copiado para o código, os testes ou o seed.

## 1. O que foi feito

### PoC-01 — trava do artigo de luxo na geração de minutas (RN-01)

- **Domínio:** `avaliarBloqueioLuxoMinutas` (`packages/dominio/src/lei14133/luxo.ts`) aponta os itens do DFD com indício
  de artigo de luxo e diz se a geração de minutas está bloqueada. A justificativa é aceita com o mesmo critério que libera
  o avanço da etapa 1: no mínimo 30 caracteres.
- **Servidor:** `prepararDocumento` chama a trava antes de redigir qualquer minuta (DFD, ETP, matriz de riscos, nota
  técnica, TR, edital e minuta de contrato). A trava vem antes do provedor de IA, então vale também com
  `AGORA_IA_PROVEDOR=openai_compativel`. A rota de geração confere de novo dentro da transação, para cobrir alteração
  simultânea do DFD. A resposta é 422 `REGRA_NEGOCIO`, com o detalhe `RN-01` e a mensagem que aponta o item e o termo.
- **Tela:** no painel de documentos, um aviso informa que a geração está bloqueada. O botão continua disponível: ao tentar
  gerar, a tela mostra o erro do servidor com a regra RN-01 e a orientação (justificar ou remover o item).
- **Testes:** `apps/api/test/poc-01-artigo-luxo.test.ts` usa um provedor de IA falso (`fetch` injetado) e confere que a IA
  nunca é chamada e que nada é gravado. `e2e/testes/poc-01-artigo-luxo.spec.ts` reproduz o roteiro inteiro: DFD com item de
  luxo, tentar gerar, ver o bloqueio, justificar e gerar, e depois remover o item e gerar de novo.

### F1 — prova de conceito e amostra nos processos do órgão (RN-20)

- **Parâmetros do edital (etapa 4):** exigência de prova de conceito ou de amostra, com roteiro e critérios de aprovação,
  justificativa da necessidade (art. 41, II) e prazo de 1 a 30 dias úteis contados da convocação.
  - Sem roteiro, sem justificativa ou com prazo inválido, o processo não avança da etapa 4 (`validarProvaConceito`).
  - A exigência entra no hash do pacote do edital. Se mudar, o TR, o edital e a minuta precisam ser gerados de novo.
    Editais sem prova mantêm o hash anterior.
  - O TR (alínea h) e o edital (item 5.3) trazem a cláusula: convocação do provisoriamente vencedor, prazo, sessão pública
    transmitida e gravada e convocação do próximo colocado se houver reprovação.
- **Painel da prova (etapa 6):** convocação do vencedor provisório, com o prazo calculado (`prazoProvaConceito`, art. 183).
  - O resultado (aprovado ou reprovado) é registrado com motivação e o link da gravação da sessão pública. O link é
    obrigatório na aprovação e aceita só http(s).
  - Uma tabela mostra o histórico de convocações, prazos, resultados e gravações.
- **Reprovado convoca o próximo colocado:** o servidor convoca automaticamente o próximo classificado, com novo prazo, e
  registra isso na trilha. Sem resultado aprovado, o processo não segue para a habilitação, os recursos e a adjudicação.
- **Disputa fixa:** depois do primeiro ato da seleção, o resultado da disputa não pode mais ser alterado (422).

### F21 — sustentabilidade e logística reversa obrigatórias (RN-21)

- **Política do órgão** (`politicas_orgao`, migração 011): ligada por padrão. Só o administrador (`ajustes:editar`) a
  altera, em **Ajustes › Políticas do órgão**, sempre com justificativa e evento `politica.sustentabilidade.alterar` na
  trilha.
- **Critérios do processo:** **Critérios de sustentabilidade ambiental** e **Logística reversa**, editáveis nas etapas 3 e
  4 (`PUT /processos/:id/sustentabilidade`).
- **Com a política ligada** (`verificarSustentabilidade`):
  - a etapa 3 (conclusão do ETP) e a etapa 4 (conclusão do TR) não avançam sem os dois critérios;
  - o ETP e o TR não podem ser aprovados sem eles;
  - um TR gerado antes do preenchimento precisa ser gerado de novo.
- **Documentos:** o ETP (inciso XII) e o TR (seção "Sustentabilidade ambiental e logística reversa") trazem os critérios
  numa seção protegida, que a IA não pode omitir nem reescrever.

### F26 — atos da seleção (RN-22 e RF-18)

- **Fase recursal única** após a habilitação. Com inversão de fases, que fica nos parâmetros do edital e exige motivação,
  ela ocorre após o julgamento.
- **Intenção de recorrer:** registrada no dia do ato. O agente pode encerrar o registro sem manifestação, e no dia seguinte
  o direito preclui sozinho.
- **Prazos** (`prazosRecursoSelecao`, com o calendário de dias úteis e os feriados locais):

  | Ato | Prazo |
  |---|---|
  | Razões | 3 dias úteis da ata |
  | Contrarrazões | 3 dias úteis do fim das razões |
  | Reconsideração por quem praticou o ato | 3 dias úteis |
  | Decisão da autoridade superior | 10 dias úteis do encaminhamento |

  Prazo vencido sem o ato vira sinal de atenção.
- **Reforma do ato:** a decisão de reformar o ato escolhe o efeito: desclassificar o vencedor (o próximo colocado é
  convocado) ou reintegrar um licitante reprovado ou inabilitado.
- **Adjudicação e homologação** (art. 71, IV): atos auditados da autoridade competente designada na equipe do processo.
  - O servidor exige a permissão nova `jornada:homologar` e a designação como `autoridade_competente`.
  - A segregação já impede que o agente seja a autoridade.
- **Divulgação pós-homologação** (art. 54, § 3º): a homologação divulga automaticamente os documentos da fase preparatória
  aprovados (DFD, ETP, matriz de riscos, nota técnica de preços e checklist jurídico).
  - Eles aparecem em `/transparencia/editais` (coluna **Homologação**) e no detalhe do edital (seção **Documentos da fase
    preparatória**), em PDF, sem login e com dados pessoais tarjados.
  - Com orçamento sigiloso, a nota técnica de preços não é divulgada.
- **Contratação:** a etapa 7 contrata o adjudicatário, que pode não ser o primeiro classificado. A etapa 6 só avança com a
  licitação homologada.
- **Integração com a frente E:** a etapa recebe o resultado da sala de disputa pelo fluxo de registro que já existe
  (`PUT /processos/:id/disputa`). Os atos começam depois desse registro.

## 2. Linhas da conversa atendidas

| Função | Linhas | Onde |
|---|---|---|
| PoC-01 / RN-01 | 43, 675–677, 1778 | trava de minutas, mensagem na tela, e2e do roteiro |
| F1 / RN-20 | 505, 669–692 (4.1), 1717, 1817 | parâmetros do edital, painel da prova, reprovação → próximo colocado |
| F21 / RN-21 | 42, 467, 1424, 1795 | política do órgão, critérios no ETP e no TR, bloqueios |
| F26 / RN-22 e RF-18 | 61, 195, 908 | fase recursal única, prazos, adjudicação, homologação, divulgação |

## 3. Equivalentes lícitos adotados

- **Prazo recursal de 3 dias úteis, não 5:** a conversa (linhas 61 e 195) fala em 5 dias úteis após a habilitação. A Lei
  14.133/2021, art. 165, I, fixa 3 dias úteis para as razões, e o § 4º dá o mesmo prazo às contrarrazões. A Ágora usa 3,
  porque um prazo maior no sistema contrariaria a lei e os editais gerados por ela.
- **"Justificativa aceita":** a lei não prevê homologação separada da justificativa de qualidade comum. A Ágora aceita a
  justificativa com o mesmo critério que já liberava o avanço da etapa 1 (no mínimo 30 caracteres, na DFD). A
  classificação final continua sendo do agente responsável.
- **Intenção "imediata":** o art. 165, § 1º, I, exige a manifestação imediata, sob pena de preclusão. A Ágora a registra no
  dia da ata: a janela fecha quando o agente a encerra ou no dia seguinte.
- **Link da gravação:** a sessão pública fica gravada na infraestrutura do órgão. A Ágora guarda só o link (http/https) e
  o abre em nova aba, sem incorporar vídeo nem chamar serviço de terceiros no navegador.
- **Decisões humanas:** aprovar ou reprovar a prova, habilitar, reconsiderar, decidir o recurso, adjudicar e homologar são
  atos de servidores identificados, sempre motivados. O domínio só ordena os atos e calcula prazos. A IA não participa.

## 4. Regras novas

| Código | Título | Implementação |
|---|---|---|
| RN-20 | Prova de conceito ou amostra do licitante provisoriamente vencedor | `validarProvaConceito`, `prazoProvaConceito`, `avaliarSelecao` |
| RN-21 | Critérios de sustentabilidade e logística reversa obrigatórios | `verificarSustentabilidade` |
| RN-22 | Fase recursal única e prazos dos atos da seleção | `prazosRecursoSelecao`, `avaliarSelecao`, `validarAtoSelecao`, `validarInversaoFases` |
| RF-18 | Adjudicação, homologação e divulgação dos documentos preparatórios | rotas de adjudicação, homologação e PDF público |

A RN-01 ganhou uma frase na descrição e passou a citar `avaliarBloqueioLuxoMinutas`.

## 5. Rotas novas

| Rota | Permissão |
|---|---|
| `PUT /processos/:id/sustentabilidade` | `jornada:editar`, até a etapa 4 |
| `POST /processos/:id/selecao/prova-conceito/convocacao` | `jornada:editar` |
| `POST /processos/:id/selecao/prova-conceito/resultado` | `jornada:editar` |
| `POST /processos/:id/selecao/habilitacao` | `jornada:editar` |
| `POST /processos/:id/selecao/recurso/manifestacao` (intenção, razões, contrarrazões) | `jornada:editar` |
| `POST /processos/:id/selecao/recurso/encerrar-intencao` | `jornada:editar` |
| `POST /processos/:id/selecao/recurso/reconsideracao` | `jornada:editar` |
| `POST /processos/:id/selecao/recurso/decisao` | `jornada:homologar` + autoridade designada |
| `POST /processos/:id/selecao/adjudicacao` | `jornada:homologar` + autoridade designada |
| `POST /processos/:id/selecao/homologacao` | `jornada:homologar` + autoridade designada |
| `GET /politicas-orgao/sustentabilidade` | sessão (`painel:ler`) |
| `PUT /politicas-orgao/sustentabilidade` | `ajustes:editar` |
| `GET /publico/editais/:id/preparatorios/:tipo` | pública, só após a homologação |

Contrato HTTP:

- `ParametrosEdital` ganhou `provaConceito` e `inversaoFases`, opcionais no PUT e sempre presentes no GET.
- `ProcessoDetalhe` ganhou `selecao` e `sustentabilidade`.
- `EditalPublico` ganhou `homologadoEm` e `documentosPreparatorios`.
- `Permissao` ganhou `jornada:homologar`.

Migração `011_jornada_selecao_sustentabilidade.sql`:

- colunas `processos.selecao` e `processos.sustentabilidade`;
- tabela `politicas_orgao`;
- processos que já estavam na etapa 7 ficam marcados como legado e contratam pela regra anterior.

## 6. Variáveis de ambiente

Nenhuma variável nova. A trava do PoC-01 vale com qualquer valor de `AGORA_IA_PROVEDOR`.

## 7. Seção para o manual do usuário

> **Etapa 1 — artigo de luxo e minutas.** Enquanto um item do DFD tiver indício de artigo de luxo sem justificativa, a Ágora
> não gera nenhum documento — nem com a IA do órgão ligada. O painel **Formalização** mostra o aviso e, se você tentar gerar,
> a regra RN-01 com o item e o termo encontrado. Justifique em **Justificativa — bem de qualidade comum** (mínimo de 30
> caracteres) ou remova o item, clique em **Salvar DFD** e gere de novo.
>
> **Etapas 3 e 4 — sustentabilidade.** Preencha **Critérios de sustentabilidade ambiental** e **Logística reversa** e clique
> em **Salvar critérios**. Com a política do órgão ligada, o ETP e o TR só se concluem com os dois critérios. Se o TR foi
> gerado antes do preenchimento, use **Gerar nova versão**.
>
> **Etapa 4 — prova de conceito ou amostra.** Em **Parâmetros do edital**, escolha **Prova de conceito** ou **Amostra** e
> informe o prazo em dias úteis, o roteiro com os critérios de aprovação e a justificativa. Se o edital adotar a inversão de
> fases, ligue **Habilitação antes do julgamento das propostas** e registre a motivação.
>
> **Etapa 6 — atos da seleção.** Depois de registrar as propostas, siga o painel **Atos da seleção**. Ele mostra o próximo ato
> e os prazos.
>
> 1. **Prova ou amostra:** clique em **Convocar** e, após a sessão pública gravada, registre o resultado com a motivação e o
>    **Link da gravação**. Se reprovar, a Ágora convoca o próximo colocado.
> 2. **Habilitação:** registre **Habilitado** ou **Inabilitado**, com motivação.
> 3. **Recursos:** registre as intenções manifestadas no dia do ato ou clique em **Encerrar registro de intenções**. Havendo
>    recurso, registre as razões (3 dias úteis) e as contrarrazões (3 dias úteis). Depois, decida a reconsideração (3 dias
>    úteis).
> 4. **Autoridade competente designada:** decide o recurso que subir (10 dias úteis) e usa **Adjudicar o objeto** e
>    **Homologar a licitação**. A homologação publica os documentos da fase preparatória na página pública do edital.
>
> | Perfil | O que faz |
> |---|---|
> | Planejamento | Preenche os critérios de sustentabilidade |
> | Agente de contratação | Define a prova de conceito no edital; convoca e registra o resultado da prova, a habilitação, as manifestações e a reconsideração |
> | Gestor de contratos, quando designado autoridade competente | Decide o recurso, adjudica e homologa |
> | Administrador | Liga ou desliga a política em **Ajustes › Políticas do órgão** |
> | Cidadão, sem login | Baixa os documentos preparatórios em **Transparência › Editais publicados** |

## 8. Limitações e dependências externas

- **Divulgação no PNCP real:** é feita só na página pública da Ágora. O envio ao PNCP real depende da integração online do
  órgão, fora desta frente.
- **Link da gravação:** é registrado, mas a Ágora não verifica se o vídeo existe nem armazena a gravação, que fica no
  sistema de vídeo do órgão.
- **Intenção de recurso:** o registro é feito pelo agente com base na sessão. Não há portal do licitante para que ele
  manifeste a intenção, as razões ou as contrarrazões diretamente.
- **Reforma em recurso:** cobre desclassificar o vencedor e reintegrar licitante reprovado ou inabilitado. Anulação ou
  revogação da licitação (art. 71, II e III) e o retorno para saneamento (art. 71, I) não têm fluxo próprio. A licitação
  fracassada aparece como bloqueio que encaminha à autoridade.
- **Demonstração:** a autoridade competente dos processos do seed passou a ser o gestor de demonstração, para que a
  adjudicação e a homologação possam ser feitas com um login. O seed também traz os atos da seleção do processo das
  viaturas, que já estava na etapa 7.
- **Sessão de vídeo e sala de disputa:** a sala de disputa é da frente E, e as declarações de impedimento dos agentes são da
  frente F. Esta frente não alterou nenhuma das duas.
