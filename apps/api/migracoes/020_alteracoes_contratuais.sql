-- Frente K (F22a): execução contratual como ato — termo aditivo com a trava do art. 125 (RN-32), prorrogação com os
-- limites dos arts. 105 a 114 (RN-33), reajuste e repactuação por apostila, reequilíbrio e extinção (RF-27).
--
-- alteracoes_contratuais guarda o ciclo de cada ato (proposta, parecer jurídico, contraditório, decisão, assinatura e
-- divulgação no PNCP). A tabela aditivos continua sendo o livro dos termos assinados que compõem o valor global
-- (vw_contratos_valores): na assinatura, o ato grava ali a sua linha e guarda o vínculo em aditivo_id.

-- Natureza do contrato quanto à duração (arts. 105 a 114), regime de mão de obra (art. 135) e data da extinção.
ALTER TABLE contratos ADD COLUMN natureza_duracao text
  CHECK (natureza_duracao IS NULL OR natureza_duracao IN ('continuo', 'ti_estruturante', 'escopo', 'receita_sem_investimento', 'receita_com_investimento'));
ALTER TABLE contratos ADD COLUMN regime_mao_obra text
  CHECK (regime_mao_obra IS NULL OR regime_mao_obra IN ('dedicacao_exclusiva', 'predominancia', 'sem_dedicacao'));
ALTER TABLE contratos ADD COLUMN extinto_em date;

-- Alteração qualitativa sem reflexo financeiro e reequilíbrio (que pode reduzir o valor) entram no livro de aditivos.
ALTER TABLE aditivos DROP CONSTRAINT aditivos_tipo_check;
ALTER TABLE aditivos ADD CONSTRAINT aditivos_tipo_check
  CHECK (tipo IN ('acrescimo', 'supressao', 'prorrogacao', 'reajuste', 'qualitativa', 'reequilibrio'));
ALTER TABLE aditivos DROP CONSTRAINT aditivos_valor_check;
ALTER TABLE aditivos ADD CONSTRAINT aditivos_valor_check CHECK (valor >= 0 OR tipo IN ('reequilibrio', 'reajuste'));

-- Divulgação dos termos no PNCP pela fila de integrações (frente B).
ALTER TABLE fila_tarefas DROP CONSTRAINT fila_tarefas_tipo_check;
ALTER TABLE fila_tarefas ADD CONSTRAINT fila_tarefas_tipo_check
  CHECK (tipo IN ('sincronizacao', 'pncp.compra', 'pncp.arquivo', 'pncp.contrato', 'pncp.termo'));

CREATE TABLE alteracoes_contratuais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  especie text NOT NULL CHECK (especie IN ('aditivo', 'apostila', 'rescisao')),
  tipo text NOT NULL CHECK (tipo IN ('acrescimo', 'supressao', 'qualitativa', 'prazo', 'reequilibrio', 'reajuste', 'repactuacao', 'extincao')),
  situacao text NOT NULL CHECK (situacao IN (
    'aguardando_parecer', 'pronto_para_assinatura', 'devolvido', 'em_contraditorio', 'aguardando_decisao', 'assinado', 'indeferido', 'arquivado'
  )),
  numero text,
  -- Efeito no valor global, com sinal (supressão e redução negativas).
  valor bigint NOT NULL DEFAULT 0,
  nova_vigencia_fim date,
  justificativa text NOT NULL,
  -- Dados próprios de cada tipo (reforma, índice, componentes, enquadramento, motivo da extinção...) e a avaliação do domínio.
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  parecer jsonb,
  decisao jsonb,
  contraditorio jsonb,
  aditivo_id uuid REFERENCES aditivos (id) ON DELETE SET NULL,
  verificacao_regularidade_id uuid REFERENCES verificacoes_regularidade (id),
  proposto_por uuid REFERENCES usuarios (id),
  proposto_em timestamptz NOT NULL,
  assinado_por uuid REFERENCES usuarios (id),
  assinado_em date,
  divulgacao_tarefa_id uuid REFERENCES fila_tarefas (id),
  divulgacao_modo text CHECK (divulgacao_modo IS NULL OR divulgacao_modo IN ('offline', 'online')),
  divulgacao_protocolo text,
  divulgacao_numero_controle text,
  divulgacao_hash text CHECK (divulgacao_hash IS NULL OR divulgacao_hash ~ '^[0-9a-f]{64}$'),
  divulgado_em timestamptz,
  atualizado_em timestamptz NOT NULL,
  CONSTRAINT alteracoes_numero_na_assinatura CHECK (situacao <> 'assinado' OR (numero IS NOT NULL AND assinado_em IS NOT NULL))
);
CREATE INDEX alteracoes_contratuais_contrato_idx ON alteracoes_contratuais (contrato_id, proposto_em);
-- Um único processo de extinção em andamento ou concluído por contrato.
CREATE UNIQUE INDEX alteracoes_contratuais_extincao_unica ON alteracoes_contratuais (contrato_id)
  WHERE tipo = 'extincao' AND situacao IN ('em_contraditorio', 'aguardando_decisao', 'assinado');

-- Valor global passa a considerar o reequilíbrio (art. 124, II, "d"), que não conta para o limite do art. 125.
CREATE OR REPLACE VIEW vw_contratos_valores AS
SELECT c.id AS contrato_id,
       COALESCE(ad.acrescimos, 0)::bigint AS acrescimos,
       COALESCE(ad.supressoes, 0)::bigint AS supressoes,
       COALESCE(ad.reajustes, 0)::bigint AS reajustes,
       COALESCE(ad.prorrogacoes, 0)::bigint AS prorrogacoes,
       (c.valor_inicial + COALESCE(ad.acrescimos, 0) - COALESCE(ad.supressoes, 0)
          + COALESCE(ad.reajustes, 0) + COALESCE(ad.prorrogacoes, 0) + COALESCE(ad.reequilibrios, 0))::bigint AS valor_global,
       COALESCE(em.valor_empenhado, 0)::bigint AS valor_empenhado,
       COALESCE(pg.valor_pago, 0)::bigint AS valor_pago,
       COALESCE(pe.abertas, 0)::integer AS pendencias_abertas,
       COALESCE(ad.reequilibrios, 0)::bigint AS reequilibrios
  FROM contratos c
  LEFT JOIN (
        SELECT contrato_id,
               SUM(valor) FILTER (WHERE tipo = 'acrescimo') AS acrescimos,
               SUM(valor) FILTER (WHERE tipo = 'supressao') AS supressoes,
               SUM(valor) FILTER (WHERE tipo = 'reajuste') AS reajustes,
               SUM(valor) FILTER (WHERE tipo = 'prorrogacao') AS prorrogacoes,
               SUM(valor) FILTER (WHERE tipo = 'reequilibrio') AS reequilibrios
          FROM aditivos
         GROUP BY contrato_id
       ) ad ON ad.contrato_id = c.id
  LEFT JOIN (
        SELECT contrato_id, SUM(valor_empenhado) AS valor_empenhado
          FROM empenhos
         WHERE contrato_id IS NOT NULL
         GROUP BY contrato_id
       ) em ON em.contrato_id = c.id
  LEFT JOIN (
        SELECT contrato_id, SUM(valor) AS valor_pago
          FROM pagamentos
         WHERE situacao = 'pago'
         GROUP BY contrato_id
       ) pg ON pg.contrato_id = c.id
  LEFT JOIN (
        SELECT instrumento_id, COUNT(*) AS abertas
          FROM pendencias
         WHERE instrumento_tipo = 'contrato' AND situacao = 'aberta'
         GROUP BY instrumento_id
       ) pe ON pe.instrumento_id = c.id;
