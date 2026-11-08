# Entrega da frente T — integração com o SEI, assinatura no SEI e publicação no DOU (F12 e o DOU da F11)

Regras novas: **RF-35** (SEI) e **RF-36** (DOU). Migração: `029_sei_dou.sql`. e2e: `e2e/testes/sei-dou.spec.ts` (porta 3120).

## 1. O que foi feito

### F12 — integração com o SEI e assinatura no SEI (RF-35)

**Pesquisa.** A integração segue o manual oficial **"SEI WebServices" v4.0** (seções 1 a 3):

- serviço SOAP 1.1 no estilo RPC/encoded, namespace `Sei`, SOAPAction `SeiAction`;
- endereço do serviço `…/sei/ws/SeiWS.php` (o WSDL fica em `…/sei/controlador_ws.php?servico=sei`);
- autenticação pela sigla do sistema e pela chave de acesso do serviço (`IdentificacaoServico`), geradas pelo administrador do SEI em Administração › Sistemas;
- o manual avisa que a autenticação por endereço será removida; por isso a Ágora usa só a chave de acesso.

**Conector** (`apps/api/src/integracoes/sei.ts`), com timeout por requisição e as operações:

| Operação do SeiWS | Uso na Ágora |
|---|---|
| `gerarProcedimento` | Gera o processo no SEI, com o tipo de processo configurado e a especificação do processo da Ágora |
| `incluirDocumento` | Inclui cada documento aprovado como documento externo (tipo "R"), em PDF (base64) |
| `gerarBloco` | Monta o bloco de assinatura (tipo "A") com os documentos incluídos e o disponibiliza à unidade de destino |
| `enviarProcesso` | Envia o processo à unidade de destino, mantendo-o aberto na unidade geradora |
| `consultarDocumento` | Lê as assinaturas (`SinRetornarAssinaturas=S`): nome, cargo ou função e data e hora |

Detalhes do conector:

- O envelope vai em ISO-8859-1, como no exemplo do manual. Caracteres fora do Latin-1 viram referências numéricas.
- A resposta é lida no charset declarado.
- O XML é lido por um leitor próprio, sem dependência nova, que recusa DOCTYPE (proteção contra XXE).
- **SOAP Fault é recusa do SEI** (acesso negado, tipo de documento não liberado, processo inexistente): falha definitiva, que vai direto para a fila de erro.
- **Rede, tempo esgotado e HTTP 5xx sem Fault** são transitórios: nova tentativa automática.

**Tudo pela fila da frente B.** Há dois tipos novos de tarefa: `sei.envio` e `sei.assinaturas`.

- **`sei.envio`** executa os passos em ordem:
  1. gera o processo (se ainda não existe);
  2. inclui os documentos aprovados que ainda não estão no SEI;
  3. monta o bloco de assinatura;
  4. se configurado, envia o processo à unidade de destino.

  A prova de cada passo é gravada logo depois da resposta do SEI. Se a execução cair no meio, a nova tentativa continua de onde parou: o processo não é gerado de novo e o documento não é incluído duas vezes.
- **Chaves de idempotência** `sei:envio:<processo>:<n>` e `sei:assinaturas:<processo>:<n>` (helper `apps/api/src/fila/pedido-repetivel.ts`):
  - pedido com tarefa ainda na fila não duplica;
  - tarefa na fila de erro é reaberta (reprocessamento auditado);
  - pedido novo cria a tarefa seguinte.
- **O que fica guardado:**
  - o processo, com o número do processo SEI (`ProcedimentoFormatado`), o id interno e o link de acesso;
  - cada documento, com o número SEI (`DocumentoFormatado`), o link, o hash SHA-256 do PDF enviado, o nível de acesso e o número do bloco.
- **Assinatura refletida.**
  - A consulta grava as assinaturas devolvidas pelo SEI.
  - O documento da árvore do processo passa a "Assinado", com quem assinou (nome e cargo) e quando (horário de Brasília convertido para UTC).
  - O signatário pode não ser usuário da Ágora: o nome fica em `processos_arvore_sei.assinado_por_nome`.
  - A trava RIA-02 (DFD assinado para sair da etapa 2) passa a valer também para a assinatura feita no SEI.
- **Nível de acesso** (`nivelAcessoSei`):
  - documento com dado pessoal (CPF ou e-mail no texto) entra como **restrito** (LAI, art. 31);
  - peça de processo com orçamento sigiloso também entra como restrito (art. 24); o edital é a exceção;
  - os demais documentos seguem o nível sugerido pelo tipo de processo no SEI;
  - a hipótese legal é configurável.
- **Modo offline (padrão), com simulação determinística:**
  - o processo recebe no SEI o mesmo número que já tem na Ágora, e cada documento, o número da árvore;
  - na primeira consulta, o documento aparece assinado pelo servidor designado no processo para aquele documento (ou por quem o aprovou), ou com a assinatura simulada que já existia na árvore;
  - nada sai do servidor, e a tela informa que é simulação.
- **Com o SEI real (`AGORA_INTEGRACOES=online`),** a assinatura simulada da Ágora (`POST /processos/:id/sei/assinar`) é recusada (422). A assinatura passa a ser só a do SEI.

**Telas:**

- **Processo** (coluna lateral, "Árvore do processo SEI"):
  - novo painel **Integração com o SEI**, com o número do processo no SEI (copiar e "Abrir no SEI"), documentos enviados e aguardando assinatura, bloco de assinatura e unidade de destino;
  - a situação do envio e da consulta na fila (nova tentativa ou fila de erro, com o motivo);
  - os botões **Enviar ao SEI** e **Consultar assinaturas**;
  - cada documento da árvore mostra o seu número SEI.
- **Documento** (lista de documentos da etapa): número SEI e situação da assinatura no SEI ("Assinado no SEI por … em …" ou "Aguardando assinatura no SEI"). O documento aprovado que ainda não está no SEI tem o botão **Enviar ao SEI**.

**Canal SEI das notificações** (frente J). O driver real `driverSeiWebservice` (`notificacoes/canais.ts`) usa o conector:

- O aviso vira um documento externo em PDF, incluído no processo SEI do instrumento.
- O protocolo do envio é o número do documento no SEI.
- Recusa do SEI é falha permanente; indisponibilidade segue as novas tentativas da central.
- Liga com `AGORA_NOTIFICACOES_SEI=webservice`, que exige `AGORA_SEI_*`.
- O modo aparece como "SEI do órgão" na central.

### F11 — publicação no DOU (RF-36)

**Pesquisa.**

- **Envio.** A Imprensa Nacional recebe as matérias pelo **INCom** (Sistema de Envio Eletrônico de Matérias):
  - quem envia é um usuário cadastrado e certificado, com gerente INCom indicado por ofício (serviço "Publicar no Diário Oficial da União", gov.br);
  - **não há API pública de envio**: o INCom é um sistema web operado pelo servidor credenciado. O piloto de integração SEI–INCom anunciado em 2018 não tem documentação técnica pública.
- **Consulta.**
  - A busca pública do DOU (`in.gov.br/consulta/-/buscar/dou`) traz os resultados num JSON embutido na página. É o mesmo mecanismo do Ro-DOU, do MGI.
  - O INLABS (`inlabs.in.gov.br`) oferece o XML diário, mas exige login e só cobre os últimos meses.

**Equivalente lícito adotado**, como previsto na frente:

1. **Matéria no padrão de publicação** (`montarMateriaDou`), na Seção 3:
   - **aviso de licitação** (obrigatório, art. 54, § 1º), gerado **sozinho** quando o PNCP aceita o edital. É a "publicação em um clique" da conversa: inteiro teor no PNCP e extrato para o DOU;
   - **extrato de contrato** e **extrato de termo aditivo** (publicidade complementar, porque a eficácia vem do PNCP, art. 94).

   O cabeçalho é o órgão e a unidade da UASG do ato. O CPF de contratado pessoa física sai mascarado (`***.456.789-**`). O rascunho pode ser refeito com os dados atuais até o envio; depois disso o texto não muda.
2. **Envio registrado com protocolo.** O servidor copia o texto, envia pelo INCom e registra na Ágora o protocolo e a data e hora do envio. A Ágora calcula a **edição prevista** (`dataPrevistaPublicacaoDou`): a matéria recebida até o fechamento do dia útil sai no dia útil seguinte. O fechamento padrão é às 19h e é configurável.
3. **Conferência no servidor, pela fila** (tarefa `dou.conferencia`):
   - **online:** busca na consulta pública do DOU, Seção 3, pelo número do processo, entre o envio e hoje, e confere o ato com `localizarMateriaDou` (mesmo tipo de ato, número do processo, data a partir do envio). Encontrada, grava a data, a edição, a página e o endereço da matéria em in.gov.br;
   - **offline:** a matéria aparece publicada na edição prevista, a partir do dia dela, com edição e página simuladas;
   - matéria não localizada não é erro: o resultado fica registrado e a conferência pode ser repetida.
4. **Registro manual da edição** (data, edição, página e endereço em in.gov.br), para quando a consulta pública não estiver disponível.
5. **Jornal diário de grande circulação** (art. 54, § 1º): o registro do nome do jornal e da data acompanha o aviso de licitação.

**Situação "Diário Oficial da União" da etapa 5.**

- Antes desta frente, ela passava a "Publicado" junto com o PNCP, de forma simulada.
- Agora fica **"Na fila de envio"** até o aviso de licitação ter a publicação conferida ou registrada, e só então passa a **"Publicado"**.
- Mudanças em código de outras frentes:
  - em `publicacao-pncp/tarefas.ts`, uma linha e a chamada que gera o aviso;
  - em `apps/api/test/jornada.test.ts`, a asserção `pub.dou` passou de `'publicado'` para `'na_fila'`.

**Tela nova:** **Publicações no DOU** (menu Publicações; rota `/publicacoes-dou`; tela `publicacoes.dou`). Ela traz:

- a situação: a enviar pelo INCom, aguardando publicação, publicadas e avisos pendentes;
- os filtros por tipo e situação e a tabela das matérias;
- **Gerar matéria**, com o tipo e o ato (processo com edital publicado, contrato ou aditivo);
- o detalhe de cada matéria:
  - o texto, com botão de copiar para colar no INCom, o fundamento e a obrigatoriedade;
  - **Refazer com os dados atuais**, **Registrar envio pelo INCom**, **Conferir no DOU**, **Registrar publicação** e **Registrar publicação em jornal**.

**Carga de demonstração** (`apps/api/src/seed/sei-dou.ts`, semente própria):

- os editais já publicados no PNCP ganham o aviso enviado (protocolo sintético), conferido na edição simulada e registrado em jornal sintético;
- o contrato mais recente ganha o extrato enviado, aguardando a conferência;
- um aditivo ganha o extrato em rascunho;
- o processo mais adiantado aparece no SEI simulado, com o bloco de assinatura e as assinaturas refletidas.

## 2. Linhas da conversa atendidas

| Linhas | Pedido | Onde está |
|---|---|---|
| 318 e 1689 (RNF-02) | Atos nativamente digitais e assinatura qualificada ICP-Brasil (art. 12, VI) | Assinatura no SEI, com o certificado do servidor, refletida na Ágora (RF-35) |
| 327 | Integração com o DOU e com o SEI/MJSP, em dados abertos | Conector SeiWS e conferência na consulta pública do DOU, só no servidor |
| 512 (R02) | Validação humana obrigatória antes da assinatura ICP-Brasil | Só documento **aprovado** na Ágora (revisão humana registrada) vai ao SEI; quem assina é o servidor, no SEI |
| 524 (R04) | Indisponibilidade ou mudança abrupta das APIs externas (DOU) | Fila com nova tentativa e fila de erro; Fault do SEI e mudança na página do DOU viram falha definitiva visível; registro manual como contingência |
| 1784 (Etapa 2) | Árvore do processo SEI com protocolo `08000.XXXXXX/2026-XX`, números de documentos SEI, status da assinatura ICP-Brasil e envio automático de blocos de assinatura | Painel e árvore com o número do processo e dos documentos no SEI, situação da assinatura e bloco de assinatura gerado no envio; NUP validado pela Portaria Interministerial nº 11/2019 |
| 864 e 1810 (contexto, F11) | Extrato do edital no DOU e em jornal (art. 54, § 1º) e "Central de Publicação em 1 Clique" | Aviso de licitação gerado ao publicar no PNCP; registro do jornal |

## 3. Equivalentes lícitos e motivo

- **Assinatura ICP-Brasil dentro da Ágora → assinatura no SEI, refletida na Ágora** (decisão já registrada na rastreabilidade). Assinar no navegador exigiria componente de terceiros (assinador ou extensão), vedado pela regra 4. No SEI, o servidor assina com o próprio certificado, e a Ágora só lê o resultado. A Ágora nunca assina em nome de ninguém.
- **Envio ao DOU → matéria pronta + envio registrado + conferência.** A Imprensa Nacional não oferece API pública de envio: o INCom exige usuário credenciado e certificado. Automatizar o envio seria operar o sistema web com a credencial pessoal do servidor, o que é inviável e indevido. O ganho do cliente vem de:
  - texto já no padrão;
  - protocolo e edição prevista registrados;
  - conferência automática da publicação na consulta pública, no servidor;
  - pendência visível na tela e na etapa 5.
- **Documento externo (PDF) no SEI.** A frente pediu os PDFs da Ágora. No SEI, documento externo é autenticado pelo servidor com o mesmo mecanismo de assinatura, e o resultado volta em `consultarDocumento`.
- **Extratos de contrato e de aditivo não obrigatórios.** Pela Lei 14.133/2021, a condição de eficácia é a divulgação no PNCP (art. 94). O extrato no DOU fica como publicidade complementar, conforme a norma interna do órgão, e a tela diz isso.

## 4. Regras novas (catálogo)

| Código | Título | Implementação |
|---|---|---|
| RF-35 | Integração com o SEI e assinatura refletida (tela `jornada.detalhe`) | `digitosVerificadoresNup`, `formatarNup`, `validarNup`, `nivelAcessoSei`, `dataHoraSeiParaIso`, `dataHoraSei`, `situacaoAssinaturaSei`; rotas `/processos/:id/sei*` |
| RF-36 | Publicação no Diário Oficial da União (etapa 5; telas `publicacoes.dou` e `jornada.detalhe`) | `montarMateriaDou`, `dataPrevistaPublicacaoDou`, `localizarMateriaDou`; rotas `/publicacoes-dou*` |

Funções novas do domínio: `packages/dominio/src/integracoes/sei.ts` e `packages/dominio/src/lei14133/dou.ts`, com testes em `packages/dominio/test/sei-dou.test.ts`. O NUP é testado com o exemplo do anexo da Portaria Interministerial nº 11/2019: 35041.000387/2000-19.

## 5. Rotas novas (`/api/v1`)

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /processos/:id/sei` | `jornada:ler` | Processo e documentos no SEI, assinaturas, tarefas da fila |
| `POST /processos/:id/sei/enviar` | `jornada:editar` | Enfileira `sei.envio` (gera o processo, inclui os documentos, bloco, unidade de destino); 422 se não houver nada a enviar ou se o SEI não estiver configurado (online) |
| `POST /processos/:id/sei/consultar-assinaturas` | `jornada:editar` ou `jornada:aprovar_juridico` | Enfileira `sei.assinaturas` e reflete as assinaturas na árvore |
| `GET /publicacoes-dou/resumo` | `jornada:ler` ou `contratos:ler` | Contagens por situação e avisos pendentes |
| `GET /publicacoes-dou?tipo&situacao&processoId&pagina&tamanhoPagina` | idem | Matérias visíveis: avisos com `jornada:ler`, extratos com `contratos:ler`; escopo de UASG |
| `GET /publicacoes-dou/candidatos?tipo` | idem | Editais publicados, contratos ou aditivos que podem gerar matéria |
| `GET /publicacoes-dou/:id` | idem | Uma matéria |
| `POST /publicacoes-dou` | aviso: `jornada:publicar`; extratos: `contratos:editar` | Gera a matéria ou refaz o rascunho |
| `POST /publicacoes-dou/:id/envio` | idem | Protocolo do INCom e edição prevista |
| `POST /publicacoes-dou/:id/conferir` | idem | Enfileira `dou.conferencia` |
| `POST /publicacoes-dou/:id/publicacao` | idem | Registro manual da edição (endereço só em in.gov.br) |
| `POST /publicacoes-dou/:id/jornal` | `jornada:publicar` | Publicação do aviso em jornal (art. 54, § 1º) |

**Alterada:** `POST /processos/:id/sei/assinar` (simulação) responde 422 com `AGORA_INTEGRACOES=online`.

**Sem permissão nova**: as rotas usam as permissões existentes da jornada e dos contratos.

**Trilha de auditoria:**

- `processo.sei.enviar`, `sei.enviar`, `processo.sei.consultar_assinaturas` e `sei.assinaturas.consultar`;
- `dou.materia.gerar`, `dou.materia.refazer`, `dou.materia.enviar`, `dou.materia.conferir`, `dou.conferir`, `dou.materia.publicacao` e `dou.materia.jornal`;
- o evento `pncp.publicar` passou a registrar o aviso gerado.

**Migração `029_sei_dou.sql`:**

- tabelas `sei_processos`, `sei_documentos` e `dou_materias`;
- coluna `processos_arvore_sei.assinado_por_nome`;
- novos tipos de tarefa no CHECK de `fila_tarefas.tipo`;
- modo `webservice` em `notificacoes_envios.modo`.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_SEI_URL` | — | Endereço do serviço (`https://sei.orgao.gov.br/sei/ws/SeiWS.php`) |
| `AGORA_SEI_SIGLA_SISTEMA` | — | Sigla do sistema cadastrado no SEI |
| `AGORA_SEI_IDENTIFICACAO_SERVICO` | — | Chave de acesso do serviço (segredo, só no servidor) |
| `AGORA_SEI_ID_UNIDADE` | — | Unidade do SEI onde os processos são gerados |
| `AGORA_SEI_ID_TIPO_PROCEDIMENTO` | — | Tipo de processo no SEI |
| `AGORA_SEI_ID_SERIE` | — | Tipo de documento externo para os PDFs |
| `AGORA_SEI_ID_UNIDADE_DESTINO` | — | Opcional: unidade para onde o processo é enviado e onde o bloco é disponibilizado |
| `AGORA_SEI_ID_HIPOTESE_LEGAL` | — | Opcional: hipótese legal dos documentos restritos |
| `AGORA_SEI_BLOCO_ASSINATURA` | `true` | Monta o bloco de assinatura no envio |
| `AGORA_SEI_TIMEOUT_MS` | `60000` | Tempo limite por requisição ao SEI |
| `AGORA_NOTIFICACOES_SEI` | `simulado` | Novo valor `webservice`: canal SEI das notificações pelo SeiWS |
| `AGORA_DOU_CONSULTA_URL` | `https://www.in.gov.br/consulta/-/buscar/dou` | Consulta pública do DOU (servidor) |
| `AGORA_DOU_HORA_FECHAMENTO` | `19` | Fechamento do INCom (hora de Brasília) para a edição prevista |
| `AGORA_DOU_TIMEOUT_MS` | `20000` | Tempo limite da consulta do DOU |

Regras de validação:

- Os seis primeiros `AGORA_SEI_*` são definidos juntos (ou nenhum), e os ids são numéricos.
- O SEI real só é usado com `AGORA_INTEGRACOES=online`.
- Em modo online, sem a configuração, o envio é recusado com mensagem clara.

Todas as variáveis foram acrescentadas ao `.env.exemplo`.

## 7. Seção pronta para o manual do usuário

> ## Integração com o SEI
>
> **Quem usa:** quem edita a jornada (planejamento e agente de contratação) envia o processo ao SEI. Também consultam as assinaturas a assessoria jurídica e o administrador. Os demais perfis com acesso à jornada acompanham a situação.
>
> A assinatura dos documentos é feita **no SEI do órgão**, com o certificado digital ICP-Brasil (ou o login) do servidor. A Ágora não assina nada: ela envia os documentos aprovados, monta o bloco de assinatura e mostra quem assinou e quando.
>
> 1. Abra o processo. Na coluna da direita, em **Árvore do processo SEI**, veja o painel **Integração com o SEI**.
> 2. Clique em **Enviar ao SEI**. A Ágora:
>    - gera o processo no SEI, na primeira vez;
>    - inclui como PDF cada documento aprovado que ainda não está lá;
>    - monta o bloco de assinatura e, se o órgão tiver configurado, envia o processo à unidade responsável.
> 3. O painel mostra o **número do processo no SEI** (botão para copiar e link **Abrir no SEI**), quantos documentos já estão no SEI, o bloco de assinatura e a unidade de destino. Na árvore, cada documento mostra o seu **número SEI**.
> 4. Assine os documentos no SEI, pelo bloco de assinatura.
> 5. Volte à Ágora e clique em **Consultar assinaturas**. Cada documento assinado no SEI aparece como **Assinado**, com o nome e o cargo de quem assinou e a data e a hora. A etapa 2 só é concluída com o DFD assinado.
>
> Na lista de documentos de cada etapa, o documento aprovado mostra o número SEI e a situação da assinatura. Se ainda não foi enviado, o botão **Enviar ao SEI** aparece ali também.
>
> Documento com dado pessoal ou com o orçamento sigiloso entra no SEI como **restrito**.
>
> Se o SEI estiver fora do ar, a Ágora tenta de novo sozinha e o painel mostra **Aguardando nova tentativa**. Se o SEI recusar (por exemplo, tipo de documento não liberado para a Ágora), o painel mostra **Na fila de erro** com o motivo: corrija com o administrador do SEI e clique de novo em **Enviar ao SEI**. O envio continua de onde parou, sem duplicar o processo nem os documentos.
>
> Em demonstração, o SEI é simulado: o painel avisa, os números são os da própria Ágora e a assinatura aparece em nome do servidor designado para o documento.
>
> ## Publicações no DOU
>
> **Quem usa:**
>
> - o **agente de contratação** cuida do aviso de licitação e do registro em jornal;
> - o **gestor de contratos** cuida dos extratos de contrato e de termo aditivo;
> - os demais perfis com acesso à jornada ou aos contratos consultam, nas UASGs do seu escopo.
>
> A Imprensa Nacional recebe as matérias pelo **INCom**, com o usuário credenciado do servidor. A Ágora prepara o texto, guarda o protocolo do envio e confere a publicação.
>
> 1. **Aviso de licitação.** Quando o edital é aceito no PNCP, a Ágora gera sozinha o aviso de licitação, que é obrigatório no DOU e em jornal (art. 54, § 1º). Na etapa 5, o **Diário Oficial da União** fica como **Na fila de envio** até a publicação ser conferida.
> 2. **Extratos.** Em **Publicações no DOU**, clique em **Gerar matéria**, escolha **Extrato de contrato** ou **Extrato de termo aditivo** e o ato. O extrato complementa a divulgação no PNCP, que é a que dá eficácia ao contrato (art. 94).
> 3. Abra a matéria, confira o texto e use o botão de copiar para colar no INCom. O CPF de contratado pessoa física aparece mascarado. Se os dados mudaram antes do envio, use **Refazer com os dados atuais**.
> 4. Enviada a matéria pelo INCom, clique em **Registrar envio pelo INCom** e informe o **protocolo** e a **data e hora do envio**. A Ágora mostra a **edição prevista**: o dia útil seguinte para envio até as 19h de dia útil.
> 5. A partir da edição prevista, clique em **Conferir no DOU**. A Ágora consulta o Diário Oficial e, se encontrar a matéria, registra a data, a edição, a página e o link. Se ainda não encontrou, mostra **Ainda não localizada**; confira de novo mais tarde.
> 6. Se preferir, use **Registrar publicação** e informe a data, a edição, a página e, se quiser, o link da matéria em in.gov.br.
> 7. No aviso de licitação, use **Registrar publicação em jornal** para informar o jornal diário de grande circulação e a data.
>
> Tudo fica na trilha de auditoria. Em demonstração, a conferência é simulada: a matéria aparece publicada na edição prevista.

## 8. Limitações e o que depende de acesso externo

- **SEI real.** Depende do cadastro da Ágora no SEI do MJSP:
  - sistema, serviço e chave de acesso, com as operações gerar processo, incluir documento, consultar documento, gerar bloco, disponibilizar bloco e enviar processo liberadas;
  - os ids da unidade, do tipo de processo e do tipo de documento;
  - a liberação de rede da Ágora até o SEI.

  O teste contra o SEI de homologação não foi feito, por falta desse acesso. O conector foi testado com um SeiWS falso, no formato do manual v4.0. **Recomendação:** conferir o WSDL do SEI do órgão (`controlador_ws.php?servico=sei`) antes de ligar, porque os parâmetros variam entre versões do SEI.
- **Assinatura de documento externo.** O documento entra como externo (PDF) e é autenticado no SEI. Se o órgão preferir assinar no editor do SEI (documento gerado, tipo "G"), é preciso um tipo de documento interno e o envio do HTML. Não foi implementado.
- **Consulta das assinaturas sob demanda.** A consulta acontece quando o usuário pede. Não há varredura periódica.
- **Processo SEI único por processo da Ágora.** O número do processo SEI fica no painel e na trilha. O número próprio da Ágora (`numero_sei`) não muda: em produção, quem vale é o do SEI.
- **INCom.** Não há API pública de envio: o envio continua sendo feito pelo servidor credenciado, e a Ágora só registra o protocolo.
- **Consulta do DOU.** Usa a busca pública do portal da Imprensa Nacional (JSON embutido na página), que não é uma API documentada.
  - Mudança no formato vira falha definitiva visível, e o registro manual é a contingência.
  - Só a primeira página de resultados é lida, o que basta na busca exata pelo número do processo.
  - O acesso pela rede do servidor não foi testado: a chamada a partir deste ambiente foi recusada. A tela e a API foram testadas com respostas simuladas.
- **Edição prevista.** O fechamento às 19h é o informado em manuais de órgãos federais e é configurável. É previsão: quem confirma é a conferência.
- **Retificação.** Matéria enviada não muda. A retificação de matéria publicada não foi implementada.
- **Coordenação na integração:**
  - a migração 029 recria os CHECK `fila_tarefas_tipo_check` e `notificacoes_envios_modo_check`. Se outra frente da leva 2 também recriar esses CHECK, unir as listas;
  - o tipo `TipoTarefaFila` ganhou `sei.envio`, `sei.assinaturas` e `dou.conferencia`, e `ModoCanalNotificacao` ganhou `webservice`.
