# Frente D — documentos do processo e leitura assistida de atestados (F13, PoC-03)

Entrega da frente D: envio seguro de documentos do processo e de habilitação, serviço de OCR separado, leitura assistida de atestados de capacidade técnica e as regras dos arts. 67 e 69, § 6º, da Lei 14.133/2021.

## 1. O que foi feito (F13)

### Envio seguro de documentos (RF-21)

- Rotas novas em `apps/api/src/modulos/documentos/`. O arquivo chega como corpo binário (`application/octet-stream`), sem dependência nova.
- O formato é conferido pela assinatura dos bytes (`%PDF-`, PNG, JPEG), nunca pela extensão nem pelo `Content-Type` do navegador. Arquivo executável, ZIP ou HTML renomeado é recusado.
- PDF passa por inspeção. São recusados:
  - PDF sem páginas;
  - PDF criptografado ou protegido por senha;
  - PDF com conteúdo ativo (`/JavaScript`, `/JS`, `/Launch`, arquivo embutido, XFA, envio de formulário), inclusive escondido em fluxo de objetos ou com nome escapado.
- Limite de tamanho (`AGORA_ARQUIVOS_TAMANHO_MAXIMO_MB`, padrão 20 MB). Acima dele, a resposta é 413, com o limite na mensagem.
- O SHA-256 é gravado no banco e na trilha de auditoria. O mesmo arquivo não entra duas vezes no processo, para não somar o mesmo atestado em dobro.
- Armazenamento fora do banco, endereçado pelo SHA-256 (`sha256/ab/cd/<hash>`), com escrita atômica e conferência de integridade a cada leitura.
  - A interface `ArmazenamentoArquivos` (`apps/api/src/armazenamento/arquivos.ts`) tem implementação em disco e em memória (testes).
  - Trocar por armazenamento de objetos auto-hospedado é escrever outra implementação.
- Gancho de antivírus: clamd do órgão por TCP, protocolo INSTREAM (`AGORA_ANTIVIRUS_URL`), desligado por padrão.
  - Configurado, a falha é fechada: antivírus fora do ar recusa o envio (503).
  - Ameaça encontrada recusa o envio e grava `processo.arquivo.recusar_antivirus` na trilha.
- Download só pela API (`POST .../baixar`), com permissão `documentos:ler` e escopo da UASG do processo (fora do escopo, 404).
  - Sai como anexo, com `Content-Disposition` seguro e o cabeçalho `X-Agora-SHA256`.
  - Documento marcado com dado pessoal exige finalidade (10 a 300 caracteres) e grava o acesso em `processos_arquivos_acessos` (somente inclusão) e na trilha (`lgpd.documento.acessar`), conforme a LGPD, art. 37.
  - Todo download fica na trilha.
- Habilitação:
  - O documento precisa de um licitante da disputa do processo.
  - O balanço patrimonial exige o exercício e aceita a data de constituição da empresa (art. 69, § 6º).

### Serviço de OCR separado (`apps/ocr/`)

- Microsserviço em Node 24, sem dependências npm, que embrulha o Tesseract (idioma `por`) e o `pdftoppm` (Poppler).
  - `POST /v1/ocr` recebe PDF, PNG ou JPEG e devolve o texto por página e linha, com a confiança.
  - `GET /saude` informa o estado.
- O serviço chama os programas com `execFile`, sem shell. Usa um diretório temporário por pedido, apagado ao final.
- Tem limites de tamanho, de páginas e de pedidos simultâneos, e não precisa de internet.
- `Dockerfile` próprio (`apps/ocr/Dockerfile`), com usuário sem privilégios.
- O serviço fica fora dos workspaces npm: não tem dependências e não mexe no `package-lock.json`.
  - Testes: `npm test` em `apps/ocr`.
  - Tipos: `npx tsc -p apps/ocr/tsconfig.json --noEmit`.
- `deploy/docker-compose.yml` (blocos acrescentados):
  - serviço `ocr`, sem porta publicada;
  - volume `arquivos_agora` montado em `AGORA_ARQUIVOS_DIR`;
  - `AGORA_OCR_URL=http://ocr:8080`.
- `deploy/k8s/documentos-ocr.yaml` (arquivo novo):
  - volume `agora-arquivos` (ReadWriteMany), compartilhado pelas réplicas;
  - Deployment e Service `agora-ocr`;
  - NetworkPolicy do OCR: só recebe da API e não tem saída;
  - NetworkPolicy aditiva da API para o OCR (8080) e o clamd (3310).
- `deploy/k8s/agora.yaml` recebeu as variáveis no ConfigMap e o volume `/var/lib/agora/arquivos` no Deployment.
- `deploy/Dockerfile` cria `/var/lib/agora/arquivos` com dono `node`.
- A API chama o OCR só no servidor (`apps/api/src/integracoes/ocr.ts`):
  - timeout por chamada (`AGORA_OCR_TIMEOUT_SEGUNDOS`);
  - uma nova tentativa em falha de rede ou 5xx;
  - resposta validada com zod;
  - proveniência gravada: hora da leitura, SHA-256 do arquivo e do texto, páginas, linhas, motor e confiança.
- PDF com camada de texto é lido no próprio servidor, sem OCR (`apps/api/src/compartilhado/pdf-leitura.ts`, sem dependências). A leitura cobre:
  - objetos diretos e em `/ObjStm`;
  - filtros Flate, ASCIIHex e ASCII85;
  - fontes simples com WinAnsi, MacRoman e `/Differences`;
  - fontes compostas com `/ToUnicode`;
  - kerning do `TJ` e formulários.

  Página com menos de 20 letras ou dígitos em média é tratada como digitalizada e vai ao OCR.

### Leitura assistida de atestados (RIA-08)

- `extrairQuantitativosAtestado` (`@agora/dominio`, puro e determinístico):
  - localiza número e unidade ("925 pontos de função", "1.200 (mil e duzentos) coletes", "quantidade executada: 350");
  - reconhece o núcleo da parcela como unidade;
  - ignora datas, CNPJ, CPF, valores em reais, percentuais, anos e números de item, lote ou artigo;
  - confere o valor por extenso com os algarismos (a divergência rebaixa a confiança);
  - associa cada menção à parcela pela unidade e pelas palavras da linha;
  - devolve, para cada menção, a página, a linha e o trecho-fonte.

  Em cada atestado vale o maior total declarado. Sem total, somam-se as menções distintas.
- `somarQuantitativosAtestados`:
  - soma os atestados do mesmo licitante e compara com o mínimo do edital;
  - devolve sinal `indica_atendimento`, `indica_insuficiencia` ou `inconclusivo`, com evidências, premissas, fundamento e o aviso "requer revisão humana";
  - não tem campo de decisão.
- As menções são recalculadas a cada consulta com as exigências vigentes: o texto lido fica guardado. Os trechos saem com CPF, e-mail e telefone tarjados.

### RN-25 — arts. 67, §§ 1º e 2º, e 69, § 6º

Regras conferidas:

- `classificarParcelaRelevancia`: parcela de maior relevância é a de valor igual ou superior a 4% do valor total estimado. A comparação é exata, em centavos.
- `limiteQuantitativoMinimo`: o mínimo exigido vai até 50% da parcela.
- `avaliarExigenciasQualificacaoTecnica` aponta também parcela maior que o total e soma das parcelas acima do total.
- `exerciciosBalancoExigiveis` e `avaliarBalancosApresentados`: 2 exercícios, ou só o último se a empresa foi constituída há menos de 2 anos na data de referência (exatamente 2 anos já exige 2 exercícios).

Onde valem:

- A API recusa (422, com o problema por parcela) exigências que descumpram o art. 67.
- As exigências só podem ser definidas até a etapa 4. O valor total é o da pesquisa de preços do processo.
- Conferência do texto da lei:
  - O planalto.gov.br bloqueou o acesso automatizado nesta sessão.
  - Os arts. 67 e 69 foram conferidos numa reprodução da lei (modeloinicial.com.br) e em transcrições dos §§ 1º e 2º encontradas na busca.
  - Pontos conferidos e citados nas regras:
    - art. 67, § 1º: 4% do valor total estimado;
    - art. 67, § 2º: até 50% das parcelas, vedadas limitações de tempo e de local;
    - art. 69, § 6º: os documentos do inciso I limitam-se ao último exercício para empresa constituída há menos de 2 anos.
  - Vale reconferir no Planalto.

### Interface

- Página nova `/jornada/:id/documentos`, aberta pelo botão **Documentos e habilitação** do processo. Tela `jornada.documentos` no Modo Especificação. Tem três seções:
  - exigências do edital, com a conferência da RN-25 e o diálogo de definição com prévia;
  - tabela de documentos: verificações, SHA-256 com botão de copiar, situação da leitura, **Baixar** e **Ler atestado**;
  - leitura assistida por licitante: mínimo, soma, sinal, trechos-fonte com página e linha, balanço, e fontes, premissas e data.
- Diálogos: enviar documento e baixar com finalidade (LGPD).
- O envio vai direto do navegador para `/api/v1`, com CSRF (`enviarArquivo` e `baixarArquivoApi` em `apps/web/src/api/cliente.ts`).

### Seed

- `apps/api/src/seed/qualificacao-tecnica.ts` define as parcelas dos processos sintéticos a partir da etapa 5. Cada item do DFD com 4% ou mais do total vira parcela, com mínimo de 50%.
- Não consome o PRNG, para não deslocar as etapas seguintes.
- O seed não grava arquivos: os atestados de demonstração são enviados na hora, por exemplo pelo e2e.

## 2. Linhas da conversa atendidas

| Linha | Pedido | Onde |
|---|---|---|
| 64 e 201 | Assistente do pregoeiro: triagem de documentos de habilitação com leitura de atestados (OCR + NLP) | RF-21 (documentos de habilitação por licitante), RIA-08 (leitura e soma) |
| 505 | Atestados específicos da parcela de maior relevância (art. 18, IX) | RN-25 e exigências do edital |
| 687 | PoC-03: upload de atestado em PDF digitalizado com extração correta dos quantitativos | OCR (`apps/ocr`), teste da API com OCR simulado, e2e `documentos-ocr.spec.ts` |
| 814 | Parcela de maior relevância com mínimo de 50% do quantitativo | RN-25 (`limiteQuantitativoMinimo`); os valores do exemplo não foram copiados |
| 1505–1520 (1516) | RIA-03.2: ler atestados em PDF, extrair e somar os quantitativos e confrontar com as parcelas de maior relevância | `extrairQuantitativosAtestado`, `somarQuantitativosAtestados`, `GET /processos/:id/qualificacao-tecnica` |
| 1818 | Leitor OCR/NLP de atestados de capacidade técnica na etapa 6 | Página `/jornada/:id/documentos` e atalho no processo |
| 1821 | RIA-06: extrair os quantitativos dos atestados (art. 67) | RIA-08 (a parte de grafo antifraude é da frente F) |

## 3. Equivalentes lícitos adotados

- **"Triagem automatizada" e "confrontar" (64, 201, 1516) viram sinal, não decisão.**
  - A habilitação é decisão do agente de contratação (regra 5 do projeto; Lei 14.133, arts. 8º e 17).
  - A Ágora devolve sinal com evidências, premissas, data e "requer revisão humana", e não grava habilitado ou inabilitado.
- **OCR auto-hospedado em vez de serviço de nuvem.**
  - Atestados trazem dados pessoais de responsáveis técnicos.
  - O Tesseract roda num contêiner do órgão, sem internet, por soberania e pela LGPD, arts. 33 a 36.
- **"NLP" determinístico em vez de LLM.**
  - A extração usa regras auditáveis: números brasileiros, unidades, extenso e contexto da linha.
  - Sem provedor de IA por padrão (regra 5). O mesmo texto sempre gera o mesmo resultado.
- **Recusa de exigência abaixo de 4% ou acima de 50%.** A lei restringe a exigência de atestado (art. 67, §§ 1º e 2º). Em vez de só alertar, a Ágora não grava exigência ilegal.
- **Soma entre atestados.**
  - A lei não veda o somatório, e a jurisprudência do TCU o admite, salvo vedação justificada no edital.
  - A soma é premissa declarada, e o agente pode desconsiderá-la.
- **Registro LGPD dos downloads.**
  - O acesso a documento com dado pessoal fica em tabela própria, somente inclusão, e na trilha.
  - A tabela `lgpd_acessos` não foi alterada, para não conflitar com outras frentes; veja a seção 8.

## 4. Regras novas

| Código | Tipo | Título | Implementação |
|---|---|---|---|
| RF-21 | RF | Documentos do processo e de habilitação | `GET/POST /processos/:id/arquivos`, `POST .../baixar` |
| RIA-08 | RIA | Leitura assistida de atestados de capacidade técnica | `extrairQuantitativosAtestado`, `somarQuantitativosAtestados`, `POST .../leitura`, `GET .../qualificacao-tecnica` |
| RN-25 | RN | Parcelas de maior relevância, quantitativos mínimos e exercícios do balanço | `classificarParcelaRelevancia`, `limiteQuantitativoMinimo`, `avaliarExigenciasQualificacaoTecnica`, `exerciciosBalancoExigiveis`, `avaliarBalancosApresentados`, `PUT .../qualificacao-tecnica` |

Permissões novas, no fim de `TODAS_PERMISSOES` e do tipo `Permissao`:

- `documentos:ler`: gestor de contratos, planejamento, agente de contratação, jurídico, auditor (por ser `:ler`) e administrador;
- `documentos:enviar`: planejamento, agente de contratação e administrador;
- `documentos:analisar`: agente de contratação e administrador.

Migração: `apps/api/migracoes/014_documentos_processo_atestados.sql`, com as tabelas:

- `processos_arquivos`;
- `processos_arquivos_leituras`;
- `processos_qualificacao_tecnica`;
- `processos_arquivos_acessos` (somente inclusão).

## 5. Rotas novas (`/api/v1`)

| Método e caminho | Permissão | O que faz |
|---|---|---|
| `GET /processos/:id/arquivos` | `documentos:ler` | Lista os documentos com a última leitura, os limites e se o OCR e o antivírus estão ativos |
| `POST /processos/:id/arquivos?categoria&tipo&titulo&fornecedorId&contemDadoPessoal&exercicio&dataConstituicao` | `documentos:enviar` | Recebe o arquivo (corpo binário; nome em `X-Agora-Nome-Arquivo`) → 201 |
| `POST /processos/:id/arquivos/:arquivoId/baixar` | `documentos:ler` | Devolve o arquivo; `finalidade` obrigatória quando há dado pessoal |
| `POST /processos/:id/arquivos/:arquivoId/leitura` | `documentos:analisar` | Lê o atestado (camada de texto ou OCR) e registra a leitura |
| `GET /processos/:id/qualificacao-tecnica` | `documentos:ler` | Exigências com a RN-25, análise por licitante (RIA-08) e balanços (art. 69, § 6º) |
| `PUT /processos/:id/qualificacao-tecnica` | `jornada:editar` | Define as parcelas (até a etapa 4; 422 se violar o art. 67) |

Eventos de trilha:

- `processo.arquivo.enviar`;
- `processo.arquivo.baixar`;
- `lgpd.documento.acessar`;
- `processo.arquivo.ler`;
- `processo.arquivo.recusar_antivirus`;
- `processo.qualificacao_tecnica.definir`.

## 6. Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `AGORA_ARQUIVOS_DIR` | `<AGORA_DADOS_DIR>/arquivos` em demonstração e homologação (`memory://` nos testes); desligado em produção | Diretório dos documentos. Em produção, sem ela, o envio responde 503 com a orientação |
| `AGORA_ARQUIVOS_TAMANHO_MAXIMO_MB` | 20 | Limite por arquivo (1 a 200) |
| `AGORA_ANTIVIRUS_URL` | desligado | `tcp://host:3310` do clamd do órgão |
| `AGORA_OCR_URL` | desligado | Endereço do serviço `apps/ocr`, como `http://ocr:8080` |
| `AGORA_OCR_TIMEOUT_SEGUNDOS` | 120 | Tempo máximo por chamada ao OCR |

Variáveis do serviço de OCR:

- `OCR_PORTA` (8080);
- `OCR_TAMANHO_MAXIMO_MB` (25);
- `OCR_MAXIMO_PAGINAS` (30);
- `OCR_RESOLUCAO_DPI` (300);
- `OCR_TIMEOUT_SEGUNDOS` (240);
- `OCR_SIMULTANEOS` (1).

## 7. Seção pronta para o manual do usuário

### Documentos e habilitação

Perfis:

- consultar e baixar: agente de contratação, planejamento, jurídico, gestor de contratos, auditor e administrador;
- enviar: agente de contratação, planejamento e administrador;
- ler atestados: agente de contratação e administrador;
- definir as exigências do edital: planejamento, agente de contratação e administrador, até a etapa 4.

Na página do processo, clique em **Documentos e habilitação**. A página tem três partes.

**Exigências de qualificação técnica do edital.** Mostra as parcelas de maior relevância e o mínimo exigido nos atestados.

- A Ágora só aceita exigir atestado de parcela que valha **4% ou mais** do valor total estimado (art. 67, § 1º).
- O mínimo não pode passar de **50%** da parcela (art. 67, § 2º).

Para definir as exigências, até a etapa 4:

1. Clique em **Definir exigências**.
2. Para cada parcela, informe a descrição, a unidade, a quantidade no objeto, o valor estimado e a quantidade mínima.
3. Se quiser, acrescente palavras que identificam a parcela nos atestados. A tela avisa, enquanto você digita, se alguma parcela fica fora da lei.
4. Clique em **Salvar exigências**.

**Documentos do processo.** Para enviar um documento:

1. Clique em **Enviar documento**.
2. Escolha o arquivo (PDF, PNG ou JPEG).
3. Indique se é **de habilitação** (atestado, balanço, certidão, proposta) ou **do processo**.
4. Para habilitação, escolha o **licitante**.
5. Para balanço, informe o **exercício** e, se souber, a **data de constituição** da empresa.
6. Marque **contém dado pessoal** quando o documento tiver CPF, e-mail, telefone ou assinatura de pessoa física.
7. Clique em **Enviar documento**.

O que acontece com o arquivo:

- A Ágora confere o tipo pelo conteúdo do arquivo, e não pelo nome.
- PDF com senha ou com código ativo é recusado.
- O SHA-256, que identifica o arquivo, fica registrado.
- O mesmo arquivo não pode ser enviado duas vezes no processo.

Para baixar, use **Baixar**. Se o documento contém dado pessoal, informe a **finalidade**: o acesso fica registrado (LGPD).

**Leitura assistida dos atestados.** Em cada atestado, clique em **Ler atestado**.

- PDF com texto é lido na hora.
- PDF digitalizado (só imagem) vai ao serviço de OCR do órgão, quando ele está configurado.

Para cada licitante, a Ágora mostra:

- o mínimo exigido em cada parcela;
- a soma dos quantitativos lidos em todos os atestados;
- de onde veio cada número: o atestado, a página, a linha e o trecho.

O resultado é um **sinal** (indica atendimento, indica quantitativo insuficiente ou sem leitura suficiente) que **requer revisão humana**. Confira os trechos no documento: a decisão de habilitação é do agente de contratação.

A mesma parte mostra o balanço patrimonial:

- quantos exercícios são exigíveis: 2, ou só o último se a empresa tem menos de 2 anos (art. 69, § 6º);
- quantos foram apresentados.

## 8. Limitações e o que depende de acesso externo

- **OCR real:**
  - A imagem `apps/ocr` foi construída e testada localmente com Tesseract 5.3.0 (por) e Poppler reais, em contêiner somente leitura, sem capacidades e sem rede.
  - Um atestado sintético digitalizado (PNG, sem camada de texto) enviado pela API voltou com o quantitativo correto (350 coletes, página 1, linha 2, confiança média de 87%).
  - Um PDF com o extenso quebrado entre linhas também voltou correto (925 pontos de função).
  - Esse teste usou o contêiner real e foi feito à mão. Os testes automatizados usam o OCR simulado, porque nunca chamam serviço real.
  - Em produção, depende de o órgão publicar a imagem no registro interno e de haver CPU para o OCR.
  - A qualidade depende da digitalização: dígitos podem ser lidos errados, e por isso cada número traz o trecho-fonte e o extenso é conferido.
- **OCR síncrono.** A leitura acontece na própria requisição, limitada por `AGORA_OCR_TIMEOUT_SEGUNDOS`. Para grande volume, uma fila de leitura é evolução futura.
- **Antivírus.** Só o gancho: o clamd é do órgão. Sem ele, o documento aparece como "antivírus não configurado".
- **Armazenamento.** Disco local ou volume ReadWriteMany. O armazenamento de objetos auto-hospedado depende de outra implementação de `ArmazenamentoArquivos`.
- **Relatório LGPD.**
  - Os downloads de documentos com dado pessoal estão na trilha (`lgpd.documento.acessar`) e em `processos_arquivos_acessos`.
  - A página `/auditoria/lgpd` ainda lista só `lgpd_acessos`. Unir as duas listas exige mexer no módulo LGPD, compartilhado; fica para o coordenador.
- **Edital gerado.** O PDF do edital (`jornada/documentos.ts`, compartilhado) ainda não imprime a tabela de parcelas de maior relevância. A exigência fica registrada no processo e na trilha.
- **Leitor de PDF.** Fontes compostas sem `/ToUnicode` e fontes Type3 não têm texto recuperável. Esses PDFs caem no OCR, que lê a imagem.
- **Correção manual de menções.** O agente confere as evidências e decide. Não há edição das menções extraídas: a leitura pode ser refeita depois de ajustar as exigências.
- **Disputa.** Documentos de habilitação dependem dos licitantes registrados na disputa (`processos.disputa`). Se a frente E mudar essa estrutura, a validação do licitante em `documentos/rotas.ts` precisa acompanhar.
- **Exclusão de documentos.** Documentos não são excluídos: são registros do processo, com guarda conforme a tabela de temporalidade.
