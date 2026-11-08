/**
 * Carga sintética da gestão compartilhada com a sociedade (RF-37): a conta da cidadã de demonstração (perfil sem
 * acesso interno) e a do fiscal de obras, uma manifestação já publicada e respondida, outra aguardando moderação e
 * um relatório final num contrato encerrado. PRNG próprio, para não deslocar as etapas anteriores. Sem arquivos:
 * fotos e vídeos são enviados na hora (por exemplo, pelo e2e).
 */
import { adicionarDias, prazoRespostaManifestacao, validarManifestacao, validarResposta, type DataISO } from '@agora/dominio';
import { sha256Hex } from '../compartilhado/cripto.ts';
import { normalizarBusca } from '../compartilhado/texto.ts';
import { instanteEm, type ContextoSeed, type EventoSeed } from './contexto.ts';
import { gerarCpf } from './documentos.ts';
import { Prng } from './prng.ts';
import { USUARIOS_DEMONSTRACAO_ADICIONAIS } from './usuarios-demonstracao.ts';

const SEMENTE_SOCIEDADE = 14_133_174;
const CONTAS_DESTA_ETAPA = new Set(['cidadao@agora.demo', 'fiscal.obras@agora.demo']);

const MANIFESTACAO_PUBLICADA =
  'Moro perto da unidade atendida por este contrato e notei que a entrega prevista para o mês passado ainda não chegou. Há previsão de quando o material será entregue?';
const RESPOSTA_GESTOR =
  'Agradecemos o relato. A entrega foi reprogramada por atraso do fornecedor, que já foi notificado; a nova data consta do cronograma do contrato e a fiscalização acompanha o cumprimento.';
const MANIFESTACAO_PENDENTE =
  'Gostaria de saber se o serviço contratado inclui manutenção aos fins de semana, porque o equipamento ficou parado no último sábado.';
const OBJETIVOS =
  'A contratação teve por objetivo suprir as unidades com o objeto contratado durante a vigência, sem interrupção do atendimento, com entregas parceladas conforme a demanda registrada no estudo técnico preliminar.';
const RESULTADOS =
  'As entregas foram feitas nas unidades previstas, com atesto da fiscalização em todas as parcelas. Não houve interrupção do atendimento; os atrasos pontuais foram tratados com notificação ao fornecedor e registrados no processo.';

export async function gerarSociedade(ctx: ContextoSeed): Promise<void> {
  const { tx, hoje, agora, dados } = ctx;
  const prng = new Prng(SEMENTE_SOCIEDADE);
  const eventos: EventoSeed[] = [];
  const carga = { carga: 'demonstracao' };

  // ───────── contas: cidadã (sem acesso interno) e fiscal de obras ─────────
  let cidadaId: string | null = null;
  for (const u of USUARIOS_DEMONSTRACAO_ADICIONAIS.filter((x) => CONTAS_DESTA_ETAPA.has(x.email))) {
    const id = prng.uuid();
    const uasgs = u.escopo === 'todas' ? 'todas' : dados.uasgs.slice(0, u.escopo);
    await tx.executar(
      `INSERT INTO usuarios (id, nome, email, cpf, senha_hash, ativo, unidade_interna_id, todas_uasgs, ultimo_acesso_em, busca_normalizada)
       VALUES ($1, $2, $3, $4, $5, true, $6, $7, NULL, $8)`,
      [id, u.nome, u.email, gerarCpf(prng), ctx.senhaHashDemonstracao, u.perfil === 'fiscal' ? (dados.unidades.get('COGEC') ?? null) : null, uasgs === 'todas', normalizarBusca(u.nome, u.email)],
    );
    await tx.executar('INSERT INTO usuarios_perfis (usuario_id, perfil) VALUES ($1, $2)', [id, u.perfil]);
    if (uasgs !== 'todas') for (const codigo of uasgs) await tx.executar('INSERT INTO usuarios_uasgs (usuario_id, uasg) VALUES ($1, $2)', [id, codigo]);
    dados.usuarios.set(u.email, { id, email: u.email, nome: u.nome, perfis: [u.perfil], uasgs });
    if (u.perfil === 'cidadao') cidadaId = id;
  }
  if (cidadaId === null) return;

  // ───────── manifestações: uma publicada e respondida, outra em moderação ─────────
  const vigentes = dados.contratos
    .filter((c) => c.vigenciaInicio <= adicionarDias(hoje, -60) && c.vigenciaFim >= adicionarDias(hoje, 90) && c.gestorId)
    .sort((a, b) => a.numero.localeCompare(b.numero));
  const [publicado, pendente] = prng.embaralhar(vigentes);
  let manifestacoes = 0;

  async function manifestar(contrato: { id: string; numero: string }, texto: string, recebida: DataISO): Promise<string> {
    const id = prng.uuid();
    const validada = validarManifestacao(texto);
    const instante = instanteEm(recebida, prng, agora);
    await tx.executar(
      `INSERT INTO sociedade_manifestacoes (id, contrato_id, autor_id, assunto, texto, texto_publico, dados_pessoais_tarjados, recebida_em, prazo_resposta)
       VALUES ($1, $2, $3, 'execucao', $4, $5, $6, $7, $8)`,
      [id, contrato.id, cidadaId, validada.texto, validada.textoPublico, validada.dadosPessoaisTarjados, instante.toISOString(), prazoRespostaManifestacao(recebida)],
    );
    eventos.push({
      ocorridoEm: instante,
      usuarioId: cidadaId,
      acao: 'sociedade.manifestacao.enviar',
      recurso: 'contrato',
      recursoId: contrato.id,
      resumo: `Enviou manifestação sobre o contrato ${contrato.numero} (aguarda moderação)`,
      dados: { ...carga, manifestacaoId: id, assunto: 'execucao' },
    });
    manifestacoes += 1;
    return id;
  }

  if (publicado) {
    const recebida = adicionarDias(hoje, -12);
    const id = await manifestar(publicado, MANIFESTACAO_PUBLICADA, recebida);
    const moderada = instanteEm(adicionarDias(recebida, 1), prng, agora);
    const motivo = 'Relato pertinente à execução do contrato, sem dado pessoal de terceiros.';
    await tx.executar(
      `UPDATE sociedade_manifestacoes SET situacao = 'publicada', motivo_moderacao = $2, moderada_por = $3, moderada_em = $4 WHERE id = $1`,
      [id, motivo, publicado.gestorId, moderada.toISOString()],
    );
    eventos.push({
      ocorridoEm: moderada,
      usuarioId: publicado.gestorId,
      acao: 'sociedade.manifestacao.publicar',
      recurso: 'contrato',
      recursoId: publicado.id,
      resumo: `Publicou manifestação sobre o contrato ${publicado.numero}`,
      dados: { ...carga, manifestacaoId: id, motivo },
    });
    const resposta = validarResposta({ origem: 'administracao', texto: RESPOSTA_GESTOR, representante: null, situacaoManifestacao: 'publicada' });
    const respondida = instanteEm(adicionarDias(recebida, 3), prng, agora);
    const respostaId = prng.uuid();
    await tx.executar(
      `INSERT INTO sociedade_respostas (id, manifestacao_id, origem, texto, texto_publico, funcao, representante, registrada_por, respondida_em)
       VALUES ($1, $2, 'administracao', $3, $4, 'Gestor do contrato', NULL, $5, $6)`,
      [respostaId, id, resposta.texto, resposta.textoPublico, publicado.gestorId, respondida.toISOString()],
    );
    eventos.push({
      ocorridoEm: respondida,
      usuarioId: publicado.gestorId,
      acao: 'sociedade.manifestacao.responder',
      recurso: 'contrato',
      recursoId: publicado.id,
      resumo: `Respondeu à manifestação sobre o contrato ${publicado.numero}`,
      dados: { ...carga, manifestacaoId: id, respostaId, origem: 'administracao', funcao: 'Gestor do contrato' },
    });
  }
  if (pendente) await manifestar(pendente, MANIFESTACAO_PENDENTE, adicionarDias(hoje, -2));

  // ───────── relatório final de um contrato encerrado (art. 174, § 3º, VI, "d") ─────────
  const encerrado = dados.contratos
    .filter((c) => c.vigenciaFim < adicionarDias(hoje, -30) && c.gestorId)
    .sort((a, b) => a.numero.localeCompare(b.numero))[0];
  let relatorios = 0;
  if (encerrado) {
    const [valores] = await tx.consultar<{ valor_global: number; valor_pago: number; aditivos: number }>(
      `SELECT v.valor_global, v.valor_pago, (SELECT COUNT(*)::integer FROM aditivos a WHERE a.contrato_id = $1) AS aditivos
         FROM vw_contratos_valores v WHERE v.contrato_id = $1`,
      [encerrado.id],
    );
    const [vigencia] = await tx.consultar<{ vigencia_inicio: string; vigencia_fim: string }>('SELECT vigencia_inicio, vigencia_fim FROM contratos WHERE id = $1', [encerrado.id]);
    const execucao = {
      vigenciaInicio: vigencia?.vigencia_inicio ?? encerrado.vigenciaInicio,
      vigenciaFim: vigencia?.vigencia_fim ?? encerrado.vigenciaFim,
      valorGlobal: valores?.valor_global ?? 0,
      valorPago: valores?.valor_pago ?? 0,
      aditivos: valores?.aditivos ?? 0,
      manifestacoesPublicadas: 0,
      registrosPublicados: 0,
    };
    const sha256 = sha256Hex(JSON.stringify({ contratoId: encerrado.id, objetivos: OBJETIVOS, resultados: RESULTADOS, conclusao: 'atingidos', execucao }));
    const diaPublicacao = adicionarDias(execucao.vigenciaFim, 5);
    const publicadoEm = instanteEm(diaPublicacao < hoje ? diaPublicacao : hoje, prng, agora);
    await tx.executar(
      `INSERT INTO sociedade_relatorios_finais (contrato_id, objetivos, resultados, conclusao, execucao, sha256, publicado_por, publicado_em)
       VALUES ($1, $2, $3, 'atingidos', $4::jsonb, $5, $6, $7)`,
      [encerrado.id, OBJETIVOS, RESULTADOS, JSON.stringify(execucao), sha256, encerrado.gestorId, publicadoEm.toISOString()],
    );
    eventos.push({
      ocorridoEm: publicadoEm,
      usuarioId: encerrado.gestorId,
      acao: 'sociedade.relatorio_final.publicar',
      recurso: 'contrato',
      recursoId: encerrado.id,
      resumo: `Publicou o relatório final do contrato ${encerrado.numero}`,
      dados: { ...carga, conclusao: 'atingidos', sha256 },
    });
    relatorios = 1;
  }

  ctx.eventos.push(...eventos);
  dados.contagens.manifestacoesSociedade = manifestacoes;
  dados.contagens.relatoriosFinais = relatorios;
}
