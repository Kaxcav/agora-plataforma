-- Fila durável de integrações (RNF-07) e registro dos envios ao PNCP (RF-19).
--
-- fila_tarefas é o registro de estado de cada tarefa, nos dois transportes:
--   * PostgreSQL (demonstração, testes e PGlite): a própria tabela é a fila; o trabalhador reserva as tarefas
--     disponíveis com UPDATE ... RETURNING e as executa.
--   * RabbitMQ (AGORA_FILA_URL): a tabela funciona como caixa de saída transacional (gravada na mesma transação
--     da ação de negócio) e o RabbitMQ entrega os avisos ao trabalhador; esperas de nova tentativa usam filas com
--     TTL e a fila de erro guarda uma cópia de cada tarefa que esgotou as tentativas.
-- A chave de idempotência impede que a mesma operação seja enfileirada duas vezes.

CREATE TABLE fila_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('sincronizacao', 'pncp.compra', 'pncp.arquivo', 'pncp.contrato')),
  chave_idempotencia text NOT NULL,
  descricao text NOT NULL,
  carga jsonb NOT NULL DEFAULT '{}'::jsonb,
  uasg text REFERENCES uasgs (codigo),
  recurso_tipo text CHECK (recurso_tipo IN ('processo', 'contrato', 'sincronizacao')),
  recurso_id text,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'executando', 'concluida', 'erro')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  maximo_tentativas integer NOT NULL CHECK (maximo_tentativas BETWEEN 1 AND 100),
  disponivel_em timestamptz NOT NULL,
  bloqueada_ate timestamptz,
  despachada_em timestamptz,
  ultimo_erro text,
  resultado jsonb,
  solicitada_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL,
  atualizada_em timestamptz NOT NULL,
  concluida_em timestamptz,
  CONSTRAINT fila_tarefas_chave_unica UNIQUE (chave_idempotencia)
);
CREATE INDEX fila_tarefas_disponiveis_idx ON fila_tarefas (situacao, disponivel_em);
CREATE INDEX fila_tarefas_recurso_idx ON fila_tarefas (recurso_tipo, recurso_id);

-- Um envio ao PNCP por tarefa: o que foi enviado (arquivo e hash) e o que o PNCP devolveu (protocolo e número de controle).
CREATE TABLE pncp_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id uuid NOT NULL UNIQUE REFERENCES fila_tarefas (id),
  objeto text NOT NULL CHECK (objeto IN ('compra', 'arquivo', 'contrato')),
  processo_id uuid NOT NULL REFERENCES processos (id),
  contrato_id uuid REFERENCES contratos (id),
  documento_tipo text,
  titulo text NOT NULL,
  tipo_documento_pncp integer,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  hash_arquivo text CHECK (hash_arquivo IS NULL OR hash_arquivo ~ '^[0-9a-f]{64}$'),
  protocolo text,
  numero_controle text,
  sequencial_documento integer,
  enviado_em timestamptz,
  criado_em timestamptz NOT NULL
);
CREATE INDEX pncp_envios_processo_idx ON pncp_envios (processo_id);
