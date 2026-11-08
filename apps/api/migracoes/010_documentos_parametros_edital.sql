-- Integridade do pacote do edital (RN-06): hash dos parâmetros do edital vigentes quando o TR, o edital ou a
-- minuta foram gerados. Documento gerado com parâmetros diferentes dos atuais não conta como aprovado no avanço
-- da etapa 4 para a 5. Nulo para os demais documentos e para os gerados antes desta migração.

ALTER TABLE documentos_gerados ADD COLUMN hash_parametros text CHECK (hash_parametros IS NULL OR hash_parametros ~ '^[0-9a-f]{64}$');
