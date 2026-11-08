/**
 * Integração com o SEI (RF-35) no processo e no documento: número do processo e dos documentos no SEI, situação da
 * assinatura feita no SEI (certificado ICP-Brasil do servidor) e os botões "Enviar ao SEI" e "Consultar assinaturas".
 * Quem fala com o SEI é o servidor, pela fila de integrações; o navegador só fala com a Ágora.
 */
import { useId, useRef } from 'react';
import { RefreshCw, Send } from 'lucide-react';
import type { DocumentoGerado, DocumentoSei, IntegracaoSeiProcesso, ProcessoDetalhe, SituacaoTarefaSei, TarefaSei } from '@agora/contratos';
import { useConsultarAssinaturasSei, useEnviarSei, useIntegracaoSei } from '../../api/sei';
import { Alerta, Botao, BotaoCopiar, Etiqueta, LinkExterno, ListaDefinicoes, useAvisos, type TomEtiqueta } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from './comum';

const SITUACOES_TAREFA: Record<SituacaoTarefaSei, { rotulo: string; tom: TomEtiqueta }> = {
  na_fila: { rotulo: 'Na fila', tom: 'info' },
  executando: { rotulo: 'Em andamento', tom: 'info' },
  nova_tentativa: { rotulo: 'Aguardando nova tentativa', tom: 'aviso' },
  concluida: { rotulo: 'Concluído', tom: 'sucesso' },
  erro: { rotulo: 'Na fila de erro', tom: 'erro' },
};

function textoAssinaturaSei(d: DocumentoSei): string {
  const primeira = [...d.assinaturas].sort((a, b) => a.assinadoEm.localeCompare(b.assinadoEm))[0];
  if (!d.assinado) return 'Aguardando assinatura no SEI';
  if (!primeira) return d.resumoAssinatura ? `Assinado por ${d.resumoAssinatura}` : 'Assinado';
  return `Assinado no SEI por ${d.resumoAssinatura} em ${formatarInstante(primeira.assinadoEm)}`;
}

/** Na simulação (modo offline) a Ágora ainda registra assinatura simulada; com o SEI real, só o SEI assina. */
export function useAssinaturaSimuladaPermitida(processoId: string): boolean {
  const consulta = useIntegracaoSei(processoId);
  return consulta.data?.modo !== 'online';
}

function SituacaoTarefa({ tarefa, acao }: { tarefa: TarefaSei | null; acao: string }) {
  if (!tarefa || tarefa.situacao === 'concluida') return null;
  const situacao = SITUACOES_TAREFA[tarefa.situacao];
  return (
    <div className="pilha pilha--compacta">
      <p className="linha texto-pequeno">
        <span>{acao}:</span>
        <Etiqueta tom={situacao.tom} compacta>
          {situacao.rotulo}
        </Etiqueta>
      </p>
      {tarefa.situacao === 'nova_tentativa' && tarefa.proximaTentativaEm ? (
        <p className="texto-pequeno">
          O SEI não respondeu. Nova tentativa automática em{' '}
          <time dateTime={tarefa.proximaTentativaEm} className="numero">
            {formatarInstante(tarefa.proximaTentativaEm)}
          </time>
          .
        </p>
      ) : null}
      {tarefa.situacao === 'erro' ? (
        <Alerta tipo="erro" compacto titulo="O SEI recusou a operação">
          <p>{tarefa.ultimoErro ?? 'Falha sem mensagem do SEI.'}</p>
          <p>Corrija o que o SEI apontou e repita a ação. Nada é reenviado sem essa ação.</p>
        </Alerta>
      ) : null}
    </div>
  );
}

/** Painel do processo: número no SEI, envio, bloco de assinatura e consulta das assinaturas. */
export function PainelSei({ processo }: { processo: ProcessoDetalhe }) {
  const titulo = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consulta = useIntegracaoSei(processo.id);
  const enviar = useEnviarSei(processo.id);
  const consultar = useConsultarAssinaturasSei(processo.id);
  const sei: IntegracaoSeiProcesso | undefined = consulta.data;
  if (!sei) return null;

  const enviados = sei.documentos.filter((d) => d.enviado);
  const blocos = [...new Set(enviados.map((d) => d.blocoAssinatura).filter((b): b is string => b !== null))];
  const podeEnviar = temPermissao('jornada:editar') && (sei.processo === null || sei.pendentesEnvio > 0);
  const podeConsultar = (temPermissao('jornada:editar') || temPermissao('jornada:aprovar_juridico')) && enviados.length > 0;
  const ocupado = enviar.isPending || consultar.isPending;

  return (
    <section className="pilha pilha--compacta" aria-labelledby={titulo} aria-live="polite">
      <h3 id={titulo} ref={tituloRef} tabIndex={-1} className="jornada-seletor__titulo">
        Integração com o SEI
      </h3>
      {sei.modo === 'offline' ? (
        <p className="texto-pequeno texto-secundario">
          Simulação: as integrações estão em modo offline. Os números e as assinaturas vêm do SEI simulado da Ágora; nada é enviado ao SEI do
          órgão e não há assinatura com certificado ICP-Brasil.
        </p>
      ) : (
        <p className="texto-pequeno texto-secundario">
          A assinatura é feita no SEI do órgão, com o certificado ICP-Brasil do servidor. A Ágora consulta o SEI e mostra quem assinou e quando.
        </p>
      )}
      {sei.modo === 'online' && !sei.configurado ? (
        <Alerta tipo="aviso" compacto titulo="SEI do órgão não configurado">
          <p>O administrador precisa cadastrar a Ágora no SEI e informar a chave de acesso no servidor.</p>
        </Alerta>
      ) : null}
      <ListaDefinicoes
        itens={[
          {
            termo: 'Processo no SEI',
            valor: sei.processo ? (
              <span className="pilha pilha--compacta">
                <BotaoCopiar valor={sei.processo.numero} rotulo="número do processo no SEI" />
                {sei.processo.link ? (
                  <LinkExterno href={sei.processo.link} tamanho="compacto">
                    Abrir no SEI
                  </LinkExterno>
                ) : null}
              </span>
            ) : (
              'Ainda não enviado'
            ),
          },
          {
            termo: 'Documentos no SEI',
            valor:
              sei.documentos.length === 0
                ? 'Nenhum documento aprovado'
                : `${enviados.length} de ${sei.documentos.length}${sei.pendentesAssinatura > 0 ? `, ${contar(sei.pendentesAssinatura, 'aguardando assinatura', 'aguardando assinatura')}` : ''}`,
          },
          ...(blocos.length > 0 ? [{ termo: 'Bloco de assinatura', valor: <span className="mono">{blocos.join(', ')}</span> }] : []),
          ...(sei.processo?.unidadeDestino
            ? [{ termo: 'Enviado à unidade', valor: <span className="mono">{sei.processo.unidadeDestino}</span> }]
            : []),
        ]}
      />
      <SituacaoTarefa tarefa={sei.envio} acao="Envio ao SEI" />
      <SituacaoTarefa tarefa={sei.consulta} acao="Consulta das assinaturas" />
      {podeEnviar || podeConsultar ? (
        <div className="botoes-fontes">
          {podeEnviar ? (
            <Botao
              tamanho="compacto"
              variante="primario"
              icone={Send}
              carregando={enviar.isPending}
              disabled={ocupado || (sei.modo === 'online' && !sei.configurado)}
              onClick={() =>
                enviar.mutate(undefined, {
                  onSuccess: (r) => {
                    // O botão some quando não resta documento a enviar: o foco vai para o título do painel.
                    tituloRef.current?.focus();
                    avisar(
                      r.envio?.situacao === 'concluida'
                        ? { tipo: 'sucesso', titulo: 'Processo enviado ao SEI', mensagem: `Processo SEI nº ${r.processo?.numero ?? '—'}.` }
                        : { tipo: 'aviso', titulo: 'Envio ao SEI na fila', mensagem: 'A Ágora tenta de novo sozinha; acompanhe a situação aqui.' },
                    );
                  },
                })
              }
            >
              Enviar ao SEI
            </Botao>
          ) : null}
          {podeConsultar ? (
            <Botao
              tamanho="compacto"
              icone={RefreshCw}
              carregando={consultar.isPending}
              disabled={ocupado || (sei.modo === 'online' && !sei.configurado)}
              onClick={() =>
                consultar.mutate(undefined, {
                  onSuccess: (r) =>
                    avisar({
                      tipo: 'sucesso',
                      titulo: 'Assinaturas consultadas no SEI',
                      mensagem: r.pendentesAssinatura === 0 ? 'Todos os documentos enviados estão assinados.' : `${contar(r.pendentesAssinatura, 'documento aguarda', 'documentos aguardam')} assinatura no SEI.`,
                    }),
                })
              }
            >
              Consultar assinaturas
            </Botao>
          ) : null}
        </div>
      ) : null}
      <ErroOperacao erro={enviar.error ?? consultar.error} titulo="Não foi possível falar com o SEI" />
    </section>
  );
}

/** Número do documento no SEI, ao lado do número da árvore. */
export function NumeroSeiDocumento({ processoId, numeroArvore }: { processoId: string; numeroArvore: string }) {
  const consulta = useIntegracaoSei(processoId);
  const doc = consulta.data?.documentos.find((d) => d.numeroArvore === numeroArvore && d.enviado);
  if (!doc?.numeroSei) return null;
  return (
    <span className="texto-pequeno texto-secundario">
      SEI nº <span className="mono">{doc.numeroSei}</span>
      {doc.nivelAcesso === 'restrito' ? ' · restrito' : ''}
    </span>
  );
}

/** No documento da etapa: número SEI, situação da assinatura no SEI e "Enviar ao SEI" para o aprovado ainda fora dele. */
export function SituacaoSeiDocumento({ processo, documento }: { processo: ProcessoDetalhe; documento: DocumentoGerado }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consulta = useIntegracaoSei(processo.id);
  const enviar = useEnviarSei(processo.id);
  const linhaRef = useRef<HTMLParagraphElement>(null);
  if (documento.situacao !== 'aprovado' || !documento.numeroSei || !consulta.data) return null;
  const doc = consulta.data.documentos.find((d) => d.numeroArvore === documento.numeroSei);
  if (!doc) return null;
  if (doc.enviado) {
    return (
      <p ref={linhaRef} tabIndex={-1} className="linha texto-pequeno">
        <span>
          SEI nº <span className="mono">{doc.numeroSei}</span>
        </span>
        <Etiqueta tom={doc.assinado ? 'sucesso' : 'aviso'} compacta>
          {textoAssinaturaSei(doc)}
        </Etiqueta>
      </p>
    );
  }
  const podeEnviar = temPermissao('jornada:editar') && !(consulta.data.modo === 'online' && !consulta.data.configurado);
  return (
    <p className="linha texto-pequeno">
      <Etiqueta compacta>Não enviado ao SEI</Etiqueta>
      {podeEnviar ? (
        <Botao
          tamanho="compacto"
          icone={Send}
          carregando={enviar.isPending}
          aria-label={`Enviar ao SEI — ${documento.titulo}`}
          onClick={() =>
            enviar.mutate(undefined, {
              onSuccess: (r) => {
                avisar(
                  r.envio?.situacao === 'concluida'
                    ? { tipo: 'sucesso', titulo: 'Enviado ao SEI', mensagem: `Processo SEI nº ${r.processo?.numero ?? '—'}.` }
                    : { tipo: 'aviso', titulo: 'Envio ao SEI na fila', mensagem: 'A Ágora tenta de novo sozinha.' },
                );
                // O botão dá lugar ao número SEI do documento: o foco segue para essa linha.
                requestAnimationFrame(() => linhaRef.current?.focus());
              },
            })
          }
        >
          Enviar ao SEI
        </Botao>
      ) : null}
    </p>
  );
}
