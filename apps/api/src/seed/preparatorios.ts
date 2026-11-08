/**
 * Carga sintética da frente P (RN-39): os processos que já passaram da etapa 3 recebem a dotação orçamentária
 * estruturada e a declaração de adequação orçamentária aprovada e assinada pela autoridade competente designada,
 * registradas ao entrar na etapa 4. Os códigos de programa de trabalho, ação, fonte e pré-empenho são fictícios.
 * Roda depois das demais etapas e preserva a data de atualização de cada processo.
 */
import { hojeISO, type LinhaDotacao } from '@agora/dominio';
import { criarProvedorIa } from '../ia/provedor.ts';
import { carregarProcesso, obterLinhaProcesso } from '../modulos/jornada/repositorio.ts';
import { analisarCesta, valorEstimadoProcesso } from '../modulos/jornada/regras.ts';
import { aprovarDocumento, assinarNaArvore, inserirDocumento, obterDocumentoParaAprovar, prepararDocumento } from '../modulos/jornada/servico.ts';
import type { LinhaProcesso } from '../modulos/jornada/tipos.ts';
import { gravarDotacao, hashDotacao } from '../modulos/preparatorios/dotacao.ts';
import type { ContextoSeed } from './contexto.ts';

/** Subfunção sintética por órgão (função 06 — segurança pública). */
const SUBFUNCAO: Record<LinhaProcesso['orgao'], string> = { PF: '181', PRF: '181', SENASP: '181', SENAPPEN: '421', MJSP: '122' };

function dotacaoSintetica(linha: LinhaProcesso, indice: number, exercicio: number, valor: number): LinhaDotacao[] {
  const sequencia = String(indice + 1).padStart(2, '0');
  return [
    {
      unidadeGestora: linha.uasg,
      programaTrabalho: `06.${SUBFUNCAO[linha.orgao]}.9${sequencia}0.AG${sequencia}.0001`,
      naturezaDespesa: linha.dfd.tipoObjeto === 'bens' ? '4.4.90.52' : '3.3.90.39',
      fonteRecursos: '1001000000',
      exercicio,
      valor,
      preEmpenho: `${exercicio}PE${String(4100 + indice).padStart(6, '0')}`,
    },
  ];
}

export async function gerarPreparatorios(ctx: ContextoSeed): Promise<void> {
  const { tx, prng, agora, eventos, calendario } = ctx;
  const provedor = criarProvedorIa({ provedor: 'nenhum', url: null, modelo: null, chave: null }, (entrada, init) => fetch(entrada, init));
  const processos = await tx.consultar<{ id: string; atualizado_em: string }>('SELECT id, atualizado_em FROM processos WHERE etapa_atual >= 4 ORDER BY numero_sei');
  const carga = { carga: 'demonstracao' };
  let declaradas = 0;

  for (const [indice, { id, atualizado_em: atualizadoEm }] of processos.entries()) {
    const linha = await obterLinhaProcesso(tx, id, null);
    if (!linha) throw new Error('Processo sintético não encontrado');
    const [autoridade] = await tx.consultar<{ id: string; nome: string }>(
      `SELECT u.id, u.nome FROM processos_equipe e JOIN usuarios u ON u.id = e.usuario_id WHERE e.processo_id = $1 AND e.papel = 'autoridade_competente'`,
      [id],
    );
    const entradaEtapa4 = eventos.find((e) => e.recursoId === id && e.acao === 'processo.avancar' && (e.dados as { para?: number } | undefined)?.para === 4);
    if (!autoridade || !entradaEtapa4) continue;
    const registro = new Date(Math.min(entradaEtapa4.ocorridoEm.getTime() + 2 * 3_600_000, agora.getTime() - 5 * 60_000));
    const dia = hojeISO(registro);
    const valorEstimado = valorEstimadoProcesso(linha.dfd, analisarCesta(linha.cesta, dia));
    if (valorEstimado === null) continue;
    const linhas = dotacaoSintetica(linha, indice, Number(dia.slice(0, 4)), valorEstimado);
    const responsavel = linha.responsavel_id;

    await gravarDotacao(tx, id, linhas, { usuarioId: responsavel, agora: registro, novoId: () => prng.uuid() });
    eventos.push({
      ocorridoEm: registro,
      usuarioId: responsavel,
      acao: 'processo.dotacao.atualizar',
      recurso: 'processo',
      recursoId: id,
      resumo: `Atualizou a dotação orçamentária do processo (${linhas.length} crédito(s))`,
      dados: { ...carga, numeroSei: linha.numero_sei, etapa: 4, linhas: linhas.length, total: valorEstimado, hashDotacao: hashDotacao(linhas) },
    });

    const geracao = new Date(registro.getTime() + 10 * 60_000);
    const preparado = await prepararDocumento(await carregarProcesso(tx, linha), 'declaracao_orcamentaria', provedor, { hoje: dia, agora: geracao, calendario });
    const doc = await inserirDocumento(tx, id, preparado, { id: prng.uuid(), geradoEm: geracao.toISOString(), usuarioId: responsavel });
    eventos.push({
      ocorridoEm: geracao,
      usuarioId: responsavel,
      acao: 'processo.documento.gerar',
      recurso: 'processo',
      recursoId: id,
      resumo: `Gerou o rascunho de "${preparado.titulo}" (versão ${doc.versao})`,
      dados: { ...carga, numeroSei: linha.numero_sei, documentoId: doc.id, tipo: 'declaracao_orcamentaria', versao: doc.versao, geradoPor: 'modelo', hashConteudo: doc.hash },
    });

    const aprovacao = new Date(Math.min(geracao.getTime() + 50 * 60_000, agora.getTime() - 60_000));
    const paraAprovar = await obterDocumentoParaAprovar(tx, id, doc.id);
    if (!paraAprovar) throw new Error('Declaração recém-gerada não encontrada');
    const aprovado = await aprovarDocumento(tx, id, paraAprovar, autoridade, aprovacao, dia, prng.uuid());
    await assinarNaArvore(tx, id, aprovado.numeroSei, autoridade.id, aprovacao);
    eventos.push(
      {
        ocorridoEm: aprovacao,
        usuarioId: autoridade.id,
        acao: 'processo.documento.aprovar',
        recurso: 'processo',
        recursoId: id,
        resumo: `Aprovou "${preparado.titulo}" (versão ${doc.versao}) e o incluiu na árvore SEI sob o nº ${aprovado.numeroSei}`,
        dados: { ...carga, numeroSei: linha.numero_sei, documentoId: doc.id, tipo: 'declaracao_orcamentaria', versao: doc.versao, numeroSeiDocumento: aprovado.numeroSei, hashConteudo: aprovado.hash },
      },
      {
        ocorridoEm: aprovacao,
        usuarioId: autoridade.id,
        acao: 'processo.sei.assinar',
        recurso: 'processo',
        recursoId: id,
        resumo: `Assinou (simulação) o documento SEI nº ${aprovado.numeroSei} — ${preparado.titulo} — versão ${doc.versao}`,
        dados: { ...carga, numeroSei: linha.numero_sei, documentoNumero: aprovado.numeroSei, tipo: 'declaracao_orcamentaria', simulacao: true },
      },
    );
    // As escritas acima atualizam `atualizado_em`; a ordem da lista de processos continua a da carga da jornada.
    await tx.executar('UPDATE processos SET atualizado_em = $2 WHERE id = $1', [id, atualizadoEm]);
    declaradas += 1;
  }
  ctx.dados.contagens.dotacoesDeclaradas = declaradas;
}
