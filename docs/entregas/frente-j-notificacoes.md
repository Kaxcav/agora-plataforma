# Frente J — Central de notificações (F27) e semáforo de 120 dias

## 1. O que foi feito

### F27 — Notificações a fiscais, gestores e contratadas (RF-26)

- **Central de notificações** (`/notificacoes`, menu Carteira › Notificações):
  - lista os avisos com filtros por tipo, faixa de vencimento, situação do envio e origem, além da opção "Só os destinados a mim";
  - o detalhe de cada aviso mostra o texto da mensagem, o fundamento legal e cada envio, com destinatário, canal, endereço mascarado, situação, tentativas, protocolo e o motivo da não entrega;
  - o reenvio cria um novo envio ligado ao original, que fica no histórico;
  - um bloco mostra a situação dos canais, da fila e da última varredura diária.
- **Disparo em um clique** pelo botão **Notificar** nas páginas do contrato e da ata. Por padrão, o aviso de vencimento vai ao fiscal por e-mail. Também é possível:
  - escolher outro tipo de aviso: reajuste, garantia, pendência ou ocorrência;
  - escolher outros destinatários: fiscal, gestor ou contratada (fornecedoras, no caso da ata);
  - escolher outros canais: e-mail institucional, registro no processo SEI ou gov.br;
  - acrescentar uma mensagem complementar.
- **Avisos automáticos** gerados pela varredura diária do servidor:
  - vencimento por faixa (RN-31), ao gestor e ao fiscal;
  - aniversário da data-base do reajuste e validade da garantia, ambos com 30 dias de antecedência;
  - pendências abertas de alta prioridade, ao responsável. Os tipos que já têm aviso próprio (vigência, garantia e reajuste) ficam de fora, para não duplicar.
- **Canais**, todos no servidor:
  - **e-mail institucional**: cliente SMTP próprio, sem dependência nova. Aceita STARTTLS, TLS implícito, AUTH PLAIN/LOGIN, assunto RFC 2047 e corpo UTF-8 em base64. Respostas 5xx são falha permanente. Até o órgão configurar o SMTP, o driver é simulado;
  - **SEI**: interface pronta e driver simulado. Registra o protocolo do documento que seria incluído no processo SEI do instrumento;
  - **gov.br**: interface pronta e driver simulado. Atende só pessoa física (CPF) e depende da adesão do servidor.
- **Fila durável no banco (outbox)**:
  - a notificação e os envios são gravados na mesma transação da escrita e do evento de auditoria;
  - o envio acontece depois, com `FOR UPDATE SKIP LOCKED`;
  - novas tentativas em 1, 5, 15 e 60 minutos, e a 5ª falha marca o envio como "Falhou";
  - um envio preso em "enviando" volta à fila depois de 10 minutos.
- **Preferências por usuário** (aba **Minhas preferências**): cada servidor liga ou desliga, por tipo de aviso, o e-mail e o gov.br. Os **avisos legais obrigatórios** (ocorrência e vencimento na faixa de 30 dias) chegam por e-mail mesmo com a preferência desligada.
- **LGPD**:
  - o e-mail aparece sempre mascarado;
  - cada envio registra a base legal do tratamento (servidor: LGPD art. 7º, II e III, e art. 23; contratada: art. 7º, II e V);
  - a trilha de auditoria não guarda e-mail nem CPF, e o CPF do gov.br é lido do cadastro só na hora do envio;
  - e-mails devolvidos em mensagens de erro do servidor SMTP são mascarados antes de gravar.
- **Auditoria**: toda geração, disparo, envio, falha, reenvio, alteração de preferência e varredura manual gera evento na trilha encadeada por hash. Os avisos de um contrato ou ata aparecem também no **Histórico** do instrumento.

### Semáforo de vencimentos de 30, 60, 90 e 120 dias (RN-31)

- Nova faixa **Planejamento (91 a 120 dias)** no semáforo do domínio (`classificarVigencia`), nas etiquetas de contratos e atas e no painel (contagem `em120`). A situação do instrumento continua "vigente" nessa faixa, e "a vencer" segue sendo até 90 dias, para não mudar filtros existentes.
- **Linha do tempo de vencimentos** no painel: histograma dos próximos 120 dias e as listas de contratos e atas de cada faixa, com a providência sugerida.
- A varredura gera **um único aviso por instrumento, faixa e data de fim**. A prorrogação muda a data de fim e reinicia o ciclo.

### Agendador

- **No processo da API**, o padrão (`AGORA_NOTIFICACOES_AGENDADOR=api`):
  - a varredura roda na inicialização e é conferida a cada hora, uma vez por dia (tabela `notificacoes_varreduras`);
  - a fila é conferida a cada minuto.
- **Em processo à parte**: `AGORA_NOTIFICACOES_AGENDADOR=externo` na API, mais `npm run notificacoes -w @agora/api`, ou `-- --uma-vez` para cron do sistema operacional.
- As duas formas podem coexistir: um advisory lock na varredura e o `SKIP LOCKED` na fila evitam trabalho em dobro entre réplicas.
- A saída fica numa tabela própria (`notificacoes_envios`), que pode ser ligada depois à fila RabbitMQ da frente B: basta um publicador que leia os envios pendentes.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde |
|---|---|---|
| 1104 e 1236 | Cockpit de contratos, vigências, saldos e notificações (arts. 91, 92, 106 e 141) | Central, painel e botão Notificar |
| 1106 e 1240 | Linha do tempo visual com semáforo de 30/60/90/120 dias de contratos e atas | RN-31, faixa "Planejamento" e linha do tempo do painel |
| 1108 e 1244 | Central de notificações automatizadas, com disparo em um clique via SEI, e-mail e gov.br, para fiscais e contratadas, sobre vencimentos, reajustes ICTI/IPCA e pendências | RF-26 (o índice do contrato entra no texto do aviso de reajuste) |
| 1110 e 1246 | RN-01, trava pré-assinatura (contexto) | Não alterada: é da frente de regularidade. O aviso da faixa de 60 dias orienta a conferir a regularidade (art. 91, § 4º) |
| 1532 | RF-04.1: semáforo de 30/60/90/120 dias e disparo de notificações oficiais em um clique | RN-31 e RF-26 |

## 3. Equivalentes lícitos adotados

- **gov.br com driver simulado.** Pesquisei a oferta oficial:
  - a página "Solicitar envio de notificações personalizadas em canais digitais pessoais" (gov.br) descreve a Caixa Postal e o push do aplicativo gov.br, identificados pelo CPF, sem custo para o órgão;
  - o Notifica.br (Serpro) é serviço contratado, com push, SMS, e-mail e WhatsApp;
  - não há especificação técnica pública da API: credenciamento e credenciais dependem de adesão do órgão.

  Por isso o canal tem interface pronta e driver simulado. A entrega exige pessoa física, com CPF lido do cadastro só na hora do envio, e a **adesão do servidor**, sem forçar o canal pessoal nem nos avisos obrigatórios, que seguem pelo e-mail institucional.
- **SEI com driver simulado.** A integração real usa o web service SOAP do SEI (inclusão de documento no processo, com sigla do sistema e serviço cadastrados pelo administrador do SEI do órgão) e é de outra fase, como pedido.
- **Avisos legais obrigatórios.** A conversa não define quais são. Foram adotados:
  - **ocorrência na execução**, porque a fiscalização registra e determina a regularização (art. 117, § 1º) e a contratada responde pelos vícios (art. 119);
  - **vencimento na faixa de 30 dias**, a última janela para formalizar a prorrogação durante a vigência (arts. 105 a 107).

  **Precisa de confirmação do usuário.**
- **A notificação de ocorrência não é sanção.** O texto diz que não aplica penalidade e que eventual sanção depende de processo próprio, com defesa (regra 5).
- **Contratada sem preferências.** A contratada recebe por e-mail e SEI porque o aviso decorre do contrato. O gov.br só vale para contratada pessoa física.

## 4. Regras novas

- **RN-31** — Semáforo de vencimentos de 30, 60, 90 e 120 dias com avisos automáticos (`faixaVencimento`, `avaliarAvisoVencimento` e `avisoObrigatorio`).
- **RF-26** — Central de notificações automatizadas (`montarMensagemNotificacao`, `decidirEntregaNotificacao`, `baseLegalEnvio`, `proximaTentativa`, `avaliarAvisoReajuste` e `avaliarAvisoGarantia`).
- **RN-17** (ajuste de uma linha): a descrição passa a citar a faixa "planejamento (91 a 120 dias)" e "regular" acima de 120 dias.

## 5. Rotas novas (`/api/v1`)

| Método e rota | Permissão | O que faz |
|---|---|---|
| `GET /notificacoes` | `notificacoes:ler` | Lista com filtros e escopo de UASG |
| `GET /notificacoes/:id` | `notificacoes:ler` | Detalhe com envios (e-mail mascarado) |
| `GET /notificacoes/canais` | `notificacoes:ler` | Canais, fila e última varredura |
| `GET /notificacoes/preferencias` | `notificacoes:ler` | Preferências do próprio usuário |
| `PUT /notificacoes/preferencias` | `notificacoes:ler` | Grava as próprias preferências (auditado) |
| `POST /notificacoes` | `notificacoes:enviar` | Disparo manual: grava, audita e envia |
| `POST /notificacoes/envios/:id/reenviar` | `notificacoes:enviar` | Reenvio de envio falho ou entregue (suprimido → 422) |
| `POST /notificacoes/varredura` | `notificacoes:administrar` | Varredura do dia agora, idempotente |
| `GET /vencimentos` | `painel:ler` | Linha do tempo de 0 a 120 dias do painel |

Também mudaram duas respostas existentes:

- `GET /painel` ganhou `vencimentos.em120`;
- o tipo `Semaforo` ganhou `'planejamento'`.

**Permissões novas**, no fim de `TODAS_PERMISSOES`: `notificacoes:ler`, `notificacoes:enviar` e `notificacoes:administrar`. Por perfil:

- gestor de contratos e fiscal: ler e enviar;
- financeiro: ler;
- auditor: ler, pela regra das permissões `:ler`;
- administrador: todas.

**Migração:** `019_notificacoes.sql` (`notificacoes`, `notificacoes_envios`, `notificacoes_preferencias` e `notificacoes_varreduras`).

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_NOTIFICACOES_AGENDADOR` | `api` | `api` (no processo da API) ou `externo` (`npm run notificacoes -w @agora/api`) |
| `AGORA_NOTIFICACOES_EMAIL` | `simulado` | `simulado` ou `smtp` |
| `AGORA_NOTIFICACOES_SEI` | `simulado` | `simulado` ou `desligado` |
| `AGORA_NOTIFICACOES_GOVBR` | `simulado` | `simulado` ou `desligado` |
| `AGORA_SMTP_HOST` | — | Obrigatória com `smtp` |
| `AGORA_SMTP_PORTA` | 587 / 465 / 25 | Conforme a segurança |
| `AGORA_SMTP_SEGURANCA` | `starttls` | `starttls`, `tls` ou `nenhuma` (sem credenciais) |
| `AGORA_SMTP_USUARIO` e `AGORA_SMTP_SENHA` | — | Definidas juntas; exigem TLS |
| `AGORA_SMTP_REMETENTE` | — | Obrigatória com `smtp` (ex.: `nao-responda@orgao.gov.br`) |
| `AGORA_SMTP_TIMEOUT_MS` | 15000 | Prazo de resposta do servidor SMTP |

Certificado de autoridade interna do órgão: use `NODE_EXTRA_CA_CERTS`. O certificado do servidor SMTP é sempre validado.

## 7. Seção pronta para o manual do usuário

> ## Notificações
>
> A tela **Notificações** reúne os avisos sobre vencimentos, reajustes, garantias, pendências e ocorrências enviados a gestores, fiscais e contratadas.
>
> **Quem usa:**
>
> - gestor de contratos e fiscal de contrato: consultam e disparam avisos;
> - financeiro e auditor: consultam;
> - administrador: também executa a varredura do dia.
>
> Cada usuário ajusta as próprias preferências.
>
> ### Avisos automáticos
>
> Todo dia a Ágora confere a carteira e avisa, por e-mail:
>
> - o gestor e o fiscal, quando um contrato ou uma ata entra nas faixas de **120, 90, 60 e 30 dias** do fim da vigência;
> - o gestor e o fiscal, 30 dias antes do aniversário da data-base do reajuste e da validade da garantia;
> - o responsável por pendências abertas de alta prioridade.
>
> Cada faixa gera um único aviso. Se o contrato for prorrogado, os avisos recomeçam a partir da nova data de fim. Na tela **Início**, a **Linha do tempo de vencimentos** mostra os instrumentos de cada faixa.
>
> ### Enviar um aviso em um clique
>
> Perfis: gestor de contratos, fiscal de contrato e administrador.
>
> 1. Abra o contrato ou a ata e clique em **Notificar**.
> 2. Escolha o **Tipo de aviso**. Para **Ocorrência**, descreva a falha em **Relato da ocorrência** e, se quiser, informe o **Prazo para regularização**.
> 3. Marque os **Destinatários** (fiscal, gestor ou contratada) e os **Canais** (e-mail institucional, registro no processo SEI ou gov.br).
> 4. Se quiser, escreva uma **Mensagem complementar**.
> 5. Clique em **Enviar aviso**. O aviso informa quantos envios foram concluídos.
>
> A notificação de ocorrência não aplica penalidade: eventual sanção depende de processo próprio, com defesa.
>
> ### Acompanhar e reenviar
>
> 1. Em **Notificações**, use os filtros **Tipo**, **Faixa de vencimento**, **Situação do envio** e **Origem**, ou marque **Só os destinados a mim**.
> 2. Clique no assunto do aviso ou em **Ver envios**.
> 3. Cada envio mostra o destinatário, o canal, o e-mail mascarado e a situação: **Na fila**, **Enviado**, **Falhou** ou **Não enviado**, este com o motivo.
> 4. A etiqueta **Simulado** indica que o canal ainda não está ligado ao serviço real: a mensagem foi registrada, mas não saiu do servidor.
> 5. Para enviar de novo, clique em **Reenviar**. O envio anterior continua no histórico.
>
> Se o serviço de envio falhar, a Ágora tenta de novo em 1, 5, 15 e 60 minutos. Depois da quinta tentativa, o envio fica como **Falhou**.
>
> ### Minhas preferências
>
> 1. Em **Notificações**, abra a aba **Minhas preferências**.
> 2. Marque ou desmarque, por tipo de aviso, o **E-mail institucional** e o **gov.br**.
> 3. Clique em **Salvar preferências**.
>
> Os avisos de **ocorrência** e o aviso de vencimento da faixa de **30 dias** são obrigatórios e chegam por e-mail mesmo com a preferência desmarcada. O gov.br fica desligado até você aderir.
>
> Todo aviso, envio, reenvio e alteração de preferência fica na trilha de auditoria. O envio registra a base legal do uso do seu contato (LGPD).

## 8. Limitações e o que depende de acesso externo

- **E-mail real:** depende do servidor SMTP do órgão (host, remetente e, se exigido, usuário e senha). O cliente foi testado contra um servidor SMTP local simulado; falta o teste no SMTP institucional.
- **SEI real:** depende do web service do SEI do órgão (cadastro do sistema e do serviço pelo administrador do SEI) e de outra fase. Hoje o driver é simulado.
- **gov.br real:** depende de adesão do órgão ao serviço de notificações do gov.br (SGD/MGI) ou da contratação do Notifica.br (Serpro), e das credenciais. Hoje o driver é simulado.
- **Avisos obrigatórios:** a lista adotada (ocorrência e faixa de 30 dias) precisa de confirmação do cliente.
- **Ligação com a fila RabbitMQ (frente B):** fica para a integração. A tabela `notificacoes_envios` já é a saída durável.
- Os modelos de mensagem são fixos no domínio, sem edição pela interface nesta entrega.
