-- IA ancorada (frente Q, F24): revisão humana das citações legais apontadas pela conferência (RIA-14).
-- A conferência em si é determinística e se recalcula a partir do texto do documento e da base normativa
-- (apps/api/dados/normas/). Aqui fica só o registro da revisão humana que libera a aprovação de um rascunho com
-- citação inexistente ou sem efeito: quem revisou, quando, a justificativa e as citações apontadas naquele momento.

CREATE TABLE revisoes_citacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id uuid NOT NULL REFERENCES documentos_gerados (id) ON DELETE CASCADE,
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  -- Hash do conteúdo revisado (o documento é imutável até a aprovação, que só troca a marca de rascunho).
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  citacoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  justificativa text NOT NULL CHECK (char_length(justificativa) BETWEEN 30 AND 2000),
  revisado_por uuid NOT NULL REFERENCES usuarios (id),
  revisado_em timestamptz NOT NULL,
  CONSTRAINT revisoes_citacoes_documento_unico UNIQUE (documento_id)
);
CREATE INDEX revisoes_citacoes_processo_idx ON revisoes_citacoes (processo_id);
