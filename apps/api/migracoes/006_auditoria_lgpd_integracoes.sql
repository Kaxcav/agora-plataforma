-- Trilha de auditoria encadeada por hash (somente inclusão), registro de acessos a dados pessoais (LGPD art. 37)
-- e estado das sincronizações com as fontes oficiais.

CREATE TABLE auditoria_eventos (
  sequencia bigserial PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ocorrido_em timestamptz NOT NULL,
  usuario_id uuid REFERENCES usuarios (id),
  acao text NOT NULL,
  recurso text NOT NULL,
  recurso_id text,
  resumo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text,
  hash_anterior text NOT NULL CHECK (hash_anterior ~ '^[0-9a-f]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT auditoria_eventos_id_unico UNIQUE (id)
);
CREATE INDEX auditoria_eventos_recurso_idx ON auditoria_eventos (recurso, recurso_id);
CREATE INDEX auditoria_eventos_usuario_idx ON auditoria_eventos (usuario_id);
CREATE INDEX auditoria_eventos_ocorrido_idx ON auditoria_eventos (ocorrido_em);
CREATE INDEX auditoria_eventos_instrumento_idx ON auditoria_eventos ((dados ->> 'instrumentoId'));

CREATE FUNCTION bloquear_alteracao_somente_inclusao() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A tabela % é somente inclusão: % não é permitido.', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER auditoria_eventos_somente_inclusao
  BEFORE UPDATE OR DELETE ON auditoria_eventos
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();

CREATE TRIGGER auditoria_eventos_sem_truncate
  BEFORE TRUNCATE ON auditoria_eventos
  FOR EACH STATEMENT EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();

CREATE TABLE lgpd_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ocorrido_em timestamptz NOT NULL,
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  recurso text NOT NULL CHECK (recurso IN ('fornecedor', 'usuario', 'credor_empenho')),
  recurso_id uuid NOT NULL,
  campo text NOT NULL CHECK (campo IN ('documento', 'email', 'telefone')),
  finalidade text NOT NULL,
  ip_hash text NOT NULL
);
CREATE INDEX lgpd_acessos_usuario_idx ON lgpd_acessos (usuario_id);
CREATE INDEX lgpd_acessos_ocorrido_idx ON lgpd_acessos (ocorrido_em);

CREATE TRIGGER lgpd_acessos_somente_inclusao
  BEFORE UPDATE OR DELETE ON lgpd_acessos
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();

CREATE TABLE sincronizacoes (
  fonte text NOT NULL CHECK (fonte IN ('PNCP', 'COMPRAS_GOV', 'CONTRATOS_GOV', 'SIAFI', 'AGORA')),
  conjunto text NOT NULL,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  ultima_execucao_em timestamptz,
  ultimo_sucesso_em timestamptz,
  situacao text NOT NULL CHECK (situacao IN ('ok', 'executando', 'falhou', 'nunca_executado')),
  registros_processados integer NOT NULL DEFAULT 0,
  mensagem text,
  hash_conteudo text,
  PRIMARY KEY (fonte, conjunto)
);

-- Área de staging do conector online do PNCP: conteúdo bruto recebido, com hash, antes do upsert idempotente.
CREATE TABLE pncp_contratos_staging (
  numero_controle_pncp text PRIMARY KEY,
  conteudo jsonb NOT NULL,
  hash text NOT NULL,
  recebido_em timestamptz NOT NULL
);
