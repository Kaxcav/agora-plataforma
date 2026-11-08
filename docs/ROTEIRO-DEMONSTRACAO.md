# Roteiro de demonstração da Ágora (≈ 25 minutos)

Preparação: `npm ci && npm run build && npm start`, depois abra http://localhost:3000. O banco começa vazio e recebe os dados sintéticos sozinho.
Para recomeçar do zero entre apresentações: `npm run seed -w @agora/api -- --reset`.
Todas as contas usam a senha `Agora@Demo2026`. Na tela de entrada, o painel "Contas de demonstração" preenche o e-mail com um clique.

## 1. O problema (2 min)
Mostre `docs/ANALISE-ARQUITETURA.md` (ou o slide correspondente). No sistema atual:
- o navegador fala direto com um banco em nuvem estrangeira;
- dados "oficiais" de empenho são montados no navegador;
- faltam os cabeçalhos de segurança;
- o escopo cobre só a execução contratual.

## 2. Soberania e segurança, antes de entrar (2 min)
1. Abra **/transparencia** sem login. A consulta pública não traz CPF nem e-mail; fornecedor pessoa física aparece mascarado.
2. Abra as ferramentas do navegador, aba Rede. Toda requisição vai para a própria Ágora: fontes, ícones e dados. Nenhum Google Fonts, CDN ou API de terceiros.
3. Mostre os cabeçalhos da resposta: CSP, `X-Frame-Options: DENY`, `nosniff`.

## 3. Gestão do dia a dia — `gestor@agora.demo` (5 min)
1. **Início**:
   - indicadores e vencimentos 30/60/90 dias;
   - contratos com prazo de divulgação no PNCP vencido (art. 94);
   - "queima de saldo acelerada";
   - procedência e horário de cada conjunto de dados.

   Enquanto carrega aparece um esqueleto, nunca zeros falsos.
2. **Fila de pendências**: resolva uma pendência. A observação é obrigatória e o aviso traz **Desfazer**. Mostre que a ação foi para o histórico do contrato.
3. **Contratos**: abra um contrato com semáforo crítico. Mostre:
   - a linha do tempo e a queima de saldo projetada;
   - na aba **Aditivos**, o simulador do art. 125: um acréscimo de 30% é recusado com o fundamento legal e a regularidade do fornecedor;
   - os empenhos, os pagamentos em ordem cronológica (art. 141) e o plano de gestão.
4. Ligue o **Modo especificação técnica** no cabeçalho. Cada tela mostra as regras (RF/RN/RIA) que implementa, com o fundamento legal.

## 4. Jornada da contratação — `agente@agora.demo` (10 min)
Menu **Jornada da contratação**: são 8 processos sintéticos, um em cada momento do ciclo.

| Processo | Etapa | O que demonstrar |
|---|---|---|
| EPIs (SENASP) | 1 | O termo "couro legítimo" dispara o sinal de artigo de luxo (art. 20) e exige justificativa. Mostre também o alerta de fracionamento a 90% do limite de dispensa (art. 75, § 1º) e a demanda fora do PCA. |
| Munição de treinamento (PRF) | 2 | A mesma pessoa está no planejamento e como agente de contratação. "Avançar" é bloqueado pela segregação de funções (art. 7º, § 1º). Corrija a equipe e assine o DFD na árvore SEI simulada. |
| Scanners corporais (SENAPPEN) | 3 | ETP sem os incisos XI–XIII (art. 18). Na cesta de preços, aceite o outlier sugerido (Tukey) com justificativa e mostre média × mediana. |
| Drones (SENASP) | 4 | O edital exige faturamento mínimo, o que o art. 69, § 2º veda: bloqueio RN-06. Corrija os parâmetros, gere e aprove o edital e a minuta com as 19 cláusulas do art. 92. Todo documento é rascunho com premissas e fontes, e exige revisão humana. |
| Licenças de software de perícia (PF) | 5 | Entre como `juridico@agora.demo` e preencha o checklist do parecer (art. 53). Volte como agente e publique; a data mínima para propostas segue o art. 55. A minuta traz a cessão de direitos do art. 93. |
| Rádios P25 (PF) | 5 → 6 | Tudo cumprido: o avanço passa. |
| Coletes balísticos (SENASP) | 6 | Empate resolvido passo a passo pelo art. 60 (desempenho prévio), com o passo informativo da LC 123. |
| Viaturas (PRF) | 7 | **Contratar**: verifica sanções e regularidade (art. 91, § 4º) e cria o contrato na carteira, com as tarefas do modelo de gestão e a pendência de divulgação no PNCP. Abra o contrato criado. |

Ao final, use "Exportar dossiê" para abrir a visão de impressão do processo.

## 5. Controle e LGPD — `auditor@agora.demo` (3 min)
1. **Auditoria**: a trilha completa, com "Verificar integridade da cadeia". Cada evento é encadeado por SHA-256 e adulteração é detectada.
2. **Fornecedores**: revele o CPF de um fornecedor pessoa física. É obrigatório informar a finalidade, e o acesso aparece em **Auditoria › Acessos a dados pessoais** (LGPD, art. 37).
3. **Sanções**: simulador de dosimetria (art. 156, entre 0,5% e 30%), com memória de cálculo e o aviso de que a decisão é da autoridade competente.

## 6. Perfis e escopo — `consulta@agora.demo` (1 min)
O menu não mostra administração. O acesso direto a `/admin/usuarios` responde "sem permissão". A carteira mostra só as 2 UASGs do escopo, porque o filtro é aplicado no servidor.

## 7. Implantação (2 min)
- O mesmo pacote roda em `docker compose` com PostgreSQL 16 ou no Kubernetes do órgão: 2 réplicas, contêiner não-root somente leitura, NetworkPolicy.
- O código é cedido (art. 93).
- Login Único gov.br e IA auto-hospedada são opcionais e configurados por variáveis.

## Perguntas frequentes
- **"Integra com o SEI de verdade?"** A árvore e as assinaturas são simuladas. A integração real usa a API do SEI e os certificados ICP-Brasil do órgão; os pontos de integração já existem no fluxo.
- **"A IA decide alguma coisa?"** Não. Ela só redige rascunhos, sempre com fontes e com revisão humana obrigatória, e seções como habilitação, sanções e conclusão do parecer ficam protegidas. Por padrão nem há IA: os documentos saem de modelos de texto determinísticos.
- **"De onde vêm os dados?"** Na demonstração, são sintéticos. Em produção, as integrações (PNCP, Compras.gov.br, Contratos.gov.br) rodam no servidor, com registro de procedência e hash do conteúdo recebido.