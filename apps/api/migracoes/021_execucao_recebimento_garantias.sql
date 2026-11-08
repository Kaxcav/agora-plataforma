-- Execução contratual como ato, parte 2 (F22, frente L): fiscalização (art. 117), recebimento provisório e definitivo
-- (art. 140; RN-34), garantias (arts. 96 a 102; RN-35), desconto de multa (art. 156, § 8º), prazos de liquidação e de
-- pagamento (art. 92, V e VI) e alteração justificada da ordem cronológica (art. 141, § 1º).
-- Toda escrita nestas tabelas é feita pela API na mesma transação do evento da trilha de auditoria.

-- Prazos e critérios de execução definidos no contrato (art. 140, § 3º; art. 92, V a VII).
CREATE TABLE contratos_parametros_execucao (
  contrato_id uuid PRIMARY KEY REFERENCES contratos (id) ON DELETE CASCADE,
  prazo_provisorio_dias_uteis integer NOT NULL CHECK (prazo_provisorio_dias_uteis BETWEEN 1 AND 90),
  prazo_definitivo_dias_uteis integer NOT NULL CHECK (prazo_definitivo_dias_uteis BETWEEN 1 AND 180),
  prazo_correcao_dias_uteis integer NOT NULL CHECK (prazo_correcao_dias_uteis BETWEEN 1 AND 180),
  prazo_liquidacao_dias_uteis integer NOT NULL CHECK (prazo_liquidacao_dias_uteis BETWEEN 1 AND 60),
  prazo_pagamento_dias integer NOT NULL CHECK (prazo_pagamento_dias BETWEEN 1 AND 120),
  marco_pagamento text NOT NULL CHECK (marco_pagamento IN ('recebimento_definitivo', 'liquidacao')),
  indice_atualizacao text NOT NULL DEFAULT 'IPCA',
  juros_mora_mensal numeric(5, 3) NOT NULL DEFAULT 0 CHECK (juros_mora_mensal BETWEEN 0 AND 2),
  garantia_objeto_meses integer NOT NULL DEFAULT 0 CHECK (garantia_objeto_meses BETWEEN 0 AND 120),
  -- Período antecedente à ordem de serviço (art. 92, § 2º) e reservas de vagas exigidas no edital (art. 92, XVII).
  periodo_antecedente_dias_uteis integer NOT NULL DEFAULT 0 CHECK (periodo_antecedente_dias_uteis BETWEEN 0 AND 60),
  reserva_mulheres_percentual numeric(5, 2) NOT NULL DEFAULT 0 CHECK (reserva_mulheres_percentual BETWEEN 0 AND 100),
  reserva_egressos boolean NOT NULL DEFAULT false,
  atualizado_por uuid REFERENCES usuarios (id),
  atualizado_em timestamptz
);

-- Designação do gestor, dos fiscais e da comissão de recebimento (art. 117). Encerrada = fim preenchido.
CREATE TABLE contratos_designacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('gestor', 'fiscal_tecnico', 'fiscal_administrativo', 'fiscal_requisitante', 'comissao_recebimento')),
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  substituto boolean NOT NULL DEFAULT false,
  ato text NOT NULL,
  inicio date NOT NULL,
  fim date,
  motivo_encerramento text,
  designado_por uuid REFERENCES usuarios (id),
  designado_em timestamptz NOT NULL,
  CONSTRAINT contratos_designacoes_periodo CHECK (fim IS NULL OR fim >= inicio)
);
CREATE INDEX contratos_designacoes_contrato_idx ON contratos_designacoes (contrato_id);
CREATE INDEX contratos_designacoes_usuario_idx ON contratos_designacoes (usuario_id);
-- Um titular ativo por papel (a comissão de recebimento tem vários membros); a mesma pessoa não repete o papel.
CREATE UNIQUE INDEX contratos_designacoes_titular_unico ON contratos_designacoes (contrato_id, papel, substituto)
  WHERE fim IS NULL AND papel <> 'comissao_recebimento';
CREATE UNIQUE INDEX contratos_designacoes_pessoa_unica ON contratos_designacoes (contrato_id, papel, usuario_id) WHERE fim IS NULL;

-- Livro de ocorrências do contrato (art. 117, § 1º).
CREATE TABLE contratos_ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero > 0),
  tipo text NOT NULL CHECK (tipo IN ('falha_execucao', 'atraso', 'inconformidade', 'comunicacao', 'outra')),
  data_fato date NOT NULL,
  relato text NOT NULL,
  providencia text,
  prazo_regularizacao date,
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'regularizada')),
  recebimento_id uuid,
  notificacao_id uuid REFERENCES notificacoes (id),
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL,
  regularizada_em date,
  observacao_regularizacao text,
  regularizada_por uuid REFERENCES usuarios (id),
  CONSTRAINT contratos_ocorrencias_numero_unico UNIQUE (contrato_id, numero)
);
CREATE INDEX contratos_ocorrencias_contrato_idx ON contratos_ocorrencias (contrato_id);

-- Entregas da contratada e o recebimento provisório e definitivo (art. 140; RN-34).
CREATE TABLE contratos_recebimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero > 0),
  descricao text NOT NULL,
  valor bigint NOT NULL CHECK (valor >= 0),
  entregue_em date NOT NULL,
  pagamento_id uuid REFERENCES pagamentos (id),
  situacao text NOT NULL CHECK (situacao IN ('aguardando_provisorio', 'aguardando_definitivo', 'em_correcao', 'recebido')),
  etapa_correcao text CHECK (etapa_correcao IS NULL OR etapa_correcao IN ('provisorio', 'definitivo')),
  prazo_atual date,
  prazo_correcao date,
  provisorio_aceito_por uuid REFERENCES usuarios (id),
  definitivo_em date,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  CONSTRAINT contratos_recebimentos_numero_unico UNIQUE (contrato_id, numero),
  CONSTRAINT contratos_recebimentos_definitivo_coerente CHECK ((situacao = 'recebido') = (definitivo_em IS NOT NULL))
);
CREATE INDEX contratos_recebimentos_contrato_idx ON contratos_recebimentos (contrato_id);
CREATE INDEX contratos_recebimentos_pagamento_idx ON contratos_recebimentos (pagamento_id);

CREATE TABLE recebimentos_termos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recebimento_id uuid NOT NULL REFERENCES contratos_recebimentos (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('provisorio', 'definitivo')),
  resultado text NOT NULL CHECK (resultado IN ('aceito', 'com_ressalva', 'rejeitado')),
  data date NOT NULL,
  observacoes text,
  prazo_correcao date,
  responsavel_id uuid NOT NULL REFERENCES usuarios (id),
  papel_responsavel text NOT NULL CHECK (papel_responsavel IN ('gestor', 'fiscal_tecnico', 'fiscal_administrativo', 'fiscal_requisitante', 'comissao_recebimento')),
  fora_do_prazo boolean NOT NULL DEFAULT false,
  hash_pdf text NOT NULL,
  registrado_em timestamptz NOT NULL
);
CREATE INDEX recebimentos_termos_recebimento_idx ON recebimentos_termos (recebimento_id);

ALTER TABLE contratos_ocorrencias
  ADD CONSTRAINT contratos_ocorrencias_recebimento_fk FOREIGN KEY (recebimento_id) REFERENCES contratos_recebimentos (id) ON DELETE SET NULL;

-- Data da liquidação (SIAFI): marco do prazo de pagamento quando o contrato conta da liquidação.
ALTER TABLE pagamentos ADD COLUMN liquidado_em date;

-- Garantias contratuais (arts. 96 a 102; RN-35) e garantia adicional de pagamento antecipado (art. 145, § 2º).
CREATE TABLE contratos_garantias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  finalidade text NOT NULL CHECK (finalidade IN ('execucao', 'antecipacao')),
  percentual numeric(6, 3) NOT NULL CHECK (percentual > 0 AND percentual <= 100),
  valor_base bigint NOT NULL CHECK (valor_base > 0),
  base_anual boolean NOT NULL DEFAULT false,
  valor_exigido bigint NOT NULL CHECK (valor_exigido >= 0),
  justificativa_percentual text,
  grande_vulto_engenharia boolean NOT NULL DEFAULT false,
  clausula_retomada boolean NOT NULL DEFAULT false,
  modalidade_exigida text CHECK (modalidade_exigida IS NULL OR modalidade_exigida IN ('caucao_dinheiro', 'caucao_titulos', 'seguro_garantia', 'fianca_bancaria', 'titulo_capitalizacao')),
  prazo_apresentacao date,
  modalidade text CHECK (modalidade IS NULL OR modalidade IN ('caucao_dinheiro', 'caucao_titulos', 'seguro_garantia', 'fianca_bancaria', 'titulo_capitalizacao')),
  valor bigint CHECK (valor IS NULL OR valor > 0),
  saldo bigint NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  emissor text,
  documento text,
  apresentada_em date,
  valida_ate date,
  situacao text NOT NULL CHECK (situacao IN ('aguardando_apresentacao', 'vigente', 'liberada', 'executada')),
  liberada_em date,
  valor_restituido bigint,
  pendencia_id uuid REFERENCES pendencias (id),
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL,
  CONSTRAINT contratos_garantias_apresentada_coerente CHECK (situacao = 'aguardando_apresentacao' OR (modalidade IS NOT NULL AND valor IS NOT NULL AND apresentada_em IS NOT NULL))
);
CREATE INDEX contratos_garantias_contrato_idx ON contratos_garantias (contrato_id);

CREATE TABLE garantias_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  garantia_id uuid NOT NULL REFERENCES contratos_garantias (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('exigencia', 'apresentacao', 'renovacao', 'desconto_multa', 'execucao', 'liberacao')),
  data date NOT NULL,
  valor bigint,
  descricao text NOT NULL,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL
);
CREATE INDEX garantias_movimentos_garantia_idx ON garantias_movimentos (garantia_id);

-- Desconto de multa aplicada: dos pagamentos devidos e, depois, da garantia (art. 156, § 8º), por decisão registrada.
CREATE TABLE multas_descontos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sancao_id uuid NOT NULL REFERENCES sancoes (id),
  contrato_id uuid NOT NULL REFERENCES contratos (id),
  origem text NOT NULL CHECK (origem IN ('pagamento', 'garantia')),
  pagamento_id uuid REFERENCES pagamentos (id),
  garantia_id uuid REFERENCES contratos_garantias (id),
  valor bigint NOT NULL CHECK (valor > 0),
  autoridade text NOT NULL,
  ato text NOT NULL,
  decidida_em date NOT NULL,
  justificativa text NOT NULL,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  CONSTRAINT multas_descontos_origem_coerente CHECK ((origem = 'pagamento') = (pagamento_id IS NOT NULL) AND (origem = 'garantia') = (garantia_id IS NOT NULL))
);
CREATE INDEX multas_descontos_sancao_idx ON multas_descontos (sancao_id);
CREATE INDEX multas_descontos_contrato_idx ON multas_descontos (contrato_id);
CREATE INDEX multas_descontos_pagamento_idx ON multas_descontos (pagamento_id);

-- Alteração justificada da ordem cronológica de pagamentos (art. 141, § 1º) e comunicações ao controle.
CREATE TABLE alteracoes_ordem_cronologica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id uuid NOT NULL REFERENCES pagamentos (id),
  inciso text NOT NULL CHECK (inciso IN ('I', 'II', 'III', 'IV', 'V')),
  justificativa text NOT NULL,
  autoridade text NOT NULL,
  ato text NOT NULL,
  decidida_em date NOT NULL,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL
);
CREATE INDEX alteracoes_ordem_pagamento_idx ON alteracoes_ordem_cronologica (pagamento_id);

CREATE TABLE alteracoes_ordem_comunicacoes (
  alteracao_id uuid NOT NULL REFERENCES alteracoes_ordem_cronologica (id) ON DELETE CASCADE,
  orgao text NOT NULL CHECK (orgao IN ('controle_interno', 'tribunal_contas')),
  data date NOT NULL,
  protocolo text NOT NULL,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  PRIMARY KEY (alteracao_id, orgao)
);

-- Ordens de serviço do contrato (art. 92, § 2º: período antecedente à expedição).
CREATE TABLE contratos_ordens_servico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  numero text NOT NULL,
  expedida_em date NOT NULL,
  descricao text NOT NULL,
  antes_do_periodo boolean NOT NULL DEFAULT false,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  CONSTRAINT contratos_ordens_servico_numero_unico UNIQUE (contrato_id, numero)
);
CREATE INDEX contratos_ordens_servico_contrato_idx ON contratos_ordens_servico (contrato_id);

-- Verificação das reservas legais de cargos na execução (art. 92, XVII; Decretos 11.430/2023 e 9.450/2018).
CREATE TABLE contratos_reservas_cargos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  empregados integer NOT NULL CHECK (empregados >= 0),
  mulheres integer NOT NULL CHECK (mulheres >= 0),
  egressos integer NOT NULL CHECK (egressos >= 0),
  pcd_comprovada boolean NOT NULL,
  aprendizes_comprovada boolean NOT NULL,
  atende boolean NOT NULL,
  resultado jsonb NOT NULL,
  observacao text,
  ocorrencia_id uuid REFERENCES contratos_ocorrencias (id),
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  CONSTRAINT contratos_reservas_cargos_competencia_unica UNIQUE (contrato_id, competencia)
);
CREATE INDEX contratos_reservas_cargos_contrato_idx ON contratos_reservas_cargos (contrato_id);
