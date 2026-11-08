-- Jornada da contratação — atos da seleção e sustentabilidade (frente A).
--
-- processos.selecao: prova de conceito ou amostra (RN-20), habilitação, fase recursal única (RN-22), adjudicação e
-- homologação (RF-18), em jsonb como os demais dados de etapa. A ordem e os prazos dos atos vêm de @agora/dominio.
-- processos.sustentabilidade: critérios de sustentabilidade ambiental e logística reversa do ETP e do TR (RN-21).
-- politicas_orgao: políticas do órgão alteráveis pelo administrador, com a trilha de auditoria; a de sustentabilidade
-- começa ligada.

ALTER TABLE processos ADD COLUMN selecao jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE processos ADD COLUMN sustentabilidade jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Processos que já estavam na etapa 7 antes do registro dos atos da seleção seguem a regra anterior na contratação
-- (vencedor = primeiro classificado): a marca é explícita para que a exceção fique auditável.
UPDATE processos SET selecao = jsonb_build_object('legado', true) WHERE etapa_atual = 7;

CREATE TABLE politicas_orgao (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[a-z_]{3,60}$'),
  ativa boolean NOT NULL,
  justificativa text,
  alterada_em timestamptz,
  alterada_por uuid REFERENCES usuarios (id)
);

INSERT INTO politicas_orgao (codigo, ativa) VALUES ('sustentabilidade_obrigatoria', true);
