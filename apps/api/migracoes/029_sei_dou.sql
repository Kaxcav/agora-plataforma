-- Integração com o SEI (RF-35) e publicação no Diário Oficial da União (RF-36).
--
-- SEI: o processo da jornada é gerado no SEI do órgão pelo web service (SeiWS), os documentos aprovados entram como PDF
-- e a assinatura com certificado ICP-Brasil acontece no próprio SEI. A Ágora guarda o número do processo SEI, o número
-- de cada documento e as assinaturas devolvidas pela consulta, e marca o documento da árvore como assinado.
-- DOU: a Imprensa Nacional recebe as matérias pelo INCom, sem API pública de envio. A Ágora gera a matéria no padrão
-- da Seção 3, registra o protocolo do envio e confere a publicação na consulta pública do DOU (ou pelo registro manual).

-- Novas tarefas da fila de integrações (RNF-07).
ALTER TABLE fila_tarefas DROP CONSTRAINT fila_tarefas_tipo_check;
ALTER TABLE fila_tarefas ADD CONSTRAINT fila_tarefas_tipo_check
  CHECK (tipo IN ('sincronizacao', 'pncp.compra', 'pncp.arquivo', 'pncp.contrato', 'pncp.termo', 'sei.envio', 'sei.assinaturas', 'dou.conferencia'));

-- Canal SEI das notificações ligado ao web service do SEI do órgão.
ALTER TABLE notificacoes_envios DROP CONSTRAINT notificacoes_envios_modo_check;
ALTER TABLE notificacoes_envios ADD CONSTRAINT notificacoes_envios_modo_check
  CHECK (modo IS NULL OR modo IN ('simulado', 'smtp', 'desligado', 'webservice'));

-- Processo gerado no SEI (gerarProcedimento) e envio à unidade de destino (enviarProcesso).
CREATE TABLE sei_processos (
  processo_id uuid PRIMARY KEY REFERENCES processos (id) ON DELETE CASCADE,
  id_procedimento text NOT NULL,
  protocolo text NOT NULL CHECK (length(protocolo) BETWEEN 1 AND 60),
  link text,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  tarefa_id uuid REFERENCES fila_tarefas (id),
  gerado_em timestamptz NOT NULL,
  unidade_destino text,
  enviado_unidade_em timestamptz,
  CONSTRAINT sei_processos_envio_coerente CHECK ((unidade_destino IS NULL) = (enviado_unidade_em IS NULL))
);

-- Documento da árvore incluído no SEI (incluirDocumento), com o bloco de assinatura e as assinaturas consultadas.
CREATE TABLE sei_documentos (
  arvore_id uuid PRIMARY KEY REFERENCES processos_arvore_sei (id) ON DELETE CASCADE,
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  id_documento text NOT NULL,
  documento_formatado text NOT NULL CHECK (length(documento_formatado) BETWEEN 1 AND 40),
  link text,
  modo text NOT NULL CHECK (modo IN ('offline', 'online')),
  hash_arquivo text NOT NULL CHECK (hash_arquivo ~ '^[0-9a-f]{64}$'),
  nivel_acesso integer CHECK (nivel_acesso IS NULL OR nivel_acesso IN (0, 1, 2)),
  bloco_assinatura text,
  tarefa_id uuid REFERENCES fila_tarefas (id),
  incluido_em timestamptz NOT NULL,
  assinaturas jsonb NOT NULL DEFAULT '[]'::jsonb,
  consultado_em timestamptz
);
CREATE INDEX sei_documentos_processo_idx ON sei_documentos (processo_id);

-- Assinatura refletida do SEI: o signatário pode não ser usuário da Ágora (fica o nome devolvido pelo SEI).
ALTER TABLE processos_arvore_sei ADD COLUMN assinado_por_nome text CHECK (assinado_por_nome IS NULL OR length(assinado_por_nome) BETWEEN 1 AND 400);
ALTER TABLE processos_arvore_sei DROP CONSTRAINT processos_arvore_sei_assinatura_coerente;
ALTER TABLE processos_arvore_sei ADD CONSTRAINT processos_arvore_sei_assinatura_coerente
  CHECK ((assinado_em IS NULL) = (assinado_por IS NULL AND assinado_por_nome IS NULL));

-- Matérias para o DOU (Seção 3): aviso de licitação, extrato de contrato e extrato de termo aditivo.
CREATE TABLE dou_materias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('aviso_licitacao', 'extrato_contrato', 'extrato_aditivo')),
  processo_id uuid REFERENCES processos (id) ON DELETE CASCADE,
  contrato_id uuid REFERENCES contratos (id) ON DELETE CASCADE,
  aditivo_id uuid REFERENCES aditivos (id) ON DELETE CASCADE,
  processo_numero text NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  secao integer NOT NULL DEFAULT 3 CHECK (secao IN (1, 2, 3)),
  titulo text NOT NULL,
  identificacao text NOT NULL,
  texto text NOT NULL CHECK (length(texto) BETWEEN 20 AND 20000),
  hash_texto text NOT NULL CHECK (hash_texto ~ '^[0-9a-f]{64}$'),
  obrigatoria boolean NOT NULL,
  fundamento text NOT NULL,
  situacao text NOT NULL DEFAULT 'rascunho' CHECK (situacao IN ('rascunho', 'enviada', 'publicada')),
  automatica boolean NOT NULL DEFAULT false,
  gerada_em timestamptz NOT NULL,
  gerada_por uuid REFERENCES usuarios (id),
  protocolo_incom text CHECK (protocolo_incom IS NULL OR length(protocolo_incom) BETWEEN 3 AND 80),
  enviada_em timestamptz,
  envio_registrado_por uuid REFERENCES usuarios (id),
  data_prevista date,
  publicada_em date,
  edicao text,
  pagina text,
  url_publicacao text,
  forma_confirmacao text CHECK (forma_confirmacao IS NULL OR forma_confirmacao IN ('consulta', 'manual')),
  modo_confirmacao text CHECK (modo_confirmacao IS NULL OR modo_confirmacao IN ('offline', 'online')),
  publicacao_registrada_em timestamptz,
  conferencias integer NOT NULL DEFAULT 0 CHECK (conferencias >= 0),
  ultima_conferencia_em timestamptz,
  ultima_conferencia_resultado text,
  jornal_nome text CHECK (jornal_nome IS NULL OR length(jornal_nome) BETWEEN 3 AND 200),
  jornal_publicado_em date,
  jornal_registrado_em timestamptz,
  CONSTRAINT dou_materias_alvo CHECK (
    (tipo = 'aviso_licitacao' AND processo_id IS NOT NULL AND contrato_id IS NULL AND aditivo_id IS NULL)
    OR (tipo = 'extrato_contrato' AND contrato_id IS NOT NULL AND aditivo_id IS NULL)
    OR (tipo = 'extrato_aditivo' AND contrato_id IS NOT NULL AND aditivo_id IS NOT NULL)
  ),
  CONSTRAINT dou_materias_envio_coerente CHECK ((situacao = 'rascunho') = (protocolo_incom IS NULL)),
  CONSTRAINT dou_materias_publicacao_coerente CHECK ((situacao = 'publicada') = (publicada_em IS NOT NULL)),
  CONSTRAINT dou_materias_jornal_coerente CHECK ((jornal_nome IS NULL) = (jornal_publicado_em IS NULL)),
  CONSTRAINT dou_materias_jornal_so_aviso CHECK (jornal_nome IS NULL OR tipo = 'aviso_licitacao')
);
CREATE UNIQUE INDEX dou_materias_aviso_unico ON dou_materias (processo_id) WHERE tipo = 'aviso_licitacao';
CREATE UNIQUE INDEX dou_materias_contrato_unico ON dou_materias (contrato_id) WHERE tipo = 'extrato_contrato';
CREATE UNIQUE INDEX dou_materias_aditivo_unico ON dou_materias (aditivo_id) WHERE tipo = 'extrato_aditivo';
CREATE INDEX dou_materias_situacao_idx ON dou_materias (situacao, gerada_em DESC);
CREATE INDEX dou_materias_uasg_idx ON dou_materias (uasg);
