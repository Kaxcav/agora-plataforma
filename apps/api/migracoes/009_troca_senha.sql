-- Manutenção de conta: troca obrigatória de senha e senha temporária com validade (72 h).
-- Índices para a limpeza periódica de sessões (30 dias após expirar) e de tentativas de login (90 dias) — LGPD.md §5.

ALTER TABLE usuarios ADD COLUMN deve_trocar_senha boolean NOT NULL DEFAULT false;
ALTER TABLE usuarios ADD COLUMN senha_expira_em timestamptz;

CREATE INDEX sessoes_absoluta_idx ON sessoes (absoluta_ate);
CREATE INDEX tentativas_login_ocorrida_idx ON tentativas_login (ocorrida_em);
