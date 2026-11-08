/**
 * Ata da sessão de disputa (RF-22): rascunho em Markdown gerado a partir dos registros da sessão — parâmetros e
 * fundamentos, participantes, cronologia, lances, classificação, desempate, negociação e sinais para análise.
 * O resultado da negociação integra a ata (Lei 14.133/2021, art. 61, § 2º; IN SEGES/ME 73/2022, art. 30, § 3º).
 * Texto determinístico, com fontes, premissas, data e a marcação "requer revisão humana".
 */
import { formatarNumero } from '../interno.ts';
import { formatarMoeda } from '../moeda.ts';
import {
  CRITERIOS_JULGAMENTO_DISPUTA,
  FUNDAMENTOS_PARAMETROS_DISPUTA,
  MODOS_DISPUTA,
  formatarOferta,
  type ClassificacaoSessaoDisputa,
  type DefinicaoSessaoDisputa,
  type EstadoSessaoDisputa,
} from './disputa.ts';
import { AVISO_SINAL_DISPUTA, type SinalPadraoLances } from './padroes-lances.ts';

export interface DadosAtaSessaoDisputa {
  uso: 'simulacao' | 'acompanhamento';
  processo: { numeroSei: string; titulo: string; uasg: string };
  conduzidaPor: string;
  emitidaEm: string;
  idCompra: string | null;
  /** Sinais de sócio em comum entre licitantes (RIA-06), já com nomes de sócios mascarados. */
  vinculos: readonly string[];
  /** Origem dos dados oficiais, quando a sessão acompanha o Compras.gov.br. */
  proveniencia: string | null;
}

export interface AtaSessaoDisputa {
  titulo: string;
  emitidaEm: string;
  texto: string;
  fontes: string[];
  premissas: string[];
  aviso: string;
}

export const AVISO_ATA_DISPUTA = 'Rascunho gerado automaticamente a partir dos registros da sessão: requer revisão humana antes de ser juntado ao processo.';

const HORA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function hora(instante: string | null): string {
  return instante === null ? '—' : HORA.format(new Date(instante)).replace(',', '');
}

function celula(texto: string): string {
  return texto.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function duracao(segundos: number): string {
  if (segundos % 60 === 0) return `${segundos / 60} min`;
  return segundos > 60 ? `${Math.floor(segundos / 60)} min ${segundos % 60} s` : `${segundos} s`;
}

const ROTULOS_FASE: Record<string, string> = {
  lances_abertos: 'aberta',
  fechamento_iminente: 'fechamento iminente',
  lance_final_fechado: 'lance final e fechado',
};

const ROTULOS_ORIGEM: Record<string, string> = {
  proposta: 'proposta',
  lance: 'último lance',
  lance_final: 'lance final e fechado',
  negociacao: 'negociação',
};

/**
 * Redige a ata da sessão (rascunho para revisão humana): identificação, parâmetros com fundamentos, participantes,
 * cronologia, lances, classificação e memória do julgamento, negociação (art. 61, § 2º) e sinais RIA-09 e RIA-06.
 */
export function redigirAtaSessaoDisputa(
  definicao: DefinicaoSessaoDisputa,
  estado: EstadoSessaoDisputa,
  classificacao: ClassificacaoSessaoDisputa,
  sinais: readonly SinalPadraoLances[],
  dados: DadosAtaSessaoDisputa,
): AtaSessaoDisputa {
  const { criterio, modo, parametros } = definicao;
  const nome = (id: string) => definicao.participantes.find((p) => p.id === id)?.nome ?? id;
  const criterioDef = CRITERIOS_JULGAMENTO_DISPUTA.find((c) => c.criterio === criterio);
  const modoDef = MODOS_DISPUTA.find((m) => m.modo === modo);
  const titulo = `Ata da sessão de disputa — ${dados.uso === 'simulacao' ? 'simulação para treino' : 'acompanhamento da sessão oficial'}`;
  const linhas: string[] = [`# ${titulo}`, ''];

  linhas.push(
    `**Processo:** ${dados.processo.numeroSei} — ${dados.processo.titulo}`,
    '',
    `**UASG:** ${dados.processo.uasg} · **Conduzida por:** ${dados.conduzidaPor}`,
    '',
    `**Critério de julgamento:** ${criterioDef?.rotulo ?? criterio} (${criterioDef?.fundamento ?? 'Lei 14.133/2021, art. 33'}) · **Modo de disputa:** ${modoDef?.rotulo ?? modo} (${modoDef?.fundamento ?? 'Lei 14.133/2021, art. 56'})`,
    '',
  );
  if (dados.idCompra) linhas.push(`**Compra no Compras.gov.br:** ${dados.idCompra}`, '');
  if (dados.proveniencia) linhas.push(`**Dados oficiais:** ${dados.proveniencia}`, '');

  linhas.push('## 1. Parâmetros adotados', '');
  const parametrosTexto: [string, string, keyof typeof FUNDAMENTOS_PARAMETROS_DISPUTA][] = modo === 'fechado' ? [] : [
    ['Duração da etapa aberta', duracao(parametros.duracaoEtapaAbertaSegundos), 'duracaoEtapaAbertaSegundos'],
    ['Prorrogação automática', `${duracao(parametros.prorrogacaoSegundos)} por lance nos ${duracao(parametros.janelaProrrogacaoSegundos)} finais`, 'prorrogacaoSegundos'],
    ['Faixa para a etapa seguinte', `${formatarNumero(parametros.faixaSelecaoPercentual)}%, no mínimo ${parametros.minimoSelecionados} ofertas`, 'faixaSelecaoPercentual'],
    ['Diferença para reinício da disputa aberta', `${formatarNumero(parametros.diferencaReinicioPercentual)}%`, 'diferencaReinicioPercentual'],
    [
      'Intervalo mínimo entre lances',
      parametros.intervaloMinimo === null
        ? 'não fixado no edital'
        : parametros.intervaloMinimo.tipo === 'percentual'
          ? `${formatarNumero(parametros.intervaloMinimo.valor)}% da oferta de referência`
          : criterio === 'maior_desconto'
            ? `${formatarNumero(parametros.intervaloMinimo.valor)} ponto(s) percentual(is)`
            : formatarMoeda(parametros.intervaloMinimo.valor),
      'intervaloMinimo',
    ],
  ];
  if (modo === 'aberto_fechado') {
    parametrosTexto.push(
      ['Fechamento iminente', `encerramento sorteado em até ${duracao(parametros.fechamentoIminenteMaximoSegundos)}`, 'fechamentoIminenteMaximoSegundos'],
      ['Lance final e fechado', `até ${duracao(parametros.prazoLanceFechadoSegundos)}`, 'prazoLanceFechadoSegundos'],
    );
  }
  if (parametros.pesoTecnicoPercentual !== null) {
    parametrosTexto.push(['Peso da proposta técnica', `${formatarNumero(parametros.pesoTecnicoPercentual)}%`, 'pesoTecnicoPercentual']);
  }
  for (const [rotulo, valor, chave] of parametrosTexto) linhas.push(`- **${rotulo}:** ${valor} — ${FUNDAMENTOS_PARAMETROS_DISPUTA[chave]}.`);
  linhas.push('');

  linhas.push('## 2. Participantes', '', '| Nº | Licitante | Proposta inicial | ME/EPP |', '| ---: | --- | ---: | :---: |');
  definicao.participantes.forEach((p, i) => {
    linhas.push(`| ${i + 1} | ${celula(p.nome)} | ${formatarOferta(criterio, p.propostaInicial)} | ${p.meEpp ? 'Sim' : 'Não'} |`);
  });
  linhas.push('');

  linhas.push('## 3. Cronologia', '');
  if (estado.marcos.length === 0) linhas.push('Sessão ainda não aberta.');
  for (const m of estado.marcos) linhas.push(`- ${hora(m.instante)} — ${m.descricao} (${m.fundamento}).`);
  if (estado.prorrogacoes > 0) linhas.push(`- Prorrogações automáticas: ${estado.prorrogacoes}.`);
  linhas.push('');

  linhas.push(`## 4. Lances (${estado.lances.length})`, '');
  if (estado.lances.length === 0) {
    linhas.push('Nenhum lance registrado.');
  } else {
    linhas.push('| Nº | Horário | Licitante | Oferta | Etapa | Tipo |', '| ---: | --- | --- | ---: | --- | --- |');
    for (const l of estado.lances) {
      linhas.push(
        `| ${l.sequencia} | ${hora(l.instante)} | ${celula(nome(l.licitanteId))} | ${formatarOferta(criterio, l.valor)} | ${ROTULOS_FASE[l.fase] ?? l.fase}${l.rodada > 0 ? ` (reinício ${l.rodada})` : ''} | ${l.intermediario ? 'intermediário' : 'cobriu a melhor oferta'} |`,
      );
    }
  }
  linhas.push('');

  linhas.push('## 5. Classificação', '');
  if (classificacao.classificacao.length === 0) {
    linhas.push('Sem ofertas classificadas.');
  } else {
    const tp = criterio === 'tecnica_e_preco';
    linhas.push(
      tp ? '| Posição | Licitante | Preço | Nota técnica | Nota de preço | Nota final |' : '| Posição | Licitante | Oferta | Valor considerado | Origem |',
      tp ? '| ---: | --- | ---: | ---: | ---: | ---: |' : '| ---: | --- | ---: | ---: | --- |',
    );
    for (const c of classificacao.classificacao) {
      linhas.push(
        tp
          ? `| ${c.posicao}º | ${celula(c.nome)} | ${formatarMoeda(c.valorConsiderado)} | ${formatarNumero(c.notaTecnica ?? 0)} | ${formatarNumero(c.notaPreco ?? 0)} | ${formatarNumero(c.notaFinal ?? 0)} |`
          : `| ${c.posicao}º | ${celula(c.nome)} | ${formatarOferta(criterio, c.valorOfertado)} | ${formatarMoeda(c.valorConsiderado)} | ${ROTULOS_ORIGEM[c.origem] ?? c.origem} |`,
      );
    }
    linhas.push('');
    for (const m of classificacao.memoria) linhas.push(`- ${m}`);
    for (const p of classificacao.passos) linhas.push(`- Desempate — ${p.criterio} (${p.fundamento}): ${p.resultado}`);
    if (classificacao.sorteioNecessario) linhas.push('- O empate persiste após os critérios do art. 60: sorteio em ato público (IN SEGES/ME 73/2022, art. 28, § 2º).');
  }
  linhas.push('');

  linhas.push('## 6. Negociação', '');
  if (estado.negociacoes.length === 0) {
    linhas.push('Não houve negociação registrada (Lei 14.133/2021, art. 61).');
  } else {
    for (const n of estado.negociacoes) {
      linhas.push(`- ${hora(n.instante)} — ${nome(n.licitanteId)}: ${formatarOferta(criterio, n.valorAnterior)} → ${formatarOferta(criterio, n.valor)} (Lei 14.133/2021, art. 61, § 2º).`);
    }
  }
  linhas.push('');

  linhas.push('## 7. Sinais para análise (RIA-09 e RIA-06)', '');
  if (sinais.length === 0 && dados.vinculos.length === 0) linhas.push('Nenhum sinal de padrão de lances ou de vínculo societário.');
  for (const s of sinais) {
    linhas.push(`- **${s.titulo}**${s.reforcadoPorVinculo ? ' (reforçado por vínculo societário)' : ''}: ${s.evidencias.join(' ')} Fundamento: ${s.fundamento}.`);
  }
  for (const v of dados.vinculos) linhas.push(`- **Sócio em comum (RIA-06):** ${v}`);
  if (sinais.length > 0 || dados.vinculos.length > 0) linhas.push('', `> ${AVISO_SINAL_DISPUTA}`);
  linhas.push('');

  linhas.push('## 8. Observações', '');
  if (dados.uso === 'simulacao') {
    linhas.push('- Sessão simulada com licitantes sintéticos, para treino e prova de conceito: não substitui a sessão pública oficial no Compras.gov.br nem produz efeitos jurídicos.');
  } else {
    linhas.push('- A sessão pública oficial ocorre no Compras.gov.br; esta ata registra o acompanhamento feito na Ágora e não substitui a ata emitida pelo sistema oficial.');
  }
  linhas.push(`- ${AVISO_ATA_DISPUTA}`, `- Emitida em ${hora(dados.emitidaEm)} (horário de Brasília).`);

  const fontes = [
    'Lei 14.133/2021, arts. 33, 34, 36, 56, 57, 59, 60 e 61',
    'IN SEGES/ME 73/2022, arts. 5º e 19 a 30',
    'Registros da sessão na Ágora (eventos, lances e trilha de auditoria)',
  ];
  if (dados.uso === 'acompanhamento') fontes.push('Dados abertos do Compras.gov.br (consulta feita pelo servidor da Ágora)');
  const premissas = [
    'Horários de Brasília (America/Sao_Paulo).',
    criterio === 'maior_desconto' ? 'Desconto aplicado sobre o preço global de referência do edital (art. 34, § 2º).' : 'Valores em reais.',
    'Os sinais de padrão de lances são indícios para análise e não decidem habilitação, desclassificação ou sanção.',
  ];
  linhas.push('', '---', '', `**Fontes:** ${fontes.join('; ')}.`, '', `**Premissas:** ${premissas.join(' ')}`, '', `**${AVISO_ATA_DISPUTA}**`);
  return { titulo, emitidaEm: dados.emitidaEm, texto: linhas.join('\n'), fontes, premissas, aviso: AVISO_ATA_DISPUTA };
}
