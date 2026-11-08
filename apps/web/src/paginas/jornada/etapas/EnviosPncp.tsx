/**
 * Situação dos envios ao PNCP (RF-19): cada documento passa pela fila de integrações do servidor (RNF-07), com
 * nova tentativa automática quando o PNCP está fora do ar. Mostra protocolo, número de controle, hash do arquivo e o
 * link público do inteiro teor. Atualiza sozinho enquanto houver envio na fila.
 */
import { useEffect, useId, useRef } from 'react';
import { FileText } from 'lucide-react';
import type { EnvioPncp, ProcessoDetalhe, SituacaoEnvioPncp } from '@agora/contratos';
import { usePublicacaoPncp } from '../../../api/fila';
import { Alerta, BotaoCopiar, Etiqueta, LinkBotao, LinkExterno, ListaDefinicoes, type TomEtiqueta } from '../../../componentes';
import { abreviarHash, formatarInstante } from '../../../utilitarios/formatacao';

export const SITUACOES_ENVIO: Record<SituacaoEnvioPncp, { rotulo: string; tom: TomEtiqueta }> = {
  na_fila: { rotulo: 'Na fila', tom: 'info' },
  enviando: { rotulo: 'Enviando', tom: 'info' },
  nova_tentativa: { rotulo: 'Aguardando nova tentativa', tom: 'aviso' },
  publicado: { rotulo: 'Publicado', tom: 'sucesso' },
  erro: { rotulo: 'Na fila de erro', tom: 'erro' },
};

/** Um envio: situação, protocolo, tentativas e o motivo da falha, quando houver. */
export function CartaoEnvioPncp({ envio }: { envio: EnvioPncp }) {
  const situacao = SITUACOES_ENVIO[envio.situacao];
  return (
    <li className="cartao pilha pilha--compacta">
      <p className="texto-forte">
        {envio.titulo}{' '}
        <Etiqueta tom={situacao.tom} compacta>
          {situacao.rotulo}
        </Etiqueta>
      </p>
      <ListaDefinicoes
        colunas={3}
        itens={[
          {
            termo: 'Protocolo do PNCP',
            valor: envio.protocolo ? (
              <BotaoCopiar valor={envio.protocolo} rotulo={`o protocolo de ${envio.titulo.toLowerCase()}`} />
            ) : (
              'Atribuído quando o PNCP aceitar o envio'
            ),
            largo: true,
          },
          { termo: 'Tentativas', valor: <span className="numero">{`${envio.tentativas} de ${envio.maximoTentativas}`}</span> },
          {
            termo: 'Enviado em',
            valor: envio.enviadoEm ? (
              <time dateTime={envio.enviadoEm} className="numero">
                {formatarInstante(envio.enviadoEm)}
              </time>
            ) : (
              'Ainda não enviado'
            ),
          },
          {
            termo: 'Hash do arquivo (SHA-256)',
            valor: envio.hashArquivo ? (
              <code title={envio.hashArquivo}>
                <span aria-hidden="true">{abreviarHash(envio.hashArquivo)}</span>
                <span className="sr-only">{envio.hashArquivo}</span>
              </code>
            ) : (
              '—'
            ),
          },
        ]}
      />
      {envio.situacao === 'nova_tentativa' && envio.proximaTentativaEm ? (
        <p className="texto-pequeno">
          O PNCP não respondeu. Nova tentativa automática em{' '}
          <time dateTime={envio.proximaTentativaEm} className="numero">
            {formatarInstante(envio.proximaTentativaEm)}
          </time>
          {envio.ultimoErro ? <span className="texto-secundario"> — {envio.ultimoErro}</span> : null}
        </p>
      ) : null}
      {envio.situacao === 'erro' ? (
        <Alerta tipo="erro" compacto titulo="O envio não foi aceito">
          <p>{envio.ultimoErro ?? 'Falha sem mensagem do PNCP.'}</p>
          <p>
            Corrija o que o PNCP apontou e use “Publicar” de novo, ou peça a quem administra as integrações que reprocesse o envio na tela de
            integrações. Nada é reenviado sem essa ação.
          </p>
        </Alerta>
      ) : null}
    </li>
  );
}

export default function EnviosPncp({ processo }: { processo: ProcessoDetalhe }) {
  const titulo = useId();
  const consulta = usePublicacaoPncp(processo.id);
  const { refetch } = consulta;
  const publicacao = consulta.data;
  const situacaoAnterior = useRef(`${processo.publicacao.pncp}|${processo.publicacao.idPncp ?? ''}`);

  // A publicação muda pelo trabalhador da fila: quando a situação gravada no processo muda, os envios são relidos.
  useEffect(() => {
    const atual = `${processo.publicacao.pncp}|${processo.publicacao.idPncp ?? ''}`;
    if (atual === situacaoAnterior.current) return;
    situacaoAnterior.current = atual;
    void refetch();
  }, [processo.publicacao.pncp, processo.publicacao.idPncp, refetch]);

  if (!publicacao || (publicacao.envios.length === 0 && processo.publicacao.pncp === 'nao_publicado')) return null;
  const simulado = publicacao.envios.some((e) => e.modo === 'offline');

  return (
    <section className="pilha pilha--compacta" aria-labelledby={titulo} aria-live="polite">
      <h4 id={titulo} className="jornada-seletor__titulo">
        Envios ao PNCP
      </h4>
      {simulado ? (
        <p className="texto-pequeno texto-secundario">
          Simulação: as integrações estão em modo offline. Protocolo e número de controle são gerados pela Ágora, de forma reproduzível, e nada
          foi enviado ao PNCP.
        </p>
      ) : null}
      {publicacao.envios.length === 0 ? (
        <p className="texto-secundario">Publicação registrada antes da fila de integrações: não há envios detalhados.</p>
      ) : (
        <ul className="lista-simples pilha pilha--compacta">
          {publicacao.envios.map((envio) => (
            <CartaoEnvioPncp key={envio.id} envio={envio} />
          ))}
        </ul>
      )}
      {publicacao.linkPublico || publicacao.linkPncp ? (
        <div className="botoes-fontes">
          {publicacao.linkPublico ? (
            <LinkBotao to={publicacao.linkPublico} variante="secundario" icone={FileText} tamanho="compacto">
              Inteiro teor, sem login
            </LinkBotao>
          ) : null}
          {publicacao.linkPncp ? (
            <LinkExterno href={publicacao.linkPncp} comoBotao="secundario" tamanho="compacto">
              Registro no PNCP
            </LinkExterno>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
