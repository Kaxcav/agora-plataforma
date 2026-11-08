-- Gestão compartilhada com a sociedade (Lei 14.133/2021, art. 174, § 3º, VI, alíneas "a" a "d", e art. 19, III): RF-37.
-- Perfil "cidadao" (identificado pelo Login Único gov.br, sem acesso interno), mensagens e imagens com moderação,
-- respostas identificadas da Administração e do contratado, registros de imagem e vídeo da execução e relatório final.
-- O catálogo de dados abertos (RF-38) é gerado das tabelas existentes e não precisa de tabela própria.

-- Perfil "cidadao": acrescenta o código à lista aceita, preservando os perfis que outras migrações acrescentaram.
DO $$
DECLARE
  definicao text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO definicao
    FROM pg_constraint c
   WHERE c.conrelid = 'usuarios_perfis'::regclass AND c.conname = 'usuarios_perfis_perfil_check';
  IF definicao IS NOT NULL AND position('''cidadao''' IN definicao) = 0 THEN
    EXECUTE 'ALTER TABLE usuarios_perfis DROP CONSTRAINT usuarios_perfis_perfil_check';
    EXECUTE 'ALTER TABLE usuarios_perfis ADD CONSTRAINT usuarios_perfis_perfil_check '
      || replace(definicao, '])', ', ''cidadao''::text])');
  END IF;
END $$;

-- (a) Mensagens de texto ou imagem do interessado previamente identificado. Nada é público sem a decisão da moderação.
-- `texto` guarda o original (visto só pelo autor); `texto_publico` sai com CPF, e-mail e telefone tarjados.
CREATE TABLE sociedade_manifestacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id),
  autor_id uuid NOT NULL REFERENCES usuarios (id),
  assunto text NOT NULL CHECK (assunto IN ('execucao', 'qualidade', 'prazo', 'atendimento', 'outro')),
  texto text NOT NULL CHECK (length(texto) BETWEEN 20 AND 2000),
  texto_publico text NOT NULL,
  dados_pessoais_tarjados boolean NOT NULL DEFAULT false,
  imagem_sha256 text CHECK (imagem_sha256 IS NULL OR imagem_sha256 ~ '^[0-9a-f]{64}$'),
  imagem_formato text CHECK (imagem_formato IS NULL OR imagem_formato IN ('jpeg', 'png')),
  imagem_bytes integer CHECK (imagem_bytes IS NULL OR imagem_bytes > 0),
  metadados_removidos text[] NOT NULL DEFAULT '{}',
  situacao text NOT NULL DEFAULT 'em_moderacao' CHECK (situacao IN ('em_moderacao', 'publicada', 'recusada')),
  motivo_moderacao text CHECK (motivo_moderacao IS NULL OR length(motivo_moderacao) BETWEEN 10 AND 500),
  moderada_por uuid REFERENCES usuarios (id),
  moderada_em timestamptz,
  recebida_em timestamptz NOT NULL,
  prazo_resposta date NOT NULL,
  CONSTRAINT sociedade_manifestacoes_imagem_coerente CHECK ((imagem_sha256 IS NULL) = (imagem_formato IS NULL) AND (imagem_sha256 IS NULL) = (imagem_bytes IS NULL)),
  CONSTRAINT sociedade_manifestacoes_moderacao_coerente CHECK (
    (situacao = 'em_moderacao') = (moderada_em IS NULL)
    AND (situacao = 'em_moderacao') = (motivo_moderacao IS NULL)
    AND (situacao = 'em_moderacao') = (moderada_por IS NULL)
  )
);
CREATE INDEX sociedade_manifestacoes_contrato_idx ON sociedade_manifestacoes (contrato_id, situacao);
CREATE INDEX sociedade_manifestacoes_autor_idx ON sociedade_manifestacoes (autor_id);
CREATE INDEX sociedade_manifestacoes_situacao_idx ON sociedade_manifestacoes (situacao, recebida_em);

-- (c) Respostas identificadas: da Administração (servidor e função) ou do contratado (preposto, art. 118), esta
-- registrada por um servidor a partir do que o contratado enviou.
CREATE TABLE sociedade_respostas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifestacao_id uuid NOT NULL REFERENCES sociedade_manifestacoes (id),
  origem text NOT NULL CHECK (origem IN ('administracao', 'contratado')),
  texto text NOT NULL CHECK (length(texto) BETWEEN 20 AND 4000),
  texto_publico text NOT NULL,
  funcao text NOT NULL CHECK (length(funcao) BETWEEN 3 AND 160),
  representante text CHECK (representante IS NULL OR length(representante) BETWEEN 3 AND 120),
  registrada_por uuid NOT NULL REFERENCES usuarios (id),
  respondida_em timestamptz NOT NULL,
  CONSTRAINT sociedade_respostas_representante_coerente CHECK ((origem = 'contratado') = (representante IS NOT NULL))
);
CREATE INDEX sociedade_respostas_manifestacao_idx ON sociedade_respostas (manifestacao_id, respondida_em);

-- (b) Acompanhamento da execução com imagem e vídeo (art. 19, III), no armazenamento de documentos da Ágora.
-- Registro sigiloso fica guardado e não é publicado (ponto de checagem do sigilo).
CREATE TABLE sociedade_registros_execucao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 200),
  descricao text NOT NULL DEFAULT '' CHECK (length(descricao) <= 2000),
  midia text NOT NULL CHECK (midia IN ('imagem', 'video')),
  formato text NOT NULL CHECK (formato IN ('jpeg', 'png', 'mp4')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK (bytes > 0),
  registrado_em date NOT NULL,
  declarado_sigiloso boolean NOT NULL DEFAULT false,
  publicado boolean NOT NULL,
  motivo_retencao text,
  metadados_removidos text[] NOT NULL DEFAULT '{}',
  enviado_por uuid NOT NULL REFERENCES usuarios (id),
  enviado_em timestamptz NOT NULL,
  CONSTRAINT sociedade_registros_retencao_coerente CHECK (publicado = (motivo_retencao IS NULL)),
  CONSTRAINT sociedade_registros_midia_coerente CHECK ((midia = 'video') = (formato = 'mp4')),
  CONSTRAINT sociedade_registros_unico UNIQUE (contrato_id, sha256)
);
CREATE INDEX sociedade_registros_contrato_idx ON sociedade_registros_execucao (contrato_id, publicado);

-- (d) Relatório final da consecução dos objetivos da contratação, publicado ao fim da vigência; um por contrato.
CREATE TABLE sociedade_relatorios_finais (
  contrato_id uuid PRIMARY KEY REFERENCES contratos (id),
  objetivos text NOT NULL CHECK (length(objetivos) BETWEEN 100 AND 8000),
  resultados text NOT NULL CHECK (length(resultados) BETWEEN 100 AND 8000),
  conclusao text NOT NULL CHECK (conclusao IN ('atingidos', 'parcialmente_atingidos', 'nao_atingidos')),
  execucao jsonb NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  publicado_por uuid NOT NULL REFERENCES usuarios (id),
  publicado_em timestamptz NOT NULL
);
