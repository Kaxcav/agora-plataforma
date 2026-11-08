-- Controle das contratações (Lei 14.133/2021, arts. 169 a 171): perfil "Controle interno" (2ª linha de defesa),
-- medidas de controle externo com prazos de resposta (RF-24, RN-30) e revisões trimestrais da matriz de riscos
-- do contrato (RN-29).

-- Perfil "controle_interno": acrescenta o código à lista aceita, preservando os perfis que outras migrações
-- tenham acrescentado antes desta (a lista atual é lida do próprio catálogo do banco).
DO $$
DECLARE
  definicao text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO definicao
    FROM pg_constraint c
   WHERE c.conrelid = 'usuarios_perfis'::regclass AND c.conname = 'usuarios_perfis_perfil_check';
  IF definicao IS NOT NULL AND position('controle_interno' IN definicao) = 0 THEN
    EXECUTE 'ALTER TABLE usuarios_perfis DROP CONSTRAINT usuarios_perfis_perfil_check';
    EXECUTE 'ALTER TABLE usuarios_perfis ADD CONSTRAINT usuarios_perfis_perfil_check '
      || replace(definicao, '])', ', ''controle_interno''::text])');
  END IF;
END $$;

-- Medidas do tribunal de contas (TCU) e do órgão central de controle interno (CGU) sobre um processo da jornada
-- ou um contrato. A cautelar com efeito suspensivo bloqueia o avanço e a contratação até a revogação (RN-30).
CREATE TABLE medidas_controle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orgao text NOT NULL CHECK (orgao IN ('TCU', 'CGU')),
  tipo text NOT NULL CHECK (tipo IN ('cautelar', 'determinacao', 'diligencia', 'recomendacao')),
  numero text NOT NULL CHECK (length(numero) BETWEEN 1 AND 60),
  decidida_em date NOT NULL,
  ciencia_em date NOT NULL,
  objeto text NOT NULL,
  efeito_suspensivo boolean NOT NULL DEFAULT false,
  processo_id uuid REFERENCES processos (id),
  contrato_id uuid REFERENCES contratos (id),
  uasg text NOT NULL REFERENCES uasgs (codigo),
  prazo_resposta date NOT NULL,
  dias_uteis_prazo integer NOT NULL CHECK (dias_uteis_prazo BETWEEN 1 AND 120),
  fundamento_prazo text NOT NULL,
  prorrogado_ate date,
  justificativa_prorrogacao text,
  respondida_em date,
  resposta text,
  respondida_por uuid REFERENCES usuarios (id),
  revogada_em date,
  revogacao text,
  revogada_por uuid REFERENCES usuarios (id),
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL,
  busca_normalizada text NOT NULL DEFAULT '',
  CONSTRAINT medidas_controle_alvo_unico CHECK ((processo_id IS NULL) <> (contrato_id IS NULL)),
  CONSTRAINT medidas_controle_suspensao_cautelar CHECK (NOT efeito_suspensivo OR tipo = 'cautelar'),
  CONSTRAINT medidas_controle_ciencia_valida CHECK (ciencia_em >= decidida_em),
  CONSTRAINT medidas_controle_prorrogacao_coerente CHECK (
    (prorrogado_ate IS NULL) = (justificativa_prorrogacao IS NULL) AND (prorrogado_ate IS NULL OR prorrogado_ate >= prazo_resposta)
  ),
  CONSTRAINT medidas_controle_resposta_coerente CHECK ((respondida_em IS NULL) = (resposta IS NULL)),
  CONSTRAINT medidas_controle_revogacao_coerente CHECK ((revogada_em IS NULL) = (revogacao IS NULL))
);
CREATE INDEX medidas_controle_processo_idx ON medidas_controle (processo_id);
CREATE INDEX medidas_controle_contrato_idx ON medidas_controle (contrato_id);
CREATE INDEX medidas_controle_uasg_idx ON medidas_controle (uasg);

-- Revisões trimestrais da matriz de riscos de cada contrato (RN-29): a matriz revisada inteira, a linha de defesa
-- que revisou e a observação. A matriz vigente do contrato é a da revisão mais recente.
CREATE TABLE revisoes_matriz_riscos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  revisada_em date NOT NULL,
  linha text NOT NULL CHECK (linha IN ('primeira', 'segunda')),
  riscos jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacao text NOT NULL,
  revisada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL
);
CREATE INDEX revisoes_matriz_riscos_contrato_idx ON revisoes_matriz_riscos (contrato_id, revisada_em DESC, registrada_em DESC);
