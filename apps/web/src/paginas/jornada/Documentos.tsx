/**
 * Documentos gerados de uma etapa: geração de rascunho (modelo de texto; IA só se habilitada no servidor),
 * visualização lado a lado (documento renderizado × premissas e fontes) e aprovação após revisão humana.
 */
import { useId, useState, type ReactNode } from 'react';
import { BadgeCheck, Eye, FilePlus, TriangleAlert, X } from 'lucide-react';
import type { DocumentoGerado, ProcessoDetalhe } from '@agora/contratos';
import { useAprovarDocumento, useGerarDocumento, type TipoDocumento } from '../../api/jornada';
import { Alerta, Botao, CaixaSelecao, ConfirmarAcao, Etiqueta, useAvisos } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from './comum';
import { Markdown } from './Markdown';
import { SITUACOES_DOCUMENTO, TIPOS_DOCUMENTO } from './rotulos';
import { ConferenciaCitacoesDocumento } from '../ia/ConferenciaCitacoesDocumento';

/** Versão mais recente de um tipo de documento. */
export function ultimaVersao(documentos: readonly DocumentoGerado[], tipo: TipoDocumento): DocumentoGerado | null {
  let maior: DocumentoGerado | null = null;
  for (const d of documentos) {
    if (d.tipo === tipo && (maior === null || d.versao > maior.versao)) maior = d;
  }
  return maior;
}

function origem(documento: DocumentoGerado): string {
  return documento.geradoPor === 'ia' ? 'IA auto-hospedada do órgão' : 'modelo de texto (sem IA)';
}

export function MarcaRevisao({ documento }: { documento: DocumentoGerado }) {
  if (documento.situacao === 'aprovado') {
    return (
      <p className="jornada-documento__marca jornada-documento__marca--aprovado">
        <BadgeCheck size={16} aria-hidden="true" />
        <span>
          Aprovado{documento.revisadoPor ? ` por ${documento.revisadoPor.nome}` : ''} após revisão humana
          {documento.numeroSei ? ` · documento SEI ${documento.numeroSei}` : ''}
        </span>
      </p>
    );
  }
  return (
    <p className="jornada-documento__marca">
      <TriangleAlert size={16} aria-hidden="true" />
      <span>Rascunho — requer revisão humana</span>
    </p>
  );
}

export function PremissasFontes({ documento, nivel = 5 }: { documento: DocumentoGerado; nivel?: 4 | 5 }) {
  const Titulo = nivel === 4 ? 'h4' : 'h5';
  return (
    <>
      <Titulo className="jornada-apoio__titulo">Premissas (dados do processo utilizados)</Titulo>
      {documento.premissas.length === 0 ? (
        <p className="texto-secundario">Nenhuma premissa registrada.</p>
      ) : (
        <ul className="jornada-apoio__lista">
          {documento.premissas.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <Titulo className="jornada-apoio__titulo">Fontes</Titulo>
      {documento.fontes.length === 0 ? (
        <p className="texto-secundario">Nenhuma fonte registrada.</p>
      ) : (
        <ul className="jornada-apoio__lista">
          {documento.fontes.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Visualizador({
  processoId,
  documento,
  podeAprovar,
  aoAprovar,
  aoFechar,
}: {
  processoId: string;
  documento: DocumentoGerado;
  podeAprovar: boolean;
  aoAprovar: () => void;
  aoFechar: () => void;
}) {
  const idTitulo = useId();
  const situacao = SITUACOES_DOCUMENTO[documento.situacao];
  return (
    <section className="jornada-visualizador" aria-labelledby={idTitulo}>
      <div className="jornada-visualizador__barra">
        <div className="pilha pilha--compacta">
          <h4 id={idTitulo} className="jornada-visualizador__titulo">
            {TIPOS_DOCUMENTO[documento.tipo].rotulo} — versão {documento.versao}
          </h4>
          <span className="linha">
            <Etiqueta tom={situacao.tom} compacta>
              {situacao.rotulo}
            </Etiqueta>
            <span className="texto-pequeno texto-secundario">Gerado por {origem(documento)}</span>
          </span>
        </div>
        <div className="linha">
          {podeAprovar && documento.situacao !== 'aprovado' && !documento.geradoComParametrosAnteriores ? (
            <Botao variante="avanco" tamanho="compacto" icone={BadgeCheck} onClick={aoAprovar}>
              Aprovar
            </Botao>
          ) : null}
          <Botao variante="terciario" tamanho="compacto" icone={X} onClick={aoFechar}>
            Fechar visualização
          </Botao>
        </div>
      </div>
      {documento.geradoComParametrosAnteriores ? (
        <Alerta tipo="aviso" compacto titulo="Versão gerada com parâmetros anteriores do edital (RN-06)">
          <p>Os parâmetros do edital mudaram depois desta versão. Gere nova versão e aprove-a: esta não pode ser aprovada nem vale para o avanço.</p>
        </Alerta>
      ) : null}
      <div className="jornada-visualizador__colunas">
        <article className="jornada-documento" aria-label={`Conteúdo: ${TIPOS_DOCUMENTO[documento.tipo].rotulo}`} tabIndex={0}>
          <MarcaRevisao documento={documento} />
          <Markdown conteudo={documento.conteudo} nivelInicial={5} rotuloTabelas={`Tabela do documento ${TIPOS_DOCUMENTO[documento.tipo].rotulo}`} />
        </article>
        <aside className="jornada-visualizador__apoio" aria-label="Premissas, fontes e registro do documento">
          <PremissasFontes documento={documento} />
          <ConferenciaCitacoesDocumento processoId={processoId} documento={documento} podeRevisar={podeAprovar} />
          <h5 className="jornada-apoio__titulo">Registro</h5>
          <dl className="jornada-apoio__registro">
            <div>
              <dt>Gerado em</dt>
              <dd className="numero">{formatarInstante(documento.geradoEm)}</dd>
            </div>
            <div>
              <dt>Revisado por</dt>
              <dd>{documento.revisadoPor?.nome ?? 'Ainda não revisado'}</dd>
            </div>
            <div>
              <dt>Documento SEI</dt>
              <dd>{documento.numeroSei ? <span className="mono">{documento.numeroSei}</span> : 'Entra na árvore após a aprovação'}</dd>
            </div>
          </dl>
          <p className="texto-pequeno texto-secundario">
            Texto gerado a partir dos dados do processo para apoiar a redação. Sempre exige leitura, ajuste e aprovação de servidor responsável.
          </p>
        </aside>
      </div>
    </section>
  );
}

export interface PropsDocumentosEtapa {
  processo: ProcessoDetalhe;
  tipos: readonly TipoDocumento[];
  editavel: boolean;
  titulo: string;
  descricao?: ReactNode;
  /** Abre a visualização do primeiro documento já gerado (etapa 4). */
  abrirPrimeiro?: boolean;
}

export function DocumentosEtapa({ processo, tipos, editavel, titulo, descricao, abrirPrimeiro }: PropsDocumentosEtapa) {
  const idTitulo = useId();
  const { avisar } = useAvisos();
  const gerar = useGerarDocumento(processo.id);
  const aprovar = useAprovarDocumento(processo.id);
  const [selecionadoId, definirSelecionadoId] = useState<string | null>(() => {
    if (!abrirPrimeiro) return null;
    for (const tipo of tipos) {
      const doc = ultimaVersao(processo.documentos, tipo);
      if (doc) return doc.id;
    }
    return null;
  });
  const [gerando, definirGerando] = useState<TipoDocumento | null>(null);
  const [aprovando, definirAprovando] = useState<DocumentoGerado | null>(null);
  const [revisado, definirRevisado] = useState(false);

  const selecionado = processo.documentos.find((d) => d.id === selecionadoId) ?? null;
  // RN-01 (roteiro PoC-01): o servidor recusa qualquer minuta enquanto houver indício de luxo sem justificativa.
  const bloqueioLuxo = processo.bloqueiosDetalhe.find((b) => b.regra === 'RN-01');

  const gerarDocumento = (tipo: TipoDocumento) => {
    definirGerando(tipo);
    gerar.mutate(tipo, {
      onSuccess: (atualizado) => {
        const novo = ultimaVersao(atualizado.documentos, tipo);
        if (novo) definirSelecionadoId(novo.id);
        avisar({
          tipo: 'sucesso',
          titulo: 'Rascunho gerado',
          mensagem: `${TIPOS_DOCUMENTO[tipo].rotulo}${novo ? `, versão ${novo.versao}` : ''}. Revise o texto, as premissas e as fontes antes de aprovar.`,
        });
      },
      onSettled: () => definirGerando(null),
    });
  };

  const fecharAprovacao = () => {
    definirAprovando(null);
    definirRevisado(false);
    aprovar.reset();
  };

  return (
    <section className="secao jornada-subsecao jornada-docs" aria-labelledby={idTitulo}>
      <div>
        <h3 id={idTitulo} className="secao__titulo">
          {titulo}
        </h3>
        {descricao ? <div className="secao__descricao">{descricao}</div> : null}
      </div>
      {editavel && bloqueioLuxo ? (
        <Alerta tipo="aviso" compacto titulo="Geração de minutas bloqueada: indício de artigo de luxo sem justificativa (RN-01)">
          <p>
            Enquanto houver item com indício de artigo de luxo sem justificativa aceita, o servidor não gera nenhuma minuta — nem com a
            redação por IA. Justifique no DFD que o bem é de qualidade comum, ou remova o item, e salve antes de gerar.
          </p>
        </Alerta>
      ) : null}
      <ul className="jornada-docs__lista">
        {tipos.map((tipo) => {
          const doc = ultimaVersao(processo.documentos, tipo);
          const situacao = doc ? SITUACOES_DOCUMENTO[doc.situacao] : null;
          const aberto = doc !== null && doc.id === selecionadoId;
          return (
            <li key={tipo} className={['jornada-docs__item', aberto ? 'jornada-docs__item--aberto' : ''].filter(Boolean).join(' ')}>
              <div className="jornada-docs__dados">
                <p className="texto-forte">{TIPOS_DOCUMENTO[tipo].rotulo}</p>
                <p className="texto-pequeno texto-secundario">{TIPOS_DOCUMENTO[tipo].fundamento}</p>
                {doc && situacao ? (
                  <p className="linha texto-pequeno">
                    <Etiqueta tom={situacao.tom} compacta>
                      {situacao.rotulo}
                    </Etiqueta>
                    {doc.geradoComParametrosAnteriores ? (
                      <Etiqueta tom="erro" compacta>
                        Parâmetros anteriores — gere nova versão
                      </Etiqueta>
                    ) : null}
                    <span className="numero">
                      Versão {doc.versao} · {formatarInstante(doc.geradoEm)}
                    </span>
                  </p>
                ) : (
                  <p className="linha texto-pequeno">
                    <Etiqueta compacta>Não gerado</Etiqueta>
                  </p>
                )}
              </div>
              <div className="jornada-docs__acoes">
                {doc ? (
                  <Botao
                    tamanho="compacto"
                    variante={aberto ? 'primario' : 'secundario'}
                    icone={Eye}
                    aria-pressed={aberto}
                    onClick={() => definirSelecionadoId(aberto ? null : doc.id)}
                  >
                    Visualizar
                  </Botao>
                ) : null}
                {editavel ? (
                  <Botao
                    tamanho="compacto"
                    icone={FilePlus}
                    carregando={gerando === tipo}
                    disabled={gerando !== null && gerando !== tipo}
                    onClick={() => gerarDocumento(tipo)}
                  >
                    {doc ? 'Gerar nova versão' : 'Gerar rascunho'}
                  </Botao>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      <ErroOperacao erro={gerar.error} titulo="Não foi possível gerar o documento" />
      {selecionado ? (
        <Visualizador
          processoId={processo.id}
          documento={selecionado}
          podeAprovar={editavel}
          aoAprovar={() => {
            aprovar.reset();
            definirRevisado(false);
            definirAprovando(selecionado);
          }}
          aoFechar={() => definirSelecionadoId(null)}
        />
      ) : null}
      <ConfirmarAcao
        aberto={aprovando !== null}
        aoFechar={fecharAprovacao}
        titulo="Aprovar documento"
        largura="media"
        variante="avanco"
        descricao={
          aprovando ? (
            <p>
              Aprova a versão {aprovando.versao} de <strong>{TIPOS_DOCUMENTO[aprovando.tipo].rotulo}</strong>. O documento deixa de ser rascunho e
              entra na árvore do processo SEI com número sequencial, para assinatura.
            </p>
          ) : null
        }
        rotuloConfirmar="Aprovar documento"
        confirmarDesabilitado={!revisado}
        aoConfirmar={() => {
          if (!aprovando) return;
          const rotulo = TIPOS_DOCUMENTO[aprovando.tipo].rotulo;
          aprovar.mutate(aprovando.id, {
            onSuccess: () => {
              avisar({ tipo: 'sucesso', titulo: 'Documento aprovado', mensagem: `${rotulo} incluído na árvore do processo SEI.` });
              fecharAprovacao();
            },
          });
        }}
        processando={aprovar.isPending}
        erro={aprovar.error}
      >
        <CaixaSelecao
          rotulo="Revisei integralmente o texto, as premissas e as fontes deste rascunho"
          ajuda="A aprovação é ato do servidor responsável e fica registrada na trilha de auditoria."
          checked={revisado}
          onChange={(e) => definirRevisado(e.target.checked)}
        />
      </ConfirmarAcao>
    </section>
  );
}
