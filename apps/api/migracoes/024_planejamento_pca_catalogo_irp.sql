-- Planejamento das contratações (frente O): plano de contratações anual (F10, RF-31), catálogo CATMAT/CATSER
-- (F19, RIA-13) e intenção de registro de preços (F5, RN-38).
--
-- * pca_planos / pca_demandas / pca_itens: as unidades registram as demandas do plano de cada UASG e exercício; a
--   consolidação agrega as de mesma natureza em itens numerados (Decreto 10.947/2022, art. 11); a autoridade aprova
--   e a publicação no PNCP segue pela fila de integrações (tarefa 'pncp.pca'), com a prova do envio no próprio plano.
--   Planos com origem 'pncp' foram lidos do PNCP pelo conector do servidor (modo online).
-- * dfd_vinculos_pca: o DFD aponta o item do PCA publicado ou traz a justificativa da contratação não planejada
--   (art. 18, § 1º, II). Exatamente um dos dois.
-- * catalogo_itens / catalogo_consultas: cache local do catálogo de materiais e serviços (API de dados abertos de
--   compras, só no servidor) e a proveniência de cada consulta (modo, endereço, quantidade e hash).
-- * irps / irp_adesoes: intenção de registro de preços aberta por pelo menos 8 dias úteis (art. 86; Decreto
--   11.462/2023, art. 9º), as adesões das UASGs participantes e a consolidação das quantidades.

-- A fila de integrações passa a aceitar a publicação do PCA no PNCP.
ALTER TABLE fila_tarefas DROP CONSTRAINT IF EXISTS fila_tarefas_tipo_check;
ALTER TABLE fila_tarefas ADD CONSTRAINT fila_tarefas_tipo_check
  CHECK (tipo IN ('sincronizacao', 'pncp.compra', 'pncp.arquivo', 'pncp.contrato', 'pncp.pca'));

CREATE TABLE pca_planos (
  id uuid PRIMARY KEY,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  ano integer NOT NULL CHECK (ano BETWEEN 2021 AND 2999),
  situacao text NOT NULL CHECK (situacao IN ('em_elaboracao', 'consolidado', 'aprovado', 'publicado')),
  origem text NOT NULL DEFAULT 'agora' CHECK (origem IN ('agora', 'pncp')),
  consolidado_por uuid REFERENCES usuarios (id),
  consolidado_em timestamptz,
  aprovado_por uuid REFERENCES usuarios (id),
  aprovado_em timestamptz,
  devolucao_motivo text,
  devolvido_por uuid REFERENCES usuarios (id),
  devolvido_em timestamptz,
  tarefa_publicacao_id uuid REFERENCES fila_tarefas (id),
  id_pncp text,
  protocolo_pncp text,
  modo_publicacao text CHECK (modo_publicacao IS NULL OR modo_publicacao IN ('offline', 'online')),
  hash_envio text CHECK (hash_envio IS NULL OR hash_envio ~ '^[0-9a-f]{64}$'),
  publicado_em timestamptz,
  criado_por uuid REFERENCES usuarios (id),
  criado_em timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL,
  CONSTRAINT pca_planos_uasg_ano_unico UNIQUE (uasg, ano)
);

CREATE TABLE pca_itens (
  id uuid PRIMARY KEY,
  plano_id uuid NOT NULL REFERENCES pca_planos (id) ON DELETE CASCADE,
  numero integer NOT NULL CHECK (numero BETWEEN 1 AND 9999),
  descricao text NOT NULL,
  codigo_catalogo text CHECK (codigo_catalogo IS NULL OR codigo_catalogo ~ '^[0-9]{1,9}$'),
  tipo_catalogo text CHECK (tipo_catalogo IS NULL OR tipo_catalogo IN ('material', 'servico')),
  unidade_fornecimento text NOT NULL,
  categoria text NOT NULL,
  quantidade double precision NOT NULL CHECK (quantidade > 0),
  valor_unitario bigint NOT NULL CHECK (valor_unitario >= 0),
  valor_total bigint NOT NULL CHECK (valor_total >= 0),
  data_desejada date NOT NULL,
  prioridade text NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta')),
  unidades_requisitantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT pca_itens_numero_unico UNIQUE (plano_id, numero)
);
CREATE INDEX pca_itens_catalogo_idx ON pca_itens (codigo_catalogo);

CREATE TABLE pca_demandas (
  id uuid PRIMARY KEY,
  plano_id uuid NOT NULL REFERENCES pca_planos (id) ON DELETE CASCADE,
  unidade_requisitante text NOT NULL,
  descricao text NOT NULL,
  codigo_catalogo text CHECK (codigo_catalogo IS NULL OR codigo_catalogo ~ '^[0-9]{1,9}$'),
  tipo_catalogo text CHECK (tipo_catalogo IS NULL OR tipo_catalogo IN ('material', 'servico')),
  unidade_fornecimento text NOT NULL,
  categoria text NOT NULL CHECK (categoria IN ('material', 'servico', 'obras', 'servicos_engenharia', 'solucoes_tic', 'locacao_imoveis',
                                              'alienacao_concessao_permissao', 'obras_servicos_engenharia')),
  quantidade double precision NOT NULL CHECK (quantidade > 0),
  valor_unitario bigint NOT NULL CHECK (valor_unitario > 0),
  data_desejada date NOT NULL,
  prioridade text NOT NULL CHECK (prioridade IN ('baixa', 'media', 'alta')),
  item_id uuid REFERENCES pca_itens (id) ON DELETE SET NULL,
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL
);
CREATE INDEX pca_demandas_plano_idx ON pca_demandas (plano_id, registrada_em);

-- Consultas do PCA publicado no PNCP feitas pelo conector (proveniência).
CREATE TABLE pca_consultas_pncp (
  id uuid PRIMARY KEY,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  ano integer NOT NULL CHECK (ano BETWEEN 2021 AND 2999),
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  endereco text,
  registros integer NOT NULL CHECK (registros >= 0),
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  consultado_por uuid REFERENCES usuarios (id),
  consultado_em timestamptz NOT NULL
);
CREATE INDEX pca_consultas_pncp_uasg_idx ON pca_consultas_pncp (uasg, consultado_em DESC);

CREATE TABLE dfd_vinculos_pca (
  processo_id uuid PRIMARY KEY REFERENCES processos (id) ON DELETE CASCADE,
  pca_item_id uuid REFERENCES pca_itens (id),
  justificativa_fora_pca text,
  registrado_por uuid REFERENCES usuarios (id),
  registrado_em timestamptz NOT NULL,
  CONSTRAINT dfd_vinculos_pca_item_ou_justificativa CHECK ((pca_item_id IS NULL) <> (justificativa_fora_pca IS NULL))
);

CREATE TABLE catalogo_itens (
  tipo text NOT NULL CHECK (tipo IN ('material', 'servico')),
  codigo text NOT NULL CHECK (codigo ~ '^[0-9]{1,9}$'),
  descricao text NOT NULL,
  descricao_normalizada text NOT NULL,
  classe_codigo text,
  classe_nome text,
  pdm_codigo text,
  pdm_nome text,
  sustentavel boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL CHECK (origem IN ('seed', 'api')),
  atualizado_em timestamptz NOT NULL,
  PRIMARY KEY (tipo, codigo)
);

CREATE TABLE catalogo_consultas (
  id uuid PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo IN ('material', 'servico')),
  termo text NOT NULL,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  endereco text,
  registros integer NOT NULL CHECK (registros >= 0),
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  consultado_por uuid REFERENCES usuarios (id),
  consultado_em timestamptz NOT NULL
);
CREATE INDEX catalogo_consultas_termo_idx ON catalogo_consultas (tipo, termo, consultado_em DESC);

CREATE TABLE irps (
  id uuid PRIMARY KEY,
  numero text NOT NULL UNIQUE,
  uasg_gerenciadora text NOT NULL REFERENCES uasgs (codigo),
  processo_id uuid REFERENCES processos (id),
  objeto text NOT NULL,
  codigo_catalogo text CHECK (codigo_catalogo IS NULL OR codigo_catalogo ~ '^[0-9]{1,9}$'),
  unidade_fornecimento text NOT NULL,
  quantidade_gerenciador double precision NOT NULL CHECK (quantidade_gerenciador > 0),
  abertura date NOT NULL,
  encerramento date NOT NULL,
  -- RN-38: pelo menos 8 dias úteis (contados pelo servidor com o calendário do órgão).
  dias_uteis integer NOT NULL CHECK (dias_uteis >= 8),
  consolidacao jsonb,
  consolidada_por uuid REFERENCES usuarios (id),
  consolidada_em timestamptz,
  criada_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL,
  CONSTRAINT irps_periodo CHECK (encerramento > abertura)
);
CREATE INDEX irps_processo_idx ON irps (processo_id);

CREATE TABLE irp_adesoes (
  id uuid PRIMARY KEY,
  irp_id uuid NOT NULL REFERENCES irps (id) ON DELETE CASCADE,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  quantidade double precision NOT NULL CHECK (quantidade > 0),
  manifestacao text NOT NULL,
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL,
  CONSTRAINT irp_adesoes_unica UNIQUE (irp_id, uasg)
);
