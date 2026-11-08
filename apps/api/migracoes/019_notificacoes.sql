-- Central de notificações (RF-26) e avisos automáticos de vencimento 30/60/90/120 dias (RN-31).
-- Saída por fila durável no banco (outbox): cada aviso gera um envio por destinatário e canal, processado com novas
-- tentativas. A tabela é própria e pode ser ligada depois a um barramento de mensagens sem mudar o modelo.

CREATE TABLE notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia')),
  origem text NOT NULL CHECK (origem IN ('automatica', 'manual')),
  instrumento_tipo text NOT NULL CHECK (instrumento_tipo IN ('ata', 'contrato')),
  instrumento_id uuid NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  faixa integer CHECK (faixa IS NULL OR faixa IN (30, 60, 90, 120)),
  obrigatoria boolean NOT NULL DEFAULT false,
  assunto text NOT NULL,
  corpo text NOT NULL,
  fundamento text NOT NULL,
  -- Avisos automáticos: um por instrumento, tipo, faixa e data de referência (a varredura diária é idempotente).
  chave_idempotencia text,
  criada_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL,
  busca_normalizada text NOT NULL DEFAULT '',
  CONSTRAINT notificacoes_chave_unica UNIQUE (chave_idempotencia)
);
CREATE INDEX notificacoes_instrumento_idx ON notificacoes (instrumento_tipo, instrumento_id);
CREATE INDEX notificacoes_uasg_idx ON notificacoes (uasg);
CREATE INDEX notificacoes_criada_idx ON notificacoes (criada_em);

CREATE TABLE notificacoes_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id uuid NOT NULL REFERENCES notificacoes (id),
  canal text NOT NULL CHECK (canal IN ('email', 'sei', 'govbr')),
  papel text NOT NULL CHECK (papel IN ('gestor', 'fiscal', 'contratada', 'responsavel')),
  usuario_id uuid REFERENCES usuarios (id),
  fornecedor_id uuid REFERENCES fornecedores (id),
  destinatario text NOT NULL,
  -- E-mail (canal email) ou número do processo SEI (canal sei). No gov.br o CPF é lido do cadastro só na hora do envio.
  endereco text,
  base_legal text NOT NULL,
  situacao text NOT NULL CHECK (situacao IN ('pendente', 'enviando', 'enviado', 'falhou', 'suprimido')),
  motivo_supressao text,
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  max_tentativas integer NOT NULL DEFAULT 5 CHECK (max_tentativas >= 1),
  proxima_tentativa_em timestamptz,
  ultima_tentativa_em timestamptz,
  enviado_em timestamptz,
  modo text CHECK (modo IS NULL OR modo IN ('simulado', 'smtp', 'desligado')),
  protocolo text,
  ultimo_erro text,
  reenvio_de uuid REFERENCES notificacoes_envios (id),
  criado_em timestamptz NOT NULL,
  atualizado_em timestamptz NOT NULL,
  CONSTRAINT notificacoes_envios_destinatario CHECK (usuario_id IS NOT NULL OR fornecedor_id IS NOT NULL)
);
CREATE INDEX notificacoes_envios_fila_idx ON notificacoes_envios (situacao, proxima_tentativa_em);
CREATE INDEX notificacoes_envios_notificacao_idx ON notificacoes_envios (notificacao_id);
CREATE INDEX notificacoes_envios_usuario_idx ON notificacoes_envios (usuario_id);

-- Preferências por usuário, tipo e canal pessoal (o SEI é registro processual e não entra aqui).
CREATE TABLE notificacoes_preferencias (
  usuario_id uuid NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('vencimento', 'reajuste', 'garantia', 'pendencia', 'ocorrencia')),
  canal text NOT NULL CHECK (canal IN ('email', 'govbr')),
  ativo boolean NOT NULL,
  atualizado_em timestamptz NOT NULL,
  PRIMARY KEY (usuario_id, tipo, canal)
);

-- Uma linha por dia de varredura (o agendador pula o dia já varrido; a execução manual atualiza a linha).
CREATE TABLE notificacoes_varreduras (
  data date PRIMARY KEY,
  executada_em timestamptz NOT NULL,
  notificacoes_criadas integer NOT NULL DEFAULT 0,
  envios_criados integer NOT NULL DEFAULT 0
);
