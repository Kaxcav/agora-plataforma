-- Rotas de contratação (F9: RF-34), dispensa eletrônica (RN-41), Sicx (RN-42) e cartão de pagamento (art. 75, § 4º).
-- A rota fica numa tabela própria ligada ao processo; sem linha, o processo segue a licitação (rota padrão).

CREATE TABLE processos_rotas (
  processo_id uuid PRIMARY KEY REFERENCES processos (id) ON DELETE CASCADE,
  rota text NOT NULL CHECK (rota IN ('licitacao', 'dispensa', 'inexigibilidade', 'adesao_ata', 'sicx')),
  hipotese_dispensa text CHECK (hipotese_dispensa IS NULL OR hipotese_dispensa IN ('valor_obras_engenharia', 'valor_demais', 'outra')),
  inciso_dispensa text,
  hipotese_inexigibilidade text CHECK (hipotese_inexigibilidade IS NULL
    OR hipotese_inexigibilidade IN ('exclusividade', 'artista', 'notoria_especializacao', 'credenciamento', 'imovel')),
  justificativa text,
  -- Ramo de atividade (art. 75, § 1º, II) e análise do agente quando há indício de fracionamento.
  natureza text,
  justificativa_fracionamento text,
  -- Comprovação da inexigibilidade (art. 74, §§ 1º a 5º).
  inexigibilidade jsonb,
  -- Autorização da contratação direta pela autoridade competente (art. 72, VIII).
  autorizacao jsonb,
  julgado_em timestamptz,
  escolhida_por uuid REFERENCES usuarios (id),
  escolhida_em timestamptz NOT NULL,
  atualizada_em timestamptz NOT NULL,
  CONSTRAINT processos_rotas_hipotese_coerente CHECK (
    (rota = 'dispensa' AND hipotese_dispensa IS NOT NULL) OR (rota <> 'dispensa' AND hipotese_dispensa IS NULL)
  )
);
CREATE INDEX processos_rotas_rota_idx ON processos_rotas (rota);

-- Aviso de contratação direta (art. 75, § 3º): divulgado no PNCP pela fila; o prazo de 3 dias úteis conta da publicação.
CREATE TABLE dispensas_avisos (
  processo_id uuid PRIMARY KEY REFERENCES processos (id) ON DELETE CASCADE,
  tarefa_id uuid NOT NULL REFERENCES fila_tarefas (id),
  situacao text NOT NULL CHECK (situacao IN ('na_fila', 'publicado', 'erro')),
  publicado_em date,
  encerramento date,
  protocolo text,
  numero_controle text,
  hash_arquivo text CHECK (hash_arquivo IS NULL OR hash_arquivo ~ '^[0-9a-f]{64}$'),
  modo text CHECK (modo IS NULL OR modo IN ('offline', 'online')),
  solicitado_por uuid REFERENCES usuarios (id),
  solicitado_em timestamptz NOT NULL,
  CONSTRAINT dispensas_avisos_publicacao_coerente CHECK ((situacao = 'publicado') = (publicado_em IS NOT NULL AND encerramento IS NOT NULL))
);

CREATE TABLE dispensas_propostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  valor bigint NOT NULL CHECK (valor > 0),
  adicional boolean NOT NULL,
  recebida_em timestamptz NOT NULL,
  registrada_por uuid REFERENCES usuarios (id),
  posicao integer CHECK (posicao IS NULL OR posicao > 0),
  motivo_desclassificacao text
);
CREATE INDEX dispensas_propostas_processo_idx ON dispensas_propostas (processo_id, recebida_em);

-- Adesão a ata por órgão não participante (art. 86, §§ 2º a 5º): uma por processo.
CREATE TABLE atas_adesoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  ata_id uuid NOT NULL REFERENCES atas (id),
  item_ata_id uuid NOT NULL REFERENCES itens_ata (id),
  uasg_aderente text NOT NULL REFERENCES uasgs (codigo),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  valor_unitario bigint NOT NULL CHECK (valor_unitario >= 0),
  justificativa_vantagem text NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('solicitada', 'aceita_fornecedor', 'autorizada', 'recusada')),
  aceite_fornecedor_em date,
  anuencia_em date,
  anuencia_por uuid REFERENCES usuarios (id),
  motivo_recusa text,
  solicitada_por uuid REFERENCES usuarios (id),
  solicitada_em timestamptz NOT NULL,
  CONSTRAINT atas_adesoes_processo_unico UNIQUE (processo_id),
  CONSTRAINT atas_adesoes_anuencia_coerente CHECK ((situacao = 'autorizada') = (anuencia_em IS NOT NULL))
);
CREATE INDEX atas_adesoes_item_idx ON atas_adesoes (item_ata_id, situacao);

-- Sicx (art. 79, IV; Decreto 13.106/2026): vitrine simulada no modo offline, reservas do ETP abrangente e compras.
CREATE TABLE sicx_ofertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_codigo text NOT NULL,
  item_descricao text NOT NULL,
  unidade text NOT NULL,
  categoria text NOT NULL,
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  preco_unitario bigint NOT NULL CHECK (preco_unitario > 0),
  faixas jsonb NOT NULL DEFAULT '[]'::jsonb,
  localidades text[] NOT NULL,
  prazo_entrega_dias integer NOT NULL CHECK (prazo_entrega_dias > 0),
  prazo_pagamento_dias integer NOT NULL CHECK (prazo_pagamento_dias > 0),
  restricao_cadin boolean NOT NULL DEFAULT false,
  credenciada boolean NOT NULL DEFAULT true,
  reputacao numeric(3, 2) NOT NULL CHECK (reputacao BETWEEN 0 AND 5),
  ativa boolean NOT NULL DEFAULT true,
  fonte text NOT NULL DEFAULT 'simulado' CHECK (fonte IN ('simulado', 'sicx')),
  busca_normalizada text NOT NULL DEFAULT '',
  atualizada_em timestamptz NOT NULL
);
CREATE INDEX sicx_ofertas_item_idx ON sicx_ofertas (item_codigo);

CREATE TABLE sicx_reservas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uasg text NOT NULL REFERENCES uasgs (codigo),
  descricao text NOT NULL,
  etp_referencia text NOT NULL,
  limite bigint NOT NULL CHECK (limite > 0),
  autorizacao_previa boolean NOT NULL,
  vigencia_fim date NOT NULL,
  criada_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL
);
CREATE INDEX sicx_reservas_uasg_idx ON sicx_reservas (uasg);

CREATE SEQUENCE sicx_compras_numero_seq START WITH 1;
CREATE TABLE sicx_compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  processo_id uuid REFERENCES processos (id) ON DELETE CASCADE,
  reserva_id uuid REFERENCES sicx_reservas (id),
  oferta_id uuid NOT NULL REFERENCES sicx_ofertas (id),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  preco_unitario bigint NOT NULL CHECK (preco_unitario > 0),
  valor_total bigint NOT NULL CHECK (valor_total > 0),
  posicao integer NOT NULL CHECK (posicao > 0),
  ranking jsonb NOT NULL,
  justificativa_selecao text,
  situacao text NOT NULL CHECK (situacao IN ('ordem_emitida', 'concluida', 'cancelada')),
  ordem_por uuid NOT NULL REFERENCES usuarios (id),
  ordem_em timestamptz NOT NULL,
  conclusao_por uuid REFERENCES usuarios (id),
  conclusao_em timestamptz,
  entrega_registrada_em date,
  recebimento_provisorio_em date,
  recebimento_definitivo_em date,
  pago_em date,
  CONSTRAINT sicx_compras_origem CHECK ((processo_id IS NULL) <> (reserva_id IS NULL)),
  CONSTRAINT sicx_compras_conclusao_coerente CHECK ((situacao = 'concluida') = (conclusao_em IS NOT NULL))
);
CREATE INDEX sicx_compras_uasg_idx ON sicx_compras (uasg);
CREATE INDEX sicx_compras_processo_idx ON sicx_compras (processo_id);
CREATE INDEX sicx_compras_reserva_idx ON sicx_compras (reserva_id);

-- Cartão de pagamento (art. 75, § 4º): compras por dispensa de valor e extrato mensal divulgado no PNCP.
CREATE TABLE cartao_pagamento_extratos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uasg text NOT NULL REFERENCES uasgs (codigo),
  competencia text NOT NULL CHECK (competencia ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  quantidade integer NOT NULL CHECK (quantidade >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  texto text NOT NULL,
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  tarefa_id uuid NOT NULL REFERENCES fila_tarefas (id),
  situacao text NOT NULL CHECK (situacao IN ('na_fila', 'publicado', 'erro')),
  protocolo text,
  modo text CHECK (modo IS NULL OR modo IN ('offline', 'online')),
  publicado_em timestamptz,
  solicitado_por uuid REFERENCES usuarios (id),
  solicitado_em timestamptz NOT NULL,
  CONSTRAINT cartao_extratos_competencia_unica UNIQUE (uasg, competencia)
);

CREATE TABLE cartao_pagamento_compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uasg text NOT NULL REFERENCES uasgs (codigo),
  data_compra date NOT NULL,
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  valor bigint NOT NULL CHECK (valor > 0),
  objeto text NOT NULL,
  natureza text NOT NULL,
  tipo_objeto text NOT NULL CHECK (tipo_objeto IN ('obras_servicos_engenharia', 'demais')),
  extrato_id uuid REFERENCES cartao_pagamento_extratos (id),
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL
);
CREATE INDEX cartao_compras_uasg_data_idx ON cartao_pagamento_compras (uasg, data_compra);

-- Novos tipos de tarefa da fila de integrações (frente B): publicação da contratação direta e do extrato do cartão.
-- A lista mantém os tipos das migrações anteriores (020: pncp.termo; 024: pncp.pca); a 029 repete a lista completa.
ALTER TABLE fila_tarefas DROP CONSTRAINT IF EXISTS fila_tarefas_tipo_check;
ALTER TABLE fila_tarefas ADD CONSTRAINT fila_tarefas_tipo_check
  CHECK (tipo IN ('sincronizacao', 'pncp.compra', 'pncp.arquivo', 'pncp.contrato', 'pncp.termo', 'pncp.pca', 'pncp.contratacao_direta', 'pncp.extrato_cartao'));
