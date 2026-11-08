-- Sigilo de segurança pública (F25; RN-40, RF-33 e RNF-09): classificação de sigilo do processo, dos documentos, dos
-- anexos e do contrato (Lei 14.133/2021, arts. 13, 18, § 1º, VI, 24 e 91, § 1º; Lei 12.527/2011, arts. 23 a 27),
-- credenciais de acesso por processo (Decreto 7.845/2012, art. 18), registro de todos os acessos, permitidos e negados
-- (art. 38, § 4º), cofre dos anexos cifrados (AES-256-GCM) e ancoragem da trilha de auditoria em carimbo de tempo.

-- Classificação vigente e histórico: a reclassificação encerra a linha anterior ('substituida') e cria outra com a
-- versão seguinte; a desclassificação encerra a linha ('desclassificada'). O fim do prazo é calculado na leitura
-- (LAI, art. 24, § 4º): a informação fica pública sozinha, sem escrita.
CREATE TABLE sigilo_classificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  alvo text NOT NULL CHECK (alvo IN ('processo', 'documento', 'anexo', 'contrato')),
  documento_tipo text CHECK (documento_tipo IN ('dfd', 'etp', 'matriz_riscos', 'nota_tecnica_precos', 'tr', 'edital', 'minuta_contrato',
    'parecer_checklist')),
  arquivo_id uuid REFERENCES processos_arquivos (id),
  contrato_id uuid REFERENCES contratos (id),
  tipo text NOT NULL CHECK (tipo IN ('lai', 'orcamento')),
  grau text CHECK (grau IN ('reservada', 'secreta', 'ultrassecreta')),
  hipotese text CHECK (hipotese IN ('I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII')),
  razoes text NOT NULL CHECK (length(razoes) BETWEEN 30 AND 2000),
  data_producao date NOT NULL,
  prazo_fim date,
  evento_fim text,
  prazo_limite date,
  -- Autoridade classificadora (nome e cargo de servidor público, nível do art. 27 e ato de delegação).
  autoridade jsonb,
  fundamento text NOT NULL,
  codigo_indexacao text NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('vigente', 'desclassificada', 'substituida')),
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  classificada_em timestamptz NOT NULL,
  classificada_por uuid NOT NULL REFERENCES usuarios (id),
  encerrada_em timestamptz,
  encerrada_por uuid REFERENCES usuarios (id),
  motivo_encerramento text,
  CONSTRAINT sigilo_classificacoes_alvo_coerente CHECK (
    (alvo = 'processo' AND documento_tipo IS NULL AND arquivo_id IS NULL AND contrato_id IS NULL)
    OR (alvo = 'documento' AND documento_tipo IS NOT NULL AND arquivo_id IS NULL AND contrato_id IS NULL)
    OR (alvo = 'anexo' AND arquivo_id IS NOT NULL AND documento_tipo IS NULL AND contrato_id IS NULL)
    OR (alvo = 'contrato' AND contrato_id IS NOT NULL AND documento_tipo IS NULL AND arquivo_id IS NULL)),
  CONSTRAINT sigilo_classificacoes_tipo_coerente CHECK ((tipo = 'lai') = (grau IS NOT NULL) AND (tipo = 'lai') = (hipotese IS NOT NULL)),
  CONSTRAINT sigilo_classificacoes_orcamento_em_documento CHECK (tipo = 'lai' OR alvo IN ('documento', 'anexo')),
  CONSTRAINT sigilo_classificacoes_encerramento_coerente CHECK ((situacao = 'vigente') = (encerrada_em IS NULL))
);
CREATE UNIQUE INDEX sigilo_classificacoes_alvo_vigente ON sigilo_classificacoes
  (processo_id, alvo, COALESCE(documento_tipo, ''), COALESCE(arquivo_id::text, ''), COALESCE(contrato_id::text, ''))
  WHERE situacao = 'vigente';
CREATE INDEX sigilo_classificacoes_processo_idx ON sigilo_classificacoes (processo_id, situacao);
CREATE INDEX sigilo_classificacoes_contrato_idx ON sigilo_classificacoes (contrato_id) WHERE contrato_id IS NOT NULL;

-- Credencial de acesso no processo: credencial de segurança ou termo de compromisso (Decreto 7.845/2012, art. 18).
CREATE TABLE sigilo_credenciais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  grau_maximo text NOT NULL CHECK (grau_maximo IN ('reservada', 'secreta', 'ultrassecreta')),
  fundamento text NOT NULL CHECK (fundamento IN ('credencial_seguranca', 'tcms')),
  necessidade text NOT NULL CHECK (length(necessidade) BETWEEN 20 AND 500),
  valida_ate date,
  concedida_em timestamptz NOT NULL,
  concedida_por uuid NOT NULL REFERENCES usuarios (id),
  revogada_em timestamptz,
  revogada_por uuid REFERENCES usuarios (id),
  motivo_revogacao text,
  CONSTRAINT sigilo_credenciais_revogacao_coerente CHECK ((revogada_em IS NULL) = (revogada_por IS NULL))
);
CREATE UNIQUE INDEX sigilo_credenciais_ativa_unica ON sigilo_credenciais (processo_id, usuario_id) WHERE revogada_em IS NULL;
CREATE INDEX sigilo_credenciais_usuario_idx ON sigilo_credenciais (usuario_id);

-- Registro dos acessos a informação sigilosa, permitidos e negados (Decreto 7.845/2012, art. 38, § 4º): somente inclusão.
CREATE TABLE sigilo_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id),
  classificacao_id uuid REFERENCES sigilo_classificacoes (id),
  usuario_id uuid NOT NULL REFERENCES usuarios (id),
  ocorrido_em timestamptz NOT NULL,
  alvo text NOT NULL CHECK (alvo IN ('processo', 'documento', 'anexo', 'contrato')),
  titulo text NOT NULL,
  operacao text NOT NULL CHECK (operacao IN ('consulta', 'pdf', 'download')),
  permitido boolean NOT NULL,
  base text NOT NULL CHECK (base IN ('sem_sigilo', 'controle', 'credencial', 'orcamento_divulgado', 'negado_sem_credencial',
    'negado_credencial_vencida', 'negado_grau_insuficiente')),
  motivo text CHECK (motivo IS NULL OR length(motivo) BETWEEN 10 AND 300),
  ip_hash text
);
CREATE INDEX sigilo_acessos_processo_idx ON sigilo_acessos (processo_id, ocorrido_em DESC);
CREATE INDEX sigilo_acessos_usuario_idx ON sigilo_acessos (usuario_id, ocorrido_em DESC);

CREATE TRIGGER sigilo_acessos_somente_inclusao
  BEFORE UPDATE OR DELETE ON sigilo_acessos
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();

-- Cofre: o anexo sigiloso fica cifrado (AES-256-GCM) no armazenamento de documentos, endereçado pelo SHA-256 do
-- conteúdo cifrado; o SHA-256 do conteúdo em claro continua em processos_arquivos e é conferido ao decifrar.
CREATE TABLE sigilo_cofre (
  arquivo_id uuid PRIMARY KEY REFERENCES processos_arquivos (id),
  sha256_cifrado text NOT NULL CHECK (sha256_cifrado ~ '^[0-9a-f]{64}$'),
  algoritmo text NOT NULL DEFAULT 'AES-256-GCM' CHECK (algoritmo = 'AES-256-GCM'),
  -- Impressão da chave do órgão (8 bytes do SHA-256 da chave): identifica a chave sem revelá-la.
  chave_id text NOT NULL CHECK (chave_id ~ '^[0-9a-f]{16}$'),
  tamanho_cifrado integer NOT NULL CHECK (tamanho_cifrado > 0),
  selado_em timestamptz NOT NULL,
  selado_por uuid NOT NULL REFERENCES usuarios (id)
);

CREATE TRIGGER sigilo_cofre_somente_inclusao
  BEFORE UPDATE OR DELETE ON sigilo_cofre
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();

-- Ancoragem da trilha de auditoria: o hash da cadeia no último evento coberto, carimbado por uma autoridade de
-- carimbo do tempo (RFC 3161) ou, no modo offline, registrado localmente com prova HMAC do servidor. Somente inclusão.
CREATE TABLE auditoria_ancoragens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Sem chave estrangeira: a trilha não pode ganhar dependências (o TRUNCATE dela deve cair no gatilho de somente
  -- inclusão); a verificação confere se o evento ancorado continua lá.
  sequencia bigint NOT NULL CHECK (sequencia >= 1),
  hash text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  impressao text NOT NULL CHECK (impressao ~ '^[0-9a-f]{64}$'),
  modo text NOT NULL CHECK (modo IN ('rfc3161', 'local')),
  origem text NOT NULL CHECK (origem IN ('periodica', 'manual')),
  ancorada_em timestamptz NOT NULL,
  autoridade text,
  -- TimeStampToken (CMS SignedData, DER) em base64, como devolvido pela autoridade.
  token text,
  hash_token text CHECK (hash_token IS NULL OR hash_token ~ '^[0-9a-f]{64}$'),
  carimbo_em timestamptz,
  numero_serie text,
  politica text,
  prova_local text CHECK (prova_local IS NULL OR prova_local ~ '^[0-9a-f]{64}$'),
  solicitada_por uuid REFERENCES usuarios (id),
  CONSTRAINT auditoria_ancoragens_modo_coerente CHECK (
    (modo = 'rfc3161' AND token IS NOT NULL AND prova_local IS NULL) OR (modo = 'local' AND token IS NULL AND prova_local IS NOT NULL))
);
CREATE INDEX auditoria_ancoragens_ancorada_idx ON auditoria_ancoragens (ancorada_em DESC);

CREATE TRIGGER auditoria_ancoragens_somente_inclusao
  BEFORE UPDATE OR DELETE ON auditoria_ancoragens
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();

CREATE TRIGGER auditoria_ancoragens_sem_truncate
  BEFORE TRUNCATE ON auditoria_ancoragens
  FOR EACH STATEMENT EXECUTE FUNCTION bloquear_alteracao_somente_inclusao();
