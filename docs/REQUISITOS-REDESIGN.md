# ComprasSUSP — requisitos para o novo portal

## 1. Objetivo

Reimplementar o portal sem alterar o sistema original, preservando primeiro as operações atuais de atas, contratos, itens, vínculos, financeiro e gestão. Depois dessa paridade, ampliar a jornada com os módulos conceituais levantados no Gemini.

O redesign deve melhorar clareza, acessibilidade, responsividade, desempenho percebido e segurança das ações, sem inventar funcionalidades nas áreas que não puderam ser inspecionadas.

## 2. Separação entre realidade e visão futura

### Realidade observada no portal

- Gestão de carteira e pendências.
- Atas, contratos e itens.
- Detalhes com plano de gestão, prazos, reajustes, empenhos e pagamentos.
- Vínculos entre atas, contratos, empenhos e itens.
- Modelos de gestão, unidades internas e grupos de UASGs.
- Integração/consulta a dados do PNCP e Compras.gov.br.
- Módulo de emendas existente nas rotas, mas bloqueado para o perfil coletado.

### Visão conceitual do Gemini

1. Geração da demanda/DFD, catálogo e PCA.
2. Integração com SEI, equipe e segregação de funções.
3. ETP, riscos e pesquisa de preços assistida.
4. Geração de TR, edital e minuta de contrato.
5. Controle jurídico e publicação PNCP/DOU.
6. Seleção do fornecedor, disputa, contratação direta, compras expressas e PoC.
7. Gestão contratual, auditoria, sanções, dosimetria e score objetivo de fornecedores.

Esses sete blocos são uma visão de expansão. Não devem ser apresentados como funções já existentes no sistema atual. Referências legais, prazos, documentos, estimativas e regras produzidas na conversa precisam de validação pela área técnica e CONJUR.

## 3. MVP recomendado

### 3.1 Estrutura comum

- Cabeçalho gov.br, identificação MJSP/SENASP e menu lateral retrátil.
- Navegação por tarefas e permissões do usuário.
- Breadcrumb nos detalhes e navegação clara de retorno à carteira.
- Rodapé com FNSP, fontes de dados, acessibilidade e informações institucionais.
- Layout responsivo para desktop, tablet e celular.

### 3.2 Páginas preservadas

1. Login e recuperação de acesso, sem alterar os fluxos reais durante o protótipo.
2. Início com indicadores e fila de pendências.
3. Atas registradas e atas a montar.
4. Contratos.
5. Itens.
6. Detalhe de ata e suas cinco abas.
7. Detalhe de contrato e suas seis abas.
8. Empenhos.
9. Pagamentos e previsão mensal.
10. Vínculos.
11. Modelos de gestão.
12. Unidades internas e grupos de UASGs.
13. Estados de acesso negado para as demais áreas, até especificação autorizada.

## 4. Melhorias prioritárias observadas

| Achado na coleta | Melhoria requerida |
|---|---|
| CSS declara Inter antes de Rawline | Usar Rawline como família principal e Raleway como fallback explícito |
| Valores zerados aparecem durante “Atualizando...” | Não apresentar zero provisório como dado real; usar skeleton/progresso e manter última atualização conhecida |
| Carregamento de algumas carteiras foi progressivo | Separar carregamento, vazio, erro e dados parciais; evitar layout instável |
| Grade do painel deixa espaço subutilizado em telas largas | Reorganizar KPIs em grade responsiva e priorizar alertas/ações |
| Tabelas concentram muitos filtros e colunas | Preservar densidade, adicionar seleção de colunas, filtros com contagem e visualização móvel em cartões |
| Textos longos de objetos/fornecedores | Truncamento acessível com expansão, tooltip opcional e cópia fácil do identificador |
| Uma captura apresentou possível problema de acentuação em fornecedor | Normalizar UTF-8 e testar nomes acentuados em todas as telas/exports |
| Ações de escrita aparecem junto à navegação | Separar visualmente ações de navegação e escrita; exigir confirmação e oferecer desfazer quando cabível |
| Áreas negadas dependem do perfil | Ocultar ou explicar indisponibilidade conforme RBAC, sem expor rotas/dados indevidos |
| Fontes e atualizações têm horários distintos | Exibir origem, data/hora e estado de sincronização por conjunto de dados |

## 5. Fundamentos visuais obrigatórios

A documentação oficial consultada em `gov.br/ds` exibia a versão **3.7.0**. Essa é a referência estável deste documento. A existência de uma versão 4 em ambiente de evolução não deve alterar o projeto sem decisão formal de adoção.

### Tipografia

- Família principal: **Rawline**.
- Fallback: **Raleway**, depois `sans-serif`.
- Base recomendada: **14 px**, peso 400.
- Escala: **Minor Third 1,2**.
- Entrelinha: **1,45** até a base e **1,15** para tamanhos maiores, conforme o fundamento oficial.
- Manter unidades relativas para permitir ampliação sem perda funcional.

### Cores funcionais

| Função | Valor/token gov.br |
|---|---|
| Superfície principal escura | `#071D41` — `--blue-warm-vivid-90` |
| Alternativa/principal atual | `#0C326F` — `--blue-warm-vivid-80` |
| Interação | `#1351B4` — `--blue-warm-vivid-70` |
| Informação | `#155BCB` — `--blue-warm-vivid-60` |
| Sucesso | `#168821` — `--green-cool-vivid-50` |
| Alerta | `#FFCD07` — `--yellow-vivid-20` |
| Erro | `#E52207` — `--red-vivid-50` |
| Texto em fundo claro | `#333333` |
| Texto em fundo escuro | `#FFFFFF` |

- Contraste mínimo de **4,5:1** para texto normal e **3:1** para texto grande/componentes gráficos, conforme o nível AA documentado.
- Não comunicar prioridade ou situação somente por cor: combinar texto, ícone e/ou forma.
- Amarelo deve ser usado com texto escuro ou sobre superfície adequada, não como texto pequeno sobre branco sem validação de contraste.

### Densidade e espaçamento

- Escala de densidade em passos de **4 px**.
- Preservar densidade padrão, alta e baixa quando útil para tabelas.
- Área mínima de ação: **24 px** para cursor e **40 px** para toque, conforme o guia oficial.
- Evitar reduzir espaçamentos a ponto de prejudicar leitura ou acionamento.

## 6. Componentes e comportamento

### Tabelas

- Cabeçalho semântico, ordenação anunciada e foco visível.
- Busca, filtros, contagem de resultados e paginação acessíveis.
- Seleção de densidade e colunas sem perda das ações principais.
- Estado vazio com explicação e ação para limpar filtros.
- Em telas estreitas, transformar cada linha em cartão com os campos prioritários.

### Formulários e filtros

- Labels persistentes; placeholder apenas como exemplo, nunca como substituto do rótulo.
- Campos agrupados por afinidade, preferencialmente em uma coluna.
- Indicação consistente de obrigatórios ou opcionais, sem misturar ambas as convenções.
- Mensagens de erro contextuais e orientação de correção.
- Agrupamentos complexos com `fieldset`/`legend` quando apropriado.
- Hierarquia de botões: primária, secundária e terciária de forma consistente.

### Loading, vazio, erro e permissão

- Skeleton sem valores numéricos fictícios durante sincronização.
- Indicador de progresso e última atualização bem-sucedida.
- Empty state com título, explicação e ação útil.
- Erro com origem do problema e opção segura de tentar novamente.
- Acesso negado com orientação para voltar a uma área disponível ou solicitar acesso.

### Ações de escrita

- Nenhuma ação de escrita deve ser acionada no protótipo sem confirmação explícita do usuário.
- Separar “abrir detalhe” de “resolver”, “atualizar”, “excluir” ou “sincronizar”.
- Registrar auditoria de operações no sistema real e permitir desfazer quando a regra de negócio permitir.

## 7. Acessibilidade e validação

- Navegação completa por teclado e foco sempre visível.
- HTML semântico, landmarks, headings hierárquicos e Skip Link.
- Uso criterioso de WAI-ARIA; não substituir elementos nativos sem necessidade.
- Zoom de 200% sem sobreposição ou perda funcional.
- Alternativa textual para imagens e nome acessível para botões icônicos.
- Testes automatizados complementados por avaliação humana; ferramentas automáticas não bastam para declarar conformidade.
- Validar fluxos com leitor de tela, teclado, contraste e diferentes resoluções.

## 8. Expansão com IA e regras de negócio

Quando os módulos do Gemini forem priorizados:

- Adicionar o “Modo Especificação Técnica” para visualizar RN e requisitos de IA por tela.
- Toda minuta gerada por IA deve indicar fontes, premissas, data e necessidade de revisão humana.
- IA não deve decidir automaticamente sanção, habilitação, fraude, multa ou impedimento de fornecedor.
- Score de fornecedor deve usar indicadores objetivos, histórico auditável e governança formal; não criar lista restritiva subjetiva.
- Alertas de conluio, fracionamento ou risco devem ser tratados como sinais para análise, não como afirmação de ilícito.
- Integrações SEI, PNCP, DOU, CEIS/CNEP e bases fiscais devem ter tratamento de indisponibilidade, proveniência e trilha de auditoria.

## 9. Infraestrutura e segurança

- O requisito de substituir a hospedagem atual foi registrado como restrição informada pelo demandante.
- As diretrizes visuais consultadas não proíbem nominalmente o Vercel nem definem, por si só, a infraestrutura autorizada. A decisão deve ser formalizada pelos requisitos de segurança, contrato, LGPD e hospedagem do órgão.
- **Vercel** é plataforma de hospedagem; **Vite** é ferramenta de build. Os dois não devem ser confundidos na especificação.
- Preparar pacote para infraestrutura aprovada pelo órgão, sem dependência de CDN em tempo de execução quando isso for exigido.
- Não incluir segredos, tokens ou credenciais no bundle do front-end.
- Aplicar RBAC, trilha de auditoria, proteção de dados pessoais e revisão de dependências.
- Dados reais coletados não devem ser publicados em ambiente de demonstração; usar dados sintéticos.

## 10. Critérios de aceite do MVP

1. Paridade das telas e fluxos acessíveis listados no inventário.
2. Nenhuma regressão de rotas, filtros, ordenação, paginação e abas.
3. Rawline aplicada corretamente e tokens oficiais documentados.
4. Contraste AA validado nos componentes e estados.
5. Navegação por teclado e zoom de 200% verificados.
6. Layout funcional em desktop, tablet e celular.
7. Loading, vazio, erro, ausência de permissão e dados parciais diferenciados.
8. Nenhuma credencial ou informação operacional real no código publicado.
9. Ações de escrita protegidas por confirmação, permissão e auditoria.
10. Pacote implantável na infraestrutura formalmente aprovada pelo órgão.

## 11. Sequência sugerida

1. Validar o inventário com o responsável funcional.
2. Aprovar o mapa do MVP e os tokens visuais.
3. Construir o shell gov.br e componentes acessíveis com dados sintéticos.
4. Reproduzir Início, Atas, Contratos, Itens e detalhes.
5. Reproduzir Financeiro, Vínculos e Ajustes.
6. Testar paridade, acessibilidade e responsividade.
7. Definir APIs, backend, RBAC e infraestrutura aprovada.
8. Somente depois priorizar os módulos de expansão do Gemini.

## Fontes oficiais de design

- https://www.gov.br/ds/home
- https://www.gov.br/ds/introducao/padrao-minimo
- https://www.gov.br/ds/fundamentos-visuais/cores
- https://www.gov.br/ds/fundamentos-visuais/tipografia
- https://www.gov.br/ds/components/visao-geral
- https://www.gov.br/ds/components/table
- https://www.gov.br/ds/acessibilidade
- https://www.gov.br/ds/guias/acessibilidade-html
- https://www.gov.br/ds/padroes/design/formulario
- https://www.gov.br/ds/padroes/design/navegacao
- https://www.gov.br/ds/padroes/design/emptystates
- https://www.gov.br/ds/padroes/design/densidade
