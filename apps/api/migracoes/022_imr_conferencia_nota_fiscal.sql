-- Instrumento de medição de resultado (IMR) por contrato, medições periódicas e conferência da nota fiscal
-- (Lei 14.133/2021, art. 6º, XXIII, "g", e arts. 117, 140 e 141; IN SEGES/MP 5/2017, anexo VIII-A). RF-29 e RN-36.

-- Indicadores do IMR de cada contrato. As faixas de ajuste do pagamento (glosa) ficam em JSON, na ordem de
-- severidade validada por `validarIndicadorImr` (@agora/dominio). Com medições registradas, o indicador não é
-- mais editado: só encerrado a partir de uma competência, com justificativa.
CREATE TABLE imr_indicadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  codigo text NOT NULL CHECK (length(codigo) BETWEEN 1 AND 20),
  nome text NOT NULL CHECK (length(nome) BETWEEN 3 AND 200),
  forma_calculo text NOT NULL CHECK (forma_calculo IN ('percentual_razao', 'valor_medido')),
  descricao_calculo text NOT NULL,
  rotulo_numerador text,
  rotulo_denominador text,
  unidade text NOT NULL CHECK (length(unidade) BETWEEN 1 AND 30),
  sentido_meta text NOT NULL CHECK (sentido_meta IN ('maior_igual', 'menor_igual')),
  meta numeric NOT NULL,
  periodicidade text NOT NULL CHECK (periodicidade IN ('mensal', 'bimestral', 'trimestral', 'semestral')),
  inicio_competencia text NOT NULL CHECK (inicio_competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  fonte_medicao text NOT NULL,
  itens_alcancados uuid[] NOT NULL DEFAULT '{}',
  faixas jsonb NOT NULL,
  teto_percentual numeric CHECK (teto_percentual IS NULL OR (teto_percentual > 0 AND teto_percentual <= 100)),
  situacao text NOT NULL DEFAULT 'ativo' CHECK (situacao IN ('ativo', 'encerrado')),
  encerrado_apos text CHECK (encerrado_apos IS NULL OR encerrado_apos ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  justificativa_encerramento text,
  criado_por uuid REFERENCES usuarios (id),
  criado_em timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL,
  CONSTRAINT imr_indicadores_codigo_unico UNIQUE (contrato_id, codigo),
  CONSTRAINT imr_indicadores_encerramento_coerente CHECK (
    (situacao = 'encerrado') = (encerrado_apos IS NOT NULL) AND (encerrado_apos IS NULL) = (justificativa_encerramento IS NULL)
  )
);
CREATE INDEX imr_indicadores_contrato_idx ON imr_indicadores (contrato_id);

-- Medição de um indicador numa competência, registrada pela fiscalização com a evidência. O resultado, a faixa e o
-- percentual de glosa vêm de `calcularResultadoImr` e `calcularAjustePagamento`, com a memória de cálculo.
CREATE TABLE imr_medicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indicador_id uuid NOT NULL REFERENCES imr_indicadores (id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  numerador numeric,
  denominador numeric,
  valor_informado numeric,
  resultado numeric NOT NULL,
  atingiu_meta boolean NOT NULL,
  faixa integer CHECK (faixa IS NULL OR faixa >= 1),
  percentual_glosa numeric NOT NULL CHECK (percentual_glosa >= 0 AND percentual_glosa <= 100),
  encaminhar_sancionatorio boolean NOT NULL DEFAULT false,
  memoria_calculo jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidencia text NOT NULL CHECK (length(evidencia) BETWEEN 10 AND 2000),
  referencia_evidencia text,
  observacao text,
  pendencia_id uuid REFERENCES pendencias (id) ON DELETE SET NULL,
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL,
  CONSTRAINT imr_medicoes_competencia_unica UNIQUE (indicador_id, competencia)
);
CREATE INDEX imr_medicoes_contrato_idx ON imr_medicoes (contrato_id, competencia);

-- Conferência da nota fiscal de uma parcela (RN-36): número, valor e itens da nota, quantidade recebida, valor devido
-- com a glosa do IMR, divergências e a justificativa. Uma por pagamento; a correção da nota atualiza a linha (versão).
CREATE TABLE conferencias_nota_fiscal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id uuid NOT NULL REFERENCES pagamentos (id) ON DELETE CASCADE,
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  numero_nota text NOT NULL CHECK (length(numero_nota) BETWEEN 1 AND 60),
  emitida_em date NOT NULL,
  valor_nota bigint NOT NULL CHECK (valor_nota >= 0),
  itens jsonb NOT NULL,
  valor_bruto bigint NOT NULL CHECK (valor_bruto >= 0),
  glosas jsonb NOT NULL DEFAULT '[]'::jsonb,
  glosa_imr bigint NOT NULL CHECK (glosa_imr >= 0),
  valor_devido bigint NOT NULL CHECK (valor_devido >= 0),
  diferenca bigint NOT NULL,
  valor_a_liquidar bigint NOT NULL CHECK (valor_a_liquidar >= 0),
  divergencias jsonb NOT NULL DEFAULT '[]'::jsonb,
  memoria_calculo jsonb NOT NULL DEFAULT '[]'::jsonb,
  situacao text NOT NULL CHECK (situacao IN ('conforme', 'divergente', 'justificada')),
  justificativa text,
  justificada_por uuid REFERENCES usuarios (id),
  justificada_em timestamptz,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  conferida_por uuid REFERENCES usuarios (id),
  conferida_em timestamptz NOT NULL,
  CONSTRAINT conferencias_nota_fiscal_pagamento_unico UNIQUE (pagamento_id),
  CONSTRAINT conferencias_nota_fiscal_justificativa_coerente CHECK ((situacao = 'justificada') = (justificativa IS NOT NULL))
);
CREATE INDEX conferencias_nota_fiscal_contrato_idx ON conferencias_nota_fiscal (contrato_id, competencia);
