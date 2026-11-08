# Jornada da contratação — especificação (API + interface)

Complementa `ARQUITETURA.md`, `INTERFACE.md` e os tipos `ProcessoResumo`/`ProcessoDetalhe` de `@agora/contratos`. As regras vêm de `@agora/dominio`; a API **não** reimplementa regra.

## 1. Modelo

- `processos`: `id`, `numero_sei` (sintético `08000.NNNNNN/AAAA-DV`), `titulo`, `orgao`, `etapa_atual` (1–7), `responsavel_id`, `uasg`, `criado_em`, `atualizado_em`. Colunas `jsonb`: `dfd`, `etp`, `riscos`, `cesta`, `parecer`, `publicacao`, `disputa`. Mais `contrato_id` (nulo).
- `processos_equipe` (`processo_id`, `papel`, `usuario_id`).
- `processos_arvore_sei` (`processo_id`, `numero`, `titulo`, `documento_id` nulo, `assinado_em`, `assinado_por`).
- `documentos_gerados` (campos de `DocumentoGerado` + `processo_id`, `conteudo` texto Markdown, `premissas` e `fontes` jsonb).
- O escopo por UASG vale também para processos.
- Toda escrita é auditada (`recurso = 'processo'`).

## 2. Regras de avanço (`POST /processos/:id/avancar`)

O avanço da etapa N para N+1 exige que **todos** os bloqueios da etapa N estejam resolvidos. Caso contrário, a API responde 422 `REGRA_NEGOCIO` com `detalhes` = mensagens dos bloqueios. `ProcessoDetalhe.bloqueiosDetalhe` lista os bloqueios da etapa atual; `sinais` lista os alertas que não bloqueiam.

| De → para | Bloqueios (regra) | Sinais |
|---|---|---|
| 1 → 2 | descrição da necessidade ≥ 30 caracteres; justificativa ≥ 30; ≥ 1 item com quantidade > 0 e valor > 0; sem catálogo padronizado → justificativa (RN-02, art. 19, § 2º); indício de artigo de luxo em qualquer item → justificativa (RN-01, art. 20, `sinalizarArtigoLuxo`) | não previsto no PCA (art. 12, VII) → atenção; fracionamento (RN-14, `avaliarFracionamento`, com as demais contratações do processo da mesma UASG e ano) |
| 2 → 3 | equipe com `equipe_planejamento`, `agente_contratacao` (ou `pregoeiro`) e `autoridade_competente`; `verificarSegregacao` válido (RN-03); documento "DFD" assinado na árvore SEI | vínculo societário (sinal, não bloqueio) |
| 3 → 4 | `validarEtp` completo (RN-04); ≥ 1 risco na matriz (art. 22); cesta com análise e ≥ 3 preços válidos após expurgos; alertas `FORNECEDOR_DIRETO_INSUFICIENTE` ou `SEM_JUSTIFICATIVA_FORNECEDOR` ausentes (RN-05); orçamento sigiloso → motivo (art. 24) | CV alto, cotações antigas |
| 4 → 5 | documentos `tr`, `edital` e `minuta_contrato` gerados com os parâmetros do edital vigentes e **aprovados** (revisão humana) — cada um guarda o hash dos parâmetros da geração; versão gerada com parâmetros anteriores não pode ser aprovada nem conta como aprovada (RN-06); RN-06 nos parâmetros do edital: sem faturamento mínimo e patrimônio líquido mínimo ≤ 10% do valor estimado (art. 69, §§ 2º e 4º) | parâmetros alterados depois da geração do TR, do edital ou da minuta (RN-06: lista o que gerar de novo) |
| 5 → 6 | parecer com conclusão `favoravel` ou `favoravel_com_ressalvas` (art. 53); publicação PNCP `publicado`; data de hoje ≥ `dataMinimaPropostas` (RN-15, art. 55, `dataMinimaAberturaPropostas`). Com a publicação na fila ou feita, o parecer fica imutável (`PUT /parecer` → 409 `CONFLITO`; nova manifestação jurídica é registrada no SEI) | |
| 6 → 7 | disputa com resultado sem sorteio pendente; vencedor sem sanção impeditiva vigente | vínculo societário entre licitantes (sócio em comum) |
| 7 | `POST /processos/:id/contratar` exige RN-09 (art. 91, § 4º): vencedor sem impedimento ou inidoneidade vigentes e regularidade fiscal/trabalhista. Cria o contrato na carteira (com tarefas do modelo de gestão de assinatura) e preenche `contratoGerado` | |

## 3. Documentos (geração por modelo, sem IA por padrão)

Gerados em Markdown a partir dos dados do processo, com `premissas` (dados usados) e `fontes` (artigos de lei). Sempre como rascunho, com a marca "Rascunho — requer revisão humana" até a aprovação.
- **DFD**: necessidade, justificativa, itens, previsão no PCA, unidade requisitante.
- **ETP**: os 13 incisos do art. 18, § 1º; ausências justificadas.
- **Matriz de riscos** (art. 22): tabela de riscos com alocação.
- **Nota técnica de pesquisa de preços**: parâmetros do art. 23, estatísticas, expurgos e justificativas, metodologia (IN SEGES/ME 65/2021).
- **TR** (art. 6º, XXIII): a) objeto, quantitativos e prazo; b) fundamentação; c) solução como um todo; d) requisitos; e) modelo de execução; f) modelo de gestão; g) medição e pagamento; h) seleção do fornecedor; i) estimativa de valor (ou indicação de sigilo, art. 24); j) adequação orçamentária.
- **Edital** (art. 25): objeto; participação e acesso sem cadastro prévio (art. 25, § 3º, e art. 87, § 2º); prazos (art. 55); julgamento e desempate (art. 60); habilitação (arts. 62 a 70, sem faturamento mínimo — art. 69, § 2º); recursos; sanções (arts. 155 e 156); fiscalização; pagamento.
- **Minuta de contrato**: as 19 cláusulas do art. 92 (I objeto; II vinculação ao edital e à proposta; III legislação aplicável; IV regime de execução; V preço, pagamento, reajuste e atualização monetária; VI medição, liquidação e pagamento; VII prazos de execução e recebimento; VIII crédito orçamentário; IX matriz de riscos; X prazo de resposta à repactuação; XI prazo de resposta ao reequilíbrio; XII garantias; XIII garantia do objeto e assistência técnica; XIV direitos, responsabilidades, penalidades e multas; XV importação e câmbio; XVI manutenção das condições de habilitação; XVII reserva de cargos; XVIII modelo de gestão; XIX extinção). Para software sob encomenda, cláusula de cessão de direitos (art. 93).
- **Checklist do parecer** (art. 53): DFD, ETP, matriz de riscos, pesquisa de preços, TR, minuta do edital, minuta do contrato, designação do agente e da equipe, segregação de funções, previsão orçamentária, PCA, publicidade e prazos.

IA (`AGORA_IA_PROVEDOR=openai_compativel`): o modelo de texto é enviado como base junto com os dados do processo. O retorno é marcado `geradoPor: 'ia'`, com o mesmo aviso. Em falha, a geração volta ao modelo de texto e registra um sinal. A IA nunca preenche conclusão de parecer, sanção ou habilitação.

## 4. Árvore SEI (simulação)

Cada documento aprovado entra na árvore com número sequencial (`NNNNNNNN`). "Assinar" registra quem assinou e quando. A tela deixa claro que **a integração real com o SEI e a assinatura ICP-Brasil dependem da API do SEI do órgão e de certificado**; aqui é uma simulação do fluxo.

## 5. Dados sintéticos

8 processos distribuídos pelas 7 etapas (ao menos um em cada), com objetos de segurança pública:
1. Viaturas caracterizadas (PRF)
2. Coletes balísticos nível III-A (SENASP)
3. Rádios digitais (PF)
4. Drones (SENASP)
5. Scanners corporais (SENAPPEN)
6. Licenças de software de perícia (PF)
7. EPIs para operações integradas (SENASP)
8. Munição de treinamento (PRF)

Cada processo tem os dados coerentes com a etapa em que está: DFD; equipe; ETP; riscos; cesta com 5 a 7 cotações, incluindo 1 outlier; documentos; parecer; publicação com data passada para permitir avanço; disputa com empate para demonstrar o art. 60. Há também um processo com conflito de segregação (e o DFD aprovado aguardando assinatura na árvore SEI) e um com indício de artigo de luxo, para demonstração.

## 6. Interface

Ver `INTERFACE.md` §6. Telas com id `jornada` (lista) e `jornada.detalhe`. Cada etapa tem o seu painel; o Modo Especificação mostra `regrasPorEtapa(n)`. "Exportar dossiê" abre a visão de impressão.
