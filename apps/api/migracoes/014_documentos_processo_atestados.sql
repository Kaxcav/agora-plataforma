-- Documentos do processo e de habilitação (RF-21), leitura assistida de atestados (RIA-08) e exigências de
-- qualificação técnica do edital (RN-25). O conteúdo dos arquivos fica fora do banco, no armazenamento da Ágora
-- (AGORA_ARQUIVOS_DIR), endereçado pelo SHA-256 gravado aqui.

CREATE TABLE processos_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN ('processo', 'habilitacao')),
  tipo text NOT NULL CHECK (tipo IN ('atestado_capacidade_tecnica', 'balanco_patrimonial', 'certidao', 'proposta',
    'documento_processo', 'outro')),
  fornecedor_id uuid REFERENCES fornecedores (id),
  titulo text NOT NULL CHECK (length(titulo) BETWEEN 3 AND 200),
  nome_original text NOT NULL CHECK (length(nome_original) BETWEEN 1 AND 200),
  formato text NOT NULL CHECK (formato IN ('pdf', 'png', 'jpeg')),
  tamanho_bytes integer NOT NULL CHECK (tamanho_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  contem_dado_pessoal boolean NOT NULL DEFAULT false,
  antivirus text NOT NULL CHECK (antivirus IN ('nao_verificado', 'limpo')),
  exercicio integer CHECK (exercicio BETWEEN 1900 AND 2200),
  data_constituicao date,
  enviado_por uuid NOT NULL REFERENCES usuarios (id),
  enviado_em timestamptz NOT NULL,
  -- O mesmo arquivo não entra duas vezes no processo (evita somar o mesmo atestado em dobro).
  CONSTRAINT processos_arquivos_conteudo_unico UNIQUE (processo_id, sha256),
  CONSTRAINT processos_arquivos_habilitacao_com_licitante CHECK (categoria <> 'habilitacao' OR fornecedor_id IS NOT NULL),
  CONSTRAINT processos_arquivos_atestado_de_habilitacao CHECK (tipo <> 'atestado_capacidade_tecnica' OR categoria = 'habilitacao')
);
CREATE INDEX processos_arquivos_processo_idx ON processos_arquivos (processo_id, enviado_em DESC);
CREATE INDEX processos_arquivos_fornecedor_idx ON processos_arquivos (fornecedor_id);

-- Cada leitura (camada de texto ou OCR) é um registro novo; vale a mais recente. O texto fica guardado para que as
-- menções sejam recalculadas quando as exigências do edital mudam.
CREATE TABLE processos_arquivos_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id uuid NOT NULL REFERENCES processos_arquivos (id) ON DELETE CASCADE,
  metodo text NOT NULL CHECK (metodo IN ('camada_texto', 'ocr')),
  situacao text NOT NULL CHECK (situacao IN ('concluida', 'sem_texto', 'ocr_indisponivel', 'falhou')),
  mensagem text,
  paginas jsonb NOT NULL DEFAULT '[]'::jsonb,
  mencoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  hash_texto text CHECK (hash_texto IS NULL OR hash_texto ~ '^[0-9a-f]{64}$'),
  motor text,
  confianca_media numeric(5, 2),
  lida_em timestamptz NOT NULL,
  lida_por uuid NOT NULL REFERENCES usuarios (id)
);
CREATE INDEX processos_arquivos_leituras_arquivo_idx ON processos_arquivos_leituras (arquivo_id, lida_em DESC);

-- Parcelas de maior relevância exigidas no edital (art. 67, §§ 1º e 2º), conferidas pela RN-25 antes de gravar.
CREATE TABLE processos_qualificacao_tecnica (
  processo_id uuid PRIMARY KEY REFERENCES processos (id) ON DELETE CASCADE,
  parcelas jsonb NOT NULL DEFAULT '[]'::jsonb,
  definida_em timestamptz NOT NULL,
  definida_por uuid REFERENCES usuarios (id)
);

-- Acessos a documentos com dado pessoal (LGPD, art. 37): somente inclusão, como lgpd_acessos.
CREATE TABLE processos_arquivos_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_id uuid NOT NULL REFERENCES processos_arquivos (id),
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  ocorrido_em timestamptz NOT NULL,
  finalidade text NOT NULL CHECK (length(finalidade) BETWEEN 10 AND 300),
  ip_hash text NOT NULL
);
CREATE INDEX processos_arquivos_acessos_arquivo_idx ON processos_arquivos_acessos (arquivo_id);
CREATE INDEX processos_arquivos_acessos_usuario_idx ON processos_arquivos_acessos (usuario_id);

CREATE TRIGGER processos_arquivos_acessos_somente_inclusao
  BEFORE UPDATE OR DELETE ON processos_arquivos_acessos
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();
