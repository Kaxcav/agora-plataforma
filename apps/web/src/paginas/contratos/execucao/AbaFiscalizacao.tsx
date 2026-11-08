import { useState, type FormEvent } from 'react';
import { BookOpenText, UserPlus, Users } from 'lucide-react';
import type { ContratoDetalhe, DesignacaoContrato, ExecucaoContrato, OcorrenciaContrato, PapelFiscalizacao, TipoOcorrenciaContrato } from '@agora/contratos';
import { formatarData, validarDataISO } from '@agora/dominio';
import {
  useDesignar,
  useEncerrarDesignacao,
  useExecucaoContrato,
  useRegistrarOcorrencia,
  useRegistrarReservasCargos,
  useRegularizarOcorrencia,
  useServidoresDesignaveis,
} from '../../../api/execucao';
import {
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  Secao,
  Selecao,
  Tabela,
  TextoLongo,
  useAvisos,
  type ColunaTabela,
} from '../../../componentes';
import { useSessao } from '../../../sessao/ContextoSessao';
import { ErroFormulario, hoje, ROTULOS_PAPEL, TIPOS_OCORRENCIA } from './comum';

/**
 * Aba Fiscalização (art. 117): equipe designada — gestor, fiscais técnico, administrativo e requisitante e comissão de
 * recebimento — e o livro de ocorrências. O servidor confere a segregação de funções, a UASG e o perfil do designado.
 */

const MINIMO_RELATO = 30;

function DialogoDesignar({ contrato, aberto, aoFechar }: { contrato: ContratoDetalhe; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const designar = useDesignar(contrato.id);
  const servidores = useServidoresDesignaveis(contrato.id, aberto);
  const [papel, definirPapel] = useState<PapelFiscalizacao>('fiscal_tecnico');
  const [usuarioId, definirUsuario] = useState('');
  const [substituto, definirSubstituto] = useState(false);
  const [ato, definirAto] = useState('');
  const [inicio, definirInicio] = useState(hoje());
  const [erros, definirErros] = useState<{ usuario?: string; ato?: string; inicio?: string }>({});
  const idFormulario = `formulario-designar-${contrato.id}`;

  const fechar = () => {
    definirUsuario('');
    definirAto('');
    definirSubstituto(false);
    definirErros({});
    designar.reset();
    aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: typeof erros = {};
    if (!usuarioId) novos.usuario = 'Escolha o servidor.';
    if (ato.trim().length < 3) novos.ato = 'Informe o ato de designação (por exemplo, a portaria no SEI).';
    if (!validarDataISO(inicio)) novos.inicio = 'Informe a data de início.';
    else if (inicio > hoje()) novos.inicio = 'O início não pode ser futuro.';
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    designar.mutate(
      { papel, usuarioId, substituto: papel === 'comissao_recebimento' ? false : substituto, ato: ato.trim(), inicio },
      {
        onSuccess: (d) => {
          avisar({ tipo: 'sucesso', titulo: 'Designação registrada', mensagem: `${d.usuario.nome}: ${ROTULOS_PAPEL[d.papel].toLowerCase()} (${d.ato}).` });
          fechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={designar.isPending ? () => undefined : fechar}
      titulo="Designar gestor ou fiscal"
      largura="media"
      descricao={
        <p>
          A designação substitui o titular anterior do mesmo papel. Gestor e fiscal técnico não podem ser a mesma pessoa (art. 7º, § 1º); a comissão
          de recebimento pode ter vários membros.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={designar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={designar.isPending}>
            Registrar designação
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <Selecao
          rotulo="Papel"
          obrigatorio
          value={papel}
          onChange={(e) => definirPapel(e.target.value as PapelFiscalizacao)}
          opcoes={(Object.keys(ROTULOS_PAPEL) as PapelFiscalizacao[]).map((p) => ({ valor: p, rotulo: ROTULOS_PAPEL[p] }))}
        />
        <Selecao
          rotulo="Servidor"
          obrigatorio
          value={usuarioId}
          onChange={(e) => definirUsuario(e.target.value)}
          opcaoVazia={servidores.isLoading ? 'Carregando servidores…' : 'Escolha'}
          opcoes={(servidores.data ?? []).map((s) => ({ valor: s.id, rotulo: s.nome }))}
          erro={erros.usuario}
          ajuda="Aparecem os servidores com perfil de gestão ou de fiscalização e a UASG do contrato no escopo."
        />
        {papel !== 'comissao_recebimento' ? (
          <CaixaSelecao rotulo="Substituto (atua nas ausências do titular)" checked={substituto} onChange={(e) => definirSubstituto(e.target.checked)} />
        ) : null}
        <CampoTexto rotulo="Ato de designação" obrigatorio value={ato} maxLength={200} onChange={(e) => definirAto(e.target.value)} erro={erros.ato} ajuda="Ex.: Portaria nº 12/2026, no processo SEI." />
        <CampoTexto rotulo="Início" type="date" obrigatorio value={inicio} max={hoje()} onChange={(e) => definirInicio(e.target.value)} erro={erros.inicio} />
        <ErroFormulario erro={designar.error} titulo="A designação não foi registrada" />
      </form>
    </Dialogo>
  );
}

function DialogoOcorrencia({ contrato, aberto, aoFechar }: { contrato: ContratoDetalhe; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarOcorrencia(contrato.id);
  const [tipo, definirTipo] = useState<TipoOcorrenciaContrato>('falha_execucao');
  const [dataFato, definirDataFato] = useState(hoje());
  const [relato, definirRelato] = useState('');
  const [providencia, definirProvidencia] = useState('');
  const [prazo, definirPrazo] = useState('');
  const [notificar, definirNotificar] = useState(true);
  const [erros, definirErros] = useState<{ relato?: string; prazo?: string; data?: string }>({});
  const idFormulario = `formulario-ocorrencia-${contrato.id}`;

  const fechar = () => {
    definirRelato('');
    definirProvidencia('');
    definirPrazo('');
    definirErros({});
    registrar.reset();
    aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: typeof erros = {};
    if (relato.trim().length < MINIMO_RELATO) novos.relato = `Descreva a ocorrência com pelo menos ${MINIMO_RELATO} caracteres.`;
    if (!validarDataISO(dataFato) || dataFato > hoje()) novos.data = 'Informe a data do fato (não pode ser futura).';
    if (prazo && (!validarDataISO(prazo) || prazo < hoje())) novos.prazo = 'O prazo não pode ser anterior a hoje.';
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    registrar.mutate(
      { tipo, dataFato, relato: relato.trim(), providencia: providencia.trim() || null, prazoRegularizacao: prazo || null, notificarContratada: notificar },
      {
        onSuccess: (o) => {
          avisar({
            tipo: 'sucesso',
            titulo: `Ocorrência nº ${o.numero} registrada`,
            mensagem: o.notificacaoId ? 'A contratada foi notificada pela central de notificações.' : 'Registro feito no livro do contrato.',
          });
          fechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={registrar.isPending ? () => undefined : fechar}
      titulo="Registrar ocorrência"
      largura="media"
      descricao={
        <p>
          O fiscal anota no livro do contrato as ocorrências da execução e determina o necessário para regularizar faltas e defeitos (art. 117, § 1º).
          O registro não aplica penalidade: eventual sanção depende de processo próprio, com defesa.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar ocorrência
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <Selecao
          rotulo="Tipo"
          value={tipo}
          onChange={(e) => definirTipo(e.target.value as TipoOcorrenciaContrato)}
          opcoes={(Object.keys(TIPOS_OCORRENCIA) as TipoOcorrenciaContrato[]).map((t) => ({ valor: t, rotulo: TIPOS_OCORRENCIA[t] }))}
        />
        <CampoTexto rotulo="Data do fato" type="date" obrigatorio value={dataFato} max={hoje()} onChange={(e) => definirDataFato(e.target.value)} erro={erros.data} />
        <AreaTexto rotulo="Relato" obrigatorio rows={4} maxLength={5000} contador value={relato} onChange={(e) => definirRelato(e.target.value)} erro={erros.relato} />
        <AreaTexto rotulo="Providência determinada" rows={2} maxLength={2000} value={providencia} onChange={(e) => definirProvidencia(e.target.value)} />
        <CampoTexto
          rotulo="Prazo para regularização"
          type="date"
          value={prazo}
          min={hoje()}
          onChange={(e) => definirPrazo(e.target.value)}
          erro={erros.prazo}
          ajuda="Com prazo, a contratada é sempre notificada."
        />
        <CaixaSelecao rotulo="Notificar a contratada por e-mail e no processo SEI" checked={notificar || prazo !== ''} disabled={prazo !== ''} onChange={(e) => definirNotificar(e.target.checked)} />
        <ErroFormulario erro={registrar.error} titulo="A ocorrência não foi registrada" />
      </form>
    </Dialogo>
  );
}

function DialogoRegularizar({ ocorrencia, aoFechar }: { ocorrencia: OcorrenciaContrato | null; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const regularizar = useRegularizarOcorrencia();
  const [data, definirData] = useState(hoje());
  const [observacao, definirObservacao] = useState('');
  const [erro, definirErro] = useState<string | undefined>();
  const fechar = () => {
    definirObservacao('');
    definirErro(undefined);
    regularizar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!ocorrencia) return;
    if (observacao.trim().length < 10) {
      definirErro('Descreva a regularização com pelo menos 10 caracteres.');
      return;
    }
    regularizar.mutate(
      { id: ocorrencia.id, entrada: { data, observacao: observacao.trim() } },
      {
        onSuccess: (o) => {
          avisar({ tipo: 'sucesso', titulo: `Ocorrência nº ${o.numero} regularizada`, mensagem: 'A regularização ficou registrada no livro do contrato.' });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={ocorrencia !== null}
      aoFechar={regularizar.isPending ? () => undefined : fechar}
      titulo="Registrar regularização"
      largura="estreita"
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={regularizar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-regularizar" carregando={regularizar.isPending}>
            Registrar regularização
          </Botao>
        </>
      }
    >
      <form id="formulario-regularizar" className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto rotulo="Data" type="date" obrigatorio value={data} max={hoje()} onChange={(e) => definirData(e.target.value)} />
        <AreaTexto rotulo="Como foi regularizada" obrigatorio rows={3} maxLength={2000} value={observacao} onChange={(e) => definirObservacao(e.target.value)} erro={erro} />
        <ErroFormulario erro={regularizar.error} titulo="A regularização não foi registrada" />
      </form>
    </Dialogo>
  );
}

function DialogoReservas({ contrato, aberto, aoFechar }: { contrato: ContratoDetalhe; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarReservasCargos(contrato.id);
  const [competencia, definirCompetencia] = useState(hoje().slice(0, 7));
  const [empregados, definirEmpregados] = useState('');
  const [mulheres, definirMulheres] = useState('0');
  const [egressos, definirEgressos] = useState('0');
  const [pcd, definirPcd] = useState(false);
  const [aprendizes, definirAprendizes] = useState(false);
  const [observacao, definirObservacao] = useState('');
  const [erro, definirErro] = useState<string | undefined>();
  const inteiro = (v: string) => (/^\d+$/.test(v) ? Number(v) : NaN);
  const fechar = () => {
    definirEmpregados('');
    definirObservacao('');
    definirErro(undefined);
    registrar.reset();
    aoFechar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const total = inteiro(empregados);
    const m = inteiro(mulheres);
    const e = inteiro(egressos);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia) || Number.isNaN(total) || Number.isNaN(m) || Number.isNaN(e)) {
      definirErro('Informe a competência e as quantidades em números inteiros.');
      return;
    }
    definirErro(undefined);
    registrar.mutate(
      { competencia, empregados: total, mulheres: m, egressos: e, pcdComprovada: pcd, aprendizesComprovada: aprendizes, observacao: observacao.trim() || null },
      {
        onSuccess: (v) => {
          avisar({
            tipo: v.atende ? 'sucesso' : 'aviso',
            titulo: v.atende ? 'Reservas atendidas' : 'Reservas com pendência',
            mensagem: v.atende ? 'A verificação foi registrada.' : `${v.pendencias.join(' ')} A pendência entrou no livro de ocorrências.`,
          });
          fechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={registrar.isPending ? () => undefined : fechar}
      titulo="Verificar reservas de cargos"
      largura="media"
      descricao={<p>Informe os empregados alocados no contrato na competência e as vagas reservadas ocupadas. As cotas da empresa são conferidas pela comprovação apresentada.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form="formulario-reservas" carregando={registrar.isPending}>
            Registrar verificação
          </Botao>
        </>
      }
    >
      <form id="formulario-reservas" className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto rotulo="Competência" type="month" obrigatorio value={competencia} onChange={(ev) => definirCompetencia(ev.target.value)} />
        <CampoTexto rotulo="Empregados alocados no contrato" type="number" min={0} obrigatorio value={empregados} onChange={(ev) => definirEmpregados(ev.target.value)} />
        <CampoTexto rotulo="Mulheres vítimas de violência doméstica" type="number" min={0} value={mulheres} onChange={(ev) => definirMulheres(ev.target.value)} />
        <CampoTexto rotulo="Pessoas presas ou egressas do sistema prisional" type="number" min={0} value={egressos} onChange={(ev) => definirEgressos(ev.target.value)} />
        <CaixaSelecao rotulo="A empresa comprovou a cota de pessoas com deficiência e reabilitados" checked={pcd} onChange={(ev) => definirPcd(ev.target.checked)} />
        <CaixaSelecao rotulo="A empresa comprovou a cota de aprendizes" checked={aprendizes} onChange={(ev) => definirAprendizes(ev.target.checked)} />
        <AreaTexto rotulo="Observação" rows={2} maxLength={2000} value={observacao} onChange={(ev) => definirObservacao(ev.target.value)} erro={erro} />
        <ErroFormulario erro={registrar.error} titulo="A verificação não foi registrada" />
      </form>
    </Dialogo>
  );
}

function ConteudoFiscalizacao({ contrato, execucao }: { contrato: ContratoDetalhe; execucao: ExecucaoContrato }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const encerrar = useEncerrarDesignacao();
  const [designando, definirDesignando] = useState(false);
  const [registrando, definirRegistrando] = useState(false);
  const [regularizando, definirRegularizando] = useState<OcorrenciaContrato | null>(null);
  const [verificando, definirVerificando] = useState(false);
  const podeDesignar = temPermissao('fiscalizacao:designar');
  const podeRegistrar = temPermissao('fiscalizacao:registrar') && execucao.meusPapeis.length > 0;
  const ativas = execucao.designacoes.filter((d) => d.fim === null);
  const encerradas = execucao.designacoes.filter((d) => d.fim !== null);

  const colunasEquipe: ColunaTabela<DesignacaoContrato>[] = [
    { id: 'papel', cabecalho: 'Papel', identificadora: true, celula: (d) => `${ROTULOS_PAPEL[d.papel]}${d.substituto ? ' (substituto)' : ''}` },
    { id: 'servidor', cabecalho: 'Servidor', prioritaria: true, celula: (d) => d.usuario.nome },
    { id: 'ato', cabecalho: 'Ato', celula: (d) => d.ato },
    { id: 'inicio', cabecalho: 'Desde', celula: (d) => <span className="numero">{formatarData(d.inicio)}</span> },
  ];

  const colunasOcorrencias: ColunaTabela<OcorrenciaContrato>[] = [
    { id: 'numero', cabecalho: 'Nº', identificadora: true, celula: (o) => <span className="numero">{o.numero}</span> },
    { id: 'tipo', cabecalho: 'Tipo', celula: (o) => TIPOS_OCORRENCIA[o.tipo] },
    { id: 'data', cabecalho: 'Data do fato', celula: (o) => <span className="numero">{formatarData(o.dataFato)}</span> },
    { id: 'relato', cabecalho: 'Relato', prioritaria: true, larguraMinima: '18rem', celula: (o) => <TextoLongo texto={o.relato} /> },
    {
      id: 'situacao',
      cabecalho: 'Situação',
      prioritaria: true,
      celula: (o) => (
        <span className="pilha pilha--compacta">
          <Etiqueta tom={o.situacao === 'aberta' ? 'aviso' : 'sucesso'} compacta>
            {o.situacao === 'aberta' ? 'Aberta' : `Regularizada em ${formatarData(o.regularizadaEm ?? o.dataFato)}`}
          </Etiqueta>
          {o.prazoRegularizacao ? <span className="texto-pequeno">Prazo: {formatarData(o.prazoRegularizacao)}</span> : null}
          {o.notificacaoId ? <span className="texto-pequeno">Contratada notificada</span> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="pilha pilha--ampla">
      <Secao
        titulo="Gestão e fiscalização"
        id="equipe-fiscalizacao"
        nivel={3}
        descricao={<p>Equipe designada para acompanhar e fiscalizar a execução (Lei 14.133/2021, art. 117).</p>}
        acoes={
          podeDesignar ? (
            <Botao variante="primario" icone={UserPlus} onClick={() => definirDesignando(true)}>
              Designar
            </Botao>
          ) : null
        }
      >
        {execucao.equipe.faltantes.length > 0 ? (
          <p className="texto-secundario">Sem designação: {execucao.equipe.faltantes.map((p) => ROTULOS_PAPEL[p].toLowerCase()).join(', ')}.</p>
        ) : null}
        <Tabela
          id="contrato-equipe"
          legenda="Equipe designada"
          colunas={colunasEquipe}
          linhas={ativas}
          chave={(d) => d.id}
          semFerramentas
          vazio={<EstadoVazio icone={Users} titulo="Nenhuma designação registrada" />}
          acoes={
            podeDesignar
              ? {
                  cabecalho: 'Ações',
                  celula: (d) => (
                    <Botao
                      tamanho="compacto"
                      variante="secundario"
                      carregando={encerrar.isPending && encerrar.variables?.id === d.id}
                      aria-label={`Encerrar a designação de ${d.usuario.nome} como ${ROTULOS_PAPEL[d.papel].toLowerCase()}`}
                      onClick={() =>
                        encerrar.mutate(
                          { id: d.id, entrada: { fim: hoje(), motivo: 'Encerrada pelo gestor na tela de fiscalização do contrato.' } },
                          {
                            onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Designação encerrada', mensagem: `${d.usuario.nome} deixou de atuar como ${ROTULOS_PAPEL[d.papel].toLowerCase()}.` }),
                            onError: (e) => avisar({ tipo: 'erro', titulo: 'A designação não foi encerrada', mensagem: e.message }),
                          },
                        )
                      }
                    >
                      Encerrar
                    </Botao>
                  ),
                }
              : undefined
          }
        />
        {encerradas.length > 0 ? (
          <details>
            <summary>Designações encerradas ({encerradas.length})</summary>
            <ul className="lista-simples">
              {encerradas.map((d) => (
                <li key={d.id}>
                  {ROTULOS_PAPEL[d.papel]}: {d.usuario.nome}, de {formatarData(d.inicio)} a {formatarData(d.fim ?? d.inicio)}
                  {d.motivoEncerramento ? ` — ${d.motivoEncerramento}` : ''}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Secao>

      <Secao
        titulo="Livro de ocorrências"
        id="livro-ocorrencias"
        nivel={3}
        descricao={<p>Ocorrências da execução, com a providência determinada e o prazo para regularização (art. 117, § 1º).</p>}
        acoes={
          podeRegistrar ? (
            <Botao variante="primario" icone={BookOpenText} onClick={() => definirRegistrando(true)}>
              Registrar ocorrência
            </Botao>
          ) : null
        }
      >
        <Tabela
          id="contrato-ocorrencias"
          legenda="Livro de ocorrências do contrato"
          colunas={colunasOcorrencias}
          linhas={execucao.ocorrencias}
          chave={(o) => o.id}
          semFerramentas
          vazio={<EstadoVazio icone={BookOpenText} titulo="Nenhuma ocorrência registrada" />}
          acoes={
            podeRegistrar
              ? {
                  cabecalho: 'Ações',
                  celula: (o) =>
                    o.situacao === 'aberta' ? (
                      <Botao tamanho="compacto" variante="secundario" aria-label={`Regularizar a ocorrência nº ${o.numero}`} onClick={() => definirRegularizando(o)}>
                        Regularizar
                      </Botao>
                    ) : (
                      <span className="texto-pequeno texto-secundario">—</span>
                    ),
                }
              : undefined
          }
        />
      </Secao>

      <Secao
        titulo="Reservas legais de cargos"
        id="reservas-cargos"
        nivel={3}
        descricao={
          <p>
            Verificação mensal das vagas reservadas exigidas no edital e das cotas da empresa (art. 92, XVII; Decretos 11.430/2023 e 9.450/2018). Com
            pendência, a verificação entra no livro de ocorrências.
          </p>
        }
        acoes={
          podeRegistrar ? (
            <Botao variante="secundario" icone={Users} onClick={() => definirVerificando(true)}>
              Registrar verificação
            </Botao>
          ) : null
        }
      >
        {execucao.reservasCargos.length === 0 ? (
          <p className="texto-secundario">Nenhuma verificação registrada.</p>
        ) : (
          <ul className="lista-simples">
            {execucao.reservasCargos.map((v) => (
              <li key={v.id}>
                <Etiqueta tom={v.atende ? 'sucesso' : 'aviso'} compacta>
                  {v.atende ? 'Atendidas' : 'Com pendência'}
                </Etiqueta>{' '}
                Competência {v.competencia.split('-').reverse().join('/')}, {v.empregados} empregados no contrato
                {v.pendencias.length > 0 ? `: ${v.pendencias.join(' ')}` : '.'}
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {podeRegistrar ? <DialogoReservas contrato={contrato} aberto={verificando} aoFechar={() => definirVerificando(false)} /> : null}
      {podeDesignar ? <DialogoDesignar contrato={contrato} aberto={designando} aoFechar={() => definirDesignando(false)} /> : null}
      {podeRegistrar ? <DialogoOcorrencia contrato={contrato} aberto={registrando} aoFechar={() => definirRegistrando(false)} /> : null}
      <DialogoRegularizar ocorrencia={regularizando} aoFechar={() => definirRegularizando(null)} />
    </div>
  );
}

export function AbaFiscalizacao({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useExecucaoContrato(contrato.id);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={4} />} rotuloCarregando="Carregando a fiscalização do contrato">
      {(execucao) => <ConteudoFiscalizacao contrato={contrato} execucao={execucao} />}
    </ConteudoConsulta>
  );
}
