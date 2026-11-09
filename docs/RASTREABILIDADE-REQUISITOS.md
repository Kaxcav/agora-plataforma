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
| 📋 Planejado | Não existe, mas está no plano (F1 a F34) |
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
- **Funções prontas entregues:** F1 a F34, todas. Entraram nesta rodada F5, F9, F10, F19 e F22 (parte 2).
- **Execução contratual (F22 ✅):** completa. Parte 1: termos aditivos com trava do art. 125, prorrogação com limites dos arts. 105 a 114, apostilamento de reajuste e repactuação, reequilíbrio econômico-financeiro e processo de extinção com ampla defesa. Parte 2 (Frente L): designação da fiscalização e livro de ocorrências (RF-28), termos de recebimento provisório e definitivo com PDF (RN-34), garantias, desconto de multa (RN-35), prazos de pagamento com atualização monetária e alteração justificada da ordem cronológica, ordem de serviço e reservas legais de cargos.
- **Planejamento (Frente O: F5, F10 e F19):** plano de contratações anual consolidado, aprovado e publicado no PNCP pela fila (RF-31), conferência do DFD com o PCA publicado, sugestão do código CATMAT/CATSER com escolha do agente (RIA-13) e intenção de registro de preços aberta por 8 dias úteis (RN-38).
- **Rotas de contratação (Frente S: F9):** licitação, dispensa eletrônica com aviso de 3 dias úteis (RN-41), inexigibilidade, adesão a ata, Sicx com vitrine simulada (RN-42) e cartão de pagamento com extrato (RF-34).
- **Frentes em andamento:** nenhuma.

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
| Símbolos da Justiça (balança, escudo, brasão, martelo) | 30, 128, 1760 | ✅ | Ícones próprios acessíveis servidos pela aplicação sem dependência de CDN externa (`apps/web/src/layout/Marca.tsx`) |
| Menu lateral retrátil, painel sem recarregar | 31, 132 | ✅ | `MenuLateral`, gaveta no celular, SPA |
| Modo especificação técnica (RF/RN/RIA de cada tela) | 31, 1096, 1765 | ✅ | `ModoEspecificacao`, `PainelRegras` |
| Caderno de regras exportável | 85, 245, 1749 | ✅ | `/regras`, pronto para impressão |
| Barra das 7 etapas e seletor de processos por órgão | 1763–1764 | ✅ | `TrilhaEtapas`; filtro por órgão |
| Dados fictícios realistas | 84, 1154 | ✅ | Seed sintético (regra 3): `apps/api/src/seed/index.ts` |
| Entrega em HTML único com Tailwind e ícones por CDN | 19, 1153, 1835 | ⛔ | Viola a regra 4. A Ágora serve tudo pela própria aplicação |

## 3. Planejamento: demanda, PCA, equipe, ETP e riscos

| Requisito | Linhas | Status | Evidência ou o que falta |
|---|---|---|---|
| Formulário do DFD | 40, 1775 | ✅ | `PUT /processos/:id/dfd`, `modeloDfd` |
| DFD ligado ao catálogo CATMAT/CATSER, com sugestão do item | 44, 47, 1445, 1775 | ✅ | F19: RIA-13 sugestão determinística do código, com escolha do agente e proveniência; `GET /catalogo/sugestoes`, `PUT /processos/:id/dfd/itens/:indice/catalogo` |
| DFD conferido com o PCA publicado | 40, 643, 1775 | ✅ | F10: RF-31 `conferirDfdComPca`, vínculo com o item do PCA e consulta ao PNCP pelo conector; `GET /processos/:id/pca` e `PUT /processos/:id/pca` |
| PCA consolidado a partir dos DFDs e publicado | 1410 | ✅ | F10: RF-31 `consolidarPca`, aprovação pela autoridade (quem consolidou não aprova) e publicação pela fila (`pncp.pca`); `/pca/*` |
| Adequação orçamentária (dotação, LOA) | 44, 817–827, 2284 | ✅ | F20: dotação estruturada (RN-39), declaração orçamentária e checklist (RF-32); rotas GET/PUT `/processos/:id/dotacao` |
| Lições aprendidas de contratos anteriores no DFD | 1120, 1776 | ✅ | F6: RIA-12, banco de lições sugeridas no DFD, ETP e TR; rotas `/processos/:id/licoes-aprendidas` |
| Bloqueio de artigo de luxo (art. 20) | 43, 1778 | ✅ | RN-01 |
| Justificativa para não usar o catálogo de padronização (art. 19, § 2º) | 1779 | ✅ | RN-02 |
| Consolidação de demandas entre órgãos (IRP) | 1780 | ✅ | F5: RIA-01 sinal de registro compartilhado e RN-38 IRP aberta por pelo menos 8 dias úteis, com adesão e consolidação das quantidades; `/irps/*` |
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
| Dispensa eletrônica com aviso de 3 dias úteis | 58, 702, 1817 | ✅ | F9: RN-41 aviso publicado no PNCP pela fila, propostas adicionais, julgamento, autorização da autoridade e fracionamento por ramo; `/processos/:id/dispensa/*` |
| Sicx (Lei 15.266/2025) | 58, 1817 | ✅ | F9: RN-42 ranqueamento, segregação, recebimento e pagamento em até 30 dias (Decreto 13.106/2026); `/sicx/*`. A vitrine é simulada até a API do Sicx existir |
| Cartão de pagamento | 1496 | ✅ | F9: RN-41 compras com cartão dentro do limite, extrato mensal e sinal de fracionamento; `/cartao-pagamento/*` |
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
| Recebimento provisório e definitivo (art. 140), com prazos | 67, 982, 1532 | ✅ | F22 (parte 2): RN-34 termos em PDF com hash, definitivo por quem não lavrou o provisório e atesto da nota no mesmo ato; `POST /contratos/:id/recebimentos`, `/recebimentos/:id/termos` |
| Garantias: alerta de vencimento pelo servidor, liberação, execução e renovação | 67, 1107 | ✅ | F22 (parte 2): RN-35 exigência, apresentação, renovação, liberação, execução e alerta de 30 dias pela central de notificações; `/garantias/*` |
| Prazos de liquidação e pagamento | 732, 958 | ✅ | F22 (parte 2): RN-34 e RF-28 tela Prazos de pagamento, atualização monetária estimada e alteração justificada da ordem cronológica; `GET /pagamentos/prazos` |
| Reajuste (índice e cálculo), repactuação e reequilíbrio, extinção, período antes da ordem de serviço | 942–1001, 1058 | ✅ | F22 (parte 1): RF-27 apostilamentos de reajuste/repactuação e processo de extinção com ampla defesa; `POST /contratos/:id/reajustes`, `/extincao`. F22 (parte 2): período antecedente à ordem de serviço (art. 92, § 2º); `POST /contratos/:id/ordens-servico` |
| Alerta de limite de prorrogação e de nova licitação | 1111 | ✅ | F22 (parte 1): RN-33 e F27: RN-31 alertas aos 120 dias indicando vigência máxima do contrato |
| Papel de fiscal requisitante | 715–725 | ✅ | F22 (parte 2): RF-28 designação de gestor, fiscais técnico, administrativo e requisitante e comissão de recebimento, com segregação; `POST /contratos/:id/designacoes` |
| IMR, medição mensal e conferência da nota fiscal | 734–790, 1140 | ✅ | F7: RN-36, RF-29 indicadores, medições mensais, glosa determinística e conferência de notas fiscais; `/contratos/:id/imr` |
| Desconto da multa na garantia ou na fatura (com confirmação humana) | 1129 | ✅ | F22 (parte 2): RN-35 plano de desconto (pagamentos devidos, depois garantia) por decisão registrada da autoridade, art. 156, § 8º; `POST /sancoes/:id/descontos`. Equivalente lícito, seção 14 |
| Manter a habilitação durante a execução (antes do atesto e do pagamento) | 1041 | ✅ | F18: RN-23 recheque automático de CEIS/CNEP e certidões antes do atesto e do pagamento; `POST /pagamentos/:id/regularidade` |
| Divulgação de aditivos no PNCP | 78 | ✅ | F22 (parte 1): RN-32 e F11: RF-19 envio de aditivos pela fila de integrações |
| Notificações externas (e-mail, SEI) a fiscais e contratadas | 1108, 1532 | ✅ | F27: RF-26 central de notificações com envio por SMTP institucional, SEI e gov.br; `/notificacoes` |
| Gestão compartilhada com a sociedade e relatório final (art. 174, § 3º, VI) | 1148, 1589, 1825 | ✅ | F28: RF-37 manifestações da sociedade moderadas, respostas e relatório final; `/sociedade/*` |
| Percentuais do Decreto 11.430/2023 na execução | 1042 | ✅ | F22 (parte 2): RF-28 verificação mensal das reservas legais de cargos, só com quantidades; `POST /contratos/:id/reservas-cargos` |

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
| Microsserviços orquestrados em Kubernetes | 389, 799, 1697 | ✅ | F31: desacoplamento de serviços e manifests Kubernetes (`deploy/k8s/agora.yaml`, `deploy/k8s/fila-trabalhador.yaml`, `deploy/k8s/documentos-ocr.yaml`; serviço `apps/api/src/trabalhador.ts`) |
| TI verde: autoescalonamento e desligamento fora do expediente | 464 | ✅ | F29: RNF-10 autoescalonamento e cronjob de desligamento fora do expediente (`deploy/k8s/autoescalonamento.yaml`, `deploy/k8s/homologacao-expediente.yaml`) |
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
19. **Frente L (Execução contratual, F22 parte 2):** o desconto de multa na garantia ou na fatura não é automático: depende de decisão registrada da autoridade competente (art. 156, § 8º), e a Ágora só calcula o plano, na ordem da lei (pagamentos devidos, garantia e cobrança judicial). A Ágora não paga nem liquida, que é do SIAFI: o termo definitivo atesta a nota e os prazos e a atualização monetária são calculados para acompanhamento. As reservas de cargos (Decretos 11.430/2023 e 9.450/2018) guardam só quantidades e a comprovação conferida pelo fiscal, nunca nomes, porque a condição de vítima de violência doméstica ou de egresso é dado pessoal sensível (LGPD). O termo é gerado pela Ágora, com hash, e a assinatura formal fica no SEI.
20. **Frente O (Planejamento, F5, F10, F19):** a "vinculação automática ao catálogo" e a "IA classificadora" viram sugestão determinística, por semelhança de texto, que só entra no DFD por escolha do agente, registrada na trilha. "Agrupar demandas entre órgãos" vira sinal mais intenção de registro de preços, o procedimento legal do art. 86, sem percentual de economia inventado. A "publicação direta no PNCP" do PCA sai do servidor, pela fila, depois da aprovação da autoridade (Decreto 10.947/2022, art. 12). Quem consolidou o plano não o aprova.
21. **Frente S (Rotas de contratação, F9):** a "publicação automática do aviso" da dispensa vira publicação por ato do agente com o perfil de publicação, pela fila, com contagem automática do prazo. O fracionamento é sinal, não decisão: acima do limite no mesmo ramo, a dispensa exige a análise do agente por escrito. A integração com o Sicx é uma vitrine simulada até a plataforma e a API existirem, e as regras do Decreto 13.106/2026 já valem. O extrato do cartão de pagamento fica registrado na Ágora, e a divulgação no PNCP vai para a fila de erro no modo online, porque o PNCP não tem o serviço.

### Costuras da versão 2.0.1

| Pedido | Como ficou | Evidência |
|---|---|---|
| Ocorrências no desempenho e no IDC | Livro único de ocorrências em `contratos_ocorrencias` com visão `ocorrencias_execucao` e gatilhos de sincronização. A apuração de desempenho (`derivadosDoPeriodo`) deriva entregas no prazo e termos definitivos aceitos sem ressalva do período; os termos e ocorrências alimentam `fornecedores_indicadores` para cálculo do IDC. | `apps/api/migracoes/032_costura_execucao.sql`, `contratos_ocorrencias`, `ocorrencias_execucao`, `derivadosDoPeriodo`, `fornecedores_indicadores`, `apps/api/src/modulos/desempenho/repositorio.ts`, `apps/api/src/modulos/desempenho/rotas.ts`, `catalogo-regras.ts` (RN-37) |
| Recebimento definitivo na conferência da nota | Entrega com registro de quantidade e itens; o contexto da conferência (`recebimentoDefinitivo`) vincula o termo definitivo aceito à parcela e a tela pré-carrega a quantidade recebida aferida, comparando-a com a quantidade cobrada da nota fiscal sem preenchimento automático do faturado. | `ConferenciaNota.tsx`, `recebimentoDefinitivo`, `POST /contratos/:id/recebimentos`, `apps/api/src/modulos/imr/servico.ts`, `catalogo-regras.ts` (RN-36) |
| Prorrogação e extinção agindo sobre a garantia | Prorrogação assinada com garantia cuja validade não cobre a nova vigência registra exigência de renovação e abre pendência de até 15 dias com aviso à contratada. Extinção desconta multas na ordem legal (pagamentos devidos primeiro, depois garantia em `multas_descontos`), liberando caução atualizada se não houver pendências ou retendo para execução motivada pela autoridade, com aviso ao emitente via SEI. | `apps/api/src/modulos/execucao/garantia-extincao.ts`, `planejarDescontoMulta`, `avaliarLiberacaoGarantia`, `atualizarCaucaoDinheiro`, `multas_descontos`, `emitente_garantia`, `catalogo-regras.ts` (RN-33, RN-35) |
| Avisos ao cidadão na gestão compartilhada | Disparo automático de notificações por e-mail ao cidadão na decisão da moderação (aprovação ou recusa com motivo) e no registro de resposta à manifestação, transmitindo a versão pública tarjada (`resposta.textoPublico`), com e-mail mascarado na central e aviso obrigatório (`avisoObrigatorio`). | `notificarCidadaoManifestacao`, `resposta.textoPublico`, `apps/api/src/modulos/sociedade/rotas.ts`, `packages/dominio/src/notificacoes.ts`, `avisoObrigatorio`, `apps/api/migracoes/033_costura_transversal.sql` (`tipo` `'manifestacao'`, `papel` `'cidadao'`) |
| Sigilo nas telas internas (LAI e segurança pública) | Usuários sem credencial ativa visualizam `"Informação classificada (grau)"` nas listas; busca textual é cega aos termos do objeto real (mantida busca por número formal); detalhe do contrato sigiloso bloqueia com HTTP 403 e auditoria de acesso negado; perfis Auditor e Controle interno possuem acesso irrestrito (`sigilo:controle`) com registro de consulta. | `apps/api/src/modulos/sigilo/acesso.ts`, `apps/api/src/modulos/sigilo/rotas.ts`, `processosSemAcesso`, `contratosSemAcesso`, `mascararContratosSigilosos`, `rotuloInformacaoClassificada`, `sigilo_acessos`, `sigilo:controle`, `ROTULO_BASE` |
| Edital com modo de disputa e tabela do art. 67 | Inclusão do parâmetro `modoDisputa` no preâmbulo do edital e na seleção do TR, integrando o hash determinístico (`hashParametrosDocumento`) para invalidar versões desatualizadas (`geradoComParametrosAnteriores`). Geração automática da tabela de qualificação técnica (art. 67, § 2º) na seção 6.4 do edital com parcelas de maior relevância, valores, quantitativos e limite de até 50%. | `apps/api/src/modulos/jornada/parametros-edital.ts`, `hashParametrosDocumento`, `modoDisputa`, `apps/api/src/modulos/jornada/documentos.ts`, `geradoComParametrosAnteriores`, `qualificacaoTecnica` |
| Relatório LGPD com três origens consolidadas | Endpoint `GET /api/v1/lgpd/acessos` e tela `/auditoria/lgpd` unificam via `UNIAO_ACESSOS` dados pessoais revelados (`lgpd_acessos`), acessos a documentos do processo com dados pessoais (`processos_arquivos_acessos`) e consultas/downloads de informações sigilosas (`sigilo_acessos`), com supressão de CPF e filtros por usuário e origem. | `apps/api/src/modulos/lgpd/rotas.ts`, `UNIAO_ACESSOS`, `apps/web/src/paginas/auditoria/AcessosLgpd.tsx`, `GET /api/v1/lgpd/acessos`, `lgpd:relatorio`, `lgpd_acessos`, `processos_arquivos_acessos`, `sigilo_acessos` |
| Navegação e testes de acessibilidade | Verificação automatizada de acessibilidade digital (WCAG 2.1 AA via Axe) nos estados de navegação com processo classificado, relatório de acessos LGPD e varredura exaustiva de rotas por perfil (`TELAS_POR_PERFIL`), assegurando ausência de violações graves ou críticas. | `e2e/testes/costura-transversal.spec.ts`, `e2e/testes/navegacao.spec.ts`, `verificarAcessibilidade`, `TELAS_POR_PERFIL` |

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
9. **Credenciamento do PNCP para o PCA e a contratação direta:** o CNPJ do órgão entre os entes autorizados, as UASGs cadastradas como unidades e os códigos de amparo legal dos arts. 72, 74 e 75, que o PNCP só serve pelo portal (pncp.gov.br/app/entidades-dominio). Sem isso, o envio real do PCA e do aviso de dispensa não funciona, e a tarefa vai para a fila de erro.
10. **Plataforma e API do Sicx:** a disponibilização pelo órgão central e as normas complementares da SGI (credenciamento, critérios de ranqueamento, reputação). A vitrine da Ágora é simulada até lá.
11. **Liquidação e pagamento pelo SIAFI:** a data da liquidação das notas (`pagamentos.liquidado_em`) vem da integração. Na demonstração, vem da carga sintética.
12. **Conferência humana do texto legal:** o texto oficial do Planalto bloqueou a leitura automática. A conferência final dos arts. 96, § 1º, IV, e 99 (garantias), do art. 75, §§ 3º e 4º, e do art. 86, §§ 4º, 5º e 8º, e do art. 9º do Decreto 11.462/2023 é do órgão.

## 16. Pontos para confirmar com o usuário

Com base nas entregas das frentes de trabalho, os seguintes pontos negociais e regulamentares devem ser confirmados com o gestor do órgão:

1. **Avisos legais obrigatórios das notificações (Frente J):** confirmar formalmente quais categorias de notificações devem ser marcadas como obrigatórias, sem possibilidade de desativação (opt-out) pelo usuário nas suas preferências (por exemplo: aviso de vencimento a 30 dias do término de vigência e convocação para regularização fiscal).
2. **Prazo de defesa na extinção contratual (Frente K):** confirmar o prazo regulamentar do órgão concedido ao contratado para apresentação de defesa prévia na hipótese de rescisão/extinção unilateral do contrato com base no art. 137 (5 dias úteis ou 15 dias úteis).
3. **Divulgação da nota técnica de preços após a homologação (Frentes R e A):** confirmar se a nota técnica com a pesquisa de preços e memórias de cálculo de estimativa deve ser disponibilizada publicamente sem restrições logo após o ato de homologação, ou se processos da área de segurança pública devem reter a nota técnica sob sigilo parcial por conter informações estratégicas ou táticas.
4. **Peso do IMR no índice de desempenho (Frentes M e N):** confirmar a ponderação percentual atribuída ao cumprimento das metas do Instrumento de Medição de Resultado (IMR) na composição da nota final do Índice de Desempenho Contratual (IDC) do fornecedor.
5. **Reservas legais de cargos (Frente L):** confirmar o arredondamento para cima das vagas e o percentual efetivo do Decreto 11.430/2023 (8% com 25 colaboradores ou mais, e o percentual menor admitido pelo Decreto 12.516/2025) e das faixas do Decreto 9.450/2018 (3% a 6%). Os valores foram conferidos em fontes secundárias, e o percentual efetivo vem do edital.
6. **Livro de ocorrências e ocorrências da execução (Frentes L e N):** confirmar a unificação dos dois registros de ocorrências (`contratos_ocorrencias`, com notificação à contratada, e `ocorrencias_execucao`, base das lições aprendidas) e a ligação dos recebimentos ao desempenho (`derivadosDoPeriodo`).
7. **Publicação mensal da ordem cronológica (Frente L):** confirmar se a página de transparência deve publicar a ordem cronológica e as justificativas (art. 141, § 3º). Os dados estão registrados, mas a página pública não foi alterada.
8. **Esfera da ata e agências executivas (Frente S):** o cadastro de atas não guarda a esfera do gerenciador, e todas são tratadas como federais. Confirmar se haverá atas de outras esferas (art. 86, § 8º) e se alguma UASG é agência executiva (limite em dobro, art. 75, § 2º).
9. **Limites da dispensa em 2027 (Frente S):** o decreto de atualização ainda não foi publicado. Ao sair, a linha entra em `LIMITES_DISPENSA`.
10. **Alteração do PCA publicado (Frente O):** confirmar se o órgão quer a retificação e a exclusão de itens (Decreto 10.947/2022, arts. 15 e 16). Hoje a demanda fora do plano só gera o sinal de revisão.
11. **Dispensa da IRP (Frente O):** a dispensa quando o gerenciador é o único contratante (Decreto 11.462/2023, art. 9º, § 1º) fica a critério do gerenciador. Confirmar se a Ágora deve avisar.




## 17. Índice das regras do catálogo

Gerado do catálogo do código (`packages/dominio/src/catalogo-regras.ts`), com 106 regras. Cada código citado no código-fonte aparece aqui, com o fundamento e onde está implementado; as seções anteriores ligam esses códigos aos pedidos da conversa do cliente.

| Código | Regra | Status | Evidência ou o que falta | Fundamento |
|---|---|---|---|---|
| RN-01 | Vedação à aquisição de artigos de luxo | ✅ | `sinalizarArtigoLuxo`, `avaliarBloqueioLuxoMinutas`; api: `POST /processos/:id/documentos/gerar` | Lei 14.133/2021, art. 20; Decreto 10.818/2021 |
| RN-02 | Justificativa para não utilizar o catálogo de padronização | ✅ | api: `PUT /processos/:id/dfd`; bloqueio da etapa 1 em `POST /processos/:id/avancar` | Lei 14.133/2021, art. 19, § 2º |
| RN-03 | Segregação de funções na equipe do processo | ✅ | `verificarSegregacao` | Lei 14.133/2021, art. 7º, § 1º, e art. 9º |
| RN-04 | Elementos mínimos do Estudo Técnico Preliminar | ✅ | `validarEtp` | Lei 14.133/2021, art. 18, §§ 1º e 2º |
| RN-05 | Parâmetros da pesquisa de preços | ✅ | `analisarCestaPrecos` | Lei 14.133/2021, art. 23, § 1º; IN SEGES/ME 65/2021 |
| RN-06 | Habilitação econômico-financeira sem faturamento mínimo | ✅ | api: bloqueio da etapa 4 em `POST /processos/:id/avancar` | Lei 14.133/2021, art. 69, §§ 2º e 4º |
| RN-07 | Acesso ao edital sem cadastro | ✅ | api: `POST /processos/:id/publicar`; rotas públicas `GET /publico/*` | Lei 14.133/2021, art. 25, § 3º |
| RN-08 | Critérios de desempate | ✅ | `aplicarDesempate` | Lei 14.133/2021, art. 60; LC 123/2006, arts. 44 e 45 |
| RN-09 | Verificação de regularidade e sanções antes da assinatura ou prorrogação | ✅ | `avaliarChecklistRegularidade`; api: `POST /processos/:id/contratar`; `POST /contratos/:id/prorrogacoes` | Lei 14.133/2021, art. 91, § 4º |
| RN-10 | Limites de acréscimos e supressões | ✅ | `avaliarAditivo` | Lei 14.133/2021, art. 125 |
| RN-11 | Prazo de divulgação do contrato no PNCP | ✅ | `situacaoDivulgacaoPncp` | Lei 14.133/2021, art. 94 |
| RN-12 | Dosimetria da multa entre 0,5% e 30% | ✅ | `calcularDosimetriaMulta` | Lei 14.133/2021, art. 156, §§ 1º e 3º |
| RN-13 | Prazos de defesa e de registro no CEIS/CNEP | ✅ | `prazoDefesa`, `prazoRegistroCeisCnep` | Lei 14.133/2021, arts. 157, 158 e 161 |
| RN-14 | Dispensa por valor e fracionamento de despesa | ✅ | `avaliarFracionamento`, `limiteDispensaVigente` | Lei 14.133/2021, art. 75, I e II, e § 1º; art. 182 |
| RN-15 | Prazos mínimos para apresentação de propostas | ✅ | `prazoMinimoPropostas`, `dataMinimaAberturaPropostas` | Lei 14.133/2021, art. 55 |
| RN-16 | Contagem de prazos | ✅ | `contarPrazo`, `adicionarDiasUteis`, `feriadosNacionais` | Lei 14.133/2021, art. 183 |
| RN-17 | Vigência e semáforo de vencimentos | ✅ | `classificarVigencia` | Lei 14.133/2021, art. 84 (vigência da ata) e arts. 105 a 107 (duração dos contratos) |
| RN-18 | Ordem cronológica de pagamentos | ✅ | api: `GET /pagamentos`; `POST /pagamentos/:id/atestar` | Lei 14.133/2021, art. 141 |
| RN-19 | Multa moratória por atraso injustificado | ✅ | `calcularMultaMoratoria` | Lei 14.133/2021, art. 162 |
| RN-20 | Prova de conceito ou amostra do licitante provisoriamente vencedor | ✅ | `validarProvaConceito`, `prazoProvaConceito`, `avaliarSelecao`; api: `PUT /processos/:id/parametros-edital`; `POST /processos/:id/selecao/prova-conceito/convocacao`; `POST /processos/:id/selecao/prova-conceito/resultado` | Lei 14.133/2021, art. 17, § 3º, e art. 41, II |
| RN-21 | Critérios de sustentabilidade e logística reversa obrigatórios | ✅ | `verificarSustentabilidade`; api: `PUT /processos/:id/sustentabilidade`; GET e `PUT /politicas-orgao/sustentabilidade` | Lei 14.133/2021, art. 5º, art. 11, IV, e art. 18, § 1º, XII |
| RN-22 | Fase recursal única e prazos dos atos da seleção | ✅ | `prazosRecursoSelecao`, `avaliarSelecao`, `validarAtoSelecao`, `validarInversaoFases`; api: `POST /processos/:id/selecao/habilitacao`; `POST /processos/:id/selecao/recurso/*` | Lei 14.133/2021, art. 165, I, §§ 1º, 2º e 4º, e art. 17, § 1º |
| RN-23 | Recheque da regularidade antes do atesto e do pagamento | ✅ | `avaliarChecklistRegularidade`, `situacaoCertidao`; api: `POST /pagamentos/:id/atestar`; `POST /pagamentos/:id/regularidade` | Lei 14.133/2021, art. 92, XVI, e art. 91, § 4º |
| RN-24 | Registro da sanção aplicada no CEIS/CNEP em até 15 dias úteis | ✅ | `situacaoRegistroCeisCnep`, `prazoRegistroCeisCnep`; api: `GET /sancoes/registro-ceis-cnep`; `POST /sancoes/:id/registro-ceis-cnep` | Lei 14.133/2021, art. 161 |
| RN-25 | Parcelas de maior relevância, quantitativos mínimos e exercícios do balanço | ✅ | `classificarParcelaRelevancia`, `limiteQuantitativoMinimo`, `avaliarExigenciasQualificacaoTecnica`, `exerciciosBalancoExigiveis`, `avaliarBalancosApresentados`; api: `PUT /processos/:id/qualificacao-tecnica` | Lei 14.133/2021, art. 18, IX; art. 67, §§ 1º e 2º; art. 69, I e § 6º |
| RN-26 | Rito da sessão de disputa: modos, lances, prorrogação, encerramento e julgamento | ✅ | `validarModoDisputa`, `parametrosPadraoDisputa`, `validarLance`, `calcularEstadoSessao`, `classificarSessaoDisputa`, `avaliarReinicioDisputa`, `pontuarTecnicaEPreco`, `aplicarDesempate`; api: `POST /sessoes-disputa/:id/lances` | Lei 14.133/2021, arts. 33, 34, 36, § 2º, 56, 57, 59, 60 e 61; IN SEGES/ME 73/2022, arts. 5º e 19 a 30 |
| RN-27 | Extensão dos efeitos da sanção (desconsideração da personalidade jurídica) | ✅ | `proporExtensaoSancao`, `avancarExtensaoSancao`, `efeitosExtensaoSancao`; api: `POST /impedimentos/extensoes` e /impedimentos/extensoes/:id/defesa, /parecer, /decisao | Lei 14.133/2021, art. 160 |
| RN-28 | Declaração de inexistência de impedimento dos agentes designados | ✅ | `verificarDeclaracaoAgente`, `verificarDeclaracoesEquipe`; api: `POST /impedimentos/declaracoes`; `PUT /processos/:id/equipe` | Lei 14.133/2021, art. 7º, I a III e § 2º, art. 8º, caput e § 5º, e art. 9º, § 1º |
| RN-29 | Revisão trimestral da matriz de riscos do contrato | ✅ | `situacaoRevisaoRiscos`; api: `GET /contratos/:id/riscos`; `POST /contratos/:id/riscos/revisoes` | Lei 14.133/2021, arts. 22 e 169; matriz de riscos do contrato |
| RN-30 | Cautelar suspensiva do controle externo impede avançar e contratar | ✅ | `bloqueioControleExterno`, `prazoRespostaCautelar`; api: `POST /processos/:id/avancar`; `POST /processos/:id/contratar` | Lei 14.133/2021, art. 171, §§ 1º e 2º |
| RN-31 | Semáforo de vencimentos de 30, 60, 90 e 120 dias com avisos automáticos | ✅ | `classificarVigencia`, `faixaVencimento`, `avaliarAvisoVencimento`, `avisoObrigatorio`; api: `POST /notificacoes/varredura`; `GET /vencimentos` | Lei 14.133/2021, art. 84 (vigência da ata), arts. 105 a 107 (duração e prorrogação dos contratos) e art. 117… |
| RN-32 | Termo aditivo como ato, com a trava do art. 125 | ✅ | `avaliarTermoAditivo`, `avaliarAditivo`, `numeroTermoContratual`, `situacaoDivulgacaoTermoPncp`, `tipoTermoContratoPncp`; api: `POST /contratos/:id/alteracoes`; `POST /contratos/:id/alteracoes/:alteracaoId/parecer`; `POST /contratos/:id/alteracoes/:alteracaoId/assinar`; `GET /contratos/:id/alteracoes/:alteracaoId/termo.pdf` | Lei 14.133/2021, arts. 53, § 4º, 91, § 4º, 94, 124 e 125 |
| RN-33 | Prorrogação com os limites dos arts. 105 a 114 | ✅ | `avaliarProrrogacao`, `avaliarAlertaProrrogacao`, `situacaoProrrogacao`, `vigenciaMaximaAnos`; api: `POST /contratos/:id/prorrogacoes`; `POST /contratos/:id/alteracoes` (tipo prazo); varredura diária de notificações | Lei 14.133/2021, arts. 105 a 107, 110, 111 e 114 |
| RN-34 | Recebimento provisório e definitivo, liquidação e prazo de pagamento | ✅ | `prazoRecebimentoProvisorio`, `avaliarTermoRecebimento`, `calcularGarantiaObjeto`, `calcularPrazoPagamento`, `calcularAtualizacaoMonetaria`, `corrigirPorIndice`; api: `POST /contratos/:id/recebimentos`; `POST /recebimentos/:id/termos`; `GET /recebimentos/termos/:id/termo.pdf`; `POST /pagamentos/:id/atestar`; `GET /pagamentos/prazos` | Lei 14.133/2021, art. 92, V, VI e VII, e § 7º; art. 117; art. 119; art. 140; art. 141 |
| RN-35 | Garantias contratuais: exigência, validade, liberação, execução e desconto de multa | ✅ | `baseCalculoGarantia`, `avaliarPercentualGarantia`, `validarApresentacaoGarantia`, `situacaoGarantia`, `avaliarLiberacaoGarantia`, `atualizarCaucaoDinheiro`, `avaliarExecucaoGarantia`, `planejarDescontoMulta`, `validarDecisaoAutoridade`; api: `POST /contratos/:id/garantias`; `POST /garantias/:id/apresentacao`; `POST /garantias/:id/renovacao`; `POST /garantias/:id/liberacao`; `POST /garantias/:id/execucao`; `POST /sancoes/:id/descontos` | Lei 14.133/2021, arts. 96 a 102; art. 139, III; art. 145, § 2º; art. 156, § 8º |
| RN-36 | Conferência da nota fiscal com o valor devido e o ajuste do IMR | ✅ | `conferirNotaFiscal`, `calcularAjustePagamento`; api: `GET /pagamentos/:id/conferencia`; `POST /pagamentos/:id/conferencia`; `POST /pagamentos/:id/conferencia/justificativa`; `POST /pagamentos/:id/atestar` | Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A |
| RN-37 | Avaliação de desempenho do contratado e registro cadastral de atestos | ✅ | `avaliarDesempenhoContratado`, `situacaoAvaliacaoDesempenho`, `validarManifestacaoContratado`, `validarAnaliseManifestacao`, `consolidarRegistroDesempenho`, `avaliarIncentivoDesempenho`, `validarCriterioDesempenhoTecnica`, `comporNotaTecnicaComDesempenho`, `clausulaCriterioDesempenhoEdital`, `aplicarDesempate`; api: `POST /contratos/:id/avaliacoes-desempenho`; `GET /fornecedores/:id/desempenho`; `PUT /processos/:id/criterio-desempenho`; `PUT /processos/:id/disputa` | Lei 14.133/2021, art. 36, § 3º, art. 37, III, art. 60, II, art. 87 e art. 88, §§ 2º a 4º; Lei 9.784/1999, art… |
| RN-38 | Intenção de registro de preços aberta por pelo menos 8 dias úteis | ✅ | `verificarPrazoIrp`, `prazoMinimoIrp`, `situacaoIrp`, `consolidarQuantidadesIrp`; api: `POST /irps`; `POST /irps/:id/adesoes`; `POST /irps/:id/consolidar` | Lei 14.133/2021, art. 86, caput e § 1º; Decreto 11.462/2023, art. 9º; Lei 14.133/2021, art. 183 |
| RN-39 | Dotação orçamentária declarada antes do edital | ✅ | `validarDotacaoOrcamentaria`, `chaveDotacao`, `verificarDotacaoParaEdital`; api: GET e `PUT /processos/:id/dotacao`; `POST /processos/:id/avancar` | Lei 14.133/2021, art. 6º, XXIII, "j", art. 18, caput, e art. 150 |
| RN-40 | Sigilo de segurança pública: classificação, acesso restrito e divulgação | ✅ | `validarClassificacaoSigilo`, `prazoMaximoSigilo`, `autoridadeCompetenteSigilo`, `classificacaoVigente`, `situacaoOrcamentoSigiloso`, `decidirAcessoSigilo`, `marcacaoSigilo`, `codigoIndexacaoSigilo`; api: `POST /processos/:id/sigilo/classificacoes`; `POST /processos/:id/sigilo/classificacoes/:classificacaoId/desclassificar`; `POST /processos/:id/sigilo/documentos/:tipo/pdf`; checagens em /publico/editais, /publico/contratos e na fila do PNCP | Lei 14.133/2021, arts. 13, 18, § 1º, VI, 24, 91, § 1º, e 169, § 2º; Lei 12.527/2011, arts. 23 a 27; Decreto 7… |
| RN-41 | Dispensa eletrônica: aviso de 3 dias úteis, propostas adicionais, limites e fracionamento | ✅ | `situacaoAvisoDispensa`, `prazoAvisoDispensaEletronica`, `julgarPropostasDispensa`, `avaliarFracionamentoPorObjeto`, `validarCompraCartao`, `montarExtratoCartao`, `limiteDispensaVigente`; api: `POST /processos/:id/dispensa/aviso`; `POST /processos/:id/dispensa/propostas`; `POST /processos/:id/dispensa/julgamento`; `POST /cartao-pagamento/compras`; `POST /cartao-pagamento/extratos` | Lei 14.133/2021, art. 72, art. 75, I e II e §§ 1º, 3º e 4º, e art. 182; Decreto 12.807/2025 |
| RN-42 | Comércio eletrônico pelo Sicx: ranqueamento, segregação, recebimento e pagamento em até 30 dias | ✅ | `ranquearOfertasSicx`, `validarCompraSicx`, `prazosCompraSicx`, `avaliarReservaSicx`; api: `GET /sicx/ofertas`; `POST /sicx/compras`; `POST /sicx/compras/:id/conclusao`; `POST /sicx/compras/:id/recebimento`; `POST /sicx/compras/:id/pagamento` | Lei 14.133/2021, art. 79, IV e § 1º, VII, e art. 174, § 3º, VII (Lei 15.266/2025); Decreto 13.106/2026, arts.… |
| RF-01 | Painel de gestão | ✅ | api: `GET /painel`; `GET /pendencias`; `POST /pendencias/:id/resolver`; `POST /pendencias/:id/reabrir` | Lei 14.133/2021, arts. 94 e 117 |
| RF-02 | Atas de registro de preços | ✅ | api: `GET /atas`; `GET /atas/a-montar`; `GET /atas/:id` e sub-recursos | Lei 14.133/2021, arts. 82 a 86 |
| RF-03 | Carteira de contratos | ✅ | api: `GET /contratos`; `GET /contratos/:id` e sub-recursos; `POST /contratos/:id/aditivos/simular` | Lei 14.133/2021, arts. 92, 94, 117 e 125 |
| RF-04 | Carteira de itens | ✅ | api: `GET /itens`; `GET /itens/exportar.csv` | Lei 14.133/2021, art. 117 |
| RF-05 | Empenhos | ✅ | api: `GET /empenhos` | Lei 4.320/1964, arts. 58 a 61 |
| RF-06 | Pagamentos | ✅ | api: `GET /pagamentos`; `POST /pagamentos/:id/atestar` | Lei 14.133/2021, art. 141; Lei 4.320/1964, arts. 62 e 63 |
| RF-07 | Vínculos entre contratos, atas, empenhos e itens | ✅ | api: `GET /vinculos/*`; POST e `DELETE /vinculos/contrato-ata` e /vinculos/empenho-contrato; `POST /vinculos/empenho-item` | Lei 4.320/1964, art. 60 |
| RF-08 | Ajustes e cadastros de apoio | ✅ | api: `GET /modelos-gestao`; `GET /unidades-internas`; `GET /grupos-uasg`; `GET /feriados` | Lei 14.133/2021, art. 183 |
| RF-09 | Administração de usuários, perfis e integrações | ✅ | api: /usuarios; `GET /perfis`; `GET /sincronizacoes`; `POST /sincronizacoes/:fonte/executar` | Lei 13.709/2018 (LGPD), art. 46 |
| RF-10 | Auditoria | ✅ | api: `GET /auditoria`; `GET /auditoria/verificacao`; `GET /lgpd/acessos` | Lei 14.133/2021, arts. 169 a 171; Lei 13.709/2018 (LGPD), art. 37 |
| RF-11 | Transparência | ✅ | api: `GET /publico/contratos`; `GET /publico/contratos/:id`; `GET /publico/catalogo-regras` | Lei 14.133/2021, arts. 13 e 25, § 3º; Lei 12.527/2011 |
| RF-12 | Previsão financeira | ✅ | api: `GET /pagamentos/previsao` | Lei 14.133/2021, art. 150 |
| RF-13 | Fornecedores e índice de desempenho | ✅ | `calcularIdc`; api: `GET /fornecedores`; `GET /fornecedores/:id` | Lei 14.133/2021, art. 88, §§ 3º e 4º, e arts. 156 e 158 |
| RF-14 | Processos sancionatórios | ✅ | `sancoesCabiveis`, `calcularDosimetriaMulta`; api: `GET /sancoes`; `POST /sancoes`; `POST /sancoes/dosimetria/simular` | Lei 14.133/2021, arts. 155 a 163 |
| RF-15 | Jornada da contratação | ✅ | api: `GET /processos`; `GET /processos/:id`; `POST /processos/:id/avancar` | Lei 14.133/2021, arts. 17 e 18 |
| RF-16 | Importação da cesta de preços por planilha | ✅ | api: `POST /processos/:id/cesta-precos/importacao/previa`; `POST /processos/:id/cesta-precos/importacao`; `analisarCestaPrecos` | Lei 14.133/2021, art. 23, § 1º; IN SEGES/ME 65/2021 |
| RF-17 | Editais publicados com inteiro teor sem login | ✅ | api: `GET /publico/editais`; `GET /publico/editais/:id`; `GET /publico/editais/:id/documentos/:tipo`; `mascararCpf` | Lei 14.133/2021, art. 25, § 3º, e art. 54; Lei 13.709/2018 (LGPD), art. 6º, III |
| RF-18 | Adjudicação, homologação e divulgação dos documentos preparatórios | ✅ | `avaliarSelecao`; api: `POST /processos/:id/selecao/adjudicacao`; `POST /processos/:id/selecao/homologacao`; `GET /publico/editais/:id/preparatorios/:tipo` | Lei 14.133/2021, art. 71, IV, e art. 54, § 3º |
| RF-19 | Publicação no PNCP pela fila de integrações | ✅ | `interpretarLocalizacaoPncp`, `numeroControlePncp`, `codigosContratacaoPncp`, `tituloDocumentoPncp`, `prazoDivulgacaoContratoPncp`; api: `POST /processos/:id/publicar`; `GET /processos/:id/publicacao-pncp`; `POST /processos/:id/contrato/publicar-pncp` | Lei 14.133/2021, art. 54, art. 94 e art. 174, § 2º; Manual de Integração PNCP 2.2.x |
| RF-20 | Consulta ao CEIS e ao CNEP e checklist de regularidade | ✅ | `avaliarChecklistRegularidade`, `classificarRegistroSancaoExterna`, `validarCertidao`; api: `GET /fornecedores/:id/regularidade`; `POST /fornecedores/:id/regularidade/consultar`; `POST /fornecedores/:id/certidoes` | Lei 14.133/2021, art. 91, § 4º, e art. 68, III a V |
| RF-21 | Documentos do processo e de habilitação | ✅ | api: `GET /processos/:id/arquivos`; `POST /processos/:id/arquivos`; `POST /processos/:id/arquivos/:arquivoId/baixar` | Lei 14.133/2021, arts. 12, VI, 62 e 67; Lei 13.709/2018 (LGPD), arts. 6º, 37 e 46 |
| RF-22 | Sala de disputa: simulação e acompanhamento da sessão oficial | ✅ | `calcularEstadoSessaoSimulada`, `proximoLanceSimulado`, `redigirAtaSessaoDisputa`; api: `GET /processos/:id/sessoes-disputa`; `POST /processos/:id/sessoes-disputa`; `GET /sessoes-disputa/:id`; `POST /sessoes-disputa/:id/abertura`; `POST /sessoes-disputa/:id/relogio`; `POST /sessoes-disputa/:id/sincronizacao`; `POST /sessoes-disputa/:id/encerramento` | Lei 14.133/2021, arts. 17, 28, 33, 56, 59, 60 e 61; IN SEGES/ME 73/2022 |
| RF-23 | Painel das três linhas de defesa | ✅ | `avaliarLimiteAditivos`, `pagamentosPreteridos`; api: `GET /controle/primeira-linha`; `GET /controle/segunda-linha`; `GET /controle/terceira-linha`; `GET /controle/relatorio.pdf` | Lei 14.133/2021, art. 169, I a III e § 2º |
| RF-24 | Controle externo: medidas de controle e cautelares | ✅ | `prazoRespostaMedida`, `prazoDecisaoMerito`, `situacaoMedidaControle`; api: `GET /medidas-controle`; `POST /medidas-controle`; `POST /medidas-controle/:id/prorrogacao`; `POST /medidas-controle/:id/resposta`; `POST /medidas-controle/:id/revogacao` | Lei 14.133/2021, art. 171, §§ 1º, 2º e 4º |
| RF-25 | Consulta automática e combinada de preços | ✅ | `selecionarSugestoesPrecos`, `enquadrarAmostraArt23`; api: `POST /processos/:id/pesquisa-precos/consultas`; `POST /processos/:id/pesquisa-precos/consultas/:consultaId/incluir` | Lei 14.133/2021, art. 23, §§ 1º e 2º; IN SEGES/ME 65/2021, art. 5º |
| RF-26 | Central de notificações automatizadas | ✅ | `montarMensagemNotificacao`, `decidirEntregaNotificacao`, `baseLegalEnvio`, `proximaTentativa`, `avaliarAvisoReajuste`, `avaliarAvisoGarantia`; api: `GET /notificacoes`; `GET /notificacoes/:id`; `POST /notificacoes`; `POST /notificacoes/envios/:id/reenviar`; `GET /notificacoes/preferencias`; `PUT /notificacoes/preferencias`; `GET /notificacoes/canais` | Lei 14.133/2021, arts. 91, 92, 106, 117 e 141; Lei 13.709/2018 (LGPD), arts. 7º, 23 e 37 |
| RF-27 | Alterações do contrato: aditivos, apostilas, reajustes e extinção | ✅ | `avaliarReajuste`, `avaliarRepactuacao`, `avaliarReequilibrio`, `avaliarInstauracaoExtincao`, `avaliarDecisaoExtincao`, `avaliarLimiteAditivos`; api: `GET /contratos/:id/alteracoes`; `POST /contratos/:id/reajustes`; `POST /contratos/:id/repactuacoes`; `POST /contratos/:id/extincao`; `POST /contratos/:id/alteracoes/:alteracaoId/defesa`; `POST /contratos/:id/alteracoes/:alteracaoId/decidir-extincao` | Lei 14.133/2021, arts. 25, § 7º, 92, § 3º, 124, II, "d", 135, 136 e 137 a 139 |
| RF-28 | Execução do contrato: fiscalização, recebimentos, garantias e prazos de pagamento | ✅ | `verificarDesignacoesContrato`, `validarOcorrencia`, `validarAlteracaoOrdemCronologica`, `classificarPreteridosComAlteracoes`, `avaliarOrdemServico`, `avaliarReservasCargos`; api: `GET /contratos/:id/execucao`; `POST /contratos/:id/ordens-servico`; `POST /contratos/:id/reservas-cargos`; `GET /contratos/:id/designaveis`; `POST /contratos/:id/designacoes`; `POST /designacoes/:id/encerrar`; `POST /contratos/:id/ocorrencias`; `POST /ocorrencias/:id/regularizar`; `PUT /contratos/:id/parametros-execucao`; `GET /alteracoes-ordem`; `POST /pagamentos/:id/alteracoes-ordem`; `POST /alteracoes-ordem/:id/comunicacoes` | Lei 14.133/2021, arts. 92 (inclusive XVII e § 2º), 96 a 102, 117, 119, 140, 141 e 156, § 8º; Decretos 11.430/… |
| RF-29 | Instrumento de medição de resultado (IMR) do contrato e medições periódicas | ✅ | `validarIndicadorImr`, `calcularResultadoImr`, `calcularAjustePagamento`, `medicaoImrDevida`; api: `GET /contratos/:id/imr`; `POST /contratos/:id/imr/indicadores`; `PUT /contratos/:id/imr/indicadores/:indicadorId`; `POST /contratos/:id/imr/indicadores/:indicadorId/encerrar`; `POST /contratos/:id/imr/medicoes` | Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117 e 140; IN SEGES/MP 5/2017, anexo VIII-A |
| RF-30 | Avaliação de desempenho, histórico do fornecedor e certificado | ✅ | `redigirDocumentoAvaliacaoDesempenho`, `redigirCertificadoDesempenho`, `simularImpactoDesempenho`, `rotuloFaixaDesempenho`; api: `GET /avaliacoes-desempenho/:id/documento.pdf`; `POST /fornecedores/:id/certificados-desempenho`; `GET /certificados-desempenho/:id/documento.pdf`; `POST /desempenho/simulacao` | Lei 14.133/2021, art. 87 e art. 88, §§ 2º a 4º |
| RF-31 | Plano de contratações anual, conferência do DFD e intenções de registro de preços | ✅ | `consolidarPca`, `validarDemandaPca`, `validarTransicaoPca`, `itemPlanoContratacoesPncp`, `conferirDfdComPca`, `identificadorItemPca`; api: `GET /pca`; `POST /pca/:id/consolidar`; `POST /pca/:id/aprovar`; `PUT /processos/:id/pca`; `GET /irps` | Lei 14.133/2021, art. 12, VII e § 1º, art. 18, § 1º, II, e art. 86; Decreto 10.947/2022; Decreto 11.462/2023 |
| RF-32 | Documentos complementares da fase preparatória e checklist do processo | ✅ | `gerarQuesitosControleLegalidade`, `montarCasosTesteProvaConceito`, `montarChecklistPecas`; api: `POST /processos/:id/documentos/gerar`; `GET /processos/:id/checklist-documentos`; `GET /processos/:id/documentos/:docId/pdf` | Lei 14.133/2021, arts. 7º, 8º, 17, § 3º, 18, 53, 72, VIII, e 140 |
| RF-33 | Sigilo do processo: classificação, credenciamento e registro de acessos | ✅ | api: `GET /processos/:id/sigilo`; `POST /processos/:id/sigilo/credenciais`; `POST /processos/:id/sigilo/credenciais/:credencialId/revogar`; `GET /processos/:id/sigilo/acessos`; `POST /processos/:id/sigilo/anexos`; `POST /processos/:id/sigilo/anexos/:arquivoId/baixar` | Lei 12.527/2011, arts. 25 e 27; Decreto 7.845/2012, arts. 18, 19 e 38, § 4º |
| RF-34 | Rotas de contratação: licitação, dispensa, inexigibilidade, adesão a ata e Sicx | ✅ | `adaptacaoDaRota`, `validarEscolhaRota`, `validarInexigibilidade`, `avaliarAdesaoAta`, `prazoContratacaoAdesao`; api: `GET /processos/:id/rota`; `PUT /processos/:id/rota`; `PUT /processos/:id/inexigibilidade`; `POST /processos/:id/adesao`; `POST /atas/adesoes/:id/anuencia`; `POST /processos/:id/contratacao-direta/autorizacao` | Lei 14.133/2021, arts. 72, 74, 75, 79, IV, e 86, §§ 2º a 5º e 8º; Decreto 11.462/2023, arts. 31 e 32; Decreto… |
| RF-35 | Integração com o SEI e assinatura refletida | ✅ | `digitosVerificadoresNup`, `formatarNup`, `validarNup`, `nivelAcessoSei`, `dataHoraSeiParaIso`, `dataHoraSei`, `situacaoAssinaturaSei`; api: `GET /processos/:id/sei`; `POST /processos/:id/sei/enviar`; `POST /processos/:id/sei/consultar-assinaturas` | Lei 14.133/2021, art. 12, VI, e art. 174; Lei 12.527/2011, art. 31; Portaria Interministerial nº 11/2019 (NUP) |
| RF-36 | Publicação no Diário Oficial da União | ✅ | `montarMateriaDou`, `dataPrevistaPublicacaoDou`, `localizarMateriaDou`; api: `GET /publicacoes-dou`; `POST /publicacoes-dou`; `POST /publicacoes-dou/:id/envio`; `POST /publicacoes-dou/:id/conferir`; `POST /publicacoes-dou/:id/publicacao`; `POST /publicacoes-dou/:id/jornal` | Lei 14.133/2021, art. 54, § 1º, e art. 94 |
| RF-37 | Gestão compartilhada com a sociedade | ✅ | `validarManifestacao`, `validarDecisaoModeracao`, `validarResposta`, `prazoRespostaManifestacao`, `situacaoPrazoResposta`, `avaliarPublicacaoRegistroExecucao`, `validarRelatorioFinal`, `nomePublicoCidadao`, `tarjarDadosPessoaisLivres`; api: `POST /sociedade/contratos/:id/manifestacoes`; `POST /sociedade/manifestacoes/:id/moderacao`; `POST /sociedade/manifestacoes/:id/respostas`; `POST /sociedade/contratos/:id/registros`; `POST /sociedade/contratos/:id/relatorio-final`; `GET /publico/contratos/:id/gestao-compartilhada` | Lei 14.133/2021, art. 174, § 3º, VI, alíneas "a" a "d", e art. 19, III; Lei 13.460/2017, art. 16; Lei 13.709/… |
| RF-38 | Catálogo de dados abertos | ✅ | `gerarCsvDadosAbertos`, `prepararLinhasDadosAbertos`, `centavosParaDecimal`, `contemDadoPessoal`; api: `GET /publico/dados-abertos`; `GET /publico/dados-abertos/:conjunto`; `GET /publico/dados-abertos/:conjunto/csv`; `GET /publico/dados-abertos/:conjunto/json` | Decreto 8.777/2016; Lei 12.527/2011, art. 8º, § 1º, IV, e § 3º; Lei 14.133/2021, art. 174, § 4º, e art. 141,… |
| RF-39 | Painel das metas do ETP (resultados pretendidos) | ✅ | `medirTempoInstrucao`, `avaliarMitigacaoTravas`, `medirEconomia`, `efeitoExpurgosCesta`, `validarMetasEtp`, `situacaoMeta`; api: `GET /metas-etp`; `GET /metas-etp/exportar.csv`; `GET /metas-etp/configuracao`; `PUT /metas-etp/configuracao`; trilha: trava.bloqueio | Lei 14.133/2021, art. 18, § 1º, IX (demonstrativo dos resultados pretendidos), e art. 11 |
| RIA-01 | Consolidação de demandas e sinal antifracionamento | ✅ | `avaliarFracionamento`, `consolidarDemandas`, `sugerirRegistroPrecosCompartilhado` | Lei 14.133/2021, art. 12, VII, e art. 75, § 1º |
| RIA-02 | Robô de instrução do processo no SEI | ✅ | api: `POST /processos/:id/sei/assinar` (simulação); integração SEI planejada | Lei 14.133/2021, art. 12, VI |
| RIA-03 | Saneamento estatístico da cesta de preços | ✅ | `analisarCestaPrecos`; api: `POST /processos/:id/cesta-precos/expurgos` | IN SEGES/ME 65/2021, art. 6º |
| RIA-04 | Redação assistida de termo de referência, edital e minuta | ✅ | api: `POST /processos/:id/documentos/gerar`; `POST /processos/:id/documentos/:docId/aprovar` | Lei 14.133/2021, art. 6º, XXIII, e art. 25 |
| RIA-05 | Tarjamento de dados pessoais e de informações sigilosas | ✅ | `mascararCpf`, `mascararEmail`, `mascararTelefone`, `mascararNome`; api: `GET /publico/editais/:id/documentos/:tipo` | Lei 14.133/2021, art. 13; Lei 13.709/2018 (LGPD) |
| RIA-06 | Sinais de conluio e de vínculos societários | ✅ | `verificarSegregacao`; api: `PUT /processos/:id/disputa` | Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV |
| RIA-07 | Projeção de queima de saldo | ✅ | `projetarQueimaSaldo` | Lei 14.133/2021, art. 117 |
| RIA-08 | Leitura assistida de atestados de capacidade técnica | ✅ | `extrairQuantitativosAtestado`, `somarQuantitativosAtestados`; api: `POST /processos/:id/arquivos/:arquivoId/leitura`; `GET /processos/:id/qualificacao-tecnica` | Lei 14.133/2021, art. 67, II, e §§ 1º e 2º; art. 18, IX |
| RIA-09 | Sinal de padrão de lances na sessão de disputa | ✅ | `detectarPadroesLances`, `cruzarPadroesComVinculos`; api: `GET /sessoes-disputa/:id` | Lei 14.133/2021, art. 5º e art. 155, IX e XI; Lei 12.846/2013, art. 5º, IV, "a"; IN SEGES/ME 73/2022, art. 19 |
| RIA-10 | Sinal de vínculo impeditivo e de possível sucessão de empresa sancionada | ✅ | `sinalizarVinculosLicitantes`, `detectarPossivelSucessao`; api: `POST /impedimentos/analise`; `GET /impedimentos/processos/:id`; `GET /impedimentos/fornecedores/:id` | Lei 14.133/2021, art. 9º, § 1º, e art. 14, III, IV, V e § 1º |
| RIA-11 | Projeção de variação cambial e inflacionária do valor estimado | ✅ | `projetarValorEstimado`; api: `POST /processos/:id/pesquisa-precos/projecao` | Lei 14.133/2021, art. 23 e art. 25, § 7º; IN SEGES/ME 65/2021, art. 5º, I e II |
| RIA-12 | Lições aprendidas da execução no DFD, no ETP e no TR | ✅ | `sugerirClausulasLicoes`, `semelhancaObjeto`, `termosObjeto`, `derivarFatosExecucao`, `categoriaPadraoFato`, `secaoLicoesAceitas`, `rotuloCategoriaLicao`; api: `GET /processos/:id/licoes-aprendidas`; `POST /processos/:id/licoes-aprendidas/decisoes`; `POST /contratos/:id/ocorrencias-execucao` | Lei 14.133/2021, art. 11, art. 18, art. 117 e art. 169 |
| RIA-13 | Sugestão do código do catálogo CATMAT/CATSER | ✅ | `sugerirItensCatalogo`, `termosCatalogo`; api: `GET /catalogo/itens`; `GET /catalogo/sugestoes`; `PUT /processos/:id/dfd/itens/:indice/catalogo` | Lei 14.133/2021, art. 19, II e § 2º |
| RIA-14 | Conferência das citações legais e precisão normativa (IMR-02) | ✅ | `extrairCitacoesLegais`, `conferirCitacoesLegais`, `conferirEstruturaModelo`; api: `GET /qualidade-normativa`; `GET /processos/:id/citacoes`; `POST /processos/:id/documentos/:docId/citacoes/revisao`; `POST /normas/conferir` | Lei 14.133/2021, art. 19, IV, e art. 53; IMR-02 do termo de referência do cliente |
| RIA-15 | Conferência cruzada dos documentos e auditor contínuo | ✅ | `extrairFatosDocumento`, `conferirDocumentosCruzados`, `sinaisAuditorContinuo`; api: `GET /processos/:id/conferencia-cruzada`; `GET /controle/auditor-ia` | Lei 14.133/2021, art. 6º, XXIII, LVI e LVII, arts. 18, 25 e 92, art. 145 e art. 169 |
| RNF-01 | Soberania e implantação na infraestrutura do órgão | ✅ | arquitetura: implantação auto-hospedada (deploy/Dockerfile, deploy/docker-compose.yml, deploy/k8s/agora.yaml) | Diretriz de soberania digital da Ágora |
| RNF-02 | Proteção de dados pessoais (LGPD) | ✅ | `mascararDocumento`, `mascararCpf`, `mascararEmail`, `mascararTelefone`, `mascararNome`; api: `POST /lgpd/revelar`, `GET /lgpd/acessos` | Lei 13.709/2018 (LGPD), arts. 6º, 37 e 46 |
| RNF-03 | Trilha de auditoria encadeada por hash | ✅ | api: `GET /auditoria`; `GET /auditoria/verificacao` | Lei 14.133/2021, arts. 169 a 171 |
| RNF-04 | Acessibilidade | ✅ | web: componentes próprios acessíveis e testes automatizados com axe (e2e/testes/apoio.ts) | gov.br DS; eMAG; WCAG 2.1 nível AA |
| RNF-05 | Autorização no servidor por perfil e UASG | ✅ | api: matriz de perfis e permissões (`GET /perfis`) e filtro por UASG em todas as consultas | Lei 13.709/2018 (LGPD), art. 46 |
| RNF-06 | IA não decide: revisão humana obrigatória | ✅ | todas as funções de sinal do domínio retornam sinal e explicação, nunca decisão; provedor de IA em apps/api/src/ia/provedor.ts | Lei 14.133/2021, arts. 155 a 163 (sanção pela autoridade competente); Lei 13.709/2018, art. 20 |
| RNF-07 | Fila de integrações com novas tentativas e fila de erro | ✅ | `esperaNovaTentativa`, `decidirDestinoFalha`, `classificarRespostaHttp`, `chaveIdempotencia`; api: `GET /fila/resumo`; `GET /fila/tarefas`; `POST /fila/tarefas/:id/reprocessar`; trabalhador (apps/api/src/trabalhador.ts) | Caderno do cliente, RNF-04 e matriz de riscos (R04); Lei 14.133/2021, art. 174, § 2º |
| RNF-08 | Base normativa soberana e busca na lei | ✅ | `estruturarTextoLei`, `indexarBaseNormativa`, `buscarNaBaseNormativa`, `localizarDispositivo`; api: `GET /normas`; `GET /normas/busca`; `GET /normas/artigos/:numero`; `GET /normas/modelos` | Lei 14.133/2021, art. 19, IV; Lei 9.610/1998, art. 8º, IV; matriz de riscos do cliente (R02) |
| RNF-09 | Cofre de anexos sigilosos e carimbo de tempo da trilha de auditoria | ✅ | `declaracaoAncoragem`, `ancoragemDevida`, `conferirAncoragem`; api: `GET /auditoria/ancoragens`; `POST /auditoria/ancoragens`; `GET /auditoria/ancoragens/verificacao`; cofre (apps/api/src/modulos/sigilo/cofre.ts) | Decreto 7.845/2012, arts. 31 e 38; Lei 14.133/2021, art. 12, VI; RFC 3161 (Time-Stamp Protocol); MP 2.200-2/2… |
| RNF-10 | Operação sustentável e medição de disponibilidade (IMR-01) | ✅ | `calcularDisponibilidade`, `detectarJanelasPncp`, `dimensionarCarga`, `estatisticasLatencia`; api: `GET /operacao/situacao`; `POST /operacao/sondar`; `GET /operacao/disponibilidade`; `GET /operacao/disponibilidade.csv`; `POST /operacao/janelas`; deploy/k8s/autoescalonamento.yaml; deploy/k8s/homologacao-expediente.yaml; npm run carga -w @agora/api | Lei 14.133/2021, art. 6º, XXIII, "g", e art. 11, IV; caderno do cliente: ETP (TI verde), IMR-01 e RNF-04 |
