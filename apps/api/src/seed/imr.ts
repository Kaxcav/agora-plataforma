/**
 * Carga sintética do IMR e da conferência da nota fiscal (F7: RF-29 e RN-36). Escolhe, de forma determinística, um
 * contrato de serviço vigente e configura o instrumento de medição de resultado com dois indicadores: disponibilidade
 * (percentual, mensal, desde três competências atrás) e prazo de atendimento (valor medido, a partir da competência
 * corrente). Registra duas medições da disponibilidade — uma dentro da meta e outra com glosa —, as conferências das
 * duas notas correspondentes (a segunda com a divergência justificada) e deixa a nota da competência anterior prevista,
 * à espera da medição e da conferência. Cria também a conta de demonstração do fiscal técnico. Nomes, números e textos
 * são inventados; os valores do IMR são da carga, não do modelo de nenhum órgão. PRNG próprio, para não alterar as
 * outras etapas.
 */
import {
  adicionarDias,
  calcularAjustePagamento,
  calcularResultadoImr,
  conferirNotaFiscal,
  formatarMoeda,
  rotuloCompetencia,
  validarIndicadorImr,
  type IndicadorImr,
} from '@agora/dominio';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { competenciaDe, garantirTarefaMedicao, somarMesesCompetencia } from '../modulos/imr/servico.ts';
import { instanteEm, type ContextoSeed, type EventoSeed } from './contexto.ts';
import { gerarCpf } from './documentos.ts';
import { Prng } from './prng.ts';
import { USUARIOS_DEMONSTRACAO_ADICIONAIS } from './usuarios-demonstracao.ts';

/** Semente própria desta etapa (Lei 14.133, art. 117). */
const SEMENTE_IMR = 14_133_117;
/** Conta de demonstração criada por esta etapa. */
export const CONTA_FISCAL_TECNICO = 'fiscal.tecnico@agora.demo';
/** Fornecedores com restrição de regularidade na carga: ficam fora para o atesto da demonstração não ter ressalva. */
const FORNECEDORES_EXCLUIDOS = new Set(['amazonia', 'rota', 'mirante', 'aria', 'metropolitana', 'lumen', 'precisao']);
/** UASGs do escopo da conta "fiscal" (outros testes atestam a primeira nota prevista desse escopo). */
const UASGS_ESCOPO_FISCAL = 6;

const HORAS_PREVISTAS = 720;

function indicadoresDaCarga(inicioDisponibilidade: string, inicioAtendimento: string): (IndicadorImr & {
  descricaoCalculo: string;
  rotuloNumerador: string | null;
  rotuloDenominador: string | null;
  fonteMedicao: string;
})[] {
  return [
    {
      codigo: 'IND-01',
      nome: 'Disponibilidade do serviço',
      formaCalculo: 'percentual_razao',
      unidade: '%',
      sentidoMeta: 'maior_igual',
      meta: 97,
      periodicidade: 'mensal',
      inicioCompetencia: inicioDisponibilidade,
      faixas: [
        { limite: 97, percentualGlosa: 2.5, percentualPorUnidade: 0, encaminharSancionatorio: false },
        { limite: 93, percentualGlosa: 7, percentualPorUnidade: 0, encaminharSancionatorio: true },
      ],
      tetoPercentual: null,
      descricaoCalculo: 'Horas com o serviço disponível no mês divididas pelas horas previstas de funcionamento, vezes 100.',
      rotuloNumerador: 'Horas com o serviço disponível',
      rotuloDenominador: 'Horas previstas de funcionamento',
      fonteMedicao: 'Relatório mensal do sistema de monitoramento, conferido pela fiscalização técnica',
    },
    {
      codigo: 'IND-02',
      nome: 'Prazo de atendimento das ocorrências críticas',
      formaCalculo: 'valor_medido',
      unidade: 'horas',
      sentidoMeta: 'menor_igual',
      meta: 6,
      periodicidade: 'mensal',
      inicioCompetencia: inicioAtendimento,
      faixas: [{ limite: 6, percentualGlosa: 0, percentualPorUnidade: 0.4, encaminharSancionatorio: false }],
      tetoPercentual: 4,
      descricaoCalculo: 'Maior tempo, em horas, entre a abertura de uma ocorrência crítica e a solução registrada pela fiscalização no mês.',
      rotuloNumerador: null,
      rotuloDenominador: null,
      fonteMedicao: 'Registro de ocorrências da central de atendimento da contratada',
    },
  ];
}

interface PagamentoAlvo {
  id: string;
  competencia: string;
  nota_fiscal: string;
  valor: number;
  vencimento: string;
  situacao: 'previsto' | 'atestado' | 'liquidado' | 'pago';
  empenho_id: string | null;
}

export async function gerarImr(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados } = ctx;
  const prng = new Prng(SEMENTE_IMR);
  const eventos: EventoSeed[] = [];
  const carga = { carga: 'demonstracao' };

  // ───────── conta do fiscal técnico ─────────
  let fiscalId: string | null = null;
  for (const u of USUARIOS_DEMONSTRACAO_ADICIONAIS.filter((x) => x.email === CONTA_FISCAL_TECNICO)) {
    const id = prng.uuid();
    const uasgs = u.escopo === 'todas' ? 'todas' : dados.uasgs.slice(0, u.escopo);
    await tx.executar(
      `INSERT INTO usuarios (id, nome, email, cpf, senha_hash, ativo, unidade_interna_id, todas_uasgs, ultimo_acesso_em, busca_normalizada)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, NULL, $8)`,
      [id, u.nome, u.email, gerarCpf(prng), ctx.senhaHashDemonstracao, dados.unidades.get('COGEC') ?? null, uasgs === 'todas', normalizarBusca(u.nome, u.email)],
    );
    await tx.executar('INSERT INTO usuarios_perfis (usuario_id, perfil) VALUES ($1, $2)', [id, u.perfil]);
    if (uasgs !== 'todas') for (const codigo of uasgs) await tx.executar('INSERT INTO usuarios_uasgs (usuario_id, uasg) VALUES ($1, $2)', [id, codigo]);
    dados.usuarios.set(u.email, { id, email: u.email, nome: u.nome, perfis: [u.perfil], uasgs });
    fiscalId = id;
  }
  const gestorId = dados.usuarios.get('gestor@agora.demo')?.id ?? null;

  // ───────── contrato escolhido ─────────
  const c3 = somarMesesCompetencia(competenciaDe(hoje), -1);
  const c2 = somarMesesCompetencia(c3, -1);
  const c1 = somarMesesCompetencia(c3, -2);
  const c4 = competenciaDe(hoje);
  const foraDoEscopoFiscal = new Set(dados.uasgs.slice(0, UASGS_ESCOPO_FISCAL));
  const comMedidaDeControle = new Set(
    (await tx.consultar<{ contrato_id: string }>('SELECT contrato_id FROM medidas_controle WHERE contrato_id IS NOT NULL')).map((m) => m.contrato_id),
  );
  const fornecedorPorId = new Map(dados.fornecedores.map((f) => [f.id, f]));
  // Preferência: contrato de serviço (o IMR é típico da prestação de serviços) e, entre eles, o de vigência mais longa.
  const candidatos = dados.contratos
    .filter((c) => {
      const f = fornecedorPorId.get(c.fornecedorId);
      return (
        f?.tipo === 'PJ' &&
        !FORNECEDORES_EXCLUIDOS.has(f.chave) &&
        !foraDoEscopoFiscal.has(c.uasg) &&
        !comMedidaDeControle.has(c.id) &&
        c.vigenciaInicio <= `${c1}-01` &&
        c.vigenciaFim >= adicionarDias(hoje, 10) &&
        c.itens.length > 0
      );
    })
    .sort((a, b) => Number(b.servico) - Number(a.servico) || b.vigenciaFim.localeCompare(a.vigenciaFim) || a.numero.localeCompare(b.numero) || a.id.localeCompare(b.id));
  let contrato = null;
  let pagamentos: PagamentoAlvo[] = [];
  for (const candidato of candidatos) {
    const linhas = await tx.consultar<PagamentoAlvo>(
      'SELECT id, competencia, nota_fiscal, valor, vencimento, situacao, empenho_id FROM pagamentos WHERE contrato_id = $1 AND competencia = ANY($2::text[]) ORDER BY competencia',
      [candidato.id, [c1, c2, c3]],
    );
    if (linhas.length === 3) {
      contrato = candidato;
      pagamentos = linhas;
      break;
    }
  }
  if (!contrato) {
    dados.contagens.imrIndicadores = 0;
    return;
  }
  const [p1, p2, p3] = pagamentos;
  if (!p1 || !p2 || !p3) return;
  const responsavel = fiscalId ?? contrato.fiscalId;

  // ───────── indicadores do IMR ─────────
  const configurado = instanteEm(adicionarDias(`${c1}-01`, -3), prng, agora);
  const indicadores = indicadoresDaCarga(c1, c4);
  const ids: string[] = [];
  for (const i of indicadores) {
    const validado = validarIndicadorImr(i);
    const id = prng.uuid();
    ids.push(id);
    await tx.executar(
      `INSERT INTO imr_indicadores (id, contrato_id, codigo, nome, forma_calculo, descricao_calculo, rotulo_numerador, rotulo_denominador, unidade,
                                    sentido_meta, meta, periodicidade, inicio_competencia, fonte_medicao, itens_alcancados, faixas, teto_percentual,
                                    criado_por, criado_em, atualizado_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, '{}', $15::jsonb, $16, $17, $18, $18)`,
      [
        id, contrato.id, validado.codigo, validado.nome, validado.formaCalculo, i.descricaoCalculo, i.rotuloNumerador, i.rotuloDenominador, validado.unidade,
        validado.sentidoMeta, validado.meta, validado.periodicidade, validado.inicioCompetencia, i.fonteMedicao, JSON.stringify(validado.faixas),
        validado.tetoPercentual, gestorId, configurado.toISOString(),
      ],
    );
    eventos.push({
      ocorridoEm: configurado,
      usuarioId: gestorId,
      acao: 'contrato.imr.indicador.criar',
      recurso: 'contrato',
      recursoId: contrato.id,
      resumo: `Incluiu o indicador ${validado.codigo} (${validado.nome}) no IMR do contrato ${contrato.numero}`,
      dados: { ...carga, instrumentoTipo: 'contrato', instrumentoId: contrato.id, indicadorId: id, inicioCompetencia: validado.inicioCompetencia },
    });
  }
  const disponibilidade = indicadores[0];
  const idDisponibilidade = ids[0];
  if (!disponibilidade || !idDisponibilidade) return;

  // ───────── itens recebidos por competência (aproxima o valor previsto da parcela) ─────────
  const saldo = new Map(contrato.itens.map((i) => [i.id, i.quantidade]));
  const itensDoMes = (valorAlvo: number) => {
    const ordenados = [...contrato.itens].sort((a, b) => b.valorUnitario - a.valorUnitario || a.numero - b.numero);
    let restante = valorAlvo;
    const escolhidos: { itemContratoId: string; quantidadeRecebida: number; quantidadeFaturada: number; valorUnitarioFaturado: number }[] = [];
    for (const item of ordenados) {
      const disponivel = saldo.get(item.id) ?? 0;
      const quantidade = Math.min(disponivel, Math.floor(restante / Math.max(1, item.valorUnitario)));
      if (quantidade <= 0) continue;
      restante -= quantidade * item.valorUnitario;
      escolhidos.push({ itemContratoId: item.id, quantidadeRecebida: quantidade, quantidadeFaturada: quantidade, valorUnitarioFaturado: item.valorUnitario });
    }
    if (escolhidos.length === 0) {
      const menor = [...contrato.itens].sort((a, b) => a.valorUnitario - b.valorUnitario)[0];
      if (menor) escolhidos.push({ itemContratoId: menor.id, quantidadeRecebida: 1, quantidadeFaturada: 1, valorUnitarioFaturado: menor.valorUnitario });
    }
    for (const e of escolhidos) saldo.set(e.itemContratoId, (saldo.get(e.itemContratoId) ?? 0) - e.quantidadeRecebida);
    return escolhidos;
  };

  // ───────── medições e conferências das duas competências encerradas ─────────
  const planos = [
    { pagamento: p1, competencia: c1, numerador: HORAS_PREVISTAS - 2, referencia: 'Relatório de monitoramento nº 1' },
    { pagamento: p2, competencia: c2, numerador: HORAS_PREVISTAS - 36, referencia: 'Relatório de monitoramento nº 2' },
  ];
  for (const plano of planos) {
    const calculo = calcularResultadoImr(disponibilidade, { numerador: plano.numerador, denominador: HORAS_PREVISTAS });
    const ajuste = calcularAjustePagamento({ indicador: disponibilidade, resultado: calculo.resultado });
    const medidaEm = instanteEm(adicionarDias(`${somarMesesCompetencia(plano.competencia, 1)}-01`, prng.inteiro(2, 5)), prng, agora);
    const medicaoId = prng.uuid();
    await tx.executar(
      `INSERT INTO imr_medicoes (id, indicador_id, contrato_id, competencia, numerador, denominador, valor_informado, resultado, atingiu_meta, faixa,
                                 percentual_glosa, encaminhar_sancionatorio, memoria_calculo, evidencia, referencia_evidencia, observacao,
                                 registrada_por, registrada_em)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, NULL, $15, $16)`,
      [
        medicaoId, idDisponibilidade, contrato.id, plano.competencia, plano.numerador, HORAS_PREVISTAS, calculo.resultado, ajuste.atingiuMeta, ajuste.faixa,
        ajuste.percentualGlosa, ajuste.encaminharSancionatorio, JSON.stringify([...calculo.memoriaCalculo, ...ajuste.memoriaCalculo]),
        `Relatório mensal de disponibilidade da competência ${rotuloCompetencia(plano.competencia)}, conferido com os registros de indisponibilidade comunicados pela fiscalização.`,
        `${plano.referencia} (carga de demonstração)`, responsavel, medidaEm.toISOString(),
      ],
    );
    eventos.push({
      ocorridoEm: medidaEm,
      usuarioId: responsavel,
      acao: 'contrato.imr.medicao.registrar',
      recurso: 'contrato',
      recursoId: contrato.id,
      resumo: ajuste.atingiuMeta
        ? `Registrou a medição do indicador IND-01 da competência ${rotuloCompetencia(plano.competencia)}: ${calculo.resultado.toLocaleString('pt-BR')}%, meta atingida`
        : `Registrou a medição do indicador IND-01 da competência ${rotuloCompetencia(plano.competencia)}: ${calculo.resultado.toLocaleString('pt-BR')}%, glosa de ${ajuste.percentualGlosa.toLocaleString('pt-BR')}%`,
      dados: { ...carga, instrumentoTipo: 'contrato', instrumentoId: contrato.id, medicaoId, competencia: plano.competencia, percentualGlosa: ajuste.percentualGlosa },
    });

    // Conferência: a nota vem pelo valor cheio dos itens recebidos; com glosa, a divergência é justificada e a parcela é
    // liquidada pelo valor devido.
    const itens = itensDoMes(plano.pagamento.valor);
    const valorNota = itens.reduce((s, i) => s + i.valorUnitarioFaturado * i.quantidadeFaturada, 0);
    const resultado = conferirNotaFiscal({
      valorNota,
      itensContrato: contrato.itens.map((i) => ({ id: i.id, numero: i.numero, descricao: i.descricao, valorUnitario: i.valorUnitario, saldoQuantidade: i.quantidade })),
      itensNota: itens,
      glosasImr: ajuste.percentualGlosa > 0 ? [{ codigo: 'IND-01', nome: disponibilidade.nome, percentual: ajuste.percentualGlosa, itensAlcancados: [] }] : [],
      medicoesPendentes: [],
    });
    const conferidaEm = instanteEm(adicionarDias(`${somarMesesCompetencia(plano.competencia, 1)}-01`, prng.inteiro(5, 7)), prng, agora);
    const justificativa = resultado.conforme
      ? null
      : `A contratada emitiu a nota pelo valor cheio. A glosa de ${ajuste.percentualGlosa.toLocaleString('pt-BR')}% do IMR foi comunicada ao preposto e será descontada na liquidação (${formatarMoeda(resultado.glosaImr)}).`;
    await tx.executar(
      `INSERT INTO conferencias_nota_fiscal (id, pagamento_id, contrato_id, competencia, numero_nota, emitida_em, valor_nota, itens, valor_bruto, glosas,
                                             glosa_imr, valor_devido, diferenca, valor_a_liquidar, divergencias, memoria_calculo, situacao,
                                             justificativa, justificada_por, justificada_em, versao, conferida_por, conferida_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, $19, $20, 1, $21, $22)`,
      [
        prng.uuid(), plano.pagamento.id, contrato.id, plano.competencia, plano.pagamento.nota_fiscal, adicionarDias(`${somarMesesCompetencia(plano.competencia, 1)}-01`, 1),
        valorNota, JSON.stringify(itens), resultado.valorBruto, JSON.stringify(resultado.glosas), resultado.glosaImr, resultado.valorDevido, resultado.diferenca,
        resultado.valorALiquidar, JSON.stringify(resultado.divergencias), JSON.stringify(resultado.memoriaCalculo), resultado.conforme ? 'conforme' : 'justificada',
        justificativa, justificativa ? responsavel : null, justificativa ? conferidaEm.toISOString() : null, responsavel, conferidaEm.toISOString(),
      ],
    );
    eventos.push({
      ocorridoEm: conferidaEm,
      usuarioId: responsavel,
      acao: 'pagamento.conferencia.registrar',
      recurso: 'pagamento',
      recursoId: plano.pagamento.id,
      resumo: `Registrou a conferência da nota fiscal ${plano.pagamento.nota_fiscal} do contrato ${contrato.numero}: nota de ${formatarMoeda(valorNota)} × devido de ${formatarMoeda(resultado.valorDevido)} (${resultado.conforme ? 'conforme' : 'justificada'})`,
      dados: { ...carga, instrumentoTipo: 'contrato', instrumentoId: contrato.id, competencia: plano.competencia, valorDevido: resultado.valorDevido, glosaImr: resultado.glosaImr },
    });

    // A parcela registrada passa a valer o valor a liquidar; o empenho acompanha a diferença do que já foi liquidado ou pago.
    const delta = resultado.valorALiquidar - plano.pagamento.valor;
    if (delta !== 0) {
      await tx.executar('UPDATE pagamentos SET valor = $2 WHERE id = $1', [plano.pagamento.id, resultado.valorALiquidar]);
      if (plano.pagamento.empenho_id && (plano.pagamento.situacao === 'pago' || plano.pagamento.situacao === 'liquidado')) {
        await tx.executar(
          `UPDATE empenhos SET valor_liquidado = GREATEST(0, valor_liquidado + $2),
                               valor_pago = CASE WHEN $3 THEN GREATEST(0, valor_pago + $2) ELSE valor_pago END
            WHERE id = $1`,
          [plano.pagamento.empenho_id, delta, plano.pagamento.situacao === 'pago'],
        );
      }
    }
  }

  // ───────── competência anterior: nota prevista, à espera da medição e da conferência ─────────
  if (p3.situacao === 'pago' || p3.situacao === 'liquidado') {
    if (p3.empenho_id) {
      await tx.executar(
        `UPDATE empenhos SET valor_liquidado = GREATEST(0, valor_liquidado - $2),
                             valor_pago = CASE WHEN $3 THEN GREATEST(0, valor_pago - $2) ELSE valor_pago END
          WHERE id = $1`,
        [p3.empenho_id, p3.valor, p3.situacao === 'pago'],
      );
    }
  }
  const vencimento = p3.vencimento < adicionarDias(hoje, 10) ? adicionarDias(hoje, 10) : p3.vencimento;
  await tx.executar("UPDATE pagamentos SET situacao = 'previsto', atestado_por = NULL, atestado_em = NULL, pago_em = NULL, vencimento = $2 WHERE id = $1", [p3.id, vencimento]);
  for (let n = ctx.eventos.length - 1; n >= 0; n--) {
    if (ctx.eventos[n]?.recursoId === p3.id && ctx.eventos[n]?.acao === 'pagamento.atestar') ctx.eventos.splice(n, 1);
  }
  await garantirTarefaMedicao(tx, { id: contrato.id, uasg: contrato.uasg, fiscal_id: responsavel }, c3);

  ctx.eventos.push(...eventos);
  dados.contagens.imrIndicadores = indicadores.length;
  dados.contagens.imrMedicoes = planos.length;
  dados.contagens.conferenciasNotaFiscal = planos.length;
}
