-- Fornecedores, quadro societário (dado pessoal) e indicadores de desempenho (art. 88, §§ 3º e 4º).

CREATE TABLE fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento text NOT NULL CHECK (documento ~ '^[0-9]{11}$|^[0-9]{14}$'),
  tipo_pessoa text NOT NULL CHECK (tipo_pessoa IN ('PJ', 'PF')),
  razao_social text NOT NULL,
  porte text CHECK (porte IN ('ME', 'EPP', 'DEMAIS')),
  uf char(2),
  telefone text,
  email text,
  certidoes_irregulares text[] NOT NULL DEFAULT '{}',
  regularidade_consultada_em timestamptz,
  busca_normalizada text NOT NULL DEFAULT '',
  fonte_dados text NOT NULL DEFAULT 'AGORA' CHECK (fonte_dados IN ('PNCP', 'COMPRAS_GOV', 'CONTRATOS_GOV', 'SIAFI', 'AGORA')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fornecedores_documento_unico UNIQUE (documento)
);

CREATE TABLE fornecedores_socios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
  cpf text NOT NULL CHECK (cpf ~ '^[0-9]{11}$'),
  nome text NOT NULL
);
CREATE INDEX fornecedores_socios_fornecedor_idx ON fornecedores_socios (fornecedor_id);
CREATE INDEX fornecedores_socios_cpf_idx ON fornecedores_socios (cpf);

CREATE TABLE fornecedores_indicadores (
  fornecedor_id uuid PRIMARY KEY REFERENCES fornecedores (id) ON DELETE CASCADE,
  entregas_no_prazo integer NOT NULL DEFAULT 0 CHECK (entregas_no_prazo >= 0),
  entregas_total integer NOT NULL DEFAULT 0 CHECK (entregas_total >= entregas_no_prazo),
  recebimentos_aprovados integer NOT NULL DEFAULT 0 CHECK (recebimentos_aprovados >= 0),
  recebimentos_total integer NOT NULL DEFAULT 0 CHECK (recebimentos_total >= recebimentos_aprovados),
  ocorrencias_fiscalizacao integer NOT NULL DEFAULT 0 CHECK (ocorrencias_fiscalizacao >= 0),
  ocorrencias_resolvidas_no_prazo integer NOT NULL DEFAULT 0 CHECK (ocorrencias_resolvidas_no_prazo >= 0),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
