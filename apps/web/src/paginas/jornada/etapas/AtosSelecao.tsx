/**
 * Atos da seleção (etapa 6), depois do registro das propostas: painel da prova de conceito ou amostra (RN-20),
 * habilitação, fase recursal única com os prazos do art. 165 (RN-22) e adjudicação e homologação pela autoridade
 * competente designada (RF-18). A ordem dos atos e os prazos vêm do servidor; aqui só se oferece o ato da vez.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { BadgeCheck, CalendarClock, ClipboardCheck, Gavel, Send, Stamp, Undo2 } from 'lucide-react';
import type { DecisaoRecursalProcesso, EfeitoReforma, FaseRecursalProcesso, ManifestacaoRecursalProcesso, ProcessoDetalhe } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import {
  useAdjudicar,
  useConvocarProvaConceito,
  useDecisaoRecurso,
  useEncerrarIntencao,
  useHomologar,
  useManifestacaoRecursal,
  useReconsideracao,
  useRegistrarHabilitacao,
  useResultadoProvaConceito,
} from '../../../api/selecao';
import { Alerta, AreaTexto, Botao, CampoTexto, ConfirmarAcao, Etiqueta, GrupoOpcoes, ListaDefinicoes, Selecao, useAvisos, type TomEtiqueta } from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { ErroOperacao } from '../comum';
import { ROTULOS_EXIGENCIA } from './ParametrosSelecao';
import type { PropsEtapa } from './tipos';

type ProximoAto = ProcessoDetalhe['selecao']['proximoAto'];

const ROTULOS_PROXIMO_ATO: Record<ProximoAto, { rotulo: string; tom: TomEtiqueta }> = {
  registrar_disputa: { rotulo: 'Registrar as propostas', tom: 'neutro' },
  convocar_prova_conceito: { rotulo: 'Convocar para a prova', tom: 'aviso' },
  registrar_resultado_prova_conceito: { rotulo: 'Registrar o resultado da prova', tom: 'aviso' },
  registrar_habilitacao: { rotulo: 'Registrar a habilitação', tom: 'aviso' },
  registrar_intencao_recurso: { rotulo: 'Intenções de recurso', tom: 'aviso' },
  aguardar_razoes: { rotulo: 'Prazo das razões', tom: 'alerta' },
  aguardar_contrarrazoes: { rotulo: 'Prazo das contrarrazões', tom: 'alerta' },
  decidir_reconsideracao: { rotulo: 'Reconsideração', tom: 'aviso' },
  decidir_recurso: { rotulo: 'Decisão da autoridade superior', tom: 'aviso' },
  adjudicar: { rotulo: 'Adjudicar', tom: 'info' },
  homologar: { rotulo: 'Homologar', tom: 'info' },
  concluida: { rotulo: 'Homologada', tom: 'sucesso' },
  fracassada: { rotulo: 'Licitação fracassada', tom: 'erro' },
};

const SITUACOES_RECURSO: Record<FaseRecursalProcesso['situacao'], string> = {
  intencao: 'Registro das intenções de recurso em aberto',
  razoes: 'Prazo das razões recursais em curso',
  contrarrazoes: 'Prazo das contrarrazões em curso',
  reconsideracao: 'Aguardando a reconsideração de quem praticou o ato',
  decisao_superior: 'Aguardando a decisão da autoridade superior',
  preclusa: 'Sem intenção de recurso: preclusão',
  deserta: 'Sem razões no prazo: recurso deserto',
  improvida: 'Recurso decidido e mantido o resultado',
  decidida_em_recurso: 'Resultado definido em recurso',
};

const MOTIVOS_EXCLUSAO = { prova_conceito: 'reprovado na prova', habilitacao: 'inabilitado', recurso: 'desclassificado em recurso' } as const;
const MINIMO_MOTIVACAO = 30;

function data(valor: string | null): string {
  return valor ? formatarData(valor) : '—';
}

function Subtitulo({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h4 id={id} tabIndex={id ? -1 : undefined} className="jornada-apoio__titulo">
      {children}
    </h4>
  );
}

/** Depois de um ato, o botão ou o formulário usado pode sumir: o foco vai para o título da seção seguinte. */
function focarDepois(alvo: string): void {
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => document.getElementById(alvo)?.focus()));
}

function ListaManifestacoes({ titulo, itens }: { titulo: string; itens: readonly ManifestacaoRecursalProcesso[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="pilha pilha--compacta">
      <p className="texto-forte">{titulo}</p>
      <ul className="jornada-lista-compacta">
        {itens.map((m, i) => (
          <li key={`${m.licitante.id}-${i}`}>
            <strong>{m.licitante.nome}</strong> — <span className="numero">{formatarData(m.data)}</span>: {m.texto}
          </li>
        ))}
      </ul>
    </div>
  );
}

function textoDecisao(d: DecisaoRecursalProcesso<string> | null, rotulos: Record<string, string>): string {
  if (!d) return 'Pendente';
  return `${rotulos[d.decisao] ?? d.decisao} em ${formatarData(d.data)}${d.por ? ` por ${d.por.nome}` : ''} — ${d.motivacao}`;
}

/** Formulário de decisão do recurso: mantém o ato ou o reforma, com o efeito da reforma e a motivação. */
function FormularioDecisao<D extends string>({
  processo,
  titulo,
  opcoes,
  reforma,
  rotuloBotao,
  processando,
  erro,
  aoEnviar,
}: {
  processo: ProcessoDetalhe;
  titulo: string;
  opcoes: readonly { valor: D; rotulo: string }[];
  reforma: D;
  rotuloBotao: string;
  processando: boolean;
  erro: unknown;
  aoEnviar: (decisao: D, motivacao: string, efeito: EfeitoReforma | null) => void;
}) {
  const [decisao, definirDecisao] = useState<D | null>(null);
  const [efeito, definirEfeito] = useState<string | null>(null);
  const [motivacao, definirMotivacao] = useState('');
  const [tentou, definirTentou] = useState(false);
  const excluidos = processo.selecao.excluidos.filter((x) => x.motivo !== 'recurso');
  const reformou = decisao === reforma;
  const efeitoReforma = (): EfeitoReforma | null => {
    if (!reformou || efeito === null) return null;
    return efeito === 'desclassificar' ? { tipo: 'desclassificar_vencedor' } : { tipo: 'reintegrar_licitante', fornecedorId: efeito.replace('reintegrar:', '') };
  };
  const erroMotivacao = tentou && motivacao.trim().length < MINIMO_MOTIVACAO ? `Motive a decisão em pelo menos ${MINIMO_MOTIVACAO} caracteres.` : null;
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (decisao === null || motivacao.trim().length < MINIMO_MOTIVACAO || (reformou && efeito === null)) return;
    aoEnviar(decisao, motivacao.trim(), efeitoReforma());
  };
  return (
    <form className="pilha" onSubmit={enviar} noValidate>
      <Subtitulo>{titulo}</Subtitulo>
      <GrupoOpcoes<D>
        legenda="Decisão"
        nome={`decisao-${titulo}`}
        obrigatorio
        valor={decisao}
        aoMudar={definirDecisao}
        opcoes={opcoes}
        erro={tentou && decisao === null ? 'Escolha a decisão.' : null}
      />
      {reformou ? (
        <GrupoOpcoes<string>
          legenda="Efeito da reforma do ato recorrido"
          nome={`efeito-${titulo}`}
          obrigatorio
          valor={efeito}
          aoMudar={definirEfeito}
          erro={tentou && efeito === null ? 'Escolha o efeito da reforma.' : null}
          opcoes={[
            { valor: 'desclassificar', rotulo: `Desclassificar o vencedor (${processo.selecao.vencedorProvisorio?.nome ?? 'vencedor provisório'}) e convocar o próximo colocado` },
            ...excluidos.map((x) => ({ valor: `reintegrar:${x.licitante.id}`, rotulo: `Reintegrar ${x.licitante.nome} (${MOTIVOS_EXCLUSAO[x.motivo]})` })),
          ]}
        />
      ) : null}
      <AreaTexto rotulo="Motivação" obrigatorio rows={3} value={motivacao} onChange={(e) => definirMotivacao(e.target.value)} erro={erroMotivacao} />
      <ErroOperacao erro={erro} titulo="Não foi possível registrar a decisão" />
      <div className="linha">
        <Botao variante="primario" type="submit" icone={Gavel} carregando={processando}>
          {rotuloBotao}
        </Botao>
      </div>
    </form>
  );
}

export function AtosSelecao({ processo, atual, editavel }: PropsEtapa) {
  const base = useId();
  const { usuario, temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const s = processo.selecao;
  const prova = processo.parametrosEdital.provaConceito;
  const exigida = prova !== undefined && prova.exigencia !== 'nenhuma';
  const rotuloProva = exigida ? ROTULOS_EXIGENCIA[prova.exigencia].toLowerCase() : 'prova de conceito';
  const encerrado = processo.contratoGerado !== null;
  const autoridades = processo.equipe.filter((e) => e.papel === 'autoridade_competente');
  const designado = autoridades.some((e) => e.usuario.id === usuario?.id);
  const podeAgente = editavel && !encerrado;
  const podeAutoridade = atual && !encerrado && temPermissao('jornada:homologar') && designado;
  const vencedor = s.vencedorProvisorio;

  const convocar = useConvocarProvaConceito(processo.id);
  const resultado = useResultadoProvaConceito(processo.id);
  const habilitacao = useRegistrarHabilitacao(processo.id);
  const manifestacao = useManifestacaoRecursal(processo.id);
  const encerrar = useEncerrarIntencao(processo.id);
  const reconsideracao = useReconsideracao(processo.id);
  const decisao = useDecisaoRecurso(processo.id);
  const adjudicar = useAdjudicar(processo.id);
  const homologar = useHomologar(processo.id);

  const [resultadoProva, definirResultadoProva] = useState<'aprovado' | 'reprovado' | null>(null);
  const [motivacaoProva, definirMotivacaoProva] = useState('');
  const [linkProva, definirLinkProva] = useState('');
  const [resultadoHabilitacao, definirResultadoHabilitacao] = useState<'habilitado' | 'inabilitado' | null>(null);
  const [motivacaoHabilitacao, definirMotivacaoHabilitacao] = useState('');
  const [tipoManifestacao, definirTipoManifestacao] = useState<'intencao' | 'razoes' | 'contrarrazoes'>('intencao');
  const [licitanteManifestacao, definirLicitanteManifestacao] = useState('');
  const [textoManifestacao, definirTextoManifestacao] = useState('');
  const [confirmando, definirConfirmando] = useState<'encerrar' | 'adjudicar' | 'homologar' | null>(null);
  const [motivacaoAutoridade, definirMotivacaoAutoridade] = useState('');
  const [tentativa, definirTentativa] = useState<'prova' | 'habilitacao' | 'manifestacao' | null>(null);

  if (s.proximoAto === 'registrar_disputa') return null;

  const sucesso = (titulo: string, mensagem: string) => avisar({ tipo: 'sucesso', titulo, mensagem });
  const fase = s.faseRecursal;
  const habilitacaoPermitida = ['convocar_prova_conceito', 'registrar_resultado_prova_conceito', 'registrar_habilitacao'].includes(s.proximoAto);
  const tiposManifestacao: { valor: 'intencao' | 'razoes' | 'contrarrazoes'; rotulo: string }[] = [];
  if (s.proximoAto === 'registrar_intencao_recurso') tiposManifestacao.push({ valor: 'intencao', rotulo: 'Intenção de recorrer (logo após o ato)' });
  if (fase && (fase.intencoes.length > 0 && (fase.situacao === 'intencao' || fase.situacao === 'razoes'))) tiposManifestacao.push({ valor: 'razoes', rotulo: 'Razões do recurso (3 dias úteis)' });
  if (fase && fase.razoes.length > 0 && ['intencao', 'razoes', 'contrarrazoes'].includes(fase.situacao)) tiposManifestacao.push({ valor: 'contrarrazoes', rotulo: 'Contrarrazões (3 dias úteis)' });
  const tipoAtual = tiposManifestacao.some((t) => t.valor === tipoManifestacao) ? tipoManifestacao : (tiposManifestacao[0]?.valor ?? 'intencao');

  const enviarProva = (e: FormEvent) => {
    e.preventDefault();
    definirTentativa('prova');
    if (resultadoProva === null || motivacaoProva.trim().length < MINIMO_MOTIVACAO || (resultadoProva === 'aprovado' && linkProva.trim() === '')) return;
    resultado.mutate(
      { resultado: resultadoProva, motivacao: motivacaoProva.trim(), linkGravacao: linkProva.trim() === '' ? null : linkProva.trim() },
      {
        onSuccess: (p) => {
          definirResultadoProva(null);
          definirMotivacaoProva('');
          definirLinkProva('');
          definirTentativa(null);
          if (resultadoProva === 'aprovado') focarDepois(`${base}-habilitacao`);
          sucesso(
            'Resultado registrado',
            resultadoProva === 'reprovado' && p.selecao.vencedorProvisorio
              ? `Reprovado. ${p.selecao.vencedorProvisorio.nome} foi convocado automaticamente para a ${rotuloProva}.`
              : `A ${rotuloProva} foi registrada como ${resultadoProva}.`,
          );
        },
      },
    );
  };

  const enviarHabilitacao = (e: FormEvent) => {
    e.preventDefault();
    definirTentativa('habilitacao');
    if (resultadoHabilitacao === null || motivacaoHabilitacao.trim().length < MINIMO_MOTIVACAO) return;
    habilitacao.mutate(
      { resultado: resultadoHabilitacao, motivacao: motivacaoHabilitacao.trim() },
      {
        onSuccess: () => {
          definirResultadoHabilitacao(null);
          definirMotivacaoHabilitacao('');
          definirTentativa(null);
          focarDepois(resultadoHabilitacao === 'habilitado' ? `${base}-recursos` : exigida ? `${base}-prova` : `${base}-habilitacao`);
          sucesso('Habilitação registrada', resultadoHabilitacao === 'habilitado' ? 'Abriu-se a fase recursal: registre as intenções de recurso manifestadas.' : 'O próximo colocado passa a ser o vencedor provisório.');
        },
      },
    );
  };

  const enviarManifestacao = (e: FormEvent) => {
    e.preventDefault();
    definirTentativa('manifestacao');
    if (licitanteManifestacao === '' || textoManifestacao.trim().length < 10) return;
    manifestacao.mutate(
      { tipo: tipoAtual, fornecedorId: licitanteManifestacao, texto: textoManifestacao.trim() },
      {
        onSuccess: () => {
          definirTextoManifestacao('');
          definirLicitanteManifestacao('');
          definirTentativa(null);
          sucesso('Manifestação registrada', 'A manifestação entrou no processo e na trilha de auditoria.');
        },
      },
    );
  };

  const confirmarAto = () => {
    const motivacao = motivacaoAutoridade.trim() === '' ? null : motivacaoAutoridade.trim();
    const fechar = () => {
      definirConfirmando(null);
      definirMotivacaoAutoridade('');
    };
    const alvo = confirmando === 'encerrar' ? `${base}-recursos` : `${base}-homologacao`;
    const concluir = (titulo: string, mensagem: string) => () => {
      fechar();
      sucesso(titulo, mensagem);
      focarDepois(alvo);
    };
    if (confirmando === 'encerrar') encerrar.mutate(undefined, { onSuccess: concluir('Registro encerrado', 'O registro das intenções de recurso foi encerrado.') });
    if (confirmando === 'adjudicar') adjudicar.mutate({ motivacao }, { onSuccess: concluir('Objeto adjudicado', `Adjudicado a ${vencedor?.nome ?? 'vencedor'}.`) });
    if (confirmando === 'homologar') homologar.mutate({ motivacao }, { onSuccess: concluir('Licitação homologada', 'Os documentos preparatórios foram divulgados na página pública do edital.') });
  };
  const mutacaoConfirmacao = confirmando === 'encerrar' ? encerrar : confirmando === 'adjudicar' ? adjudicar : homologar;

  return (
    <section className="secao jornada-subsecao" aria-labelledby={`${base}-titulo`} id="etapa6-atos">
      <div className="secao__cabecalho">
        <div>
          <h3 id={`${base}-titulo`} tabIndex={-1} className="secao__titulo">
            Atos da seleção
          </h3>
          <p className="secao__descricao">
            Julgamento, {exigida ? `${rotuloProva}, ` : ''}habilitação, fase recursal única e atos da autoridade competente, na ordem do art. 17 e com os prazos do art. 165.
          </p>
        </div>
        <Etiqueta tom={ROTULOS_PROXIMO_ATO[s.proximoAto].tom}>{ROTULOS_PROXIMO_ATO[s.proximoAto].rotulo}</Etiqueta>
      </div>

      {s.pendencia ? (
        <Alerta tipo={s.proximoAto === 'fracassada' ? 'erro' : 'info'} compacto titulo={`Próximo ato (${s.pendencia.regra})`}>
          <p>{s.pendencia.mensagem}</p>
          <p className="texto-pequeno">{s.pendencia.fundamento}</p>
        </Alerta>
      ) : null}

      <ListaDefinicoes
        colunas={2}
        itens={[
          { termo: 'Licitante provisoriamente vencedor', valor: vencedor?.nome ?? 'Nenhum (todos excluídos)' },
          {
            termo: 'Licitantes excluídos',
            valor: s.excluidos.length === 0 ? 'Nenhum' : s.excluidos.map((x) => `${x.licitante.nome} (${MOTIVOS_EXCLUSAO[x.motivo]})`).join('; '),
          },
        ]}
      />

      {exigida ? (
        <div className="pilha" id="etapa6-prova-conceito">
          <Subtitulo id={`${base}-prova`}>
            Painel da {rotuloProva} (RN-20)
          </Subtitulo>
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Exigência do edital', valor: `${ROTULOS_EXIGENCIA[prova.exigencia]} em até ${prova.prazoDiasUteis ?? '—'} dias úteis da convocação` },
              { termo: 'Sessão', valor: 'Pública, transmitida e gravada; o link da gravação acompanha o resultado' },
              { termo: 'Roteiro e critérios de aprovação', valor: prova.roteiro ?? '—', largo: true },
            ]}
          />
          {s.provasConceito.length > 0 ? (
            <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-provas`} tabIndex={0}>
              <table className="tabela tabela--compacta">
                <caption id={`${base}-provas`} className="tabela__legenda">
                  Convocações e resultados da {rotuloProva}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Licitante</th>
                    <th scope="col">Convocado em</th>
                    <th scope="col">Prazo até</th>
                    <th scope="col">Resultado</th>
                    <th scope="col">Gravação</th>
                    <th scope="col">Motivação</th>
                  </tr>
                </thead>
                <tbody>
                  {s.provasConceito.map((p, i) => (
                    <tr key={`${p.licitante.id}-${i}`}>
                      <th scope="row">
                        {p.licitante.nome}
                        {p.convocacaoAutomatica ? <span className="texto-pequeno texto-secundario"> (convocado automaticamente)</span> : null}
                      </th>
                      <td className="numero">{data(p.convocadoEm)}</td>
                      <td className="numero">{data(p.limite)}</td>
                      <td>
                        {p.resultado === null ? (
                          <Etiqueta tom="alerta" compacta>
                            Aguardando
                          </Etiqueta>
                        ) : (
                          <Etiqueta tom={p.resultado === 'aprovado' ? 'sucesso' : 'erro'} compacta>
                            {p.resultado === 'aprovado' ? 'Aprovado' : 'Reprovado'} em {data(p.realizadaEm)}
                          </Etiqueta>
                        )}
                      </td>
                      <td>
                        {p.linkGravacao ? (
                          <a href={p.linkGravacao} target="_blank" rel="noopener noreferrer">
                            Abrir gravação<span className="sr-only"> da sessão de {p.licitante.nome} (nova aba)</span>
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{p.motivacao ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {podeAgente && s.proximoAto === 'convocar_prova_conceito' && vencedor ? (
            <div className="linha">
              <Botao
                variante="primario"
                icone={CalendarClock}
                carregando={convocar.isPending}
                onClick={() =>
                  convocar.mutate(undefined, {
                    onSuccess: () => {
                      sucesso('Licitante convocado', `${vencedor.nome} foi convocado para a ${rotuloProva}.`);
                      focarDepois(`${base}-prova`);
                    },
                  })
                }
              >
                Convocar {vencedor.nome}
              </Botao>
            </div>
          ) : null}
          <ErroOperacao erro={convocar.error} titulo="Não foi possível convocar" />
          {podeAgente && s.proximoAto === 'registrar_resultado_prova_conceito' && vencedor ? (
            <form className="pilha" onSubmit={enviarProva} noValidate aria-label={`Resultado da ${rotuloProva}`}>
              <GrupoOpcoes<'aprovado' | 'reprovado'>
                legenda={`Resultado da ${rotuloProva} de ${vencedor.nome}`}
                nome="resultado-prova-conceito"
                obrigatorio
                horizontal
                valor={resultadoProva}
                aoMudar={definirResultadoProva}
                erro={tentativa === 'prova' && resultadoProva === null ? 'Escolha o resultado.' : null}
                opcoes={[
                  { valor: 'aprovado', rotulo: 'Aprovado' },
                  { valor: 'reprovado', rotulo: 'Reprovado (o próximo colocado é convocado)' },
                ]}
              />
              <AreaTexto
                rotulo="Motivação do resultado"
                obrigatorio
                rows={3}
                value={motivacaoProva}
                onChange={(e) => definirMotivacaoProva(e.target.value)}
                erro={tentativa === 'prova' && motivacaoProva.trim().length < MINIMO_MOTIVACAO ? `Motive o resultado em pelo menos ${MINIMO_MOTIVACAO} caracteres.` : null}
              />
              <CampoTexto
                rotulo="Link da gravação da sessão pública"
                obrigatorio={resultadoProva !== 'reprovado'}
                type="url"
                inputMode="url"
                value={linkProva}
                onChange={(e) => definirLinkProva(e.target.value)}
                ajuda="Endereço http(s) da gravação em áudio e vídeo. Pode ficar em branco só na reprovação por ausência do licitante."
                erro={tentativa === 'prova' && resultadoProva === 'aprovado' && linkProva.trim() === '' ? 'Informe o link da gravação.' : null}
              />
              <ErroOperacao erro={resultado.error} titulo="Não foi possível registrar o resultado" />
              <div className="linha">
                <Botao variante="primario" type="submit" icone={ClipboardCheck} carregando={resultado.isPending}>
                  Registrar resultado
                </Botao>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="pilha" id="etapa6-habilitacao">
        <Subtitulo id={`${base}-habilitacao`}>Habilitação</Subtitulo>
        {s.habilitacoes.length === 0 ? (
          <p className="texto-secundario">Nenhuma habilitação registrada.</p>
        ) : (
          <ul className="jornada-lista-compacta">
            {s.habilitacoes.map((h, i) => (
              <li key={`${h.licitante.id}-${i}`}>
                <strong>{h.licitante.nome}</strong>: {h.resultado} em <span className="numero">{formatarData(h.data)}</span> — {h.motivacao}
              </li>
            ))}
          </ul>
        )}
        {podeAgente && habilitacaoPermitida && vencedor ? (
          <form className="pilha" onSubmit={enviarHabilitacao} noValidate aria-label="Registro da habilitação">
            <GrupoOpcoes<'habilitado' | 'inabilitado'>
              legenda={`Habilitação de ${vencedor.nome}`}
              nome="resultado-habilitacao"
              obrigatorio
              horizontal
              valor={resultadoHabilitacao}
              aoMudar={definirResultadoHabilitacao}
              erro={tentativa === 'habilitacao' && resultadoHabilitacao === null ? 'Escolha o resultado.' : null}
              opcoes={[
                ...(s.proximoAto === 'registrar_habilitacao' ? [{ valor: 'habilitado' as const, rotulo: 'Habilitado' }] : []),
                { valor: 'inabilitado' as const, rotulo: 'Inabilitado (o próximo colocado é convocado)' },
              ]}
            />
            <AreaTexto
              rotulo="Motivação da habilitação"
              obrigatorio
              rows={2}
              value={motivacaoHabilitacao}
              onChange={(e) => definirMotivacaoHabilitacao(e.target.value)}
              erro={tentativa === 'habilitacao' && motivacaoHabilitacao.trim().length < MINIMO_MOTIVACAO ? `Motive em pelo menos ${MINIMO_MOTIVACAO} caracteres.` : null}
            />
            <ErroOperacao erro={habilitacao.error} titulo="Não foi possível registrar a habilitação" />
            <div className="linha">
              <Botao variante={s.proximoAto === 'registrar_habilitacao' ? 'primario' : 'secundario'} type="submit" icone={BadgeCheck} carregando={habilitacao.isPending}>
                Registrar habilitação
              </Botao>
            </div>
          </form>
        ) : null}
      </div>

      {fase ? (
        <div className="pilha" id="etapa6-recursos">
          <Subtitulo id={`${base}-recursos`}>Fase recursal única (RN-22)</Subtitulo>
          <p>
            <Etiqueta tom={fase.situacao === 'preclusa' || fase.situacao === 'deserta' || fase.situacao === 'improvida' ? 'sucesso' : 'alerta'}>
              {SITUACOES_RECURSO[fase.situacao]}
            </Etiqueta>
          </p>
          <ListaDefinicoes
            colunas={2}
            itens={[
              { termo: 'Ato recorrível', valor: `${fase.atoRecorrivel === 'habilitacao' ? 'Ata de habilitação' : 'Ata de julgamento (inversão de fases)'} de ${formatarData(fase.dataAto)}` },
              { termo: 'Razões até', valor: <span className="numero">{data(fase.prazos.razoes)}</span> },
              { termo: 'Contrarrazões até', valor: <span className="numero">{data(fase.prazos.contrarrazoes)}</span> },
              { termo: 'Reconsideração até', valor: <span className="numero">{data(fase.prazos.reconsideracao)}</span> },
              { termo: 'Decisão da autoridade superior até', valor: <span className="numero">{fase.prazos.decisaoSuperior ? data(fase.prazos.decisaoSuperior) : 'após o encaminhamento (10 dias úteis)'}</span> },
              { termo: 'Reconsideração', valor: textoDecisao(fase.reconsideracao, { reconsiderada: 'Reconsiderada', mantida: 'Mantido o ato' }), largo: true },
              { termo: 'Decisão superior', valor: textoDecisao(fase.decisaoSuperior, { provido: 'Provido', nao_provido: 'Não provido' }), largo: true },
            ]}
          />
          <ListaManifestacoes titulo="Intenções de recurso" itens={fase.intencoes} />
          <ListaManifestacoes titulo="Razões" itens={fase.razoes} />
          <ListaManifestacoes titulo="Contrarrazões" itens={fase.contrarrazoes} />
          {podeAgente && tiposManifestacao.length > 0 ? (
            <form className="pilha" onSubmit={enviarManifestacao} noValidate aria-label="Registro de manifestação recursal">
              <div className="formulario__linha">
                <Selecao
                  rotulo="Manifestação"
                  obrigatorio
                  opcoes={tiposManifestacao}
                  value={tipoAtual}
                  onChange={(e) => definirTipoManifestacao(e.target.value as 'intencao' | 'razoes' | 'contrarrazoes')}
                />
                <Selecao
                  rotulo="Licitante"
                  obrigatorio
                  opcaoVazia="Selecione"
                  opcoes={processo.disputa.licitantes.map((l) => ({ valor: l.id, rotulo: l.nome }))}
                  value={licitanteManifestacao}
                  onChange={(e) => definirLicitanteManifestacao(e.target.value)}
                  erro={tentativa === 'manifestacao' && licitanteManifestacao === '' ? 'Selecione o licitante.' : null}
                />
              </div>
              <AreaTexto
                rotulo="Resumo da manifestação"
                obrigatorio
                rows={2}
                value={textoManifestacao}
                onChange={(e) => definirTextoManifestacao(e.target.value)}
                erro={tentativa === 'manifestacao' && textoManifestacao.trim().length < 10 ? 'Resuma em pelo menos 10 caracteres.' : null}
              />
              <ErroOperacao erro={manifestacao.error} titulo="Não foi possível registrar a manifestação" />
              <div className="linha">
                <Botao variante="secundario" type="submit" icone={Send} carregando={manifestacao.isPending}>
                  Registrar manifestação
                </Botao>
                {fase.intencaoAberta ? (
                  <Botao variante="primario" icone={Undo2} onClick={() => definirConfirmando('encerrar')}>
                    Encerrar registro de intenções
                  </Botao>
                ) : null}
              </div>
            </form>
          ) : null}
          {podeAgente && s.proximoAto === 'decidir_reconsideracao' ? (
            <FormularioDecisao
              processo={processo}
              titulo="Reconsideração de quem praticou o ato (3 dias úteis)"
              opcoes={[
                { valor: 'mantida', rotulo: 'Manter o ato e encaminhar à autoridade superior' },
                { valor: 'reconsiderada', rotulo: 'Reconsiderar o ato' },
              ]}
              reforma="reconsiderada"
              rotuloBotao="Registrar reconsideração"
              processando={reconsideracao.isPending}
              erro={reconsideracao.error}
              aoEnviar={(d, motivacao, efeito) =>
                reconsideracao.mutate(
                  { decisao: d, motivacao, efeito },
                  {
                    onSuccess: () => {
                      sucesso('Reconsideração registrada', d === 'mantida' ? 'O recurso subiu à autoridade superior.' : 'O ato recorrido foi reformado.');
                      focarDepois(`${base}-titulo`);
                    },
                  },
                )
              }
            />
          ) : null}
          {podeAutoridade && s.proximoAto === 'decidir_recurso' ? (
            <FormularioDecisao
              processo={processo}
              titulo="Decisão da autoridade superior (10 dias úteis)"
              opcoes={[
                { valor: 'nao_provido', rotulo: 'Negar provimento (mantém o resultado)' },
                { valor: 'provido', rotulo: 'Dar provimento (reforma o ato)' },
              ]}
              reforma="provido"
              rotuloBotao="Registrar decisão"
              processando={decisao.isPending}
              erro={decisao.error}
              aoEnviar={(d, motivacao, efeito) =>
                decisao.mutate(
                  { decisao: d, motivacao, efeito },
                  {
                    onSuccess: () => {
                      sucesso('Recurso decidido', d === 'provido' ? 'Recurso provido.' : 'Recurso não provido.');
                      focarDepois(`${base}-titulo`);
                    },
                  },
                )
              }
            />
          ) : null}
          {s.fasesRecursaisAnteriores.length > 0 ? (
            <p className="texto-pequeno texto-secundario">
              {s.fasesRecursaisAnteriores.length === 1 ? 'Há 1 fase recursal anterior' : `Há ${s.fasesRecursaisAnteriores.length} fases recursais anteriores`}, de vencedores
              desfeitos em recurso: {s.fasesRecursaisAnteriores.map((f) => f.vencedor.nome).join('; ')}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="pilha" id="etapa6-homologacao">
        <Subtitulo id={`${base}-homologacao`}>Adjudicação e homologação (RF-18)</Subtitulo>
        <ListaDefinicoes
          colunas={2}
          itens={[
            {
              termo: 'Autoridade competente designada',
              valor: autoridades.length > 0 ? autoridades.map((a) => a.usuario.nome).join(', ') : 'Não designada na equipe (etapa 2)',
            },
            {
              termo: 'Adjudicação',
              valor: s.adjudicacao ? `${s.adjudicacao.licitante.nome}, em ${formatarData(s.adjudicacao.data)}${s.adjudicacao.por ? ` por ${s.adjudicacao.por.nome}` : ''}` : 'Pendente',
            },
            { termo: 'Homologação', valor: s.homologacao ? `Em ${formatarData(s.homologacao.data)}${s.homologacao.por ? ` por ${s.homologacao.por.nome}` : ''}` : 'Pendente' },
          ]}
        />
        {atual && !encerrado && temPermissao('jornada:homologar') && !designado && (s.proximoAto === 'adjudicar' || s.proximoAto === 'homologar' || s.proximoAto === 'decidir_recurso') ? (
          <Alerta tipo="info" compacto>
            <p>Seu perfil permite estes atos, mas só a autoridade competente designada na equipe deste processo os pratica (art. 71).</p>
          </Alerta>
        ) : null}
        {podeAutoridade && s.proximoAto === 'adjudicar' ? (
          <div className="linha">
            <Botao variante="primario" icone={Gavel} onClick={() => definirConfirmando('adjudicar')}>
              Adjudicar o objeto
            </Botao>
          </div>
        ) : null}
        {podeAutoridade && s.proximoAto === 'homologar' ? (
          <div className="linha">
            <Botao variante="primario" icone={Stamp} onClick={() => definirConfirmando('homologar')}>
              Homologar a licitação
            </Botao>
          </div>
        ) : null}
        {s.homologacao ? (
          <Alerta tipo="sucesso" compacto titulo="Documentos preparatórios divulgados (art. 54, § 3º)">
            <p>
              Com a homologação, o DFD, o ETP, a matriz de riscos, a nota técnica de preços (salvo orçamento sigiloso) e o checklist jurídico aprovados
              estão na página pública do edital, sem login.
            </p>
            <p>
              <Link to={`/transparencia/editais/${processo.id}`}>Ver a página pública do edital</Link>
            </p>
          </Alerta>
        ) : null}
      </div>

      <ConfirmarAcao
        aberto={confirmando !== null}
        aoFechar={() => {
          definirConfirmando(null);
          mutacaoConfirmacao.reset();
        }}
        titulo={confirmando === 'encerrar' ? 'Encerrar o registro de intenções' : confirmando === 'adjudicar' ? 'Adjudicar o objeto' : 'Homologar a licitação'}
        largura="media"
        descricao={
          confirmando === 'encerrar' ? (
            <p>
              {fase && fase.intencoes.length > 0
                ? `Encerra o registro com ${fase.intencoes.length} intenção(ões). Correm 3 dias úteis para as razões e, depois, 3 para as contrarrazões.`
                : 'Sem intenção registrada, o direito de recorrer fica precluso e o processo segue para a adjudicação (art. 165, § 1º, I).'}
            </p>
          ) : confirmando === 'adjudicar' ? (
            <p>Adjudica o objeto a {vencedor?.nome ?? 'o vencedor'} (art. 71, IV). O ato fica registrado na trilha de auditoria.</p>
          ) : (
            <p>Homologa a licitação (art. 71, IV) e divulga os documentos da fase preparatória na página pública do edital (art. 54, § 3º).</p>
          )
        }
        rotuloConfirmar={confirmando === 'encerrar' ? 'Encerrar registro' : confirmando === 'adjudicar' ? 'Adjudicar' : 'Homologar'}
        aoConfirmar={confirmarAto}
        processando={mutacaoConfirmacao.isPending}
        erro={mutacaoConfirmacao.error}
      >
        {confirmando === 'adjudicar' || confirmando === 'homologar' ? (
          <AreaTexto rotulo="Observação (opcional)" rows={2} value={motivacaoAutoridade} onChange={(e) => definirMotivacaoAutoridade(e.target.value)} />
        ) : null}
      </ConfirmarAcao>
    </section>
  );
}
