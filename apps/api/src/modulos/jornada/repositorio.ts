import {
  formatarData,
  limiteDispensaVigente,
  mascararNome,
  prazoDivulgacaoContratoPncp,
  verificarSegregacao,
  type OpcoesCalendario,
  type PapelProcesso,
} from '@agora/dominio';
import type {
  Bloqueio,
  DocumentoGerado,
  EtapaJornada,
  OrgaoRequisitante,
  ProcessoDetalhe,
  ProcessoResumo,
  Sancao,
  Sinal,
  TipoSancao,
} from '@agora/contratos';
import type { Executor } from '../../banco/tipos.ts';
import { usuarioResumo } from '../../compartilhado/instrumentos.ts';
import { padraoContem } from '../../compartilhado/texto.ts';
import { avaliarRegularidade, rotuloSancao, sancaoVigente } from '../fornecedores/repositorio.ts';
import { ITENS_PARECER, PAPEIS_PROCESSO, TIPOS_DOCUMENTO } from './constantes.ts';
import {
  analisarCesta,
  regrasEtapa1,
  regrasEtapa2,
  regrasEtapa3,
  regrasEtapa4,
  regrasEtapa5,
  regrasEtapa6,
  regrasEtapa7,
  sinaisDocumentos,
  tipoDispensa,
  valorEstimadoProcesso,
  type ResultadoRegras,
  type SituacaoDfdSei,
  type SocioFornecedor,
} from './regras.ts';
import { geradoComParametrosAnteriores } from './parametros-edital.ts';
import type {
  AnaliseCesta,
  CargaProcesso,
  DisputaArmazenada,
  DocumentoCarregado,
  EntradaArvore,
  LinhaProcesso,
  MembroEquipe,
  ParametrosEdital,
  TipoDocumento,
} from './tipos.ts';

const SELECAO_PROCESSO = `
  SELECT p.id, p.numero_sei, p.titulo, p.orgao, p.uasg, u.nome AS uasg_nome, u.orgao AS uasg_orgao, u.uf AS uasg_uf, p.etapa_atual,
         p.responsavel_id, r.nome AS responsavel_nome, p.modalidade_prevista, p.dfd, p.etp, p.riscos, p.cesta, p.edital,
         p.parecer, p.publicacao, p.disputa, p.contrato_id, c.numero AS contrato_numero,
         c.assinatura_em AS contrato_assinatura_em, c.divulgacao_pncp_em AS contrato_divulgacao_em,
         pj.nome AS parecerista_nome, p.criado_em, p.atualizado_em
    FROM processos p
    JOIN uasgs u ON u.codigo = p.uasg
    LEFT JOIN usuarios r ON r.id = p.responsavel_id
    LEFT JOIN contratos c ON c.id = p.contrato_id
    LEFT JOIN usuarios pj ON pj.id = (p.parecer ->> 'pareceristaId')::uuid`;

/** Processo no escopo de UASG do usuário (`escopo` nulo = todas); `bloquear` trava a linha até o fim da transação. */
export async function obterLinhaProcesso(
  executor: Executor,
  id: string,
  escopo: string[] | null,
  bloquear = false,
): Promise<LinhaProcesso | null> {
  const [linha] = await executor.consultar<LinhaProcesso>(
    `${SELECAO_PROCESSO}
      WHERE p.id = $1 AND ($2::text[] IS NULL OR p.uasg = ANY($2::text[]))${bloquear ? '\n      FOR UPDATE OF p' : ''}`,
    [id, escopo],
  );
  return linha ?? null;
}

export interface FiltroProcessosSql {
  escopo: string[] | null;
  orgao?: OrgaoRequisitante | undefined;
  etapa?: EtapaJornada | undefined;
  busca?: string | undefined;
}

export async function listarLinhasProcessos(
  executor: Executor,
  filtro: FiltroProcessosSql,
  limite: number,
  deslocamento: number,
): Promise<{ linhas: LinhaProcesso[]; total: number }> {
  const condicoes = `
      WHERE ($1::text[] IS NULL OR p.uasg = ANY($1::text[]))
        AND ($2::text IS NULL OR p.orgao = $2)
        AND ($3::integer IS NULL OR p.etapa_atual = $3)
        AND ($4::text IS NULL OR p.busca_normalizada LIKE $4 ESCAPE '\\')`;
  const parametros = [filtro.escopo, filtro.orgao ?? null, filtro.etapa ?? null, filtro.busca ? padraoContem(filtro.busca) : null] as const;
  const linhas = await executor.consultar<LinhaProcesso>(
    `${SELECAO_PROCESSO}${condicoes}
      ORDER BY p.atualizado_em DESC, p.numero_sei
      LIMIT $5 OFFSET $6`,
    [...parametros, limite, deslocamento],
  );
  const [contagem] = await executor.consultar<{ total: number }>(
    `SELECT COUNT(*)::integer AS total FROM processos p${condicoes}`,
    [...parametros],
  );
  return { linhas, total: contagem?.total ?? 0 };
}

export async function carregarEquipe(executor: Executor, processoId: string): Promise<MembroEquipe[]> {
  const linhas = await executor.consultar<{ papel: PapelProcesso; usuario_id: string; nome: string; cpf: string }>(
    `SELECT e.papel, e.usuario_id, u.nome, u.cpf
       FROM processos_equipe e
       JOIN usuarios u ON u.id = e.usuario_id
      WHERE e.processo_id = $1
      ORDER BY u.nome`,
    [processoId],
  );
  return linhas
    .map((l) => ({ papel: l.papel, usuarioId: l.usuario_id, nome: l.nome, cpf: l.cpf }))
    .sort((a, b) => PAPEIS_PROCESSO.indexOf(a.papel) - PAPEIS_PROCESSO.indexOf(b.papel));
}

export async function carregarArvore(executor: Executor, processoId: string): Promise<EntradaArvore[]> {
  const linhas = await executor.consultar<{
    numero: string;
    titulo: string;
    documento_id: string | null;
    incluido_em: string;
    assinado_em: string | null;
    assinado_por: string | null;
  }>(
    `SELECT a.numero, a.titulo, a.documento_id, a.incluido_em, a.assinado_em, u.nome AS assinado_por
       FROM processos_arvore_sei a
       LEFT JOIN usuarios u ON u.id = a.assinado_por
      WHERE a.processo_id = $1
      ORDER BY a.numero`,
    [processoId],
  );
  return linhas.map((l) => ({
    numero: l.numero,
    titulo: l.titulo,
    documentoId: l.documento_id,
    incluidoEm: l.incluido_em,
    assinadoEm: l.assinado_em,
    assinadoPor: l.assinado_por,
  }));
}

interface LinhaDocumento {
  id: string;
  tipo: TipoDocumento;
  titulo: string;
  versao: number;
  conteudo: string;
  gerado_por: 'modelo' | 'ia';
  modelo_ia: string | null;
  falha_ia: string | null;
  premissas: string[];
  fontes: string[];
  situacao: DocumentoGerado['situacao'];
  revisado_por: string | null;
  revisado_por_nome: string | null;
  gerado_em: string;
  numero_sei: string | null;
  hash_parametros: string | null;
}

/**
 * Versão mais recente de cada tipo de documento do processo, com a indicação de TR, edital ou minuta gerados com
 * parâmetros do edital diferentes dos atuais (`edital`).
 */
export async function carregarDocumentos(executor: Executor, processoId: string, edital: ParametrosEdital): Promise<DocumentoCarregado[]> {
  const linhas = await executor.consultar<LinhaDocumento>(
    `SELECT DISTINCT ON (d.tipo)
            d.id, d.tipo, d.titulo, d.versao, d.conteudo, d.gerado_por, d.modelo_ia, d.falha_ia, d.premissas, d.fontes,
            d.situacao, d.revisado_por, r.nome AS revisado_por_nome, d.gerado_em, a.numero AS numero_sei, d.hash_parametros
       FROM documentos_gerados d
       LEFT JOIN usuarios r ON r.id = d.revisado_por
       LEFT JOIN processos_arvore_sei a ON a.documento_id = d.id
      WHERE d.processo_id = $1
      ORDER BY d.tipo, d.versao DESC`,
    [processoId],
  );
  return linhas
    .map(
      (l): DocumentoCarregado => ({
        id: l.id,
        tipo: l.tipo,
        titulo: l.titulo,
        versao: l.versao,
        conteudo: l.conteudo,
        geradoPor: l.gerado_por,
        premissas: l.premissas,
        fontes: l.fontes,
        situacao: l.situacao,
        revisadoPor: usuarioResumo(l.revisado_por, l.revisado_por_nome),
        geradoEm: l.gerado_em,
        numeroSei: l.numero_sei,
        geradoComParametrosAnteriores: geradoComParametrosAnteriores(l.tipo, l.hash_parametros, edital),
        falhaIa: l.falha_ia,
        modeloIa: l.modelo_ia,
      }),
    )
    .sort((a, b) => TIPOS_DOCUMENTO.indexOf(a.tipo) - TIPOS_DOCUMENTO.indexOf(b.tipo));
}

export async function carregarProcesso(executor: Executor, linha: LinhaProcesso): Promise<CargaProcesso> {
  return {
    linha,
    equipe: await carregarEquipe(executor, linha.id),
    arvore: await carregarArvore(executor, linha.id),
    documentos: await carregarDocumentos(executor, linha.id, linha.edital),
  };
}

interface SocioComFornecedor extends SocioFornecedor {
  fornecedorId: string;
  socios: { cpf: string; nome: string }[];
}

/** Quadro societário de fornecedores PJ (dado pessoal: usado só no servidor, para os sinais de vínculo). */
export async function carregarSocios(executor: Executor, fornecedorIds: readonly string[] | null): Promise<SocioComFornecedor[]> {
  const linhas = await executor.consultar<{ id: string; documento: string; razao_social: string; cpf: string; nome: string }>(
    `SELECT f.id, f.documento, f.razao_social, s.cpf, s.nome
       FROM fornecedores f
       JOIN fornecedores_socios s ON s.fornecedor_id = f.id
      WHERE f.tipo_pessoa = 'PJ' AND ($1::uuid[] IS NULL OR f.id = ANY($1::uuid[]))
      ORDER BY f.id, s.cpf`,
    [fornecedorIds === null ? null : [...fornecedorIds]],
  );
  const mapa = new Map<string, SocioComFornecedor>();
  for (const l of linhas) {
    const atual = mapa.get(l.id) ?? { fornecedorId: l.id, cnpj: l.documento, razaoSocial: l.razao_social, cpfsSocios: [], socios: [] };
    atual.cpfsSocios.push(l.cpf);
    atual.socios.push({ cpf: l.cpf, nome: l.nome });
    mapa.set(l.id, atual);
  }
  return [...mapa.values()];
}

/** Sanções impeditivas (impedimento ou inidoneidade) vigentes do fornecedor, em texto. */
export async function sancoesImpeditivasVigentes(executor: Executor, fornecedorId: string, hoje: string): Promise<string[]> {
  const linhas = await executor.consultar<{ tipo: TipoSancao; situacao: Sancao['situacao']; fim_vigencia: string | null }>(
    `SELECT tipo, situacao, fim_vigencia FROM sancoes
      WHERE fornecedor_id = $1 AND tipo IN ('impedimento_licitar', 'declaracao_inidoneidade')
      ORDER BY instaurada_em`,
    [fornecedorId],
  );
  return linhas
    .filter((s) => sancaoVigente(s, hoje))
    .map((s) => `${rotuloSancao(s.tipo)}${s.fim_vigencia ? ` até ${formatarData(s.fim_vigencia)}` : ' sem termo final'} (art. 156)`);
}

/**
 * Sócio em comum entre licitantes (RIA-06): cada sócio de um licitante é confrontado, por `verificarSegregacao`,
 * com o quadro societário dos demais. O nome do sócio sai mascarado (LGPD).
 */
export async function vinculosEntreLicitantes(executor: Executor, disputa: DisputaArmazenada): Promise<string[]> {
  const ids = disputa.licitantes.map((l) => l.fornecedorId);
  if (ids.length < 2) return [];
  const socios = new Map((await carregarSocios(executor, ids)).map((s) => [s.fornecedorId, s]));
  const vinculos: string[] = [];
  disputa.licitantes.forEach((a, i) => {
    const deA = socios.get(a.fornecedorId);
    if (!deA) return;
    for (const b of disputa.licitantes.slice(i + 1)) {
      const deB = socios.get(b.fornecedorId);
      if (!deB) continue;
      const verificacao = verificarSegregacao(
        deA.socios.map((s, indice) => ({ papel: 'requisitante', servidorId: `${a.fornecedorId}:${indice}`, nome: mascararNome(s.nome), cpf: s.cpf })),
        { sociosFornecedores: [{ cnpj: deB.cnpj, razaoSocial: deB.razaoSocial, cpfsSocios: deB.cpfsSocios }] },
      );
      for (const c of verificacao.conflitos.filter((x) => x.tipo === 'vinculo_societario')) {
        vinculos.push(`${a.nome} e ${b.nome} têm sócio em comum (${c.nome}): sinal de possível conluio para análise, não constitui acusação.`);
      }
    }
  });
  return vinculos;
}

/** Valores das demais contratações da mesma UASG, natureza e exercício que cabem no limite de dispensa (RN-14). */
async function valoresMesmaNatureza(executor: Executor, linha: LinhaProcesso, hoje: string): Promise<number[]> {
  const tipo = tipoDispensa(linha.dfd.tipoObjeto);
  const limite = limiteDispensaVigente(hoje, tipo).valor;
  const exercicio = hoje.slice(0, 4);
  const outros = await executor.consultar<Pick<LinhaProcesso, 'dfd' | 'cesta' | 'criado_em'>>(
    'SELECT dfd, cesta, criado_em FROM processos WHERE uasg = $1 AND id <> $2',
    [linha.uasg, linha.id],
  );
  return outros
    .filter((o) => o.criado_em.slice(0, 4) === exercicio && tipoDispensa(o.dfd.tipoObjeto) === tipo)
    .map((o) => valorEstimadoProcesso(o.dfd, analisarCesta(o.cesta, hoje)) ?? 0)
    .filter((valor) => valor > 0 && valor <= limite);
}

export function primeiroClassificado(disputa: DisputaArmazenada): string | null {
  return disputa.resultado?.classificacao[0]?.id ?? null;
}

function situacaoDfdSei(carga: CargaProcesso): SituacaoDfdSei {
  const dfd = carga.documentos.find((d) => d.tipo === 'dfd');
  if (!dfd) return 'sem_documento';
  if (dfd.situacao !== 'aprovado') return 'nao_aprovado';
  const entrada = carga.arvore.find((a) => a.documentoId === dfd.id);
  if (!entrada) return 'nao_aprovado';
  return entrada.assinadoEm === null ? 'nao_assinado' : 'assinado';
}

export interface AvaliacaoProcesso extends ResultadoRegras {
  analise: AnaliseCesta | null;
  valorEstimado: number | null;
}

/** Bloqueios e sinais da etapa atual, a partir das regras de @agora/dominio. */
export async function avaliarProcesso(
  executor: Executor,
  carga: CargaProcesso,
  hoje: string,
  calendario: OpcoesCalendario,
  agora: Date,
): Promise<AvaliacaoProcesso> {
  const { linha } = carga;
  const analise = analisarCesta(linha.cesta, hoje);
  const valorEstimado = valorEstimadoProcesso(linha.dfd, analise);
  let resultado: ResultadoRegras;
  switch (linha.etapa_atual) {
    case 1:
      resultado = regrasEtapa1({ dfd: linha.dfd, valorEstimado, outrasContratacoes: await valoresMesmaNatureza(executor, linha, hoje), hoje });
      break;
    case 2:
      resultado = regrasEtapa2({
        equipe: carga.equipe,
        socios: carga.equipe.length > 0 ? await carregarSocios(executor, null) : [],
        dfdSei: situacaoDfdSei(carga),
      });
      break;
    case 3:
      resultado = regrasEtapa3({ etp: linha.etp, riscos: linha.riscos, cesta: linha.cesta, analise });
      break;
    case 4:
      resultado = regrasEtapa4({ documentos: carga.documentos, edital: linha.edital });
      break;
    case 5:
      resultado = regrasEtapa5({ parecer: linha.parecer, publicacao: linha.publicacao, hoje });
      break;
    case 6: {
      const vencedor = primeiroClassificado(linha.disputa);
      resultado = regrasEtapa6({
        disputa: linha.disputa,
        sancoesVencedor: vencedor ? await sancoesImpeditivasVigentes(executor, vencedor, hoje) : [],
        vinculosLicitantes: await vinculosEntreLicitantes(executor, linha.disputa),
      });
      break;
    }
    case 7: {
      const vencedor = primeiroClassificado(linha.disputa);
      const contrato =
        linha.contrato_numero !== null && linha.contrato_assinatura_em !== null
          ? {
              numero: linha.contrato_numero,
              limiteDivulgacao: prazoDivulgacaoContratoPncp(linha.contrato_assinatura_em, 'licitacao', calendario).limite,
              divulgadoEm: linha.contrato_divulgacao_em,
            }
          : null;
      resultado = regrasEtapa7({
        temVencedor: vencedor !== null,
        contratoGerado: contrato,
        regularidadeVencedor: vencedor && !contrato ? await avaliarRegularidade(executor, vencedor, hoje, agora) : null,
      });
      break;
    }
  }
  return { bloqueios: resultado.bloqueios, sinais: [...resultado.sinais, ...sinaisDocumentos(carga.documentos)], analise, valorEstimado };
}

export function montarResumo(linha: LinhaProcesso, bloqueios: readonly Bloqueio[], valorEstimado: number | null): ProcessoResumo {
  return {
    id: linha.id,
    numeroSei: linha.numero_sei,
    titulo: linha.titulo,
    orgao: linha.orgao,
    etapaAtual: linha.etapa_atual,
    valorEstimado,
    modalidadePrevista: linha.modalidade_prevista,
    bloqueios: bloqueios.length,
    atualizadoEm: linha.atualizado_em,
    responsavel: usuarioResumo(linha.responsavel_id, linha.responsavel_nome),
  };
}

function paraDocumentoGerado(d: DocumentoCarregado): DocumentoGerado {
  return {
    id: d.id,
    tipo: d.tipo,
    titulo: d.titulo,
    versao: d.versao,
    conteudo: d.conteudo,
    geradoPor: d.geradoPor,
    premissas: d.premissas,
    fontes: d.fontes,
    situacao: d.situacao,
    revisadoPor: d.revisadoPor,
    geradoEm: d.geradoEm,
    numeroSei: d.numeroSei,
    geradoComParametrosAnteriores: d.geradoComParametrosAnteriores,
  };
}

export function montarDetalhe(carga: CargaProcesso, avaliacao: AvaliacaoProcesso): ProcessoDetalhe {
  const { linha } = carga;
  const sinais: Sinal[] = avaliacao.sinais;
  return {
    ...montarResumo(linha, avaliacao.bloqueios, avaliacao.valorEstimado),
    dfd: linha.dfd,
    equipe: carga.equipe.map((m) => ({ papel: m.papel, usuario: { id: m.usuarioId, nome: m.nome } })),
    arvoreSei: carga.arvore.map((a) => ({
      numero: a.numero,
      titulo: a.titulo,
      assinado: a.assinadoEm !== null,
      assinadoPor: a.assinadoPor,
      assinadoEm: a.assinadoEm,
    })),
    parametrosEdital: linha.edital,
    etp: linha.etp,
    riscos: linha.riscos,
    cestaPrecos: {
      cotacoes: linha.cesta.cotacoes,
      orcamentoSigiloso: linha.cesta.orcamentoSigiloso,
      motivoSigilo: linha.cesta.motivoSigilo,
      analise: avaliacao.analise,
    },
    documentos: carga.documentos.map(paraDocumentoGerado),
    parecer: {
      itens: ITENS_PARECER.map((item) => {
        const registrado = linha.parecer.itens.find((i) => i.id === item.id);
        return { id: item.id, texto: item.texto, atendido: registrado?.atendido ?? null, observacao: registrado?.observacao ?? null };
      }),
      conclusao: linha.parecer.conclusao,
      parecerista: usuarioResumo(linha.parecer.pareceristaId, linha.parecerista_nome),
    },
    publicacao: linha.publicacao,
    disputa: {
      licitantes: linha.disputa.licitantes.map((l) => ({
        id: l.fornecedorId,
        nome: l.nome,
        valorProposta: l.valorProposta,
        meEpp: l.meEpp,
        notaDesempenhoPrevio: l.notaDesempenhoPrevio ?? null,
        lanceDisputaFinal: l.lanceDisputaFinal ?? null,
        acoesEquidadeGenero: l.acoesEquidadeGenero ?? null,
        programaIntegridade: l.programaIntegridade ?? null,
        empresaBrasileira: l.empresaBrasileira ?? null,
        investePesquisaDesenvolvimentoNoPais: l.investePesquisaDesenvolvimentoNoPais ?? null,
        praticaMitigacaoClimatica: l.praticaMitigacaoClimatica ?? null,
      })),
      resultado: linha.disputa.resultado,
    },
    contratoGerado: linha.contrato_id !== null && linha.contrato_numero !== null ? { id: linha.contrato_id, numero: linha.contrato_numero } : null,
    bloqueiosDetalhe: avaliacao.bloqueios,
    sinais,
  };
}

/** Carrega, avalia e monta o detalhe do processo (null fora do escopo). */
export async function obterProcessoDetalhe(
  executor: Executor,
  id: string,
  escopo: string[] | null,
  hoje: string,
  calendario: OpcoesCalendario,
  agora: Date,
): Promise<ProcessoDetalhe | null> {
  const linha = await obterLinhaProcesso(executor, id, escopo);
  if (!linha) return null;
  const carga = await carregarProcesso(executor, linha);
  return montarDetalhe(carga, await avaliarProcesso(executor, carga, hoje, calendario, agora));
}
