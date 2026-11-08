# Rastreabilidade: requisitos do cliente × Ágora

Data: 8 de novembro de 2026.

**Fonte dos requisitos:** a conversa do cliente com o Gemini ("[MJSP] Prompt para Portal de Compras do MJSP"), com 2.365 linhas. Ela traz o prompt do portal, o ETP, a matriz de riscos, o TR (com a prova de conceito e o IMR), as minutas do edital e do contrato, a especificação funcional e o checklist de documentos. As linhas citadas são da cópia local em `reference/gemini-compartilhado.txt`, que fica fora do repositório.

**Método:**

- A conversa foi lida inteira, em 4 partes.
- Cada requisito foi conferido no código com o Kaxcav Vortex (kvx), no catálogo de regras (`packages/dominio/src/catalogo-regras.ts`) e no plano (`docs/PLANO-NOVAS-FUNCOES.md`).
- Duplicatas foram juntadas: o prompt aparece repetido na conversa.
- Só conta como "implementado" o que tem evidência no código.

**Status usados:**

| Status | Significado |
|---|---|
| ✅ Implementado | Existe, com evidência no código |
| 🟡 Parcial | Existe em parte; a coluna diz o que falta |
| 📋 Planejado | Não existe, mas está no plano (F1 a F17) |
| ➕ Nova função | Não existe nem estava no plano; entra no plano como F18 a F34 (seção 12) |
| ⛔ Contrário às regras | Como pedido, viola uma regra do projeto; a Ágora oferece alternativa |
| 📄 Contratual | Obrigação da contratação ou da proposta comercial, não do software |

## 1. Resumo

**Já está pronto o núcleo pedido pelo cliente:**

- as 7 etapas da contratação, com os mesmos códigos de regra do protótipo (RN-01 a RN-09, RIA-01 a RIA-07);
- o modo especificação técnica e o caderno de regras;
- a geração do DFD, do ETP, da matriz de riscos, da nota técnica de preços, do TR, do edital e da minuta;
- a gestão de contratos, atas, empenhos e pagamentos em ordem cronológica;
- o índice de desempenho do fornecedor e as sanções com dosimetria;
- a trilha de auditoria, a LGPD e o login gov.br;
- desde esta rodada: a importação da cesta de preços, a multa moratória e os editais públicos com inteiro teor em PDF.

**O que ainda falta, em quatro blocos:**

1. **Prova de conceito:** publicação real no PNCP (F11), leitura de atestados (F13) e, nova, a **consulta real ao CEIS/CNEP** (F18).
2. **Execução contratual como ato** (nova, F22): aditivos, prorrogação, recebimentos e garantias hoje são só simulação ou texto da minuta.
3. **Funções planejadas da gestão e do controle:** cautelares (F2), score ligado à técnica e preço (F3), IMR (F7) e 3 linhas de defesa (F8).
4. **Itens que o cliente pediu e não estavam no plano:** documentos da fase preparatória, dotação orçamentária, sigilo de segurança pública, modelos da AGU com IA ancorada, consulta automática de preços, canal com a sociedade e notificações. Todos entram agora como F18 a F29.
5. **Pontos fechados na conversa em 8/11** (seção 13): sala de disputa (F30), serviços com fila de mensageria (F31), painel das metas do ETP (F32), paleta da bandeira (F33) e selos de desempenho (F34).

**Situação da prova de conceito:**

| Roteiro | Situação |
|---|---|
| PoC-01 | 🟡 Funciona; falta impedir a geração da minuta com item de luxo sem justificativa |
| PoC-02 | ✅ Com teste ponta a ponta |
| PoC-03 | 📋 Depende de F4, F13 e da sala de disputa simulada (F30) |
| PoC-04 | ✅ Funciona; a consulta real ao CEIS/CNEP é a F18 |
| PoC-05 | 🟡 Download público pronto (F17); falta o envio ao sandbox do PNCP (F11) |

## 2. Interface e identidade visual

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Padrão gov.br, acessibilidade (eMAG, WCAG 2.1 AA), responsivo | 331, 650, 1686 | ✅ | Tokens oficiais, componentes próprios, testes com axe e teclado (RNF-04) |
| Cores da bandeira com os hex pedidos (#002776, #009C3B, #FFDF00) | 9, 24–28, 118–126, 1086–1091, 1754–1759 | ➕ F33 | Hoje só há os tokens do gov.br. A paleta pedida entra com os papéis que a própria conversa dá: amarelo só sobre fundo escuro (linha 27) e contraste AA (RNF-01, linha 1686). Ver seção 13 |
| Símbolos da Justiça (balança, escudo, brasão, martelo) | 30, 128, 1760 | 🟡 | Há ícones pontuais (martelo, balança, escudo), servidos pela aplicação. Falta uma identidade visual com essa simbologia |
| Menu lateral retrátil, painel sem recarregar | 31, 132 | ✅ | `MenuLateral`, gaveta no celular, SPA |
| Modo especificação técnica (RF/RN/RIA de cada tela) | 31, 1096, 1765 | ✅ | `ModoEspecificacao`, `PainelRegras` |
| Caderno de regras exportável | 85, 245, 1749 | ✅ | `/regras`, pronto para impressão |
| Barra das 7 etapas e seletor de processos por órgão | 1763–1764 | ✅ | `TrilhaEtapas`; filtro por órgão |
| Dados fictícios realistas | 84, 1154 | ✅ | Seed sintético (regra 3) |
| Entrega em HTML único com Tailwind e ícones por CDN | 19, 1153, 1835 | ⛔ | Viola a regra 4. A Ágora serve tudo pela própria aplicação |

## 3. Planejamento: demanda, PCA, equipe, ETP e riscos

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Formulário do DFD | 40, 1775 | ✅ | `PUT /processos/:id/dfd`, `modeloDfd` |
| DFD ligado ao catálogo CATMAT/CATSER, com sugestão do item | 44, 47, 1445, 1775 | ➕ F19 | Hoje o código é digitado |
| DFD conferido com o PCA publicado | 40, 643, 1775 | 📋 F10 | Hoje só há a marcação "previsto no PCA" |
| PCA consolidado a partir dos DFDs e publicado | 1410 | ➕ F10 ampliada | |
| Adequação orçamentária (dotação, LOA) | 44, 817–827, 2284 | ➕ F20 | Hoje é só um item do checklist do parecer |
| Lições aprendidas de contratos anteriores no DFD | 1120, 1776 | 📋 F6 | |
| Bloqueio de artigo de luxo (art. 20) | 43, 1778 | ✅ | RN-01 |
| Justificativa para não usar o catálogo de padronização (art. 19, § 2º) | 1779 | ✅ | RN-02 |
| Consolidação de demandas entre órgãos (IRP) | 1780 | 📋 F5 | O alerta de fracionamento já existe (RIA-01, RN-14) |
| Designação da equipe, com segregação de funções | 1785–1787 | ✅ | RN-03 `verificarSegregacao` |
| Vínculo efetivo e capacitação dos agentes (arts. 7º e 8º) | 1785 | ➕ F14 ampliada | |
| Declaração de ausência de parentesco dos designados | 1785 | 📋 F14 | |
| ETP com os 13 incisos e trava dos obrigatórios | 42, 1792–1795 | ✅ | RN-04 `validarEtp` |
| Sustentabilidade e logística reversa obrigatórias em todo ETP e TR | 467 | ➕ F21 | Obrigatória e ligada por padrão, como pede a conversa. A lei permite que o órgão exija (art. 5º e art. 11, IV). Ver seção 13 |
| Resultados pretendidos do ETP: tempo de instrução, erros formais e economia | 421–429 | ➕ F32 | Painel que mede os três contra metas configuradas pelo órgão. Ver seção 13 |
| Matriz de riscos registrada e gerada | 485–502, 1792 | ✅ | `modeloMatrizRiscos` |
| Revisão periódica da matriz pelas linhas de defesa | 592 | 📋 F8 ampliada | |
| Projeção de variação cambial e inflacionária | 55 | ➕ F23 | Baixa prioridade |

## 4. Pesquisa de preços (art. 23)

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Fontes do art. 23 e importação da cesta | 50, 681, 1460 | ✅ | `FonteCotacao`; RF-16 (importação por planilha) |
| Consulta automática ao Painel de Preços, notas fiscais, contratações similares, Sinapi/Sicro | 50, 655, 1460, 1793 | ➕ F23 | |
| Média, mediana e menor preço; cotação direta com 3 fornecedores, até 6 meses, com justificativa | 52, 1796 | ✅ | RN-05 `analisarCestaPrecos` |
| Expurgo de valores fora da curva e nota técnica | 55, 683, 1473 | ✅ | RIA-03 e `modeloNotaTecnica`. O expurgo é sugerido e aceito por uma pessoa, também em lote |
| Orçamento sigiloso motivado (art. 24) | 50, 655, 1466 | ✅ | `orcamentoSigiloso` com motivo |

## 5. TR, edital e minuta

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Geração assistida de ETP, TR, edital e minuta, com revisão humana | 40, 652, 1801 | ✅ | RIA-04: modelos determinísticos; LLM auto-hospedado opcional |
| Modelos padronizados da AGU como base | 652, 1417, 1801 | ➕ F24 | Os modelos atuais são próprios |
| IA com RAG na lei e nos manuais, com conferência das citações (IMR-02 "precisão normativa") | 510, 757, 1438 | ➕ F24 | Hoje há fontes e premissas em cada rascunho, mas sem índice RAG |
| Conferência cruzada entre documentos (prazos, quantidades, dotação) | 1805 | ➕ F24 | Hoje só detecta documento gerado com parâmetros antigos |
| Minuta com as 19 cláusulas do art. 92 e a cessão do art. 93 | 912–1061, 1801 | ✅ | `modeloMinuta` |
| Habilitação sem faturamento mínimo, PL de até 10%, sem cadastro complementar | 811, 897, 1804 | ✅ | RN-06 |
| Empresa com menos de 2 anos (art. 69, § 6º) e limites de atestados (art. 67) | 505, 814 | ➕ F13 ampliada | |
| Técnica e preço 70/30, com desempenho anterior (art. 37, III) | 799, 1118, 2304 | 📋 F3 | |
| Cláusula de prova de conceito | 671, 879, 1802 | 📋 F1 | |
| IMR no TR | 730–790, 1802 | 📋 F7 | O IMR do próprio TR do cliente serve de modelo |
| Visualizador lado a lado com destaque das cláusulas | 1802 | 🟡 | O visualizador mostra premissas e fontes, sem destaque por cor |
| Exportar documentos (PDF, DOCX) | 595–610 | 🟡 | PDF do inteiro teor público (RF-17) e dossiê imprimível. DOCX exigiria biblioteca nova |
| Impedir a geração da minuta com item de luxo sem justificativa (PoC-01) | 675–677, 1717 | ➕ Fase 1 | |

## 6. Controle jurídico, publicação e transparência

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Checklist do parecer jurídico (art. 53); publicação só com parecer favorável | 1063, 1809 | ✅ | `PUT /processos/:id/parecer` |
| Nota técnica de encaminhamento à CONJUR | 1721, 2225 | ➕ F20 | |
| Publicação real no PNCP (edital e anexos), começando pelo sandbox (PoC-05) | 664, 689, 1810 | 📋 F11 | Hoje é simulada; especificação em `docs/integracoes/PNCP-PUBLICACAO.md` |
| Publicação no PNCP de atas, contratos, aditivos e PCA | 664, 864, 1582 | ➕ F11 ampliada | |
| Extrato no DOU e em jornal | 864, 1810 | 📋 F11 | Registro manual na Fase 1; INCom na Fase 5 |
| Inteiro teor do edital e dos anexos sem login (art. 25, § 3º) | 77, 691, 1812 | ✅ | RF-17: `/transparencia/editais`, PDF gerado no servidor |
| Dados pessoais tarjados no que é publicado | 267, 1813 | ✅ | RIA-05: telas mascaradas e tarja automática no inteiro teor |
| Sigilo de segurança pública (art. 13), contratos sigilosos (art. 91, § 1º), cofre de anexos táticos | 324, 664, 1602, 1813 | ➕ F25 | Hoje só existe o orçamento sigiloso. Crítico para o MJSP |
| Adjudicação e homologação como atos; documentos preparatórios divulgados após a homologação (art. 54, § 3º) | 908 | ➕ F26 | |
| Despacho de autorização de abertura | 2317 | ➕ F20 | |

## 7. Seleção do fornecedor

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Sala de disputa com lances ao vivo (modos aberto e fechado, diálogo competitivo) | 58, 63, 658, 687, 1487–1489, 1817 | ➕ F30 | Hoje a Ágora registra o resultado. A sala entra com simulação (PoC-03) e acompanhamento da sessão oficial. Ver seção 13 |
| Dispensa eletrônica com aviso de 3 dias úteis | 58, 702, 1817 | 🟡 | A regra existe no domínio (`prazoAvisoDispensaEletronica`), mas a API não a usa. Entra pelas rotas de contratação (F9) |
| Sicx (Lei 15.266/2025) | 58, 1817 | 📋 F9 | |
| Cartão de pagamento | 1496 | ➕ F9 ampliada | |
| Desempate do art. 60 e LC 123 | 60, 880, 1820 | ✅ | RN-08 `aplicarDesempate` |
| Desempenho anterior vindo do índice, não digitado | 1117, 1820 | 📋 F3 | |
| Sinal de sócio em comum entre licitantes e com agentes | 63, 658 | ✅ | RIA-06 e RN-03 |
| Vínculos informados por fonte lícita; extensão de sanção (art. 160) | 1132, 1830 | 📋 F4 | |
| Parentesco descoberto por cruzamento de dados; bots e IP em tempo real | 63, 1132, 1509, 1821 | ⛔ | Sem fonte lícita (LGPD); a Ágora não recebe IP, e lances só na sala de disputa (F30); a IA não desclassifica. Alternativas: F4 e F14 |
| Leitura de atestados por OCR (PoC-03) | 64, 687, 1818 | 📋 F13 | |
| Prova de conceito nos processos do órgão | 1817 | 📋 F1 | |
| Fase recursal com controle de prazos | 61, 195 | ➕ F26 | Fase única após a habilitação, como pedido. Prazo legal de 3 dias úteis (art. 165, I) no lugar dos 5 pedidos; a minuta do edital já usa 3. Ver seção 13 |

## 8. Contratos e execução

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Painel de vigências 30/60/90, saldos, empenhos, ordem cronológica | 67, 1107, 1825 | ✅ | RF-01, RN-17, RN-18 |
| Faixa de 120 dias no semáforo | 1106 | ➕ F22 | Ajuste pequeno |
| Bloqueio antes da assinatura (CEIS/CNEP e regularidade) | 69, 688, 1829 | 🟡 | RN-09 bloqueia, mas sobre a base local. Consulta real: F18 |
| **Aditivos e prorrogação como atos registrados, com travas** (art. 125, regularidade, risco da matriz) | 586, 638, 1358, 1829 | ➕ F22 | Hoje só o simulador. As travas existem, mas não bloqueiam um ato real |
| Recebimento provisório e definitivo (art. 140), com prazos | 67, 982, 1532 | ➕ F22 | Hoje é tarefa do plano de gestão e cláusula da minuta |
| Garantias: alerta de vencimento pelo servidor, liberação, execução e renovação | 67, 1107 | 🟡 → F22 | Os dados existem; o alerta só vem do seed |
| Prazos de liquidação e pagamento | 732, 958 | ➕ F22 | |
| Reajuste (índice e cálculo), repactuação e reequilíbrio, extinção, período antes da ordem de serviço | 942–1001, 1058 | ➕ F22 | Hoje só como cláusulas |
| Alerta de limite de prorrogação e de nova licitação | 1111 | ➕ F22 | A queima de saldo já existe (RIA-07) |
| Papel de fiscal requisitante | 715–725 | ➕ F22 | |
| IMR, medição mensal e conferência da nota fiscal | 734–790, 1140 | 📋 F7 | |
| Desconto da multa na garantia ou na fatura (com confirmação humana) | 1129 | ➕ F22 | |
| Manter a habilitação durante a execução (antes do atesto e do pagamento) | 1041 | ➕ F18 e F22 | |
| Divulgação de aditivos no PNCP | 78 | ➕ F11 ampliada e F22 | Contratos: RN-11 ✅ |
| Notificações externas (e-mail, SEI) a fiscais e contratadas | 1108, 1532 | ➕ F27 | Hoje só a fila interna de pendências |
| Gestão compartilhada com a sociedade e relatório final (art. 174, § 3º, VI) | 1148, 1589, 1825 | ➕ F28 | |
| Percentuais do Decreto 11.430/2023 na execução | 1042 | ➕ F22 | A cláusula da minuta existe |

## 9. Fornecedores, sanções e índice de desempenho

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Índice de desempenho de 0 a 100 com faixas, só com indicadores objetivos | 1115, 1122, 1827 | ✅ | RF-13 `calcularIdc`, com metodologia e aviso. Componente de IMR: F7 |
| Selos "Diamante, Ouro, Prata… Impedido" | 1088, 1115, 1154, 1259 | ➕ F34 | Hoje as faixas têm nomes próprios. Os selos passam a ter os nomes da conversa; "Impedido" vem só de sanção vigente, nunca da nota. Ver seção 13 |
| Documento de avaliação de desempenho e envio ao cadastro de atesto do PNCP | 1119, 1827 | 📋 F3 | |
| Processo sancionatório com prazo de defesa | 67, 1128 | ✅ | RF-14, RN-13. As alegações finais ficam para a F22 |
| Dosimetria das multas compensatória (0,5% a 30%) e moratória | 72, 688, 1129, 1826 | ✅ | RN-12 e RN-19, com simuladores |
| **Consulta real ao CEIS/CNEP e às certidões (Receita, CNDT)** | 69, 661, 922, 1110 | ➕ F18 | Hoje é base local. Crítico para a PoC-04 |
| **Envio da sanção ao CEIS/CNEP em até 15 dias úteis (art. 161)** | 70, 1031, 1131, 1826 | ➕ F18 | Hoje só o prazo é calculado |

## 10. Auditoria e controle

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Trilha imutável de todo o processo | 415, 1142 | ✅ | RNF-03: encadeamento por hash e verificação de integridade |
| Logs assinados ou com carimbo de tempo ICP-Brasil | 1142 | ➕ F25 | |
| Painel das 3 linhas de defesa (art. 169) | 644, 1136, 1826 | 📋 F8 | |
| Cautelares do TCU (10 dias úteis, art. 171, § 2º) | 1139, 1826 | 📋 F2 | |
| Matriz de achados preventivos e relatório executivo de auditoria | 1140, 1155 | 📋 F8 ampliada | |
| Auditoria contínua de notas, medições e aditivos (sobrepreço, desequilíbrio) | 1143 | 📋 F7 e F22 | |

## 11. Integrações, IA e infraestrutura

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Login único gov.br | 318, 1689 | ✅ | `/sessao/govbr/*` |
| Integração com o SEI | 327, 1784 | 📋 F12 | Hoje simulada |
| Assinatura ICP-Brasil dentro da aplicação | 318, 512, 1689, 1784 | ⛔ | Exigiria componente de terceiros no navegador. Alternativa: assinar no SEI e refletir (F12) |
| IA privada em contêiner do órgão, sem treino externo | 521, 1693 | ✅ | `ia/provedor.ts`: nenhum provedor ou LLM auto-hospedado |
| Escopo por UASG (Administração Central, PF, PRF, SENASP, SENAPPEN) | 295, 336 | ✅ | RNF-05 |
| Dados abertos | 75, 327 | 🟡 → F28 | `GET /publico/*` em JSON, sem catálogo de dados abertos |
| Fila de mensageria (RabbitMQ ou Kafka) com novas tentativas | 522, 540, 1582, 1697 | ➕ F31 | Hoje há só novas tentativas no conector do PNCP. Entra o RabbitMQ auto-hospedado, com fila de erro. Ver seção 13 |
| Microsserviços orquestrados em Kubernetes | 389, 799, 1697 | ➕ F31 | Hoje é um monólito modular em contêiner. As integrações saem para um serviço próprio. Ver seção 13 |
| TI verde: autoescalonamento e desligamento fora do expediente | 464 | ➕ F29 | |
| Volume de 4.500 processos/ano e 12.000 documentos; disponibilidade de 99,8% | 341, 573, 1697 | ➕ F29 | Teste de carga e medição de disponibilidade. O resto é contratual |

## 12. Novas funções acrescentadas ao plano

Detalhe no `PLANO-NOVAS-FUNCOES.md`.

| # | Função | Prioridade |
|---|---|---|
| F18 | Integração CEIS/CNEP e certidões (consulta real, envio da sanção em 15 dias úteis, recheque antes do atesto e do pagamento) | **Fase 1 (PoC-04)** |
| F19 | Catálogo CATMAT/CATSER: consulta ao catálogo oficial e sugestão do item | Fase 2 |
| F20 | Documentos que faltam ao cliente: portaria de designação, declaração orçamentária, despacho de autorização, nota técnica à CONJUR e anexos operacionais (modelo de proposta, ordem de serviço, termo de sigilo, termos de recebimento), mais a dotação estruturada | Fase 2 |
| F21 | Políticas do órgão: sustentabilidade e logística reversa obrigatórias em ETP e TR, ligadas por padrão, e outras exigências configuráveis | Fase 2 |
| F22 | Execução contratual como ato: aditivos e prorrogação com travas, recebimentos, garantias, prazos de pagamento, reajuste, repactuação, extinção, fiscal requisitante, desconto de multa, alertas de 120 dias e de limite de prorrogação | **Fase 2** (Módulo 4 do TR) |
| F23 | Consulta automática de preços (Painel de Preços e contratações similares por dados abertos; Sinapi/Sicro) e projeções | Fase 3 |
| F24 | IA ancorada: modelos padronizados da AGU, RAG sobre a lei e os manuais, conferência de citações e conferência cruzada entre documentos (IMR-02) | Fase 3 |
| F25 | Sigilo de segurança pública: classificação de sigilo por processo e documento, tarja do art. 13, contratos sigilosos (art. 91, § 1º), cofre de anexos e carimbo de tempo da trilha | **Fase 2** (crítico para o MJSP) |
| F26 | Atos da seleção: recurso em fase única, com 3 dias úteis para razões e contrarrazões (art. 165, I e § 4º), adjudicação, homologação e divulgação pós-homologação (art. 54, § 3º) | Fase 2 |
| F27 | Notificações externas (e-mail institucional, SEI) a fiscais e contratadas | Fase 3 |
| F28 | Gestão compartilhada com a sociedade (art. 174, § 3º, VI) e catálogo de dados abertos | Fase 3 |
| F29 | Operação: autoescalonamento, desligamento fora do expediente, teste de carga e medição de disponibilidade | Antes da produção |
| F30 | Sala de disputa: modos aberto e fechado, isolados ou combinados (art. 56), desempate e técnica e preço. Simulação para treino e para a PoC-03; acompanhamento da sessão oficial do Compras.gov.br; sinal de padrão de lances | **Fase 1 (PoC-03)** |
| F31 | Serviços e mensageria: integrações num serviço próprio, RabbitMQ auto-hospedado com novas tentativas e fila de erro, manifest Kubernetes por serviço | **Fase 1** (barramento do PNCP, com F11) |
| F32 | Painel das metas do ETP: tempo de instrução por etapa, erros formais barrados e economia (estimado × contratado e efeito dos expurgos da cesta) | Fase 2 |
| F33 | Paleta da bandeira com papéis acessíveis: azul-escuro, verde, amarelo e vermelho | Fase 2 |
| F34 | Selos de desempenho com os nomes da conversa; "Impedido" só por sanção vigente | Fase 2 |

**Ampliações de funções existentes:**

- **F10:** consolidar e publicar o PCA.
- **F11:** publicar também atas, contratos, aditivos e PCA no PNCP.
- **F13:** incluir as regras do art. 67 e o art. 69, § 6º.
- **F14:** incluir vínculo efetivo e capacitação dos agentes.
- **F8:** incluir a revisão periódica da matriz e o relatório executivo de auditoria.
- **F9:** incluir o cartão de pagamento.

## 13. Pontos confirmados na conversa

Em 8/11/2026 os sete pontos que estavam em aberto foram conferidos na conversa do cliente. Todos têm resposta lá, e nenhum precisa ir ao cliente. Onde o pedido, ao pé da letra, contraria a lei, a Ágora faz o equivalente lícito (regra 7).

| Ponto | O que a conversa pede (linhas) | Decisão | Função |
|---|---|---|---|
| Prazo de recurso | Fase recursal única após a habilitação, com 5 dias úteis (61, 195) | Fase única, como pedido. O prazo é o da lei: 3 dias úteis para as razões e o mesmo para as contrarrazões (art. 165, I e § 4º). Os 5 dias vinham da Lei 8.666. **Equivalente lícito** | F26 |
| Cores | Paleta da bandeira com um papel para cada cor (24–28, 1086–1091, 1754–1759), aderente ao gov.br DS e à WCAG 2.1 AA (1686) | Entra a paleta pedida, nos papéis pedidos: azul-escuro no cabeçalho, amarelo só sobre o azul-escuro (como manda a linha 27) e vermelho nos alertas. O verde pedido tem contraste de 3,6:1 com o branco: fica em ícones, bordas e marcadores, e texto e botões verdes usam o verde do gov.br (4,6:1), para cumprir o AA que a própria conversa exige | F33 |
| Sala de disputa | Sala com modos aberto e fechado (58, 658, 1487–1489, 1817), monitorada pelo Sentinela (63), e simulação de lances entre 4 empresas na PoC-03 (687) | Entra a sala, com dois usos. **Simulação:** rito completo (modos do art. 56, desempate do art. 60, técnica e preço até 70/30), para treino e para a PoC-03. **Sessão oficial:** a administração federal direta faz a disputa no Compras.gov.br (IN SEGES/ME 73/2022); a Ágora acompanha a sessão de lá e roda os sinais sobre ela. **Equivalente lícito** | F30 |
| Microsserviços e mensageria | Microsserviços em Kubernetes e fila RabbitMQ ou Kafka com novas tentativas (389, 540, 1582, 1697); a PoC afere os microsserviços (799) | É requisito formal (RNF-04). As integrações (PNCP, CEIS/CNEP, SEI) saem para um serviço próprio, ligado à API por RabbitMQ auto-hospedado, com novas tentativas, fila de erro e idempotência. Cada serviço ganha seu manifest no Kubernetes | F31 |
| Selos de desempenho | Selos Diamante, Ouro, Prata, Em Observação e Impedido sobre o índice de 0 a 100 (1115, 1259), com cores (1088) e a faixa "Crítico" no exemplo (1154) | Os selos ganham esses nomes. "Impedido" só aparece com sanção vigente de impedimento ou inidoneidade, aplicada em processo (arts. 156 e 158) ou vinda do CEIS/CNEP; nunca sai da nota. Abaixo de "Em observação" a faixa se chama "Crítico", como no exemplo. **Equivalente lícito** | F34 |
| Sustentabilidade obrigatória | Regra do Módulo 1 que obriga critérios de sustentabilidade e logística reversa em todo ETP e TR (467) | Obrigatória e ligada por padrão. A lei não exige o inciso XII em todo ETP, mas permite que o órgão exija (art. 5º e art. 11, IV). Fica como política do órgão, e mudá-la entra na trilha de auditoria | F21 |
| Metas do ETP | Metas de tempo de instrução, de erros formais e de economia, no demonstrativo de resultados (421–429; art. 18, § 1º, IX) | Painel que mede as três: tempo por etapa (pela trilha de auditoria), erros formais barrados pelas travas (RN-04 e RN-09) e economia (estimado × contratado, mais o efeito dos expurgos da cesta). As metas são configuradas pelo órgão, e a economia não é atribuída à IA | F32 |
