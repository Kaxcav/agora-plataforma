-- Recarga única da carga sintética de demonstração (AGORA_SEED_RECRIAR, só com AGORA_AMBIENTE=demonstracao).
-- Cada marca aplicada fica registrada aqui, para que as reinicializações seguintes não apaguem os dados de novo.
CREATE TABLE IF NOT EXISTS recargas_demonstracao (
  marca text PRIMARY KEY CHECK (length(marca) BETWEEN 1 AND 100),
  aplicada_em timestamptz NOT NULL DEFAULT now()
);
