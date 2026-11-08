-- Sala de disputa (RF-22, RN-26, RIA-09): sessões simuladas (treino e prova de conceito) e acompanhamento da sessão
-- oficial, que acontece no Compras.gov.br. O estado da sessão (etapas, prorrogações, encerramento e classificação) é
-- recalculado a partir dos eventos por @agora/dominio (calcularEstadoSessao); aqui ficam só a definição e os eventos.
-- Toda escrita gera evento na trilha de auditoria (recurso 'sessao_disputa').

CREATE TABLE sessoes_disputa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  uso text NOT NULL CHECK (uso IN ('simulacao', 'acompanhamento')),
  criterio text NOT NULL CHECK (criterio IN ('menor_preco', 'maior_desconto', 'tecnica_e_preco')),
  modo text NOT NULL CHECK (modo IN ('aberto', 'aberto_fechado', 'fechado_aberto', 'fechado')),
  -- Parâmetros do rito com os ajustes do edital (IN SEGES/ME 73/2022; Lei 14.133/2021, arts. 36, § 2º, 56 e 57).
  parametros jsonb NOT NULL,
  -- Participantes: fornecedor do cadastro, chave anônima ("L1"…), proposta inicial, nota técnica e perfil simulado.
  participantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Eventos no relógio da sessão: abertura, lances, reinício, negociação e conclusão.
  eventos jsonb NOT NULL DEFAULT '[]'::jsonb,
  cenario text CHECK (cenario IS NULL OR cenario IN ('concorrencia', 'conluio_e_robo')),
  semente integer NOT NULL,
  valor_referencia bigint CHECK (valor_referencia IS NULL OR valor_referencia > 0),
  -- Adiantamento acumulado do relógio da simulação (milissegundos).
  deslocamento_ms bigint NOT NULL DEFAULT 0 CHECK (deslocamento_ms >= 0),
  id_compra text CHECK (id_compra IS NULL OR id_compra ~ '^[0-9]{8,30}$'),
  -- Compra e resultado trazidos do Compras.gov.br, com proveniência (hora, hash e quantidade).
  oficial jsonb,
  -- Resultado registrado no processo e ata emitida na conclusão.
  resultado jsonb,
  ata jsonb,
  conduzida_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL,
  atualizada_em timestamptz NOT NULL,
  concluida_em timestamptz,
  CONSTRAINT sessoes_disputa_acompanhamento_com_compra CHECK (uso = 'simulacao' OR id_compra IS NOT NULL)
);
CREATE INDEX sessoes_disputa_processo_idx ON sessoes_disputa (processo_id, criada_em DESC);
