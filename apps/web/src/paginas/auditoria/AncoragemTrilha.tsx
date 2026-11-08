/**
 * Carimbo de tempo da trilha (RNF-09), na tela da trilha de auditoria: ancoragens periódicas do hash da cadeia numa
 * autoridade de carimbo do tempo RFC 3161 (ou registro local no modo offline) e a verificação de cada uma.
 */
import { useId, useState } from 'react';
import { Anchor, ShieldCheck } from 'lucide-react';
import { useAncoragens, useAncorarTrilha, useVerificacaoAncoragens } from '../../api/sigilo';
import { Alerta, Botao, ConteudoConsulta, EsqueletoTexto, Etiqueta, Secao, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { abreviarHash, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';

function ResultadoAncoragens({ solicitada }: { solicitada: number }) {
  const consulta = useVerificacaoAncoragens(solicitada);
  if (solicitada === 0) return null;
  if (consulta.isFetching && consulta.data === undefined) {
    return (
      <Alerta tipo="info" anunciar>
        Verificando as ancoragens… a cadeia é recalculada e cada carimbo é conferido.
      </Alerta>
    );
  }
  if (consulta.isError) return <ErroOperacao erro={consulta.error} titulo="Não foi possível verificar as ancoragens" />;
  const v = consulta.data;
  if (!v) return null;
  const avisos = [...new Set(v.ancoragens.flatMap((a) => a.avisos))];
  if (v.divergentes === 0) {
    return (
      <Alerta tipo="sucesso" anunciar titulo="Ancoragens íntegras">
        <p>
          {formatarNumero(v.integras)} {v.integras === 1 ? 'ancoragem conferida' : 'ancoragens conferidas'} em {formatarInstante(v.verificadoEm)}: o hash da cadeia em cada
          evento ancorado não mudou{v.ancoragens.some((a) => a.modo === 'rfc3161') ? ' e as assinaturas dos carimbos conferem' : ''}.
        </p>
        {avisos.length > 0 ? (
          <ul className="lista-simples texto-pequeno">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
      </Alerta>
    );
  }
  return (
    <Alerta tipo="erro" anunciar titulo="Ancoragem divergente">
      <ul className="lista-simples">
        {v.ancoragens
          .filter((a) => a.situacao === 'divergente')
          .map((a) => (
            <li key={a.ancoragemId}>
              Evento #{formatarNumero(a.sequencia)}: {a.problemas.join(' ')}
            </li>
          ))}
      </ul>
      <p>Preserve as evidências e acione a equipe de segurança da informação do órgão.</p>
    </Alerta>
  );
}

export function AncoragemTrilha() {
  const consulta = useAncoragens();
  const ancorar = useAncorarTrilha();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const [solicitada, definirSolicitada] = useState(0);
  const verificacao = useVerificacaoAncoragens(solicitada);
  const idTabela = useId();

  const verificar = () => {
    if (solicitada > 0) void verificacao.refetch();
    definirSolicitada((n) => n + 1);
  };

  return (
    <Secao
      titulo="Carimbo de tempo da trilha"
      id="ancoragem-trilha"
      descricao="Periodicamente, o servidor ancora o hash da cadeia: com a autoridade de carimbo do tempo configurada pelo órgão (RFC 3161), o horário é atestado por terceiro; no modo offline, a ancoragem é registrada localmente."
      acoes={
        <>
          {temPermissao('auditoria:ancorar') ? (
            <Botao
              icone={Anchor}
              carregando={ancorar.isPending}
              onClick={() =>
                ancorar.mutate(undefined, {
                  onSuccess: (a) =>
                    avisar({
                      tipo: 'sucesso',
                      titulo: 'Trilha ancorada',
                      mensagem: `Até o evento #${formatarNumero(a.sequencia)}, ${a.modo === 'rfc3161' ? 'com carimbo do tempo' : 'em registro local (modo offline)'}.`,
                    }),
                })
              }
            >
              Ancorar agora
            </Botao>
          ) : null}
          <Botao icone={ShieldCheck} carregando={verificacao.isFetching} onClick={verificar}>
            Verificar ancoragens
          </Botao>
        </>
      }
    >
      <ErroOperacao erro={ancorar.error} titulo="A trilha não foi ancorada" />
      <ResultadoAncoragens solicitada={solicitada} />
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={3} />} rotuloCarregando="Carregando as ancoragens">
        {(s) => (
          <div className="pilha">
            <p className="texto-pequeno">
              {s.modo === 'rfc3161' ? (
                <>
                  Autoridade de carimbo do tempo: <span className="mono">{s.autoridade}</span>.
                </>
              ) : (
                'Modo offline: sem autoridade de carimbo configurada (AGORA_CARIMBO_TEMPO_URL), a ancoragem é registrada localmente.'
              )}{' '}
              Intervalo: a cada {formatarNumero(s.intervaloHoras)} {s.intervaloHoras === 1 ? 'hora' : 'horas'}. {s.proxima.motivo}
            </p>
            {s.itens.length === 0 ? (
              <p>Nenhuma ancoragem registrada ainda.</p>
            ) : (
              <div className="tabela-rolagem" role="region" aria-labelledby={idTabela} tabIndex={0}>
                <table className="tabela tabela--compacta">
                  <caption id={idTabela} className="tabela__legenda">
                    Ancoragens mais recentes
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Ancorada em</th>
                      <th scope="col">Até o evento</th>
                      <th scope="col">Hash da cadeia</th>
                      <th scope="col">Modo</th>
                      <th scope="col">Carimbo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.itens.slice(0, 5).map((a) => (
                      <tr key={a.id}>
                        <td className="numero sem-quebra">{formatarInstante(a.ancoradaEm)}</td>
                        <th scope="row" className="numero">
                          #{formatarNumero(a.sequencia)}
                        </th>
                        <td>
                          <code className="mono" title={a.hash}>
                            {abreviarHash(a.hash)}
                          </code>
                        </td>
                        <td>
                          <Etiqueta tom={a.modo === 'rfc3161' ? 'sucesso' : 'neutro'} compacta>
                            {a.modo === 'rfc3161' ? 'RFC 3161' : 'Local (offline)'}
                          </Etiqueta>
                        </td>
                        <td className="texto-pequeno">
                          {a.carimboEm ? `${formatarInstante(a.carimboEm)} — série ${a.numeroSerie ?? '—'}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </ConteudoConsulta>
    </Secao>
  );
}
