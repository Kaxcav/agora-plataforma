-- Cadastros base: UASGs, unidades internas, grupos, usuários, sessões e feriados locais.

CREATE TABLE uasgs (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[0-9]{6}$'),
  nome text NOT NULL,
  sigla text NOT NULL,
  uf char(2) NOT NULL,
  orgao text NOT NULL,
  criada_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unidades_internas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sigla text NOT NULL,
  nome text NOT NULL,
  ativa boolean NOT NULL DEFAULT true,
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT unidades_internas_sigla_unica UNIQUE (sigla)
);

CREATE TABLE grupos_uasg (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('confirmado', 'pendente_confirmacao')),
  confirmado_em timestamptz,
  confirmado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE grupos_uasg_membros (
  grupo_id uuid NOT NULL REFERENCES grupos_uasg (id) ON DELETE CASCADE,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  PRIMARY KEY (grupo_id, uasg)
);

CREATE TABLE usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text NOT NULL,
  cpf text NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  senha_hash text,
  ativo boolean NOT NULL DEFAULT true,
  unidade_interna_id uuid REFERENCES unidades_internas (id),
  todas_uasgs boolean NOT NULL DEFAULT false,
  ultimo_acesso_em timestamptz,
  busca_normalizada text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuarios_email_unico UNIQUE (email),
  CONSTRAINT usuarios_cpf_unico UNIQUE (cpf)
);
CREATE INDEX usuarios_unidade_idx ON usuarios (unidade_interna_id);

CREATE TABLE usuarios_perfis (
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  perfil text NOT NULL CHECK (perfil IN ('administrador', 'gestor_contratos', 'fiscal', 'financeiro', 'planejamento',
    'agente_contratacao', 'juridico', 'auditor', 'consulta')),
  PRIMARY KEY (usuario_id, perfil)
);

CREATE TABLE usuarios_uasgs (
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  PRIMARY KEY (usuario_id, uasg)
);

CREATE TABLE sessoes (
  id text PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  criada_em timestamptz NOT NULL,
  expira_em timestamptz NOT NULL,
  absoluta_ate timestamptz NOT NULL,
  ip_hash text NOT NULL,
  agente text NOT NULL DEFAULT '',
  metodo text NOT NULL DEFAULT 'senha' CHECK (metodo IN ('senha', 'govbr'))
);
CREATE INDEX sessoes_usuario_idx ON sessoes (usuario_id);
CREATE INDEX sessoes_expira_idx ON sessoes (expira_em);

CREATE TABLE tentativas_login (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL,
  ocorrida_em timestamptz NOT NULL,
  sucesso boolean NOT NULL
);
CREATE INDEX tentativas_login_chave_idx ON tentativas_login (chave, ocorrida_em);

CREATE TABLE feriados_locais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  nome text NOT NULL,
  criado_por uuid REFERENCES usuarios (id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feriados_locais_data_unica UNIQUE (data)
);
