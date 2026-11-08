-- Instrumentos: atas de registro de preços, pregões homologados a montar, contratos, itens, aditivos e reajustes.

CREATE TABLE atas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  ano integer NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  objeto text NOT NULL,
  processo_sei text NOT NULL,
  modalidade text NOT NULL,
  numero_compra text NOT NULL,
  assinatura_em date NOT NULL,
  divulgacao_pncp_em date,
  vigencia_inicio date NOT NULL,
  vigencia_fim date NOT NULL,
  aceita_adesao boolean NOT NULL DEFAULT false,
  id_pncp text NOT NULL,
  gestor_id uuid REFERENCES usuarios (id),
  indice_reajuste text NOT NULL DEFAULT 'IPCA',
  data_base_reajuste date NOT NULL,
  fonte_dados text NOT NULL DEFAULT 'COMPRAS_GOV' CHECK (fonte_dados IN ('PNCP', 'COMPRAS_GOV', 'CONTRATOS_GOV', 'SIAFI', 'AGORA')),
  busca_normalizada text NOT NULL DEFAULT '',
  criada_em timestamptz NOT NULL DEFAULT now(),
  atualizada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atas_numero_unico UNIQUE (uasg, numero),
  CONSTRAINT atas_id_pncp_unico UNIQUE (id_pncp),
  CONSTRAINT atas_vigencia_valida CHECK (vigencia_fim >= vigencia_inicio)
);
CREATE INDEX atas_uasg_idx ON atas (uasg);
CREATE INDEX atas_vigencia_fim_idx ON atas (vigencia_fim);
CREATE INDEX atas_gestor_idx ON atas (gestor_id);

CREATE TABLE itens_ata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ata_id uuid NOT NULL REFERENCES atas (id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero > 0),
  descricao text NOT NULL,
  catmat text,
  unidade_fornecimento text NOT NULL,
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  valor_unitario bigint NOT NULL CHECK (valor_unitario >= 0),
  quantidade_registrada integer NOT NULL CHECK (quantidade_registrada >= 0),
  busca_normalizada text NOT NULL DEFAULT '',
  CONSTRAINT itens_ata_numero_unico UNIQUE (ata_id, numero)
);
CREATE INDEX itens_ata_fornecedor_idx ON itens_ata (fornecedor_id);

CREATE TABLE atas_a_montar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_compra text NOT NULL,
  modalidade text NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  objeto text NOT NULL,
  homologada_em date NOT NULL,
  quantidade_itens integer NOT NULL CHECK (quantidade_itens >= 0),
  valor_homologado bigint NOT NULL CHECK (valor_homologado >= 0),
  id_pncp text NOT NULL,
  montada boolean NOT NULL DEFAULT false,
  busca_normalizada text NOT NULL DEFAULT '',
  recebida_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT atas_a_montar_id_pncp_unico UNIQUE (id_pncp)
);
CREATE INDEX atas_a_montar_uasg_idx ON atas_a_montar (uasg);

CREATE TABLE contratos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  ano integer NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  ata_id uuid REFERENCES atas (id),
  objeto text NOT NULL,
  processo_sei text NOT NULL,
  origem text NOT NULL CHECK (origem IN ('licitacao', 'contratacao_direta')),
  modalidade text NOT NULL,
  assinatura_em date NOT NULL,
  divulgacao_pncp_em date,
  vigencia_inicio date NOT NULL,
  vigencia_fim date NOT NULL,
  valor_inicial bigint NOT NULL CHECK (valor_inicial >= 0),
  gestor_id uuid REFERENCES usuarios (id),
  fiscal_id uuid REFERENCES usuarios (id),
  id_pncp text,
  garantia_tipo text,
  garantia_valor bigint CHECK (garantia_valor IS NULL OR garantia_valor >= 0),
  garantia_valida_ate date,
  indice_reajuste text NOT NULL DEFAULT 'IPCA',
  data_base_reajuste date NOT NULL,
  fonte_recurso text NOT NULL DEFAULT '1000',
  fonte_dados text NOT NULL DEFAULT 'CONTRATOS_GOV' CHECK (fonte_dados IN ('PNCP', 'COMPRAS_GOV', 'CONTRATOS_GOV', 'SIAFI', 'AGORA')),
  campos_editados text[] NOT NULL DEFAULT '{}',
  busca_normalizada text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contratos_numero_unico UNIQUE (uasg, numero),
  CONSTRAINT contratos_id_pncp_unico UNIQUE (id_pncp),
  CONSTRAINT contratos_vigencia_valida CHECK (vigencia_fim >= vigencia_inicio)
);
CREATE INDEX contratos_uasg_idx ON contratos (uasg);
CREATE INDEX contratos_vigencia_fim_idx ON contratos (vigencia_fim);
CREATE INDEX contratos_fornecedor_idx ON contratos (fornecedor_id);
CREATE INDEX contratos_ata_idx ON contratos (ata_id);
CREATE INDEX contratos_gestor_idx ON contratos (gestor_id);

CREATE TABLE itens_contrato (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  item_ata_id uuid REFERENCES itens_ata (id),
  numero integer NOT NULL CHECK (numero > 0),
  descricao text NOT NULL,
  unidade_fornecimento text NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade >= 0),
  valor_unitario bigint NOT NULL CHECK (valor_unitario >= 0),
  quantidade_recebida integer NOT NULL DEFAULT 0 CHECK (quantidade_recebida >= 0),
  CONSTRAINT itens_contrato_numero_unico UNIQUE (contrato_id, numero)
);
CREATE INDEX itens_contrato_contrato_idx ON itens_contrato (contrato_id);
CREATE INDEX itens_contrato_item_ata_idx ON itens_contrato (item_ata_id);

CREATE TABLE aditivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  numero text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('acrescimo', 'supressao', 'prorrogacao', 'reajuste')),
  valor bigint NOT NULL CHECK (valor >= 0),
  nova_vigencia_fim date,
  assinado_em date NOT NULL,
  justificativa text NOT NULL
);
CREATE INDEX aditivos_contrato_idx ON aditivos (contrato_id);

CREATE TABLE reajustes_ciclos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrumento_tipo text NOT NULL CHECK (instrumento_tipo IN ('ata', 'contrato')),
  instrumento_id uuid NOT NULL,
  inicio date NOT NULL,
  fim date NOT NULL,
  percentual double precision NOT NULL,
  aplicado_em date
);
CREATE INDEX reajustes_ciclos_instrumento_idx ON reajustes_ciclos (instrumento_tipo, instrumento_id);
