-- Gestão: pendências, plano de gestão (tarefas e modelos) e processos sancionatórios.

CREATE TABLE pendencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('saldo', 'vigencia', 'reajuste', 'pagamento', 'tarefa', 'divulgacao_pncp', 'garantia', 'lembrete')),
  prioridade text NOT NULL CHECK (prioridade IN ('alta', 'media', 'baixa')),
  instrumento_tipo text NOT NULL CHECK (instrumento_tipo IN ('ata', 'contrato')),
  instrumento_id uuid NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  motivo text NOT NULL,
  prazo date,
  responsavel_id uuid REFERENCES usuarios (id),
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'resolvida')),
  resolvida_em timestamptz,
  resolvida_por uuid REFERENCES usuarios (id),
  observacao_resolucao text,
  busca_normalizada text NOT NULL DEFAULT '',
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pendencias_uasg_idx ON pendencias (uasg);
CREATE INDEX pendencias_situacao_idx ON pendencias (situacao);
CREATE INDEX pendencias_instrumento_idx ON pendencias (instrumento_tipo, instrumento_id);
CREATE INDEX pendencias_responsavel_idx ON pendencias (responsavel_id);

CREATE TABLE modelos_gestao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('ata', 'contrato')),
  nome text NOT NULL,
  evento text NOT NULL CHECK (evento IN ('assinatura', 'inicio_vigencia', 'mensal', 'reajuste', 'fim_vigencia')),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modelos_gestao_tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL REFERENCES modelos_gestao (id) ON DELETE CASCADE,
  ordem integer NOT NULL,
  titulo text NOT NULL,
  macrotarefa text NOT NULL,
  dias_relativos integer NOT NULL,
  papel_responsavel text NOT NULL CHECK (papel_responsavel IN ('gestor', 'fiscal', 'financeiro')),
  CONSTRAINT modelos_gestao_tarefas_ordem_unica UNIQUE (modelo_id, ordem)
);

CREATE TABLE tarefas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrumento_tipo text NOT NULL CHECK (instrumento_tipo IN ('ata', 'contrato')),
  instrumento_id uuid NOT NULL,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  modelo_id uuid REFERENCES modelos_gestao (id) ON DELETE SET NULL,
  titulo text NOT NULL,
  macrotarefa text NOT NULL,
  prazo date,
  situacao text NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'concluida')),
  responsavel_id uuid REFERENCES usuarios (id),
  concluida_em timestamptz,
  concluida_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tarefas_instrumento_idx ON tarefas (instrumento_tipo, instrumento_id);
CREATE INDEX tarefas_uasg_idx ON tarefas (uasg);

CREATE TABLE sancoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  contrato_id uuid REFERENCES contratos (id),
  inciso_infracao text NOT NULL CHECK (inciso_infracao IN ('I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII')),
  tipo text NOT NULL CHECK (tipo IN ('advertencia', 'multa', 'impedimento_licitar', 'declaracao_inidoneidade')),
  situacao text NOT NULL CHECK (situacao IN ('em_instrucao', 'defesa', 'decisao', 'aplicada', 'arquivada')),
  valor_multa bigint CHECK (valor_multa IS NULL OR valor_multa >= 0),
  intimacao_em date,
  aplicada_em date,
  inicio_vigencia date,
  fim_vigencia date,
  prazo_defesa date,
  prazo_registro_ceis_cnep date,
  registrada_ceis_cnep boolean NOT NULL DEFAULT false,
  instaurada_em date NOT NULL,
  relato text NOT NULL,
  criada_por uuid REFERENCES usuarios (id),
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sancoes_fornecedor_idx ON sancoes (fornecedor_id);
CREATE INDEX sancoes_contrato_idx ON sancoes (contrato_id);
CREATE INDEX sancoes_situacao_idx ON sancoes (situacao);
