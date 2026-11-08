/**
 * Relatório executivo de auditoria das linhas de defesa (Lei 14.133/2021, arts. 169 e 171, II), em PDF gerado no
 * servidor pelo gerador de texto da Ágora. Traz período, data de emissão, emitente, fontes e ressalvas; os achados são
 * sinais para conferência e o documento requer revisão humana.
 */
import { createHash } from 'node:crypto';
import { formatarData } from '@agora/dominio';
import type { MedidaControle, PainelTerceiraLinha } from '@agora/contratos';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';

const ORGAO_POR_EXTENSO: Record<MedidaControle['orgao'], string> = { TCU: 'TCU', CGU: 'CGU' };
const TIPO_MEDIDA: Record<MedidaControle['tipo'], string> = {
  cautelar: 'Medida cautelar',
  determinacao: 'Determinação',
  diligencia: 'Diligência',
  recomendacao: 'Recomendação',
};
const SITUACAO_MEDIDA: Record<MedidaControle['situacao'], string> = {
  aguardando_resposta: 'aguardando resposta',
  resposta_vencida: 'resposta com prazo vencido',
  respondida: 'respondida',
  revogada: 'revogada',
};

export interface DadosRelatorio {
  orgao: { nome: string; sigla: string; unidade: string };
  emitidoPor: string;
  painel: PainelTerceiraLinha;
}

function instanteBrasilia(instante: string): string {
  const data = new Date(Date.parse(instante) - 3 * 60 * 60 * 1000);
  const dia = data.toISOString().slice(0, 10);
  return `${formatarData(dia)} às ${data.toISOString().slice(11, 16)} (horário de Brasília)`;
}

function linhaMedida(m: MedidaControle): string {
  const prazo = m.prorrogacao ? m.prorrogacao.ate : m.prazoResposta;
  const partes = [
    `**${ORGAO_POR_EXTENSO[m.orgao]} — ${TIPO_MEDIDA[m.tipo]} nº ${m.numero}**${m.efeitoSuspensivo ? ' (efeito suspensivo)' : ''}`,
    `${m.alvo.identificador}`,
    `ciência em ${formatarData(m.cienciaEm)}`,
    `prazo de resposta ${formatarData(prazo)}`,
    `situação: ${SITUACAO_MEDIDA[m.situacao]}`,
  ];
  if (m.bloqueia) partes.push('bloqueia avanço e contratação (RN-30)');
  if (m.prazoDecisaoMerito) partes.push(`prazo do tribunal para o mérito: ${formatarData(m.prazoDecisaoMerito.limite)}`);
  return `- ${partes.join(' · ')}`;
}

/** Conteúdo do relatório em texto simples (Markdown que o gerador de PDF entende). */
export function conteudoRelatorio(d: DadosRelatorio): string {
  const p = d.painel;
  const i = p.indicadores;
  const l1 = p.primeiraLinha;
  const l2 = p.segundaLinha;
  const escopo = p.uasg === null ? 'todas as UASGs do escopo do emitente' : `UASG ${p.uasg}`;
  const integridade = p.integridade.integra
    ? `Íntegra: ${p.integridade.eventosVerificados} evento(s) verificados, sem quebra na cadeia de hashes.`
    : `Falha na verificação: evento nº ${p.integridade.primeiraFalha?.sequencia ?? '—'} — ${p.integridade.primeiraFalha?.motivo ?? 'motivo não informado'}.`;
  const linhas: string[] = [
    '# Relatório executivo de auditoria — linhas de defesa',
    `${d.orgao.nome} (${d.orgao.sigla}) — ${d.orgao.unidade}`,
    '',
    `**Período:** ${formatarData(p.periodo.de)} a ${formatarData(p.periodo.ate)}.`,
    `**Emitido em:** ${instanteBrasilia(p.geradoEm)}, por ${d.emitidoPor}.`,
    `**Escopo:** ${escopo}.`,
    '**Fundamento:** Lei 14.133/2021, arts. 169 (linhas de defesa) e 171 (fiscalização pelos órgãos de controle).',
    '',
    '## 1. Integridade da trilha de auditoria',
    integridade,
    `Verificada em ${instanteBrasilia(p.integridade.verificadoEm)}.`,
    '',
    '## 2. Medidas de controle externo (art. 171)',
    `Medidas com resposta pendente: ${i.medidasAbertas}; com prazo de resposta vencido: ${i.respostasVencidas}; cautelares suspensivas em vigor: ${i.cautelaresSuspensivas}.`,
    ...(p.medidas.length === 0 ? ['- Nenhuma medida registrada.'] : p.medidas.map(linhaMedida)),
    '',
    '## 3. Matriz de achados preventivos',
    `Achados de risco: ${l2.achadosRisco}; de atenção: ${l2.achadosAtencao}. São sinais para conferência, não conclusão de irregularidade.`,
    ...(p.achados.length === 0
      ? ['- Nenhum achado no período.']
      : p.achados.slice(0, 40).map((a) => `- **${a.titulo}** — ${a.referencia.identificador}: ${a.descricao} (${a.fundamento})`)),
    ...(p.achados.length > 40 ? [`- E mais ${p.achados.length - 40} achado(s), listados no painel da 2ª linha.`] : []),
    '',
    '## 4. Primeira linha de defesa (gestão e fiscalização)',
    `- Pendências abertas: ${l1.pendenciasAbertas} (vencidas: ${l1.pendenciasVencidas}).`,
    `- Tarefas do plano de gestão em atraso: ${l1.tarefasAtrasadas}.`,
    `- Notas fiscais com atesto atrasado: ${l1.atestosAtrasados}.`,
    `- Processos da jornada com bloqueio: ${l1.processosBloqueados}.`,
    `- Contratos com revisão trimestral da matriz de riscos vencida ou a vencer: ${l1.revisoesRiscosPendentes}.`,
    '',
    '## 5. Segunda linha de defesa (jurídico e controle interno)',
    `- Pareceres jurídicos pendentes: ${l2.pareceresPendentes}.`,
    `- Exceções justificadas nos processos: ${l2.excecoesJustificadas}.`,
    `- Processos sancionatórios em andamento: ${l2.sancoesEmAndamento}.`,
    '',
    '## 6. Trilha de auditoria no período',
    `Eventos registrados: ${i.eventosNoPeriodo}. Acessos a dados pessoais registrados (LGPD, art. 37): ${i.acessosDadosPessoais}.`,
    ...p.eventosPorRecurso.map((r) => `- ${r.recurso}: ${r.total}`),
    '',
    '## Fontes',
    ...p.fontes.map((f) => `- ${f}`),
    '',
    '## Ressalvas',
    '- Documento gerado automaticamente pela Ágora a partir dos registros do sistema, sem uso de inteligência artificial.',
    '- Os achados indicam pontos a conferir; não constituem conclusão de auditoria nem imputação de responsabilidade. Requer revisão humana.',
    '- CPF, e-mail e telefone não constam deste relatório; o nome de fornecedor pessoa física aparece mascarado.',
  ];
  return linhas.join('\n');
}

export function gerarRelatorioPdf(d: DadosRelatorio): { pdf: Buffer; hash: string; nomeArquivo: string } {
  const pdf = gerarPdfTexto({
    titulo: 'Relatório executivo de auditoria — linhas de defesa',
    conteudo: conteudoRelatorio(d),
    rodape: `Relatório de auditoria — ${d.orgao.sigla} — ${formatarData(d.painel.periodo.de)} a ${formatarData(d.painel.periodo.ate)}`,
  });
  return {
    pdf,
    hash: createHash('sha256').update(pdf).digest('hex'),
    nomeArquivo: `relatorio-auditoria-${d.painel.periodo.de}-a-${d.painel.periodo.ate}.pdf`,
  };
}
