import { adicionarDias, diasEntre } from '@agora/dominio';
import { inserirEmLote } from '../banco/lote.ts';
import { adicionarMeses } from '../compartilhado/instrumentos.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { OBJETOS_ATA, OBJETOS_CONTRATO, type ItemModelo } from './catalogo.ts';
import {
  centavosEntre,
  instanteEm,
  type AtaSeed,
  type ContextoSeed,
  type ContratoSeed,
  type FornecedorSeed,
  type ItemAtaSeed,
  type ItemContratoSeed,
} from './contexto.ts';
import type { Prng } from './prng.ts';

type Faixa = 'vencido' | 'critico' | 'atencao' | 'alerta' | 'regular';

/** Distribuição de vigências que exercita o semáforo completo (vencidos, ≤30, ≤60, ≤90, >90 dias). */
function faixas(prng: Prng, quantidades: Record<Faixa, number>): Faixa[] {
  return prng.embaralhar((Object.keys(quantidades) as Faixa[]).flatMap((f) => Array.from({ length: quantidades[f] }, () => f)));
}

function diasDaFaixa(prng: Prng, faixa: Faixa, maximoRegular: number): number {
  switch (faixa) {
    case 'vencido':
      return -prng.inteiro(5, 200);
    case 'critico':
      return prng.inteiro(0, 30);
    case 'atencao':
      return prng.inteiro(31, 60);
    case 'alerta':
      return prng.inteiro(61, 90);
    case 'regular':
      return prng.inteiro(91, maximoRegular);
  }
}

function menor(a: string, b: string): string {
  return a < b ? a : b;
}

function maior(a: string, b: string): string {
  return a > b ? a : b;
}

function dataEntre(prng: Prng, inicio: string, fim: string): string {
  const intervalo = diasEntre(inicio, fim);
  return intervalo <= 0 ? inicio : adicionarDias(inicio, prng.inteiro(0, intervalo));
}

function processoSei(prng: Prng, ano: number): string {
  return `08${prng.digitos(3)}.${prng.digitos(6)}/${ano}-${prng.digitos(2)}`;
}

class Numerador {
  readonly #contadores = new Map<string, number>();
  readonly #prng: Prng;
  constructor(prng: Prng) {
    this.#prng = prng;
  }
  proximo(chave: string): number {
    const atual = this.#contadores.get(chave) ?? this.#prng.inteiro(2, 18);
    const proximo = atual + 1;
    this.#contadores.set(chave, proximo);
    return proximo;
  }
}

const COLUNAS_ATAS = [
  'id', 'numero', 'ano', 'uasg', 'objeto', 'processo_sei', 'modalidade', 'numero_compra', 'assinatura_em', 'divulgacao_pncp_em',
  'vigencia_inicio', 'vigencia_fim', 'aceita_adesao', 'id_pncp', 'gestor_id', 'indice_reajuste', 'data_base_reajuste', 'fonte_dados', 'busca_normalizada',
] as const;

const COLUNAS_CONTRATOS = [
  'id', 'numero', 'ano', 'uasg', 'fornecedor_id', 'ata_id', 'objeto', 'processo_sei', 'origem', 'modalidade', 'assinatura_em',
  'divulgacao_pncp_em', 'vigencia_inicio', 'vigencia_fim', 'valor_inicial', 'gestor_id', 'fiscal_id', 'id_pncp', 'garantia_tipo',
  'garantia_valor', 'garantia_valida_ate', 'indice_reajuste', 'data_base_reajuste', 'fonte_recurso', 'fonte_dados', 'busca_normalizada',
] as const;

function nomeBusca(f: FornecedorSeed): string {
  return f.tipo === 'PJ' ? `${f.nome} ${f.documento}` : '';
}

export async function gerarInstrumentos(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, dados, hoje, agora, eventos } = ctx;
  const numerador = new Numerador(prng);
  const fornecedorPorChave = new Map(dados.fornecedores.map((f) => [f.chave, f]));
  const fornecedorPorId = new Map(dados.fornecedores.map((f) => [f.id, f]));
  const gestorDemo = dados.usuarios.get('gestor@agora.demo');
  const fiscalDemo = dados.usuarios.get('fiscal@agora.demo');
  if (!gestorDemo || !fiscalDemo) throw new Error('Usuários de demonstração ausentes');
  const escolherGestor = () => (prng.chance(0.6) ? gestorDemo.id : prng.escolher(dados.gestores));
  const escolherFiscal = (uasg: string) => {
    const fiscalPodeVer = fiscalDemo.uasgs === 'todas' || fiscalDemo.uasgs.includes(uasg);
    return fiscalPodeVer && prng.chance(0.6) ? fiscalDemo.id : prng.escolher(dados.fiscais.filter((f) => f !== fiscalDemo.id));
  };
  const carga = { carga: 'demonstracao' };
  let sequencialPncp = prng.inteiro(100, 400);

  // ───────── Atas de registro de preços (40, ≈ 320 itens) ─────────
  const faixasAtas = faixas(prng, { vencido: 6, critico: 5, atencao: 5, alerta: 5, regular: 19 });
  const atas: (AtaSeed & { divulgacao: string; idPncp: string; numeroCompra: string; aceitaAdesao: boolean; processo: string })[] = [];
  faixasAtas.forEach((faixa, i) => {
    const indiceObjeto = i % OBJETOS_ATA.length;
    const modelo = OBJETOS_ATA[indiceObjeto];
    if (!modelo) throw new Error('Objeto de ata ausente');
    const uasg = i < dados.uasgs.length ? (dados.uasgs[i] ?? '') : prng.escolher(dados.uasgs);
    const dias = diasDaFaixa(prng, faixa, 330);
    const fim = adicionarDias(hoje, dias);
    const prorrogada = dias < 300 && prng.chance(0.25);
    const inicio = adicionarDias(fim, -(prorrogada ? 729 : 364));
    const assinatura = adicionarDias(inicio, -prng.inteiro(0, 3));
    const ano = Number(assinatura.slice(0, 4));
    const id = prng.uuid();
    const itens: ItemAtaSeed[] = [];
    const quantidadeItens = prng.inteiro(4, 7);
    const candidatos = modelo.itens.flatMap((t) => (t.variantes ?? [null]).map((v) => ({ t, v })));
    const lotes = ['lote regional Norte', 'lote regional Sul', 'lote regional Nordeste'];
    for (let l = 0; candidatos.length < quantidadeItens && l < lotes.length; l++) {
      const lote = lotes[l] ?? '';
      candidatos.push(...modelo.itens.map((t) => ({ t, v: lote })));
    }
    for (const { t, v } of prng.embaralhar(candidatos).slice(0, quantidadeItens)) {
      itens.push(...itensDaAta(prng, t, v, modelo.fornecedores, fornecedorPorChave, itens.length));
    }
    sequencialPncp++;
    atas.push({
      id,
      numero: `${numerador.proximo(`ata:${uasg}:${ano}`)}/${ano}`,
      uasg,
      objetoIndice: indiceObjeto,
      objeto: modelo.objeto,
      natureza: modelo.natureza,
      assinatura,
      vigenciaInicio: inicio,
      vigenciaFim: fim,
      dataBase: adicionarDias(assinatura, -prng.inteiro(30, 90)),
      gestorId: escolherGestor(),
      itens,
      divulgacao: menor(adicionarDias(assinatura, prng.inteiro(1, 8)), hoje),
      idPncp: `${dados.cnpjOrgao}-1-${String(sequencialPncp).padStart(6, '0')}/${ano}-${String(prng.inteiro(1, 3)).padStart(6, '0')}`,
      numeroCompra: `${90000 + prng.inteiro(10, 899)}/${ano}`,
      aceitaAdesao: prng.chance(0.4),
      processo: processoSei(prng, ano),
    });
  });

  // ───────── Contratos (60, ≈ 45 vinculados a atas) ─────────
  const tipos = prng.embaralhar([
    ...Array.from({ length: 45 }, () => 'ata' as const),
    ...Array.from({ length: 5 }, () => 'sem_vinculo' as const),
    ...Array.from({ length: 7 }, () => 'direto' as const),
  ]);
  const recentes = Array.from({ length: 3 }, () => 'recente' as const);
  const faixasContratos = faixas(prng, { vencido: 7, critico: 7, atencao: 7, alerta: 7, regular: 29 });
  const contratos: (ContratoSeed & { modalidade: string; processo: string; garantia: { tipo: string; valor: number; validaAte: string } | null })[] = [];
  let indiceDireto = 0;

  const planos = [...tipos.map((tipo, i) => ({ tipo, faixa: faixasContratos[i] ?? ('regular' as Faixa) })), ...recentes.map((tipo) => ({ tipo, faixa: 'regular' as Faixa }))];
  for (const plano of planos) {
    const id = prng.uuid();
    const fimAlvo = adicionarDias(hoje, diasDaFaixa(prng, plano.faixa, 600));
    let tipo: 'ata' | 'sem_vinculo' | 'direto' | 'recente' = plano.tipo;
    let ata: (typeof atas)[number] | undefined;
    const limiteAssinatura = menor(adicionarDias(hoje, -15), adicionarDias(fimAlvo, -60));
    if (tipo === 'ata' || tipo === 'sem_vinculo') {
      const candidatas = atas.filter((a) => a.vigenciaInicio <= limiteAssinatura && a.itens.some((it) => it.restante > 0));
      if (candidatas.length === 0) tipo = 'direto';
      else ata = prng.escolher(candidatas);
    }

    let assinatura: string;
    let fornecedor: FornecedorSeed;
    let itens: ItemContratoSeed[];
    let objeto: string;
    let natureza: string;
    let servico: boolean;
    let origem: 'licitacao' | 'contratacao_direta' = 'licitacao';
    let modalidade = 'Pregão eletrônico — sistema de registro de preços';
    let uasg: string;

    if (ata) {
      assinatura = dataEntre(prng, ata.vigenciaInicio, menor(ata.vigenciaFim, limiteAssinatura));
      const disponiveis = ata.itens.filter((it) => it.restante > 0);
      const idFornecedor = prng.escolher(disponiveis).fornecedorId;
      const encontrado = fornecedorPorId.get(idFornecedor);
      if (!encontrado) throw new Error('Fornecedor da ata ausente');
      fornecedor = encontrado;
      const altoConsumo = prng.chance(0.2);
      const doFornecedor = prng.embaralhar(disponiveis.filter((it) => it.fornecedorId === idFornecedor)).slice(0, prng.inteiro(1, 4));
      itens = doFornecedor.map((it, n) => {
        const desejada = altoConsumo
          ? Math.ceil((it.restante * prng.inteiro(85, 100)) / 100)
          : Math.max(1, Math.round((it.quantidadeRegistrada * prng.inteiro(15, 45)) / 100));
        const quantidade = Math.max(1, Math.min(it.restante, desejada));
        it.restante -= quantidade;
        return {
          id: prng.uuid(),
          numero: n + 1,
          descricao: it.descricao,
          unidade: it.unidade,
          quantidade,
          valorUnitario: it.valorUnitario,
          itemAtaId: tipo === 'ata' ? it.id : null,
        };
      });
      objeto = ata.objeto.replace(/^Registro de preços para (\p{L})/u, (_m, letra: string) => letra.toUpperCase());
      natureza = ata.natureza;
      servico = natureza === '339040';
      uasg = prng.chance(0.8) ? ata.uasg : prng.escolher(dados.uasgs);
    } else {
      const modeloDireto = OBJETOS_CONTRATO[indiceDireto % OBJETOS_CONTRATO.length];
      indiceDireto++;
      if (!modeloDireto) throw new Error('Objeto de contrato ausente');
      const encontrado = fornecedorPorChave.get(modeloDireto.fornecedor);
      if (!encontrado) throw new Error(`Fornecedor ${modeloDireto.fornecedor} ausente`);
      fornecedor = encontrado;
      const duracao = modeloDireto.servico ? prng.escolher([365, 730]) : prng.escolher([180, 365]);
      assinatura =
        tipo === 'recente' ? adicionarDias(hoje, -prng.inteiro(2, 8)) : menor(adicionarDias(fimAlvo, -duracao), adicionarDias(hoje, -prng.inteiro(15, 60)));
      itens = modeloDireto.itens.map((t, n) => ({
        id: prng.uuid(),
        numero: n + 1,
        descricao: t.descricao,
        unidade: t.unidade,
        quantidade: prng.inteiro(t.quantidade[0], t.quantidade[1]),
        valorUnitario: centavosEntre(prng, t.preco),
        itemAtaId: null,
      }));
      objeto = modeloDireto.objeto;
      natureza = modeloDireto.natureza;
      servico = modeloDireto.servico;
      origem = modeloDireto.origem;
      modalidade = modeloDireto.modalidade;
      uasg = prng.escolher(dados.uasgs);
    }

    const vigenciaInicio = tipo === 'recente' ? assinatura : adicionarDias(assinatura, prng.inteiro(0, 5));
    const vigenciaFim = tipo === 'recente' ? adicionarDias(assinatura, 364) : maior(fimAlvo, adicionarDias(vigenciaInicio, 30));
    const ano = Number(assinatura.slice(0, 4));
    const valorInicial = itens.reduce((s, it) => s + it.quantidade * it.valorUnitario, 0);
    contratos.push({
      id,
      numero: `${numerador.proximo(`contrato:${uasg}:${ano}`)}/${ano}`,
      uasg,
      fornecedorId: fornecedor.id,
      ataId: tipo === 'ata' && ata ? ata.id : null,
      objeto,
      natureza,
      servico,
      origem,
      assinatura,
      vigenciaInicio,
      vigenciaFim,
      valorInicial,
      valorGlobal: valorInicial,
      gestorId: escolherGestor(),
      fiscalId: escolherFiscal(uasg),
      divulgacao: tipo === 'recente' ? null : adicionarDias(assinatura, prng.inteiro(1, 10)),
      garantiaValidaAte: null,
      dataBase: adicionarDias(assinatura, -prng.inteiro(30, 90)),
      reajusteAplicado: false,
      acelerado: false,
      fonteRecurso: prng.escolher(['1000', '1000', '1001', '1050']),
      itens,
      modalidade,
      processo: processoSei(prng, ano),
      garantia: null,
    });
  }

  // Divulgação no PNCP (art. 94): pendentes vencidas e divulgações fora do prazo para o painel exercitar a regra
  const antigos = prng.embaralhar(contratos.filter((c) => c.divulgacao !== null && diasEntre(c.assinatura, hoje) >= 60));
  antigos.slice(0, 4).forEach((c) => {
    c.divulgacao = null;
  });
  antigos.slice(4, 8).forEach((c) => {
    c.divulgacao = menor(adicionarDias(c.assinatura, prng.inteiro(35, 55)), hoje);
  });
  for (const c of contratos) if (c.divulgacao !== null) c.divulgacao = menor(c.divulgacao, hoje);

  // Garantias (art. 96): metade dos contratos de maior valor; três vencendo nos próximos dias
  for (const c of contratos) {
    if (c.valorInicial >= 10_000_000 && prng.chance(0.55)) {
      c.garantia = {
        tipo: prng.escolher(['Seguro-garantia', 'Fiança bancária', 'Caução em dinheiro']),
        valor: Math.round(c.valorInicial * 0.05),
        validaAte: adicionarDias(c.vigenciaFim, 90),
      };
    }
  }
  contratos
    .filter((c) => c.garantia !== null && c.vigenciaFim > hoje)
    .slice(0, 3)
    .forEach((c) => {
      if (c.garantia) c.garantia.validaAte = adicionarDias(hoje, prng.inteiro(5, 25));
    });
  for (const c of contratos) c.garantiaValidaAte = c.garantia?.validaAte ?? null;

  // Aditivos (art. 124 e 125) e reajustes por apostilamento (art. 136, I)
  const aditivos: { id: string; contratoId: string; numero: string; tipo: 'acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste'; valor: number; novaVigenciaFim: string | null; assinado: string; justificativa: string }[] = [];
  const ciclos: { id: string; tipo: 'ata' | 'contrato'; instrumentoId: string; inicio: string; fim: string; percentual: number; aplicadoEm: string }[] = [];
  let primeiroAcrescimo = true;
  for (const c of contratos) {
    const decorridos = diasEntre(c.assinatura, hoje);
    if (decorridos < 120 || aditivos.length >= 22 || !prng.chance(0.45)) continue;
    let termos = 0;
    const limite = menor(hoje, adicionarDias(c.vigenciaFim, -10));
    const tiposPossiveis: ('acrescimo' | 'supressao' | 'prorrogacao' | 'reajuste')[] = ['acrescimo', 'supressao'];
    if (c.servico) tiposPossiveis.push('prorrogacao');
    const aniversario = adicionarMeses(c.dataBase, 12);
    if (aniversario < limite) tiposPossiveis.push('reajuste');
    for (const tipoAditivo of prng.embaralhar(tiposPossiveis).slice(0, prng.inteiro(1, 2))) {
      const assinado = dataEntre(prng, adicionarDias(c.assinatura, 60), limite);
      if (assinado <= c.assinatura) continue;
      if (tipoAditivo === 'reajuste') {
        const percentual = prng.inteiro(35, 59) / 10;
        const aplicado = menor(adicionarDias(aniversario, prng.inteiro(10, 40)), limite);
        ciclos.push({ id: prng.uuid(), tipo: 'contrato', instrumentoId: c.id, inicio: c.dataBase, fim: adicionarDias(aniversario, -1), percentual, aplicadoEm: aplicado });
        aditivos.push({
          id: prng.uuid(),
          contratoId: c.id,
          numero: '1º Apostilamento',
          tipo: 'reajuste',
          valor: Math.round((c.valorInicial * percentual) / 200),
          novaVigenciaFim: null,
          assinado: aplicado,
          justificativa: `Reajuste anual pelo IPCA (${percentual.toLocaleString('pt-BR')}%) sobre o saldo remanescente, após 12 meses da data-base.`,
        });
        c.reajusteAplicado = true;
        continue;
      }
      termos++;
      const percentual =
        tipoAditivo === 'acrescimo' ? (primeiroAcrescimo ? 23 : prng.inteiro(5, 18)) : tipoAditivo === 'supressao' ? prng.inteiro(3, 10) : prng.inteiro(80, 100);
      if (tipoAditivo === 'acrescimo') primeiroAcrescimo = false;
      aditivos.push({
        id: prng.uuid(),
        contratoId: c.id,
        numero: `${termos}º Termo Aditivo`,
        tipo: tipoAditivo,
        valor: Math.round((c.valorInicial * percentual) / 100),
        novaVigenciaFim: tipoAditivo === 'prorrogacao' ? c.vigenciaFim : null,
        assinado,
        justificativa:
          tipoAditivo === 'acrescimo'
            ? `Acréscimo quantitativo de ${percentual}% para atender à ampliação das operações (art. 125).`
            : tipoAditivo === 'supressao'
              ? `Supressão de ${percentual}% por redução da demanda prevista (art. 125).`
              : 'Prorrogação do serviço contínuo por mais 12 meses, comprovada a vantajosidade (art. 107).',
      });
    }
  }
  for (const a of aditivos) {
    const c = contratos.find((x) => x.id === a.contratoId);
    if (c) c.valorGlobal += a.tipo === 'supressao' ? -a.valor : a.valor;
  }
  for (const a of atas) {
    const aniversario = adicionarMeses(a.dataBase, 12);
    if (diasEntre(aniversario, menor(hoje, a.vigenciaFim)) > 20 && prng.chance(0.6)) {
      ciclos.push({
        id: prng.uuid(),
        tipo: 'ata',
        instrumentoId: a.id,
        inicio: a.dataBase,
        fim: adicionarDias(aniversario, -1),
        percentual: prng.inteiro(38, 56) / 10,
        aplicadoEm: menor(adicionarDias(aniversario, prng.inteiro(10, 20)), hoje),
      });
    }
  }

  // Queima de saldo acelerada (RIA-07): alguns contratos vigentes com pagamentos adiantados
  contratos
    .filter((c) => c.vigenciaInicio < adicionarDias(hoje, -90) && diasEntre(hoje, c.vigenciaFim) > 120)
    .slice(0, 4)
    .forEach((c) => {
      c.acelerado = true;
    });

  // ───────── Gravação ─────────
  await inserirEmLote(
    tx,
    'atas',
    COLUNAS_ATAS,
    atas.map((a) => {
      const fornecedoresAta = [...new Set(a.itens.map((i) => i.fornecedorId))].map((idF) => fornecedorPorId.get(idF));
      return [
        a.id, a.numero, Number(a.numero.split('/')[1]), a.uasg, a.objeto, a.processo, 'Pregão eletrônico', a.numeroCompra, a.assinatura,
        a.divulgacao, a.vigenciaInicio, a.vigenciaFim, a.aceitaAdesao, a.idPncp, a.gestorId, 'IPCA', a.dataBase, 'COMPRAS_GOV',
        normalizarBusca(a.numero, a.objeto, a.uasg, a.numeroCompra, a.processo, ...fornecedoresAta.map((f) => (f ? nomeBusca(f) : ''))),
      ];
    }),
  );
  await inserirEmLote(
    tx,
    'itens_ata',
    ['id', 'ata_id', 'numero', 'descricao', 'catmat', 'unidade_fornecimento', 'fornecedor_id', 'valor_unitario', 'quantidade_registrada', 'busca_normalizada'],
    atas.flatMap((a) =>
      a.itens.map((i) => {
        const f = fornecedorPorId.get(i.fornecedorId);
        return [i.id, a.id, i.numero, i.descricao, i.catmat, i.unidade, i.fornecedorId, i.valorUnitario, i.quantidadeRegistrada, normalizarBusca(i.descricao, a.numero, f ? nomeBusca(f) : '')];
      }),
    ),
  );

  const anoAtual = Number(hoje.slice(0, 4));
  await inserirEmLote(
    tx,
    'atas_a_montar',
    ['id', 'numero_compra', 'modalidade', 'uasg', 'objeto', 'homologada_em', 'quantidade_itens', 'valor_homologado', 'id_pncp', 'busca_normalizada'],
    Array.from({ length: 8 }, (_, i) => {
      const modelo = prng.escolher(OBJETOS_ATA);
      const itensCompra = prng.inteiro(3, 14);
      const valor = Array.from({ length: itensCompra }, () => {
        const t = prng.escolher(modelo.itens);
        return centavosEntre(prng, t.preco) * prng.inteiro(t.quantidade[0], t.quantidade[1]);
      }).reduce((s, v) => s + v, 0);
      const numero = `${90000 + prng.inteiro(100, 999)}/${anoAtual}`;
      sequencialPncp++;
      return [
        prng.uuid(),
        numero,
        'Pregão eletrônico',
        i < 2 ? (dados.uasgs[i] ?? '') : prng.escolher(dados.uasgs),
        modelo.objeto,
        adicionarDias(hoje, -prng.inteiro(3, 75)),
        itensCompra,
        valor,
        `${dados.cnpjOrgao}-1-${String(sequencialPncp).padStart(6, '0')}/${anoAtual}`,
        normalizarBusca(numero, modelo.objeto),
      ];
    }),
  );

  let sequencialContratoPncp = prng.inteiro(200, 600);
  await inserirEmLote(
    tx,
    'contratos',
    COLUNAS_CONTRATOS,
    contratos.map((c) => {
      const f = fornecedorPorId.get(c.fornecedorId);
      sequencialContratoPncp++;
      return [
        c.id, c.numero, Number(c.numero.split('/')[1]), c.uasg, c.fornecedorId, c.ataId, c.objeto, c.processo, c.origem, c.modalidade,
        c.assinatura, c.divulgacao, c.vigenciaInicio, c.vigenciaFim, c.valorInicial, c.gestorId, c.fiscalId,
        c.divulgacao ? `${dados.cnpjOrgao}-2-${String(sequencialContratoPncp).padStart(6, '0')}/${c.assinatura.slice(0, 4)}` : null,
        c.garantia?.tipo ?? null, c.garantia?.valor ?? null, c.garantia?.validaAte ?? null, 'IPCA', c.dataBase, c.fonteRecurso, 'CONTRATOS_GOV',
        normalizarBusca(c.numero, c.objeto, c.processo, c.uasg, f ? nomeBusca(f) : ''),
      ];
    }),
  );
  await inserirEmLote(
    tx,
    'itens_contrato',
    ['id', 'contrato_id', 'item_ata_id', 'numero', 'descricao', 'unidade_fornecimento', 'quantidade', 'valor_unitario', 'quantidade_recebida'],
    contratos.flatMap((c) =>
      c.itens.map((i) => {
        const decorrido = Math.min(1, Math.max(0, diasEntre(c.vigenciaInicio, hoje) / Math.max(1, diasEntre(c.vigenciaInicio, c.vigenciaFim))));
        return [i.id, c.id, i.itemAtaId, i.numero, i.descricao, i.unidade, i.quantidade, i.valorUnitario, Math.floor(i.quantidade * decorrido * 0.9)];
      }),
    ),
  );
  await inserirEmLote(
    tx,
    'aditivos',
    ['id', 'contrato_id', 'numero', 'tipo', 'valor', 'nova_vigencia_fim', 'assinado_em', 'justificativa'],
    aditivos.map((a) => [a.id, a.contratoId, a.numero, a.tipo, a.valor, a.novaVigenciaFim, a.assinado, a.justificativa]),
  );
  await inserirEmLote(
    tx,
    'reajustes_ciclos',
    ['id', 'instrumento_tipo', 'instrumento_id', 'inicio', 'fim', 'percentual', 'aplicado_em'],
    ciclos.map((c) => [c.id, c.tipo, c.instrumentoId, c.inicio, c.fim, c.percentual, c.aplicadoEm]),
  );

  // Histórico (trilha de auditoria) da carga: registros, divulgações e aditivos
  for (const a of atas) {
    eventos.push({
      ocorridoEm: instanteEm(adicionarDias(a.assinatura, 1) > hoje ? hoje : adicionarDias(a.assinatura, 1), prng, agora),
      usuarioId: a.gestorId,
      acao: 'ata.registrar',
      recurso: 'ata',
      recursoId: a.id,
      resumo: `Registrou a ata ${a.numero}`,
      dados: { ...carga, itens: a.itens.length },
    });
  }
  for (const c of contratos) {
    eventos.push({
      ocorridoEm: instanteEm(c.assinatura, prng, agora),
      usuarioId: c.gestorId,
      acao: 'contrato.registrar',
      recurso: 'contrato',
      recursoId: c.id,
      resumo: `Registrou o contrato ${c.numero}`,
      dados: { ...carga, ...(c.ataId ? { ataId: c.ataId, instrumentoTipo: 'ata', instrumentoId: c.ataId } : {}) },
    });
    if (c.divulgacao) {
      eventos.push({
        ocorridoEm: instanteEm(c.divulgacao, prng, agora),
        usuarioId: c.gestorId,
        acao: 'contrato.divulgar_pncp',
        recurso: 'contrato',
        recursoId: c.id,
        resumo: 'Registrou a divulgação do contrato no PNCP',
        dados: { ...carga, divulgadoEm: c.divulgacao },
      });
    }
  }
  for (const a of aditivos) {
    const c = contratos.find((x) => x.id === a.contratoId);
    eventos.push({
      ocorridoEm: instanteEm(a.assinado, prng, agora),
      usuarioId: c?.gestorId ?? null,
      acao: a.tipo === 'reajuste' ? 'contrato.apostilar' : 'contrato.aditivo.registrar',
      recurso: 'contrato',
      recursoId: a.contratoId,
      resumo: `Registrou o ${a.numero} (${a.tipo === 'acrescimo' ? 'acréscimo' : a.tipo === 'supressao' ? 'supressão' : a.tipo === 'prorrogacao' ? 'prorrogação' : 'reajuste'})`,
      dados: { ...carga, tipo: a.tipo, valor: a.valor },
    });
  }

  dados.atas = atas;
  dados.contratos = contratos;
  dados.contagens.atas = atas.length;
  dados.contagens.itensAta = atas.reduce((s, a) => s + a.itens.length, 0);
  dados.contagens.contratos = contratos.length;
  dados.contagens.contratosComAta = contratos.filter((c) => c.ataId !== null).length;
  dados.contagens.aditivos = aditivos.length;
}

/** Itens de uma ata: cota principal e, quando cabível, cota reservada a ME/EPP (LC 123/2006, art. 48, III). */
function itensDaAta(
  prng: Prng,
  modelo: ItemModelo,
  variante: string | null,
  chavesFornecedores: readonly string[],
  fornecedorPorChave: ReadonlyMap<string, FornecedorSeed>,
  jaCriados: number,
): ItemAtaSeed[] {
  const descricaoBase = variante ? `${modelo.descricao}, ${variante}` : modelo.descricao;
  const candidatos = chavesFornecedores.map((c) => fornecedorPorChave.get(c)).filter((f): f is FornecedorSeed => f !== undefined);
  const principal = prng.escolher(candidatos);
  const pequenos = candidatos.filter((f) => f.porte === 'ME' || f.porte === 'EPP');
  const quantidade = prng.inteiro(modelo.quantidade[0], modelo.quantidade[1]);
  const valor = centavosEntre(prng, modelo.preco);
  const reservar = pequenos.length > 0 && quantidade >= 8 && prng.chance(0.75);
  if (!reservar) {
    return [
      {
        id: prng.uuid(),
        numero: jaCriados + 1,
        descricao: descricaoBase,
        catmat: modelo.catmat,
        unidade: modelo.unidade,
        fornecedorId: principal.id,
        valorUnitario: valor,
        quantidadeRegistrada: quantidade,
        restante: quantidade,
      },
    ];
  }
  const quantidadePrincipal = Math.round(quantidade * 0.75);
  const reservada = quantidade - quantidadePrincipal;
  return [
    {
      id: prng.uuid(),
      numero: jaCriados + 1,
      descricao: `${descricaoBase} — cota principal`,
      catmat: modelo.catmat,
      unidade: modelo.unidade,
      fornecedorId: principal.id,
      valorUnitario: valor,
      quantidadeRegistrada: quantidadePrincipal,
      restante: quantidadePrincipal,
    },
    {
      id: prng.uuid(),
      numero: jaCriados + 2,
      descricao: `${descricaoBase} — cota reservada ME/EPP`,
      catmat: modelo.catmat,
      unidade: modelo.unidade,
      fornecedorId: prng.escolher(pequenos).id,
      valorUnitario: Math.round(valor * (1 + prng.inteiro(1, 4) / 100)),
      quantidadeRegistrada: reservada,
      restante: reservada,
    },
  ];
}
