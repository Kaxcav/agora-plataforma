-- Jornada da contratação (docs/JORNADA.md): processos, equipe designada, árvore SEI simulada e documentos gerados.
-- Os dados de cada etapa ficam em colunas jsonb; as regras de avanço vêm de @agora/dominio.

-- Numeração sintética do processo (08000.NNNNNN/AAAA-DV) e dos documentos da árvore SEI (NNNNNNNN).
CREATE SEQUENCE processos_numero_seq START WITH 14501;
CREATE SEQUENCE processos_arvore_sei_numero_seq START WITH 41730001;

CREATE TABLE processos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_sei text NOT NULL CHECK (numero_sei ~ '^[0-9]{5}\.[0-9]{6}/[0-9]{4}-[0-9]{2}$'),
  titulo text NOT NULL,
  orgao text NOT NULL CHECK (orgao IN ('PF', 'PRF', 'SENASP', 'SENAPPEN', 'MJSP')),
  uasg text NOT NULL REFERENCES uasgs (codigo),
  etapa_atual integer NOT NULL DEFAULT 1 CHECK (etapa_atual BETWEEN 1 AND 7),
  responsavel_id uuid REFERENCES usuarios (id),
  modalidade_prevista text,
  dfd jsonb NOT NULL,
  etp jsonb NOT NULL DEFAULT '{}'::jsonb,
  riscos jsonb NOT NULL DEFAULT '[]'::jsonb,
  cesta jsonb NOT NULL,
  edital jsonb NOT NULL,
  parecer jsonb NOT NULL,
  publicacao jsonb NOT NULL,
  disputa jsonb NOT NULL,
  contrato_id uuid REFERENCES contratos (id),
  busca_normalizada text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL,
  CONSTRAINT processos_numero_sei_unico UNIQUE (numero_sei),
  CONSTRAINT processos_contrato_unico UNIQUE (contrato_id)
);
CREATE INDEX processos_uasg_idx ON processos (uasg);
CREATE INDEX processos_etapa_idx ON processos (etapa_atual);
CREATE INDEX processos_orgao_idx ON processos (orgao);
CREATE INDEX processos_responsavel_idx ON processos (responsavel_id);

CREATE TABLE processos_equipe (
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('requisitante', 'equipe_planejamento', 'agente_contratacao', 'pregoeiro',
    'comissao_contratacao', 'autoridade_competente', 'gestor_contrato', 'fiscal_tecnico', 'fiscal_administrativo',
    'parecerista_juridico')),
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  designado_em timestamptz NOT NULL,
  PRIMARY KEY (processo_id, papel, usuario_id)
);
CREATE INDEX processos_equipe_usuario_idx ON processos_equipe (usuario_id);

CREATE TABLE documentos_gerados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'edital', 'minuta_contrato',
    'parecer_checklist')),
  titulo text NOT NULL,
  versao integer NOT NULL CHECK (versao > 0),
  conteudo text NOT NULL,
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  gerado_por text NOT NULL CHECK (gerado_por IN ('modelo', 'ia')),
  modelo_ia text,
  falha_ia text,
  premissas jsonb NOT NULL DEFAULT '[]'::jsonb,
  fontes jsonb NOT NULL DEFAULT '[]'::jsonb,
  situacao text NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'revisado', 'aprovado')),
  gerado_em timestamptz NOT NULL,
  gerado_por_usuario uuid REFERENCES usuarios (id),
  revisado_por uuid REFERENCES usuarios (id),
  revisado_em timestamptz,
  CONSTRAINT documentos_gerados_versao_unica UNIQUE (processo_id, tipo, versao),
  CONSTRAINT documentos_gerados_aprovacao_coerente CHECK ((situacao = 'rascunho') = (revisado_por IS NULL))
);
CREATE INDEX documentos_gerados_processo_idx ON documentos_gerados (processo_id, tipo, versao DESC);

CREATE TABLE processos_arvore_sei (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  numero text NOT NULL CHECK (numero ~ '^[0-9]{8}$'),
  titulo text NOT NULL,
  documento_id uuid REFERENCES documentos_gerados (id),
  incluido_em timestamptz NOT NULL,
  assinado_em timestamptz,
  assinado_por uuid REFERENCES usuarios (id),
  CONSTRAINT processos_arvore_sei_numero_unico UNIQUE (numero),
  CONSTRAINT processos_arvore_sei_documento_unico UNIQUE (documento_id),
  CONSTRAINT processos_arvore_sei_assinatura_coerente CHECK ((assinado_em IS NULL) = (assinado_por IS NULL))
);
CREATE INDEX processos_arvore_sei_processo_idx ON processos_arvore_sei (processo_id);
