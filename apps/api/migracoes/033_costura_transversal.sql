-- Costura transversal (Frente Y): avisos ao cidadão na central de notificações.
-- Permite o tipo 'manifestacao' em notificacoes e notificacoes_preferencias,
-- e o papel 'cidadao' em notificacoes_envios (mantendo 'emitente_garantia', da migração 032).

ALTER TABLE notificacoes DROP CONSTRAINT IF EXISTS notificacoes_tipo_check;
ALTER TABLE notificacoes ADD CONSTRAINT notificacoes_tipo_check CHECK (tipo IN ('vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia', 'manifestacao'));

ALTER TABLE notificacoes_envios DROP CONSTRAINT IF EXISTS notificacoes_envios_papel_check;
ALTER TABLE notificacoes_envios ADD CONSTRAINT notificacoes_envios_papel_check CHECK (papel IN ('gestor', 'fiscal', 'contratada', 'responsavel', 'emitente_garantia', 'cidadao'));

ALTER TABLE notificacoes_preferencias DROP CONSTRAINT IF EXISTS notificacoes_preferencias_tipo_check;
ALTER TABLE notificacoes_preferencias ADD CONSTRAINT notificacoes_preferencias_tipo_check CHECK (tipo IN ('vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia', 'manifestacao'));
