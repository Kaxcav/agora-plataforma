/**
 * Sala de uma sessão: situação e cronômetro, comandos de quem conduz, quadro de participantes e de lances, sinais
 * para análise (RIA-09 e RIA-06), julgamento, dados oficiais, cronologia e ata. A sessão é consultada periodicamente
 * durante a etapa de lances; o cronômetro anda no navegador entre uma consulta e outra.
 */
import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CircleStop, FastForward, FileText, Gavel, Handshake, Play, RefreshCw, RotateCcw, Send, TimerReset, Upload } from 'lucide-react';
import type { SessaoDisputa, SinalSessaoDisputa } from '@agora/contratos';
import { formatarMoeda, somenteDigitos } from '@agora/dominio';
import {
  useAbrirSessao,
  useAdiantarRelogio,
  useAtaSessao,
  useEncerrarSessao,
  useNegociar,
  useRegistrarLance,
  useReiniciarDisputa,
  useSincronizarSessao,
  useTranscreverLances,
} from '../../api/disputa';
import { Alerta, AreaTexto, Botao, CampoMoeda, CampoTexto, Carregando, ConfirmarAcao, Etiqueta, LinkBotao, ListaDefinicoes, Secao, Selecao, useAvisos } from '../../componentes';
import { abreviarHash, formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import {
  formatarCronometro,
  formatarHora,
  oferta,
  ROTULOS_CRITERIO,
  ROTULOS_ETAPA_LANCE,
  ROTULOS_FASE,
  ROTULOS_MODO,
  ROTULOS_ORIGEM,
  ROTULOS_PERFIL,
  ROTULOS_USO,
  TOM_FASE,
} from './rotulos';

const Markdown = lazy(() => import('../jornada/Markdown').then((m) => ({ default: m.Markdown })));

const FASES_COM_PRAZO = new Set<SessaoDisputa['fase']>(['lances_abertos', 'fechamento_iminente', 'lance_final_fechado']);
const LANCES_VISIVEIS = 30;

/** Relógio da sessão no navegador: o "agora" do servidor mais o tempo decorrido desde a resposta. */
function useRelogioSessao(sessao: SessaoDisputa, recebidaEm: number): number {
  const [agoraLocal, definirAgoraLocal] = useState(() => Date.now());
  const aoVivo = FASES_COM_PRAZO.has(sessao.fase);
  useEffect(() => {
    if (!aoVivo) return undefined;
    const intervalo = window.setInterval(() => definirAgoraLocal(Date.now()), 1_000);
    return () => window.clearInterval(intervalo);
  }, [aoVivo]);
  return Date.parse(sessao.agora) + Math.max(0, agoraLocal - recebidaEm);
}

function ValorOferta({ sessao, rotulo, valor, aoMudar }: { sessao: SessaoDisputa; rotulo: string; valor: number | null; aoMudar: (v: number | null) => void }) {
  const [texto, definirTexto] = useState(valor === null ? '' : String(valor).replace('.', ','));
  if (sessao.criterio !== 'maior_desconto') return <CampoMoeda rotulo={rotulo} valor={valor} aoMudar={aoMudar} />;
  return (
    <CampoTexto
      rotulo={`${rotulo} (% de desconto)`}
      inputMode="decimal"
      value={texto}
      onChange={(e) => {
        definirTexto(e.target.value);
        const numero = Number(e.target.value.replace(',', '.'));
        aoMudar(e.target.value.trim() === '' || !Number.isFinite(numero) ? null : numero);
      }}
    />
  );
}

function CartaoSinal({ sinal }: { sinal: SinalSessaoDisputa }) {
  return (
    <Alerta tipo="aviso" titulo={`${sinal.titulo} (${sinal.regra})`}>
      {sinal.reforcadoPorVinculo ? (
        <p>
          <Etiqueta tom="erro" compacta>
            Reforçado por vínculo societário
          </Etiqueta>
        </p>
      ) : null}
      <ul>
        {sinal.evidencias.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <p className="texto-pequeno">Fundamento: {sinal.fundamento}.</p>
      <p className="texto-pequeno texto-forte">{sinal.aviso}</p>
    </Alerta>
  );
}

function Comandos({ sessao }: { sessao: SessaoDisputa }) {
  const base = useId();
  const { avisar } = useAvisos();
  const abrir = useAbrirSessao(sessao.id, sessao.processoId);
  const relogio = useAdiantarRelogio(sessao.id, sessao.processoId);
  const lance = useRegistrarLance(sessao.id, sessao.processoId);
  const sincronizar = useSincronizarSessao(sessao.id, sessao.processoId);
  const transcrever = useTranscreverLances(sessao.id, sessao.processoId);
  const reiniciar = useReiniciarDisputa(sessao.id, sessao.processoId);
  const negociar = useNegociar(sessao.id, sessao.processoId);
  const encerrar = useEncerrarSessao(sessao.id, sessao.processoId);
  const convocados = sessao.participantes.filter((p) => p.convocado);
  const [participante, definirParticipante] = useState(convocados[0]?.chave ?? '');
  const [valorLance, definirValorLance] = useState<number | null>(null);
  const [linhas, definirLinhas] = useState('');
  const [erroLinhas, definirErroLinhas] = useState<string | null>(null);
  const [dialogo, definirDialogo] = useState<'reinicio' | 'negociacao' | 'encerramento' | null>(null);
  const [justificativa, definirJustificativa] = useState('');
  const [valorNegociado, definirValorNegociado] = useState<number | null>(null);
  const a = sessao.acoes;
  const primeiro = sessao.julgamento?.classificacao[0] ?? null;

  if (!Object.values(a).some(Boolean)) return null;

  const enviarLance = (evento: FormEvent) => {
    evento.preventDefault();
    if (valorLance === null) return;
    const escolhido = participante || convocados[0]?.chave || '';
    lance.mutate(
      { participante: escolhido, valor: valorLance },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Lance registrado', mensagem: `Lance de treino de ${oferta(sessao, valorLance)}.` }) },
    );
  };

  const enviarTranscricao = (evento: FormEvent) => {
    evento.preventDefault();
    const lances: { documento: string; valor: number; instante: string }[] = [];
    for (const [i, linha] of linhas.split(/\r?\n/).entries()) {
      if (linha.trim() === '') continue;
      const [documento = '', valor = '', instante = ''] = linha.split(';').map((c) => c.trim());
      const numero = Number(valor.replace(/\./g, '').replace(',', '.'));
      const data = Date.parse(instante.includes('T') ? instante : instante.replace(' ', 'T'));
      if (somenteDigitos(documento).length < 11 || !Number.isFinite(numero) || !Number.isFinite(data)) {
        definirErroLinhas(`Linha ${i + 1}: use “CNPJ; valor; data e hora” (ex.: 11222333000181; 1.234,56; 2026-11-05T10:01:30-03:00).`);
        return;
      }
      lances.push({ documento, valor: sessao.criterio === 'maior_desconto' ? numero : Math.round(numero * 100), instante: new Date(data).toISOString() });
    }
    if (lances.length === 0) {
      definirErroLinhas('Cole ao menos uma linha.');
      return;
    }
    definirErroLinhas(null);
    transcrever.mutate(
      { lances },
      {
        onSuccess: () => {
          definirLinhas('');
          avisar({ tipo: 'sucesso', titulo: 'Lances transcritos', mensagem: `${lances.length} lance(s) incluído(s) para os sinais.` });
        },
      },
    );
  };

  const fecharDialogo = () => {
    definirDialogo(null);
    definirJustificativa('');
    definirValorNegociado(null);
    reiniciar.reset();
    negociar.reset();
    encerrar.reset();
  };

  return (
    <Secao titulo="Condução da sessão" nivel={3} descricao="Somente o agente de contratação conduz. Cada comando fica registrado na trilha de auditoria.">
      <div className="pilha">
        <div className="linha" role="group" aria-label="Comandos da sessão">
          {a.abrir ? (
            <Botao variante="primario" icone={Play} carregando={abrir.isPending} onClick={() => abrir.mutate(undefined, { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Sessão aberta', mensagem: 'A etapa de lances começou.' }) })}>
              Abrir sessão
            </Botao>
          ) : null}
          {a.adiantarRelogio ? (
            <>
              <Botao icone={TimerReset} carregando={relogio.isPending && relogio.variables?.avancar === 'minuto'} disabled={relogio.isPending} onClick={() => relogio.mutate({ avancar: 'minuto' })}>
                Adiantar 1 minuto
              </Botao>
              <Botao icone={FastForward} carregando={relogio.isPending && relogio.variables?.avancar === 'fim_da_etapa'} disabled={relogio.isPending} onClick={() => relogio.mutate({ avancar: 'fim_da_etapa' })}>
                Avançar até o fim da etapa
              </Botao>
            </>
          ) : null}
          {a.sincronizar ? (
            <Botao icone={RefreshCw} carregando={sincronizar.isPending} onClick={() => sincronizar.mutate(undefined, { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Compras.gov.br consultado', mensagem: 'Dados da compra e do resultado atualizados.' }) })}>
              Consultar o Compras.gov.br
            </Botao>
          ) : null}
          {a.reiniciar ? (
            <Botao icone={RotateCcw} onClick={() => definirDialogo('reinicio')}>
              Reiniciar a disputa aberta
            </Botao>
          ) : null}
          {a.negociar ? (
            <Botao icone={Handshake} onClick={() => definirDialogo('negociacao')}>
              Registrar negociação
            </Botao>
          ) : null}
          {a.encerrar ? (
            <Botao variante="primario" icone={CircleStop} onClick={() => definirDialogo('encerramento')}>
              Encerrar e registrar resultado
            </Botao>
          ) : null}
        </div>
        <ErroOperacao erro={abrir.error ?? relogio.error ?? sincronizar.error} />

        {a.registrarLance && convocados.length > 0 ? (
          <form className="disputa-lance" onSubmit={enviarLance} noValidate aria-labelledby={`${base}-lance`}>
            <h4 id={`${base}-lance`} className="disputa-subtitulo">
              Lance de treino
            </h4>
            <p className="texto-pequeno texto-secundario">Registre um lance em nome de um participante para treinar o rito; os licitantes sintéticos reagem a ele.</p>
            <div className="formulario__linha">
              <Selecao
                rotulo="Participante"
                opcoes={convocados.map((p) => ({ valor: p.chave, rotulo: `${p.rotulo} — oferta atual ${oferta(sessao, p.ofertaAtual)}` }))}
                value={participante || convocados[0]?.chave}
                onChange={(e) => definirParticipante(e.target.value)}
              />
              <ValorOferta sessao={sessao} rotulo="Valor do lance" valor={valorLance} aoMudar={definirValorLance} />
            </div>
            <ErroOperacao erro={lance.error} titulo="Lance recusado" />
            <div>
              <Botao type="submit" icone={Send} carregando={lance.isPending} disabled={valorLance === null}>
                Registrar lance de treino
              </Botao>
            </div>
          </form>
        ) : null}

        {a.transcreverLances ? (
          <form className="pilha pilha--compacta" onSubmit={enviarTranscricao} noValidate aria-labelledby={`${base}-transcricao`}>
            <h4 id={`${base}-transcricao`} className="disputa-subtitulo">
              Transcrever lances da sessão oficial
            </h4>
            <AreaTexto
              rotulo="Lances, um por linha: CNPJ; valor; data e hora"
              ajuda="Copie do relatório de lances do Compras.gov.br. Servem só para os sinais de padrão de lances (RIA-09)."
              rows={5}
              maxLength={40_000}
              value={linhas}
              onChange={(e) => definirLinhas(e.target.value)}
            />
            {erroLinhas ? (
              <Alerta tipo="erro" anunciar compacto>
                <p>{erroLinhas}</p>
              </Alerta>
            ) : null}
            <ErroOperacao erro={transcrever.error} titulo="Transcrição não gravada" />
            <div>
              <Botao type="submit" icone={Upload} carregando={transcrever.isPending}>
                Transcrever lances
              </Botao>
            </div>
          </form>
        ) : null}
      </div>

      <ConfirmarAcao
        aberto={dialogo === 'reinicio'}
        aoFechar={fecharDialogo}
        titulo="Reiniciar a disputa aberta"
        descricao={sessao.julgamento?.reinicio.motivo}
        rotuloConfirmar="Reiniciar"
        processando={reiniciar.isPending}
        erro={reiniciar.error}
        confirmarDesabilitado={justificativa.trim().length < 20}
        aoConfirmar={() => reiniciar.mutate(justificativa, { onSuccess: fecharDialogo })}
        largura="media"
      >
        <p className="texto-pequeno">Só os demais colocados participam, com lances intermediários, para definir as outras colocações (art. 56, § 4º).</p>
        <AreaTexto rotulo="Justificativa" obrigatorio contador maxLength={2000} rows={3} value={justificativa} onChange={(e) => definirJustificativa(e.target.value)} />
      </ConfirmarAcao>

      <ConfirmarAcao
        aberto={dialogo === 'negociacao'}
        aoFechar={fecharDialogo}
        titulo="Registrar negociação com o primeiro colocado"
        descricao={primeiro ? `${primeiro.rotulo}: oferta atual de ${oferta(sessao, primeiro.valorOfertado)}. A nova oferta precisa ser mais vantajosa (art. 61).` : undefined}
        rotuloConfirmar="Registrar negociação"
        processando={negociar.isPending}
        erro={negociar.error}
        confirmarDesabilitado={valorNegociado === null || justificativa.trim().length < 10}
        aoConfirmar={() => valorNegociado !== null && negociar.mutate({ valor: valorNegociado, justificativa }, { onSuccess: fecharDialogo })}
        largura="media"
      >
        <ValorOferta sessao={sessao} rotulo="Oferta negociada" valor={valorNegociado} aoMudar={definirValorNegociado} />
        <AreaTexto rotulo="Registro da negociação" obrigatorio contador maxLength={2000} rows={3} value={justificativa} onChange={(e) => definirJustificativa(e.target.value)} />
      </ConfirmarAcao>

      <ConfirmarAcao
        aberto={dialogo === 'encerramento'}
        aoFechar={fecharDialogo}
        titulo="Encerrar a sessão e registrar o resultado"
        descricao="A ata é gerada para revisão humana e a classificação substitui o registro da disputa na etapa 6 do processo."
        rotuloConfirmar="Encerrar e registrar"
        processando={encerrar.isPending}
        erro={encerrar.error}
        aoConfirmar={() =>
          encerrar.mutate(undefined, {
            onSuccess: () => {
              fecharDialogo();
              avisar({ tipo: 'sucesso', titulo: 'Sessão encerrada', mensagem: 'Resultado registrado no processo e ata emitida para revisão.' });
            },
          })
        }
      >
        {primeiro ? (
          <p>
            Primeiro colocado: <strong>{primeiro.rotulo}</strong> — {formatarMoeda(primeiro.valorConsiderado)}.
          </p>
        ) : null}
      </ConfirmarAcao>
    </Secao>
  );
}

function Ata({ sessao }: { sessao: SessaoDisputa }) {
  const [visivel, definirVisivel] = useState(false);
  const ata = useAtaSessao(sessao.id, visivel);
  return (
    <Secao
      titulo="Ata da sessão"
      nivel={3}
      descricao={sessao.fase === 'concluida' ? 'Ata emitida na conclusão: rascunho para revisão humana antes de juntar ao processo.' : 'Prévia da ata; a versão final é emitida ao encerrar.'}
      acoes={
        <Botao tamanho="compacto" icone={FileText} aria-expanded={visivel} onClick={() => definirVisivel((v) => !v)}>
          {visivel ? 'Ocultar ata' : 'Ver ata'}
        </Botao>
      }
    >
      {visivel ? (
        ata.data ? (
          <div className="disputa-ata">
            <Suspense fallback={<Carregando rotulo="Carregando a ata" />}>
              <Markdown conteudo={ata.data.texto} nivelInicial={4} rotuloTabelas="Tabela da ata" />
            </Suspense>
          </div>
        ) : ata.isError ? (
          <ErroOperacao erro={ata.error} titulo="Não foi possível gerar a ata" />
        ) : (
          <Carregando rotulo="Gerando a ata" />
        )
      ) : null}
    </Secao>
  );
}

export function PainelSessao({ sessao, recebidaEm }: { sessao: SessaoDisputa; recebidaEm: number }) {
  const base = useId();
  const agora = useRelogioSessao(sessao, recebidaEm);
  const [todos, definirTodos] = useState(false);
  const [anuncio, definirAnuncio] = useState('');
  const faseAnterior = useRef(sessao.fase);
  useEffect(() => {
    if (faseAnterior.current !== sessao.fase) {
      faseAnterior.current = sessao.fase;
      definirAnuncio(`Situação da sessão: ${ROTULOS_FASE[sessao.fase]}.`);
    }
  }, [sessao.fase]);

  const restante = sessao.fimPrevisto ? Date.parse(sessao.fimPrevisto) - agora : null;
  const lancesRecentes = [...sessao.lances].reverse();
  const lancesExibidos = todos ? lancesRecentes : lancesRecentes.slice(0, LANCES_VISIVEIS);
  const julgamento = sessao.julgamento;

  return (
    <div className="pilha pilha--ampla">
      <section className="secao disputa-situacao" aria-labelledby={`${base}-situacao`}>
        <div className="secao__cabecalho">
          <div>
            <h2 id={`${base}-situacao`} className="secao__titulo">
              {ROTULOS_USO[sessao.uso]}
            </h2>
            <p className="secao__descricao">
              {ROTULOS_CRITERIO[sessao.criterio]} · modo {ROTULOS_MODO[sessao.modo]?.toLowerCase()}
              {sessao.rodada > 0 ? ` · reinício ${sessao.rodada}` : ''}
            </p>
          </div>
          <Etiqueta tom={TOM_FASE[sessao.fase]}>{ROTULOS_FASE[sessao.fase]}</Etiqueta>
        </div>
        <div className="disputa-placar">
          <div className="disputa-placar__item">
            <span className="disputa-placar__rotulo" id={`${base}-cronometro`}>
              {sessao.fimSigiloso ? 'Encerramento' : 'Tempo restante da etapa'}
            </span>
            <span className="disputa-placar__valor numero" role="timer" aria-labelledby={`${base}-cronometro`}>
              {sessao.fimSigiloso ? 'sorteado (sigiloso)' : restante !== null ? formatarCronometro(restante) : '—'}
            </span>
          </div>
          <div className="disputa-placar__item">
            <span className="disputa-placar__rotulo">Melhor oferta</span>
            <span className="disputa-placar__valor numero">{oferta(sessao, sessao.melhorOferta)}</span>
          </div>
          <div className="disputa-placar__item">
            <span className="disputa-placar__rotulo">Lances</span>
            <span className="disputa-placar__valor numero">{sessao.lances.length}</span>
          </div>
          <div className="disputa-placar__item">
            <span className="disputa-placar__rotulo">Prorrogações</span>
            <span className="disputa-placar__valor numero">{sessao.prorrogacoes}</span>
          </div>
        </div>
        <ListaDefinicoes
          colunas={4}
          itens={[
            { termo: 'Processo', valor: <span className="mono">{sessao.numeroSei}</span> },
            { termo: 'Conduzida por', valor: sessao.conduzidaPor ?? '—' },
            { termo: 'Valor estimado', valor: sessao.valorReferencia === null ? '—' : <span className="numero">{formatarMoeda(sessao.valorReferencia)}</span> },
            {
              termo: sessao.uso === 'simulacao' ? 'Relógio da simulação' : 'Compra no Compras.gov.br',
              valor: sessao.uso === 'simulacao' ? `adiantado em ${sessao.adiantamentoSegundos} s` : <span className="mono">{sessao.idCompra}</span>,
            },
          ]}
        />
        {sessao.identidadesOcultas ? (
          <p className="texto-pequeno texto-secundario">
            Enquanto durar a etapa de lances, os licitantes aparecem sem identificação (IN SEGES/ME 73/2022, art. 21, § 6º).
            {sessao.lancesSigilosos > 0 ? ` ${sessao.lancesSigilosos} lance(s) final(is) e fechado(s) sigiloso(s) até o fim do prazo.` : ''}
          </p>
        ) : null}
        {sessao.fase === 'concluida' ? (
          <Alerta tipo="sucesso" titulo="Resultado registrado no processo">
            <p>A classificação desta sessão alimentou o registro da disputa na etapa 6.</p>
            <p>
              <LinkBotao to={`/jornada/${sessao.processoId}?etapa=6`} tamanho="compacto" icone={Gavel}>
                Ver o registro da disputa no processo
              </LinkBotao>
            </p>
          </Alerta>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">
          {anuncio}
        </p>
      </section>

      <Comandos key={`${sessao.fase}-${sessao.rodada}`} sessao={sessao} />

      <section className="secao" aria-labelledby={`${base}-sinais`}>
        <div className="secao__cabecalho">
          <div>
            <h3 id={`${base}-sinais`} className="secao__titulo">
              Sinais para análise ({sessao.sinais.length})
            </h3>
            <p className="secao__descricao">
              Padrão de lances (RIA-09) e sócio em comum (RIA-06). Sinais requerem revisão humana: não desclassificam nem constituem acusação.
            </p>
          </div>
        </div>
        {sessao.sinais.length === 0 ? (
          <p className="texto-secundario">Nenhum sinal até agora.</p>
        ) : (
          <div className="pilha pilha--compacta">
            {sessao.sinais.map((s, i) => (
              <CartaoSinal key={`${s.regra}-${s.tipo}-${i}`} sinal={s} />
            ))}
          </div>
        )}
      </section>

      <div className="disputa-quadros">
        <section className="secao" aria-labelledby={`${base}-participantes`}>
          <h3 id={`${base}-participantes`} className="secao__titulo">
            Participantes
          </h3>
          <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-tabela-participantes`} tabIndex={0}>
            <table className="tabela tabela--compacta">
              <caption id={`${base}-tabela-participantes`} className="tabela__legenda">
                Participantes e ofertas atuais
              </caption>
              <thead>
                <tr>
                  <th scope="col">Licitante</th>
                  <th scope="col" className="tabela__alinhar--fim">
                    Oferta atual
                  </th>
                  <th scope="col" className="tabela__alinhar--fim">
                    Lances
                  </th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {sessao.participantes.map((p) => (
                  <tr key={p.chave} className={p.lider ? 'tabela__linha--sucesso' : undefined}>
                    <th scope="row">
                      {p.rotulo}
                      {p.perfilSimulado ? <span className="texto-pequeno texto-secundario"> · {ROTULOS_PERFIL[p.perfilSimulado]}</span> : null}
                    </th>
                    <td className="tabela__alinhar--fim numero">{oferta(sessao, p.ofertaAtual)}</td>
                    <td className="tabela__alinhar--fim numero">{p.lances}</td>
                    <td className="texto-pequeno">
                      {[p.lider ? 'melhor oferta' : null, p.convocado ? 'convocado' : null, p.lanceFinalRegistrado ? 'lance final registrado' : null].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="secao" aria-labelledby={`${base}-lances`}>
          <div className="secao__cabecalho">
            <h3 id={`${base}-lances`} className="secao__titulo">
              Quadro de lances
            </h3>
            {sessao.lances.length > LANCES_VISIVEIS ? (
              <Botao tamanho="compacto" variante="terciario" aria-expanded={todos} onClick={() => definirTodos((v) => !v)}>
                {todos ? `Mostrar os ${LANCES_VISIVEIS} mais recentes` : `Mostrar todos (${sessao.lances.length})`}
              </Botao>
            ) : null}
          </div>
          {sessao.lances.length === 0 ? (
            <p className="texto-secundario">Nenhum lance ainda.</p>
          ) : (
            <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-tabela-lances`} tabIndex={0}>
              <table className="tabela tabela--compacta">
                <caption id={`${base}-tabela-lances`} className="tabela__legenda">
                  Lances, do mais recente ao mais antigo
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Nº</th>
                    <th scope="col">Horário</th>
                    <th scope="col">Licitante</th>
                    <th scope="col" className="tabela__alinhar--fim">
                      Oferta
                    </th>
                    <th scope="col">Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {lancesExibidos.map((l) => (
                    <tr key={l.sequencia}>
                      <th scope="row" className="numero">
                        {l.sequencia}
                      </th>
                      <td className="numero">{formatarHora(l.instante)}</td>
                      <td>{l.rotulo}</td>
                      <td className="tabela__alinhar--fim numero">{oferta(sessao, l.valor)}</td>
                      <td className="texto-pequeno">
                        {l.intermediario ? 'intermediário' : 'cobriu a melhor oferta'} · {ROTULOS_ETAPA_LANCE[l.fase]}
                        {l.rodada > 0 ? ` (reinício ${l.rodada})` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {julgamento ? (
        <section className="secao" aria-labelledby={`${base}-julgamento`}>
          <h3 id={`${base}-julgamento`} className="secao__titulo">
            Classificação e julgamento
          </h3>
          <p className="secao__descricao">{julgamento.fundamento}</p>
          {julgamento.acimaDoEstimado ? (
            <Alerta tipo="aviso" titulo="Melhor oferta acima do valor estimado">
              <p>Cabe negociar (art. 61) ou avaliar a desclassificação (art. 59, III). A decisão é do agente de contratação.</p>
            </Alerta>
          ) : null}
          <div className="tabela-rolagem" role="region" aria-labelledby={`${base}-tabela-classificacao`} tabIndex={0}>
            <table className="tabela tabela--compacta">
              <caption id={`${base}-tabela-classificacao`} className="tabela__legenda">
                Classificação da sessão
              </caption>
              <thead>
                <tr>
                  <th scope="col">Posição</th>
                  <th scope="col">Licitante</th>
                  <th scope="col" className="tabela__alinhar--fim">
                    Oferta
                  </th>
                  <th scope="col" className="tabela__alinhar--fim">
                    Valor considerado
                  </th>
                  {sessao.criterio === 'tecnica_e_preco' ? (
                    <th scope="col" className="tabela__alinhar--fim">
                      Nota final
                    </th>
                  ) : null}
                  <th scope="col">Origem</th>
                </tr>
              </thead>
              <tbody>
                {julgamento.classificacao.map((c) => (
                  <tr key={c.participante} className={c.posicao === 1 ? 'tabela__linha--sucesso' : undefined}>
                    <th scope="row" className="numero">
                      {c.posicao}º
                    </th>
                    <td>{c.rotulo}</td>
                    <td className="tabela__alinhar--fim numero">{oferta(sessao, c.valorOfertado)}</td>
                    <td className="tabela__alinhar--fim numero">{formatarMoeda(c.valorConsiderado)}</td>
                    {sessao.criterio === 'tecnica_e_preco' ? <td className="tabela__alinhar--fim numero">{c.notaFinal ?? '—'}</td> : null}
                    <td className="texto-pequeno">{ROTULOS_ORIGEM[c.origem]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {julgamento.memoria.length > 0 || julgamento.passos.length > 0 ? (
            <ul className="texto-pequeno">
              {julgamento.memoria.map((m, i) => (
                <li key={`m-${i}`}>{m}</li>
              ))}
              {julgamento.passos.map((p) => (
                <li key={`p-${p.ordem}-${p.criterio}`}>
                  Desempate — {p.criterio} ({p.fundamento}): {p.resultado}
                </li>
              ))}
            </ul>
          ) : null}
          {sessao.uso === 'simulacao' && sessao.fase === 'encerrada' ? (
            <p className="texto-pequeno texto-secundario">
              Reinício da disputa aberta: {julgamento.reinicio.motivo} ({julgamento.reinicio.fundamento})
            </p>
          ) : null}
        </section>
      ) : null}

      {sessao.oficial ? (
        <Secao titulo="Dados oficiais do Compras.gov.br" nivel={3} descricao="Consultados pelo servidor da Ágora; o navegador não acessa o Compras.gov.br.">
          <ListaDefinicoes
            colunas={3}
            itens={[
              { termo: 'Consulta', valor: sessao.oficial.modo === 'online' ? 'Dados abertos (online)' : 'Resposta simulada (modo offline)' },
              { termo: 'Consultado em', valor: formatarInstante(sessao.oficial.consultadoEm) },
              { termo: 'Registros', valor: <span className="numero">{sessao.oficial.registros}</span> },
              { termo: 'Hash do conteúdo (SHA-256)', valor: <span className="mono" title={sessao.oficial.hash}>{abreviarHash(sessao.oficial.hash)}</span> },
              { termo: 'Situação da compra', valor: sessao.oficial.compra.situacao ?? '—' },
              { termo: 'Modo de disputa oficial', valor: sessao.oficial.compra.modoDisputa ?? '—' },
            ]}
          />
          {sessao.oficial.resultados.length > 0 ? (
            <ul>
              {sessao.oficial.resultados.map((r) => (
                <li key={r.documento}>
                  {r.nome} (<span className="mono">{r.documento}</span>): {formatarMoeda(r.valorTotalHomologado)} homologados em {r.itens} item(ns)
                </li>
              ))}
            </ul>
          ) : (
            <p className="texto-secundario">O Compras.gov.br ainda não divulgou o resultado desta compra.</p>
          )}
        </Secao>
      ) : null}

      <Secao titulo="Cronologia" nivel={3}>
        {sessao.marcos.length === 0 ? (
          <p className="texto-secundario">A sessão ainda não foi aberta.</p>
        ) : (
          <ol className="disputa-cronologia">
            {sessao.marcos.map((m, i) => (
              <li key={`${m.instante}-${i}`}>
                <span className="numero">{formatarHora(m.instante)}</span> — {m.descricao} <span className="texto-pequeno texto-secundario">({m.fundamento})</span>
              </li>
            ))}
          </ol>
        )}
      </Secao>

      {sessao.fase === 'encerrada' || sessao.fase === 'concluida' ? <Ata sessao={sessao} /> : null}
    </div>
  );
}
