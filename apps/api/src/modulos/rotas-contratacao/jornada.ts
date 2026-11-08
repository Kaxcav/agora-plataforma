/**
 * Adaptação da jornada pela rota de contratação (F9, RF-34): o único ponto em que a jornada consulta a rota.
 * As regras das 7 etapas continuam as da licitação; aqui se retiram os bloqueios que a rota dispensa (edital,
 * disputa, publicação do edital, ETP facultativo...) e se acrescentam os da rota (aviso de dispensa, autorização da
 * contratação direta, adesão, compra no Sicx). O que cada rota exige vem de `adaptacaoDaRota` (@agora/dominio).
 */
import {
  adaptacaoDaRota,
  formatarData,
  prazoContratacaoAdesao,
  prazoDivulgacaoContratoPncp,
  validarEscolhaRota,
  type AdaptacaoRota,
  type OpcoesCalendario,
} from '@agora/dominio';
import type { Bloqueio, EtapaJornada, Sinal } from '@agora/contratos';
import type { Executor, Transacao } from '../../banco/tipos.ts';
import { regraNegocio } from '../../http/erros.ts';
import { MINIMO_CARACTERES_TEXTO, TITULOS_DOCUMENTO } from '../jornada/constantes.ts';
import { tipoDispensa, type ResultadoRegras } from '../jornada/regras.ts';
import type { CargaProcesso, LinhaProcesso, TipoDocumento } from '../jornada/tipos.ts';
import { adaptacaoDaLinha, carregarRota, fracionamentoDaUasg, montarAviso, montarInexigibilidade, type CargaRota } from './repositorio.ts';

const FUNDAMENTO_ROTA = 'Lei 14.133/2021, art. 72 (RF-34)';

function suficiente(texto: string | null | undefined): boolean {
  return (texto ?? '').trim().length >= MINIMO_CARACTERES_TEXTO;
}

function porValor(carga: CargaRota): boolean {
  return carga.rota.rota === 'dispensa' && (carga.rota.hipotese_dispensa === 'valor_demais' || carga.rota.hipotese_dispensa === 'valor_obras_engenharia');
}

/** Bloqueio de um documento que a rota não exige (mensagens das regras RIA-04 e RN-06 citam o título do documento). */
function citaDocumento(b: Bloqueio, tipos: readonly TipoDocumento[]): boolean {
  return (b.regra === 'RIA-04' || b.regra === 'RN-06') && tipos.some((t) => b.mensagem.includes(`"${TITULOS_DOCUMENTO[t]}"`));
}

/** Pendências da rota na etapa atual (bloqueios acrescentados pela rota), na ordem de exame. */
export async function pendenciasDaRota(
  executor: Executor,
  linha: LinhaProcesso,
  carga: CargaRota,
  adaptacao: AdaptacaoRota,
  valorEstimado: number | null,
  hoje: string,
  calendario: OpcoesCalendario,
): Promise<{ bloqueios: { regra: string; mensagem: string; fundamento: string }[]; sinais: Sinal[] }> {
  const bloqueios: { regra: string; mensagem: string; fundamento: string }[] = [];
  const sinais: Sinal[] = [];
  const { rota } = carga;
  const etapa = linha.etapa_atual;
  if (etapa === 1) {
    const escolha = validarEscolhaRota(
      {
        rota: rota.rota,
        hipoteseDispensa: rota.hipotese_dispensa,
        incisoDispensa: rota.inciso_dispensa,
        hipoteseInexigibilidade: rota.hipotese_inexigibilidade,
        justificativa: rota.justificativa,
        natureza: rota.natureza,
        valorEstimado,
        tipoObjeto: tipoDispensa(linha.dfd.tipoObjeto),
        data: hoje,
      },
      MINIMO_CARACTERES_TEXTO,
    );
    for (const p of escolha.pendencias) bloqueios.push({ regra: porValor(carga) && p.campo === 'valorEstimado' ? 'RN-41' : 'RF-34', mensagem: p.mensagem, fundamento: escolha.fundamento });
    if (porValor(carga) && rota.natureza && valorEstimado !== null && valorEstimado > 0) {
      const f = await fracionamentoDaUasg(executor, {
        uasg: linha.uasg,
        natureza: rota.natureza,
        tipo: tipoDispensa(linha.dfd.tipoObjeto),
        novaContratacao: valorEstimado,
        hoje,
        excetoProcesso: linha.id,
      });
      if (f.sinal !== 'sem_risco') sinais.push({ regra: 'RIA-01', nivel: f.sinal === 'risco' ? 'risco' : 'atencao', mensagem: f.explicacao, fundamento: f.fundamento });
      if (f.sinal === 'risco' && !suficiente(rota.justificativa_fracionamento)) {
        bloqueios.push({
          regra: 'RN-41',
          mensagem: `Indício de fracionamento no ramo "${f.natureza}": registre a análise do agente (mínimo de ${MINIMO_CARACTERES_TEXTO} caracteres) ou licite o objeto.`,
          fundamento: 'Lei 14.133/2021, art. 75, § 1º',
        });
      }
    }
    if (rota.rota === 'adesao_ata' && !carga.adesao) {
      bloqueios.push({ regra: 'RF-34', mensagem: 'Registre a adesão: ata, item e quantidade, com a justificativa da vantagem.', fundamento: 'Lei 14.133/2021, art. 86, § 2º' });
    }
  }
  if (etapa === 4 && rota.rota === 'inexigibilidade') {
    const inex = montarInexigibilidade(rota);
    for (const p of inex?.pendencias ?? []) bloqueios.push({ regra: 'RF-34', mensagem: p, fundamento: 'Lei 14.133/2021, art. 74' });
  }
  if (etapa === 5) {
    if (adaptacao.avisoDispensa) {
      const aviso = montarAviso(carga.aviso, hoje, calendario);
      const fundamento = 'Lei 14.133/2021, art. 75, § 3º';
      if (!aviso) bloqueios.push({ regra: 'RN-41', mensagem: 'Publique o aviso de contratação direta no PNCP, por no mínimo 3 dias úteis, para receber propostas adicionais.', fundamento });
      else if (aviso.situacao !== 'publicado') bloqueios.push({ regra: 'RN-41', mensagem: aviso.mensagem, fundamento });
      else if (aviso.aberto && aviso.encerramento) {
        bloqueios.push({ regra: 'RN-41', mensagem: `O aviso está aberto até ${formatarData(aviso.encerramento)} para propostas adicionais: o julgamento começa depois do encerramento.`, fundamento });
      }
    }
    if (rota.rota === 'adesao_ata') {
      const a = carga.adesao;
      const fundamento = 'Lei 14.133/2021, art. 86, § 2º, III; Decreto 11.462/2023, art. 31, § 1º';
      if (!a) bloqueios.push({ regra: 'RF-34', mensagem: 'Registre a adesão à ata.', fundamento });
      else if (a.situacao === 'recusada') bloqueios.push({ regra: 'RF-34', mensagem: `O gerenciador recusou a adesão: ${a.motivo_recusa ?? 'sem motivo registrado'}.`, fundamento });
      else if (a.situacao === 'solicitada') bloqueios.push({ regra: 'RF-34', mensagem: 'Registre o aceite do fornecedor à adesão (antes da anuência do gerenciador).', fundamento });
      else if (a.situacao === 'aceita_fornecedor') bloqueios.push({ regra: 'RF-34', mensagem: 'Aguardando a anuência do órgão gerenciador da ata.', fundamento });
    }
  }
  if (etapa === 6) {
    if (adaptacao.avisoDispensa && rota.julgado_em === null) {
      bloqueios.push({ regra: 'RN-41', mensagem: 'Julgue as propostas recebidas no aviso e selecione a mais vantajosa.', fundamento: 'Lei 14.133/2021, art. 75, § 3º' });
    }
    if (adaptacao.autorizacaoContratacao && !rota.autorizacao) {
      bloqueios.push({
        regra: 'RF-34',
        mensagem: 'Registre a autorização da contratação pela autoridade competente, com a razão da escolha e a justificativa de preço.',
        fundamento: 'Lei 14.133/2021, art. 72, VI a VIII',
      });
    }
    if (rota.rota === 'sicx' && !carga.compras.some((c) => c.situacao === 'concluida')) {
      bloqueios.push({ regra: 'RN-42', mensagem: 'Selecione a oferta na vitrine do Sicx, emita a ordem de compra e registre a conclusão por outro agente.', fundamento: 'Decreto 13.106/2026, arts. 19 a 21' });
    }
  }
  if (etapa === 7) {
    if (rota.rota === 'adesao_ata' && carga.adesao?.anuencia_em && linha.contrato_id === null) {
      const prazo = prazoContratacaoAdesao({ autorizadaEm: carga.adesao.anuencia_em, vigenciaFimAta: carga.adesao.ata_vigencia_fim, hoje });
      if (prazo.vencido) bloqueios.push({ regra: 'RF-34', mensagem: `O prazo para contratar a adesão venceu em ${formatarData(prazo.limite)}: peça nova anuência ao gerenciador.`, fundamento: prazo.fundamento });
      else sinais.push({ regra: 'RF-34', nivel: 'informativo', mensagem: `Contrate a adesão até ${formatarData(prazo.limite)} (90 dias da anuência, na vigência da ata).`, fundamento: prazo.fundamento });
    }
    for (const c of carga.compras) {
      if (c.prazos && c.prazos.situacao !== 'paga') {
        sinais.push({ regra: 'RN-42', nivel: c.prazos.pagamentoVencido ? 'risco' : 'informativo', mensagem: `Compra ${c.numero}: ${c.prazos.mensagem}`, fundamento: 'Decreto 13.106/2026, arts. 22 e 23' });
      }
    }
  }
  return { bloqueios, sinais };
}

/**
 * Aplica a rota sobre as regras da etapa atual. Sem rota registrada, o processo segue a licitação e nada muda.
 * Chamado por `avaliarProcesso` (jornada) antes das travas do controle externo, que valem para qualquer rota.
 */
export async function aplicarRotaContratacao(
  executor: Executor,
  carga: CargaProcesso,
  resultado: ResultadoRegras,
  hoje: string,
  calendario: OpcoesCalendario,
  valorEstimado: number | null,
): Promise<ResultadoRegras> {
  const { linha } = carga;
  const rota = await carregarRota(executor, linha.id, hoje, calendario);
  if (!rota) return resultado;
  const a = adaptacaoDaLinha(rota.rota);
  const etapa = linha.etapa_atual;
  let bloqueios = resultado.bloqueios;
  const sinais = [...resultado.sinais];
  if (rota.rota.rota !== 'licitacao') {
    if (etapa === 3) {
      const etpFacultativo = a.etp !== 'obrigatorio' && bloqueios.some((b) => b.regra === 'RN-04');
      if (etpFacultativo) {
        bloqueios = bloqueios.filter((b) => b.regra !== 'RN-04');
        sinais.push({ regra: 'RF-34', nivel: 'informativo', mensagem: `ETP facultativo na ${a.titulo.toLowerCase()}: complete-o se ajudar a instruir o processo.`, fundamento: 'IN SEGES/ME 58/2022, art. 14, I' });
      }
      if (a.matrizRiscos !== 'obrigatorio') bloqueios = bloqueios.filter((b) => !(b.regra === 'RF-15' && b.mensagem.startsWith('Registre ao menos um risco')));
      if (a.pesquisaPrecos !== 'obrigatorio' && bloqueios.some((b) => b.regra === 'RN-05')) {
        bloqueios = bloqueios.filter((b) => b.regra !== 'RN-05');
        sinais.push({ regra: 'RN-42', nivel: 'informativo', mensagem: 'No Sicx a estimativa vem das ofertas da plataforma; a cesta de preços é facultativa.', fundamento: 'Decreto 13.106/2026, art. 16 e art. 36' });
      }
    }
    if (etapa === 4) {
      const dispensados: TipoDocumento[] = [];
      if (a.edital !== 'obrigatorio') dispensados.push('edital');
      if (a.minutaContrato !== 'obrigatorio') dispensados.push('minuta_contrato');
      if (a.termoReferencia !== 'obrigatorio') dispensados.push('tr');
      bloqueios = bloqueios.filter((b) => !citaDocumento(b, dispensados));
      if (a.termoReferencia !== 'obrigatorio') bloqueios = bloqueios.filter((b) => b.regra !== 'RN-21');
      if (rota.rota.rota === 'sicx') bloqueios = bloqueios.filter((b) => !['RN-06', 'RN-20', 'RN-22'].includes(b.regra));
    }
    if (etapa === 5) {
      bloqueios = bloqueios.filter((b) => b.regra !== 'RN-07' && b.regra !== 'RN-15');
      if (a.parecerJuridico !== 'obrigatorio' && bloqueios.some((b) => b.regra === 'RF-15')) {
        bloqueios = bloqueios.filter((b) => b.regra !== 'RF-15');
        sinais.push({ regra: 'RF-34', nivel: 'informativo', mensagem: 'Parecer jurídico facultativo nesta rota: registre-o se a assessoria jurídica tiver examinado o processo.', fundamento: 'Lei 14.133/2021, art. 72, III' });
      }
    }
    if (etapa === 6) bloqueios = [];
    if (etapa === 7) {
      if (rota.rota.rota === 'sicx') bloqueios = [];
      const indice = sinais.findIndex((s) => s.regra === 'RN-11');
      if (indice >= 0 && linha.contrato_numero && linha.contrato_assinatura_em && a.divulgacaoContrato === 'contratacao_direta') {
        const limite = prazoDivulgacaoContratoPncp(linha.contrato_assinatura_em, 'contratacao_direta', calendario).limite;
        sinais[indice] = {
          regra: 'RN-11',
          nivel: 'informativo',
          mensagem: `Contrato ${linha.contrato_numero} gerado: divulgue-o no PNCP até ${formatarData(limite)} (10 dias úteis da contratação direta) — condição de eficácia.`,
          fundamento: 'Lei 14.133/2021, art. 94, II',
        };
      }
    }
  }
  const extra = await pendenciasDaRota(executor, linha, rota, a, valorEstimado, hoje, calendario);
  return {
    bloqueios: [...bloqueios, ...extra.bloqueios.map((b) => ({ ...b, etapa: etapa as EtapaJornada }))],
    sinais: [...sinais, ...extra.sinais],
  };
}

export type AcaoJornada = 'publicar_edital' | 'registrar_disputa' | 'contratar';

/**
 * Trava das ações da licitação nas rotas diretas: publicar o edital e registrar a disputa só na licitação; no Sicx a
 * conclusão da compra é a contratação, e a jornada não gera contrato (Decreto 13.106/2026, art. 21).
 */
export async function exigirAcaoNaRota(executor: Executor, processoId: string, acao: AcaoJornada): Promise<void> {
  const [linha] = await executor.consultar<{ rota: string }>('SELECT rota FROM processos_rotas WHERE processo_id = $1', [processoId]);
  const rota = linha?.rota ?? 'licitacao';
  if (rota === 'licitacao') return;
  if (acao === 'publicar_edital') {
    throw regraNegocio('Nesta rota não há edital: a divulgação é a do aviso de contratação direta ou a do ato que autoriza a contratação (art. 72, parágrafo único).', [
      { campo: 'RF-34', mensagem: `Rota de contratação: ${rota}` },
    ]);
  }
  if (acao === 'registrar_disputa') {
    throw regraNegocio('Nesta rota não há disputa da licitação: a seleção é feita pelas ações da rota de contratação.', [{ campo: 'RF-34', mensagem: `Rota de contratação: ${rota}` }]);
  }
  if (rota === 'sicx') {
    throw regraNegocio('No Sicx a conclusão da compra é a própria contratação: acompanhe o recebimento e o pagamento na compra.', [
      { campo: 'RN-42', mensagem: 'Decreto 13.106/2026, art. 21' },
    ]);
  }
}

/**
 * Depois de a jornada gerar o contrato de uma rota direta: origem "contratação direta" (ou a ata, na adesão),
 * modalidade da rota e prazo de divulgação no PNCP de 10 dias úteis (art. 94, II) na pendência de divulgação.
 */
export async function ajustarContratoPelaRota(
  tx: Transacao,
  processoId: string,
  contratoId: string,
  ctx: { hoje: string; calendario: OpcoesCalendario },
): Promise<void> {
  const [linha] = await tx.consultar<{ rota: 'licitacao' | 'dispensa' | 'inexigibilidade' | 'adesao_ata' | 'sicx'; hipotese_dispensa: 'valor_obras_engenharia' | 'valor_demais' | 'outra' | null }>(
    'SELECT rota, hipotese_dispensa FROM processos_rotas WHERE processo_id = $1',
    [processoId],
  );
  if (!linha || linha.rota === 'licitacao') return;
  const a = adaptacaoDaRota(linha.rota, linha.hipotese_dispensa);
  const [adesao] = linha.rota === 'adesao_ata' ? await tx.consultar<{ ata_id: string; item_ata_id: string }>('SELECT ata_id, item_ata_id FROM atas_adesoes WHERE processo_id = $1', [processoId]) : [];
  await tx.executar('UPDATE contratos SET origem = $2, modalidade = $3, ata_id = COALESCE($4::uuid, ata_id) WHERE id = $1', [contratoId, a.origemContrato, a.modalidade, adesao?.ata_id ?? null]);
  if (adesao) await tx.executar('UPDATE itens_contrato SET item_ata_id = $2 WHERE contrato_id = $1 AND numero = 1', [contratoId, adesao.item_ata_id]);
  if (a.divulgacaoContrato === 'contratacao_direta') {
    const prazo = prazoDivulgacaoContratoPncp(ctx.hoje, 'contratacao_direta', ctx.calendario);
    await tx.executar(
      `UPDATE pendencias SET prazo = $2, motivo = $3
        WHERE instrumento_tipo = 'contrato' AND instrumento_id = $1 AND tipo = 'divulgacao_pncp'`,
      [contratoId, prazo.limite, `Divulgar o contrato no PNCP até ${formatarData(prazo.limite)} — condição de eficácia (art. 94, II)`],
    );
  }
}
