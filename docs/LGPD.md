# Ágora — proteção de dados pessoais (LGPD)

Este documento é material de apoio ao encarregado e à área jurídica do órgão. Ele descreve como a plataforma trata dados pessoais e serve de base para o Relatório de Impacto à Proteção de Dados Pessoais (RIPD, LGPD, art. 38), que é responsabilidade do controlador. Não substitui a análise jurídica do órgão.

## 1. Papéis

- **Controlador**: o órgão que opera a plataforma (ex.: MJSP).
- **Operador**: quem hospeda e sustenta a plataforma por contrato com o órgão. A Ágora roda na infraestrutura do próprio órgão, sem suboperadores estrangeiros em tempo de execução.
- **Encarregado**: definido pelo órgão (variáveis `AGORA_ENCARREGADO_NOME` e `AGORA_ENCARREGADO_EMAIL`) e exibido na página pública `/privacidade`.

## 2. Dados pessoais tratados

| Titular | Dados | Finalidade | Base legal (LGPD) |
|---|---|---|---|
| Servidores usuários | nome, e-mail institucional, CPF, perfis, UASGs, registros de acesso | autenticação, autorização, trilha de auditoria | art. 7º, II e III; art. 23 (execução de políticas públicas) |
| Representantes e sócios de fornecedores | nome, CPF | verificação de impedimentos e de segregação de funções (Lei 14.133, arts. 9º e 14) | art. 7º, II e III |
| Fornecedores pessoa física e credores PF | nome, CPF, contato | execução contratual e financeira | art. 7º, II, III e V |
| Agentes públicos designados | nome, papel no processo | instrução do processo (Lei 14.133, arts. 7º e 8º) | art. 7º, II e III |

A plataforma **não trata dados pessoais sensíveis** (LGPD, art. 5º, II).

## 3. Medidas técnicas implementadas

- **Minimização na exibição**: CPF, e-mail, telefone e nome de pessoa física aparecem mascarados por padrão (padrão de anonimização do governo federal para CPF: `***.456.789-**`).
- **Revelação controlada**: ver o dado completo exige a permissão `lgpd:revelar` (administrador e auditor) e uma finalidade escrita. Cada revelação gera registro em `lgpd_acessos` e na trilha de auditoria (LGPD, art. 37). O relatório fica em `/auditoria/lgpd`.
- **Transparência ativa sem dado pessoal**: a área pública `/transparencia` mostra contratos com CNPJ e razão social. Fornecedor pessoa física aparece com nome e CPF mascarados.
- **Registro de operações** (art. 37): trilha de auditoria append-only, encadeada por SHA-256, com verificação de integridade pela interface.
- **Segurança** (art. 46):
  - sessão em cookie `HttpOnly`/`SameSite=Strict`;
  - proteção CSRF;
  - senhas com scrypt;
  - limite de tentativas;
  - CSP estrita;
  - autorização por perfil e por UASG no servidor;
  - IP guardado só como hash com segredo;
  - logs com redação de cookie, senha, CPF e e-mail.
- **Sem transferência internacional** (arts. 33 a 36): nenhuma chamada do navegador a terceiros (fontes e ícones servidos pela própria aplicação). Integrações só com APIs públicas do governo brasileiro, feitas pelo servidor. A IA, se habilitada, só usa endpoint auto-hospedado no órgão.
- **Nada no navegador**: nenhum dado de negócio ou pessoal no `localStorage`/`sessionStorage`. O único cookie é o de sessão, estritamente necessário.
- **Ambiente de demonstração** com dados 100% sintéticos.

## 4. Direitos dos titulares (art. 18)

Os pedidos chegam pelo canal do encarregado. O administrador consegue localizar e exportar os dados de um usuário (cadastro e registros de acesso) e desativar contas. A eliminação de registros sujeitos a guarda legal (processos de contratação, trilha de auditoria) segue os prazos de retenção abaixo (art. 16, I).

## 5. Retenção sugerida (a validar com a gestão documental do órgão)

| Dado | Prazo |
|---|---|
| Sessões | expiram em 8 h (máximo absoluto de 12 h); registros removidos após 30 dias |
| Tentativas de login | até 90 dias (limpeza horária); na prática, registros com mais de 24 h são apagados a cada nova tentativa malsucedida |
| Trilha de auditoria e registros de acesso a dados pessoais | conforme tabela de temporalidade do órgão (sugerido: 5 anos) |
| Processos de contratação e contratos | conforme Lei 14.133 e tabela de temporalidade |

## 6. Pontos para o RIPD do órgão

- Mapear integrações efetivamente habilitadas (PNCP, Compras.gov.br, Contratos.gov.br, SEI, Login Único).
- Definir quem recebe `lgpd:revelar` e revisar o relatório de acessos periodicamente.
- Aprovar os prazos de retenção.
- Se a IA for habilitada: avaliar o modelo auto-hospedado, garantir que não haja treino com dados do órgão e manter a revisão humana obrigatória (já imposta pela plataforma).
