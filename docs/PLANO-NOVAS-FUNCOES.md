# Plano — funções do protótipo do cliente que faltam na Ágora

Data: 8 de novembro de 2026.

## Origem

Este plano parte de duas fontes:

1. **O protótipo HTML do MJSP** ("Ecossistema ponta a ponta de contratações"), comparado com a Ágora 1.0.0. A maior parte já existe, e a Ágora usa os mesmos códigos de regra: RN-01 a RN-09 e RIA-01 a RIA-07.
2. **A conversa do cliente com o Gemini** em que esse protótipo foi pedido. Nela estão o ETP, a matriz de riscos, o termo de referência (TR) e as minutas da contratação. O TR exige uma **prova de conceito** do licitante vencedor. Ela define o que precisa funcionar para a Ágora ganhar e, por isso, define a prioridade.

O protótipo é uma maquete de tela única, com resultados fixos e sem servidor. Cada função abaixo foi redesenhada para funcionar de verdade, dentro destas regras:

- A IA não decide: ela sinaliza e redige rascunhos, e a decisão é sempre de uma pessoa.
- O navegador fala só com a Ágora. Integrações rodam no servidor, com proveniência.
- Autorização por perfil e UASG, decidida no servidor.
- Toda escrita entra na trilha de auditoria.
- Dados pessoais mascarados por padrão (LGPD).
- Toda regra fica em `@agora/dominio`, com fundamento legal e testes.

## 1. Prioridade máxima: a prova de conceito do TR

O TR prevê uma prova de conceito do licitante provisoriamente vencedor (art. 17, § 3º):

- é feita em sessão pública, gravada;
- deve ser realizada em até 5 dias úteis da convocação;
- tem 5 roteiros obrigatórios.

Quem falha não é contratado. A tabela resume cada roteiro em paráfrase.

| Roteiro | O que será testado | Situação na Ágora | O que falta |
|---|---|---|---|
| PoC-01 | Gerar minuta de ETP e TR a partir de um DFD, com um item de luxo | Pronto: o DFD sinaliza o luxo (RN-01), bloqueia o avanço e gera o ETP e o TR como rascunho | Impedir a geração da minuta enquanto houver item de luxo sem justificativa. Demonstrar com o LLM auto-hospedado ligado |
| PoC-02 | Importar uma cesta de 8 cotações, com 1 sobrepreço e 1 inexequível; os dois devem sair do cálculo e a nota técnica deve ser gerada | A análise estatística aponta os dois valores e a nota técnica existe | **Importar a cesta por planilha (F15)** e aceitar todos os expurgos sugeridos de uma vez, com uma justificativa |
| PoC-03 | Quatro licitantes, dois com vínculo societário ou de parentesco; atestado em PDF digitalizado com quantidades a extrair | Sócio em comum já é sinalizado (RIA-06) | **Sessão de lances simulada (F30)**, **upload e leitura do atestado por OCR (F13).** Para parentesco, **vínculos informados (F4)**: a Ágora não tem fonte para descobrir parentesco sozinha |
| PoC-04 | Contratar empresa com sanção vigente; atraso de 15 dias na entrega | O bloqueio da contratação (RN-09) e a dosimetria da multa compensatória (art. 156) existem | **Multa moratória por dia de atraso (F16)**, calculada junto com a compensatória |
| PoC-05 | Publicar edital e anexos no ambiente de testes (sandbox) da API do PNCP, com protocolo de retorno e link público sem login | A fila de publicação é simulada | **Publicação real no PNCP, começando pelo sandbox (F11)**, e **download público do edital e dos anexos (F17)** |

**Conclusão:** a Fase 1 deste plano é a prova de conceito. Ela vem antes de qualquer outra função.

## 2. Resumo

O tamanho é uma estimativa: **P** = até 2 dias, **M** = 3 a 5 dias, **G** = 1 a 2 semanas.

| # | Função | Base legal | Fase | Tamanho | Depende de fora? |
|---|---|---|---|---|---|
| F15 ✅ | Importação da cesta de preços por planilha (RF-16) | art. 23 | 1 (PoC-02) | P | Não |
| F16 ✅ | Multa moratória por atraso, junto com a compensatória (RN-19) | arts. 156 e 162 | 1 (PoC-04) | P | Não |
| F17 ✅ | Download público do edital e anexos, sem login (RF-17) | art. 25, § 3º | 1 (PoC-05) | P | Não |
| F11 | Publicação real no PNCP (sandbox, depois produção) e no DOU | arts. 54 e 94 | 1 (PNCP) e 5 (DOU) | M | Credenciais do PNCP, providenciadas pelo MJSP |
| F18 | Integração CEIS/CNEP e certidões: consulta real, envio da sanção em 15 dias úteis, recheque antes do atesto e do pagamento | arts. 91, § 4º, 92, XVI, e 161 | 1 (PoC-04) | M | Acesso às APIs da CGU e das certidões, pelo MJSP |
| F13 | Upload seguro de documentos e leitura assistida de atestados (OCR) | art. 67 | 1 (PoC-03) | G | Contêiner de OCR, previsto pelo cliente |
| F4 | Vínculos entre licitantes e extensão de sanção | arts. 14 e 160 | 1 (vínculos) e 3 (sanção) | M | QSA da Receita em produção |
| F1 | Prova de conceito e amostra do primeiro colocado | art. 17, § 3º | 2 | P | Não |
| F2 | Controle externo: cautelares, prazo de resposta e suspensão | art. 171, §§ 1º e 2º | 2 | M | Não |
| F3 | Avaliação de desempenho do contratado e uso na técnica e preço | arts. 36, 37, III, e 88, §§ 3º e 4º | 2 e 3 | M | Envio ao cadastro de atesto: regulamento |
| F5 | Sugestão de registro de preços compartilhado e prazo da IRP | art. 86 | 2 | P | Não |
| F8 | Painel das 3 linhas de defesa | art. 169 | 2 | P | Não |
| F14 | Declarações de impedimento dos agentes designados | art. 7º, III, e art. 9º | 2 | P | Não |
| F6 | Lições aprendidas da execução, mostradas em novos DFDs | arts. 11, 18 e 117 | 3 | M | Não |
| F7 | Instrumento de medição de resultado (IMR) e conferência da nota fiscal | art. 6º, XXIII, "g"; arts. 117 e 140 | 3 | G | Não |
| F9 | Rotas de contratação e Sicx (comércio eletrônico) | art. 79, IV (Lei 15.266/2025) | 4 | G | Regulamento e API do Sicx |
| F10 | Conferência do DFD com o PCA publicado | art. 12, VII | 5 | M | API de PCA do PNCP |
| F12 | Integração real com o SEI e assinatura ICP-Brasil | art. 12, VI | 5 | G | Acesso ao SEI, providenciado pelo MJSP |
| F19 | Catálogo CATMAT/CATSER: consulta ao catálogo oficial e sugestão do item | art. 19 | 2 | M | Dados abertos do catálogo |
| F20 | Documentos da fase preparatória que faltam (portaria de designação, declaração orçamentária, despacho de autorização, nota técnica à CONJUR, anexos operacionais) e dotação estruturada | arts. 8º, 18, 53 e 150 | 2 | M | Não |
| F21 | Políticas do órgão: sustentabilidade e logística reversa obrigatórias em ETP e TR, ligadas por padrão, e outras exigências configuráveis | art. 5º e art. 11, IV | 2 | P | Não |
| F22 | Execução contratual como ato: aditivos e prorrogação com travas, recebimentos, garantias, prazos de pagamento, reajuste, repactuação, extinção, fiscal requisitante, desconto de multa, alertas | arts. 92, 96, 104–107, 117, 124–125, 137–141 | 2 | G | Não |
| F23 | Consulta automática de preços (Painel de Preços e contratações similares; Sinapi/Sicro) e projeções | art. 23 | 3 | M | Dados abertos de compras |
| F24 | IA ancorada: modelos da AGU, RAG sobre a lei e os manuais, conferência de citações e conferência cruzada entre documentos | art. 19, IV, e art. 25, § 1º | 3 | G | LLM auto-hospedado do órgão |
| F25 | Sigilo de segurança pública: classificação de sigilo, tarja do art. 13, contratos sigilosos, cofre de anexos, carimbo de tempo da trilha | art. 13 e art. 91, § 1º | 2 | M | Não |
| F26 | Atos da seleção: recurso em fase única (3 dias úteis para razões e contrarrazões), adjudicação, homologação e divulgação após a homologação | arts. 54, § 3º, 71 e 165 | 2 | M | Não |
| F27 | Notificações externas a fiscais e contratadas | art. 117 | 3 | M | Servidor de e-mail do órgão |
| F28 | Gestão compartilhada com a sociedade e catálogo de dados abertos | art. 174, § 3º, VI | 3 | M | Não |
| F29 | Operação: autoescalonamento, desligamento fora do expediente, teste de carga, medição de disponibilidade | — | antes da produção | M | Nuvem do órgão |
| F30 | Sala de disputa: modos aberto e fechado, isolados ou combinados, desempate e técnica e preço; simulação (treino e PoC-03) e acompanhamento da sessão oficial do Compras.gov.br, com sinal de padrão de lances | arts. 36, 56 e 60 | 1 (PoC-03) | G | Dados da sessão oficial, para o acompanhamento |
| F31 | Serviços e mensageria: integrações num serviço próprio, RabbitMQ auto-hospedado com novas tentativas, fila de erro e idempotência, manifest Kubernetes por serviço | art. 174, § 2º (barramento do PNCP) | 1 (com F11) | M | Não |
| F32 | Painel das metas do ETP: tempo de instrução por etapa, erros formais barrados e economia (estimado × contratado, efeito dos expurgos da cesta), contra metas configuradas pelo órgão | art. 18, § 1º, IX | 2 | M | Não |
| F33 | Paleta da bandeira com papéis acessíveis: azul-escuro no cabeçalho, amarelo só sobre ele, vermelho nos alertas, verde em marcadores e, em texto, no tom AA do gov.br | — (RNF-01) | 2 | P | Não |
| F34 | Selos de desempenho Diamante, Ouro, Prata, Em observação e Crítico; "Impedido" só por sanção vigente | arts. 88, 156 e 158 | 2 | P | Não |

As funções F18 a F29 vieram da auditoria da conversa do cliente, e as F30 a F34 dos pontos confirmados nela em 8/11. A origem de cada uma está em `docs/RASTREABILIDADE-REQUISITOS.md`.

**Ordem:**

1. **Fase 1:** prova de conceito, cerca de 5 semanas com a sala de disputa (F30) e a mensageria (F31).
2. **Fase 2:** regras sobre dados que já existem, cerca de 2 semanas.
3. **Fase 3:** dados novos da execução, cerca de 3 semanas.
4. **Fase 4:** rotas de contratação e Sicx, cerca de 2 semanas.
5. **Fase 5:** integrações externas restantes, conforme o MJSP libera os acessos.

## 3. Novas regras no catálogo

Os códigos são atribuídos **na ordem de implementação**, para o Caderno de regras não ter lacunas. Os já atribuídos estão marcados com "✓". Os demais seguem a numeração, na ordem em que forem entregues.

| Código | Regra | Função |
|---|---|---|
| RN-19 ✓ | Multa moratória = percentual diário do contrato × dias de atraso sobre a parcela, até o limite do contrato | F16 |
| RF-16 ✓ | Importação da cesta de preços por planilha, com prévia validada no servidor | F15 |
| a atribuir | Edital que exige prova de conceito ou amostra só avança da etapa 6 com o resultado registrado | F1 |
| a atribuir | Cautelar suspensiva ativa impede avançar e contratar; prazo de resposta de 10 dias úteis | F2 |
| a atribuir | Intenção de registro de preços aberta por pelo menos 8 dias úteis | F5 |
| a atribuir | Compras pelo Sicx não somam ao limite de dispensa por valor (a confirmar com o regulamento) | F9 |
| a atribuir | Valor devido da nota fiscal = preço contratado × quantidade, com ajuste do IMR; divergência exige justificativa | F7 |
| a atribuir | Agente designado só atua depois da declaração de inexistência de impedimento | F14 |
| a atribuir (RIA) | Lições aprendidas de contratos anteriores com itens semelhantes | F6 |
| a atribuir (RIA) | Sinal de vínculo impeditivo e de possível extensão de sanção | F4 |
| a atribuir (RIA) | Leitura assistida de atestados de capacidade técnica | F13 |
| a atribuir (RF) | Controle externo (medidas de controle e prazos) | F2 |
| a atribuir (RF) | Painel das 3 linhas de defesa | F8 |
| a atribuir (RF) | Avaliação de desempenho do contratado | F3 |
| a atribuir (RF) | Rotas de contratação | F9 |
| a atribuir (RF) | Documentos do processo (armazenamento seguro) | F13 |
| a atribuir (RF) | Publicação no PNCP e download público do edital | F11 e F17 |

## 4. As funções em detalhe

Cada função segue o mesmo caminho e só é dada como pronta quando passa nos critérios da seção 5.

1. **Domínio:** regra pura, com fundamento legal e testes.
2. **Contrato da API.**
3. **Banco:** migração.
4. **API:** rota com RBAC e auditoria.
5. **Interface:** tela, acessível.
6. **Dados de demonstração.**
7. **Testes ponta a ponta com axe.**
8. **Documentação:** catálogo de regras e manual do usuário.

### Fase 1 — prova de conceito

#### F15. Importação da cesta de preços (PoC-02) — P

- **Hoje:** as cotações são digitadas uma a uma, e não há importação.
- **API:**
  - `POST /processos/:id/cesta-precos/importar`, que recebe CSV e planilha em formato aberto;
  - o servidor valida cada linha: fonte do art. 23, § 1º, data, fornecedor e valor;
  - o servidor neutraliza fórmulas, como já faz na exportação de itens.
- **Interface:** botão "Importar planilha", com prévia das linhas, erros por linha e confirmação. Junto vai o modelo de planilha para baixar.
- **Ajuste ligado à PoC:** o botão "Aceitar os expurgos sugeridos", com uma justificativa para todos. A decisão continua humana, mas a operação leva um clique.
- **Aceite:** a cesta da PoC (8 cotações, 2 fora da curva) é importada, os 2 valores são apontados e a nota técnica sai com média e mediana recalculadas.

#### F16. Multa moratória (PoC-04) — P

- **Hoje:** o simulador calcula só a multa compensatória (art. 156).
- **Domínio:** `calcularMultaMoratoria({ valorParcela, diasAtraso, percentualDia, limiteDias })` (art. 162).
  - Os parâmetros vêm da cláusula do contrato. A minuta do cliente prevê 0,5% ao dia sobre a parcela, até 30 dias.
  - A proposta mostra a moratória e a compensatória separadas, com memória de cálculo.
- **Interface:** no simulador de sanções, o modo "Atraso na entrega", com dias de atraso e valor da parcela. Na página do contrato, a ação "Registrar atraso" abre a simulação já preenchida.
- **Regra:** é proposta; a aplicação continua com a autoridade competente, depois da defesa (arts. 157 e 158).

#### F11. Publicação real no PNCP e no DOU (PoC-05) — M, com o DOU na Fase 5

- **Hoje:** a fila de publicação é simulada (`publicarOffline`).
- **Fase 1:**
  - adaptador `publicarOnline`, com o mesmo contrato da fila;
  - envio do edital e dos anexos à API de manutenção do PNCP, primeiro no ambiente de testes e depois em produção, com as credenciais do órgão;
  - o servidor guarda o protocolo, o identificador PNCP, o link público e o hash do que foi enviado;
  - novas tentativas, idempotência e auditoria.
- **Também na Fase 1:** registro manual da publicação no DOU e em jornal (data, edição, seção e página), para a regra do art. 54 usar o dado real.
- **Fase 5:** envio automático ao DOU pelo sistema da Imprensa Nacional (INCom).

#### F17. Download público do edital e anexos (PoC-05) — P

- **Hoje:** a transparência mostra os contratos, mas não os editais.
- **API e interface:**
  - em `/transparencia/editais/:id`, a página pública do edital publicado, com o download do inteiro teor e dos anexos em PDF, sem login (art. 25, § 3º);
  - o servidor gera os PDFs;
  - os dados pessoais saem tarjados (RIA-05).

#### F13. Documentos e leitura assistida de atestados (PoC-03) — G

- **Hoje:** a Ágora não armazena arquivos.
- **Armazenamento seguro (RF-20):**
  - upload só de PDF e imagens, com conferência do tipo real e limite de tamanho;
  - hash SHA-256, antivírus auto-hospedado opcional e escopo por UASG;
  - retenção, auditoria e mascaramento de dados pessoais;
  - guarda em PostgreSQL ou em armazenamento compatível com S3 da nuvem do órgão, configurado por ambiente.
- **Leitura (RIA-10):**
  - trabalhador de OCR auto-hospedado, em contêiner isolado na nuvem do órgão, como o próprio cliente exige para os modelos de IA e de visão;
  - extrai objeto, quantidades e período dos atestados;
  - mostra cada sugestão ao lado do trecho original, e o agente confirma.
- **Regra:** a habilitação é sempre decisão do agente. A leitura só sugere.
- **Para a PoC:** basta o fluxo "enviar atestado → ler → conferir quantidades" na etapa 6.

#### F4. Vínculos entre licitantes e extensão de sanção (arts. 14 e 160) — M

- **Hoje:** o sinal de sócio em comum entre licitantes (RIA-06) e o CPF de designado no quadro societário (RN-03).
- **Fase 1 — vínculos informados, para a PoC-03:**
  - a Ágora passa a aceitar vínculos informados pelo órgão a partir de fonte lícita (parentesco, cônjuge, relação comercial), com a origem registrada;
  - também aceita os vínculos declarados pelos próprios agentes (F14);
  - esses vínculos alimentam o sinal de vínculo impeditivo do art. 14 na etapa 6.
- **Fase 3 — extensão de sanção (RIA-09):** sinal quando houver sócio-administrador em comum com empresa impedida ou inidônea, fundação posterior à sanção ou o mesmo ramo de atividade.
  - Nunca bloqueia: a extensão exige processo com contraditório e análise jurídica prévia.
  - A ação "Encaminhar para análise jurídica" cria a pendência.
  - Dados em produção: QSA da Receita, pelo acordo de cooperação técnica previsto no ETP.
- **LGPD:** os nomes saem mascarados, como no RIA-06.

### Fase 2 — regras sobre dados que já existem

#### F1. Prova de conceito e amostra nos processos do órgão (art. 17, § 3º) — P

- **Domínio:** `lei14133/prova-conceito.ts`. Quando o edital exige a prova, a etapa 6 só avança com o resultado registrado do provisoriamente vencedor (RN-19). Se o resultado for "reprovado", a função indica o próximo colocado. A desclassificação é ato do agente.
- **Contrato e banco:** `ParametrosEdital.provaConceito` (tipo, prazo em dias úteis, critérios) e tabela `processos_provas_conceito`.
- **Interface:**
  - na etapa 4, opção "Exigir prova de conceito ou amostra";
  - na etapa 6, bloco do resultado, com laudo e justificativa;
  - o edital e o TR gerados passam a trazer a cláusula correspondente.

#### F2. Controle externo e cautelares (art. 171) — M

- **Domínio:** em `prazos.ts`:
  - `prazoRespostaCautelar`: 10 dias úteis, prorrogável (art. 171, § 2º);
  - `prazoDecisaoMerito`: 25 dias úteis, informativo (art. 171, § 1º).
- **Banco:** tabela `medidas_controle`:
  - órgão de controle e tipo (cautelar, diligência, recomendação);
  - processo ou contrato;
  - ciência, prazo e prorrogação;
  - se suspende o processo;
  - situação e resposta.
- **Regra RN-20:** com cautelar suspensiva ativa, "Avançar etapa" e "Contratar" são bloqueados, com o número da decisão no aviso.
- **Perfis:** segue as linhas de defesa descritas pelo cliente.
  - Um **novo perfil "Controle interno"** (unidade de controle interno do órgão) registra as medidas e as respostas.
  - O jurídico acompanha.
  - Um perfil **"Controle externo"**, só leitura, dá a visão da 3ª linha a auditores da CGU e do TCU.
- **Interface:** tela "Controle externo", com prazos e semáforo; pendência automática com o prazo; avisos no Início e na página do processo.

#### F3. Avaliação de desempenho do contratado (art. 88, §§ 3º e 4º; art. 37, III) — M

- **Fase 2 — documento comprobatório da avaliação:**
  - traz os indicadores objetivos, as penalidades e o período, a partir do IDC;
  - o gestor revisa e assina;
  - fica na aba "Avaliações" do fornecedor e do contrato, com a tarefa no modelo de gestão de encerramento.
- **Fase 3 — técnica e preço:**
  - `lei14133/tecnica-preco.ts`, com peso técnico de até 70% (art. 36, § 2º);
  - critério opcional de desempenho anterior (art. 37, III), que usa as avaliações registradas.
- **Fase 5:** envio ao cadastro de atesto do PNCP, quando houver regulamento e API (art. 88, § 4º).

#### F5. Registro de preços compartilhado e IRP (art. 86) — P

- **Domínio:**
  - `consolidarDemandas` agrupa itens com o mesmo código CATMAT/CATSER pedidos por órgãos diferentes no mesmo exercício;
  - `prazoMinimoIrp` conta 8 dias úteis (RN-21).
- **Interface:**
  - na etapa 1, o sinal "Demanda semelhante em outros órgãos", com quantidades e órgãos;
  - o botão "Propor intenção de registro de preços" registra a decisão do agente.
- **Diferença do protótipo:** não mostra percentual de economia inventado.

#### F8. Painel das 3 linhas de defesa (art. 169) — P

- **Tela "Controle":** somente leitura, filtrável por UASG.
  - **1ª linha (gestão e fiscalização):** pendências vencidas, atestos atrasados e tarefas em atraso.
  - **2ª linha (jurídico e controle interno):** aditivos perto do limite do art. 125, pareceres pendentes, sanções em instrução e processos bloqueados há mais de 15 dias.
  - **3ª linha (CGU e TCU):** medidas de controle com prazo (F2), integridade da trilha e acessos a dados pessoais.

#### F14. Declarações de impedimento dos agentes (art. 7º, III, e art. 9º) — P

- Na designação da equipe (etapa 2), cada agente assina a declaração de que não tem os impedimentos legais. A declaração é renovada quando os licitantes são conhecidos, na etapa 6.
- **Regra RN-24:** agente sem declaração não pode ser responsável por etapa.
- **Por que assim:** é a forma lícita de atender ao que o protótipo faz cruzando dados de parentesco, que não existem.

### Fase 3 — dados novos da execução

#### F6. Lições aprendidas (RIA-08) — M

- **Banco:** tabela `licoes_aprendidas`: origem, itens CATMAT, tipo (atraso, sanção, aditivo, desempenho), descrição, autor, fonte e situação.
- **Como as lições nascem:** a Ágora sugere a partir de eventos (pendência vencida, sanção, aditivo acima de 15%, IDC abaixo de 60), e o gestor confirma. O gestor também registra lições na tarefa de encerramento.
- **Interface:**
  - no DFD e no TR com itens semelhantes, aparecem como sinais com link para o contrato de origem;
  - o agente pode clicar "Considerar no TR", que inclui a premissa no rascunho, com a fonte.
- **Diferença do protótipo:** nada entra no TR sem decisão humana.

#### F7. Instrumento de medição de resultado e conferência da nota fiscal — G

- **Domínio:** `imr.ts`, com:
  - `calcularAjustePagamento`: faixas de meta e percentual de ajuste;
  - `conferirNotaFiscal`: quantidade, preço unitário acima do contratado e valor devido (RN-23).
- **Na preparação:** na etapa 4, seção "Critérios de medição e pagamento" do TR (art. 6º, XXIII, "g"). O IMR do próprio TR do cliente, com indicador, meta, faixas e percentuais de glosa, serve de modelo.
- **Na execução:**
  - o fiscal registra a medição mensal, como tarefa do plano de gestão;
  - a janela de atesto mostra "valor da nota × valor devido";
  - divergência exige justificativa e registra a glosa.
- **Base normativa:** confirmar a aplicação da IN SEGES/MP 5/2017 às contratações da Lei 14.133 pela IN SEGES/ME 98/2022.

### Fase 4 — rotas de contratação e Sicx

#### F9. Rotas de contratação e Sicx (Lei 15.266/2025) — G

- **O que o cliente espera:** o cliente põe o Sicx no escopo principal, como parte do módulo de seleção do fornecedor. O IMR do TR mede a disponibilidade da sincronização com o PNCP e o Sicx. A própria matriz de riscos do cliente lista mudanças de regulamento como risco.
- **Rotas de contratação:** decisão de arquitetura (ADR) com a "rota" escolhida na etapa 1.
  - Rotas: licitação, dispensa, inexigibilidade, adesão a ata e comércio eletrônico (Sicx).
  - Cada rota define quais etapas e regras se aplicam.
- **Sicx:** a vitrine e a integração entram quando houver regulamento e API. A regra RN-22 (fora da soma do fracionamento) só entra no catálogo depois de confirmada no texto da lei e no regulamento.
- **Na proposta:** dizer que as rotas estão prontas e que o Sicx é integrado assim que a API for publicada.

### Fase 5 — integrações restantes

- **F10. PCA (art. 12, VII), tamanho M:** leitura do PCA pela API de consulta do PNCP, no servidor. Cada item do DFD é ligado ao item do PCA, com sinal de item fora do plano ou de valor acima do planejado.
- **F11, DOU, tamanho M:** envio pelo sistema da Imprensa Nacional.
- **F12. SEI e ICP-Brasil, tamanho G:** WebServices do SEI do órgão para gerar processos, incluir documentos e consultar assinaturas. A assinatura acontece no próprio SEI, com o certificado do servidor, e a Ágora reflete a situação. Assinar dentro da Ágora exigiria componente de terceiros no navegador.

## 5. Como cada função é entregue

Uma função só está pronta quando:

1. `npm run typecheck`, `npm run build` e `npm test` passam; os testes atuais continuam passando sem alteração e há testes novos.
2. Os testes ponta a ponta passam, incluindo axe sem violações sérias nas telas novas.
3. As travas da Fábrica (`fabrica_run_gates`) não acusam nada além dos falsos positivos já conhecidos.
4. O catálogo de regras e o Caderno de regras trazem os novos códigos, com fundamento legal.
5. O seed de demonstração tem pelo menos um caso de cada função.
6. O manual do usuário e as capturas foram atualizados (`node e2e/capturar-manual.mjs` e `node docs/gerar-pdfs.mjs`).
7. Há commit próprio. O push publica na Railway e a demonstração é conferida no endereço público.

Na Fase 1 há um critério a mais: **um teste ponta a ponta por roteiro da prova de conceito** (PoC-01 a PoC-05). Esses testes reproduzem o passo a passo do TR com dados sintéticos, para ensaiar a sessão pública.

## 6. Outras exigências do TR que afetam a proposta

- **Hospedagem na nuvem governamental do MJSP:** a Ágora já é entregue em contêiner (Docker e Kubernetes). A Railway é só para demonstração.
- **Entrega quinzenal no repositório GitLab do MJSP**, com pagamento por entrega validada: o repositório privado no GitHub precisará de espelho no GitLab do órgão.
- **Cessão do código (art. 93):** já é premissa da Ágora.
- **IA privada em contêiner isolado:** a Ágora já trabalha só com LLM auto-hospedado. O OCR (F13) segue o mesmo modelo.
- **Indicadores do contrato, que afetam o pagamento:**
  - disponibilidade de 99,8%, incluindo a sincronização com o PNCP e o Sicx;
  - "precisão normativa da IA";
  - pontualidade das entregas.

## 7. O que não vamos copiar do protótipo

| No protótipo | Por que não | O que a Ágora faz |
|---|---|---|
| IA desclassifica licitante ("Sentinela") | Desclassificação é ato do agente, com motivação | Sinal com evidências, decisão humana |
| IA insere cláusulas no TR sozinha | IA não decide (regra 5 do projeto) | Sugestão que o agente aceita ou não (F6) |
| Economia percentual "calculada pela IA" | Número sem base verificável | Economia medida (estimado × contratado) no painel de metas (F32), e quantidades e preços da cesta (F5) |
| Conluio por IP e lances sincronizados | A Ágora não recebe o IP dos licitantes | Sinal de padrão de lances na sala de disputa (F30), sócio em comum, vínculos informados e art. 160 (F4), sempre como sinal |
| Parentesco descoberto por cruzamento de dados | Sem fonte lícita (LGPD) | Vínculos informados por fonte lícita e declaração dos agentes (F4 e F14) |
| Assinatura ICP-Brasil dentro da aplicação | Exigiria componente de terceiros no navegador | Assinatura no SEI, refletida na Ágora (F12) |
| Fontes, ícones e estilos por CDN | Viola a regra de soberania | Tudo servido pela própria Ágora |

## 8. Execução

- **Preparação, meio dia:**
  - ponto de restauração da Fábrica;
  - trava das assinaturas públicas de `@agora/dominio` e `@agora/contratos` (modo `allow_body_only`);
  - proteção dos testes existentes;
  - decisões de arquitetura registradas para "rotas de contratação" (F9) e "armazenamento de documentos" (F13).
- **Uma tarefa por função:** cada tarefa tem arquivos de escrita limitados (domínio, contrato, migração, módulo da API, telas, testes).
- **Ordem na Fase 1:** F16, F15, F17, F11 (PNCP), F4 (vínculos) e F13. As funções compartilham o contrato da API, o catálogo e o seed, por isso entram em sequência.
- **Delegação:** pelo `agy` com Gemini 3.8 ou pelo Kimi. O coordenador revisa cada entrega e roda as travas. Antes de delegar, os comandos exatos que a tarefa precisa entram na lista do `agy`.

## 9. Decisões

**Respondidas pela documentação do cliente:**

- **Acessos externos:** o próprio MJSP providencia. As providências prévias do ETP pedem as chaves da API do PNCP (testes e produção), do Sicaf, do CEIS/CNEP e do barramento do SEI. Dados da Receita e da CGU vêm por acordo de cooperação técnica.
- **OCR e IA:** os modelos de linguagem e de visão rodam em contêineres isolados na nuvem do órgão. Confirma F13 do jeito planejado.
- **Sicx:** está no escopo principal. Entra pelas rotas de contratação, assim que houver regulamento e API.
- **Linhas de defesa:**
  - **1ª:** gestão e fiscalização;
  - **2ª:** jurídico e controle interno da Secretaria-Executiva;
  - **3ª:** CGU e TCU.
  Daí os perfis propostos em F2.

- **Ordem:** o TR do cliente divide a execução em fases:
  - **Fase 1 (meses 1 e 2):** planejamento e preços, com a PoC-01 e a PoC-02;
  - **Fase 2 (meses 3 e 4):** seleção do fornecedor, Sicx, antifraude e barramento PNCP/DOU, com a PoC-03 e a PoC-05;
  - **Fase 3 (mês 5):** gestão contratual, CEIS/CNEP e sanções, com a PoC-04 e o pentest;
  - **Fase 4 (mês 6):** capacitação e entrada em produção;
  - **depois:** operação assistida.

  A prova de conceito acontece antes do contrato, então os 5 roteiros vêm primeiro (Fase 1 deste plano). Depois, as fases 2 a 5 deste plano seguem a ordem dos módulos do TR.
- **Declaração dos agentes:** o próprio cliente pede, na designação da equipe, a declaração de ausência de parentesco até o 3º grau. Confirma F14.

**Ainda abertas:**

1. **Perfis novos:** confirmar "Controle interno" (registra e responde às medidas de controle) e "Controle externo" (leitura para a CGU e o TCU).
2. **PoC-03:** a conversa não diz em que formato o órgão fornecerá os dados de vínculo e parentesco na sessão. A Ágora aceitará CSV e cadastro manual, com a origem registrada.
