# Ágora — especificação da interface (apps/web)

SPA React 19 + React Router 7 (modo biblioteca, `createBrowserRouter`) + TanStack Query 5, empacotada com Vite 7. Sem biblioteca de componentes externa: componentes próprios fiéis ao **Padrão Digital de Governo (gov.br DS 3.7)**. Ícones `lucide-react`. Textos em pt-BR.

## 1. Fundamentos visuais (tokens em `src/design/tokens.css`)

Cores (gov.br DS):
| Token | Valor | Uso |
|---|---|---|
| `--azul-90` | `#071D41` | cabeçalho, superfícies escuras |
| `--azul-80` | `#0C326F` | primária institucional |
| `--azul-70` | `#1351B4` | interação: links, botão primário, foco |
| `--azul-60` | `#155BCB` | informação |
| `--azul-10` | `#D4E5FF` | fundo de destaque/seleção |
| `--verde-50` | `#168821` | sucesso |
| `--verde-10` | `#E3F5E1` | fundo de sucesso |
| `--amarelo-20` | `#FFCD07` | alerta (sempre com texto `#333`) |
| `--amarelo-5` | `#FFF5C2` | fundo de alerta |
| `--vermelho-50` | `#E52207` | erro/crítico |
| `--vermelho-10` | `#FDE0DB` | fundo de erro |
| `--cinza-90` | `#1B1B1B` | |
| `--cinza-80` | `#333333` | texto principal |
| `--cinza-60` | `#636363` | texto secundário (contraste ≥ 4,5:1 sobre branco) |
| `--cinza-20` | `#CCCCCC` | bordas |
| `--cinza-10` | `#E6E6E6` | divisórias |
| `--cinza-2` | `#F8F8F8` | fundo da página |
| `--branco` | `#FFFFFF` | superfícies |

- Foco visível: `outline: 3px solid #C2850C` (foco do gov.br DS) com `outline-offset: 2px`, nunca removido.
- Situação nunca comunicada só por cor: sempre ícone + texto.

Tipografia:
- `font-family: Rawline, Raleway, system-ui, sans-serif` (Rawline servida localmente de `public/fontes/rawline/`, pesos 400, 400i, 500, 600, 700, 800 em woff2, `font-display: swap`). **Nada de Google Fonts ou CDN.**
- `html { font-size: 100% }`; texto base `0.875rem` (14 px); escala Minor Third 1,2: 14 → 16,8 → 20,16 → 24,19 → 29,03 → 34,84 px (use rem).
- Entrelinha 1,45 até o tamanho base; 1,15 para títulos.

Espaçamento em passos de 4 px (`--esp-1` = 4 px … `--esp-12` = 48 px). Raio 4 px (cartões 8 px). Sombras discretas (nível 1 e 2 do DS). Área mínima de toque: 24 px com mouse, 40 px em telas de toque (`@media (pointer: coarse)`).

Densidade de tabela: `alta` (linhas 32 px), `padrao` (40 px), `baixa` (48 px). Seletor na barra da tabela, preferência guardada em `sessionStorage` (preferência de interface; dado de negócio nunca vai para storage do navegador).

## 2. Estrutura (layout)

1. **Link de salto** "Ir para o conteúdo principal" (primeiro foco da página).
2. **Faixa de ambiente** (só em `demonstracao`/`homologacao`, não fechável): "Ambiente de demonstração — todos os dados são fictícios".
3. **Cabeçalho** (`<header>`, fundo `--azul-90`): marca da Ágora (wordmark textual "Ágora" + subtítulo "Contratações Públicas"), identificação do órgão (da `ConfiguracaoPublica`), botão "Modo especificação técnica" (alternador), menu do usuário (nome, perfis, Sair). **Não usar o logotipo gov.br nem brasões** (é produto ofertado, não sistema oficial).
4. **Menu lateral** (`<nav aria-label="Menu principal">`), retrátil (ícones + rótulos; recolhido mostra só ícones com `aria-label`), seções exibidas conforme permissões:
   - Início
   - Jornada da contratação
   - Atas · Contratos · Itens
   - Financeiro: Empenhos · Pagamentos · Previsão
   - Vínculos
   - Fornecedores · Sanções
   - Ajustes: Modelos de gestão · Unidades internas · Grupos de UASG · Feriados
   - Administração: Usuários · Perfis · Integrações
   - Auditoria: Trilha · Acessos a dados pessoais
   - Caderno de regras
   Em telas < 1024 px vira gaveta sobreposta com botão "Menu" (foco preso enquanto aberta, ESC fecha).
5. **Conteúdo** (`<main id="conteudo" tabindex="-1">`): breadcrumb (`<nav aria-label="Você está aqui">`), `<h1>` único, ações da página à direita (separadas da navegação; ações de escrita destacadas e com confirmação).
6. **Rodapé** (`<footer>`): órgão, fontes de dados (PNCP, Compras.gov.br, Contratos.gov.br), links Transparência, Privacidade e LGPD, Acessibilidade, Caderno de regras, versão.

Na troca de rota: atualizar `document.title` ("<Página> — Ágora") e mover o foco para o `<h1>`.

## 3. Rotas

Públicas (sem login): `/entrar`, `/transparencia`, `/transparencia/contratos/:id`, `/privacidade`, `/acessibilidade`, `/regras` (Caderno de Regras imprimível).
Autenticadas:
| Rota | Tela (id para o catálogo de regras) | Conteúdo |
|---|---|---|
| `/` | `painel` | KPIs (sem números falsos durante o carregamento), vencimentos 30/60/90, divulgação PNCP pendente, queima de saldo acelerada, próximos vencimentos, fila de pendências (busca, filtros tipo/prioridade/situação/UASG/"minhas", ordenação, paginação, ação "Resolver" com observação obrigatória e "Desfazer" no aviso), proveniência dos dados |
| `/atas` | `atas` | abas Registradas / A montar; filtros situação, criticidade, UASG, "sob minha gestão"; tabela com semáforo e barra de consumo |
| `/atas/:id` | `atas.detalhe` | cabeçalho com dados, link "Abrir no PNCP" (nova aba, `rel="noopener noreferrer"`), linha do tempo, saldo contratável, itens em risco; abas Plano de gestão (tarefas), Itens, Contratos vinculados, Reajuste, Histórico |
| `/contratos` | `contratos` | filtros situação, UASG, gestor, "sem ata"; tabela |
| `/contratos/:id` | `contratos.detalhe` | resumo, divulgação PNCP (art. 94), queima de saldo (RIA-07), garantia; abas Plano de gestão, Itens, Empenhos, Pagamentos, Aditivos (+ simulador art. 125 com resultado e regularidade do fornecedor), Histórico |
| `/itens` | `itens` | carteira de itens, filtros, botão "Exportar CSV" (link para `/api/v1/itens/exportar.csv?...`) |
| `/financeiro/empenhos` | `empenhos` | totais, filtros saldo/RAP/ano/UASG, proveniência SIAFI |
| `/financeiro/pagamentos` | `pagamentos` | ordem cronológica (art. 141), filtro situação, ação "Atestar" (com confirmação) |
| `/financeiro/previsao` | `previsao` | gráfico de barras SVG próprio (previsto × realizado por mês) **com tabela equivalente acessível** e tabela por contrato |
| `/vinculos` | `vinculos` | abas Contratos sem ata / Empenhos sem contrato / Empenhos sem item; vincular com confirmação; desfazer |
| `/fornecedores`, `/fornecedores/:id` | `fornecedores` | lista com IDC e sanções; detalhe com IDC (componentes, metodologia, aviso), sanções, contratos, regularidade; documento de PF mascarado com botão "Revelar" (se permitido) |
| `/sancoes` | `sancoes` | processos sancionatórios; "Instaurar processo"; simulador de dosimetria (art. 156) com memória de cálculo e aviso de decisão humana |
| `/ajustes/modelos`, `/ajustes/unidades`, `/ajustes/grupos-uasg`, `/ajustes/feriados` | `ajustes` | CRUD simples com formulários acessíveis |
| `/admin/usuarios`, `/admin/perfis`, `/admin/integracoes` | `admin` | usuários (criar/editar perfis e UASGs/ativar), matriz de permissões, sincronizações com "Executar agora" |
| `/auditoria`, `/auditoria/lgpd` | `auditoria` | trilha com filtros e "Verificar integridade da cadeia"; registros de acesso a dados pessoais |
| `/jornada`, `/jornada/:id` | `jornada.*` | ver seção 6 |
| `*` | | página 404 com caminho de volta |

## 4. Estados obrigatórios (toda tela de dados)

- **Carregando**: esqueleto com a forma do conteúdo, `aria-busy="true"`, **nunca zeros provisórios**.
- **Vazio**: título, explicação e ação útil ("Limpar filtros").
- **Erro**: o que falhou + "Tentar novamente"; mostrar `idRequisicao` para suporte.
- **Sem permissão** (403): explicação + voltar ao início. Itens de menu sem permissão não aparecem.
- **Dado parcial/desatualizado**: componente `Proveniencia` (fonte, "Atualizado em 08/11/2026 às 02:10", situação com ícone).
- Valores monetários com `formatarMoeda` e datas com `formatarData` de `@agora/dominio`.

## 5. Componentes (`src/componentes/`)

`Botao` (primario, secundario, terciario, perigo; carregando), `Campo` (label sempre visível, ajuda, erro com `aria-describedby`, obrigatório indicado de forma consistente), `CampoMoeda`, `Selecao` (select nativo), `CaixaSelecao`, `Alternador` (switch acessível `role="switch"`), `Abas` (padrão WAI-ARIA tabs, setas e Home/End, sincronizado com `?aba=` na URL), `Tabela` (`<table>` semântica, `<caption>`, cabeçalhos ordenáveis com `aria-sort`, densidade, seletor de colunas, em < 768 px cada linha vira cartão com os campos prioritários), `Paginacao`, `BarraFiltros` (contagem de resultados anunciada em `aria-live="polite"`, botão limpar), `Etiqueta` (status com ícone), `Semaforo`, `Indicador` (KPI), `BarraProgresso` (`role="progressbar"`), `Alerta` (info/sucesso/aviso/erro), `Dialogo` (com `<dialog>` nativo, foco inicial e retorno do foco, ESC), `ConfirmarAcao`, `Avisos` (toasts em `aria-live`, com ação "Desfazer" opcional), `Esqueleto`, `EstadoVazio`, `EstadoErro`, `SemPermissao`, `Breadcrumb`, `LinhaDoTempo`, `Proveniencia`, `DadoPessoal` (valor mascarado + "Revelar" → diálogo pedindo finalidade → `POST /lgpd/revelar`), `TextoLongo` (truncamento acessível com "Mostrar mais" e copiar identificador), `PainelRegras` (no Modo Especificação, mostra `regrasPorTela(tela)` de `@agora/dominio`: id, tipo, título, descrição, fundamento).

## 6. Jornada da contratação

- `/jornada`: processos com filtros por órgão requisitante (PF, PRF, SENASP, SENAPPEN, MJSP) e etapa; "Novo processo".
- `/jornada/:id`: **stepper** horizontal das 7 etapas (`<ol>` com etapa atual `aria-current="step"`, concluídas com ícone de check, bloqueios com ícone de alerta), painel da etapa selecionada, coluna lateral com **árvore do processo SEI** (documentos numerados e assinatura), **bloqueios** (RN que impedem avançar) e **sinais** (RIA/RN de atenção). Botão "Avançar etapa" mostra os bloqueios retornados (422) de forma clara.
- Etapa 1: formulário do DFD com itens (tabela editável), alternador "Usa catálogo padronizado" (desmarcar exige justificativa — RN-02), sinal de artigo de luxo ao digitar a descrição (RN-01, via `sinalizarArtigoLuxo`, justificativa obrigatória), sinal de fracionamento (RN-14).
- Etapa 2: designação da equipe (papéis × usuários) com verificação de segregação (RN-03) ao salvar; assinatura simulada dos documentos na árvore SEI.
- Etapa 3: ETP com os 13 incisos (obrigatórios marcados; progresso; RN-04), matriz de riscos (probabilidade × impacto com mapa de calor acessível), cesta de preços (cotações, análise estatística, expurgos sugeridos para aceitar com justificativa — RIA-03, orçamento sigiloso com motivo — art. 24).
- Etapa 4: geração de TR, edital e minuta de contrato (rascunhos com premissas e fontes, "requer revisão humana"), visualização lado a lado, aprovação.
- Etapa 5: checklist do parecer jurídico (perfil jurídico), conclusão; publicação PNCP/DOU (fila), data mínima para propostas (art. 55).
- Etapa 6: licitantes escolhidos no cadastro de fornecedores (busca `GET /fornecedores?busca=`; nome e porte ME/EPP vêm do cadastro), propostas e critérios opcionais do art. 60, desempate passo a passo (art. 60, RN-08), sinal de vínculo societário.
- Etapa 7: contratar (RN-09 regularidade), link para o contrato criado na carteira.
- Botão "Exportar dossiê" → visão de impressão (`@media print`) com processo, documentos e regras aplicadas.

## 7. Acesso à API (`src/api/`)

- `cliente.ts`: `fetch` com `credentials: 'same-origin'`, cabeçalho `X-Agora-CSRF` (token da sessão em memória, nunca em storage), JSON, parse de `RespostaErro` em `ErroApi` (status, codigo, mensagem, detalhes, idRequisicao). 401 → limpa sessão e navega para `/entrar?retorno=<rota>`.
- Hooks por domínio com TanStack Query (`useAtas(filtro)`, `useContrato(id)`…), chaves `['atas', filtro]`. Filtros e página ficam na URL (`useSearchParams`) para links compartilháveis.
- Mutações invalidam as consultas afetadas e mostram aviso de sucesso; escritas destrutivas exigem `ConfirmarAcao`.
- Em desenvolvimento, `vite.config.ts` faz proxy de `/api` e `/saude` para `http://localhost:3000`.

## 8. Acessibilidade (WCAG 2.1 AA / eMAG)

Navegação completa por teclado; foco visível; ordem lógica; landmarks; um `<h1>` por página e hierarquia de títulos; nomes acessíveis em botões só de ícone; `aria-live` para resultados de filtros e avisos; contraste AA validado; zoom de 200% sem perda; `prefers-reduced-motion` respeitado; tabelas com `<caption>` e `scope`; formulários com `fieldset`/`legend` quando agrupados; mensagens de erro ligadas ao campo.

## 9. Desempenho

Divisão de código por rota (`React.lazy`); nenhum pacote pesado (sem biblioteca de gráficos, sem Excel no navegador: CSV vem do servidor); orçamento: JS inicial ≤ 150 KB com gzip (medido na versão 1.0: ~129 KB gzip / ~404 KB minificado, dos quais ~350 KB são React, React Router e TanStack Query). Referência: o portal anterior carrega 2,8 MB de JS, com ~760 KB nos dois primeiros chunks.
