/**
 * Intenção de registro de preços (F5, RN-38): leitura com a situação do dia (`situacaoIrp`) e a soma das quantidades.
 * As escritas (abrir, aderir e consolidar) ficam nas rotas, em transação e com evento na trilha.
 */
import { situacaoIrp } from '@agora/dominio';
import type { AdesaoIrp, IntencaoRegistroPrecos } from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';

export const FUNDAMENTO_IRP = 'Lei 14.133/2021, art. 86; Decreto 11.462/2023, art. 9º';

export interface LinhaIrp {
  id: string;
  numero: string;
  uasg_gerenciadora: string;
  uasg_nome: string;
  processo_id: string | null;
  processo_numero: string | null;
  objeto: string;
  codigo_catalogo: string | null;
  unidade_fornecimento: string;
  quantidade_gerenciador: number;
  abertura: string;
  encerramento: string;
  dias_uteis: number;
  consolidacao: { quantidadeTotal: number; participantes: { uasg: string; papel: 'gerenciador' | 'participante'; quantidade: number; percentual: number }[] } | null;
  consolidada_por: string | null;
  consolidada_por_nome: string | null;
  consolidada_em: string | null;
  criada_por: string | null;
  criada_por_nome: string | null;
  criada_em: string;
}

const SELECAO_IRP = `
  SELECT r.id, r.numero, r.uasg_gerenciadora, u.nome AS uasg_nome, r.processo_id, p.numero_sei AS processo_numero, r.objeto,
         r.codigo_catalogo, r.unidade_fornecimento, r.quantidade_gerenciador, r.abertura, r.encerramento, r.dias_uteis, r.consolidacao,
         r.consolidada_por, uc.nome AS consolidada_por_nome, r.consolidada_em, r.criada_por, ucr.nome AS criada_por_nome, r.criada_em
    FROM irps r
    JOIN uasgs u ON u.codigo = r.uasg_gerenciadora
    LEFT JOIN processos p ON p.id = r.processo_id
    LEFT JOIN usuarios uc ON uc.id = r.consolidada_por
    LEFT JOIN usuarios ucr ON ucr.id = r.criada_por`;

interface LinhaAdesao {
  id: string;
  irp_id: string;
  uasg: string;
  uasg_nome: string;
  quantidade: number;
  manifestacao: string;
  registrada_por: string | null;
  registrada_por_nome: string | null;
  registrada_em: string;
}

async function adesoesDe(executor: Executor, ids: readonly string[]): Promise<Map<string, AdesaoIrp[]>> {
  const mapa = new Map<string, AdesaoIrp[]>();
  if (ids.length === 0) return mapa;
  const linhas = await executor.consultar<LinhaAdesao>(
    `SELECT a.id, a.irp_id, a.uasg, u.nome AS uasg_nome, a.quantidade, a.manifestacao, a.registrada_por, us.nome AS registrada_por_nome, a.registrada_em
       FROM irp_adesoes a
       JOIN uasgs u ON u.codigo = a.uasg
       LEFT JOIN usuarios us ON us.id = a.registrada_por
      WHERE a.irp_id = ANY($1::uuid[])
      ORDER BY a.registrada_em, a.uasg`,
    [[...ids]],
  );
  for (const l of linhas) {
    mapa.set(l.irp_id, [
      ...(mapa.get(l.irp_id) ?? []),
      {
        id: l.id,
        uasg: l.uasg,
        uasgNome: l.uasg_nome,
        quantidade: l.quantidade,
        manifestacao: l.manifestacao,
        registradaPor: usuarioResumo(l.registrada_por, l.registrada_por_nome),
        registradaEm: l.registrada_em,
      },
    ]);
  }
  return mapa;
}

function montar(l: LinhaIrp, adesoes: AdesaoIrp[], hoje: string): IntencaoRegistroPrecos {
  return {
    id: l.id,
    numero: l.numero,
    uasgGerenciadora: l.uasg_gerenciadora,
    uasgGerenciadoraNome: l.uasg_nome,
    processo: l.processo_id && l.processo_numero ? { id: l.processo_id, numeroSei: l.processo_numero } : null,
    objeto: l.objeto,
    codigoCatalogo: l.codigo_catalogo,
    unidadeFornecimento: l.unidade_fornecimento,
    quantidadeGerenciador: l.quantidade_gerenciador,
    abertura: l.abertura,
    encerramento: l.encerramento,
    diasUteis: l.dias_uteis,
    situacao: situacaoIrp({ abertura: l.abertura, encerramento: l.encerramento, consolidada: l.consolidada_em !== null }, hoje),
    adesoes,
    quantidadeTotal: l.quantidade_gerenciador + adesoes.reduce((s, a) => s + a.quantidade, 0),
    consolidacao:
      l.consolidacao && l.consolidada_em
        ? { ...l.consolidacao, consolidadaEm: l.consolidada_em, consolidadaPor: usuarioResumo(l.consolidada_por, l.consolidada_por_nome) }
        : null,
    criadaPor: usuarioResumo(l.criada_por, l.criada_por_nome),
    criadaEm: l.criada_em,
    fundamento: FUNDAMENTO_IRP,
  };
}

/** IRPs visíveis a quem tem `pca:ler`: a intenção é um procedimento público, aberto a todas as unidades. */
export async function listarIrps(executor: Executor, hoje: string): Promise<IntencaoRegistroPrecos[]> {
  const linhas = await executor.consultar<LinhaIrp>(`${SELECAO_IRP} ORDER BY r.abertura DESC, r.numero DESC`);
  const adesoes = await adesoesDe(executor, linhas.map((l) => l.id));
  return linhas.map((l) => montar(l, adesoes.get(l.id) ?? [], hoje));
}

export async function obterLinhaIrp(executor: Executor, id: string, bloquear = false): Promise<LinhaIrp | null> {
  if (bloquear) {
    const [travada] = await executor.consultar<{ id: string }>('SELECT id FROM irps WHERE id = $1 FOR UPDATE', [id]);
    if (!travada) return null;
  }
  const [linha] = await executor.consultar<LinhaIrp>(`${SELECAO_IRP} WHERE r.id = $1`, [id]);
  return linha ?? null;
}

export async function obterIrp(executor: Executor, id: string, hoje: string): Promise<IntencaoRegistroPrecos | null> {
  const linha = await obterLinhaIrp(executor, id);
  if (!linha) return null;
  const adesoes = await adesoesDe(executor, [id]);
  return montar(linha, adesoes.get(id) ?? [], hoje);
}

export async function adesoesDaIrp(executor: Executor, id: string): Promise<AdesaoIrp[]> {
  return (await adesoesDe(executor, [id])).get(id) ?? [];
}

/** Próximo número da IRP no ano: `NNN/AAAA`. */
export async function proximoNumeroIrp(executor: Executor, ano: string): Promise<string> {
  const [linha] = await executor.consultar<{ total: number }>("SELECT COUNT(*)::integer AS total FROM irps WHERE numero LIKE '%/' || $1", [ano]);
  return `${String((linha?.total ?? 0) + 1).padStart(3, '0')}/${ano}`;
}
