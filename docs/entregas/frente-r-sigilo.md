# Frente R — sigilo de segurança pública (F25)

Entrega da frente R: classificação de sigilo do processo, dos documentos, dos anexos e do contrato; credenciamento e registro de acessos; tarja (marcação) dos PDFs; contrato sigiloso; cofre de anexos cifrados; carimbo de tempo da trilha de auditoria.

Regras novas: **RN-40**, **RF-33** e **RNF-09**. Migração: `apps/api/migracoes/027_sigilo_seguranca_publica.sql`.

## 1. O que foi feito (F25)

### Classificação de sigilo por processo e por documento (RN-40)

- **Alvos:** o processo inteiro, cada documento gerado na jornada (por tipo), cada anexo do processo e o contrato gerado.
- **Tipos de sigilo:**
  - **Informação classificada (LAI):**
    - grau reservado, secreto ou ultrassecreto;
    - hipótese do art. 23 (incisos I a VIII);
    - razões (30 a 2.000 caracteres);
    - data de produção da informação;
    - termo final por data ou por evento (art. 24, §§ 1º e 3º);
    - autoridade classificadora com nome, cargo e nível do art. 27.
  - **Sigilo do orçamento estimado (Lei 14.133, art. 24):** vale para documentos e anexos com o orçamento e as memórias de cálculo (art. 18, § 1º, VI).
- **Regras de domínio** (`packages/dominio/src/lei14133/sigilo.ts`, puras e testadas):
  - `validarClassificacaoSigilo` confere:
    - o prazo máximo do grau contado da produção (5, 15 e 25 anos);
    - a data final posterior a hoje;
    - prazo ou evento, um dos dois;
    - a competência da autoridade (art. 27): delegação só para secreto e ultrassecreto, com o ato de delegação (§ 1º);
    - no orçamento: exige a decisão de orçamento sigiloso na pesquisa de preços (etapa 3) e recusa o julgamento por maior desconto (art. 24, parágrafo único).
  - `classificacaoVigente`: passada a data final, ou o prazo máximo no termo por evento, a informação fica pública sozinha, sem escrita (LAI, art. 24, § 4º).
  - `decidirAcessoSigilo`: órgão de controle tem acesso irrestrito e registrado (Lei 14.133, art. 24, I, e art. 169, § 2º). Os demais precisam de credencial no processo: ativa, dentro da validade e com grau igual ou superior ao da informação (LAI, art. 25, § 1º; Decreto 7.845, art. 18). Todo acesso a informação classificada é registrado, inclusive o negado (Decreto 7.845, art. 38, § 4º).
  - `marcacaoSigilo` e `codigoIndexacaoSigilo` geram a marcação do documento e o código de indexação simplificado.
- **Classificação, reclassificação e desclassificação:**
  - Todas são auditadas: `sigilo.classificar`, `sigilo.reclassificar` e `sigilo.desclassificar`.
  - A reclassificação exige motivo e cria nova versão; a anterior fica no histórico.
  - As razões integram o termo de classificação e têm o mesmo sigilo: a trilha guarda só o hash do texto.
- **Decisão no servidor.** Dois pontos de checagem cobrem todas as rotas `/processos/:id…`, sem mexer nos módulos:
  - **processo classificado:** quem não tem credencial (ou perfil de controle) recebe 403, e a tentativa é registrada;
  - **documento classificado:** no detalhe do processo, o conteúdo é trocado por um aviso com a marcação; para quem tem acesso, a consulta é registrada (uma vez a cada 10 minutos por pessoa e documento).
- **Quem registra a classificação recebe credencial** no grau da classificação. A credencial automática aparece na lista e na trilha.

### Tarja e marcação

- **PDF marcado** (`POST /processos/:id/sigilo/documentos/:tipo/pdf`, com motivo):
  - o grau e o art. 13 vão no cabeçalho de todas as páginas;
  - o fundamento e o termo final vão acima do rodapé;
  - a numeração "Página X de N" é mantida (Decreto 7.845, art. 23).
  - O gerador de PDF ganhou o campo opcional `marcacao`; quem não usa, não muda.
- **Transparência (frente A):**
  - documento classificado some de `/transparencia/editais/:id` e o PDF responde 404;
  - processo classificado aparece só como registro mínimo: número, data e aviso, sem objeto nem documentos (Decreto 7.845, art. 20);
  - a busca pública não encontra processo nem contrato classificado pelo objeto.
- **PNCP (frente B):**
  - edital ou processo classificado: "Publicar" responde 422;
  - na publicação, o anexo classificado não entra na fila (`anexosRetidosPorSigilo` no evento `pncp.publicar`);
  - tarefa já enfileirada de documento que passou a ser sigiloso vai para a fila de erro com o motivo, sem envio;
  - o painel "Envios ao PNCP" lista os documentos retidos por sigilo (`retidosPorSigilo`).
- **Orçamento sigiloso:**
  - `situacaoOrcamentoSigiloso`: sigiloso até a conclusão da fase de lances (sessão oficial acompanhada na sala de disputa) ou do julgamento (resultado registrado na etapa 6), o que vier primeiro;
  - depois disso, a página pública do edital mostra o valor total estimado e a data da divulgação;
  - antes, mostra "sigiloso até a fase de lances ou o julgamento".

### Contrato sigiloso (art. 91, § 1º)

- O contrato gerado pela jornada pode ser classificado. Na transparência, mostra o registro mínimo: número, unidade e vigência. Fornecedor, objeto e valores ficam ocultos (`sigilo` no `ContratoPublico`; valores zerados e a tela mostra "Sigiloso").
- A divulgação no PNCP responde 422, e uma tarefa já enfileirada vai para a fila de erro.

### Cofre de anexos sigilosos (RNF-09)

- **Cifra e chave:**
  - AES-256-GCM, com nonce aleatório e etiqueta de autenticação;
  - os dados autenticados ligam o conteúdo ao registro (id do anexo e SHA-256 do original);
  - a chave é do órgão (`AGORA_COFRE_CHAVE`). Fora de produção, sem a variável, é derivada do segredo do servidor (HKDF); em produção, sem ela, o cofre fica indisponível (503).
- **Armazenamento:** usa o da frente D. O conteúdo cifrado fica endereçado pelo próprio SHA-256.
- **Envio direto ao cofre** (`POST /processos/:id/sigilo/anexos`): o original em claro nunca é gravado. Valem as mesmas checagens do envio comum (assinatura do formato, PDF sem código ativo, antivírus).
- **Classificar um anexo já enviado:** o anexo é cifrado e o original é apagado do armazenamento quando nenhum outro registro fora do cofre usa o mesmo conteúdo.
- **Download** (`POST …/sigilo/anexos/:arquivoId/baixar`):
  - exige motivo (10 a 300 caracteres) e passa pela decisão de acesso;
  - fica registrado;
  - o conteúdo é decifrado e conferido com o SHA-256 registrado.
  - A rota comum de documentos (frente D) recusa o anexo do cofre e indica a tela de sigilo.

### Carimbo de tempo da trilha (RNF-09)

- **Ancoragem:**
  - O servidor ancora o hash da cadeia no último evento. O SHA-256 da declaração `agora:trilha-auditoria:v1:<sequência>:<hash>` vai para a autoridade de carimbo do tempo RFC 3161 (`AGORA_CARIMBO_TEMPO_URL`), servida pelo órgão ou credenciada na ICP-Brasil, sempre pelo servidor.
  - O pedido leva nonce e pede o certificado da autoridade.
  - A resposta é conferida: status, mesma impressão, mesmo nonce e assinatura CMS (messageDigest e assinatura dos atributos com a chave do certificado).
  - Opcionalmente, o certificado tem de ser o configurado como confiável (`AGORA_CARIMBO_TEMPO_CERTIFICADO_SHA256`).
- **Cliente:**
  - DER e RFC 3161 sem dependências (`apps/api/src/compartilhado/der.ts` e `apps/api/src/integracoes/carimbo-tempo.ts`);
  - timeout e uma nova tentativa em falha de rede, 429 ou 5xx;
  - falha registrada na trilha (`auditoria.ancorar_falhou`).
- **Periodicidade:**
  - a primeira conferência ocorre 15 minutos após a partida e depois de hora em hora;
  - a ancoragem acontece quando devida (`ancoragemDevida`; intervalo `AGORA_CARIMBO_TEMPO_INTERVALO_HORAS`, padrão 24 h) e por uma réplica de cada vez (advisory lock);
  - o administrador pode ancorar na hora.
- **Modo offline (padrão):** registra a ancoragem local com prova HMAC do servidor.
- **Verificação na tela da trilha** (`conferirAncoragem`): recalcula a cadeia e confere, em cada ancoragem, o hash da cadeia no evento ancorado, a declaração carimbada, a assinatura do token ou a prova local.
- **Proveniência:** a tabela `auditoria_ancoragens` é somente inclusão e guarda o token, o hash do token, o horário do carimbo, o número de série e a política. A ancoragem vai para a trilha (`auditoria.ancorar`).

### Telas

- **`/jornada/:id/sigilo` (tela `jornada.sigilo`)**, aberta pelo botão **Sigilo** do processo. Tem:
  - o seu acesso (credencial, órgão de controle ou sem credencial);
  - a classificação do processo;
  - a tabela de documentos e anexos, com Classificar, Reclassificar, Desclassificar, PDF marcado e Baixar do cofre;
  - o contrato;
  - o orçamento estimado (art. 24);
  - as credenciais (Credenciar e Revogar);
  - o registro de acessos, paginado;
  - as classificações anteriores.
- **`/auditoria`:** seção **Carimbo de tempo da trilha**, com Ancorar agora e Verificar ancoragens.
- **Transparência:**
  - aviso de registro mínimo ou de documentos retidos;
  - seção "Orçamento estimado" no edital;
  - "Sigiloso" nos valores do contrato sigiloso.
- **Etapa 5:** "Retidos por sigilo, não enviados ao PNCP" no painel de envios.

## 2. Linhas da conversa atendidas

| Linha | Pedido | Onde |
|---|---|---|
| 324 | Segregar dos atos públicos os elementos cujo sigilo é imprescindível à segurança (especificações táticas, orçamentos sigilosos), conforme LAI | RN-40: classificação por processo, documento, anexo e contrato; transparência e PNCP sem o conteúdo |
| 664 | Publicação no PNCP com tarjamento dos dados protegidos por sigilo estratégico (art. 13) | Fila do PNCP retém o documento classificado; edital classificado não é publicado |
| 1142 | Evidências digitais imutáveis, "logs assinados via ICP-Brasil" | RNF-09: carimbo de tempo RFC 3161 da cadeia de hashes (equivalente abaixo) |
| 1466 | Orçamento e memórias de cálculo em anexo sigiloso até a fase de lances ou o julgamento, com quantitativos visíveis e acesso irrestrito do controle | Sigilo do tipo orçamento, `situacaoOrcamentoSigiloso`, valor público após os lances, `sigilo:controle` |
| 1602 | Segregar contratos, aditivos ou especificações táticas sigilosos (art. 13 e art. 91, § 1º) | Contrato sigiloso com registro mínimo e sem PNCP; documentos e anexos classificados |
| 1813 | Preservar em cofre digital os anexos táticos classificados como sigilosos | Cofre AES-256-GCM, download com motivo e registro |

## 3. Equivalentes lícitos adotados

- **"Segregar automaticamente" e "motor de NLP" (324, 1602, 1813) viram classificação humana com efeito automático.**
  - Classificar é ato da autoridade competente, com razões e prazo (LAI, arts. 27 e 28), e a IA não decide (regra 5).
  - A Ágora não classifica sozinha. Registrada a classificação, todo o resto é automático: a transparência, o PNCP, a ocultação do conteúdo, a marcação, o cofre e a abertura ao fim do prazo.
  - A tarja de dados pessoais (LGPD) já existia (RIA-05) e continua nos PDFs.
- **"Logs assinados via ICP-Brasil" (1142) vira ancoragem da cadeia em carimbo do tempo RFC 3161.**
  - Assinar cada evento exigiria o certificado ICP-Brasil do órgão em HSM no servidor, o que não existe nesta fase.
  - A cadeia de hashes já prova a integridade. O carimbo de uma autoridade (do órgão ou credenciada na ICP-Brasil) prova, por terceiro, que a cadeia existia naquele estado naquela hora.
  - Sem a autoridade, a ancoragem local mantém a rotina e avisa que o horário é do próprio servidor.
- **Credenciamento.** A Ágora não emite credencial de segurança: isso é do órgão de registro (Decreto 7.845, arts. 7º a 12). A Ágora registra, por processo, quem tem a credencial ou assinou o termo de compromisso (art. 18, parágrafo único), com o grau, a validade e a necessidade de conhecer.
- **Credencial automática de quem classifica.** Quem registra o termo de classificação já trata a informação. A credencial é dada no grau da classificação e fica visível e auditada.
- **Órgãos de controle.** O perfil de auditor (CGU e TCU) e o de controle interno têm `sigilo:controle`: acesso irrestrito e sempre registrado (art. 24, I, e art. 169, § 2º).
- **Processo classificado na transparência.** Mostra só o registro mínimo, como manda o art. 20 do Decreto 7.845, em vez de sumir: a existência da contratação continua pública.
- **Cifra.** A brief pede AES-256-GCM, e foi o adotado. Para informação classificada pela LAI, o art. 40 do Decreto 7.845 exige recurso criptográfico baseado em algoritmo de Estado, com parâmetros do GSI. A cifra está isolada em `apps/api/src/modulos/sigilo/cofre.ts` para o órgão trocar pelo recurso homologado; veja a seção 8.

## 4. Regras novas

| Código | Tipo | Título | Implementação |
|---|---|---|---|
| RN-40 | RN | Sigilo de segurança pública: classificação, acesso restrito e divulgação | `validarClassificacaoSigilo`, `prazoMaximoSigilo`, `autoridadeCompetenteSigilo`, `classificacaoVigente`, `situacaoOrcamentoSigiloso`, `decidirAcessoSigilo`, `marcacaoSigilo`, `codigoIndexacaoSigilo`; checagens na transparência, no PNCP e nos documentos |
| RF-33 | RF | Sigilo do processo: classificação, credenciamento e registro de acessos (tela `jornada.sigilo`) | Rotas `/processos/:id/sigilo…` |
| RNF-09 | RNF | Cofre de anexos sigilosos e carimbo de tempo da trilha | `declaracaoAncoragem`, `ancoragemDevida`, `conferirAncoragem`; cofre e cliente RFC 3161 |

Permissões novas, no fim de `TODAS_PERMISSOES` e do tipo `Permissao`:

| Permissão | Perfis |
|---|---|
| `sigilo:ler` | planejamento, agente de contratação, jurídico, gestor de contratos, controle interno, auditor (por ser `:ler`) e administrador |
| `sigilo:classificar` | planejamento, agente de contratação, gestor de contratos e administrador |
| `sigilo:credenciar` | administrador, no papel de gestor de segurança e credenciamento |
| `sigilo:controle` | auditor e controle interno (órgãos de controle). O administrador tem a permissão pela matriz, mas não vale como órgão de controle: administrar o sistema não dá necessidade de conhecer, e ele precisa de credencial |
| `auditoria:ancorar` | administrador |

Tabelas da migração 027:

- `sigilo_classificacoes`: vigente e histórico; uma vigente por alvo;
- `sigilo_credenciais`: uma ativa por pessoa e processo;
- `sigilo_acessos`: somente inclusão;
- `sigilo_cofre`: somente inclusão;
- `auditoria_ancoragens`: somente inclusão, sem TRUNCATE.

Eventos de trilha:

- `sigilo.classificar`, `sigilo.reclassificar`, `sigilo.desclassificar`;
- `sigilo.credenciar`, `sigilo.descredenciar`;
- `sigilo.acessar`, `sigilo.acesso_negado`;
- `sigilo.cofre.enviar`;
- `auditoria.ancorar`, `auditoria.ancorar_falhou`.

## 5. Rotas novas (`/api/v1`)

| Método e caminho | Permissão | O que faz |
|---|---|---|
| `GET /processos/:id/sigilo` | `sigilo:ler` | Classificações, itens, orçamento, credenciais, o seu acesso e o cofre. As razões só para quem tem acesso |
| `POST /processos/:id/sigilo/classificacoes` | `sigilo:classificar` | Classifica ou reclassifica; anexo é cifrado no cofre |
| `POST /processos/:id/sigilo/classificacoes/:classificacaoId/desclassificar` | `sigilo:classificar` | Desclassifica com motivo |
| `POST /processos/:id/sigilo/credenciais` | `sigilo:credenciar` | Credencia, substituindo a credencial ativa |
| `POST /processos/:id/sigilo/credenciais/:credencialId/revogar` | `sigilo:credenciar` | Revoga com motivo |
| `GET /processos/:id/sigilo/acessos` | `sigilo:ler` | Registro de acessos (todos para quem classifica, credencia ou controla; senão, os próprios) |
| `POST /processos/:id/sigilo/documentos/:tipo/pdf` | `sigilo:ler` + decisão | PDF com a marcação; motivo obrigatório |
| `POST /processos/:id/sigilo/anexos` (corpo binário) | `sigilo:classificar` | Anexo direto ao cofre, já classificado |
| `POST /processos/:id/sigilo/anexos/:arquivoId/baixar` | `sigilo:ler` + decisão | Anexo decifrado; motivo obrigatório |
| `GET /auditoria/ancoragens` | `auditoria:ler` | Modo, autoridade, intervalo, próxima e ancoragens |
| `POST /auditoria/ancoragens` | `auditoria:ancorar` | Ancora na hora (503 se a autoridade falhar) |
| `GET /auditoria/ancoragens/verificacao` | `auditoria:ler` | Confere a cadeia e as ancoragens |

Contratos alterados (campos opcionais acrescentados no fim):

- `EditalPublico.sigilo`;
- `ContratoPublico.sigilo`;
- `PublicacaoPncp.retidosPorSigilo`.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_COFRE_CHAVE` | sem valor: chave derivada do segredo fora de produção; cofre desligado em produção | Chave AES-256 do órgão (32 bytes em base64 ou hexadecimal) |
| `AGORA_CARIMBO_TEMPO_URL` | sem valor: ancoragem local | Autoridade de carimbo do tempo RFC 3161 |
| `AGORA_CARIMBO_TEMPO_USUARIO` e `AGORA_CARIMBO_TEMPO_SENHA` | — | Autenticação básica na autoridade, os dois juntos e só com https |
| `AGORA_CARIMBO_TEMPO_CERTIFICADO_SHA256` | — | Impressão SHA-256 do certificado reconhecido como confiável |
| `AGORA_CARIMBO_TEMPO_POLITICA` | — | OID da política de carimbo pedida |
| `AGORA_CARIMBO_TEMPO_INTERVALO_HORAS` | 24 | Intervalo da ancoragem periódica (1 a 720) |
| `AGORA_CARIMBO_TEMPO_TIMEOUT_SEGUNDOS` | 15 | Tempo máximo por chamada à autoridade |

## 7. Seção pronta para o manual do usuário

### Sigilo do processo

Perfis:

- **consultar a tela de sigilo:** planejamento, agente de contratação, jurídico, gestor de contratos, controle interno, auditor e administrador;
- **classificar, reclassificar, desclassificar e enviar anexo sigiloso:** planejamento, agente de contratação, gestor de contratos e administrador;
- **credenciar e revogar credenciais:** administrador (gestor de segurança e credenciamento);
- **acesso irrestrito, sempre registrado:** auditor e controle interno, como órgãos de controle.

Na página do processo, clique em **Sigilo**. No alto, a tela mostra o seu acesso: credencial no processo, órgão de controle ou sem credencial.

**Classificar.** Clique em **Classificar** no processo, no documento, no anexo ou no contrato e preencha:

1. o tipo:
   - **informação classificada**, para especificações táticas e outras informações cuja divulgação põe em risco a segurança da sociedade e do Estado;
   - **orçamento sigiloso**, para o orçamento e as memórias de cálculo, quando a pesquisa de preços (etapa 3) marcou o orçamento como sigiloso;
2. o **grau** (reservado, até 5 anos; secreto, até 15; ultrassecreto, até 25) e a **hipótese** da LAI;
3. as **razões**;
4. a **data de produção** e o **termo final**, por data ou por evento;
5. a **autoridade classificadora** e a competência dela. O grau secreto exige titular de autarquia, fundação ou empresa pública, ou autoridade superior. O ultrassecreto exige Ministro de Estado ou equivalente. A delegação exige o ato.

Ao clicar em **Classificar**, a Ágora confere os prazos e a competência. Quem registra a classificação recebe credencial no grau dela.

O que muda com a classificação:

- o documento some da página pública do edital;
- o documento não vai ao PNCP; o painel **Envios ao PNCP** mostra que ficou retido por sigilo;
- quem não tem credencial vê um aviso no lugar do conteúdo;
- o processo classificado inteiro só abre para quem tem credencial e, na transparência, mostra só número, data e aviso;
- o contrato sigiloso não vai ao PNCP e, na transparência, mostra só número, unidade e vigência;
- o orçamento sigiloso fica público sozinho depois da fase de lances ou do julgamento;
- a informação classificada fica pública sozinha no fim do prazo.

Para mudar o grau ou o prazo, use **Reclassificar** e informe o motivo. Para encerrar o sigilo antes do prazo, use **Desclassificar**.

**Anexos sigilosos.** Use **Enviar anexo sigiloso** para guardar um arquivo (PDF, PNG ou JPEG) direto no cofre, já classificado: ele é cifrado no servidor e nunca fica gravado em claro. Um anexo enviado pela página de documentos e depois classificado também vai para o cofre. Para abri-lo, use **Baixar do cofre** e informe o motivo.

**PDF marcado.** Em documento classificado, use **PDF marcado** e informe o motivo. O PDF sai com o grau de sigilo no cabeçalho e o fundamento e o prazo no rodapé de todas as páginas.

**Credenciais.** O administrador usa **Credenciar** e informa:

- a pessoa;
- o grau máximo;
- o fundamento: credencial de segurança ou termo de compromisso de manutenção de sigilo;
- a necessidade de conhecer;
- a validade, se houver.

Para retirar o acesso, use **Revogar**.

**Registro de acessos.** Todo acesso a informação sigilosa fica registrado, permitido ou negado, com a pessoa, a operação e o motivo. Quem classifica, credencia ou é órgão de controle vê todos os acessos; os demais veem os próprios.

### Carimbo de tempo da trilha (Auditoria)

Na **Trilha de auditoria**, a seção **Carimbo de tempo da trilha** mostra as ancoragens: até qual evento, com qual hash e em que modo.

- Com a autoridade de carimbo do tempo do órgão configurada, cada ancoragem tem o horário atestado por terceiro (RFC 3161).
- Sem ela, a ancoragem é local.

O administrador pode usar **Ancorar agora**. Qualquer perfil com acesso à trilha pode usar **Verificar ancoragens**: a Ágora recalcula a cadeia e confere cada carimbo. Se algo divergir, preserve as evidências e acione a segurança da informação.

## 8. Limitações e o que depende de acesso externo

- **Autoridade de carimbo real.**
  - O cliente RFC 3161 foi testado com uma autoridade simulada que emite tokens reais: TSTInfo, CMS SignedData e assinatura ECDSA P-256 com certificado X.509 gerado no teste.
  - Nenhuma autoridade real foi chamada.
  - Não há validação da cadeia ICP-Brasil até a raiz: a confiança é pela impressão do certificado configurado.
  - RSASSA-PSS não é suportado; RSA PKCS#1 v1.5 e ECDSA são.
- **Algoritmo de Estado (Decreto 7.845, art. 40).** Para informação classificada, o órgão deve trocar a AES-256-GCM pelo recurso criptográfico homologado pelo GSI, em `cofre.ts`. A rotação de chave não recifra os anexos: o `chave_id` de cada anexo indica a chave necessária.
- **Bases legais conferidas.**
  - O Decreto 7.845 (arts. 2º, 12, 18, 19, 20, 23, 31, 38 e 40) foi conferido no texto compilado da Câmara.
  - Os arts. 18, § 1º, VI, e 24 da Lei 14.133 foram conferidos na página do TCU (Licitações e Contratos). Os arts. 13 e 91, § 1º, também no TCU, em trechos.
  - Os arts. 23, 24 e 27 da LAI foram conferidos em reprodução de terceiros.
  - O Planalto bloqueou o acesso automatizado. O art. 169, § 2º, da Lei 14.133 e o art. 25 da LAI foram citados pela redação conhecida, sem conferência online nesta sessão. Vale reconferir no Planalto.
- **Pontos de checagem.**
  - Cobrem as rotas `/processos/:id…`, a transparência e o PNCP.
  - Listas de processos (jornada, painéis e controle) continuam mostrando o título do processo classificado. O título deve ser redigido sem revelar o conteúdo sigiloso (Decreto 7.845, art. 20).
  - As telas internas de contratos não restringem o contrato sigiloso: a restrição é na divulgação.
- **PNCP.**
  - Documento já enviado antes da classificação continua no PNCP: a exclusão e a retificação no PNCP não foram implementadas (frente B).
  - O anexo de orçamento retido não é reenviado sozinho depois dos lances.
  - Para contrato sigiloso, a pendência de divulgação do art. 94 continua aberta e pede baixa manual. Fica para o coordenador decidir a dispensa automática.
- **Nota técnica de preços.**
  - A regra da frente A (`publico/preparatorios.ts`) continua sem divulgar a nota técnica de orçamento sigiloso, mesmo depois da homologação. A página pública passou a mostrar o valor estimado depois dos lances.
  - Pelo art. 18, § 1º, VI, o anexo classificado do orçamento é sigiloso só até a conclusão da licitação: a divulgação da nota técnica depois da homologação fica como sugestão ao coordenador.
- **Seed.** Nenhuma classificação foi semeada, para não alterar o que os testes das outras frentes leem nos processos sintéticos. A demonstração é feita pela tela, como no e2e `sigilo.spec.ts`.
- **Arquivos de outras frentes alterados (só pontos de checagem):**
  - A: `publico/rotas.ts`, `publico/editais.ts`, `TransparenciaEdital.tsx`, `Transparencia.tsx`, `TransparenciaContrato.tsx`;
  - B: `publicacao-pncp/servico.ts`, `tarefas.ts`, `rotas.ts`, `EnviosPncp.tsx`;
  - D: `documentos/rotas.ts` e `armazenamento/arquivos.ts` (método `remover` e instância de memória compartilhada por endereço);
  - comuns: `pdf-texto.ts` (marcação opcional), botão **Sigilo** em `ProcessoDetalhe.tsx`, seção nova em `TrilhaAuditoria.tsx`.
- **Rastreabilidade.** Para o coordenador: em `RASTREABILIDADE-REQUISITOS.md`, as linhas de F25 (sigilo e logs com carimbo de tempo) passam a ✅ com esta entrega; em `PLANO-NOVAS-FUNCOES.md`, F25 sai da lista.
