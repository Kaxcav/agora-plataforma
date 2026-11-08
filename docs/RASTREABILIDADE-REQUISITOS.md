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

**Consolidação das entregas das frentes de trabalho:**

- **Prova de conceito (Fase 1):** todos os 5 roteiros (PoC-01 a PoC-05) estão implementados com testes, com a ressalva de que a chamada real a ambientes de produção depende das credenciais do órgão.
- **Funções prontas entregues:** F1, F2, F3, F4, F6, F7, F8, F11 (PNCP e DOU), F12, F13, F14, F15, F16, F17, F18, F20, F21, F23, F24, F25, F26, F27, F28, F29, F30, F31, F32, F33 e F34.
- **Execução contratual (F22 🟡):** parte 1 pronta (termos aditivos com trava do art. 125, prorrogação com limites dos arts. 105 a 114, apostilamento de reajuste e repactuação, reequilíbrio econômico-financeiro e processo de extinção com ampla defesa); parte 2 em andamento (Frente L: fiscalização, recebimentos, garantias e pagamentos).
- **Frentes em andamento:** Frente L (F22 parte 2), Frente O (F5, F10 e F19: IRP, PCA e CATMAT/CATSER) e Frente S (F9: rotas de contratação, dispensa eletrônica, Sicx e cartão de pagamento).

**Situação da prova de conceito:**

| Roteiro | Situação |
|---|---|
| PoC-01 | ✅ Implementado: DFD sinaliza artigo de luxo (RN-01), impede avanço sem justificativa e gera ETP e TR (ressalva: chamada ao LLM auto-hospedado depende da infraestrutura do órgão) |
| PoC-02 | ✅ Implementado: importação da cesta por planilha (RF-16), saneamento Tukey/mediana (RIA-03) e aceite de expurgos com nota técnica |
| PoC-03 | ✅ Implementado: sala de disputa simulada e acompanhamento Compras.gov.br (RF-22, RN-26, RIA-09), vínculos societários e declarados (RN-27, RIA-10) e leitura OCR de atestados (RF-21, RIA-08, RN-25) |
| PoC-04 | ✅ Implementado: bloqueio por sanção vigente (RN-09), consulta ao CEIS/CNEP com cache (RF-20), dosimetria de multa compensatória e multa moratória diária (RN-19) |
| PoC-05 | ✅ Implementado: publicação do edital e anexos no PNCP pela fila de integrações (RF-19, RNF-07) e download público do inteiro teor em PDF sem login (RF-17) (ressalva: envio real ao sandbox/produção depende de credenciais do órgão) |

## 2. Interface e identidade visual

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Padrão gov.br, acessibilidade (eMAG, WCAG 2.1 AA), responsivo | 331, 650, 1686 | ✅ | Tokens oficiais, componentes próprios, testes com axe e teclado (RNF-04) |
| Cores da bandeira com os hex pedidos (#002776, #009C3B, #FFDF00) | 9, 24–28, 118–126, 1086–1091, 1754–1759 | ✅ | F33: Paleta da bandeira integrada com conformidade WCAG AA (RNF-01) |
| Símbolos da Justiça (balança, escudo, brasão, martelo) | 30, 128, 1760 | ✅ | Ícones próprios acessíveis servidos pela aplicação sem dependência de CDN externa |
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
| DFD ligado ao catálogo CATMAT/CATSER, com sugestão do item | 44, 47, 1445, 1775 | 📋 F19 | Em andamento na Frente O |
| DFD conferido com o PCA publicado | 40, 643, 1775 | 📋 F10 | Em andamento na Frente O |
| PCA consolidado a partir dos DFDs e publicado | 1410 | 📋 F10 | Em andamento na Frente O |
| Adequação orçamentária (dotação, LOA) | 44, 817–827, 2284 | ✅ | F20: dotação estruturada (RN-39), declaração orçamentária e checklist (RF-32); rotas GET/PUT `/processos/:id/dotacao` |
| Lições aprendidas de contratos anteriores no DFD | 1120, 1776 | ✅ | F6: RIA-12, banco de lições sugeridas no DFD, ETP e TR; rotas `/processos/:id/licoes-aprendidas` |
| Bloqueio de artigo de luxo (art. 20) | 43, 1778 | ✅ | RN-01 |
| Justificativa para não usar o catálogo de padronização (art. 19, § 2º) | 1779 | ✅ | RN-02 |
| Consolidação de demandas entre órgãos (IRP) | 1780 | 📋 F5 | Em andamento na Frente O |
| Designação da equipe, com segregação de funções | 1785–1787 | ✅ | RN-03 `verificarSegregacao` |
| Vínculo efetivo e capacitação dos agentes (arts. 7º e 8º) | 1785 | ✅ | F14: RN-28 verificação de vínculo efetivo e capacitação na equipe; `PUT /processos/:id/equipe` |
| Declaração de ausência de parentesco dos designados | 1785 | ✅ | F14: RN-28 declaração formal de inexistência de impedimento; `POST /impedimentos/declaracoes` |
| ETP com os 13 incisos e trava dos obrigatórios | 42, 1792–1795 | ✅ | RN-04 `validarEtp` |
| Sustentabilidade e logística reversa obrigatórias em todo ETP e TR | 467 | ✅ | F21: RN-21 critérios obrigatórios no ETP e TR por política do órgão; `PUT /processos/:id/sustentabilidade` |
| Resultados pretendidos do ETP: tempo de instrução, erros formais e economia | 421–429 | ✅ | F32: RF-39 painel de metas do ETP com tempo, erros barrados e economia; `GET /metas-etp` |
| Matriz de riscos registrada e gerada | 485–502, 1792 | ✅ | `modeloMatrizRiscos` |
| Revisão periódica da matriz pelas linhas de defesa | 592 | ✅ | F8: RN-29 revisão trimestral da matriz de riscos; `POST /contratos/:id/riscos/revisoes` |
| Projeção de variação cambial e inflacionária | 55 | ✅ | F23: RIA-11 projeção com índices oficiais IBGE e BC; `POST /processos/:id/pesquisa-precos/projecao` |

## 4. Pesquisa de preços (art. 23)

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Fontes do art. 23 e importação da cesta | 50, 681, 1460 | ✅ | `FonteCotacao`; RF-16 (importação por planilha) |
| Consulta automática ao Painel de Preços, notas fiscais, contratações similares, Sinapi/Sicro | 50, 655, 1460, 1793 | ✅ | F23: RF-25 consulta automática de preços e inclusão assistida; `POST /processos/:id/pesquisa-precos/consultas` |
| Média, mediana e menor preço; cotação direta com 3 fornecedores, até 6 meses, com justificativa | 52, 1796 | ✅ | RN-05 `analisarCestaPrecos` |
| Expurgo de valores fora da curva e nota técnica | 55, 683, 1473 | ✅ | RIA-03 e `modeloNotaTecnica`. O expurgo é sugerido e aceito por uma pessoa, também em lote |
| Orçamento sigiloso motivado (art. 24) | 50, 655, 1466 | ✅ | `orcamentoSigiloso` com motivo |

## 5. TR, edital e minuta

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Geração assistida de ETP, TR, edital e minuta, com revisão humana | 40, 652, 1801 | ✅ | RIA-04: modelos determinísticos; LLM auto-hospedado opcional |
| Modelos padronizados da AGU como base | 652, 1417, 1801 | ✅ | F24: RNF-08 base normativa soberana e modelos padronizados; `GET /normas/modelos` |
| IA com RAG na lei e nos manuais, com conferência das citações (IMR-02 "precisão normativa") | 510, 757, 1438 | ✅ | F24: RIA-14 conferência de citações legais e precisão normativa; `GET /qualidade-normativa` |
| Conferência cruzada entre documentos (prazos, quantidades, dotação) | 1805 | ✅ | F24: RIA-15 conferência cruzada entre DFD, ETP, TR, edital e minuta; `GET /processos/:id/conferencia-cruzada` |
| Minuta com as 19 cláusulas do art. 92 e a cessão do art. 93 | 912–1061, 1801 | ✅ | `modeloMinuta` |
| Habilitação sem faturamento mínimo, PL de até 10%, sem cadastro complementar | 811, 897, 1804 | ✅ | RN-06 |
| Empresa com menos de 2 anos (art. 69, § 6º) e limites de atestados (art. 67) | 505, 814 | ✅ | F13: RN-25 parcelas de maior relevância (≥ 4%), limites de atestados (≤ 50%) e balanço de 2 exercícios |
| Técnica e preço 70/30, com desempenho anterior (art. 37, III) | 799, 1118, 2304 | ✅ | F3: RN-37 pontuação técnica combinada com histórico do fornecedor (art. 36, § 2º) |
| Cláusula de prova de conceito | 671, 879, 1802 | ✅ | F1: RN-20 cláusula no edital e convocação motivada em sessão pública gravada |
| IMR no TR | 730–790, 1802 | ✅ | F7: RF-29 seção de IMR e indicadores com faixas de glosa no TR e no contrato |
| Visualizador lado a lado com destaque das cláusulas | 1802 | 🟡 | O visualizador mostra premissas e fontes, sem destaque por cor |
| Exportar documentos (PDF, DOCX) | 595–610 | 🟡 | PDF do inteiro teor público (RF-17) e dossiê imprimível. DOCX exigiria biblioteca nova |
| Impedir a geração da minuta com item de luxo sem justificativa (PoC-01) | 675–677, 1717 | ✅ | F1: RN-01 e RN-20 trava no domínio e na API bloqueando avanço e minutas |

## 6. Controle jurídico, publicação e transparência

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Checklist do parecer jurídico (art. 53); publicação só com parecer favorável | 1063, 1809 | ✅ | `PUT /processos/:id/parecer` |
| Nota técnica de encaminhamento à CONJUR | 1721, 2225 | ✅ | F20: RF-32 nota técnica com quesitos objetivos gerada no processo; `POST /processos/:id/documentos/gerar` |
| Publicação real no PNCP (edital e anexos), começando pelo sandbox (PoC-05) | 664, 689, 1810 | ✅ | F11: RF-19 publicação via fila com gravação de protocolo e hash (ressalva: chamada real depende de credenciais) |
| Publicação no PNCP de atas, contratos, aditivos e PCA | 664, 864, 1582 | ✅ | F11: RF-19 e RN-32 publicação de contratos e termos aditivos na fila; `POST /processos/:id/contrato/publicar-pncp` |
| Extrato no DOU e em jornal | 864, 1810 | ✅ | F11 (DOU): RF-36 matérias no padrão Seção 3 e protocolo do INCom; `/publicacoes-dou` |
| Inteiro teor do edital e dos anexos sem login (art. 25, § 3º) | 77, 691, 1812 | ✅ | RF-17: `/transparencia/editais`, PDF gerado no servidor |
| Dados pessoais tarjados no que é publicado | 267, 1813 | ✅ | RIA-05: telas mascaradas e tarja automática no inteiro teor |
| Sigilo de segurança pública (art. 13), contratos sigilosos (art. 91, § 1º), cofre de anexos táticos | 324, 664, 1602, 1813 | ✅ | F25: RN-40, RF-33, RNF-09 classificação LAI, credenciamento, cofre cifrado AES-256 e PDF marcado; `/processos/:id/sigilo` |
| Adjudicação e homologação como atos; documentos preparatórios divulgados após a homologação (art. 54, § 3º) | 908 | ✅ | F26: RF-18 atos registrados por autoridade designada e liberação pública de preparatórios; `POST /processos/:id/selecao/adjudicacao` e `/homologacao` |
| Despacho de autorização de abertura | 2317 | ✅ | F20: RF-32 peça complementar da fase preparatória assinada pela autoridade designada |

## 7. Seleção do fornecedor

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Sala de disputa com lances ao vivo (modos aberto e fechado, diálogo competitivo) | 58, 63, 658, 687, 1487–1489, 1817 | ✅ | F30: RF-22, RN-26 simulação com rito completo e acompanhamento Compras.gov.br; `/processos/:id/sessoes-disputa` |
| Dispensa eletrônica com aviso de 3 dias úteis | 58, 702, 1817 | 🟡 | Em andamento na Frente S (F9) |
| Sicx (Lei 15.266/2025) | 58, 1817 | 📋 F9 | Em andamento na Frente S |
| Cartão de pagamento | 1496 | 📋 F9 | Em andamento na Frente S |
| Desempate do art. 60 e LC 123 | 60, 880, 1820 | ✅ | RN-08 `aplicarDesempate` |
| Desempenho anterior vindo do índice, não digitado | 1117, 1820 | ✅ | F3: RN-37 nota consolidada do registro cadastral para desempate do art. 60 e pontuação técnica |
| Sinal de sócio em comum entre licitantes e com agentes | 63, 658 | ✅ | RIA-06 e RN-03 |
| Vínculos informados por fonte lícita; extensão de sanção (art. 160) | 1132, 1830 | ✅ | F4: RN-27, RIA-10 vínculos de contato/endereço, informados e declarados, e extensão de sanção; `/impedimentos/*` |
| Parentesco descoberto por cruzamento de dados; bots e IP em tempo real | 63, 1132, 1509, 1821 | ⛔ | Sem fonte lícita (LGPD); a Ágora não recebe IP, e lances só na sala de disputa (F30); a IA não desclassifica. Alternativas: F4 e F14 |
| Leitura de atestados por OCR (PoC-03) | 64, 687, 1818 | ✅ | F13: RIA-08 leitura assistida de atestados com OCR e extração de quantitativos; `POST /processos/:id/arquivos/:arquivoId/leitura` |
| Prova de conceito nos processos do órgão | 1817 | ✅ | F1: RN-20 convocação pública, laudo e resultado da PoC do vencedor; `POST /processos/:id/selecao/prova-conceito/*` |
| Fase recursal com controle de prazos | 61, 195 | ✅ | F26: RN-22 fase única com 3 dias úteis para razões e contrarrazões (art. 165, I); `POST /processos/:id/selecao/recurso/*` |

## 8. Contratos e execução

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Painel de vigências 30/60/90, saldos, empenhos, ordem cronológica | 67, 1107, 1825 | ✅ | RF-01, RN-17, RN-18 |
| Faixa de 120 dias no semáforo | 1106 | ✅ | F27: RN-31 faixa de planejamento e alertas da central de notificações; `classificarVigencia` |
| Bloqueio antes da assinatura (CEIS/CNEP e regularidade) | 69, 688, 1829 | ✅ | F18: RF-20 consulta real via API do Portal da Transparência e checklist completo de regularidade; `POST /fornecedores/:id/regularidade/consultar` |
| **Aditivos e prorrogação como atos registrados, com travas** (art. 125, regularidade, risco da matriz) | 586, 638, 1358, 1829 | ✅ | F22 (parte 1): RN-32, RN-33, RF-27 atos formais com travas do art. 125, regularidade e publicação; `POST /contratos/:id/alteracoes` |
| Recebimento provisório e definitivo (art. 140), com prazos | 67, 982, 1532 | 🟡 | Em andamento na Frente L (F22 parte 2) |
| Garantias: alerta de vencimento pelo servidor, liberação, execução e renovação | 67, 1107 | 🟡 | Em andamento na Frente L (F22 parte 2) |
| Prazos de liquidação e pagamento | 732, 958 | 🟡 | Em andamento na Frente L (F22 parte 2) |
| Reajuste (índice e cálculo), repactuação e reequilíbrio, extinção, período antes da ordem de serviço | 942–1001, 1058 | ✅ | F22 (parte 1): RF-27 apostilamentos de reajuste/repactuação e processo de extinção com ampla defesa; `POST /contratos/:id/reajustes`, `/extincao` |
| Alerta de limite de prorrogação e de nova licitação | 1111 | ✅ | F22 (parte 1): RN-33 e F27: RN-31 alertas aos 120 dias indicando vigência máxima do contrato |
| Papel de fiscal requisitante | 715–725 | 🟡 | Em andamento na Frente L (F22 parte 2) |
| IMR, medição mensal e conferência da nota fiscal | 734–790, 1140 | ✅ | F7: RN-36, RF-29 indicadores, medições mensais, glosa determinística e conferência de notas fiscais; `/contratos/:id/imr` |
| Desconto da multa na garantia ou na fatura (com confirmação humana) | 1129 | 🟡 | Em andamento na Frente L (F22 parte 2) |
| Manter a habilitação durante a execução (antes do atesto e do pagamento) | 1041 | ✅ | F18: RN-23 recheque automático de CEIS/CNEP e certidões antes do atesto e do pagamento; `POST /pagamentos/:id/regularidade` |
| Divulgação de aditivos no PNCP | 78 | ✅ | F22 (parte 1): RN-32 e F11: RF-19 envio de aditivos pela fila de integrações |
| Notificações externas (e-mail, SEI) a fiscais e contratadas | 1108, 1532 | ✅ | F27: RF-26 central de notificações com envio por SMTP institucional, SEI e gov.br; `/notificacoes` |
| Gestão compartilhada com a sociedade e relatório final (art. 174, § 3º, VI) | 1148, 1589, 1825 | ✅ | F28: RF-37 manifestações da sociedade moderadas, respostas e relatório final; `/sociedade/*` |
| Percentuais do Decreto 11.430/2023 na execução | 1042 | 🟡 | Em andamento na Frente L (F22 parte 2) |

## 9. Fornecedores, sanções e índice de desempenho

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Índice de desempenho de 0 a 100 com faixas, só com indicadores objetivos | 1115, 1122, 1827 | ✅ | RF-13 `calcularIdc`, com metodologia e aviso. Componente de IMR: F7 |
| Selos "Diamante, Ouro, Prata… Impedido" | 1088, 1115, 1154, 1259 | ✅ | F34: RF-13 selos integrados ao IDC, com 'Impedido' restrito a sanção vigente (arts. 156 e 158) |
| Documento de avaliação de desempenho e envio ao cadastro de atesto do PNCP | 1119, 1827 | ✅ | F3: RN-37, RF-30 emissão de documento comprobatório em PDF, registro cadastral e certificado com autenticidade |
| Processo sancionatório com prazo de defesa | 67, 1128 | ✅ | RF-14, RN-13. As alegações finais ficam para a F22 |
| Dosimetria das multas compensatória (0,5% a 30%) e moratória | 72, 688, 1129, 1826 | ✅ | RN-12 e RN-19, com simuladores |
| **Consulta real ao CEIS/CNEP e às certidões (Receita, CNDT)** | 69, 661, 922, 1110 | ✅ | F18: RF-20 consulta oficial no servidor via API do Portal da Transparência com cache e hash; `POST /fornecedores/:id/regularidade/consultar` |
| **Envio da sanção ao CEIS/CNEP em até 15 dias úteis (art. 161)** | 70, 1031, 1131, 1826 | ✅ | F18: RN-24 controle de prazo de 15 dias úteis e registro de protocolo de envio; `GET /sancoes/registro-ceis-cnep` |

## 10. Auditoria e controle

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Trilha imutável de todo o processo | 415, 1142 | ✅ | RNF-03: encadeamento por hash e verificação de integridade |
| Logs assinados ou com carimbo de tempo ICP-Brasil | 1142 | ✅ | F25: RNF-09 carimbo de tempo RFC 3161 na trilha de auditoria; `/auditoria/ancoragens` |
| Painel das 3 linhas de defesa (art. 169) | 644, 1136, 1826 | ✅ | F8: RF-23 painel segregado das 3 linhas de defesa; `/controle/*` |
| Cautelares do TCU (10 dias úteis, art. 171, § 2º) | 1139, 1826 | ✅ | F2: RN-30, RF-24 controle de cautelares e prazo de resposta de 10 dias úteis; `/medidas-controle` |
| Matriz de achados preventivos e relatório executivo de auditoria | 1140, 1155 | ✅ | F8: RF-23 matriz de achados preventivos e relatório executivo em PDF; `/controle/relatorio.pdf` |
| Auditoria contínua de notas, medições e aditivos (sobrepreço, desequilíbrio) | 1143 | ✅ | F24: RIA-15 auditor contínuo com detecção de notas atípicas e divergências; `/controle/auditor-ia` |

## 11. Integrações, IA e infraestrutura

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Login único gov.br | 318, 1689 | ✅ | `/sessao/govbr/*` |
| Integração com o SEI | 327, 1784 | ✅ | F12: RF-35 integração SeiWS com envio de documentos e consulta de assinaturas; `/processos/:id/sei/*` |
| Assinatura ICP-Brasil dentro da aplicação | 318, 512, 1689, 1784 | ⛔ | Exigiria componente de terceiros no navegador. Alternativa: assinar no SEI e refletir (F12) |
| IA privada em contêiner do órgão, sem treino externo | 521, 1693 | ✅ | `ia/provedor.ts`: nenhum provedor ou LLM auto-hospedado |
| Escopo por UASG (Administração Central, PF, PRF, SENASP, SENAPPEN) | 295, 336 | ✅ | RNF-05 |
| Dados abertos | 75, 327 | ✅ | F28: RF-38 catálogo público de dados abertos em CSV e JSON com dicionário de dados; `/publico/dados-abertos` |
| Fila de mensageria (RabbitMQ ou Kafka) com novas tentativas | 522, 540, 1582, 1697 | ✅ | F31: RNF-07 fila RabbitMQ auto-hospedada com novas tentativas e fila de erro; `/fila/*` |
| Microsserviços orquestrados em Kubernetes | 389, 799, 1697 | ✅ | F31: desacoplamento de serviços e manifests Kubernetes (`deploy/k8s/*`) |
| TI verde: autoescalonamento e desligamento fora do expediente | 464 | ✅ | F29: RNF-10 autoescalonamento e cronjob de desligamento fora do expediente (`deploy/k8s/*`) |
| Volume de 4.500 processos/ano e 12.000 documentos; disponibilidade de 99,8% | 341, 573, 1697 | ✅ | F29: RNF-10 teste de carga reproduzível e medição neutra de disponibilidade (IMR-01); `/operacao/*` |

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

## 14. Equivalentes lícitos adotados nas entregas

Para atender aos objetivos do cliente sem violar a legislação (Lei 14.133/2021 e LGPD) nem os requisitos de soberania e não decisão por IA (regras 4 e 5), as entregas adotaram os seguintes equivalentes lícitos:

1. **Frente A (Jornada, PoC-01, F1, F21, F26):** prova de conceito e amostra conduzidas por sessão pública gravada e laudo motivado do agente, sem decisão automatizada por IA; fase recursal única com o prazo legal de 3 dias úteis para razões e contrarrazões (art. 165, I); divulgação preparatória pública respeitando o sigilo legal.
2. **Frente B (Integrações e mensageria, F31, F11):** publicação no PNCP por serviço trabalhador desacoplado com fila durável RabbitMQ (ou fallback PostgreSQL), novas tentativas com backoff e chave de idempotência, operando no servidor sem expor credenciais no navegador.
3. **Frente C (CEIS/CNEP e certidões, F18, PoC-04):** consulta oficial no servidor via API de dados do Portal da Transparência (ou mock sintético offline) com cache e hash; em vez de escrita direta em cadastro externo fechado, controle rigoroso do prazo legal de 15 dias úteis (art. 161) com pendências e alertas.
4. **Frente D (Documentos e OCR, F13, PoC-03):** processamento de arquivos em armazenamento próprio seguro fora do banco; OCR em contêiner isolado local que apenas extrai quantitativos e trechos para validação do agente, sem habilitação automática por máquina.
5. **Frente E (Sala de disputa, F30, PoC-03):** simulação completa de disputa (modos aberto e aberto/fechado) para treino e PoC; na sessão oficial, acompanhamento dos dados da disputa no Compras.gov.br (onde a sessão federal ocorre por força da IN SEGES/ME 73/2022), com detecção de padrões de lances como sinal indicativo para o pregoeiro, sem "Sentinela" que desclassifica ou rastreia IP.
6. **Frente F (Vínculos e impedimentos, F4, F14):** cruzamento societário por QSA oficial de dados abertos do CNPJ e vínculos declarados formalmente pelos servidores e licitantes, sem cruzamento invasivo de dados pessoais ou deduções ilícitas de parentesco (LGPD); extensão de sanção via processo formal com contraditório e parecer prévio (art. 160).
7. **Frente H (Controle e cautelares, F8, F2):** segregação estrita das 3 linhas de defesa por perfil e UASG no servidor; medidas cautelares do controle externo com prazos de resposta (10 dias úteis) e travas determinísticas de avanço, sem interferência autônoma no mérito processual.
8. **Frente I (Pesquisa de preços, F23):** consultas automatizadas a fontes oficiais (Painel de Preços, compras similares, Sinapi/Sicro) e projeções inflacionárias e cambiais apresentadas como sugestões documentadas para incorporação voluntária pelo planejador, sem alteração automática da cesta.
9. **Frente J (Notificações externas, F27):** central de comunicação baseada em canais institucionais seguros (SMTP institucional, SEI, gov.br) com mascaramento de dados de contato (LGPD) e registro de base legal de envio, sem envio por mensageria comercial desprotegida.
10. **Frente K (Alterações contratuais, F22 parte 1):** termos aditivos, apostilas, reajustes, repactuações, reequilíbrios e extinções tratados como atos administrativos formais com travas rígidas nos limites legais (art. 125 e arts. 105–114), parecer jurídico prévio e publicação no PNCP.
11. **Frente M (IMR e conferência de notas, F7):** glosa do IMR aplicada como ajuste determinístico do valor devido em medições mensais, separando expressamente a retenção financeira do processo sancionatório, que exige rito próprio e contraditório.
12. **Frente N (Desempenho e lições aprendidas, F3, F6):** índice de desempenho do contratado calculado exclusivamente a partir de indicadores objetivos de execuções contratuais registradas; lições aprendidas sugeridas como sugestões de cláusulas no DFD, ETP e TR, com inclusão voluntária pelo agente.
13. **Frente P (Documentos preparatórios e dotação, F20):** minutas e peças complementares (portaria de designação, declaração de adequação orçamentária, despacho de autorização, nota à CONJUR) geradas por modelos determinísticos auditáveis e assinadas pela autoridade competente designada.
14. **Frente Q (IA ancorada e precisão normativa, F24):** ancoragem soberana sobre o texto compilado da Lei 14.133/2021 no próprio repositório com recuperação BM25, verificação determinística de citações legais (IMR-02) e conferência cruzada entre peças, sem dependência de LLM comercial externo.
15. **Frente R (Sigilo de segurança pública, F25):** classificação formal nos graus da LAI (art. 13) e orçamento sigiloso (art. 24) com autoridade competente e termo final, cofre de anexos cifrado em repouso com AES-256-GCM e carimbo de tempo RFC 3161 na trilha, garantindo transparência pública após a desclassificação ou homologação.
16. **Frente T (Integração SEI e DOU, F12, F11 DOU):** instrução de processo no SEI via SeiWS oficial com assinatura refletida (o servidor assina no próprio SEI com certificado ICP-Brasil, sem instalar applets no navegador da Ágora); geração de matérias DOU no padrão da Seção 3 e protocolo no INCom.
17. **Frente U (Sociedade e dados abertos, F28):** participação cidadã com autenticação gov.br, moderação prévia com justificativa, descarte de metadados de mídia (EXIF) e tarjamento de nomes (iniciais), com catálogo público de dados abertos em formato aberto sem exposição de dados pessoais.
18. **Frente V (Operação e metas, F29, F32):** medição neutra de disponibilidade (IMR-01) com sonda isolada que desconta janelas de manutenção oficiais do PNCP, e painel de metas do ETP aferindo prazos, erros formais e economia real sem creditar economias fictícias a "algoritmos de IA".

## 15. O que depende do órgão

Para funcionamento pleno em ambiente de produção fora do modo de demonstração/simulado, a Ágora depende das seguintes providências e acessos fornecidos pelo órgão:

1. **Credenciais do PNCP:** usuário, senha e certificado digital de sistema credenciado para integração via barramento da API de manutenção do PNCP, tanto para o ambiente de homologação (sandbox) quanto de produção.
2. **Chave de API do Portal da Transparência:** chave de acesso aos serviços de dados abertos da CGU para consulta oficial aos cadastros de sanções CEIS e CNEP.
3. **Web Service do SEI:** liberação do serviço SeiWS na infraestrutura do órgão, com credenciais, chaves de autenticação e parâmetros de unidade cadastrados.
4. **Servidor SMTP institucional:** dados de conexão do servidor de correio eletrônico do órgão (endereço, porta TLS, usuário e senha institucional) para envio das notificações automatizadas.
5. **Configuração gov.br:** credenciais de integração OAuth2 (`clientId` e `clientSecret`) do Login Único gov.br cadastradas junto ao Ministério da Gestão e da Inovação em Serviços Públicos (MGI).
6. **Autoridade de Carimbo do Tempo (ACT):** endereço do servidor de carimbo de tempo no padrão RFC 3161 credenciado na ICP-Brasil (ou autoridade interna do órgão) para ancoragem criptográfica periódica da cadeia de auditoria.
7. **Espelho ou conector do QSA da Receita Federal:** carga periódica ou conector aos dados abertos do Cadastro Nacional de Pessoas Jurídicas e Quadro de Sócios e Administradores (QSA) para verificação societária.
8. **Cluster Kubernetes e infraestrutura:** ambiente de nuvem governamental com cluster Kubernetes para implantação dos serviços (API, trabalhador assíncrono, worker de OCR, banco de dados PostgreSQL e RabbitMQ).

## 16. Pontos para confirmar com o usuário

Com base nas entregas das frentes de trabalho, os seguintes pontos negociais e regulamentares devem ser confirmados com o gestor do órgão:

1. **Avisos legais obrigatórios das notificações (Frente J):** confirmar formalmente quais categorias de notificações devem ser marcadas como obrigatórias, sem possibilidade de desativação (opt-out) pelo usuário nas suas preferências (por exemplo: aviso de vencimento a 30 dias do término de vigência e convocação para regularização fiscal).
2. **Prazo de defesa na extinção contratual (Frente K):** confirmar o prazo regulamentar do órgão concedido ao contratado para apresentação de defesa prévia na hipótese de rescisão/extinção unilateral do contrato com base no art. 137 (5 dias úteis ou 15 dias úteis).
3. **Divulgação da nota técnica de preços após a homologação (Frentes R e A):** confirmar se a nota técnica com a pesquisa de preços e memórias de cálculo de estimativa deve ser disponibilizada publicamente sem restrições logo após o ato de homologação, ou se processos da área de segurança pública devem reter a nota técnica sob sigilo parcial por conter informações estratégicas ou táticas.
4. **Peso do IMR no índice de desempenho (Frentes M e N):** confirmar a ponderação percentual atribuída ao cumprimento das metas do Instrumento de Medição de Resultado (IMR) na composição da nota final do Índice de Desempenho Contratual (IDC) do fornecedor.
