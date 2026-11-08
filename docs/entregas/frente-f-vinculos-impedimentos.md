# Frente F — vínculos entre licitantes, extensão de sanção e impedimentos dos agentes (F4 e F14)

Reservas usadas: migração `016`; regras RIA-10, RN-27 e RN-28; porta e2e `3106`.

## 1. O que foi feito

### F4 — vínculos e sinal de vínculo impeditivo (RIA-10)

- **Domínio** (`packages/dominio/src/lei14133/vinculos.ts`):
  - `sinalizarVinculosLicitantes` cruza os licitantes entre si e com os agentes da equipe. Junta, num só motor, o que já era o RIA-06 (quadro societário) e o que entra agora no RIA-10:
    - sócio ou administrador em comum (RIA-06);
    - agente da equipe no quadro de um licitante (RIA-06);
    - endereço ou contato de cadastro em comum (RIA-10);
    - vínculos declarados ou informados com evidência entre licitantes (RIA-10);
    - vínculo de agente público com licitante, inclusive casamento, união estável e parentesco até o 3º grau (RIA-10).
  - Vínculo de agente que atua no processo é "risco" (art. 14, IV). O de agente fora da equipe é "atenção", para verificar se ele é dirigente do órgão.
  - `detectarPossivelSucessao` aponta empresa com sócio, administrador ou endereço em comum com fornecedor impedido ou inidôneo. É "risco" quando a empresa foi aberta depois da instauração do processo sancionatório ou até 12 meses antes (parâmetro). Fundamento: art. 14, III e § 1º, e art. 160.
  - Apoio: `validarVinculoInformado`, `mesmaPessoaQsa`, `normalizarEndereco`.
  - Todo sinal traz evidências, fundamento e `requerRevisaoHumana: true`. Nenhum sinal desclassifica.
- **"Junte com o RIA-06":** a etapa 6 da jornada passou a usar esse motor. O sinal de sócio em comum continua com o rótulo RIA-06; os sinais RIA-10 entram na lista de sinais do processo e nunca bloqueiam. A função antiga `vinculosEntreLicitantes` foi removida, porque o motor novo a substitui.
- **Conector do QSA** (`apps/api/src/integracoes/qsa-receita.ts`):
  - roda no servidor, com tempo limite de 15 s, 2 novas tentativas e proveniência (fonte, modo, hora, hash SHA-256 e quantidade);
  - grava auditoria em `impedimentos.qsa.consultar`;
  - guarda só os 6 dígitos centrais do CPF, os mesmos que os dados abertos publicam;
  - modo offline (padrão): a resposta é simulada de forma determinística a partir do seed.
- **Telas:**
  - **Vínculos e impedimentos** (`/impedimentos`): análise de 2 a 50 licitantes, possíveis sucessões, extensões, processos com licitantes, vínculos registrados e consulta por fornecedor;
  - **Vínculos do processo** (`/impedimentos/processos/:id`): sinais entre os licitantes, declarações da equipe e vínculos;
  - **Vínculos do fornecedor** (`/impedimentos/fornecedores/:id`): quadro societário mascarado com a proveniência, botão de consultar o QSA, sinais, vínculos e extensões.

### F4 — extensão de sanção (RN-27, art. 160)

- **Domínio** (`packages/dominio/src/lei14133/extensao-sancao.ts`):
  - `proporExtensaoSancao`: aceita só sanção que impede de licitar (impedimento ou inidoneidade) aplicada e vigente. Exige fundamentação e calcula o prazo de defesa de 15 dias úteis a partir da intimação (art. 158).
  - `avancarExtensaoSancao`: conduz o rito contraditório → análise jurídica prévia → decisão, ou arquivamento.
    - Sem defesa, o procedimento só segue depois de vencido o prazo.
    - Quem propôs não emite o parecer.
    - A autoridade que decide não pode ser quem propôs nem quem deu o parecer.
  - `efeitosExtensaoSancao`: a mesma sanção, da data da decisão até o fim da vigência da sanção de origem ("todos os efeitos").
- **API:** cada passo grava evento na trilha.
  - A decisão de estender registra a sanção para o alcançado no módulo de sanções, com o evento `sancao.estender`.
  - Pessoa física alcançada (administrador ou sócio com poderes de administração) ganha cadastro de fornecedor pessoa física, com CPF e nome mascarados nas telas.
- **Arquivos novos**, para não colidir com a frente C: `apps/api/src/modulos/impedimentos/rotas-extensoes.ts` e a tabela `extensoes_sancao`. A tabela `sancoes` não foi alterada; só recebe as linhas novas.
- **Tela:** **Extensão de sanção** (`/impedimentos/extensoes/:id`), com o andamento, os dados, os registros e o próximo passo de acordo com o perfil.

### F14 — declarações dos agentes designados (RN-28, arts. 7º e 9º)

- **Domínio** (`packages/dominio/src/lei14133/declaracoes-agentes.ts`):
  - `verificarDeclaracaoAgente` e `verificarDeclaracoesEquipe` conferem o seguinte:
    - **declaração válida** (12 meses, critério da Ágora, porque a lei não fixa prazo);
    - **inexistência de impedimento**: casamento, união estável, parentesco até o 3º grau ou vínculo técnico, comercial, econômico, financeiro, trabalhista ou civil com licitantes ou contratados habituais (art. 7º, III), e conflito de interesses (art. 9º, § 1º);
    - **capacitação** nas funções essenciais e na assessoria jurídica (art. 7º, II e § 2º);
    - **vínculo efetivo ou permanente** obrigatório para agente de contratação e pregoeiro (art. 8º, caput e § 5º). Nas demais funções do art. 7º, ele é preferencial e vira sinal.
  - `exigenciasDoPapel` diz o que cada papel exige.
- **Verificação para a jornada:** `apps/api/src/modulos/impedimentos/declaracoes.ts#verificarDeclaracoesDesignados`.
  - É chamada em `PUT /processos/:id/equipe` logo depois da segregação (RN-03). Foram 5 linhas em `jornada/rotas.ts`.
  - Agente sem declaração válida não é designado: a resposta é 422, com detalhes `campo: 'RN-28'`.
- **Vínculos declarados:** viram vínculos com fonte "declaração do agente público" e alimentam o RIA-10.
- **Tela:** **Minha declaração de impedimentos** (`/impedimentos/declaracao`), com a situação, a aptidão por papel e o formulário de assinatura e renovação.

## 2. Linhas da conversa atendidas

- **63 (Sentinela, vínculos societários e parentesco):** RIA-06 e RIA-10 unificados, com parentesco só de fonte lícita.
- **687 (PoC-03, 4 empresas, duas com vínculo, alerta de vínculo impeditivo do art. 14):** análise de 4 licitantes com sinal e evidências (e2e) e sinal RIA-10 na etapa 6. No seed, Escudo Forte e Boreal têm parentesco declarado no processo dos coletes.
- **1132 e 1294 (RIA-03, sucessão fraudulenta de empresa punida, CNPJ recém-criado):** `detectarPossivelSucessao` e o painel de possíveis sucessões. No seed, a Nortelink foi aberta há 75 dias com o sócio-administrador e o endereço da Nortecom, que está impedida.
- **1509 (QSA, parentesco até o 3º grau, endereços, IP):** QSA pelo conector, endereço e contato do cadastro, e parentesco declarado ou informado com evidência. IP ficou de fora (veja a seção 3).
- **1785 (painel de designação com vínculo efetivo, certificação por escola de governo e declaração de ausência de parentesco):** RN-28, a declaração e a tela de aptidão.
- **1786 e 1787 (RN-03, segregação e CPF dos designados no quadro de contratados habituais):** a designação chama a RN-28 junto com a RN-03. O CPF do agente da equipe no quadro de licitante virou sinal RIA-06 na etapa 6.
- **1821 (RIA-06, sócios em comum e parentesco até o 3º grau):** unificado no motor novo.

## 3. Equivalentes lícitos adotados

| Pedido da conversa | Por que não, ao pé da letra | O que a Ágora faz |
|---|---|---|
| "Motor de grafos" que descobre parentesco cruzando dados (linhas 63, 1132, 1509, 1821) | Não existe base pública lícita de parentesco. Inferir parentesco por cruzamento de dados pessoais fere a finalidade e a minimização (LGPD, art. 6º, I e III) | Parentesco e casamento só entram declarados (pelo licitante ou pelo próprio agente) ou informados por agente público, com a fonte e a evidência registradas |
| Cruzar endereços IP da sessão (linhas 1132 e 1509) | O IP é dado pessoal coletado para segurança, não para investigar parentesco. Usá-lo para outra finalidade exigiria base legal própria | Não é usado. O sinal usa endereço e contato do cadastro do CNPJ e do fornecedor, que são dados da pessoa jurídica |
| IA que alerta e, na prática, decide | Sanção, impedimento e fraude são decisão humana (Regra 5; arts. 14, § 1º, 158 e 160) | Todo resultado é sinal "requer revisão humana", com evidências. A extensão de sanção passa por contraditório, parecer e decisão da autoridade |
| QSA da Receita "em tempo real" | O QSA com CPF completo depende do acordo de cooperação técnica | O conector usa os dados abertos do CNPJ, com CPF mascarado e só os 6 dígitos centrais guardados. A mesma pessoa é reconhecida pelos dígitos centrais e pelo nome |

A planalto.gov.br bloqueou o acesso automatizado ("Acesso Negado"). O texto dos arts. 7º, 8º, 9º, 14, 156, 158, 160 e 161 foi conferido na norma publicada no portal da Câmara dos Deputados (legin, publicação original), cujo texto é o mesmo.

## 4. Regras novas

| Regra | Título | Fundamento | Implementação |
|---|---|---|---|
| RIA-10 | Sinal de vínculo impeditivo e de possível sucessão de empresa sancionada | Lei 14.133/2021, art. 9º, § 1º, e art. 14, III, IV, V e § 1º | `sinalizarVinculosLicitantes`, `detectarPossivelSucessao` |
| RN-27 | Extensão dos efeitos da sanção (desconsideração da personalidade jurídica) | art. 160 | `proporExtensaoSancao`, `avancarExtensaoSancao`, `efeitosExtensaoSancao` |
| RN-28 | Declaração de inexistência de impedimento dos agentes designados | art. 7º, I a III e § 2º; art. 8º, caput e § 5º; art. 9º, § 1º | `verificarDeclaracaoAgente`, `verificarDeclaracoesEquipe`; `PUT /processos/:id/equipe` |

**Novos ids de tela:** `impedimentos`, `impedimentos.processo`, `impedimentos.fornecedor`, `impedimentos.extensao` e `impedimentos.declaracao`. A RIA-10 também aparece em `jornada.detalhe`, e a RN-28 em `jornada.equipe`.

**Permissões novas** (no fim de `TODAS_PERMISSOES` e de `Permissao`):

| Permissão | O que libera | Perfis |
|---|---|---|
| `impedimentos:ler` | Consultar vínculos, impedimentos e extensões | gestor de contratos, agente de contratação, jurídico, auditor (por ser de leitura) e administrador |
| `impedimentos:registrar` | Registrar vínculos e consultar o QSA | gestor de contratos, agente de contratação e administrador |
| `impedimentos:parecer` | Emitir a análise jurídica da extensão | jurídico e administrador |
| `impedimentos:decidir` | Decidir a extensão | gestor de contratos e administrador; o servidor impede que decida quem propôs ou deu o parecer |
| `agentes:declarar` | Assinar a própria declaração | todos os perfis, menos auditor e consulta |

Propor, registrar defesa e arquivar a extensão usam a permissão já existente `sancoes:instruir`.

## 5. Rotas novas (`/api/v1`)

| Rota | Permissão |
|---|---|
| `POST /impedimentos/analise` (somente leitura, 2 a 50 fornecedores) | `impedimentos:ler` |
| `GET /impedimentos/sucessoes` | `impedimentos:ler` |
| `GET /impedimentos/processos` e `GET /impedimentos/processos/:id` (escopo de UASG) | `impedimentos:ler` |
| `GET /impedimentos/fornecedores/:id` | `impedimentos:ler` |
| `POST /impedimentos/fornecedores/:id/qsa` | `impedimentos:registrar` |
| `GET /impedimentos/vinculos?fornecedorId&processoId&situacao` | `impedimentos:ler` |
| `POST /impedimentos/vinculos` e `POST /impedimentos/vinculos/:id/revogar` | `impedimentos:registrar` |
| `GET /impedimentos/agentes` | `impedimentos:registrar` |
| `GET /impedimentos/extensoes` e `GET /impedimentos/extensoes/:id` | `impedimentos:ler` |
| `POST /impedimentos/extensoes`, `/:id/defesa` e `/:id/arquivar` | `sancoes:instruir` |
| `POST /impedimentos/extensoes/:id/parecer` | `impedimentos:parecer` |
| `POST /impedimentos/extensoes/:id/decisao` | `impedimentos:decidir` |
| `GET /impedimentos/declaracoes/minha` e `POST /impedimentos/declaracoes` | `agentes:declarar` |

**Rota alterada:** `PUT /processos/:id/equipe` agora responde 422 com `RN-28` quando um designado não tem declaração válida.

**Migração `016_vinculos_impedimentos.sql`:**

- coluna `qualificacao` em `fornecedores_socios`;
- tabelas novas:
  - `fornecedores_cadastro_cnpj`: abertura, endereço e proveniência;
  - `fornecedores_qsa`: CPF só com os 6 dígitos centrais;
  - `declaracoes_agentes`;
  - `vinculos_licitantes`;
  - `extensoes_sancao`.

## 6. Variáveis de ambiente

| Variável | Uso | Padrão |
|---|---|---|
| `AGORA_QSA_URL` | Endereço do espelho dos dados abertos do CNPJ mantido pelo órgão, ou da API do acordo de cooperação. A Ágora chama `GET {url}/cnpj/{cnpj}` | vazio: modo offline |
| `AGORA_QSA_CHAVE` | Chave enviada em `Authorization: Bearer` | vazio |

A consulta só vai à rede com `AGORA_INTEGRACOES=online` e `AGORA_QSA_URL` definida. Formato aceito da resposta, em JSON:

- `cnpj`;
- `dataInicioAtividade`;
- `endereco`: `logradouro`, `numero`, `complemento`, `bairro`, `municipio`, `uf` e `cep`;
- `socios[]`: `nome`, `cpfCnpj` (com o CPF mascarado "***456789**"), `qualificacao` e `dataEntrada`.

Sócio pessoa jurídica é ignorado nesta versão.

## 7. Seção pronta para o manual do usuário

### Vínculos e impedimentos

Perfis: gestor de contratos, agente de contratação, assessoria jurídica, auditor (só consulta) e administrador.

A Ágora aponta sinais de vínculo entre licitantes e com agentes públicos, e possíveis sucessões de empresas punidas. Ela só usa fontes lícitas:

- o quadro societário dos dados abertos do CNPJ, com o CPF mascarado;
- o cadastro do fornecedor;
- as declarações dos licitantes e dos agentes;
- os vínculos informados por um agente público, com a evidência.

A Ágora não deduz parentesco cruzando dados pessoais nem endereço de internet. Cada sinal mostra as evidências e a marca **Requer revisão humana**. Nenhum sinal desclassifica, impede ou sanciona.

**Analisar os licitantes de uma sessão**

1. Em **Vínculos e impedimentos**, use **Filtrar fornecedores** e marque os licitantes (de 2 a 50).
2. Clique em **Analisar vínculos**.
3. Leia cada sinal: o tipo, o nível (**Risco** ou **Atenção**), as **Evidências** e o fundamento legal.

Os mesmos sinais aparecem na etapa 6 da jornada e em **Vínculos do processo**.

**Registrar um vínculo** (gestor de contratos, agente de contratação e administrador)

1. Clique em **Registrar vínculo**.
2. Escolha o fornecedor e a outra parte: outro fornecedor ou um agente público do órgão.
3. Informe a natureza. No parentesco, informe também o grau, até o 3º.
4. Indique a fonte: **Declaração do licitante** ou **Informado por agente público**.
5. Descreva o vínculo e a **Evidência**, com o documento e onde ele está juntado.

O vínculo pode ser revogado, com motivo. Tudo fica na trilha de auditoria.

**Consultar o quadro societário** (gestor de contratos, agente de contratação e administrador)

Na página do fornecedor, clique em **Consultar quadro societário**. A consulta é feita pelo servidor da Ágora e mostra a fonte, a data, a quantidade de integrantes e o código de conferência (hash).

**Propor a extensão de uma sanção (art. 160)** (gestor de contratos e administrador)

1. Em **Possíveis sucessões de empresas sancionadas**, clique em **Propor extensão da sanção** no sinal.
2. Escolha quem seria alcançado: a sucessora, a coligada ou controlada, ou um administrador ou sócio-administrador da empresa punida.
3. Escreva a fundamentação e a data da intimação.
4. Clique em **Abrir o contraditório**.

A proposta não estende nada. Ela abre o prazo de defesa de 15 dias úteis.

**Seguir o procedimento**

1. Quem instrui registra a **defesa**. Também pode registrar **Prazo encerrado sem defesa**, mas só depois do prazo.
2. A assessoria jurídica registra a **análise jurídica prévia**. Quem propôs não pode fazê-la.
3. A autoridade competente registra a **decisão**. Ela não pode ser quem propôs nem quem deu o parecer.

Se a decisão for estender, a sanção passa a constar do módulo de **Sanções** para o alcançado, até o fim da sanção de origem.

### Minha declaração de impedimentos

Perfis: todos, menos auditor e consulta.

Você só pode ser designado para atuar em um processo depois de assinar a declaração de inexistência de impedimento (arts. 7º e 9º).

1. Abra **Minha declaração de impedimentos** no menu.
2. Marque as duas afirmações:
   - não ter casamento, união estável, parentesco até o 3º grau nem vínculo com licitantes ou contratados habituais;
   - não estar em conflito de interesses.
3. Informe o vínculo com a Administração, o cargo e a matrícula, e a capacitação.
4. Se tiver vínculo com alguma empresa, inclua-o em **Vínculos com empresas**. A Ágora avisará se ela participar de processo em que você atue.
5. Clique em **Assinar declaração**.

A declaração vale por 12 meses e deve ser renovada sempre que surgir uma situação de impedimento. A tabela **Em que papéis você pode atuar** mostra o que falta para cada papel. Por exemplo, o agente de contratação e o pregoeiro precisam ser servidores efetivos ou empregados públicos permanentes (art. 8º).

Na designação da equipe (etapa 2), a Ágora recusa quem não tem declaração válida e mostra o motivo, com a regra **RN-28**.

## 8. Limitações e dependências externas

- **QSA com CPF completo e base em tempo real** dependem do acordo de cooperação com a Receita, previsto no ETP. Sem ele, use os dados abertos com CPF parcial. A mesma pessoa é reconhecida pelos 6 dígitos centrais e pelo nome, o que pode gerar homônimo raro: por isso tudo é sinal.
- **Pessoa física alcançada pela extensão** precisa ter o CPF completo no cadastro do fornecedor. Quando só existe o CPF parcial dos dados abertos, a Ágora pede o registro antes de propor.
- **Extensão de multa** não está nesta versão. O efeito patrimonial pede regras de cobrança da frente de sanções. Só se estendem impedimento e inidoneidade.
- **Sócio pessoa jurídica** (controladora) no QSA é ignorado. Coligadas e controladas entram por vínculo informado.
- **Envio ao CEIS/CNEP** da sanção estendida segue o fluxo do módulo de sanções: a sanção é criada com o prazo do art. 161 e "não registrada".
- **Declarações já existentes:** as designações do seed foram feitas antes da RN-28. A regra vale a cada nova designação. Na carga de demonstração, só o usuário financeiro ainda não assinou a declaração, para mostrar a recusa.
- A validade de 12 meses da declaração e a janela de 12 meses da "empresa nova" são critérios da Ágora, não da lei. São parâmetros das funções do domínio.

## 9. Verificações

Os resultados estão no relatório da frente: domínio, contratos, typecheck, testes do domínio e da API, build, e2e (`AGORA_E2E_PORTA=3106`) e gates da Fábrica.
