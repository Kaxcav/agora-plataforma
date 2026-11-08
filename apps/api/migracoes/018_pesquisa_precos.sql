-- Pesquisa de preços automatizada (RF-25) e projeção cambial e inflacionária do valor estimado (RIA-11).
-- As fontes externas são consultadas só pelo servidor; cada consulta guarda a proveniência (modo, horário,
-- quantidade e hash) de cada fonte. As sugestões entram na cesta do processo apenas por escolha do agente.

CREATE TABLE consultas_precos (
  id uuid PRIMARY KEY,
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  item jsonb NOT NULL,
  termo text NOT NULL,
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  fontes jsonb NOT NULL,
  sugestoes jsonb NOT NULL,
  descartadas jsonb NOT NULL DEFAULT '[]'::jsonb,
  excedentes integer NOT NULL DEFAULT 0 CHECK (excedentes >= 0),
  alertas jsonb NOT NULL DEFAULT '[]'::jsonb,
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  executada_por uuid REFERENCES usuarios (id),
  executada_em timestamptz NOT NULL
);
CREATE INDEX consultas_precos_processo_idx ON consultas_precos (processo_id, executada_em DESC);

-- Séries oficiais mensais (IPCA do IBGE e câmbio do Banco Central). Em modo offline, vêm da carga sintética.
CREATE TABLE indices_economicos (
  serie text NOT NULL CHECK (serie IN ('IPCA', 'CAMBIO_USD')),
  competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  valor numeric(14, 6) NOT NULL,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  fonte text NOT NULL,
  consultado_em timestamptz NOT NULL,
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (serie, competencia)
);

CREATE TABLE projecoes_valor_estimado (
  id uuid PRIMARY KEY,
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  data_prevista date NOT NULL,
  percentual_cambial numeric(5, 2) NOT NULL CHECK (percentual_cambial BETWEEN 0 AND 100),
  resultado jsonb NOT NULL,
  gerada_por uuid REFERENCES usuarios (id),
  gerada_em timestamptz NOT NULL
);
CREATE INDEX projecoes_valor_estimado_processo_idx ON projecoes_valor_estimado (processo_id, gerada_em DESC);

-- Tabelas oficiais de referência de obras (Sinapi e Sicro), importadas no servidor: não há API pública desses sistemas.
CREATE TABLE referencias_engenharia_lotes (
  sistema text NOT NULL CHECK (sistema IN ('SINAPI', 'SICRO')),
  uf text NOT NULL CHECK (uf ~ '^[A-Z]{2}$'),
  data_base text NOT NULL CHECK (data_base ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  desonerado boolean NOT NULL,
  itens integer NOT NULL CHECK (itens > 0),
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  importado_por uuid REFERENCES usuarios (id),
  importado_em timestamptz NOT NULL,
  PRIMARY KEY (sistema, uf, data_base, desonerado)
);

CREATE TABLE referencias_engenharia (
  sistema text NOT NULL,
  uf text NOT NULL,
  data_base text NOT NULL,
  desonerado boolean NOT NULL,
  codigo text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 40),
  descricao text NOT NULL,
  unidade text NOT NULL,
  preco bigint NOT NULL CHECK (preco > 0),
  busca_normalizada text NOT NULL,
  PRIMARY KEY (sistema, uf, data_base, desonerado, codigo),
  FOREIGN KEY (sistema, uf, data_base, desonerado) REFERENCES referencias_engenharia_lotes (sistema, uf, data_base, desonerado) ON DELETE CASCADE
);
