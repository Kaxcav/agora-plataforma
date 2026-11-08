/**
 * Condições SQL do sigilo (RN-40) para as buscas públicas: quem não vê o conteúdo não pode descobrir o objeto de uma
 * contratação ou de um contrato sigiloso pela busca. Sem importações, para os módulos públicos usarem sem ciclo.
 */
/** Condição SQL (alias `c` de contratos): contrato sem classificação vigente, para a busca pública não revelar o objeto. */
export const SQL_CONTRATO_SEM_SIGILO = `NOT EXISTS (
       SELECT 1 FROM sigilo_classificacoes s
        WHERE s.situacao = 'vigente' AND s.tipo = 'lai'
          AND (s.contrato_id = c.id OR (s.alvo = 'processo' AND s.processo_id IN (SELECT pr.id FROM processos pr WHERE pr.contrato_id = c.id))))`;

/** Condição SQL (alias `p` de processos): processo sem classificação vigente pela LAI, para a busca pública. */
export const SQL_PROCESSO_SEM_SIGILO = `NOT EXISTS (
       SELECT 1 FROM sigilo_classificacoes s WHERE s.processo_id = p.id AND s.alvo = 'processo' AND s.situacao = 'vigente')`;
