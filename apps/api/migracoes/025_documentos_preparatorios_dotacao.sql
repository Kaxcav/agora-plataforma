-- Frente P (F20): dotação orçamentária estruturada (RN-39) e peças complementares da fase preparatória (RF-32).
--
-- 1. Dotação do processo: um crédito por linha (unidade gestora, programa de trabalho, natureza da despesa, fonte,
--    exercício, valor e pré-empenho). A declaração de adequação orçamentária é o documento `declaracao_orcamentaria`,
--    aprovado pela autoridade competente designada; o vínculo com a dotação é o hash da chave canônica gravado no texto.
-- 2. Tipos de documento: as peças complementares (portaria de designação, declaração orçamentária, despacho de
--    autorização, nota técnica à assessoria jurídica, modelos de anexos operacionais, caderno da prova de conceito e
--    checklist) entram em `documentos_gerados`. A lista fechada de tipos passa a ser conferida pela aplicação (zod e
--    @agora/contratos); o banco confere o formato do código, para que novos tipos não exijam redefinir a restrição.

CREATE TABLE processos_dotacoes (
  id uuid PRIMARY KEY,
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  ordem integer NOT NULL CHECK (ordem BETWEEN 1 AND 20),
  unidade_gestora text NOT NULL CHECK (unidade_gestora ~ '^[0-9]{6}$'),
  programa_trabalho text NOT NULL CHECK (programa_trabalho ~ '^[0-9]{2}\.[0-9]{3}\.[0-9]{4}\.[0-9A-Z]{4}\.[0-9]{4}$'),
  natureza_despesa text NOT NULL CHECK (natureza_despesa ~ '^[34]\.[1-6]\.[0-9]{2}\.[0-9]{2}$'),
  fonte_recursos text NOT NULL CHECK (fonte_recursos ~ '^([0-9]{3}|[0-9]{4}|[0-9]{10})$'),
  exercicio integer NOT NULL CHECK (exercicio BETWEEN 2000 AND 2100),
  valor bigint NOT NULL CHECK (valor > 0),
  pre_empenho text CHECK (pre_empenho IS NULL OR pre_empenho ~ '^[0-9]{4}PE[0-9]{6}$'),
  registrada_em timestamptz NOT NULL,
  registrada_por uuid REFERENCES usuarios (id),
  CONSTRAINT processos_dotacoes_ordem_unica UNIQUE (processo_id, ordem)
);
CREATE INDEX processos_dotacoes_processo_idx ON processos_dotacoes (processo_id);

ALTER TABLE documentos_gerados DROP CONSTRAINT IF EXISTS documentos_gerados_tipo_check;
ALTER TABLE documentos_gerados ADD CONSTRAINT documentos_gerados_tipo_check CHECK (tipo ~ '^[a-z][a-z_]{1,39}$');
