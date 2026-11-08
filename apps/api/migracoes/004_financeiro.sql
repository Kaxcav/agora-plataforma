-- Execução financeira: notas de empenho (SIAFI) e pagamentos (ordem cronológica, art. 141).

CREATE TABLE empenhos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  ano integer NOT NULL,
  emissao_em date NOT NULL,
  natureza_despesa text NOT NULL CHECK (natureza_despesa ~ '^[0-9]{6}$'),
  credor_documento text NOT NULL CHECK (credor_documento ~ '^[0-9]{11}$|^[0-9]{14}$'),
  credor_nome text NOT NULL,
  fornecedor_id uuid REFERENCES fornecedores (id),
  contrato_id uuid REFERENCES contratos (id),
  valor_empenhado bigint NOT NULL CHECK (valor_empenhado >= 0),
  valor_liquidado bigint NOT NULL DEFAULT 0 CHECK (valor_liquidado >= 0),
  valor_pago bigint NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
  restos_a_pagar boolean NOT NULL DEFAULT false,
  fonte_dados text NOT NULL DEFAULT 'SIAFI' CHECK (fonte_dados IN ('PNCP', 'COMPRAS_GOV', 'CONTRATOS_GOV', 'SIAFI', 'AGORA')),
  busca_normalizada text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empenhos_numero_unico UNIQUE (uasg, numero)
);
CREATE INDEX empenhos_uasg_idx ON empenhos (uasg);
CREATE INDEX empenhos_contrato_idx ON empenhos (contrato_id);
CREATE INDEX empenhos_fornecedor_idx ON empenhos (fornecedor_id);
CREATE INDEX empenhos_ano_idx ON empenhos (ano);

CREATE TABLE empenhos_itens (
  empenho_id uuid NOT NULL REFERENCES empenhos (id) ON DELETE CASCADE,
  item_contrato_id uuid NOT NULL REFERENCES itens_contrato (id) ON DELETE CASCADE,
  quantidade integer NOT NULL CHECK (quantidade >= 0),
  valor bigint NOT NULL CHECK (valor >= 0),
  PRIMARY KEY (empenho_id, item_contrato_id)
);
CREATE INDEX empenhos_itens_item_idx ON empenhos_itens (item_contrato_id);

CREATE TABLE pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id),
  empenho_id uuid REFERENCES empenhos (id),
  nota_fiscal text NOT NULL,
  competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-[0-9]{2}$'),
  valor bigint NOT NULL CHECK (valor >= 0),
  vencimento date NOT NULL,
  pago_em date,
  situacao text NOT NULL CHECK (situacao IN ('previsto', 'atestado', 'liquidado', 'pago')),
  atestado_por uuid REFERENCES usuarios (id),
  atestado_em timestamptz,
  fonte_recurso text NOT NULL DEFAULT '1000',
  busca_normalizada text NOT NULL DEFAULT '',
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagamentos_pago_coerente CHECK ((situacao = 'pago') = (pago_em IS NOT NULL))
);
CREATE INDEX pagamentos_contrato_idx ON pagamentos (contrato_id);
CREATE INDEX pagamentos_situacao_idx ON pagamentos (situacao);
CREATE INDEX pagamentos_vencimento_idx ON pagamentos (vencimento);
