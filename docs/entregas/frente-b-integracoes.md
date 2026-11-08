# Entrega da frente B — serviços, mensageria e publicação no PNCP (F31 e F11)

Regras novas: **RNF-07** (fila de integrações) e **RF-19** (publicação no PNCP). Migração: `012_fila_integracoes_pncp.sql`.

## 1. O que foi feito

### F31 — serviços e mensageria (RNF-07)

**Fila de integrações no servidor** (`apps/api/src/fila/`). O estado de cada tarefa fica sempre na tabela `fila_tarefas`. Há dois transportes:

| Transporte | Quando | Como funciona |
|---|---|---|
| **RabbitMQ** (`amqplib`) | `AGORA_FILA_URL=amqp://…` | Fila principal `agora.tarefas`, durável, com mensagens persistentes e confirmação de publicação. Cada tempo de espera tem uma fila própria (`agora.tarefas.espera.<ms>ms`), com TTL e *dead-letter* de volta para a principal: quem cumpre a espera exponencial é o próprio RabbitMQ. A fila de erro é `agora.tarefas.erro`. |
| **PostgreSQL** | sem `AGORA_FILA_URL` (demonstração, testes, PGlite) | A própria tabela é a fila. O trabalhador reserva cada tarefa com um único `UPDATE … RETURNING` condicionado à situação, o que é seguro com várias réplicas. |

**Comportamento:**

- **Chave de idempotência** única por operação, gerada por `chaveIdempotencia` (ex.: `pncp:compra:<processo>`). Pedir duas vezes não cria uma segunda tarefa, e o edital não é publicado duas vezes.
- **Caixa de saída transacional:** a tarefa é gravada na mesma transação da ação de negócio. Depois da confirmação, a API avisa o transporte. Se o RabbitMQ estiver fora nesse momento, a varredura do trabalhador reenvia o aviso.
- **Novas tentativas com espera exponencial e limite:** `esperaNovaTentativa` e `decidirDestinoFalha`. O padrão é 10 execuções, começando com 30 s de espera e dobrando até o teto de 1 h. Somadas, as esperas passam de 3 horas, o que cobre uma janela usual de manutenção do PNCP.
- **Classificação das respostas** (`classificarRespostaHttp`):
  - 2xx: sucesso;
  - 401: refaz o login uma vez;
  - 408, 425, 429, 5xx e falhas de rede: nova tentativa;
  - demais 4xx: falha definitiva, que vai direto para a fila de erro, sem nova tentativa.
- **Fila de erro visível** na tela **Administração › Integrações**, seção **Fila de integrações**. A tela mostra:
  - o transporte e o modo do trabalhador;
  - as contagens;
  - um filtro com as opções Fila de erro, Na fila e Todas;
  - a tabela com tentativas, próxima tentativa e último erro;
  - a ação **Reprocessar**, auditada como `fila.reprocessar`.
- **Trilha de auditoria:**
  - pedido: `fila.enfileirar` e `fila.antecipar`;
  - cada falha: `fila.nova_tentativa` e `fila.erro`, com tentativa, erro e destino;
  - reprocessamento: `fila.reprocessar`;
  - resultado, gravado pelos manipuladores: `sincronizacao.executar`, `pncp.publicar`, `pncp.anexar` e `pncp.divulgar_contrato`.
- **Serviço trabalhador separado**, com entrada própria em `apps/api/src/trabalhador.ts` (`node apps/api/dist/trabalhador.js`, ou `npm run trabalhador -w @agora/api`):
  - executa os conectores de sincronização e a publicação no PNCP;
  - responde às sondas `/saude/vivo` e `/saude/pronto` na porta `AGORA_TRABALHADOR_PORTA`;
  - no encerramento, termina as tarefas em andamento;
  - encerra se perder a conexão com o RabbitMQ, para o orquestrador reiniciá-lo.
- **A API só publica as tarefas.** `POST /sincronizacoes/:fonte/executar` grava a tarefa:
  - com o trabalhador embutido (`AGORA_TRABALHADOR=embutido`, o padrão no contêiner único), espera a execução e responde 200 com o resultado;
  - com o trabalhador à parte (`separado`), responde 202 com a sincronização "executando".
  - Um pedido repetido antecipa a tarefa pendente em vez de duplicá-la.
- **Implantação:**
  - `deploy/docker-compose.yml`: serviços `fila` (RabbitMQ 3.13, volume próprio, *healthcheck*) e `trabalhador` (mesma imagem, entrada própria, somente leitura, *healthcheck* na porta 3001). A API passa a usar `AGORA_TRABALHADOR=separado`.
  - `deploy/k8s/fila-trabalhador.yaml`:
    - StatefulSet do RabbitMQ, com PVC e sondas `rabbitmq-diagnostics`;
    - Deployment `agora-trabalhador` com 2 réplicas, sondas HTTP, contêiner não root e somente leitura;
    - PodDisruptionBudget;
    - NetworkPolicies: o trabalhador só sai para DNS, banco, RabbitMQ e HTTPS; o RabbitMQ só aceita a API e o trabalhador.
  - `deploy/k8s/agora.yaml`: a API ganhou `AGORA_TRABALHADOR=separado` e saída para a porta 5672.
- **Carga de demonstração:** uma sincronização sintética do SIAFI na fila de erro (janela de manutenção simulada), para mostrar o reprocessamento.

### F11 — publicação real no PNCP (RF-19)

O desenho de `docs/integracoes/PNCP-PUBLICACAO.md` foi conferido no **Manual de Integração PNCP 2.2.9** (gov.br/pncp, versões anteriores). Pontos conferidos:

- login (seções 3.2 e 6.1.4);
- inclusão da compra (6.3.1, com retorno `compraUri` e `documentoUri`), dos anexos (6.3.6), da ata (6.4.1) e do contrato (6.5.1);
- tabelas 5.1 a 5.4, 5.11, 5.12 e 5.15;
- conformidade entre instrumento, modalidade e amparo legal (5.17);
- formato do número de controle (4.3).

A versão vigente do manual online é a 2.6; o portal recusou a conexão durante a consulta.

**O que foi implementado:**

- **Cliente da API de manutenção** (`apps/api/src/integracoes/pncp-publicacao.ts`):
  - login com o JWT no cabeçalho `Authorization`, reaproveitado por até 50 minutos;
  - `POST /v1/orgaos/{cnpj}/compras` em multipart, com as partes `compra` (JSON) e `documento` (PDF) e os cabeçalhos `Titulo-Documento` (texto ASCII, até 50 caracteres) e `Tipo-Documento-Id` (2 = Edital);
  - anexos com `POST …/compras/{ano}/{sequencial}/arquivos` (parte `arquivo`: 4 = Termo de referência, 3 = Minuta do contrato);
  - contrato com `POST /v1/orgaos/{cnpj}/contratos` (JSON) e ata com `POST …/compras/{ano}/{sequencial}/atas` (JSON);
  - o 201 é lido no `location` (ou em `compraUri`) por `interpretarLocalizacaoPncp`.
- **Tudo pela fila:**
  - "Publicar", na etapa 5, enfileira `pncp.compra`. Aceita a compra, o trabalhador grava o protocolo e o número de controle, publica a etapa (data mínima das propostas contada da publicação, art. 55) e enfileira os anexos aprovados (`pncp.arquivo`).
  - "Divulgar no PNCP", na etapa 7, enfileira `pncp.contrato`. Concluído o envio, ficam gravados `contratos.id_pncp` e `divulgacao_pncp_em`, e a pendência de divulgação (art. 94) é resolvida.
- **Prova do envio:**
  - Logo depois da resposta do PNCP, `pncp_envios` recebe o protocolo (o `location`), o número de controle e o hash SHA-256 do arquivo.
  - Se a execução cair antes de concluir, a próxima tentativa reaproveita a resposta e não envia de novo.
- **Montagem da contratação** (`codigosContratacaoPncp`):
  - modalidade, amparo legal e critério seguem as tabelas do manual (pregão eletrônico: modalidade 6 e amparo 1, art. 28, I; concorrência eletrônica: 4 e 2);
  - modo de disputa conforme o art. 56;
  - unidade compradora = UASG do processo; itens do DFD com o valor estimado da cesta;
  - abertura das propostas no horário de Brasília da publicação; encerramento às 9h da data mínima.
- **Situação na etapa 5**, no painel **Envios ao PNCP**: cada envio com a situação (na fila, enviando, aguardando nova tentativa, publicado ou na fila de erro), o protocolo (com botão de copiar), as tentativas, a data do envio e o hash. Também mostra:
  - o motivo da recusa;
  - o link **Inteiro teor, sem login** (`/transparencia/editais/:id`);
  - quando a publicação foi real, o link **Registro no PNCP** (`linkPncpCompra`).
- **Reenvio:** depois de uma recusa, "Publicar" reabre a mesma tarefa (mesma chave), como reprocessamento auditado.
- **Modo offline (padrão):** simulação determinística, sem chamada externa.
  - O número de controle é o mesmo da simulação anterior (`publicarOffline`).
  - O protocolo é `SIMULADO-` seguido de 20 caracteres hexadecimais do SHA-256 da chave e do hash do arquivo.
  - A tela avisa que é simulação.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde está |
|---|---|---|
| 389 | "arquitetura em microsserviços" | API e serviço trabalhador separados, com a mesma imagem e entrada própria |
| 524–540 (R04) | Indisponibilidade ou mudança das APIs do PNCP; "fila de mensageria assíncrona (retry automático)" | RNF-07: fila, novas tentativas, fila de erro, reprocessamento |
| 1582 (RF-05.1) | "barramento API RESTful com fila assíncrona de mensageria para envio automático ao PNCP" de editais, anexos, atas e contratos (art. 174, § 2º) | RF-19: compra + edital, anexos e contrato pela fila; cliente da ata pronto |
| 1697 (RNF-04) | "microsserviços orquestrados em Kubernetes", "fila de mensageria assíncrona (RabbitMQ/Kafka) com retry automático", "sem perda de transações" | RabbitMQ, `deploy/k8s/fila-trabalhador.yaml`, caixa de saída transacional e prova do envio |
| 689–691 (PoC-05) | Publicação de edital + anexos no sandbox do PNCP; protocolo 200/201; link público sem login (art. 25, § 3º) | Base padrão `treina.pncp.gov.br` fora de produção; protocolo e número de controle gravados; link público; e2e `publicacao-pncp.spec.ts` |
| 443 | Credenciamento junto ao PNCP (chaves de homologação e produção) | `AGORA_PNCP_PUBLICACAO_URL`, `AGORA_PNCP_USUARIO` e `AGORA_PNCP_SENHA`, só no servidor |
| 1575 | Rastreabilidade PoC-05 | Teste da API (`pncp-publicacao.test.ts`) e e2e |

## 3. Equivalentes adotados e motivo

- **"Microsserviços" → API + serviço trabalhador.** O objetivo do cliente é isolar as integrações e aguentar as janelas do PNCP sem afetar o uso, e isso se cumpre separando o que fala com sistemas externos (trabalhador, escalável à parte) do que atende o usuário (API). Fatiar o domínio em mais serviços traria transações distribuídas sem ganho para esse objetivo.
- **RabbitMQ, e não Kafka.** O cliente admite os dois. A fila de tarefas com espera por TTL e fila de erro é o caso típico do RabbitMQ. Sem `AGORA_FILA_URL`, a fila durável em PostgreSQL atende à demonstração de contêiner único e aos testes.
- **"Retry automático" só para falhas transitórias.** Repetir um envio recusado pelo PNCP (4xx) não muda o resultado e poderia gerar duplicidade. A recusa vai para a fila de erro e só volta por ação humana auditada ("Reprocessar" ou "Publicar").
- **Trabalhador embutido por padrão.** Sem a variável, ele roda dentro da API, para que um contêiner único nunca fique com tarefas sem execução. Os manifestos de produção (compose e Kubernetes) definem `AGORA_TRABALHADOR=separado`.
- **Dados pessoais.** O JSON do contrato leva o CPF ou CNPJ e o nome do fornecedor porque a divulgação no PNCP é obrigatória (art. 94). O envio é feito só pelo servidor. A trilha de auditoria e a fila não guardam o documento do fornecedor; o IP do solicitante fica só em hash.

## 4. Regras novas (catálogo)

| Código | Título | Implementação |
|---|---|---|
| RNF-07 | Fila de integrações com novas tentativas e fila de erro | `esperaNovaTentativa`, `decidirDestinoFalha`, `classificarRespostaHttp`, `chaveIdempotencia`; rotas `/fila/*`; `trabalhador.ts` |
| RF-19 | Publicação no PNCP pela fila de integrações (etapa 5, tela `jornada.detalhe`) | `interpretarLocalizacaoPncp`, `numeroControlePncp`, `codigosContratacaoPncp`, `tituloDocumentoPncp`, `prazoDivulgacaoContratoPncp`; rotas de publicação |

Funções novas do domínio (`packages/dominio/src/integracoes/fila.ts` e `packages/dominio/src/lei14133/pncp.ts`):

- `POLITICA_PADRAO_FILA`, `validarPoliticaNovasTentativas`;
- `TIPOS_DOCUMENTO_PNCP`.

## 5. Rotas

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /fila/resumo` | `integracoes:executar` ou `admin:usuarios` | Transporte, modo do trabalhador, contagens e política de tentativas |
| `GET /fila/tarefas?situacao&pagina&tamanhoPagina` | idem | Tarefas no escopo de UASG do usuário (sincronizações são do órgão todo) |
| `POST /fila/tarefas/:id/reprocessar` | `integracoes:executar` | Tira da fila de erro (422 se a tarefa não estiver nela); auditado |
| `GET /processos/:id/publicacao-pncp` | `jornada:ler` | Envios ao PNCP do processo, links público e do PNCP |
| `POST /processos/:id/contrato/publicar-pncp` | `jornada:publicar` | Divulga o contrato gerado (art. 94); exige a contratação publicada |
| `POST /processos/:id/publicar` (alterada) | `jornada:publicar` | Agora enfileira a compra + edital; reabre a tarefa que estiver na fila de erro |
| `POST /sincronizacoes/:fonte/executar` (alterada) | `integracoes:executar` | Agora publica a tarefa: 200 com trabalhador embutido, 202 com trabalhador à parte |

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_FILA_URL` | — | `amqp://usuario:senha@host:5672/vhost`. Sem ela, a fila fica no PostgreSQL |
| `AGORA_TRABALHADOR` | `embutido` | `embutido` (trabalhador dentro da API) ou `separado` (só publica) |
| `AGORA_TRABALHADOR_PORTA` | `3001` | Sondas do serviço trabalhador |
| `AGORA_FILA_TENTATIVAS` | `10` | Execuções por tarefa, contando a primeira |
| `AGORA_FILA_ESPERA_MS` | `30000` | Espera antes da 2ª execução; dobra a cada falha |
| `AGORA_FILA_ESPERA_MAXIMA_MS` | `3600000` | Teto da espera |
| `AGORA_PNCP_PUBLICACAO_URL` | treinamento (`https://treina.pncp.gov.br/api/pncp`); em produção, `https://pncp.gov.br/api/pncp` | API de manutenção do PNCP |
| `AGORA_PNCP_USUARIO` e `AGORA_PNCP_SENHA` | — | Login do sistema credenciado (os dois juntos) |
| `AGORA_ORGAO_CNPJ` e `AGORA_INTEGRACOES` | já existiam | CNPJ do órgão; `online` liga o PNCP real |
| `RABBITMQ_PASSWORD` (só no compose) | — | Senha do RabbitMQ; use só letras e números |

## 7. Seção pronta para o manual do usuário

### Publicação no PNCP (etapa 5) e divulgação do contrato (etapa 7)

**Quem faz:** o **agente de contratação** publica o edital e divulga o contrato. Os demais perfis com acesso à jornada acompanham a situação.

1. Com o parecer jurídico favorável, use **Publicar** na seção **Publicação do edital** e confirme.
2. A Ágora envia ao PNCP, pela fila de integrações do servidor, a contratação com o edital e, em seguida, o termo de referência e a minuta do contrato aprovados.
3. O painel **Envios ao PNCP** mostra a situação de cada documento:
   - **Na fila**;
   - **Enviando**;
   - **Aguardando nova tentativa**: o PNCP estava fora do ar, e a Ágora tenta de novo sozinha, no horário indicado;
   - **Publicado**: com o protocolo do PNCP, que pode ser copiado, o número de controle e o hash do arquivo;
   - **Na fila de erro**: o PNCP recusou o envio, e o motivo aparece na tela.
4. Se o envio estiver na fila de erro, corrija o que o PNCP apontou (por exemplo, o cadastro da unidade compradora no PNCP) e use **Publicar** de novo.
5. A data mínima para as propostas é contada da publicação aceita pelo PNCP.
6. O link **Inteiro teor, sem login** abre a página pública do edital. Quando a publicação foi feita no PNCP real, aparece também **Registro no PNCP**.
7. Na etapa 7, depois de gerar o contrato, use **Divulgar no PNCP**. Concluído o envio, a pendência de divulgação do contrato (art. 94) é resolvida sozinha.

Em demonstração, as integrações ficam em modo offline: o painel avisa que é uma simulação, e o protocolo começa com `SIMULADO-`.

### Fila de integrações (Administração › Integrações)

**Quem vê:** administrador e financeiro, ou quem administra usuários. **Quem reprocessa:** administrador e financeiro (permissão para executar integrações).

- A seção **Fila de integrações** mostra o transporte da fila (RabbitMQ ou PostgreSQL), quantas tarefas estão na fila, quantas estão na fila de erro e quantas foram concluídas nas últimas 24 horas.
- Em **Mostrar**, escolha **Fila de erro**, **Na fila** ou **Todas**. A tabela mostra cada tarefa com a situação, as tentativas, a próxima tentativa (ou a última atualização) e o último erro.
- Para devolver à fila uma tarefa da fila de erro, use **Reprocessar** e confirme. Confira antes se a causa foi resolvida. As tentativas recomeçam do zero, e o reprocessamento fica na trilha de auditoria.
- **Executar agora** (sincronizações) também passa pela fila. Quando o serviço trabalhador roda à parte, a sincronização aparece como "executando" até terminar.

## 8. Limitações e o que depende de acesso externo

- **Credenciamento no PNCP.** O envio real depende do login e da senha do sistema, emitidos no credenciamento junto ao MGI (linha 443). Depende também do CNPJ do órgão incluído nos entes autorizados e das unidades compradoras (UASGs) cadastradas no PNCP. O teste contra o `treina.pncp.gov.br` não foi executado por falta dessas credenciais; a API foi testada com um PNCP simulado (`fetch` falso).
- **DOU:** continua simulado (marcado como publicado junto com o PNCP). A integração real com o Diário Oficial fica para outra fase.
- **Ata de registro de preços:** o cliente (`incluirAta`) está pronto e testado, mas não há gatilho na interface. A Ágora ainda não gera atas: elas chegam do Compras.gov.br, que já as publica no PNCP. O gatilho entra quando a jornada tiver SRP.
- **Contrato:** só os dados (JSON) vão ao PNCP. O documento do contrato assinado (tipo 12) não é enviado porque a assinatura ainda é simulada.
- **Anexos:** só o termo de referência e a minuta do contrato acompanham o edital, os mesmos da página pública. ETP, mapa de riscos e DFD (tipos 7, 9 e 10) podem ser acrescentados em `ANEXOS_PNCP`.
- **Benefício ME/EPP por item:** vai como "Sem benefício" (código 4). A exclusividade (LC 123/2006, arts. 48 e 49) é decisão do agente e ainda não é registrada na jornada; o TR só sinaliza os itens de até R$ 80 mil.
- **Modo de disputa:** segue o art. 56 (fechado para técnica e preço e para melhor técnica). O modelo de edital diz "modo de disputa aberto" em todos os casos e precisa ser ajustado, fora desta frente.
- **Retificação e exclusão no PNCP:** não implementadas.
- **Janela residual de duplicidade:** se o processo cair entre o 201 do PNCP e a gravação da prova do envio, a nova tentativa pode repetir a inclusão. O manual não oferece consulta por número da compra no sistema de origem para tirar a dúvida antes de reenviar.
- **RabbitMQ:** um nó (StatefulSet). Para alta disponibilidade, use o RabbitMQ Cluster Operator do órgão, com filas de quórum.
- **Trabalhador sem batimento:** a API não verifica se um trabalhador separado está vivo; isso fica com as sondas do orquestrador. Com PGlite, o serviço trabalhador separado recusa iniciar, porque o PGlite é de um processo só. Nesse caso, use o trabalhador embutido, que é o padrão.
- **Pontos de atenção do DLP (gates da Fábrica):** dois achados `db_uri` em arquivos alterados são anteriores a esta frente e estão em linhas que não mudaram: o texto de ajuda com o formato da URL do PostgreSQL (`AGORA_BANCO_URL`) em `config.ts` e a URL com `${POSTGRES_PASSWORD}` no compose. As linhas novas não acrescentam achados.
