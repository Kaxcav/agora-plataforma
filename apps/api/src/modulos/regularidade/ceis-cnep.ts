import { mascararDocumento, mascararNome, prazoRegistroCeisCnep, situacaoRegistroCeisCnep, type OpcoesCalendario } from '@agora/dominio';
import type { RegistroSancaoCeisCnep, TipoSancao } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';

/**
 * Sanções aplicadas e o registro de cada uma no CEIS/CNEP (RN-24, art. 161). Sem API pública de escrita, a
 * obrigação vira pendência com prazo de 15 dias úteis (calculado por @agora/dominio) até o responsável informar
 * o protocolo do envio feito no sistema da CGU.
 */

interface LinhaRegistro {
  sancao_id: string;
  tipo: TipoSancao;
  inciso_infracao: string;
  aplicada_em: string;
  prazo_registro_ceis_cnep: string | null;
  registrada_ceis_cnep: boolean;
  contrato_id: string | null;
  contrato_numero: string | null;
  fornecedor_id: string;
  documento: string;
  tipo_pessoa: 'PJ' | 'PF';
  razao_social: string;
  cadastro: 'CEIS' | 'CNEP' | null;
  protocolo: string | null;
  enviado_em: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  registrado_em: string | null;
  observacao: string | null;
}

const ORDEM_SITUACAO: Record<RegistroSancaoCeisCnep['situacao'], number> = {
  pendente_vencida: 0,
  pendente_no_prazo: 1,
  registrada_fora_do_prazo: 2,
  registrada_no_prazo: 3,
};

export async function listarRegistrosCeisCnep(
  executor: Executor,
  filtro: { escopo: string[] | null; sancaoId?: string },
  hoje: string,
  calendario: OpcoesCalendario,
): Promise<RegistroSancaoCeisCnep[]> {
  const linhas = await executor.consultar<LinhaRegistro>(
    `SELECT s.id AS sancao_id, s.tipo, s.inciso_infracao, s.aplicada_em, s.prazo_registro_ceis_cnep, s.registrada_ceis_cnep,
            s.contrato_id, c.numero AS contrato_numero, f.id AS fornecedor_id, f.documento, f.tipo_pessoa, f.razao_social,
            e.cadastro, e.protocolo, e.enviado_em, e.responsavel_id, u.nome AS responsavel_nome, e.registrado_em, e.observacao
       FROM sancoes s
       JOIN fornecedores f ON f.id = s.fornecedor_id
       LEFT JOIN contratos c ON c.id = s.contrato_id
       LEFT JOIN sancoes_envios_ceis_cnep e ON e.sancao_id = s.id
       LEFT JOIN usuarios u ON u.id = e.responsavel_id
      WHERE s.situacao = 'aplicada' AND s.aplicada_em IS NOT NULL
        AND ($1::text[] IS NULL OR s.contrato_id IS NULL OR c.uasg = ANY($1::text[]))
        AND ($2::uuid IS NULL OR s.id = $2)
      ORDER BY s.aplicada_em DESC, s.id`,
    [filtro.escopo, filtro.sancaoId ?? null],
  );
  const registros = linhas.map((l): RegistroSancaoCeisCnep => {
    const base = {
      sancao: {
        id: l.sancao_id,
        tipo: l.tipo,
        incisoInfracao: l.inciso_infracao,
        aplicadaEm: l.aplicada_em,
        contrato: l.contrato_id !== null && l.contrato_numero !== null ? { id: l.contrato_id, numero: l.contrato_numero } : null,
      },
      fornecedor: {
        id: l.fornecedor_id,
        razaoSocial: l.tipo_pessoa === 'PF' ? mascararNome(l.razao_social) : l.razao_social,
        documento: mascararDocumento(l.documento),
      },
    };
    const envio =
      l.cadastro !== null && l.protocolo !== null && l.enviado_em !== null && l.registrado_em !== null
        ? {
            cadastro: l.cadastro,
            protocolo: l.protocolo,
            enviadoEm: l.enviado_em,
            responsavel: usuarioResumo(l.responsavel_id, l.responsavel_nome),
            registradoEm: l.registrado_em,
            observacao: l.observacao,
          }
        : null;
    if (envio === null && l.registrada_ceis_cnep) {
      // Registro informado antes da Ágora controlar o protocolo (dado legado): considerado registrado.
      const prazo = l.prazo_registro_ceis_cnep ?? prazoRegistroCeisCnep(l.aplicada_em, calendario).vencimento;
      return {
        ...base,
        prazo,
        situacao: 'registrada_no_prazo',
        diasUteisRestantes: null,
        diasUteisAtraso: null,
        alerta: false,
        mensagem: 'Registro no CEIS/CNEP informado sem protocolo na Ágora.',
        envio: null,
      };
    }
    const s = situacaoRegistroCeisCnep({ aplicacao: l.aplicada_em, enviadoEm: envio?.enviadoEm ?? null, hoje }, calendario);
    return {
      ...base,
      prazo: s.vencimento,
      situacao: s.situacao,
      diasUteisRestantes: s.diasUteisRestantes,
      diasUteisAtraso: s.diasUteisAtraso,
      alerta: s.alerta,
      mensagem: s.mensagem,
      envio,
    };
  });
  return registros.sort((a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao] || a.prazo.localeCompare(b.prazo));
}
