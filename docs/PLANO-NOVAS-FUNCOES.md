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
| F11 ✅ | Publicação real no PNCP (sandbox, depois produção) e no DOU (RF-19, RF-36) | arts. 54 e 94 | 1 (PNCP) e 5 (DOU) | M | Credenciais do PNCP, providenciadas pelo MJSP |
| F18 ✅ | Integração CEIS/CNEP e certidões: consulta real, envio da sanção em 15 dias úteis, recheque antes do atesto e do pagamento (RF-20, RN-23, RN-24) | arts. 91, § 4º, 92, XVI, e 161 | 1 (PoC-04) | M | Acesso às APIs da CGU e das certidões, pelo MJSP |
| F13 ✅ | Upload seguro de documentos e leitura assistida de atestados OCR (RF-21, RIA-08, RN-25) | art. 67 | 1 (PoC-03) | G | Contêiner de OCR, previsto pelo cliente |
| F4 ✅ | Vínculos entre licitantes e extensão de sanção (RN-27, RIA-10) | arts. 14 e 160 | 1 (vínculos) e 3 (sanção) | M | QSA da Receita em produção |
| F1 ✅ | Prova de conceito e amostra do primeiro colocado (RN-20) | art. 17, § 3º | 2 | P | Não |
| F2 ✅ | Controle externo: cautelares, prazo de resposta e suspensão (RN-30, RF-24) | art. 171, §§ 1º e 2º | 2 | M | Não |
| F3 ✅ | Avaliação de desempenho do contratado e uso na técnica e preço (RN-37, RF-30) | arts. 36, 37, III, e 88, §§ 3º e 4º | 2 e 3 | M | Envio ao cadastro de atesto: regulamento |
| F5 ✅ | Sinal de registro de preços compartilhado e intenção de registro de preços aberta por 8 dias úteis (RN-38, RF-31, RIA-01) | art. 86 | 2 | P | Divulgação no SRP digital do Compras.gov.br, sem API |
| F8 ✅ | Painel das 3 linhas de defesa (RF-23, RN-29) | art. 169 | 2 | P | Não |
| F14 ✅ | Declarações de impedimento dos agentes designados (RN-28) | art. 7º, III, e art. 9º | 2 | P | Não |
| F6 ✅ | Lições aprendidas da execução, mostradas em novos DFDs (RIA-12) | arts. 11, 18 e 117 | 3 | M | Não |
| F7 ✅ | Instrumento de medição de resultado (IMR) e conferência da nota fiscal (RN-36, RF-29) | art. 6º, XXIII, "g"; arts. 117 e 140 | 3 | G | Não |
| F9 ✅ | Rotas de contratação, dispensa eletrônica, Sicx (comércio eletrônico) e cartão de pagamento (RN-41, RN-42, RF-34) | arts. 72, 74, 75, 79, IV, e 86 (Lei 15.266/2025; Decreto 13.106/2026) | 4 | G | Plataforma e API do Sicx (a vitrine é simulada) |
| F10 ✅ | Plano de contratações anual: consolidação, publicação no PNCP e conferência do DFD com o PCA publicado (RF-31) | art. 12, VII, e Decreto 10.947/2022 | 5 | M | Credenciais do PNCP, para o envio real |
| F12 ✅ | Integração real com o SEI e assinatura ICP-Brasil (RF-35) | art. 12, VI | 5 | G | Acesso ao SEI, providenciado pelo MJSP |
| F19 ✅ | Catálogo CATMAT/CATSER: consulta ao catálogo oficial e sugestão do item (RIA-13) | art. 19 | 2 | M | Dados abertos do catálogo |
| F20 ✅ | Documentos da fase preparatória e dotação orçamentária estruturada (RN-39, RF-32) | arts. 8º, 18, 53 e 150 | 2 | M | Não |
| F21 ✅ | Políticas do órgão: sustentabilidade e logística reversa obrigatórias em ETP e TR (RN-21) | art. 5º e art. 11, IV | 2 | P | Não |
| F22 ✅ | Execução contratual como ato, completa: parte 1 (aditivos, prorrogação, reajuste, repactuação, reequilíbrio e extinção — RN-32, RN-33, RF-27) e parte 2 (fiscalização, recebimentos, garantias, prazos de pagamento — RN-34, RN-35, RF-28) | arts. 92, 96–102, 104–107, 117, 124–125, 137–141 | 2 | G | Liquidação e pagamento no SIAFI |
| F23 ✅ | Consulta automática de preços e projeções de câmbio e inflação (RF-25, RIA-11) | art. 23 | 3 | M | Dados abertos de compras |
| F24 ✅ | IA ancorada: modelos da AGU, RAG soberano, conferência de citações e conferência cruzada (RIA-14, RIA-15, RNF-08) | art. 19, IV, e art. 25, § 1º | 3 | G | LLM auto-hospedado do órgão |
| F25 ✅ | Sigilo de segurança pública: classificação, contratos sigilosos, cofre e carimbo de tempo (RN-40, RF-33, RNF-09) | art. 13 e art. 91, § 1º | 2 | M | Não |
| F26 ✅ | Atos da seleção: fase recursal única de 3 dias úteis, adjudicação, homologação e divulgação preparatória (RN-22, RF-18) | arts. 54, § 3º, 71 e 165 | 2 | M | Não |
| F27 ✅ | Central de notificações externas e semáforo de 120 dias (RN-31, RF-26) | art. 117 | 3 | M | Servidor de e-mail do órgão |
| F28 ✅ | Gestão compartilhada com a sociedade e catálogo de dados abertos (RF-37, RF-38) | art. 174, § 3º, VI | 3 | M | Não |
| F29 ✅ | Operação: autoescalonamento, desligamento fora do expediente, teste de carga e medição de disponibilidade (RNF-10) | — | antes da produção | M | Nuvem do órgão |
| F30 ✅ | Sala de disputa: modos aberto e fechado, desempate, simulação e acompanhamento com sinal de lances (RN-26, RF-22, RIA-09) | arts. 36, 56 e 60 | 1 (PoC-03) | G | Dados da sessão oficial, para o acompanhamento |
| F31 ✅ | Serviços e mensageria: fila RabbitMQ auto-hospedada com novas tentativas e erro, Kubernetes por serviço (RNF-07) | art. 174, § 2º (barramento do PNCP) | 1 (com F11) | M | Não |
| F32 ✅ | Painel das metas do ETP: tempo de instrução, erros formais barrados e economia (RF-39) | art. 18, § 1º, IX | 2 | M | Não |
| F33 ✅ | Paleta da bandeira com papéis acessíveis: azul-escuro, amarelo sobre escuro, vermelho alertas e verde marcadores | — (RNF-01) | 2 | P | Não |
| F34 ✅ | Selos de desempenho Diamante, Ouro, Prata, Em observação, Crítico e Sem histórico; "Impedido" só por sanção | arts. 88, 156 e 158 | 2 | P | Não |

As funções F18 a F29 vieram da auditoria da conversa do cliente, e as F30 a F34 dos pontos confirmados nela em 8/11. A origem de cada uma está em `docs/RASTREABILIDADE-REQUISITOS.md`.

**Ordem:**

1. **Fase 1:** prova de conceito, cerca de 5 semanas com a sala de disputa (F30) e a mensageria (F31).
2. **Fase 2:** regras sobre dados que já existem, cerca de 2 semanas.
3. **Fase 3:** dados novos da execução, cerca de 3 semanas.
4. **Fase 4:** rotas de contratação e Sicx, cerca de 2 semanas.
5. **Fase 5:** integrações externas restantes, conforme o MJSP libera os acessos.

## 3. Novas regras no catálogo

Os códigos foram atribuídos **na ordem de implementação**, e o Caderno de regras não tem lacunas. A tabela traz todos os códigos a partir de RN-19, RF-16, RIA-08 e RNF-07, com o título do catálogo (`packages/dominio/src/catalogo-regras.ts`) e a função que o originou.

| Código | Regra | Função |
|---|---|---|
| RN-19 | Multa moratória por atraso injustificado | F16 |
| RN-20 | Prova de conceito ou amostra do licitante provisoriamente vencedor | F1 |
| RN-21 | Critérios de sustentabilidade e logística reversa obrigatórios | F21 |
| RN-22 | Fase recursal única e prazos dos atos da seleção | F26 |
| RN-23 | Recheque da regularidade antes do atesto e do pagamento | F18 |
| RN-24 | Registro da sanção aplicada no CEIS/CNEP em até 15 dias úteis | F18 |
| RN-25 | Parcelas de maior relevância, quantitativos mínimos e exercícios do balanço | F13 |
| RN-26 | Rito da sessão de disputa: modos, lances, prorrogação, encerramento e julgamento | F30 |
| RN-27 | Extensão dos efeitos da sanção (desconsideração da personalidade jurídica) | F4 |
| RN-28 | Declaração de inexistência de impedimento dos agentes designados | F14 |
| RN-29 | Revisão trimestral da matriz de riscos do contrato | F8 |
| RN-30 | Cautelar suspensiva do controle externo impede avançar e contratar | F2 |
| RN-31 | Semáforo de vencimentos de 30, 60, 90 e 120 dias com avisos automáticos | F27 |
| RN-32 | Termo aditivo como ato, com a trava do art. 125 | F22 (parte 1) |
| RN-33 | Prorrogação com os limites dos arts. 105 a 114 | F22 (parte 1) |
| RN-34 | Recebimento provisório e definitivo, liquidação e prazo de pagamento | F22 (parte 2) |
| RN-35 | Garantias contratuais: exigência, validade, liberação, execução e desconto de multa | F22 (parte 2) |
| RN-36 | Conferência da nota fiscal com o valor devido e o ajuste do IMR | F7 |
| RN-37 | Avaliação de desempenho do contratado e registro cadastral de atestos | F3 |
| RN-38 | Intenção de registro de preços aberta por pelo menos 8 dias úteis | F5 |
| RN-39 | Dotação orçamentária declarada antes do edital | F20 |
| RN-40 | Sigilo de segurança pública: classificação, acesso restrito e divulgação | F25 |
| RN-41 | Dispensa eletrônica: aviso de 3 dias úteis, propostas adicionais, limites e fracionamento | F9 |
| RN-42 | Comércio eletrônico pelo Sicx: ranqueamento, segregação, recebimento e pagamento em até 30 dias | F9 |
| RF-16 | Importação da cesta de preços por planilha | F15 |
| RF-17 | Editais publicados com inteiro teor sem login | F17 |
| RF-18 | Adjudicação, homologação e divulgação dos documentos preparatórios | F26 |
| RF-19 | Publicação no PNCP pela fila de integrações | F11 |
| RF-20 | Consulta ao CEIS e ao CNEP e checklist de regularidade | F18 |
| RF-21 | Documentos do processo e de habilitação | F13 |
| RF-22 | Sala de disputa: simulação e acompanhamento da sessão oficial | F30 |
| RF-23 | Painel das três linhas de defesa | F8 |
| RF-24 | Controle externo: medidas de controle e cautelares | F2 |
| RF-25 | Consulta automática e combinada de preços | F23 |
| RF-26 | Central de notificações automatizadas | F27 |
| RF-27 | Alterações do contrato: aditivos, apostilas, reajustes e extinção | F22 (parte 1) |
| RF-28 | Execução do contrato: fiscalização, recebimentos, garantias e prazos de pagamento | F22 (parte 2) |
| RF-29 | Instrumento de medição de resultado (IMR) do contrato e medições periódicas | F7 |
| RF-30 | Avaliação de desempenho, histórico do fornecedor e certificado | F3 |
| RF-31 | Plano de contratações anual, conferência do DFD e intenções de registro de preços | F10 e F5 |
| RF-32 | Documentos complementares da fase preparatória e checklist do processo | F20 |
| RF-33 | Sigilo do processo: classificação, credenciamento e registro de acessos | F25 |
| RF-34 | Rotas de contratação: licitação, dispensa, inexigibilidade, adesão a ata e Sicx | F9 |
| RF-35 | Integração com o SEI e assinatura refletida | F12 |
| RF-36 | Publicação no Diário Oficial da União | F11 (DOU) |
| RF-37 | Gestão compartilhada com a sociedade | F28 |
| RF-38 | Catálogo de dados abertos | F28 |
| RF-39 | Painel das metas do ETP (resultados pretendidos) | F32 |
| RIA-08 | Leitura assistida de atestados de capacidade técnica | F13 |
| RIA-09 | Sinal de padrão de lances na sessão de disputa | F30 |
| RIA-10 | Sinal de vínculo impeditivo e de possível sucessão de empresa sancionada | F4 |
| RIA-11 | Projeção de variação cambial e inflacionária do valor estimado | F23 |
| RIA-12 | Lições aprendidas da execução no DFD, no ETP e no TR | F6 |
| RIA-13 | Sugestão do código do catálogo CATMAT/CATSER | F19 |
| RIA-14 | Conferência das citações legais e precisão normativa (IMR-02) | F24 |
| RIA-15 | Conferência cruzada dos documentos e auditor contínuo | F24 |
| RNF-07 | Fila de integrações com novas tentativas e fila de erro | F31 |
| RNF-08 | Base normativa soberana e busca na lei | F24 |
| RNF-09 | Cofre de anexos sigilosos e carimbo de tempo da trilha de auditoria | F25 |
| RNF-10 | Operação sustentável e medição de disponibilidade (IMR-01) | F29 |

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

- **Domínio:** `lei14133/prova-conceito.ts`. Quando o edital exige a prova, a etapa 6 só avança com o resultado registrado do provisoriamente vencedor (RN-20). Se o resultado for "reprovado", a função indica o próximo colocado. A desclassificação é ato do agente.
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
- **Regra RN-30:** com cautelar suspensiva ativa, "Avançar etapa" e "Contratar" são bloqueados, com o número da decisão no aviso.
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
  - `prazoMinimoIrp` conta 8 dias úteis (RN-38).
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
- **Regra RN-28:** agente sem declaração não pode ser responsável por etapa.
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
- **Sicx:** a vitrine simulada e as regras do regulamento estão prontas. A integração real entra quando a API for publicada. A compra pelo Sicx fica fora da soma do fracionamento (RN-41) e segue o regulamento do Sicx (RN-42), o Decreto 13.106/2026.
- **Na proposta:** dizer que as rotas estão prontas e que o Sicx é integrado assim que a API for publicada.
- **Entregue (F9 ✅):** as cinco rotas, a dispensa eletrônica com aviso de 3 dias úteis, a adesão a ata, a vitrine simulada do Sicx e o cartão de pagamento. O detalhe está em `docs/entregas/frente-s-rotas-contratacao.md`.

### Fase 5 — integrações restantes

- **F10. PCA (art. 12, VII), tamanho M — entregue (F10 ✅):** leitura do PCA pela API de consulta do PNCP, no servidor, e consolidação, aprovação e publicação do plano pela fila. Cada item do DFD é ligado ao item do PCA, com sinal de item fora do plano ou de valor acima do planejado. O detalhe está em `docs/entregas/frente-o-planejamento.md`.
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
