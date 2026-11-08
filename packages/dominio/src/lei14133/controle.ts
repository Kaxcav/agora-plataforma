/**
 * Controle das contratações (Lei 14.133/2021, arts. 169 a 171).
 *
 * - Prazos do controle externo: resposta do órgão à suspensão cautelar (art. 171, § 2º) e decisão de mérito do
 *   tribunal de contas (art. 171, § 1º, informativo).
 * - Situação das medidas de controle e bloqueio por cautelar suspensiva ativa (RN-30).
 * - Revisão trimestral da matriz de riscos do contrato pelas linhas de defesa (RN-29; arts. 22 e 169).
 * - Achados preventivos das linhas de defesa: alterações perto do limite do art. 125 e pagamentos preteridos na
 *   ordem cronológica (art. 141).
 *
 * Funções puras e determinísticas: "hoje" entra como parâmetro; dias úteis seguem o art. 183.
 */
import { ErroDominio } from '../erros.ts';
import { type DataISO, type OpcoesCalendario, adicionarDiasUteis, diasEntre, diasUteisEntre, formatarData } from '../datas.ts';
import { type Centavos } from '../moeda.ts';
import { adicionarMeses, contagem, exigirInteiro, formatarPercentualTexto, lerData } from '../interno.ts';
import { avaliarAditivo } from './aditivos.ts';

export type OrgaoControle = 'TCU' | 'CGU';
export type TipoMedidaControle = 'cautelar' | 'determinacao' | 'diligencia' | 'recomendacao';
export type SituacaoMedidaControle = 'aguardando_resposta' | 'resposta_vencida' | 'respondida' | 'revogada';
export type SemaforoPrazoControle = 'vencido' | 'critico' | 'atencao' | 'regular' | 'concluido';

/** Prazo legal para o órgão responder à ordem de suspensão cautelar (art. 171, § 2º). */
export const PRAZO_RESPOSTA_CAUTELAR_DIAS_UTEIS = 10;
/** Prazo do tribunal de contas para decidir o mérito da suspensão (art. 171, § 1º). */
export const PRAZO_DECISAO_MERITO_DIAS_UTEIS = 25;
/** Periodicidade da revisão da matriz de riscos do contrato, em meses (revisão trimestral). */
export const PERIODICIDADE_REVISAO_RISCOS_MESES = 3;
/** Antecedência, em dias corridos, do alerta de revisão da matriz de riscos a vencer. */
export const ANTECEDENCIA_ALERTA_REVISAO_DIAS = 15;

const NOMES_ORGAO: Record<OrgaoControle, string> = { TCU: 'TCU', CGU: 'CGU' };
const NOMES_TIPO: Record<TipoMedidaControle, string> = {
  cautelar: 'Medida cautelar',
  determinacao: 'Determinação',
  diligencia: 'Diligência',
  recomendacao: 'Recomendação',
};

/**
 * Prazo do órgão para responder à suspensão cautelar do processo licitatório: 10 dias úteis contados da intimação,
 * admitida a prorrogação, para informar as medidas adotadas, prestar as informações cabíveis e apurar
 * responsabilidades, se for o caso (Lei 14.133/2021, art. 171, § 2º, I a III; contagem do art. 183).
 */
export function prazoRespostaCautelar(ciencia: DataISO, opcoes?: OpcoesCalendario): { vencimento: DataISO; diasUteis: number; fundamento: string } {
  lerData(ciencia, 'ciencia');
  return {
    vencimento: adicionarDiasUteis(ciencia, PRAZO_RESPOSTA_CAUTELAR_DIAS_UTEIS, opcoes),
    diasUteis: PRAZO_RESPOSTA_CAUTELAR_DIAS_UTEIS,
    fundamento: 'Lei 14.133/2021, art. 171, § 2º, c/c art. 183',
  };
}

/**
 * Prazo de resposta de uma medida de controle. A cautelar com efeito suspensivo tem sempre o prazo legal de
 * 10 dias úteis (art. 171, § 2º); a prorrogação é registrada à parte. Nas demais medidas (determinação, diligência,
 * recomendação ou cautelar sem suspensão), vale o prazo em dias úteis fixado pelo órgão de controle na comunicação;
 * sem prazo fixado, usa-se como referência o mesmo prazo de 10 dias úteis.
 */
export function prazoRespostaMedida(
  e: { ciencia: DataISO; efeitoSuspensivo: boolean; diasUteisFixados?: number | null },
  opcoes?: OpcoesCalendario,
): { vencimento: DataISO; diasUteis: number; fundamento: string } {
  const fixados = e.diasUteisFixados ?? null;
  if (e.efeitoSuspensivo) {
    if (fixados !== null && fixados !== PRAZO_RESPOSTA_CAUTELAR_DIAS_UTEIS) {
      throw new ErroDominio(
        'PRAZO_CONTROLE_INVALIDO',
        'A suspensão cautelar tem o prazo legal de 10 dias úteis para a resposta do órgão (art. 171, § 2º); a prorrogação é registrada à parte.',
      );
    }
    return prazoRespostaCautelar(e.ciencia, opcoes);
  }
  if (fixados === null) {
    const r = prazoRespostaCautelar(e.ciencia, opcoes);
    return { ...r, fundamento: 'Prazo não fixado na comunicação: referência de 10 dias úteis do art. 171, § 2º, da Lei 14.133/2021' };
  }
  exigirInteiro(fixados, 'diasUteisFixados', 'PRAZO_CONTROLE_INVALIDO', 1);
  if (fixados > 120) throw new ErroDominio('PRAZO_CONTROLE_INVALIDO', `Prazo de ${fixados} dias úteis acima do máximo aceito (120).`);
  lerData(e.ciencia, 'ciencia');
  return {
    vencimento: adicionarDiasUteis(e.ciencia, fixados, opcoes),
    diasUteis: fixados,
    fundamento: 'Prazo fixado pelo órgão de controle na comunicação, contado em dias úteis (Lei 14.133/2021, art. 183)',
  };
}

/**
 * Prazo do tribunal de contas para se pronunciar definitivamente sobre o mérito da irregularidade que motivou a
 * suspensão cautelar: 25 dias úteis contados do recebimento das informações prestadas pelo órgão, prorrogável uma
 * única vez por igual período (Lei 14.133/2021, art. 171, § 1º). Informativo: o prazo é do tribunal, não do órgão.
 */
export function prazoDecisaoMerito(
  recebimentoInformacoes: DataISO,
  prorrogado = false,
  opcoes?: OpcoesCalendario,
): { vencimento: DataISO; diasUteis: number; fundamento: string } {
  lerData(recebimentoInformacoes, 'recebimentoInformacoes');
  const diasUteis = prorrogado ? PRAZO_DECISAO_MERITO_DIAS_UTEIS * 2 : PRAZO_DECISAO_MERITO_DIAS_UTEIS;
  return {
    vencimento: adicionarDiasUteis(recebimentoInformacoes, diasUteis, opcoes),
    diasUteis,
    fundamento: prorrogado ? 'Lei 14.133/2021, art. 171, § 1º (prorrogado uma vez por igual período)' : 'Lei 14.133/2021, art. 171, § 1º',
  };
}

/**
 * Situação de uma medida de controle e semáforo do prazo de resposta do órgão (RN-30). Revogada prevalece sobre
 * respondida; sem resposta, o prazo efetivo é a prorrogação (quando houver) ou o prazo original. Semáforo:
 * vencido; crítico (até 2 dias úteis); atenção (até 5 dias úteis); regular; concluído (respondida ou revogada).
 */
export function situacaoMedidaControle(
  m: { prazoResposta: DataISO; prorrogadoAte: DataISO | null; respondidaEm: DataISO | null; revogadaEm: DataISO | null },
  hoje: DataISO,
  opcoes?: OpcoesCalendario,
): {
  situacao: SituacaoMedidaControle;
  prazoEfetivo: DataISO;
  diasUteisRestantes: number | null;
  semaforo: SemaforoPrazoControle;
  explicacao: string;
} {
  lerData(hoje, 'hoje');
  lerData(m.prazoResposta, 'prazoResposta');
  if (m.prorrogadoAte !== null && lerData(m.prorrogadoAte, 'prorrogadoAte') < lerData(m.prazoResposta, 'prazoResposta')) {
    throw new ErroDominio('PRAZO_CONTROLE_INVALIDO', 'A prorrogação não pode terminar antes do prazo original de resposta.');
  }
  const prazoEfetivo = m.prorrogadoAte ?? m.prazoResposta;
  const descricaoPrazo = m.prorrogadoAte !== null ? `prazo prorrogado até ${formatarData(prazoEfetivo)}` : `prazo até ${formatarData(prazoEfetivo)}`;

  if (m.revogadaEm !== null && lerData(m.revogadaEm, 'revogadaEm') <= lerData(hoje, 'hoje')) {
    return {
      situacao: 'revogada',
      prazoEfetivo,
      diasUteisRestantes: null,
      semaforo: 'concluido',
      explicacao: `Medida revogada ou encerrada pelo órgão de controle em ${formatarData(m.revogadaEm)}.`,
    };
  }
  if (m.respondidaEm !== null) {
    const noPrazo = lerData(m.respondidaEm, 'respondidaEm') <= lerData(prazoEfetivo, 'prazoEfetivo');
    return {
      situacao: 'respondida',
      prazoEfetivo,
      diasUteisRestantes: null,
      semaforo: 'concluido',
      explicacao: `Resposta do órgão registrada em ${formatarData(m.respondidaEm)}, ${noPrazo ? 'dentro do' : 'depois do'} ${descricaoPrazo}.`,
    };
  }
  if (hoje > prazoEfetivo) {
    const vencidos = diasUteisEntre(prazoEfetivo, hoje, opcoes);
    return {
      situacao: 'resposta_vencida',
      prazoEfetivo,
      diasUteisRestantes: -vencidos,
      semaforo: 'vencido',
      explicacao: `Resposta pendente e ${descricaoPrazo} vencido há ${contagem(vencidos, 'dia útil', 'dias úteis')}. O descumprimento enseja apuração de responsabilidade (art. 171, § 4º).`,
    };
  }
  const restantes = diasUteisEntre(hoje, prazoEfetivo, opcoes);
  const quando = restantes === 0 ? 'vence hoje' : restantes === 1 ? 'resta 1 dia útil' : `restam ${restantes} dias úteis`;
  return {
    situacao: 'aguardando_resposta',
    prazoEfetivo,
    diasUteisRestantes: restantes,
    semaforo: restantes <= 2 ? 'critico' : restantes <= 5 ? 'atencao' : 'regular',
    explicacao: `Aguardando a resposta do órgão: ${descricaoPrazo}, ${quando}.`,
  };
}

export interface MedidaParaBloqueio {
  orgao: OrgaoControle;
  tipo: TipoMedidaControle;
  numero: string;
  efeitoSuspensivo: boolean;
  cienciaEm: DataISO;
  revogadaEm: DataISO | null;
}

/**
 * RN-30 — cautelar suspensiva ativa: enquanto houver medida com efeito suspensivo não revogada, o processo não
 * avança de etapa nem gera (assina) o contrato, e o aviso cita o órgão, o número da decisão e a data da ciência
 * (art. 171, §§ 1º e 2º). Medidas sem efeito suspensivo não bloqueiam: só geram prazo de resposta.
 */
export function bloqueioControleExterno<T extends MedidaParaBloqueio>(
  medidas: readonly T[],
  hoje: DataISO,
): { bloqueado: boolean; ativas: T[]; mensagem: string | null; fundamento: string } {
  const dia = lerData(hoje, 'hoje');
  const ativas = medidas.filter((m) => m.efeitoSuspensivo && (m.revogadaEm === null || lerData(m.revogadaEm, 'revogadaEm') > dia));
  const fundamento = 'Lei 14.133/2021, art. 171, §§ 1º e 2º';
  if (ativas.length === 0) return { bloqueado: false, ativas, mensagem: null, fundamento };
  const descricoes = ativas.map(
    (m) => `${NOMES_TIPO[m.tipo].toLowerCase()} do ${NOMES_ORGAO[m.orgao]} nº ${m.numero} (ciência em ${formatarData(m.cienciaEm)})`,
  );
  const lista = descricoes.length === 1 ? descricoes[0] : `${descricoes.slice(0, -1).join('; ')} e ${descricoes[descricoes.length - 1]}`;
  return {
    bloqueado: true,
    ativas,
    mensagem: `Suspensão cautelar em vigor — ${lista}. O avanço de etapa e a assinatura do contrato ficam bloqueados até a revogação ou a decisão de mérito do órgão de controle.`,
    fundamento,
  };
}

/**
 * RN-29 — revisão trimestral da matriz de riscos do contrato pela equipe de gestão e fiscalização (1ª linha) e pela
 * unidade de controle interno (2ª linha), nos termos da própria matriz (arts. 22 e 169). A próxima revisão vence
 * 3 meses após a última (ou após o início da vigência, se ainda não houve revisão); o alerta "a vencer" aparece
 * 15 dias antes. Contrato com vigência encerrada não exige revisão.
 */
export function situacaoRevisaoRiscos(e: {
  inicioVigencia: DataISO;
  vigenciaFim: DataISO;
  ultimaRevisao: DataISO | null;
  hoje: DataISO;
}): {
  situacao: 'em_dia' | 'a_vencer' | 'vencida' | 'encerrado';
  proximaRevisao: DataISO | null;
  diasRestantes: number | null;
  explicacao: string;
  fundamento: string;
} {
  const inicio = lerData(e.inicioVigencia, 'inicioVigencia');
  const fim = lerData(e.vigenciaFim, 'vigenciaFim');
  const hoje = lerData(e.hoje, 'hoje');
  if (fim < inicio) throw new ErroDominio('DATA_INVALIDA', 'O fim da vigência é anterior ao início.');
  if (e.ultimaRevisao !== null) lerData(e.ultimaRevisao, 'ultimaRevisao');
  const fundamento = 'Lei 14.133/2021, arts. 22 e 169; matriz de riscos do contrato (revisão trimestral)';

  if (fim < hoje) {
    return {
      situacao: 'encerrado',
      proximaRevisao: null,
      diasRestantes: null,
      explicacao: 'Vigência encerrada: a matriz de riscos não exige nova revisão.',
      fundamento,
    };
  }
  const base = e.ultimaRevisao ?? e.inicioVigencia;
  const proximaRevisao = adicionarMeses(base, PERIODICIDADE_REVISAO_RISCOS_MESES);
  const diasRestantes = diasEntre(e.hoje, proximaRevisao);
  const origem = e.ultimaRevisao !== null ? `última revisão em ${formatarData(e.ultimaRevisao)}` : `início da vigência em ${formatarData(e.inicioVigencia)}, sem revisão registrada`;
  if (diasRestantes < 0) {
    return {
      situacao: 'vencida',
      proximaRevisao,
      diasRestantes,
      explicacao: `Revisão trimestral vencida desde ${formatarData(proximaRevisao)} (${origem}), há ${contagem(-diasRestantes, 'dia', 'dias')}.`,
      fundamento,
    };
  }
  const quando = diasRestantes === 0 ? 'vence hoje' : `vence em ${formatarData(proximaRevisao)}, daqui a ${contagem(diasRestantes, 'dia', 'dias')}`;
  return {
    situacao: diasRestantes <= ANTECEDENCIA_ALERTA_REVISAO_DIAS ? 'a_vencer' : 'em_dia',
    proximaRevisao,
    diasRestantes,
    explicacao: `Próxima revisão trimestral ${quando} (${origem}).`,
    fundamento,
  };
}

/**
 * Achado preventivo das linhas de defesa: acréscimos ou supressões acumulados perto (80% ou mais do limite) ou
 * acima do limite de alterações do art. 125 (25%, ou 50% para acréscimos em reforma de edifício ou de
 * equipamento). Reaproveita `avaliarAditivo`; acréscimos e supressões são computados separadamente.
 */
export function avaliarLimiteAditivos(e: {
  valorInicialAtualizado: Centavos;
  acrescimos: Centavos;
  supressoes: Centavos;
  reformaEdificioOuEquipamento?: boolean;
}): {
  nivel: 'regular' | 'proximo' | 'excedido';
  percentualAcrescimos: number;
  percentualSupressoes: number;
  limiteAcrescimos: number;
  explicacao: string;
  fundamento: string;
} {
  const base = { valorInicialAtualizado: e.valorInicialAtualizado, acrescimosAnteriores: e.acrescimos, supressoesAnteriores: e.supressoes, valor: 0 };
  const acrescimo = avaliarAditivo({ ...base, tipo: 'acrescimo', reformaEdificioOuEquipamento: e.reformaEdificioOuEquipamento === true });
  const supressao = avaliarAditivo({ ...base, tipo: 'supressao' });
  const proporcao = Math.max(acrescimo.percentualAcumulado / acrescimo.limitePercentual, supressao.percentualAcumulado / supressao.limitePercentual);
  const nivel = !acrescimo.permitido || !supressao.permitido ? 'excedido' : proporcao >= 0.8 ? 'proximo' : 'regular';
  const resumo = `Acréscimos de ${formatarPercentualTexto(acrescimo.percentualAcumulado)} (limite ${acrescimo.limitePercentual}%) e supressões de ${formatarPercentualTexto(supressao.percentualAcumulado)} (limite 25%) do valor inicial atualizado.`;
  const conclusao =
    nivel === 'excedido'
      ? 'Alterações acima do limite legal: verifique o fundamento de cada termo.'
      : nivel === 'proximo'
        ? 'Alterações perto do limite legal: novos aditivos exigem atenção.'
        : 'Alterações dentro do limite legal.';
  return {
    nivel,
    percentualAcrescimos: acrescimo.percentualAcumulado,
    percentualSupressoes: supressao.percentualAcumulado,
    limiteAcrescimos: acrescimo.limitePercentual,
    explicacao: `${resumo} ${conclusao}`,
    fundamento: 'Lei 14.133/2021, art. 125',
  };
}

export interface PagamentoOrdemCronologica {
  id: string;
  fonteRecurso: string;
  vencimento: DataISO;
  pagoEm: DataISO | null;
  /** Nota atestada, liquidada ou paga (obrigação exigível na data de vencimento). */
  exigivel: boolean;
}

/**
 * Achado preventivo do art. 141: pagamento exigível preterido, isto é, nota da mesma fonte de recurso com vencimento
 * anterior que continuava sem pagamento quando notas de vencimento posterior foram pagas. A alteração da ordem
 * cronológica só é admitida nas hipóteses do art. 141, § 1º, com justificativa prévia da autoridade competente e
 * comunicação posterior ao controle interno e ao tribunal de contas. É um sinal para conferência, não uma conclusão:
 * a justificativa pode existir fora do sistema.
 */
export function pagamentosPreteridos(
  pagamentos: readonly PagamentoOrdemCronologica[],
  hoje: DataISO,
): { id: string; vencimento: DataISO; pagoEm: DataISO | null; posterioresPagos: number; fundamento: string }[] {
  const dia = lerData(hoje, 'hoje');
  const porFonte = new Map<string, PagamentoOrdemCronologica[]>();
  for (const p of pagamentos) {
    lerData(p.vencimento, 'vencimento');
    if (p.pagoEm !== null) lerData(p.pagoEm, 'pagoEm');
    const lista = porFonte.get(p.fonteRecurso) ?? [];
    lista.push(p);
    porFonte.set(p.fonteRecurso, lista);
  }
  const resultado: { id: string; vencimento: DataISO; pagoEm: DataISO | null; posterioresPagos: number; fundamento: string }[] = [];
  for (const lista of porFonte.values()) {
    const pagos = lista.filter((p) => p.pagoEm !== null && lerData(p.pagoEm, 'pagoEm') <= dia);
    for (const q of lista) {
      if (!q.exigivel) continue;
      const posteriores = pagos.filter((p) => {
        const pagoEm = p.pagoEm as DataISO;
        return p.id !== q.id && p.vencimento > q.vencimento && q.vencimento <= pagoEm && (q.pagoEm === null || q.pagoEm > pagoEm);
      }).length;
      if (posteriores > 0) {
        resultado.push({ id: q.id, vencimento: q.vencimento, pagoEm: q.pagoEm, posterioresPagos: posteriores, fundamento: 'Lei 14.133/2021, art. 141, caput e § 1º' });
      }
    }
  }
  return resultado.sort((a, b) => (a.vencimento < b.vencimento ? -1 : a.vencimento > b.vencimento ? 1 : a.id.localeCompare(b.id)));
}
