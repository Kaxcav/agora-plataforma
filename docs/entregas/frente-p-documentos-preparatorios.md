# Frente P — documentos que faltavam na fase preparatória e dotação orçamentária (F20)

Entrega da função F20 do plano: as peças que completam a instrução da fase preparatória (portaria de designação, declaração de adequação orçamentária, despacho de autorização, nota técnica de encaminhamento à assessoria jurídica, anexos operacionais e caderno de testes da prova de conceito), o checklist de documentos do processo e a dotação orçamentária estruturada, que passa a ser condição para o processo seguir para o edital (RN-39). O conjunto é a RF-32.

## 1. O que foi feito (F20)

**Dotação orçamentária estruturada (RN-39).** Nas etapas 3 e 4, a seção **Dotação orçamentária** registra os créditos que pagam a contratação, um por linha (até 20):

| Campo | Formato conferido no servidor |
|---|---|
| Unidade gestora (UG) | 6 dígitos |
| Programa de trabalho | função.subfunção.programa.ação.localizador (`00.000.0000.0000.0000`; aceita digitado sem pontos) |
| Natureza da despesa | categoria.grupo.modalidade.elemento (`4.4.90.52`; aceita `449052`), com categoria 3 só nos grupos 1 a 3 e categoria 4 só nos grupos 4 a 6 |
| Fonte de recursos | 10 dígitos (ou 3 a 4 na classificação anterior) |
| Exercício | do ano corrente até 10 anos à frente; exige crédito do exercício em que a contratação é feita (art. 150) |
| Valor | em centavos, maior que zero |
| Pré-empenho (opcional) | `AAAAPE000000`, do mesmo exercício da linha |

- **Regra.** `validarDotacaoOrcamentaria` (domínio) aponta as pendências por linha e campo e transforma em sinal os créditos que não alcançam o valor estimado (a lei exige o crédito das parcelas do exercício, não do valor inteiro). Linhas repetidas não são aceitas.
- **Declaração da autoridade.** A declaração de adequação orçamentária é o documento **Declaração de adequação orçamentária** do painel de documentos da jornada: o agente ou o planejamento gera o texto com a dotação; a **autoridade competente designada no processo** o aprova e assina (permissão nova `jornada:autorizar` e designação conferida no servidor). A aprovação é recusada (422, RN-39) com dotação inválida ou se a declaração foi gerada com outra dotação.
- **Vínculo com a dotação.** A declaração, o TR e a minuta gravam no texto, em seção protegida, o hash SHA-256 da chave canônica da dotação (`chaveDotacao`). Mudar a dotação desatualiza a declaração e exige nova versão do TR e da minuta. A alteração entra na trilha (`processo.dotacao.atualizar`, com o hash anterior e o novo).
- **TR e minuta.** A alínea "j" do TR traz a tabela dos créditos (sem os valores, quando o orçamento é sigiloso — art. 24); a cláusula do crédito orçamentário da minuta (art. 92, VIII) traz a classificação de cada crédito e a indicação, por apostilamento, dos créditos dos exercícios seguintes (art. 136, IV). As duas seções são protegidas: a IA não as redige.
- **Bloqueio.** Na etapa 4, `verificarDotacaoParaEdital` bloqueia o avanço para a etapa 5 (o edital vai à assessoria jurídica e à publicação) enquanto a dotação não estiver válida, a declaração aprovada com ela e o TR e a minuta atuais não a trouxerem.
- **Parecer.** A evidência do item "Previsão de recursos orçamentários" do checklist do parecer (art. 53) passa a citar a dotação e a declaração aprovada.

**Peças complementares (RF-32).** Todas entram no mesmo painel de documentos da jornada (`Documentos.tsx` e `jornada/documentos.ts`), com versões, aprovação humana registrada na trilha, entrada na árvore do SEI e PDF. Aparecem abaixo do painel da etapa em que fazem sentido:

| Peça | Etapas | Quem aprova e assina | Conteúdo |
|---|---|---|---|
| Portaria de designação da equipe e dos agentes | 2 a 7 | autoridade designada | designações registradas (RN-03), vínculo e capacitação declarados e validade da declaração de impedimento de cada agente (RN-28), atribuições por função, segregação (art. 7º, § 1º), sem CPF nem e-mail |
| Declaração de adequação orçamentária | 3 e 4 | autoridade designada | créditos, totais, pendências e a declaração (art. 150; LC 101/2000, art. 16, II) |
| Despacho de autorização da contratação | 4 e 5 | autoridade designada | documentos examinados e a decisão sugerida conforme o caso: encaminhar à assessoria jurídica, autorizar a divulgação do edital após o parecer (art. 53, § 3º) ou autorizar a contratação direta (art. 72, VIII); só é aprovado com a dotação declarada |
| Nota técnica à assessoria jurídica | 4 e 5 | equipe | síntese da contratação, situação das peças das etapas 1 a 4 e **quesitos objetivos** de `gerarQuesitosControleLegalidade` (art. 53) |
| Modelo de proposta comercial | 4 | equipe | itens e quantidades do DFD para o licitante preencher, sem o valor estimado; declarações (art. 63, IV e § 1º; LC 123/2006) e compromisso com a prova de conceito, se exigida |
| Modelo de ordem de serviço ou de fornecimento | 4 | equipe | ordem de serviço (serviços) ou de fornecimento (bens), período antecedente (art. 92, § 2º), prazos, gestor e fiscais |
| Modelo de termo de compromisso e de sigilo | 4 | equipe | sigilo de informações e de dados pessoais (art. 13; Lei 12.527/2011; LGPD, arts. 39, 46 e 48) e termo de ciência dos profissionais |
| Modelos de termos de recebimento provisório e definitivo | 4 | equipe | verificações e a forma de cada recebimento (art. 140, I e II, §§ 2º e 3º; art. 141) |
| Caderno de testes da prova de conceito | 4 a 6 | equipe | regras da sessão pública gravada, casos de teste montados do roteiro do edital (`montarCasosTesteProvaConceito`), **planilha de julgamento da comissão** com a regra de consolidação e os resultados já registrados na seleção (F1, RN-20); "não se aplica" sem exigência no edital |
| Checklist de documentos do processo | 1 a 7 | equipe | cópia, para os autos, do checklist por etapa |

- **Sem IA nos atos da autoridade.** Portaria, declaração, despacho, caderno da prova de conceito e checklist nunca passam pela IA. A nota técnica e os modelos podem ser redigidos pela IA auto-hospedada, quando habilitada, com os quesitos em seção protegida.
- **PDF.** Rota nova `GET /processos/:id/documentos/:docId/pdf`, para qualquer versão de qualquer documento da jornada, gerada por `pdf-texto.ts`: os marcadores internos saem do texto, as tabelas viram listas e os dados pessoais escritos no texto são tarjados. O visualizador ganhou o botão **Baixar PDF**.
- **Dossiê.** O dossiê imprimível passa a incluir as peças complementares geradas.

**Checklist de documentos do processo (RF-32).** A seção **Checklist de documentos do processo**, em todas as etapas, mostra por etapa (1 a 5) cada peça, a exigência (obrigatória, condicional ou recomendada), a situação (pronta, em rascunho, desatualizada, falta ou não se aplica), a versão, a assinatura no SEI e o fundamento. `montarChecklistPecas` (domínio) decide a situação; o servidor apura a versão atual, a assinatura e se ela foi gerada com parâmetros do edital ou dotação anteriores.

**Carga sintética.** Os processos que já passaram da etapa 3 recebem uma dotação fictícia (UG igual à UASG, programa e ação `06.xxx.9xx0.AGxx.0001`, fonte `1001000000`, pré-empenho `AAAAPE0041xx`) e a declaração aprovada e assinada pela autoridade, datadas da entrada na etapa 4. Nenhum valor, código ou nome vem da conversa do cliente nem de `reference/`.

## 2. Linhas da conversa atendidas

| Linhas | Pedido (resumo) | Onde está |
|---|---|---|
| 44 | Alinhamento da demanda às leis orçamentárias | dotação estruturada nas etapas 3 e 4 e RN-39 |
| 569 | Portaria tornando o uso obrigatório e designação de multiplicadores (mitigação do risco de baixa adesão) | a portaria da frente é a de designação do processo; a portaria institucional de uso da plataforma é ato do órgão, fora do processo (ver seção 8) |
| 817–827, 988 | Adequação orçamentária do TR com gestão/unidade, fonte, programa de trabalho e elemento de despesa; cláusula do crédito orçamentário da minuta | campos estruturados, alínea "j" do TR e cláusula do art. 92, VIII, gerados da dotação |
| 942 | Período antecedente à ordem de serviço (art. 92, § 2º) | modelo de ordem de serviço ou de fornecimento |
| 1701–1729 | Caderno de casos de teste da PoC com a planilha de julgamento da comissão; nota técnica de encaminhamento à CONJUR com checklist da fase preparatória e quesitos ao controle de legalidade (art. 53) | caderno da prova de conceito ligado aos parâmetros e aos resultados da PoC (F1) e nota técnica com quesitos gerados dos dados |
| 2074–2239 | Checklist dos documentos prontos e dos que faltam | checklist por etapa, na tela e como documento |
| 2247–2271 | Portaria de designação da equipe e do agente com termos de ciência e segregação | portaria com declarações (RN-28) e segregação (RN-03) |
| 2284–2290 | Declaração de disponibilidade e adequação orçamentária do ordenador | declaração aprovada pela autoridade designada (RN-39) |
| 2291–2303, 2350 | Modelos de anexos operacionais: proposta, ordem de serviço, termo de sigilo, recebimento provisório e definitivo | cinco modelos |
| 2317–2324, 2354 | Despacho de aprovação e autorização da autoridade competente | despacho de autorização |

Já existiam e não foram duplicados: DFD (linha 2247), nota técnica de pesquisa de preços (2272) e checklist do parecer jurídico. A grade de pontuação técnica (2304) é da F3.

## 3. Equivalentes lícitos adotados e motivo

- **Declaração do ordenador de despesas.** A conversa atribui a declaração ao ordenador (subsecretário ou diretor). Na Ágora, quem aprova é a **autoridade competente designada na equipe do processo**, com a permissão `jornada:autorizar`; o órgão designa como autoridade quem tem a competência de ordenar a despesa. A plataforma não declara nada sozinha: só confere os campos e mostra o que falta.
- **Pré-empenho e saldo.** A Ágora não consulta o sistema financeiro (Siafi) para confirmar o saldo: o pré-empenho é informado pela área orçamentária e a existência do crédito é declarada pela autoridade. Créditos menores que o valor estimado viram sinal, não bloqueio, porque a lei exige o crédito das parcelas do exercício (art. 150).
- **Quesitos à CONJUR.** A conversa pede fundamentação jurídica da legalidade de pontos específicos. A nota técnica traz **perguntas** objetivas, com o fundamento e o dado do processo que as motivou; nenhuma resposta ou conclusão jurídica é sugerida (regra 5: IA e modelos não decidem).
- **Planilha de julgamento.** A planilha é preenchida e assinada pela comissão; a regra de consolidação (aprovado só com todos os casos atendidos) é descrita, e o resultado continua registrado pelo agente na seleção (RN-20), com motivação e gravação. O sistema não julga a prova.
- **Termo de sigilo policial.** O modelo cobre sigilo de informações de segurança pública e de dados pessoais com os fundamentos gerais (art. 13 da Lei 14.133, Lei de Acesso à Informação e LGPD); a classificação de cada informação é ato do órgão.
- **Despacho.** O texto da decisão é sugestão de redação conforme a situação do parecer; a decisão é da autoridade e só produz efeito com a sua aprovação e assinatura.

## 4. Regras novas

| Código | Tipo | Etapa | Implementação |
|---|---|---|---|
| RN-39 | Regra de negócio | 4 | `validarDotacaoOrcamentaria`, `chaveDotacao`, `verificarDotacaoParaEdital`; API: `GET` e `PUT /processos/:id/dotacao`, `POST /processos/:id/avancar` |
| RF-32 | Requisito funcional | 4 | `gerarQuesitosControleLegalidade`, `montarCasosTesteProvaConceito`, `montarChecklistPecas`; API: `POST /processos/:id/documentos/gerar`, `GET /processos/:id/checklist-documentos`, `GET /processos/:id/documentos/:docId/pdf` |

Permissão nova: `jornada:autorizar` (perfis **Gestor de contratos** e **Administrador**), para aprovar e assinar a portaria, a declaração orçamentária e o despacho, sempre com a designação como autoridade competente conferida no servidor.

## 5. Rotas novas (`/api/v1`)

| Rota | Permissão | Descrição |
|---|---|---|
| `GET /processos/:id/dotacao` | `jornada:ler` | dotação, totais, pendências, sinais e situação da declaração |
| `PUT /processos/:id/dotacao` | `jornada:editar` | substitui a dotação (até a etapa 4); auditada |
| `GET /processos/:id/checklist-documentos` | `jornada:ler` | checklist das peças por etapa |
| `GET /processos/:id/documentos/:docId/pdf` | `jornada:ler` | PDF de uma versão de documento, gerado no servidor |

Alterações nas rotas existentes: `POST /processos/:id/documentos/gerar` aceita os 11 tipos novos; `POST /processos/:id/documentos/:docId/aprovar` e `POST /processos/:id/sei/assinar` exigem `jornada:autorizar` e a designação para os atos da autoridade e conferem a dotação na declaração e no despacho; `POST /processos/:id/avancar` aplica a RN-39 na etapa 4.

Migração `025_documentos_preparatorios_dotacao.sql`: tabela `processos_dotacoes`. A restrição de tipo de `documentos_gerados` passa a conferir o formato do código; a lista fechada de tipos fica na aplicação (zod e `@agora/contratos`). **Atenção na união das frentes:** outra frente que redefina `documentos_gerados_tipo_check` com uma lista fechada, em migração posterior à 025, recusaria os tipos desta frente.

## 6. Variáveis de ambiente

Nenhuma. A frente não chama serviço externo.

## 7. Seção para o manual do usuário

> Para entrar na seção 9 (Jornada da contratação), depois das etapas, como **Peças complementares, dotação e checklist**.

**Dotação orçamentária.** Nas etapas 3 e 4, quem tem os perfis **Planejamento** ou **Agente de contratação** informa os créditos que pagam a contratação. **Gestor de contratos**, **Assessoria jurídica** e **Auditor** veem a dotação, sem alterar.

1. Em **Dotação orçamentária**, preencha cada **Crédito**: **Unidade gestora**, **Programa de trabalho**, **Natureza da despesa**, **Fonte de recursos**, **Exercício**, **Valor do crédito** e, se já houver, o **Pré-empenho**. Use **Incluir crédito** para cada fonte, natureza ou exercício.
2. Clique em **Salvar dotação**. A Ágora confere os formatos e mostra as pendências, como crédito do exercício que falta ou natureza da despesa incoerente.
3. Em **Peças complementares da instrução**, gere a **Declaração de adequação orçamentária**.
4. A autoridade competente designada no processo abre a declaração em **Visualizar**, revisa, clica em **Aprovar** e assina na **Árvore do processo SEI**. A etiqueta passa a **Declarada pela autoridade**.

Sem a dotação declarada, o processo não avança da etapa 4 para a 5 (RN-39). Se a dotação mudar depois da declaração, a etiqueta passa a **Declaração desatualizada**: gere nova versão da declaração para a autoridade aprovar e gere de novo o TR e a minuta, que trazem a dotação.

**Peças complementares da instrução.** Abaixo do painel de cada etapa aparecem as peças daquela fase:

- etapa 2 em diante: **Portaria de designação da equipe e dos agentes**;
- etapas 3 e 4: **Declaração de adequação orçamentária**;
- etapa 4: **Modelo de proposta comercial**, **Modelo de ordem de serviço ou de fornecimento**, **Modelo de termo de compromisso e de sigilo** e os **Modelos de termo de recebimento provisório e definitivo**;
- etapas 4 a 6: **Caderno de testes da prova de conceito**, com a planilha de julgamento da comissão;
- etapas 4 e 5: **Despacho de autorização da contratação** e **Nota técnica à assessoria jurídica**;
- todas: **Checklist de documentos do processo**.

Quem gera: **Planejamento** e **Agente de contratação**, com **Gerar rascunho** ou **Gerar nova versão**. Quem aprova:

- a portaria, a declaração e o despacho: só a **autoridade competente designada** no processo (normalmente com o perfil **Gestor de contratos**), que também os assina na árvore do SEI;
- as demais peças: a própria equipe.

Cada peça mostra as premissas e as fontes, e o botão **Baixar PDF** gera o arquivo no servidor. A nota técnica traz **quesitos** à assessoria jurídica montados com os dados do processo: são perguntas, e a análise e a conclusão são da assessoria jurídica. O caderno da prova de conceito traz os casos de teste do roteiro do edital e a planilha que a comissão preenche e assina; o resultado continua registrado na etapa 6.

**Checklist de documentos do processo.** Em qualquer etapa, clique em **Ver checklist** para ver, por etapa, as peças prontas, em rascunho, desatualizadas e as que faltam, com a exigência, a versão, a assinatura no SEI e o fundamento. Para juntar uma cópia aos autos, gere o documento **Checklist de documentos do processo**.

## 8. Limitações e o que depende de acesso externo

- **Siafi.** A Ágora não reserva crédito nem consulta saldo no Siafi; pré-empenho e saldo são informados pela área orçamentária. A integração com o sistema financeiro depende de acesso do órgão.
- **Registro de preços.** Na licitação para registro de preços, a indicação dos recursos pode ficar para a formalização do contrato; a jornada ainda não distingue o registro de preços, e a RN-39 vale para todos os processos na etapa 4.
- **Portaria institucional (linha 569).** A portaria que torna obrigatório o uso da plataforma e designa multiplicadores é ato normativo do órgão, sem processo de contratação: não foi modelada.
- **Assinatura.** A assinatura continua simulada na árvore do SEI; a assinatura ICP-Brasil real depende da integração com o SEI do órgão.
- **Anexos no PNCP.** Os modelos operacionais não entram ainda no pacote publicado no PNCP nem no inteiro teor da página pública (que publica edital, TR e minuta); isso exige ampliar a publicação da frente B.
- **Texto da lei.** A conferência do texto dos arts. 6º, XXIII, "j", 7º, 8º, 18, 53, 72 e 150 pelo WebFetch não foi possível: o portal do Planalto respondeu "Acesso negado" e o DOU e o LexML não responderam. Os fundamentos citados seguem a redação vigente conhecida; vale uma conferência na fonte oficial.
