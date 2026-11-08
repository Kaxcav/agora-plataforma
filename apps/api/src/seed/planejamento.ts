/**
 * Carga sintética do planejamento (frente O): cópia local do catálogo CATMAT/CATSER (modo offline), planos de
 * contratações anuais em cada situação, o vínculo de um processo com o PCA publicado e duas intenções de registro de
 * preços (uma aberta para adesões e outra encerrada, pronta para a consolidação). Códigos, descrições, quantidades e
 * valores são inventados; nenhum dado vem do portal original.
 *
 * Situações da demonstração (relativas ao "hoje" da carga):
 *   * PCA do exercício corrente publicado nas UASGs 910002, 930002, 940002 e 950002 — nelas o DFD aponta o item do
 *     plano ou justifica (art. 18, § 1º, II);
 *   * PCA do exercício seguinte: em elaboração na 950001 (com demandas repetidas para a consolidação) e na 930001, e
 *     consolidado aguardando aprovação na 920001;
 *   * luvas táticas (357301) previstas em outras unidades: a demanda de EPIs da SENASP recebe o sinal de registro de
 *     preços compartilhado (RIA-01).
 */
import { adicionarDias, adicionarDiasUteis, diasUteisEntre, ehDiaUtil, numeroControlePncp, type CategoriaItemPca, type PrioridadePca } from '@agora/dominio';
import type { EntradaDemandaPca } from '@agora/contratos';
import { guardarNoCache } from '../modulos/planejamento/catalogo.ts';
import { gravarConsolidacao, inserirDemanda, inserirPlano } from '../modulos/planejamento/pca.ts';
import type { ItemCatalogoLido } from '../integracoes/catalogo-compras.ts';
import type { ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

/** Semente própria: a etapa não consome a sequência do gerador compartilhado pelas demais. */
const SEMENTE_PLANEJAMENTO = 14_133_024;

type ItemSeed = [codigo: string, descricao: string, classeCodigo: string, classeNome: string, ativo?: boolean];

const MATERIAIS: readonly ItemSeed[] = [
  ['150350', 'Veículo automotor tipo caminhonete cabine dupla, tração 4x4, caracterizado para policiamento', '2310', 'Veículos de passageiros e utilitários'],
  ['150351', 'Veículo automotor tipo sedã para uso administrativo, motor flex', '2310', 'Veículos de passageiros e utilitários'],
  ['446901', 'Colete de proteção balística nível III-A com capa externa e painéis flexíveis', '8470', 'Equipamentos de proteção balística'],
  ['446902', 'Capacete de proteção balística nível III-A com suspensão ajustável', '8470', 'Equipamentos de proteção balística'],
  ['420615', 'Rádio transceptor digital portátil padrão P25 com bateria e carregador', '5820', 'Equipamentos de radiocomunicação'],
  ['420620', 'Rádio transceptor digital móvel veicular padrão P25', '5820', 'Equipamentos de radiocomunicação'],
  ['471210', 'Aeronave remotamente pilotada multirrotor com câmera termal embarcada', '1550', 'Aeronaves não tripuladas'],
  ['471215', 'Bateria sobressalente para aeronave remotamente pilotada multirrotor', '1550', 'Aeronaves não tripuladas'],
  ['470830', 'Scanner corporal de inspeção por raios X para revista de pessoas', '6665', 'Equipamentos de inspeção e detecção'],
  ['357301', 'Luva tática de proteção em couro com reforço nos nós dos dedos', '8415', 'Vestuário especial de proteção'],
  ['357302', 'Luva de procedimento descartável em nitrila sem pó', '6515', 'Material médico descartável'],
  ['357310', 'Conjunto de joelheira e cotoveleira táticas em polímero de alta resistência', '8415', 'Vestuário especial de proteção'],
  ['357320', 'Óculos de proteção balística com lente incolor e tratamento antiembaçante', '8465', 'Equipamentos individuais de proteção'],
  ['343101', 'Munição de treinamento calibre 9 mm com projétil encamisado', '1305', 'Munições para armas portáteis'],
  ['343120', 'Munição de treinamento calibre .40 com projétil frangível', '1305', 'Munições para armas portáteis'],
  ['650510', 'Kit de primeiros socorros tático com torniquete e bandagem de compressão', '6545', 'Conjuntos de primeiros socorros'],
  ['650511', 'Torniquete tático de aplicação com uma das mãos', '6545', 'Conjuntos de primeiros socorros'],
  ['150101', 'Mesa de trabalho em aço e MDF com regulagem de altura', '7110', 'Mobiliário de escritório'],
  ['150102', 'Cadeira giratória com apoio lombar e braços reguláveis', '7110', 'Mobiliário de escritório'],
  ['150110', 'Armário de aço com duas portas, prateleiras e fechadura', '7110', 'Mobiliário de escritório'],
  ['230410', 'Notebook com processador de oito núcleos, 16 GB de memória e unidade SSD de 512 GB', '7021', 'Computadores e estações de trabalho'],
  ['230420', 'Microcomputador de mesa com monitor de 24 polegadas, teclado e mouse', '7021', 'Computadores e estações de trabalho'],
  ['230430', 'Monitor de vídeo LED de 27 polegadas com ajuste de altura', '7025', 'Periféricos de computador'],
  ['240110', 'Lanterna tática recarregável de LED com 1000 lúmens', '6230', 'Lanternas e iluminação portátil'],
  ['240120', 'Algema em aço inoxidável com trava dupla', '8465', 'Equipamentos individuais de proteção'],
  ['240130', 'Coldre tático de cintura em polímero com trava de retenção', '8465', 'Equipamentos individuais de proteção'],
  ['360210', 'Papel sulfite A4 de 75 g/m², resma com 500 folhas', '7530', 'Papelaria e material de expediente'],
  ['360220', 'Cartucho de toner para impressora laser monocromática', '7510', 'Suprimentos de impressão'],
  ['370510', 'Uniforme operacional com gandola e calça em tecido rip-stop', '8415', 'Vestuário especial de proteção'],
  ['370520', 'Bota tática de cano alto em couro com solado antiderrapante', '8430', 'Calçados'],
  ['380110', 'Pneu radial aro 17 para caminhonete', '2610', 'Pneus e câmaras de ar'],
  ['380120', 'Bateria automotiva selada de 70 Ah', '6140', 'Baterias recarregáveis'],
  ['390110', 'Câmera corporal portátil para registro de ocorrências com armazenamento criptografado', '6760', 'Equipamentos de captura de imagem'],
  ['390120', 'Cartão de memória microSD de 128 GB', '7045', 'Suprimentos de informática'],
  ['390130', 'Lanterna incandescente de mão com pilhas (item descontinuado)', '6230', 'Lanternas e iluminação portátil', false],
];

const SERVICOS: readonly ItemSeed[] = [
  ['27502', 'Licenciamento de software de extração e análise forense de dispositivos móveis', '735', 'Licenciamento de programas de computador'],
  ['27510', 'Suporte técnico e atualização de software de análise forense', '735', 'Licenciamento de programas de computador'],
  ['27200', 'Desenvolvimento e manutenção de sistemas de informação por pontos de função', '731', 'Serviços de desenvolvimento de software'],
  ['24619', 'Manutenção preventiva e corretiva de viaturas com fornecimento de peças', '871', 'Manutenção de veículos'],
  ['25330', 'Manutenção de aeronaves remotamente pilotadas e de seus sensores', '872', 'Manutenção de equipamentos'],
  ['26115', 'Limpeza e conservação predial com fornecimento de materiais', '853', 'Serviços de limpeza'],
];

function catalogoSeed(): ItemCatalogoLido[] {
  const montar = (tipo: 'material' | 'servico') => (i: ItemSeed): ItemCatalogoLido => ({
    codigo: i[0],
    tipo,
    descricao: i[1],
    classeCodigo: i[2],
    classeNome: i[3],
    pdmCodigo: null,
    pdmNome: null,
    sustentavel: false,
    ativo: i[4] ?? true,
  });
  return [...MATERIAIS.map(montar('material')), ...SERVICOS.map(montar('servico'))];
}

type DemandaSeed = [
  unidade: string,
  codigo: string | null,
  tipo: 'material' | 'servico' | null,
  descricao: string,
  fornecimento: string,
  quantidade: number,
  valorUnitarioReais: number,
  mesDia: string,
  prioridade: PrioridadePca,
  categoria: CategoriaItemPca,
];

interface PlanoSeed {
  uasg: string;
  /** 0 = exercício corrente; 1 = exercício seguinte. */
  deslocamentoAno: 0 | 1;
  situacao: 'em_elaboracao' | 'consolidado' | 'publicado';
  demandas: readonly DemandaSeed[];
}

const PLANOS: readonly PlanoSeed[] = [
  {
    uasg: '930002',
    deslocamentoAno: 0,
    situacao: 'publicado',
    demandas: [
      ['Coordenação de Logística', '446901', 'material', 'Colete de proteção balística nível III-A', 'unidade', 600, 3_150, '03-20', 'alta', 'material'],
      ['Coordenação de Logística', '357301', 'material', 'Luva tática de proteção em couro', 'par', 150, 92, '05-15', 'media', 'material'],
      ['Coordenação de Operações', '357320', 'material', 'Óculos de proteção balística', 'unidade', 100, 48, '05-15', 'media', 'material'],
      ['Coordenação de Operações', '370520', 'material', 'Bota tática de cano alto', 'par', 400, 310, '07-01', 'baixa', 'material'],
    ],
  },
  {
    uasg: '940002',
    deslocamentoAno: 0,
    situacao: 'publicado',
    demandas: [
      ['Divisão de Segurança', '357301', 'material', 'Luva tática de proteção em couro', 'par', 80, 95, '04-10', 'media', 'material'],
      ['Divisão de Segurança', '240120', 'material', 'Algema em aço inoxidável com trava dupla', 'unidade', 60, 260, '04-10', 'alta', 'material'],
      ['Divisão de Administração', '26115', 'servico', 'Limpeza e conservação predial', 'mês', 12, 48_000, '02-01', 'alta', 'servico'],
    ],
  },
  {
    uasg: '950002',
    deslocamentoAno: 0,
    situacao: 'publicado',
    demandas: [
      ['Coordenação de Infraestrutura de TI', '230410', 'material', 'Notebook com processador de oito núcleos e 16 GB de memória', 'unidade', 200, 7_400, '06-30', 'alta', 'solucoes_tic'],
      ['Coordenação de Infraestrutura de TI', '230430', 'material', 'Monitor de vídeo LED de 27 polegadas', 'unidade', 150, 1_850, '06-30', 'media', 'solucoes_tic'],
      ['Coordenação de Sistemas', '27200', 'servico', 'Desenvolvimento e manutenção de sistemas por pontos de função', 'ponto de função', 3_000, 620, '03-01', 'alta', 'solucoes_tic'],
    ],
  },
  {
    uasg: '910002',
    deslocamentoAno: 0,
    situacao: 'publicado',
    demandas: [
      ['Núcleo de Operações', '420615', 'material', 'Rádio transceptor digital portátil padrão P25', 'unidade', 90, 8_900, '05-30', 'alta', 'material'],
      ['Núcleo de Operações', '240110', 'material', 'Lanterna tática recarregável de LED', 'unidade', 120, 240, '05-30', 'media', 'material'],
    ],
  },
  {
    uasg: '950001',
    deslocamentoAno: 1,
    situacao: 'em_elaboracao',
    demandas: [
      ['Coordenação de Logística', '360210', 'material', 'Papel sulfite A4 de 75 g/m², resma com 500 folhas', 'resma', 800, 28, '03-15', 'media', 'material'],
      ['Divisão de Protocolo', '360210', 'material', 'Papel sulfite A4 de 75 g/m²', 'resma', 400, 27.5, '02-10', 'alta', 'material'],
      ['Coordenação de Logística', '360220', 'material', 'Cartucho de toner para impressora laser monocromática', 'unidade', 120, 310, '04-01', 'media', 'material'],
      ['Coordenação de Logística', '150101', 'material', 'Mesa de trabalho em aço e MDF com regulagem de altura', 'unidade', 40, 1_650, '06-01', 'baixa', 'material'],
      ['Diretoria de Gestão de Pessoas', '150101', 'material', 'Mesa de trabalho com regulagem de altura', 'unidade', 25, 1_700, '05-10', 'media', 'material'],
      ['Diretoria de Gestão de Pessoas', '150102', 'material', 'Cadeira giratória com apoio lombar', 'unidade', 60, 980, '06-01', 'baixa', 'material'],
      ['Coordenação de Engenharia', null, null, 'Manutenção predial preventiva e corretiva do edifício-sede', 'serviço', 1, 480_000, '01-31', 'alta', 'servicos_engenharia'],
    ],
  },
  {
    uasg: '930001',
    deslocamentoAno: 1,
    situacao: 'em_elaboracao',
    demandas: [
      ['Diretoria de Operações', '650510', 'material', 'Kit de primeiros socorros tático', 'kit', 300, 610, '03-30', 'alta', 'material'],
      ['Diretoria de Operações', '390110', 'material', 'Câmera corporal portátil para registro de ocorrências', 'unidade', 150, 2_900, '08-15', 'media', 'material'],
    ],
  },
  {
    uasg: '920001',
    deslocamentoAno: 1,
    situacao: 'consolidado',
    demandas: [
      ['Coordenação de Frota', '380110', 'material', 'Pneu radial aro 17 para caminhonete', 'unidade', 480, 890, '02-20', 'alta', 'material'],
      ['Coordenação de Frota', '24619', 'servico', 'Manutenção preventiva e corretiva de viaturas', 'mês', 12, 95_000, '01-15', 'alta', 'servico'],
    ],
  },
];

export async function gerarPlanejamento(ctx: ContextoSeed): Promise<void> {
  const { tx, agora, hoje, dados } = ctx;
  const prng = new Prng(SEMENTE_PLANEJAMENTO);
  const novoId = () => prng.uuid();
  const planejamento = dados.usuarios.get('planejamento@agora.demo')?.id ?? null;
  const gestor = dados.usuarios.get('gestor@agora.demo')?.id ?? null;
  const anoCorrente = Number(hoje.slice(0, 4));

  // Cópia local do catálogo (modo offline).
  const catalogo = catalogoSeed();
  await guardarNoCache(tx, catalogo, 'seed', agora);

  // Planos de contratações.
  let sequencialPncp = 0;
  const itensPorPlano = new Map<string, string>();
  for (const plano of PLANOS) {
    const ano = anoCorrente + plano.deslocamentoAno;
    const criadoEm = new Date(agora.getTime() - (plano.deslocamentoAno === 0 ? 300 : 40) * 86_400_000);
    const planoId = await inserirPlano(tx, { id: novoId(), uasg: plano.uasg, ano, criadoPor: planejamento }, criadoEm);
    for (const d of plano.demandas) {
      const entrada: EntradaDemandaPca = {
        unidadeRequisitante: d[0],
        codigoCatalogo: d[1],
        tipoCatalogo: d[2],
        descricao: d[3],
        unidadeFornecimento: d[4],
        quantidade: d[5],
        valorUnitario: Math.round(d[6] * 100),
        dataDesejada: `${ano}-${d[7]}`,
        prioridade: d[8],
        categoria: d[9],
      };
      await inserirDemanda(tx, planoId, entrada, planejamento, criadoEm, novoId());
    }
    if (plano.situacao === 'em_elaboracao') continue;
    const consolidadoEm = new Date(criadoEm.getTime() + 20 * 86_400_000);
    await gravarConsolidacao(tx, { id: planoId, ano, situacao: 'em_elaboracao' }, planejamento ?? '', consolidadoEm, novoId);
    if (plano.situacao === 'consolidado') continue;
    sequencialPncp += 1;
    const aprovadoEm = new Date(consolidadoEm.getTime() + 15 * 86_400_000);
    const publicadoEm = new Date(aprovadoEm.getTime() + 3_600_000);
    const idPncp = numeroControlePncp({ registro: 'pca', cnpj: dados.cnpjOrgao, ano, sequencial: sequencialPncp });
    await tx.executar(
      `UPDATE pca_planos SET situacao = 'publicado', aprovado_por = $2, aprovado_em = $3, id_pncp = $4, protocolo_pncp = $5,
                             modo_publicacao = 'offline', publicado_em = $6, atualizado_em = $6 WHERE id = $1`,
      [planoId, gestor, aprovadoEm.toISOString(), idPncp, `SIMULADO-CARGA-PCA-${String(sequencialPncp).padStart(4, '0')}`, publicadoEm.toISOString()],
    );
    const [primeiro] = await tx.consultar<{ id: string }>('SELECT id FROM pca_itens WHERE plano_id = $1 AND numero = 1', [planoId]);
    if (primeiro) itensPorPlano.set(plano.uasg, primeiro.id);
    ctx.eventos.push({
      ocorridoEm: publicadoEm,
      usuarioId: gestor,
      acao: 'pncp.publicar_pca',
      recurso: 'pca',
      recursoId: planoId,
      resumo: `Publicou no PNCP (simulação) o plano de contratações anual ${ano} da UASG ${plano.uasg} sob o nº ${idPncp}`,
      dados: { uasg: plano.uasg, ano, idPncp, modo: 'offline' },
    });
  }

  // O processo dos coletes (FNSP) aponta o item do PCA publicado em que está previsto.
  const [coletes] = await tx.consultar<{ id: string }>("SELECT id FROM processos WHERE uasg = '930002' AND titulo LIKE '%coletes balísticos%' LIMIT 1");
  const itemColetes = itensPorPlano.get('930002');
  if (coletes && itemColetes) {
    await tx.executar(
      'INSERT INTO dfd_vinculos_pca (processo_id, pca_item_id, justificativa_fora_pca, registrado_por, registrado_em) VALUES ($1, $2, NULL, $3, $4)',
      [coletes.id, itemColetes, planejamento, new Date(agora.getTime() - 120 * 86_400_000).toISOString()],
    );
  }

  // Intenções de registro de preços: uma encerrada há 5 dias úteis (pronta para consolidar) e uma aberta há 2 dias úteis,
  // com 8 dias úteis ainda pela frente para as adesões.
  const aberturaEncerrada = recuarDiasUteis(hoje, 15, ctx.calendario);
  const aberturaAberta = recuarDiasUteis(hoje, 2, ctx.calendario);
  const irps: { numero: string; uasg: string; objeto: string; codigo: string; fornecimento: string; quantidade: number; abertura: string; encerramento: string; adesoes: [string, number, string][] }[] = [
    {
      numero: `001/${anoCorrente}`,
      uasg: '930002',
      objeto: 'Registro de preços de luvas táticas de proteção para as unidades de segurança pública',
      codigo: '357301',
      fornecimento: 'par',
      quantidade: 150,
      abertura: aberturaEncerrada,
      encerramento: adicionarDiasUteis(aberturaEncerrada, 10, ctx.calendario),
      adesoes: [
        ['940002', 80, 'A penitenciária prevê o uso das luvas nas escoltas e revistas do exercício.'],
        ['930001', 300, 'As equipes de pronta resposta precisam de luvas padronizadas para as operações integradas.'],
      ],
    },
    {
      numero: `002/${anoCorrente}`,
      uasg: '940001',
      objeto: 'Registro de preços de algemas em aço inoxidável com trava dupla',
      codigo: '240120',
      fornecimento: 'unidade',
      quantidade: 120,
      abertura: aberturaAberta,
      encerramento: adicionarDiasUteis(aberturaAberta, 10, ctx.calendario),
      adesoes: [['940002', 60, 'A unidade de Porto Velho prevê a reposição das algemas usadas nas escoltas.']],
    },
  ];
  for (const irp of irps) {
    const id = novoId();
    const criadaEm = new Date(Date.parse(`${irp.abertura}T12:00:00.000Z`));
    await tx.executar(
      `INSERT INTO irps (id, numero, uasg_gerenciadora, processo_id, objeto, codigo_catalogo, unidade_fornecimento, quantidade_gerenciador,
                         abertura, encerramento, dias_uteis, criada_por, criada_em)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id,
        irp.numero,
        irp.uasg,
        irp.objeto,
        irp.codigo,
        irp.fornecimento,
        irp.quantidade,
        irp.abertura,
        irp.encerramento,
        diasUteisEntre(irp.abertura, irp.encerramento, ctx.calendario),
        planejamento,
        new Date(Math.min(criadaEm.getTime(), agora.getTime())).toISOString(),
      ],
    );
    for (const [uasg, quantidade, manifestacao] of irp.adesoes) {
      await tx.executar(
        `INSERT INTO irp_adesoes (id, irp_id, uasg, quantidade, manifestacao, registrada_por, registrada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [novoId(), id, uasg, quantidade, manifestacao, planejamento, new Date(Math.min(criadaEm.getTime() + 86_400_000, agora.getTime())).toISOString()],
      );
    }
  }

  dados.contagens['planosContratacoes'] = PLANOS.length;
  dados.contagens['itensCatalogo'] = catalogo.length;
  dados.contagens['intencoesRegistroPrecos'] = irps.length;
}

/** `n` dias úteis antes de `data` (a contagem para trás que `adicionarDiasUteis` não faz). */
function recuarDiasUteis(data: string, n: number, calendario: ContextoSeed['calendario']): string {
  let atual = data;
  let contados = 0;
  while (contados < n) {
    atual = adicionarDias(atual, -1);
    if (ehDiaUtil(atual, calendario)) contados += 1;
  }
  return atual;
}
