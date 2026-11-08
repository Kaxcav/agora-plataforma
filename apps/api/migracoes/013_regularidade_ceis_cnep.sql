-- Regularidade do contratado (Lei 14.133/2021, art. 91, § 4º, e art. 92, XVI) e registro das sanções aplicadas
-- no CEIS/CNEP (art. 161): consultas com proveniência, certidões conferidas pelo agente, verificações executadas
-- nas travas e o protocolo do envio de cada sanção.

-- Base offline do CEIS e do CNEP: registros SIMULADOS da carga sintética, usados com AGORA_INTEGRACOES=offline.
CREATE TABLE ceis_cnep_simulados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento text NOT NULL CHECK (documento ~ '^[0-9]{11}$|^[0-9]{14}$'),
  cadastro text NOT NULL CHECK (cadastro IN ('CEIS', 'CNEP')),
  tipo_sancao text NOT NULL,
  orgao_sancionador text NOT NULL,
  esfera text,
  uf char(2),
  data_inicio date,
  data_fim date,
  numero_processo text,
  fundamentacao text,
  abrangencia text
);
CREATE INDEX ceis_cnep_simulados_documento_idx ON ceis_cnep_simulados (documento);

-- Consultas ao CEIS/CNEP (cache com proveniência): modo, fonte, instante, hash do conteúdo e quantidade.
-- Os registros guardados são normalizados, sem nomes nem documentos de pessoas.
CREATE TABLE consultas_ceis_cnep (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  fonte text NOT NULL,
  consultado_em timestamptz NOT NULL,
  hash_conteudo text NOT NULL,
  quantidade integer NOT NULL CHECK (quantidade >= 0),
  registros jsonb NOT NULL DEFAULT '[]'::jsonb,
  motivo text NOT NULL CHECK (motivo IN ('assinatura', 'prorrogacao', 'atesto', 'pagamento', 'consulta', 'carga')),
  consultado_por uuid REFERENCES usuarios (id)
);
CREATE INDEX consultas_ceis_cnep_fornecedor_idx ON consultas_ceis_cnep (fornecedor_id, consultado_em DESC);

-- Certidões de regularidade conferidas pelo agente (não há API aberta): CND federal, CRF do FGTS e CNDT.
CREATE TABLE certidoes_regularidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('fiscal_federal', 'fgts', 'trabalhista')),
  numero text NOT NULL,
  emissor text NOT NULL,
  emitida_em date NOT NULL,
  valida_ate date NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('negativa', 'positiva_com_efeitos_de_negativa', 'positiva')),
  observacao text,
  conferida_por uuid REFERENCES usuarios (id),
  conferida_em timestamptz NOT NULL,
  CONSTRAINT certidoes_regularidade_validade CHECK (valida_ate >= emitida_em)
);
CREATE INDEX certidoes_regularidade_fornecedor_idx ON certidoes_regularidade (fornecedor_id, tipo, valida_ate DESC);

-- Verificações executadas: travas da assinatura e da prorrogação e rechecagens do atesto e do pagamento.
CREATE TABLE verificacoes_regularidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id) ON DELETE CASCADE,
  momento text NOT NULL CHECK (momento IN ('assinatura', 'prorrogacao', 'atesto', 'pagamento')),
  instrumento_tipo text NOT NULL CHECK (instrumento_tipo IN ('processo', 'contrato', 'pagamento', 'fornecedor')),
  instrumento_id uuid NOT NULL,
  regular boolean NOT NULL,
  bloqueia boolean NOT NULL,
  consulta_id uuid REFERENCES consultas_ceis_cnep (id) ON DELETE SET NULL,
  falha_consulta text,
  resultado jsonb NOT NULL,
  verificado_por uuid REFERENCES usuarios (id),
  verificado_em timestamptz NOT NULL
);
CREATE INDEX verificacoes_regularidade_instrumento_idx ON verificacoes_regularidade (instrumento_tipo, instrumento_id, verificado_em DESC);
CREATE INDEX verificacoes_regularidade_fornecedor_idx ON verificacoes_regularidade (fornecedor_id, verificado_em DESC);

-- Envio da sanção aplicada ao CEIS/CNEP (art. 161): sem API pública de escrita, registra-se o protocolo do envio
-- feito no sistema da CGU, com o responsável e a data.
CREATE TABLE sancoes_envios_ceis_cnep (
  sancao_id uuid PRIMARY KEY REFERENCES sancoes (id) ON DELETE CASCADE,
  cadastro text NOT NULL CHECK (cadastro IN ('CEIS', 'CNEP')),
  protocolo text NOT NULL,
  enviado_em date NOT NULL,
  responsavel_id uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  observacao text
);
