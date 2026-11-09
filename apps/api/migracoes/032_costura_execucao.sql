-- Migração 032: Costura da execução contratual
-- 1. Unificação do livro de ocorrências (contratos_ocorrencias e ocorrencias_execucao)
-- 2. Suporte a quantidade e itens no recebimento definitivo para conferência da nota

-- 1.1 Expandir contratos_ocorrencias para comportar campos da frente N
ALTER TABLE contratos_ocorrencias
  ADD COLUMN IF NOT EXISTS categoria text CHECK (categoria IS NULL OR categoria IN ('prazo', 'qualidade', 'nivel_servico', 'garantia', 'quantitativo', 'fiscalizacao')),
  ADD COLUMN IF NOT EXISTS dias_atraso integer CHECK (dias_atraso IS NULL OR dias_atraso > 0),
  ADD COLUMN IF NOT EXISTS valor_glosa bigint CHECK (valor_glosa IS NULL OR valor_glosa > 0);

-- Ajustar restrições de tipo e situacao para aceitar o vocabulário unificado
ALTER TABLE contratos_ocorrencias DROP CONSTRAINT IF EXISTS contratos_ocorrencias_tipo_check;
ALTER TABLE contratos_ocorrencias ADD CONSTRAINT contratos_ocorrencias_tipo_check
  CHECK (tipo IN ('falha_execucao', 'atraso', 'inconformidade', 'comunicacao', 'outra', 'ocorrencia', 'glosa', 'rescisao'));

ALTER TABLE contratos_ocorrencias DROP CONSTRAINT IF EXISTS contratos_ocorrencias_situacao_check;
ALTER TABLE contratos_ocorrencias ADD CONSTRAINT contratos_ocorrencias_situacao_check
  CHECK (situacao IN ('aberta', 'regularizada', 'resolvida_no_prazo', 'resolvida_fora_do_prazo'));

-- 1.2 Migrar ocorrências existentes de ocorrencias_execucao para contratos_ocorrencias
INSERT INTO contratos_ocorrencias (
  id, contrato_id, numero, tipo, categoria, data_fato, relato,
  dias_atraso, valor_glosa, situacao, regularizada_em,
  registrada_por, registrada_em
)
SELECT
  oe.id,
  oe.contrato_id,
  COALESCE(
    (SELECT COALESCE(MAX(co.numero), 0) FROM contratos_ocorrencias co WHERE co.contrato_id = oe.contrato_id), 0
  ) + ROW_NUMBER() OVER (PARTITION BY oe.contrato_id ORDER BY oe.data, oe.registrada_em),
  oe.tipo,
  oe.categoria,
  oe.data,
  oe.descricao,
  oe.dias_atraso,
  oe.valor_glosa,
  oe.situacao,
  oe.resolvida_em,
  oe.registrada_por,
  oe.registrada_em
FROM ocorrencias_execucao oe
WHERE NOT EXISTS (SELECT 1 FROM contratos_ocorrencias co WHERE co.id = oe.id);

-- 1.3 Transformar ocorrencias_execucao em VIEW sobre o livro unificado contratos_ocorrencias
DROP TABLE IF EXISTS ocorrencias_execucao CASCADE;

CREATE VIEW ocorrencias_execucao AS
SELECT
  co.id,
  co.contrato_id,
  c.uasg,
  co.tipo,
  COALESCE(co.categoria,
    CASE co.tipo
      WHEN 'atraso' THEN 'prazo'
      WHEN 'glosa' THEN 'nivel_servico'
      WHEN 'rescisao' THEN 'garantia'
      WHEN 'falha_execucao' THEN 'qualidade'
      WHEN 'inconformidade' THEN 'qualidade'
      WHEN 'comunicacao' THEN 'fiscalizacao'
      ELSE 'qualidade'
    END
  ) AS categoria,
  co.data_fato AS data,
  co.relato AS descricao,
  co.dias_atraso,
  co.valor_glosa,
  co.situacao,
  co.regularizada_em AS resolvida_em,
  co.registrada_por,
  co.registrada_em
FROM contratos_ocorrencias co
JOIN contratos c ON c.id = co.contrato_id;

-- Triggers na view para garantir compatibilidade caso haja inserção/atualização via view
CREATE OR REPLACE FUNCTION tg_ocorrencias_execucao_inserir() RETURNS TRIGGER AS $$
DECLARE
  v_numero integer;
BEGIN
  SELECT COALESCE(MAX(numero), 0) + 1 INTO v_numero FROM contratos_ocorrencias WHERE contrato_id = NEW.contrato_id;
  INSERT INTO contratos_ocorrencias (
    id, contrato_id, numero, tipo, categoria, data_fato, relato,
    dias_atraso, valor_glosa, situacao, regularizada_em,
    registrada_por, registrada_em
  ) VALUES (
    COALESCE(NEW.id, gen_random_uuid()),
    NEW.contrato_id,
    v_numero,
    NEW.tipo,
    NEW.categoria,
    NEW.data,
    NEW.descricao,
    NEW.dias_atraso,
    NEW.valor_glosa,
    NEW.situacao,
    NEW.resolvida_em,
    NEW.registrada_por,
    COALESCE(NEW.registrada_em, now())
  ) RETURNING id INTO NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ocorrencias_execucao_ins
INSTEAD OF INSERT ON ocorrencias_execucao
FOR EACH ROW EXECUTE FUNCTION tg_ocorrencias_execucao_inserir();

CREATE OR REPLACE FUNCTION tg_ocorrencias_execucao_atualizar() RETURNS TRIGGER AS $$
BEGIN
  UPDATE contratos_ocorrencias SET
    situacao = NEW.situacao,
    regularizada_em = NEW.resolvida_em,
    observacao_regularizacao = COALESCE(observacao_regularizacao, 'Solução registrada')
  WHERE id = OLD.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ocorrencias_execucao_upd
INSTEAD OF UPDATE ON ocorrencias_execucao
FOR EACH ROW EXECUTE FUNCTION tg_ocorrencias_execucao_atualizar();

-- 2. Quantidade e itens nos recebimentos para alimentar a conferência da nota
ALTER TABLE contratos_recebimentos
  ADD COLUMN IF NOT EXISTS quantidade integer DEFAULT 1 CHECK (quantidade IS NULL OR quantidade > 0),
  ADD COLUMN IF NOT EXISTS itens jsonb;

-- 3. Notificação ao emitente da garantia na central de notificações
ALTER TABLE notificacoes_envios DROP CONSTRAINT IF EXISTS notificacoes_envios_papel_check;
ALTER TABLE notificacoes_envios ADD CONSTRAINT notificacoes_envios_papel_check
  CHECK (papel IN ('gestor', 'fiscal', 'contratada', 'responsavel', 'emitente_garantia'));

ALTER TABLE notificacoes_envios DROP CONSTRAINT IF EXISTS notificacoes_envios_destinatario;
ALTER TABLE notificacoes_envios ADD CONSTRAINT notificacoes_envios_destinatario
  CHECK (usuario_id IS NOT NULL OR fornecedor_id IS NOT NULL OR papel = 'emitente_garantia');

