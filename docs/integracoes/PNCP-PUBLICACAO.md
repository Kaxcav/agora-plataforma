# Integração de publicação no PNCP — notas para a F11

Fonte: Manual de Integração PNCP, versão 2.2.7 (gov.br/pncp, "versões anteriores do manual"). Antes de implementar, conferir o Swagger do ambiente de treinamento e a versão vigente do manual: campos e tabelas podem ter mudado.

## Ambientes

| Ambiente | Serviços (`BASE_URL`) | Documentação |
|---|---|---|
| Treinamento (sandbox, roteiro PoC-05) | `https://treina.pncp.gov.br/api/pncp` | Swagger em `https://treina.pncp.gov.br/api/pncp/swagger-ui/index.html` |
| Produção | `https://pncp.gov.br/api/pncp` | Swagger em `https://pncp.gov.br/api/pncp/swagger-ui/index.html` |

**Credenciamento:**

- O PNCP credencia o **sistema** (a Ágora instalada no órgão), não cada servidor: é um único login e senha por sistema.
- Depois do credenciamento, o órgão é incluído nos "entes autorizados" do usuário.
- Se o CNPJ do órgão não estiver nessa lista, o PNCP responde **401**.
- No caso do MJSP, o ETP do cliente prevê que o próprio órgão solicite as chaves de homologação e de produção.

## Autenticação

- `POST {BASE_URL}/v1/usuarios/login`, com corpo `{ "login", "senha" }`.
- O token JWT volta no **cabeçalho** `Authorization` da resposta, depois de "Bearer".
- Toda API de manutenção exige `Authorization: Bearer <token>`.

## Inserir contratação (compra, edital ou aviso) com o documento principal

- **Requisição:** `POST {BASE_URL}/v1/orgaos/{cnpj}/compras`, com `Content-Type: multipart/form-data`.
- **Cabeçalhos:**
  - `Titulo-Documento`: texto de até 50 caracteres;
  - `Tipo-Documento-Id`: código da tabela abaixo; 2 = Edital.
- **Partes:**
  - `compra`: JSON da contratação;
  - documento (o arquivo).
- **Campos obrigatórios do JSON:**
  - `codigoUnidadeCompradora`: a unidade deve estar cadastrada no órgão;
  - `tipoInstrumentoConvocatorioId`, `modalidadeId`, `modoDisputaId`, `amparoLegalId`: tabelas de domínio;
  - `numeroCompra` (sem o ano), `anoCompra` e `numeroProcesso`;
  - `objetoCompra`: até 5.120 caracteres; `informacaoComplementar` é opcional;
  - `srp`: booleano;
  - `dataAberturaProposta` e `dataEncerramentoProposta`: obrigatórias para os instrumentos 1 e 2, no horário de Brasília;
  - `itensCompra`: lista de itens.
- **Campos de cada item:**
  - `numeroItem`, `materialOuServico` ("M"/"S"), `tipoBeneficioId`, `incentivoProdutivoBasico`;
  - `descricao`, `quantidade`, `unidadeMedida`;
  - `orcamentoSigiloso`, `valorUnitarioEstimado`, `valorTotal`;
  - `criterioJulgamentoId`, `itemCategoriaId`.
- **Sucesso:** HTTP 201, com o cabeçalho `location: {BASE_URL}/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}`.
- **Identificação:** o `numeroControlePNCP` segue o formato `00394460000141-1-000001/2021`.

## Incluir anexos (TR, minuta, ETP...)

- **Requisição:** `POST {BASE_URL}/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/arquivos`, multipart, com os mesmos cabeçalhos `Titulo-Documento` e `Tipo-Documento-Id`.
- **Sucesso:** HTTP 201, com `location: .../compras/{ano}/{sequencial}/arquivos/{numero}`.

## Tabela "Tipo de Documento" (seção 5.12 do manual)

| Código | Documento |
|---|---|
| 1 | Aviso de Contratação Direta |
| 2 | Edital |
| 3 | Minuta do Contrato |
| 4 | Termo de Referência |
| 5 | Anteprojeto |
| 6 | Projeto Básico |
| 7 | Estudo Técnico Preliminar |
| 8 | Projeto Executivo |
| 9 | Mapa de Riscos |
| 10 | DFD |
| 16 | Outros documentos do processo |

## Pontos de implementação na Ágora

- **Adaptador:** `publicarOnline`, com o mesmo contrato de `publicarOffline` (`apps/api/src/modulos/jornada/servico.ts`). Usa o `fetch` injetável do contexto, para os testes rodarem com um PNCP falso.
- **Configuração por ambiente:**
  - URL base: treinamento por padrão em homologação;
  - login e senha do sistema;
  - `AGORA_ORGAO_CNPJ`, que já existe;
  - código da unidade compradora.
  - Nenhum desses valores fica no código.
- **Arquivos:** os documentos vão em PDF, gerados no servidor.
- **O que o servidor guarda:** o `location`, o `numeroControlePNCP` e o hash de cada arquivo enviado, com proveniência na trilha de auditoria.
- **Robustez:** idempotência por processo (não publicar duas vezes) e novas tentativas com espera crescente.
- **Link público do portal:** a confirmar no manual vigente (o formato usual é `https://pncp.gov.br/app/editais/{cnpj}/{ano}/{sequencial}`).
