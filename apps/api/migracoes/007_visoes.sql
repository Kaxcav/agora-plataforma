-- Visões de saldos e valores consolidados (uma única definição para listas, detalhes e painel).

CREATE VIEW vw_itens_contrato_saldos AS
SELECT ic.id AS item_contrato_id,
       COALESCE(SUM(ei.quantidade), 0)::integer AS quantidade_empenhada,
       COALESCE(SUM(ei.valor), 0)::bigint AS valor_empenhado
  FROM itens_contrato ic
  LEFT JOIN empenhos_itens ei ON ei.item_contrato_id = ic.id
 GROUP BY ic.id;

CREATE VIEW vw_itens_ata_saldos AS
SELECT ia.id AS item_ata_id,
       COALESCE(SUM(ic.quantidade), 0)::integer AS quantidade_contratada,
       COALESCE(SUM(s.quantidade_empenhada), 0)::integer AS quantidade_empenhada
  FROM itens_ata ia
  LEFT JOIN itens_contrato ic ON ic.item_ata_id = ia.id
  LEFT JOIN vw_itens_contrato_saldos s ON s.item_contrato_id = ic.id
 GROUP BY ia.id;

-- Item em risco: consumo (quantidade contratada / registrada) de 90% ou mais, ou sem saldo.
CREATE VIEW vw_atas_valores AS
SELECT a.id AS ata_id,
       COALESCE(SUM(ia.valor_unitario * ia.quantidade_registrada), 0)::bigint AS valor_registrado,
       COALESCE(SUM(ia.valor_unitario * s.quantidade_contratada), 0)::bigint AS valor_contratado,
       COUNT(ia.id)::integer AS quantidade_itens,
       (COUNT(ia.id) FILTER (WHERE ia.quantidade_registrada = 0
                               OR s.quantidade_contratada * 10 >= ia.quantidade_registrada * 9))::integer AS itens_em_risco
  FROM atas a
  LEFT JOIN itens_ata ia ON ia.ata_id = a.id
  LEFT JOIN vw_itens_ata_saldos s ON s.item_ata_id = ia.id
 GROUP BY a.id;

-- Valor global = valor inicial + acréscimos − supressões + reajustes + valores de prorrogação.
CREATE VIEW vw_contratos_valores AS
SELECT c.id AS contrato_id,
       COALESCE(ad.acrescimos, 0)::bigint AS acrescimos,
       COALESCE(ad.supressoes, 0)::bigint AS supressoes,
       COALESCE(ad.reajustes, 0)::bigint AS reajustes,
       COALESCE(ad.prorrogacoes, 0)::bigint AS prorrogacoes,
       (c.valor_inicial + COALESCE(ad.acrescimos, 0) - COALESCE(ad.supressoes, 0)
          + COALESCE(ad.reajustes, 0) + COALESCE(ad.prorrogacoes, 0))::bigint AS valor_global,
       COALESCE(em.valor_empenhado, 0)::bigint AS valor_empenhado,
       COALESCE(pg.valor_pago, 0)::bigint AS valor_pago,
       COALESCE(pe.abertas, 0)::integer AS pendencias_abertas
  FROM contratos c
  LEFT JOIN (
        SELECT contrato_id,
               SUM(valor) FILTER (WHERE tipo = 'acrescimo') AS acrescimos,
               SUM(valor) FILTER (WHERE tipo = 'supressao') AS supressoes,
               SUM(valor) FILTER (WHERE tipo = 'reajuste') AS reajustes,
               SUM(valor) FILTER (WHERE tipo = 'prorrogacao') AS prorrogacoes
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
