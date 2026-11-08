/**
 * SEI (RF-35) e DOU (RF-36) na demonstração, com dados sintéticos e em modo offline:
 *   * os editais já publicados no PNCP ganham o aviso de licitação para o DOU, enviado pelo INCom (protocolo
 *     sintético) e conferido na edição simulada do dia útil seguinte, com o registro em jornal;
 *   * um contrato recente ganha o extrato enviado ao DOU, aguardando a conferência, e um termo aditivo, o rascunho;
 *   * o processo mais adiantado da jornada aparece enviado ao SEI simulado, com o bloco de assinatura e as
 *     assinaturas já refletidas dos documentos assinados na árvore.
 * Nenhuma chamada externa é feita. Semente própria: não consome a sequência do gerador compartilhado.
 */
import { adicionarDias, montarMateriaDou } from '@agora/dominio';
import { sha256Hex } from '../compartilhado/cripto.ts';
import { gerarPdfTexto } from '../compartilhado/pdf-texto.ts';
import { obterMateria } from '../modulos/dou/repositorio.ts';
import { atoDaMateria, gravarMateria, registrarEnvioDou, registrarPublicacaoDou, type AlvoMateria } from '../modulos/dou/servico.ts';
import { edicaoSimulada } from '../modulos/dou/tarefas.ts';
import { gravarBlocoSei, gravarDocumentoSei, gravarProcessoSei, listarEntradasSei } from '../modulos/sei/repositorio.ts';
import type { ContextoSeed } from './contexto.ts';
import { Prng } from './prng.ts';

const SEMENTE_SEI_DOU = 14_133_029;
const HORA = 60 * 60 * 1000;
const FECHAMENTO_INCOM = 19;

async function usuarioPorEmail(ctx: ContextoSeed, email: string): Promise<string | null> {
  const [linha] = await ctx.tx.consultar<{ id: string }>('SELECT id FROM usuarios WHERE email = $1', [email]);
  return linha?.id ?? null;
}

/** 10h de Brasília do dia, nunca depois de agora. */
function manhaDe(data: string, agora: Date, minutos: number): Date {
  return new Date(Math.min(Date.parse(`${data}T13:00:00.000Z`) + minutos * 60_000, agora.getTime() - 10 * 60_000));
}

async function materiaEnviada(
  ctx: ContextoSeed,
  prng: Prng,
  alvo: AlvoMateria,
  geradaEm: Date,
  autorId: string | null,
): Promise<{ id: string; prevista: string } | null> {
  const ato = await atoDaMateria(ctx.tx, alvo, null);
  const montada = montarMateriaDou(ato.dados);
  const { id } = await gravarMateria(ctx.tx, ato, montada, { usuarioId: alvo.tipo === 'aviso_licitacao' ? null : autorId, automatica: alvo.tipo === 'aviso_licitacao' }, geradaEm);
  const enviadaEm = new Date(Math.min(geradaEm.getTime() + 2 * HORA, ctx.agora.getTime() - 5 * 60_000));
  const materia = await obterMateria(ctx.tx, id, true);
  if (!materia) return null;
  const protocolo = `INCOM-${enviadaEm.toISOString().slice(0, 4)}-${prng.digitos(8)}`;
  const prevista = await registrarEnvioDou(ctx.tx, materia, { protocolo, enviadaEm, usuarioId: autorId }, { ...ctx.calendario, horaFechamento: FECHAMENTO_INCOM }, enviadaEm);
  ctx.eventos.push(
    {
      ocorridoEm: geradaEm,
      usuarioId: autorId,
      acao: alvo.tipo === 'aviso_licitacao' ? 'dou.aviso.gerar' : 'dou.materia.gerar',
      recurso: 'dou_materia',
      recursoId: id,
      resumo: `Gerou ${montada.titulo.toLowerCase()} para o DOU (${montada.identificacao}, processo ${ato.processoNumero}), a enviar pelo INCom`,
      dados: { tipo: alvo.tipo, processo: ato.processoNumero, obrigatoria: montada.obrigatoria, fundamento: montada.fundamento },
    },
    {
      ocorridoEm: enviadaEm,
      usuarioId: autorId,
      acao: 'dou.materia.enviar',
      recurso: 'dou_materia',
      recursoId: id,
      resumo: `Registrou o envio pelo INCom (protocolo ${protocolo}); edição prevista: ${prevista.split('-').reverse().join('/')}`,
      dados: { tipo: alvo.tipo, processo: ato.processoNumero, protocoloIncom: protocolo, dataPrevista: prevista },
    },
  );
  return { id, prevista };
}

async function gerarDou(ctx: ContextoSeed, prng: Prng): Promise<number> {
  const agenteId = await usuarioPorEmail(ctx, 'agente@agora.demo');
  const gestorId = await usuarioPorEmail(ctx, 'gestor@agora.demo');
  let materias = 0;

  const publicados = await ctx.tx.consultar<{ id: string; numero_sei: string; publicado_em: string }>(
    `SELECT id, numero_sei, publicacao->>'publicadoEm' AS publicado_em FROM processos
      WHERE publicacao->>'pncp' = 'publicado' AND publicacao->>'publicadoEm' IS NOT NULL ORDER BY numero_sei`,
  );
  for (const p of publicados) {
    const enviada = await materiaEnviada(ctx, prng, { tipo: 'aviso_licitacao', processoId: p.id }, manhaDe(p.publicado_em, ctx.agora, prng.inteiro(5, 60)), agenteId);
    if (!enviada) continue;
    materias += 1;
    if (enviada.prevista > ctx.hoje) continue;
    const materia = await obterMateria(ctx.tx, enviada.id, true);
    if (!materia) continue;
    const edicao = edicaoSimulada(materia, enviada.prevista);
    const conferidaEm = manhaDe(enviada.prevista, ctx.agora, prng.inteiro(30, 120));
    await registrarPublicacaoDou(ctx.tx, materia, { data: enviada.prevista, edicao: edicao.edicao, pagina: edicao.pagina, url: null, forma: 'consulta', modo: 'offline' }, conferidaEm);
    await ctx.tx.executar(
      `UPDATE dou_materias SET conferencias = 1, ultima_conferencia_em = $2, ultima_conferencia_resultado = $3,
              jornal_nome = 'Jornal Diário de Grande Circulação (demonstração)', jornal_publicado_em = $4, jornal_registrado_em = $2
        WHERE id = $1`,
      [enviada.id, conferidaEm.toISOString(), `Publicada no DOU, Seção 3, edição ${edicao.edicao ?? '—'}, página ${edicao.pagina ?? '—'} (simulação).`, enviada.prevista],
    );
    ctx.eventos.push({
      ocorridoEm: conferidaEm,
      usuarioId: agenteId,
      acao: 'dou.conferir',
      recurso: 'dou_materia',
      recursoId: enviada.id,
      resumo: `Conferiu no DOU o aviso de licitação do processo ${p.numero_sei}: publicado na edição simulada de ${enviada.prevista.split('-').reverse().join('/')}`,
      dados: { tipo: 'aviso_licitacao', processo: p.numero_sei, modo: 'offline', publicada: true, data: enviada.prevista },
    });
  }

  // Extrato do contrato mais recente (enviado ontem, aguardando a conferência) e o rascunho do extrato de um aditivo.
  const [contrato] = await ctx.tx.consultar<{ id: string }>('SELECT id FROM contratos ORDER BY assinatura_em DESC, numero LIMIT 1');
  if (contrato) {
    const geradaEm = manhaDe(adicionarDias(ctx.hoje, -1), ctx.agora, prng.inteiro(0, 90));
    if (await materiaEnviada(ctx, prng, { tipo: 'extrato_contrato', contratoId: contrato.id }, geradaEm, gestorId)) materias += 1;
  }
  const [aditivo] = await ctx.tx.consultar<{ id: string; contrato_id: string }>('SELECT id, contrato_id FROM aditivos ORDER BY assinado_em DESC, id LIMIT 1');
  if (aditivo) {
    const ato = await atoDaMateria(ctx.tx, { tipo: 'extrato_aditivo', contratoId: aditivo.contrato_id, aditivoId: aditivo.id }, null);
    const geradaEm = manhaDe(ctx.hoje, ctx.agora, prng.inteiro(0, 60));
    const { id } = await gravarMateria(ctx.tx, ato, montarMateriaDou(ato.dados), { usuarioId: gestorId, automatica: false }, geradaEm);
    ctx.eventos.push({
      ocorridoEm: geradaEm,
      usuarioId: gestorId,
      acao: 'dou.materia.gerar',
      recurso: 'dou_materia',
      recursoId: id,
      resumo: `Gerou o extrato de termo aditivo para o DOU (processo ${ato.processoNumero}), a enviar pelo INCom`,
      dados: { tipo: 'extrato_aditivo', processo: ato.processoNumero },
    });
    materias += 1;
  }
  return materias;
}

async function gerarSei(ctx: ContextoSeed, prng: Prng): Promise<number> {
  const [processo] = await ctx.tx.consultar<{ id: string; numero_sei: string; criado_em: string }>(
    `SELECT p.id, p.numero_sei, p.criado_em FROM processos p
      WHERE (SELECT count(*) FROM processos_arvore_sei a WHERE a.processo_id = p.id AND a.documento_id IS NOT NULL) >= 2
      ORDER BY p.etapa_atual DESC, p.numero_sei LIMIT 1`,
  );
  if (!processo) return 0;
  const entradas = (await listarEntradasSei(ctx.tx, processo.id, true)).filter((e) => e.documento_id !== null && e.conteudo !== null);
  const primeira = entradas.reduce((menor, e) => (e.assinado_em && e.assinado_em < menor ? e.assinado_em : menor), ctx.agora.toISOString());
  const geradoEm = new Date(Math.max(Date.parse(processo.criado_em), Date.parse(primeira) - 2 * HORA));
  const identificador = (semente: string) => String(Number.parseInt(sha256Hex(semente).slice(0, 12), 16)).padStart(13, '0').slice(-13);
  await gravarProcessoSei(ctx.tx, { processoId: processo.id, idProcedimento: identificador(`procedimento|${processo.id}`), protocolo: processo.numero_sei, link: null, modo: 'offline', tarefaId: null }, geradoEm);
  for (const e of entradas) {
    const titulo = `${e.titulo} — processo ${processo.numero_sei}`;
    const pdf = gerarPdfTexto({ titulo, rodape: titulo, conteudo: e.conteudo ?? '' });
    await gravarDocumentoSei(
      ctx.tx,
      { arvoreId: e.arvore_id, processoId: processo.id, idDocumento: identificador(`documento|${processo.id}|${e.numero}`), documentoFormatado: e.numero, link: null, modo: 'offline', hashArquivo: sha256Hex(pdf), nivelAcesso: null, tarefaId: null },
      geradoEm,
    );
    if (e.assinado_em && e.assinado_nome) {
      await ctx.tx.executar('UPDATE sei_documentos SET assinaturas = $2::jsonb, consultado_em = $3 WHERE arvore_id = $1', [
        e.arvore_id,
        JSON.stringify([{ nome: e.assinado_nome, cargoFuncao: null, assinadoEm: e.assinado_em }]),
        new Date(Math.min(Date.parse(e.assinado_em) + HORA, ctx.agora.getTime())).toISOString(),
      ]);
    }
  }
  await gravarBlocoSei(
    ctx.tx,
    entradas.map((e) => e.arvore_id),
    String(100_000 + prng.inteiro(0, 899_999)),
  );
  ctx.eventos.push({
    ocorridoEm: geradoEm,
    usuarioId: null,
    acao: 'sei.enviar',
    recurso: 'processo',
    recursoId: processo.id,
    resumo: `Integração com o SEI (simulação): gerou o processo ${processo.numero_sei} no SEI; incluiu ${entradas.length} documento(s); montou o bloco de assinatura`,
    dados: { numeroSei: processo.numero_sei, processoSei: processo.numero_sei, modo: 'offline', documentos: entradas.map((e) => e.numero) },
  });
  return entradas.length;
}

export async function gerarSeiDou(ctx: ContextoSeed): Promise<void> {
  const prng = new Prng(SEMENTE_SEI_DOU);
  ctx.dados.contagens['materiasDou'] = await gerarDou(ctx, prng);
  ctx.dados.contagens['documentosSei'] = await gerarSei(ctx, prng);
}
