-- Avaliação de desempenho do contratado e registro cadastral de atestos (RN-37, RF-30; Lei 14.133/2021, arts. 87 e
-- 88, §§ 2º a 4º) e base de conhecimento da execução com as lições aprendidas (RIA-12). A nota e a situação de cada
-- avaliação, a nota do registro e as sugestões de cláusula vêm de @agora/dominio; aqui ficam os registros.
-- Toda escrita gera evento na trilha de auditoria (recursos 'avaliacao_desempenho', 'certificado_desempenho',
-- 'ocorrencia_execucao', 'processo').

CREATE SEQUENCE avaliacoes_desempenho_protocolo_seq START WITH 1;

CREATE TABLE avaliacoes_desempenho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  uasg text NOT NULL REFERENCES uasgs (codigo),
  tipo text NOT NULL CHECK (tipo IN ('parcial', 'final')),
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  -- Contagens aferidas (entregas e recebimentos) e derivadas (ocorrências registradas no período).
  indicadores jsonb NOT NULL,
  evidencias text NOT NULL,
  motivacao text NOT NULL,
  nota double precision NOT NULL CHECK (nota >= 0 AND nota <= 100),
  faixa text NOT NULL CHECK (faixa IN ('diamante', 'ouro', 'prata', 'em_observacao', 'critico', 'sem_historico')),
  -- Componentes, penalidades e metodologia devolvidos por avaliarDesempenhoContratado.
  calculo jsonb NOT NULL,
  avaliador_id uuid NOT NULL REFERENCES usuarios (id),
  papel_avaliador text NOT NULL CHECK (papel_avaliador IN ('gestor', 'fiscal')),
  emitida_em timestamptz NOT NULL,
  data_emissao date NOT NULL,
  prazo_manifestacao date NOT NULL,
  -- Manifestação do contratado (recebida por SEI, e-mail ou ofício e registrada pelo gestor ou fiscal) e análise.
  manifestacao jsonb,
  analise jsonb,
  versao integer NOT NULL DEFAULT 1 CHECK (versao >= 1),
  versoes_anteriores jsonb NOT NULL DEFAULT '[]'::jsonb,
  documento text NOT NULL,
  hash_documento text NOT NULL,
  -- Protocolo do registro cadastral na Ágora; o cadastro de atesto do PNCP ainda não tem serviço de integração.
  protocolo text NOT NULL,
  envio_cadastro text NOT NULL DEFAULT 'aguardando_cadastro_pncp' CHECK (envio_cadastro IN ('aguardando_cadastro_pncp')),
  CONSTRAINT avaliacoes_desempenho_protocolo_unico UNIQUE (protocolo),
  CONSTRAINT avaliacoes_desempenho_periodo_valido CHECK (periodo_fim >= periodo_inicio)
);
CREATE INDEX avaliacoes_desempenho_fornecedor_idx ON avaliacoes_desempenho (fornecedor_id, periodo_fim DESC);
CREATE INDEX avaliacoes_desempenho_contrato_idx ON avaliacoes_desempenho (contrato_id, emitida_em DESC);

-- Certificado de desempenho e declaração de desempenho registrado (art. 88, §§ 2º e 4º).
CREATE TABLE certificados_desempenho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES fornecedores (id),
  tipo text NOT NULL CHECK (tipo IN ('certificado', 'declaracao')),
  codigo text NOT NULL,
  nota double precision CHECK (nota IS NULL OR (nota >= 0 AND nota <= 100)),
  faixa text NOT NULL,
  contratos_considerados integer NOT NULL CHECK (contratos_considerados >= 0),
  avaliacoes jsonb NOT NULL DEFAULT '[]'::jsonb,
  versao_registro text NOT NULL,
  emitido_em timestamptz NOT NULL,
  data_emissao date NOT NULL,
  valido_ate date NOT NULL,
  emitido_por uuid REFERENCES usuarios (id),
  conteudo text NOT NULL,
  hash_conteudo text NOT NULL,
  CONSTRAINT certificados_desempenho_codigo_unico UNIQUE (codigo)
);
CREATE INDEX certificados_desempenho_fornecedor_idx ON certificados_desempenho (fornecedor_id, emitido_em DESC);

-- Ocorrências da execução registradas pela fiscalização (art. 117): base de conhecimento das lições aprendidas.
CREATE TABLE ocorrencias_execucao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id uuid NOT NULL REFERENCES contratos (id) ON DELETE CASCADE,
  uasg text NOT NULL REFERENCES uasgs (codigo),
  tipo text NOT NULL CHECK (tipo IN ('ocorrencia', 'glosa', 'atraso', 'rescisao')),
  categoria text NOT NULL CHECK (categoria IN ('prazo', 'qualidade', 'nivel_servico', 'garantia', 'quantitativo', 'fiscalizacao')),
  data date NOT NULL,
  descricao text NOT NULL,
  dias_atraso integer CHECK (dias_atraso IS NULL OR dias_atraso > 0),
  valor_glosa bigint CHECK (valor_glosa IS NULL OR valor_glosa > 0),
  situacao text NOT NULL DEFAULT 'aberta' CHECK (situacao IN ('aberta', 'resolvida_no_prazo', 'resolvida_fora_do_prazo')),
  resolvida_em date,
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL
);
CREATE INDEX ocorrencias_execucao_contrato_idx ON ocorrencias_execucao (contrato_id, data DESC);

-- Fórmula do desempenho anterior na pontuação técnica, configurada no edital (art. 36, § 3º; art. 37, III).
CREATE TABLE criterios_desempenho_edital (
  processo_id uuid PRIMARY KEY REFERENCES processos (id) ON DELETE CASCADE,
  adotado boolean NOT NULL,
  peso_desempenho double precision CHECK (peso_desempenho IS NULL OR (peso_desempenho > 0 AND peso_desempenho <= 100)),
  nota_sem_historico double precision CHECK (nota_sem_historico IS NULL OR (nota_sem_historico >= 0 AND nota_sem_historico <= 100)),
  regulamento text,
  atualizado_por uuid REFERENCES usuarios (id),
  atualizado_em timestamptz NOT NULL,
  CONSTRAINT criterios_desempenho_completo CHECK (NOT adotado OR (peso_desempenho IS NOT NULL AND nota_sem_historico IS NOT NULL AND regulamento IS NOT NULL))
);

-- Decisão do agente sobre cada sugestão de lição aprendida (RIA-12): a sugestão fica guardada como foi apresentada.
CREATE TABLE licoes_decisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processo_id uuid NOT NULL REFERENCES processos (id) ON DELETE CASCADE,
  documento text NOT NULL CHECK (documento IN ('dfd', 'etp', 'tr')),
  chave text NOT NULL,
  decisao text NOT NULL CHECK (decisao IN ('aceita', 'recusada')),
  motivo text,
  sugestao jsonb NOT NULL,
  decidida_por uuid REFERENCES usuarios (id),
  decidida_em timestamptz NOT NULL,
  CONSTRAINT licoes_decisoes_unica UNIQUE (processo_id, documento, chave)
);
