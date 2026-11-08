# Frente U — Gestão compartilhada com a sociedade e catálogo de dados abertos (F28)

Entrega da frente U: o canal de gestão compartilhada com a sociedade do art. 174, § 3º, VI, da Lei 14.133/2021 (alíneas "a" a "d"), com o acompanhamento da execução por imagem e vídeo do art. 19, III, e o catálogo público de dados abertos.

## 1. O que foi feito (F28)

### Perfil "cidadão" e identificação pelo gov.br

- Perfil novo **Cidadão** (`cidadao`), sem nenhum acesso interno. A única permissão é `sociedade:manifestar`: enviar e acompanhar as próprias manifestações.
- A identificação é o **Login Único gov.br** que já existia (OIDC com PKCE):
  - o botão **Entrar com gov.br para enviar**, na página pública do contrato, chama `GET /api/v1/sessao/govbr/cidadao?retorno=…`;
  - essa rota grava a intenção num cookie assinado, de 10 minutos, e segue o fluxo normal do gov.br;
  - no retorno, um CPF sem usuário interno vira conta no perfil cidadão, sem UASG e sem senha. O cadastro vai para a trilha com o CPF mascarado (`sociedade.cidadao.cadastrar`);
  - sem a intenção, o CPF desconhecido continua recusado, como antes;
  - o retorno só aceita a página de um contrato ou "Minhas manifestações", para evitar redirecionamento aberto.
- O nome e o e-mail vêm das claims `name` e `email` do id_token. Sem e-mail, ou com e-mail já usado, a conta recebe um endereço técnico não roteável.
- Em demonstração há a conta `cidadao@agora.demo`, com a senha das demais contas, porque o gov.br não está configurado nesse ambiente.

### RF-37 — Gestão compartilhada com a sociedade

**(a) Mensagem de texto ou imagem do interessado identificado**

- O cidadão escreve de 20 a 2.000 caracteres, escolhe o assunto e pode anexar uma imagem.
- O texto público sai com CPF, e-mail e telefone tarjados (`tarjarDadosPessoaisLivres`). A tarja pega também CPF sem pontuação, quando os dígitos verificadores conferem, e telefone sem parênteses. O autor vê o próprio texto original.
- A imagem:
  - é aceita só em PNG ou JPEG, até 5 MB, e o tipo é conferido pelo conteúdo, nunca pela extensão;
  - perde os metadados antes de ser guardada (`apps/api/src/compartilhado/midia.ts`). No JPEG saem os segmentos EXIF (com GPS), XMP, IPTC e os comentários; no PNG, os blocos eXIf, tEXt, zTXt, iTXt e tIME;
  - passa pelo antivírus do órgão, quando configurado, e fica no armazenamento da frente D, endereçada pelo SHA-256.
- **Moderação:** nada é publicado sem a decisão de um moderador (permissão `sociedade:moderar`, perfil gestor de contratos), que publica ou recusa sempre com motivo de 10 a 500 caracteres.
  - A decisão é única: um segundo moderador recebe conflito.
  - O motivo vai para a trilha e é mostrado ao autor.
- **Em público,** o autor aparece só com o primeiro nome e as iniciais (`nomePublicoCidadao`).
- **Limite contra abuso:** 10 manifestações por cidadão em 24 horas.

**(b) Acompanhamento da execução com imagem e vídeo (art. 19, III)**

- O fiscal ou o gestor (permissão `sociedade:registrar`, escopo de UASG do contrato) publica fotos (JPEG ou PNG) e vídeos (MP4 ou MOV de celular). Cada registro tem título, descrição e o dia em que foi feito.
- O vídeo tem as caixas `udta`, `meta` e `uuid` (onde ficam GPS, aparelho e XMP) zeradas e renomeadas para `free`. Os tamanhos não mudam, então o vídeo continua tocável.
- Usa o armazenamento da frente D, com SHA-256 e conferência de integridade a cada leitura. O mesmo arquivo não entra duas vezes no contrato.
- **Ponto de checagem do sigilo** (`avaliarPublicacaoRegistroExecucao`): o registro marcado como contendo elemento sigiloso (art. 13) fica guardado e **não é publicado**, com o motivo registrado. A função já recebe `classificacaoSigilosa`; quando a frente R entrar, basta passar a classificação do documento no lugar do `false` fixo em `apps/api/src/modulos/sociedade/rotas.ts`.

**(c) Comunicação entre a população, a Administração e o contratado**

- **Respostas identificadas** (permissão `sociedade:responder`: gestor e fiscal):
  - da Administração, com o nome abreviado e a função (gestor do contrato, fiscal do contrato ou o perfil do servidor);
  - do contratado, registrada pelo servidor com o nome do preposto (art. 118), também abreviado.
- **Prazo de resposta:** 30 dias do recebimento, prorrogável uma vez por igual período (`prazoRespostaManifestacao`). A situação do prazo (`situacaoPrazoResposta`) aparece em cada manifestação: aguardando, vence em breve (últimos 5 dias), vencido, respondida no prazo ou fora dele.

**(d) Relatório final**

- O gestor (permissão `sociedade:relatorio_final`) publica, **só a partir do fim da vigência**, o relatório final (`validarRelatorioFinal`), com:
  - os objetivos que justificaram a contratação;
  - os resultados alcançados;
  - a conclusão: objetivos atingidos, parcialmente atingidos ou não atingidos.
- Os dados da execução ficam congelados no relatório: vigência, valor global, valor pago, número de aditivos, manifestações e registros publicados.
- O relatório tem SHA-256 do conteúdo e só pode ser publicado uma vez por contrato.

**Auditoria:** toda escrita grava evento na trilha encadeada por hash, na mesma transação: envio, anexo de imagem, publicação, recusa, resposta, registro publicado ou retido por sigilo, recusa do antivírus e relatório final.

### RF-38 — Catálogo de dados abertos

- **Página pública "Dados abertos"** (`/dados-abertos`), sem login, com link no rodapé e na Transparência.
- **Conjuntos**, cada um em CSV e JSON:

  | Conjunto | Conteúdo |
  |---|---|
  | Editais publicados | Licitações com edital divulgado |
  | Contratos | Valores inicial, global e pago; vigência e divulgação no PNCP |
  | Atas de registro de preços | Vigência, valor registrado e aceite de adesão |
  | Termos aditivos | Valor, nova vigência e justificativa |
  | Pagamentos na ordem cronológica | Por fonte de recursos, com a posição na fila das notas não pagas (art. 141, § 3º) |
  | Sanções aplicadas | Tipo, inciso da infração, multa, vigência e registro no CEIS/CNEP |

  O plano de contratações anual (PCA) **não existe na `integracao`**. O catálogo o lista como "conjunto previsto", com o motivo.
- **Cada conjunto traz:**
  - dicionário de dados (nome, tipo e descrição de cada coluna);
  - licença aberta (CC BY 4.0);
  - data da última alteração dos dados;
  - periodicidade ("contínua": gerado da base no momento do download);
  - quantidade de registros e o SHA-256 e o tamanho de cada arquivo. O hash vai também no cabeçalho `X-Agora-SHA256` do download.
- **Formato do CSV:** RFC 4180, UTF-8, vírgula como separador, ponto decimal, datas AAAA-MM-DD e CRLF. Texto que viraria fórmula de planilha recebe apóstrofo. No JSON, os valores em reais vão como número.
- **Nenhum dado pessoal:**
  - fornecedor pessoa física sai sem CPF e com o nome mascarado;
  - servidores não aparecem;
  - o texto livre (justificativa de aditivo e outros) passa pela tarja de CPF, e-mail e telefone (`prepararLinhasDadosAbertos`);
  - a sanção sai sem o relato.
- **Limite de requisições** próprio, por IP: `AGORA_DADOS_ABERTOS_LIMITE_MINUTO`, padrão 60 por minuto. Acima dele, 429 `LIMITE_REQUISICOES`.

### Interface

- **Página pública do contrato** (`/transparencia/contratos/:id`), com quatro seções novas:
  - acompanhamento da execução (galeria de fotos e vídeos);
  - manifestações da sociedade, com as respostas e o prazo;
  - enviar manifestação: formulário para o cidadão; para quem não entrou, o botão do gov.br ou, em demonstração, o link para a tela de entrada;
  - relatório final.
- **Gestão compartilhada** (`/sociedade`, menu "Sociedade"): fila de moderação filtrada por situação, busca de contrato para abrir o painel, botões **Publicar**, **Não publicar** e **Responder** com diálogos.
- **Painel do contrato** (`/sociedade/contratos/:id`):
  - **Publicar foto ou vídeo**, com a opção "contém elemento sigiloso";
  - manifestações do contrato;
  - formulário do relatório final, a partir do fim da vigência.
- **Minhas manifestações** (`/sociedade/minhas-manifestacoes`): situação, motivo da moderação e respostas.
- Telas novas no Modo Especificação: `sociedade`, `sociedade.contrato`, `sociedade.minhas` e `dados-abertos`.

### Seed

- `apps/api/src/seed/sociedade.ts`, com PRNG próprio e como última etapa:
  - contas `cidadao@agora.demo` (perfil cidadão) e `fiscal.obras@agora.demo` (fiscal, todas as UASGs);
  - uma manifestação publicada e respondida pelo gestor;
  - uma manifestação aguardando moderação;
  - um relatório final num contrato encerrado.
- Textos e nomes sintéticos. O seed não grava arquivos.

## 2. Linhas da conversa atendidas

- **75:** sincronização com o Portal de Dados Abertos. Atendida pelo catálogo público legível por máquina; o registro no dados.gov.br fica nas limitações.
- **327:** dados em formato aberto e interoperabilidade.
- **404:** consulta pública sem registro nem identificação prévia. O catálogo e a consulta às manifestações não pedem login.
- **1148 e 1825:** canal de gestão compartilhada (mensagens e imagens do cidadão) e relatório final de consecução dos objetivos.
- **1575 a 1595,** em especial **1589:** as quatro alíneas da interface pública de gestão compartilhada (a, b, c e d).
- **1689:** login único gov.br para a identificação do interessado.

## 3. Equivalentes lícitos adotados

- **Publicação após moderação, e não imediata.** A alínea "a" fala em divulgação das mensagens. Publicar automaticamente o que qualquer pessoa envia exporia dados pessoais de terceiros, ofensas e conteúdo ilícito. Por isso a publicação depende de decisão humana com motivo, o texto público é tarjado (LGPD, art. 6º, III) e o autor recebe o motivo da recusa.
- **Autor só com o primeiro nome e as iniciais.** A identificação prévia é exigida, mas a divulgação do nome completo do cidadão não é necessária ao fim. A identidade completa fica na conta e na trilha de auditoria (LGPD, art. 6º, III).
- **Resposta do contratado registrada pela Administração.** O contratado não tem conta na Ágora. O servidor registra a resposta enviada pelo contratado, identificando o preposto (art. 118). O servidor que registrou fica na trilha e aparece na resposta.
- **Prazo de resposta de 30 dias, prorrogável uma vez.** O art. 174 não fixa prazo. Adotado o da Lei 13.460/2017, art. 16, por analogia ao canal de ouvidoria.
- **Imagem e vídeo sem localização.** A exigência de remover os metadados (LGPD) vale também para os registros da fiscalização, que podem revelar o aparelho e o trajeto do servidor.
- **Fornecedor pessoa física sem CPF nos dados abertos** e com o nome mascarado, como na Transparência que já existia. O CNPJ e a razão social de pessoa jurídica saem completos.

## 4. Regras novas

- **RF-37 — Gestão compartilhada com a sociedade** (etapa 7; telas `sociedade`, `sociedade.contrato` e `sociedade.minhas`). Funções do domínio:
  - `validarManifestacao`, `validarDecisaoModeracao`, `validarResposta`;
  - `prazoRespostaManifestacao`, `situacaoPrazoResposta`;
  - `avaliarPublicacaoRegistroExecucao`, `validarRelatorioFinal`;
  - `nomePublicoCidadao`, `tarjarDadosPessoaisLivres`.
- **RF-38 — Catálogo de dados abertos** (tela `dados-abertos`). Funções do domínio: `gerarCsvDadosAbertos`, `prepararLinhasDadosAbertos`, `centavosParaDecimal` e `contemDadoPessoal`.
- Arquivos novos no domínio: `packages/dominio/src/lei14133/gestao-compartilhada.ts`, `packages/dominio/src/dados-abertos.ts` e `packages/dominio/src/privacidade.ts`, com testes em `packages/dominio/test/`.

## 5. Rotas novas (`/api/v1`)

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /publico/contratos/:id/gestao-compartilhada` | sem login | Manifestações publicadas com as respostas, registros publicados e relatório final |
| `GET /publico/contratos/:id/manifestacoes/:manifestacaoId/imagem` | sem login | Imagem já sem metadados, só de manifestação publicada |
| `GET /publico/contratos/:id/registros/:registroId/midia` | sem login | Foto ou vídeo publicado (o retido por sigilo responde 404) |
| `GET /sessao/govbr/cidadao?retorno=` | sem login | Marca o login do cidadão e segue para o gov.br |
| `POST /sociedade/contratos/:id/manifestacoes` | `sociedade:manifestar` | Envia a manifestação (201, aguardando moderação) |
| `POST /sociedade/manifestacoes/:id/imagem` | `sociedade:manifestar` | Anexa a imagem (só o autor, só em moderação; corpo binário) |
| `GET /sociedade/minhas-manifestacoes` | `sociedade:manifestar` | Manifestações do próprio cidadão |
| `GET /sociedade/manifestacoes?situacao&contratoId` | `sociedade:ler` | Fila de moderação no escopo de UASG |
| `GET /sociedade/manifestacoes/:id/imagem` | `sociedade:ler` | Imagem para a moderação |
| `POST /sociedade/manifestacoes/:id/moderacao` | `sociedade:moderar` | Publica ou recusa, com motivo |
| `POST /sociedade/manifestacoes/:id/respostas` | `sociedade:responder` | Resposta da Administração ou do contratado |
| `GET /sociedade/contratos/:id` | `sociedade:ler` | Painel do contrato |
| `POST /sociedade/contratos/:id/registros?titulo&descricao&registradoEm&sigiloso` | `sociedade:registrar` | Foto ou vídeo da execução (corpo binário) |
| `GET /sociedade/contratos/:id/registros/:registroId/midia` | `sociedade:ler` | Arquivo do registro, inclusive o retido |
| `POST /sociedade/contratos/:id/relatorio-final` | `sociedade:relatorio_final` | Relatório final, após o fim da vigência |
| `GET /publico/dados-abertos` | sem login, com limite | Catálogo |
| `GET /publico/dados-abertos/:conjunto` | sem login, com limite | Metadados e dicionário de um conjunto |
| `GET /publico/dados-abertos/:conjunto/csv` e `/json` | sem login, com limite | Arquivos |

**Permissões novas**, no fim de `TODAS_PERMISSOES`: `sociedade:ler`, `sociedade:manifestar`, `sociedade:moderar`, `sociedade:responder`, `sociedade:registrar` e `sociedade:relatorio_final`. Por perfil:

- gestor de contratos: ler, moderar, responder, registrar e relatório final;
- fiscal: ler, responder e registrar;
- controle interno: ler;
- auditor: ler, pela regra das permissões `:ler`;
- cidadão: só manifestar;
- administrador: todas.

**Migração:** `030_gestao_compartilhada_dados_abertos.sql`. Acrescenta o perfil `cidadao` à lista aceita, preservando os perfis de outras migrações, e cria as tabelas `sociedade_manifestacoes`, `sociedade_respostas`, `sociedade_registros_execucao` e `sociedade_relatorios_finais`.

**Alterações mínimas em código de outras frentes:**

- `autenticacao/govbr.ts` devolve também `nome` e `email` das claims;
- `sessao/rotas.ts` cria a conta de cidadão no retorno quando há a intenção e volta ao caminho pedido;
- `paginas/publicas/TransparenciaContrato.tsx` ganhou uma linha que inclui as seções da gestão compartilhada;
- `paginas/publicas/Entrar.tsx`: o cidadão que entra sem destino vai para "Minhas manifestações", e não para o painel interno;
- `jornada/servico.ts` (servidores designáveis) e `impedimentos/rotas.ts` (agentes públicos para vínculos) excluem o perfil cidadão, que não é agente público;
- `apps/api/test/jornada.test.ts`: a contagem de servidores designáveis exclui o perfil cidadão;
- o módulo `publico/` não foi alterado: as rotas públicas novas ficam nos módulos `sociedade/` e `dados-abertos/`.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_DADOS_ABERTOS_LIMITE_MINUTO` | `60` | Downloads por minuto e por IP nas rotas do catálogo de dados abertos |

Reaproveitadas:

- `AGORA_GOVBR_*` (login do cidadão);
- `AGORA_ARQUIVOS_DIR` e `AGORA_ARQUIVOS_TAMANHO_MAXIMO_MB` (armazenamento e limite de fotos e vídeos; a imagem do cidadão tem teto próprio de 5 MB);
- `AGORA_ANTIVIRUS_URL` (antivírus dos arquivos enviados).

## 7. Seção pronta para o manual do usuário

> ## Gestão compartilhada com a sociedade
>
> A Lei 14.133/2021 (art. 174, § 3º, VI) prevê que a sociedade acompanhe os contratos: o cidadão envia mensagens e imagens, a fiscalização publica fotos e vídeos da obra ou do serviço, a Administração e o contratado respondem, e o relatório final mostra se os objetivos da contratação foram alcançados.
>
> **Quem faz o quê:**
>
> - **cidadão** (identificado pelo gov.br, sem acesso às telas internas): envia mensagens e imagens e acompanha as próprias manifestações;
> - **gestor de contratos**: modera as manifestações, responde, publica fotos e vídeos e publica o relatório final;
> - **fiscal de contrato**: responde e publica fotos e vídeos;
> - **controle interno e auditor**: consultam;
> - **administrador**: tudo.
>
> ### Para o cidadão
>
> 1. Abra o contrato em **Transparência** e vá até **Enviar manifestação**.
> 2. Clique em **Entrar com gov.br para enviar**. Depois do login, você volta para a mesma página.
> 3. Escolha o assunto, escreva a mensagem (de 20 a 2.000 caracteres) e, se quiser, anexe uma imagem PNG ou JPEG de até 5 MB.
> 4. Clique em **Enviar manifestação**.
>
> A mensagem só aparece na página depois de aprovada pela moderação. Em público, o seu nome aparece só com o primeiro nome e as iniciais, e CPF, e-mail e telefone escritos no texto são tarjados. A localização e os dados do aparelho são retirados da imagem antes de ela ser guardada.
>
> Em **Minhas manifestações** você acompanha a situação, o motivo da moderação e as respostas. A Administração tem 30 dias para responder, prorrogáveis uma vez.
>
> ### Moderação e respostas
>
> A tela **Gestão compartilhada** (menu **Sociedade**) mostra as manifestações dos contratos das suas UASGs, começando pelas que aguardam moderação.
>
> - **Publicar** ou **Não publicar**: informe sempre o motivo. Ele fica na trilha de auditoria e o autor o vê. A decisão é única.
> - **Responder**: escolha se a resposta é da Administração (aparece o seu nome abreviado e a sua função) ou do contratado (informe o preposto que a enviou). A resposta é pública.
> - Cada manifestação mostra o prazo de resposta: aguardando, vence em breve, vencido, respondida no prazo ou fora dele.
>
> ### Fotos e vídeos da execução
>
> No painel do contrato (**Gestão compartilhada** → **Abrir um contrato**):
>
> 1. Clique em **Publicar foto ou vídeo**.
> 2. Escolha o arquivo (JPEG, PNG ou vídeo MP4) e informe o título, a descrição e o dia do registro.
> 3. Se a imagem mostrar elemento cujo sigilo seja imprescindível à segurança (art. 13), marque **Contém elemento sigiloso**. O registro fica guardado e não é publicado.
>
> A Ágora confere o tipo pelo conteúdo do arquivo, retira a localização e os dados do aparelho e registra o SHA-256.
>
> ### Relatório final
>
> A partir do fim da vigência, o gestor preenche, no painel do contrato, os objetivos que justificaram a contratação, os resultados alcançados e a conclusão, e clica em **Publicar relatório final**. O relatório é publicado uma única vez, com os dados da execução e o SHA-256, na página pública do contrato.
>
> ## Dados abertos
>
> A página **Dados abertos** (link no rodapé) oferece, sem login, os conjuntos de editais publicados, contratos, atas de registro de preços, termos aditivos, pagamentos na ordem cronológica e sanções aplicadas, em CSV e JSON.
>
> Cada conjunto mostra:
>
> - o dicionário de dados;
> - a licença (CC BY 4.0: basta citar a fonte);
> - a data da última atualização e a periodicidade;
> - o número de registros;
> - o SHA-256 de cada arquivo, para conferir a integridade.
>
> Nenhum dado pessoal sai nos arquivos: o CPF de fornecedor pessoa física fica de fora e o nome aparece só com as iniciais. Cada endereço aceita um número limitado de downloads por minuto.

## 8. Limitações e o que depende de acesso externo

- **Conferência da lei:** o planalto.gov.br bloqueou o acesso automatizado nesta sessão, e as fontes alternativas não responderam.
  - Conferidos: as alíneas "a" a "d" do art. 174, § 3º, VI, pelo texto transcrito na conversa do cliente (linha 1589); e, em regulamento estadual, a ligação com o sistema de acompanhamento de obras do art. 19, III.
  - Citados de memória, a reconferir no Planalto: art. 141, § 3º (divulgação mensal da ordem cronológica), art. 118 (preposto), Lei 12.527/2011, art. 8º, e Lei 13.460/2017, art. 16.
- **Login gov.br real:** depende do credenciamento do órgão no Login Único (`AGORA_GOVBR_*`). Sem ele, o cidadão real não consegue entrar; em demonstração vale a conta `cidadao@agora.demo`.
- **Aviso ao cidadão:** ele não é avisado por e-mail da moderação nem da resposta e acompanha tudo em "Minhas manifestações". A ligação com a central de notificações da frente J fica para depois.
- **Vídeo:**
  - só MP4 e MOV (ISO-BMFF), sem conversão de formato;
  - sem legendas: a descrição textual acompanha cada registro;
  - sem download parcial (Range); o limite de tamanho é o geral de arquivos.
- **Fotos JPEG:** a orientação gravada no EXIF é retirada junto com os demais metadados, e uma foto de celular pode aparecer girada.
- **Sigilo:** hoje o ponto de checagem usa a marcação do fiscal. A classificação formal de documentos (frente R) entra no mesmo ponto quando estiver na `integracao`.
- **PCA:** ausente na `integracao`; o conjunto entra no catálogo quando o módulo existir.
- **Portal de Dados Abertos (dados.gov.br):** o cadastro do catálogo depende de credencial do órgão no portal. As rotas são legíveis por máquina e podem ser coletadas pelo portal; a publicação automática lá não foi feita.
- **Moderação:** feita pelo gestor de contratos. Se o órgão quiser a ouvidoria como moderadora, basta conceder `sociedade:moderar` ao perfil correspondente.
