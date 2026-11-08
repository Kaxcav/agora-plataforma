-- Vínculos entre licitantes (RIA-10), extensão de sanção (art. 160, RN-27) e declarações dos agentes (arts. 7º e 9º, RN-28).
-- Fontes lícitas apenas: quadro societário dos dados abertos do CNPJ (CPF parcial), cadastro do fornecedor,
-- declarações dos licitantes e dos agentes e vínculos informados por agente público com fonte e evidência.

-- Qualificação do integrante no quadro societário do cadastro (sócio, administrador ou sócio-administrador).
ALTER TABLE fornecedores_socios
  ADD COLUMN IF NOT EXISTS qualificacao text NOT NULL DEFAULT 'socio'
  CHECK (qualificacao IN ('socio', 'administrador', 'socio_administrador'));

-- Cadastro do CNPJ (dados abertos da Receita Federal): abertura e endereço, com proveniência da consulta.
CREATE TABLE fornecedores_cadastro_cnpj (
  fornecedor_id uuid PRIMARY KEY REFERENCES fornecedores (id) ON DELETE CASCADE,
  data_abertura date,
  endereco text,
  municipio text,
  uf char(2),
  fonte text NOT NULL,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  consultado_em timestamptz NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  registros integer NOT NULL DEFAULT 0 CHECK (registros >= 0)
);

-- Quadro societário como publicado nos dados abertos: o CPF vem só com os 6 dígitos centrais.
CREATE TABLE fornecedores_qsa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
  documento_parcial text NOT NULL CHECK (documento_parcial ~ '^[0-9]{6}$'),
  nome text NOT NULL,
  qualificacao text NOT NULL CHECK (qualificacao IN ('socio', 'administrador', 'socio_administrador')),
  data_entrada date
);
CREATE INDEX fornecedores_qsa_fornecedor_idx ON fornecedores_qsa (fornecedor_id);
CREATE INDEX fornecedores_qsa_documento_idx ON fornecedores_qsa (documento_parcial);

-- Declaração do agente público (art. 7º, I a III; art. 9º, § 1º). Uma vigente por usuário; a nova substitui a anterior.
CREATE TABLE declaracoes_agentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  declarada_em timestamptz NOT NULL,
  data_declaracao date NOT NULL,
  sem_parentesco_ou_vinculo boolean NOT NULL,
  sem_conflito_interesses boolean NOT NULL,
  vinculo text NOT NULL CHECK (vinculo IN ('servidor_efetivo', 'empregado_publico_permanente', 'cargo_comissao', 'temporario', 'outro')),
  cargo_matricula text,
  capacitacao text NOT NULL CHECK (capacitacao IN ('atribuicoes', 'formacao', 'certificacao_escola_governo', 'nenhuma')),
  capacitacao_descricao text,
  vigente boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX declaracoes_agentes_vigente_idx ON declaracoes_agentes (usuario_id) WHERE vigente;

-- Vínculo de fonte lícita: entre dois fornecedores ou entre um fornecedor e um agente público.
CREATE TABLE vinculos_licitantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  natureza text NOT NULL CHECK (natureza IN ('conjuge', 'parentesco', 'societario', 'tecnico', 'comercial', 'economico', 'financeiro', 'trabalhista', 'civil')),
  grau_parentesco smallint CHECK (grau_parentesco BETWEEN 1 AND 3),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  outro_fornecedor_id uuid REFERENCES fornecedores (id),
  agente_id uuid REFERENCES usuarios (id),
  fonte text NOT NULL CHECK (fonte IN ('declaracao_licitante', 'declaracao_agente', 'informado_agente')),
  descricao text NOT NULL,
  evidencia text NOT NULL,
  processo_id uuid REFERENCES processos (id),
  declaracao_id uuid REFERENCES declaracoes_agentes (id),
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'revogado')),
  motivo_revogacao text,
  CONSTRAINT vinculos_licitantes_uma_contraparte CHECK ((outro_fornecedor_id IS NULL) <> (agente_id IS NULL)),
  CONSTRAINT vinculos_licitantes_grau CHECK ((natureza = 'parentesco') = (grau_parentesco IS NOT NULL)),
  CONSTRAINT vinculos_licitantes_distintos CHECK (outro_fornecedor_id IS NULL OR outro_fornecedor_id <> fornecedor_id)
);
CREATE INDEX vinculos_licitantes_fornecedor_idx ON vinculos_licitantes (fornecedor_id);
CREATE INDEX vinculos_licitantes_outro_idx ON vinculos_licitantes (outro_fornecedor_id);
CREATE INDEX vinculos_licitantes_agente_idx ON vinculos_licitantes (agente_id);

-- Procedimento de extensão dos efeitos da sanção (art. 160): proposta, contraditório, análise jurídica e decisão.
CREATE TABLE extensoes_sancao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sancao_origem_id uuid NOT NULL REFERENCES sancoes (id),
  alvo text NOT NULL CHECK (alvo IN ('administrador', 'socio_administrador', 'sucessora', 'coligada_controlada')),
  alvo_fornecedor_id uuid REFERENCES fornecedores (id),
  alvo_pessoa_nome text,
  alvo_pessoa_cpf text CHECK (alvo_pessoa_cpf IS NULL OR alvo_pessoa_cpf ~ '^[0-9]{11}$'),
  situacao text NOT NULL CHECK (situacao IN ('contraditorio', 'analise_juridica', 'decisao', 'estendida', 'nao_estendida', 'arquivada')),
  fundamentacao text NOT NULL,
  sinal text,
  intimacao_em date NOT NULL,
  prazo_defesa date NOT NULL,
  defesa_apresentada boolean,
  defesa_resumo text,
  defesa_registrada_em timestamptz,
  parecer_conclusao text CHECK (parecer_conclusao IN ('favoravel', 'desfavoravel')),
  parecer_texto text,
  parecerista_id uuid REFERENCES usuarios (id),
  parecer_em timestamptz,
  decisao_resultado text CHECK (decisao_resultado IN ('estender', 'nao_estender')),
  decisao_motivacao text,
  autoridade_id uuid REFERENCES usuarios (id),
  decidida_em timestamptz,
  sancao_estendida_id uuid REFERENCES sancoes (id),
  arquivamento_motivo text,
  arquivada_em timestamptz,
  proposto_por uuid NOT NULL REFERENCES usuarios (id),
  proposta_em timestamptz NOT NULL,
  CONSTRAINT extensoes_sancao_alvo CHECK (
    (alvo IN ('sucessora', 'coligada_controlada') AND alvo_fornecedor_id IS NOT NULL AND alvo_pessoa_cpf IS NULL)
    OR (alvo IN ('administrador', 'socio_administrador') AND alvo_fornecedor_id IS NULL AND alvo_pessoa_cpf IS NOT NULL AND alvo_pessoa_nome IS NOT NULL)
  )
);
CREATE INDEX extensoes_sancao_origem_idx ON extensoes_sancao (sancao_origem_id);
CREATE INDEX extensoes_sancao_situacao_idx ON extensoes_sancao (situacao);
