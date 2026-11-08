import { adicionarDias, diasEntre } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { instanteEm, type ContextoSeed, type ContratoSeed, type PagamentoSeed } from './contexto.ts';

function mesDe(data: string): string {
  return data.slice(0, 7);
}

function somarMeses(mes: string, n: number): string {
  const [ano, m] = mes.split('-').map(Number);
  const total = (ano ?? 0) * 12 + ((m ?? 1) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function menor(a: string, b: string): string {
  return a < b ? a : b;
}

interface EmpenhoGerado {
  id: string;
  numero: string;
  uasg: string;
  ano: number;
  emissao: string;
  natureza: string;
  credorDocumento: string;
  credorNome: string;
  fornecedorId: string | null;
  contratoId: string | null;
  contratoNumero: string | null;
  empenhado: number;
  liquidado: number;
  pago: number;
}

export async function gerarExecucao(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, dados, hoje, agora, eventos } = ctx;
  const anoAtual = Number(hoje.slice(0, 4));
  const fornecedorPorId = new Map(dados.fornecedores.map((f) => [f.id, f]));

  // ───────── Pagamentos: 8 competências por contrato (480) ─────────
  const pagamentos: (PagamentoSeed & { atestadoPor: string | null; atestadoEm: string | null; fonteRecurso: string; busca: string })[] = [];
  for (const c of dados.contratos) {
    const mesInicio = mesDe(c.vigenciaInicio);
    let fimSerie = c.vigenciaFim < hoje ? mesDe(c.vigenciaFim) : menor(mesDe(c.vigenciaFim), somarMeses(mesDe(hoje), 2));
    let inicioSerie = somarMeses(fimSerie, -7);
    if (inicioSerie < mesInicio) {
      inicioSerie = mesInicio;
      fimSerie = somarMeses(inicioSerie, 7);
    }
    const mesesVigencia = Math.max(1, Math.round(diasEntre(c.vigenciaInicio, c.vigenciaFim) / 30.4));
    const parcela = c.acelerado
      ? Math.floor(c.valorGlobal / 8)
      : Math.floor((c.valorGlobal / Math.max(mesesVigencia, 8)) * (prng.inteiro(85, 100) / 100));
    const fornecedor = fornecedorPorId.get(c.fornecedorId);
    for (let k = 0; k < 8; k++) {
      const competencia = somarMeses(inicioSerie, k);
      const vencimento = `${somarMeses(competencia, 1)}-10`;
      let situacao: PagamentoSeed['situacao'];
      if (vencimento < adicionarDias(hoje, -20)) situacao = prng.chance(0.96) ? 'pago' : 'liquidado';
      else if (vencimento < hoje) situacao = prng.escolher(['pago', 'liquidado', 'atestado'] as const);
      else if (vencimento <= adicionarDias(hoje, 25)) situacao = prng.escolher(['atestado', 'previsto', 'previsto'] as const);
      else situacao = 'previsto';
      const valor = c.servico ? Math.floor((parcela * prng.inteiro(95, 100)) / 100) : parcela;
      const notaFiscal = `NF ${prng.inteiro(1000, 99999)}`;
      const atestado = situacao === 'previsto' ? null : instanteEm(menor(adicionarDias(vencimento, -12), hoje), prng, agora).toISOString();
      pagamentos.push({
        id: prng.uuid(),
        contratoId: c.id,
        notaFiscal,
        competencia,
        valor,
        vencimento,
        pagoEm: situacao === 'pago' ? menor(adicionarDias(vencimento, prng.inteiro(-6, 4)), adicionarDias(hoje, -1)) : null,
        situacao,
        atestadoPor: situacao === 'previsto' ? null : c.fiscalId,
        atestadoEm: atestado,
        fonteRecurso: c.fonteRecurso,
        busca: normalizarBusca(notaFiscal, c.numero, competencia, fornecedor?.tipo === 'PJ' ? fornecedor.nome : ''),
      });
    }
  }

  // ───────── Empenhos: ≈ 205 com contrato e 15 sem contrato (220) ─────────
  const sequencias = new Map<string, number>();
  const numeroEmpenho = (uasg: string, ano: number) => {
    const chave = `${uasg}:${ano}`;
    const proximo = (sequencias.get(chave) ?? prng.inteiro(100, 400)) + prng.inteiro(1, 9);
    sequencias.set(chave, proximo);
    return `${ano}NE${String(proximo).padStart(6, '0')}`;
  };
  const quantidades = new Map(dados.contratos.map((c) => [c.id, 3]));
  for (const c of prng.embaralhar(dados.contratos).slice(0, 25)) quantidades.set(c.id, 4);

  const empenhos: EmpenhoGerado[] = [];
  const empenhosItens: [string, string, number, number][] = [];
  const primeiroEmpenho = new Map<string, string>();
  const elegiveisSemItem: string[] = [];

  for (const c of dados.contratos) {
    const fornecedor = fornecedorPorId.get(c.fornecedorId);
    if (!fornecedor) continue;
    const doContrato = pagamentos.filter((p) => p.contratoId === c.id);
    let restantePago = doContrato.filter((p) => p.situacao === 'pago').reduce((s, p) => s + p.valor, 0);
    let restanteLiquidado = doContrato.filter((p) => p.situacao === 'pago' || p.situacao === 'liquidado').reduce((s, p) => s + p.valor, 0);
    const fator = c.vigenciaFim < hoje ? prng.inteiro(92, 100) / 100 : prng.inteiro(55, 90) / 100;
    const totalEmpenhado = Math.min(c.valorGlobal, Math.max(restanteLiquidado, Math.round(c.valorGlobal * fator)));
    const k = quantidades.get(c.id) ?? 3;
    const pesos = Array.from({ length: k }, () => prng.inteiro(1, 5));
    const somaPesos = pesos.reduce((s, p) => s + p, 0);
    const ultimaEmissao = menor(hoje, c.vigenciaFim);
    const datas = Array.from({ length: k }, (_, i) =>
      i === 0 ? menor(adicionarDias(c.vigenciaInicio, prng.inteiro(0, 10)), ultimaEmissao) : adicionarDias(c.vigenciaInicio, prng.inteiro(0, Math.max(0, diasEntre(c.vigenciaInicio, ultimaEmissao)))),
    ).sort();
    let acumulado = 0;
    datas.forEach((emissao, i) => {
      const valor = i === k - 1 ? totalEmpenhado - acumulado : Math.floor((totalEmpenhado * (pesos[i] ?? 1)) / somaPesos);
      acumulado += valor;
      const pago = Math.min(restantePago, valor);
      restantePago -= pago;
      const liquidado = Math.max(pago, Math.min(restanteLiquidado, valor));
      restanteLiquidado -= liquidado;
      const ano = Number(emissao.slice(0, 4));
      const id = prng.uuid();
      if (i === 0) primeiroEmpenho.set(c.id, id);
      empenhos.push({
        id,
        numero: numeroEmpenho(c.uasg, ano),
        uasg: c.uasg,
        ano,
        emissao,
        natureza: c.natureza,
        credorDocumento: fornecedor.documento,
        credorNome: fornecedor.nome,
        fornecedorId: fornecedor.id,
        contratoId: c.id,
        contratoNumero: c.numero,
        empenhado: valor,
        liquidado,
        pago,
      });
      elegiveisSemItem.push(id);
      const participacao = totalEmpenhado > 0 ? valor / totalEmpenhado : 0;
      for (const item of c.itens) {
        const quantidade = Math.floor(item.quantidade * participacao);
        if (quantidade > 0) empenhosItens.push([id, item.id, quantidade, quantidade * item.valorUnitario]);
      }
    });
  }
  // Empenhos com contrato, mas ainda sem item associado (aba "Empenhos sem item" de Vínculos)
  const semItem = new Set(prng.embaralhar(elegiveisSemItem).slice(0, 12));
  const itensFinais = empenhosItens.filter(([empenhoId]) => !semItem.has(empenhoId));

  // Empenhos sem contrato: parte com contrato compatível (sugestão de vínculo), parte sem contrato
  for (let i = 0; i < 15; i++) {
    const comSugestao = i < 8;
    const base = comSugestao ? prng.escolher(dados.contratos.filter((c) => c.vigenciaInicio < adicionarDias(hoje, -30))) : null;
    const fornecedor = base ? fornecedorPorId.get(base.fornecedorId) : prng.escolher(dados.fornecedores);
    if (!fornecedor) continue;
    const uasg = base ? base.uasg : prng.escolher(dados.uasgs);
    const emissao = base
      ? adicionarDias(base.vigenciaInicio, prng.inteiro(1, Math.max(1, diasEntre(base.vigenciaInicio, menor(hoje, base.vigenciaFim)))))
      : adicionarDias(hoje, -prng.inteiro(10, 300));
    const valor = prng.inteiro(500_000, 8_000_000);
    const liquidado = Math.round((valor * prng.inteiro(0, 100)) / 100);
    const ano = Number(emissao.slice(0, 4));
    empenhos.push({
      id: prng.uuid(),
      numero: numeroEmpenho(uasg, ano),
      uasg,
      ano,
      emissao,
      natureza: base ? base.natureza : fornecedor.tipo === 'PF' ? '339036' : '339039',
      credorDocumento: fornecedor.documento,
      credorNome: fornecedor.nome,
      fornecedorId: fornecedor.id,
      contratoId: null,
      contratoNumero: null,
      empenhado: valor,
      liquidado,
      pago: Math.round((liquidado * prng.inteiro(50, 100)) / 100),
    });
  }

  await inserirEmLote(
    tx,
    'empenhos',
    ['id', 'numero', 'uasg', 'ano', 'emissao_em', 'natureza_despesa', 'credor_documento', 'credor_nome', 'fornecedor_id', 'contrato_id', 'valor_empenhado', 'valor_liquidado', 'valor_pago', 'restos_a_pagar', 'fonte_dados', 'busca_normalizada'],
    empenhos.map((e) => [
      e.id, e.numero, e.uasg, e.ano, e.emissao, e.natureza, e.credorDocumento, e.credorNome, e.fornecedorId, e.contratoId,
      e.empenhado, e.liquidado, e.pago, e.ano < anoAtual && e.empenhado > e.pago, 'SIAFI',
      normalizarBusca(e.numero, e.natureza, e.contratoNumero, e.credorDocumento.length === 14 ? `${e.credorNome} ${e.credorDocumento}` : ''),
    ]),
  );
  await inserirEmLote(tx, 'empenhos_itens', ['empenho_id', 'item_contrato_id', 'quantidade', 'valor'], itensFinais);
  await inserirEmLote(
    tx,
    'pagamentos',
    ['id', 'contrato_id', 'empenho_id', 'nota_fiscal', 'competencia', 'valor', 'vencimento', 'pago_em', 'situacao', 'atestado_por', 'atestado_em', 'fonte_recurso', 'busca_normalizada'],
    pagamentos.map((p) => [
      p.id, p.contratoId, primeiroEmpenho.get(p.contratoId) ?? null, p.notaFiscal, p.competencia, p.valor, p.vencimento, p.pagoEm,
      p.situacao, p.atestadoPor, p.atestadoEm, p.fonteRecurso, p.busca,
    ]),
  );

  const limiteHistorico = new Date(agora.getTime() - 60 * 86_400_000).toISOString();
  for (const p of pagamentos) {
    if (p.atestadoEm !== null && p.atestadoEm >= limiteHistorico && p.atestadoPor !== null) {
      eventos.push({
        ocorridoEm: new Date(p.atestadoEm),
        usuarioId: p.atestadoPor,
        acao: 'pagamento.atestar',
        recurso: 'pagamento',
        recursoId: p.id,
        resumo: `Atestou a nota fiscal ${p.notaFiscal}`,
        dados: { carga: 'demonstracao', instrumentoTipo: 'contrato', instrumentoId: p.contratoId },
      });
    }
  }
  dados.contagens.empenhosSemContrato = empenhos.filter((e) => e.contratoId === null).length;
  dados.pagamentos = pagamentos;
  dados.contagens.empenhos = empenhos.length;
  dados.contagens.pagamentos = pagamentos.length;
  dados.contagens.contratosComQueimaAcelerada = dados.contratos.filter((c: ContratoSeed) => c.acelerado).length;
}
