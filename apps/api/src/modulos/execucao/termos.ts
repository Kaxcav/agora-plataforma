/**
 * Termos de recebimento provisório e definitivo em PDF (art. 140), gerados no servidor pelo gerador de texto da
 * Ágora. O conteúdo depende só do que foi gravado no termo (sem "agora"): o mesmo termo gera sempre o mesmo arquivo,
 * e o SHA-256 guardado no registro confere com o PDF baixado depois. A assinatura formal é feita no processo SEI.
 */
import { createHash } from 'node:crypto';
import { formatarData, formatarMoeda, ROTULOS_PAPEL_FISCALIZACAO } from '@agora/dominio';
import type { ResultadoTermoRecebimento, TermoRecebimento } from '@agora/contratos';
import { gerarPdfTexto } from '../../compartilhado/pdf-texto.ts';
import { identificadorInstrumento } from '../../compartilhado/texto.ts';
import { fornecedorDoContrato, type ContratoExecucao } from './repositorio.ts';

const ROTULO_RESULTADO: Record<ResultadoTermoRecebimento, string> = {
  aceito: 'Objeto recebido',
  com_ressalva: 'Objeto recebido com ressalva — correção exigida',
  rejeitado: 'Objeto rejeitado — substituição exigida',
};

export interface DadosTermo {
  orgao: { nome: string; sigla: string; unidade: string };
  contrato: ContratoExecucao;
  recebimento: { numero: number; descricao: string; valor: number; entregueEm: string; notaFiscal: string | null };
  termo: Omit<TermoRecebimento, 'hashPdf' | 'registradoEm' | 'id'>;
}

export function tituloTermo(tipo: TermoRecebimento['tipo']): string {
  return tipo === 'provisorio' ? 'Termo de recebimento provisório' : 'Termo de recebimento definitivo';
}

/** Conteúdo do termo em texto simples (o Markdown que o gerador de PDF entende). */
export function conteudoTermo(d: DadosTermo): string {
  const t = d.termo;
  const c = d.contrato;
  const fundamento =
    t.tipo === 'provisorio'
      ? 'Lei 14.133/2021, art. 140, I, "a" (obras e serviços, termo detalhado), e II, "a" (compras, recebimento sumário).'
      : 'Lei 14.133/2021, art. 140, I, "b", e II, "b" (termo detalhado que comprova o atendimento das exigências contratuais).';
  const linhas = [
    `# ${tituloTermo(t.tipo)}`,
    `${d.orgao.nome} (${d.orgao.sigla}) — ${d.orgao.unidade}`,
    '',
    `**Contrato:** ${identificadorInstrumento('contrato', c.numero)} — UASG ${c.uasg} — processo SEI ${c.processo_sei}.`,
    `**Objeto:** ${c.objeto}`,
    `**Contratada:** ${fornecedorDoContrato(c)}.`,
    '',
    `## Entrega nº ${d.recebimento.numero}`,
    `- Descrição: ${d.recebimento.descricao}`,
    `- Valor da parcela: ${formatarMoeda(d.recebimento.valor)}`,
    `- Entregue pela contratada em ${formatarData(d.recebimento.entregueEm)}`,
    `- Nota fiscal: ${d.recebimento.notaFiscal ?? 'não informada'}`,
    '',
    '## Resultado',
    `**${ROTULO_RESULTADO[t.resultado]}** em ${formatarData(t.data)}.`,
    ...(t.observacoes ? [`Observações: ${t.observacoes}`] : []),
    ...(t.prazoCorrecao
      ? [
          `Prazo para a contratada ${t.resultado === 'rejeitado' ? 'substituir o objeto' : 'corrigir os pontos apontados'}, às suas custas: ${formatarData(t.prazoCorrecao)} (art. 140, § 1º, e art. 119).`,
        ]
      : []),
    ...(t.foraDoPrazo ? ['Termo lavrado depois do prazo previsto no contrato; o motivo deve constar do processo.'] : []),
    ...(t.tipo === 'definitivo' && t.resultado === 'aceito'
      ? ['O recebimento definitivo libera a liquidação da despesa (Lei 4.320/1964, art. 63) e não exclui a responsabilidade civil pela solidez e segurança do objeto nem a ético-profissional pela perfeita execução (art. 140, § 2º).']
      : []),
    '',
    '## Responsável',
    `${t.responsavel.nome} — ${ROTULOS_PAPEL_FISCALIZACAO[t.papelResponsavel]}.`,
    '',
    '## Fundamento',
    fundamento,
    '',
    '## Ressalvas',
    '- Documento gerado pela Ágora a partir do registro do termo, sem uso de inteligência artificial.',
    '- A assinatura formal do termo é feita no processo SEI do contrato.',
  ];
  return linhas.join('\n');
}

export function gerarTermoPdf(d: DadosTermo): { pdf: Buffer; hash: string; nomeArquivo: string } {
  const titulo = tituloTermo(d.termo.tipo);
  const pdf = gerarPdfTexto({
    titulo,
    conteudo: conteudoTermo(d),
    rodape: `${titulo} — ${identificadorInstrumento('contrato', d.contrato.numero)} — entrega nº ${d.recebimento.numero}`,
  });
  const sufixo = d.termo.tipo === 'provisorio' ? 'provisorio' : 'definitivo';
  return {
    pdf,
    hash: createHash('sha256').update(pdf).digest('hex'),
    nomeArquivo: `termo-recebimento-${sufixo}-contrato-${d.contrato.numero.replace(/[^0-9a-z]+/gi, '-')}-entrega-${d.recebimento.numero}.pdf`,
  };
}
