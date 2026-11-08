-- Frente V: operação (RNF-10, IMR-01) e painel das metas do ETP (RF-39).

-- Sondagens de disponibilidade: as sondagens seguidas com o mesmo resultado viram um intervalo contínuo
-- (de `inicio` a `fim`), o que mantém a tabela pequena. Minuto sem sondagem válida conta como indisponível.
CREATE TABLE operacao_sondagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  api boolean NOT NULL,
  banco boolean NOT NULL,
  fila boolean NOT NULL,
  sincronizacao boolean NOT NULL,
  pncp_em_manutencao boolean NOT NULL DEFAULT false,
  amostras integer NOT NULL DEFAULT 1 CHECK (amostras >= 1),
  -- Última sondagem do intervalo: latência do banco, tarefas atrasadas, última sincronização do PNCP, réplica.
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT operacao_sondagens_ordem CHECK (fim >= inicio)
);
CREATE INDEX operacao_sondagens_periodo_idx ON operacao_sondagens (inicio, fim);

-- Janelas de manutenção do PNCP informadas pelo órgão (o PNCP divulga as janelas programadas).
-- As janelas detectadas pela fila são calculadas a partir das sondagens e não ficam aqui.
CREATE TABLE operacao_janelas_manutencao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sistema text NOT NULL DEFAULT 'pncp' CHECK (sistema IN ('pncp')),
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  descricao text NOT NULL,
  registrada_por uuid REFERENCES usuarios (id),
  registrada_em timestamptz NOT NULL,
  CONSTRAINT operacao_janelas_ordem CHECK (fim > inicio)
);
CREATE INDEX operacao_janelas_periodo_idx ON operacao_janelas_manutencao (inicio, fim);

-- Metas do ETP configuradas pelo órgão (art. 18, § 1º, IX): uma linha por indicador.
CREATE TABLE metas_etp (
  indicador text PRIMARY KEY CHECK (indicador IN ('tempo_instrucao', 'erros_formais', 'economia')),
  configuracao jsonb NOT NULL,
  atualizada_por uuid REFERENCES usuarios (id),
  atualizada_em timestamptz NOT NULL
);

-- O painel das metas lê da trilha os avanços de etapa e os bloqueios das travas (`trava.bloqueio`) por período.
CREATE INDEX auditoria_eventos_acao_idx ON auditoria_eventos (acao, ocorrido_em);
