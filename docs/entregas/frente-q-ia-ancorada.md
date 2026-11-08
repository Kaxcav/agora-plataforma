# Frente Q — IA ancorada, conferência de citações e conferência cruzada (F24)

Entrega da frente Q do plano (`docs/PLANO-NOVAS-FUNCOES.md`, F24): base normativa soberana da Lei 14.133/2021, ancoragem
da redação por IA (RAG) nessa base, conferência das citações legais de todo rascunho com o IMR-02, conferência cruzada entre
os documentos do processo e o auditor contínuo da 2ª linha de defesa.

## 1. O que foi feito

### F24 — Base normativa soberana (RNF-08)

- **Texto oficial da Lei 14.133/2021 no repositório**, em `apps/api/dados/normas/lei-14133-2021.json`:
  - estruturado por artigo, parágrafo, inciso e alínea, com as divisões (título, capítulo, seção e subseção) de cada artigo;
  - 196 artigos: do 1º ao 194 e os acrescidos 44-A e 184-A;
  - o texto que um artigo insere em outra lei (Código Penal, CPC etc.) fica à parte e não vira dispositivo;
  - dispositivos vetados e revogados ficam marcados pelo próprio texto ("(VETADO)", "(Revogado)").
- **Proveniência** gravada no próprio arquivo:
  - fonte: Câmara dos Deputados, Legislação Informatizada, texto compilado ("norma atualizada");
  - endereço: `https://www2.camara.leg.br/legin/fed/lei/2021/lei-14133-1-abril-2021-791222-normaatualizada-pl.docx`;
  - obtido em 08/11/2026;
  - SHA-256 do arquivo baixado: `52c07732e02484309ae084ddfacb474a5b7241bc49651c0e8ae21967ec9bd279`;
  - SHA-256 do texto extraído: `bc54405d54a9ff9ee08ee97128e48ff6a9230428efd5b3a2f88e92b504995498`.
- **Geração reprodutível**: `node apps/api/src/cli/base-normativa.ts --texto <arquivo.txt> --url … --sha256-arquivo … --obtido-em … --formato … --fonte …`.
  - O texto de entrada é o de cada parágrafo do `.docx` oficial, um por linha.
  - A estruturação é a função pura `estruturarTextoLei`, com testes.
- **Busca de recuperação local (BM25F)**, sem serviço externo nem embeddings de terceiros:
  - três campos ponderados: divisões do artigo, caput e demais dispositivos;
  - o artigo pedido pelo número ("art. 75", "75", "artigo 44-A") vem primeiro;
  - cada resultado traz os trechos que contêm os termos procurados;
  - exemplos conferidos nos testes: "dispensa de licitação" → art. 75; "artigo de luxo" → art. 20; "pagamento antecipado" → art. 145; "matriz de riscos" → art. 22.
- **Modelos padronizados como estrutura** (art. 19, IV), sem copiar texto de terceiros:
  - seções e cláusulas obrigatórias de ETP (art. 18, § 1º, I a XIII), matriz de riscos, TR (art. 6º, XXIII, "a" a "j"), edital (art. 25) e minuta (art. 92, I a XIX);
  - cada seção com o fundamento, conferido contra a base nos testes;
  - `conferirEstruturaModelo` diz quais seções o documento tem e quais faltam.
- **Tela "Base normativa"** (`/base-normativa`): busca, artigo estruturado com navegação entre artigos, estrutura da lei, modelos padronizados e a origem do texto.

### F24 — Ancoragem da redação por IA (RAG)

Com o LLM auto-hospedado ligado (`AGORA_IA_PROVEDOR=openai_compativel`, já existente), o prompt de cada rascunho passa a levar:

- o texto, recuperado da base, de cada dispositivo da Lei 14.133/2021 que o modelo de texto cita;
- os artigos recuperados pela busca BM25F para o objeto;
- as seções obrigatórias do modelo padronizado do documento;
- a regra de citação: só citar o que está nos trechos e no rascunho, e o aviso de que toda citação será conferida.

O prompt continua indo só ao endpoint do órgão. Com o provedor padrão (`nenhum`), nada muda: o modelo de texto determinístico redige.

### F24 — Conferência de citações e IMR-02 (RIA-14)

- **Leitura das citações** (`extrairCitacoesLegais`):
  - "art. 75, § 3º", "art. 18, § 1º, incisos I a XIII, e § 2º", "art. 124, II, "d"", "arts. 62 a 70";
  - forma invertida: "alínea "a" do inciso XVIII do caput do art. 6º";
  - norma citada antes ou depois: "do Decreto 10.947/2022", "LC 123/2006, art. 48".
  - Sem norma expressa, vale a Lei 14.133/2021. A exceção é a citação logo depois de outra norma, na mesma frase ("…(LC 123/2006, art. 48, I), ressalvadas as hipóteses do art. 49"): ela segue a norma anterior.
- **Conferência** (`conferirCitacoesLegais`):
  - **inexistente**: artigo, parágrafo, inciso ou alínea que não existe, com o motivo ("O art. 75 não tem § 9º: tem §§ 1º a 7º");
  - **sem efeito**: dispositivo vetado ou revogado;
  - **assunto não confere** (suspeita): a frase tem ao menos 4 termos de conteúdo, nenhum deles aparece no dispositivo citado (nem no caput nem nas divisões do artigo) e outro artigo trata claramente do assunto. Esse artigo vira a sugestão;
  - **outra norma**: não conferida, por estar fora da base.
- **Calibração**: os 42 rascunhos da carga sintética têm 949 citações. Nenhuma foi apontada, e todos têm a estrutura completa do modelo.
- **Em todo documento gerado**:
  - a conferência aparece ao lado do texto, na visualização do documento;
  - o resumo vai para a trilha, no evento `processo.documento.gerar`;
  - a conferência é recalculada do texto guardado, com cache pelo hash.
- **Trava da aprovação**: rascunho com citação inexistente ou sem efeito só é aprovado depois da revisão humana das citações.
  - A revisão é registrada com justificativa, em `POST /processos/:id/documentos/:docId/citacoes/revisao`, auditada.
  - A trava vale para todo rascunho: com o LLM, para a citação inventada pela IA; sem ele, para a citação digitada nos campos do processo.
- **Painel "Qualidade normativa"** (`/qualidade-normativa`):
  - IMR-02 do mês: percentual de minutas com citações fiéis, com meta de 100%;
  - série dos últimos 6 meses;
  - números por documento e por origem (modelo de texto ou IA);
  - aderência à estrutura dos modelos;
  - citações apontadas, com trecho, motivo e sugestão;
  - conferência de um texto colado, sem gravar nada.

### F24 — Conferência cruzada (RIA-15)

- **Tela "Conferência dos documentos"** (`/jornada/:id/conferencia`), aberta pelo botão **Conferir documentos** no processo.
- **O que compara**, na versão mais recente de DFD, ETP, matriz de riscos, nota técnica, TR, edital e minuta:
  - objeto e natureza;
  - quantidade e unidade de cada item;
  - valor global estimado;
  - prazos: vigência, entrega, propostas e prova de conceito;
  - dotação: exercício, natureza da despesa, fonte, programa de trabalho e PTRES;
  - modalidade e critério de julgamento.
- **Como apresenta**: cada divergência sai com o valor e o trecho de cada documento e o fundamento, como sinal que requer revisão humana.
- **Calibração**: a carga sintética não tem divergências; os testes criam a divergência de quantidade entre o ETP e o TR.

### Auditor IA contínuo na 2ª linha (RIA-04 da conversa, aqui dentro de RIA-15)

- **Onde aparece**: seção **Auditor contínuo** na aba da 2ª linha de **Controle › Linhas de defesa**. A mudança no painel da frente H foi de uma linha.
- **Rota**: `GET /controle/auditor-ia`.
- **Sinais determinísticos, com fundamento e evidências**:
  - nota fiscal duplicada no contrato;
  - nota com valor acima de 2,5 vezes a mediana;
  - notas acima do valor global;
  - pagamento antes do atesto (art. 145);
  - reajuste antes de 1 ano da data-base;
  - quantidade recebida acima da contratada;
  - valor contratado acima da estimativa do processo (sobrepreço, art. 6º, LVI);
  - processo com documentos divergentes;
  - documento aprovado com citação apontada.
- **O que não duplica**: os achados que a frente H já tem (limite do art. 125, ordem cronológica, fiscal, PNCP) não foram repetidos.

### Correção num modelo de texto da frente A

O TR citava o recebimento ao contrário: compras como "art. 140, I" e serviços como "art. 140, II". Na lei, o inciso I trata de obras e serviços e o II, de compras. Foi corrigido em `jornada/documentos.ts` (2 caracteres).

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde está |
|---|---|---|
| 510–512 | Risco R02: alucinação da IA; RAG restrito às bases oficiais e validação humana | RNF-08 (base local), ancoragem do prompt, RIA-14 (conferência e trava da aprovação) |
| 757–758 | IMR-02: 100% de minutas com citações fiéis à lei e aos modelos | Painel de qualidade normativa (IMR-02 mensal e série) |
| 1417–1421 e 1437–1440 | RF-01.2 integrado aos modelos padronizados (art. 19, IV); RIA-01.1 com ancoragem estrita, IMR-02 = 100% | Estrutura dos modelos, ancoragem e conferência |
| 1801 | TR, edital e minuta pelos modelos oficiais (art. 19, IV) | Estrutura obrigatória conferida em cada documento |
| 1805 | RIA-04 da etapa 4: consistência cruzada de prazos, quantidades e dotações | RIA-15, conferência cruzada |
| 1143 e 1317 | RIA-04 "Auditor IA contínuo": notas fiscais, medições e aditivos | Auditor contínuo na 2ª linha |
| 652 | Redação assistida com base nos modelos padronizados | Ancoragem e estrutura dos modelos |

## 3. Equivalentes lícitos e decisões

| Pedido | O que foi feito | Por quê |
|---|---|---|
| "Integrado aos modelos padronizados da AGU" | Entram as seções e cláusulas obrigatórias, com o fundamento na lei. O texto dos modelos não foi copiado | Instrução do projeto: não copiar texto de terceiros. A estrutura vem da própria lei |
| "Zero alucinação", "RAG" | BM25F local e conferência determinística de toda citação. O rascunho com citação inexistente não é aprovado sem revisão humana registrada | Regra 5: IA só redige e sinaliza. Nada de embeddings ou serviço de terceiros (regra 4) |
| Texto oficial pelo planalto.gov.br | Texto compilado da Câmara (legin), com fonte, data e hashes | O planalto recusou o acesso automatizado (página "Acesso negado"), como já relatado pela frente H |
| "Auditor IA" que detecta sobrepreço e superfaturamento | Sinais determinísticos com evidências e o aviso "requerem revisão humana" | Regra 5: o sinal não acusa, não glosa e não sanciona |
| Glosa do IMR-02 | O painel mede; a glosa fica com o gestor e o fiscal do contrato | É decisão humana do contrato da plataforma |
| Código do auditor | O "Auditor IA" (RIA-04 da conversa) entrou em RIA-15 | Só RIA-14, RIA-15 e RNF-08 estavam reservados. A RIA-04 do catálogo já é a redação assistida |

## 4. Regras novas no catálogo

- **RNF-08 — Base normativa soberana e busca na lei.** Lei 14.133/2021, art. 19, IV; Lei 9.610/1998, art. 8º, IV. Tela `normas.base`.
- **RIA-14 — Conferência das citações legais e precisão normativa (IMR-02).** Art. 19, IV, e art. 53. Etapa 4; telas `normas.qualidade`, `jornada.detalhe` e `jornada.conferencia`.
- **RIA-15 — Conferência cruzada dos documentos e auditor contínuo.** Art. 6º, XXIII, LVI e LVII, arts. 18, 25 e 92, art. 145 e art. 169. Etapa 4; telas `jornada.conferencia` e `controle`.

Funções novas do domínio, todas com testes:

- `normas/termos.ts`: `termosNormativos`, `radicalNormativo`;
- `normas/base-normativa.ts`: `estruturarTextoLei`, `localizarDispositivo`, `formatarReferenciaDispositivo`;
- `normas/busca-normativa.ts`: `indexarBaseNormativa`, `buscarNaBaseNormativa`, `pontuarArtigos`;
- `normas/citacoes-legais.ts`: `extrairCitacoesLegais`, `conferirCitacoesLegais`;
- `normas/modelos-padronizados.ts`: `MODELOS_PADRONIZADOS`, `conferirEstruturaModelo`;
- `lei14133/conferencia-cruzada.ts`: `extrairFatosDocumento`, `conferirDocumentosCruzados`;
- `lei14133/auditor-continuo.ts`: `sinaisAuditorContinuo`.

## 5. Rotas novas

| Método e rota | Permissão |
|---|---|
| `GET /normas` | `normas:ler` |
| `GET /normas/busca?q&limite` | `normas:ler` |
| `GET /normas/artigos/:numero` | `normas:ler` |
| `GET /normas/modelos` | `normas:ler` |
| `POST /normas/conferir` (texto colado; nada é gravado) | `normas:ler` |
| `GET /processos/:id/citacoes` | `jornada:ler` (escopo de UASG) |
| `POST /processos/:id/documentos/:docId/citacoes/revisao` (auditada) | `jornada:editar`; no checklist do parecer, `jornada:aprovar_juridico` |
| `GET /processos/:id/conferencia-cruzada` | `jornada:ler` (escopo de UASG) |
| `GET /qualidade-normativa?mes&uasg` | `qualidade_ia:ler` (escopo de UASG) |
| `GET /controle/auditor-ia?uasg` | `controle:segunda_linha` (escopo de UASG) |

**Mudança em rota existente:** `POST /processos/:id/documentos/:docId/aprovar` responde 422 (`RIA-14`) quando o rascunho tem citação inexistente ou sem efeito e a revisão das citações não foi registrada.

**Permissões novas**, acrescentadas no fim de `TODAS_PERMISSOES` e do tipo `Permissao`:

| Permissão | Perfis |
|---|---|
| `normas:ler` | gestor de contratos, fiscal, planejamento, agente de contratação, assessoria jurídica, controle interno; o auditor recebe pelas permissões de leitura |
| `qualidade_ia:ler` | gestor de contratos, planejamento, agente de contratação, assessoria jurídica, controle interno; auditor pelas de leitura |

**Banco**: migração `026_ia_ancorada_citacoes.sql`, com a tabela `revisoes_citacoes` (uma revisão por versão de documento, com hash, citações apontadas, justificativa, autor e data).

**Implantação**: o `deploy/Dockerfile` passou a copiar `apps/api/dados` para a imagem.

## 6. Variáveis de ambiente

Nenhuma nova. A ancoragem usa o provedor já configurado por `AGORA_IA_PROVEDOR`, `AGORA_IA_URL`, `AGORA_IA_MODELO` e `AGORA_IA_CHAVE`.

## 7. Seção pronta para o manual do usuário

> Sugestão de inclusão depois da seção da jornada da contratação.

### Base normativa e qualidade normativa

A Ágora guarda o texto oficial da Lei 14.133/2021, organizado por artigo, parágrafo, inciso e alínea. Com ele, a Ágora:

- confere cada citação dos rascunhos;
- compara os documentos do processo entre si;
- dá à IA do órgão, quando ligada, os trechos da lei que ela pode citar.

Nada disso sai da Ágora.

#### Consultar a lei

Perfis: gestor de contratos, fiscal, planejamento, agente de contratação, assessoria jurídica, controle interno, auditor e administrador.

1. No menu, abra **Lei e qualidade normativa › Base normativa**.
2. Em **Buscar na Lei 14.133/2021**, escreva o assunto (por exemplo, "dispensa de licitação") ou o número do artigo ("art. 75") e clique em **Buscar**.
3. Clique em **Ler o art. …** para ver o artigo completo. Use **Artigo anterior** e **Próximo artigo** para navegar.

A página mostra também a estrutura obrigatória de cada documento (ETP, TR, edital, minuta e matriz de riscos) e a origem do texto: fonte oficial, data e código de verificação (hash).

#### Conferência das citações nos rascunhos

Ao abrir um documento gerado na jornada, a coluna da direita mostra **Citações legais (conferência com a lei)**:

- **Dispositivo inexistente**: o artigo, parágrafo, inciso ou alínea não existe na lei;
- **Vetado ou revogado**: o dispositivo não está em vigor;
- **Assunto não confere**: o trecho trata de outro assunto, e a Ágora sugere o artigo que parece correto;
- **Outra norma**: citação de decreto, lei complementar ou instrução normativa, que não é conferida.

> **Atenção.** Rascunho com citação inexistente ou vetada não pode ser aprovado enquanto a revisão das citações não for registrada.

Para registrar a revisão (planejamento, agente de contratação e administrador; no checklist do parecer, assessoria jurídica):

1. Confira cada citação apontada.
2. Clique em **Registrar revisão das citações**.
3. Escreva a justificativa (mínimo de 30 caracteres) e clique em **Registrar revisão**.

A revisão fica na trilha de auditoria e libera a aprovação, que continua sendo um ato separado. Quando a citação estiver errada, o melhor caminho é corrigir o dado do processo e gerar nova versão.

#### Conferir os documentos do processo entre si

Perfis: todos que consultam a jornada.

1. No processo, clique em **Conferir documentos**.
2. A tela compara a versão mais recente de cada documento:
   - objeto;
   - quantidades;
   - valor estimado;
   - prazos;
   - dotação;
   - modalidade e critério de julgamento.
3. Cada divergência mostra o valor e o trecho de cada documento. Corrija o dado e gere nova versão do documento errado.

#### Painel de qualidade normativa (IMR-02)

Perfis: gestor de contratos, planejamento, agente de contratação, assessoria jurídica, controle interno, auditor e administrador.

Em **Lei e qualidade normativa › Qualidade normativa**:

- o **IMR-02 no mês** é o percentual de minutas geradas com todas as citações fiéis à lei, com meta de 100%;
- a tabela mostra os últimos 6 meses;
- a lista **Citações apontadas no mês** mostra o processo, o documento, o trecho e o motivo.

Use **Conferir as citações de um texto** para colar um trecho de minuta, parecer ou edital e ver as citações apontadas. O texto não é gravado.

O indicador é calculado automaticamente: a decisão sobre correção e glosa do contrato é do gestor e do fiscal.

#### Auditor contínuo (2ª linha de defesa)

Perfis: assessoria jurídica, controle interno, auditor e administrador.

Na aba **2ª linha** de **Controle › Linhas de defesa**, a seção **Auditor contínuo** lista sinais sobre os contratos:

- nota fiscal duplicada ou com valor fora do padrão;
- notas acima do valor do contrato;
- pagamento antes do atesto;
- reajuste antes de 1 ano;
- quantidade recebida acima da contratada;
- valor contratado acima do estimado.

Também mostra processos com documentos divergentes e documentos aprovados com citação apontada.

Cada sinal traz as evidências e o fundamento. Os sinais não são conclusão de irregularidade: quem confere e decide o encaminhamento é a 2ª linha.

## 8. Limitações e o que depende de acesso externo

- **Atualização da lei**:
  - a base é o texto compilado de 08/11/2026;
  - alterações posteriores pedem nova obtenção e nova geração com a CLI, e o hash muda;
  - não há sincronização automática, porque o planalto.gov.br recusa acesso automatizado;
  - uma integração com a API de normas (LexML ou normas.leg.br) depende de acordo e de conector no servidor.
- **Outras normas**:
  - decretos, instruções normativas, LC 123/2006 e Constituição aparecem como "outra norma" e não são conferidos;
  - incluí-los é acrescentar arquivos na mesma estrutura.
- **Assunto da citação**:
  - a conferência do assunto é conservadora: só aponta quando nenhum termo da frase aparece no dispositivo citado e outro artigo trata claramente do assunto;
  - erro sutil entre incisos do mesmo artigo pode passar.
- **Conferência cruzada**:
  - lê tabelas de itens e frases-padrão dos modelos da Ágora;
  - texto muito reescrito pela IA pode deixar dados sem comparação: o dado ausente não é comparado, e não aparece como divergência.
- **Carga sintética**:
  - não tem anomalias financeiras nem divergências, de propósito: a calibração mostrou zero falso positivo;
  - os sinais do auditor aparecem com dados reais ou quando as anomalias são registradas.
  - Os testes inserem anomalias sintéticas para conferir cada sinal.
- **Pontos de fusão com outras frentes**, todos só com acréscimos no fim:
  - `perfis.ts`, `packages/contratos/src/index.ts` (`Permissao` e tipos novos), `registro.ts`, `rotas.ts`, `navegacao.ts`, `sessao/permissoes.ts`, `catalogo-regras.ts` e o teste dele, e `packages/dominio/src/index.ts`;
  - em `jornada/rotas.ts`, três linhas: trava da aprovação e resumo das citações na trilha;
  - em `jornada/servico.ts`, duas linhas: a ancoragem do prompt;
  - em `Documentos.tsx`, o painel de citações e o `processoId` do visualizador;
  - em `ProcessoDetalhe.tsx`, o botão **Conferir documentos**;
  - em `LinhasDefesa.tsx`, a seção do auditor;
  - em `jornada/documentos.ts`, a correção do art. 140.
