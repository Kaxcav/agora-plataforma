/**
 * `/jornada/:id/documentos` — documentos do processo e de habilitação (RF-21), leitura assistida de atestados
 * (RIA-08) e exigências de qualificação técnica (RN-25). O resultado da leitura é sinal com evidências: a decisão
 * de habilitação continua com o agente de contratação.
 */
import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { ArrowLeft, Download, ScanText, ShieldCheck, Upload } from 'lucide-react';
import type { AnaliseHabilitacaoLicitante, ArquivoProcesso, ArquivosProcesso, QualificacaoTecnica } from '@agora/contratos';
import { useArquivosProcesso, useBaixarArquivo, useLerAtestado, useQualificacaoTecnica } from '../../api/documentos';
import { useProcesso } from '../../api/jornada';
import {
  Alerta,
  AreaTexto,
  Botao,
  BotaoCopiar,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTexto,
  Etiqueta,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  Secao,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar, formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { EnviarDocumento } from './EnviarDocumento';
import { ExigenciasTecnicas } from './ExigenciasTecnicas';
import '../../design/paginas-documentos.css';
import { CONFIANCAS, formatarTamanho, rotuloFormato, SINAIS, SITUACOES_LEITURA, TIPOS_ARQUIVO } from './rotulos';

const FINALIDADE_MINIMA = 10;
const FINALIDADE_MAXIMA = 300;

function BaixarComFinalidade({ processoId, arquivo, aoFechar }: { processoId: string; arquivo: ArquivoProcesso; aoFechar: () => void }) {
  const baixar = useBaixarArquivo(processoId);
  const { avisar } = useAvisos();
  const [finalidade, definirFinalidade] = useState('');
  const [tentou, definirTentou] = useState(false);
  const tamanho = finalidade.trim().length;
  const erro = tamanho < FINALIDADE_MINIMA ? `Descreva a finalidade com pelo menos ${FINALIDADE_MINIMA} caracteres.` : null;
  const confirmar = () => {
    definirTentou(true);
    if (erro) return;
    baixar.mutate(
      { arquivo, finalidade: finalidade.trim() },
      {
        onSuccess: (nome) => {
          avisar({ tipo: 'sucesso', titulo: 'Download registrado', mensagem: `${nome}: o acesso ao documento com dado pessoal ficou registrado com a finalidade informada.` });
          aoFechar();
        },
      },
    );
  };
  return (
    <Dialogo
      aberto
      aoFechar={aoFechar}
      largura="media"
      titulo="Baixar documento com dado pessoal"
      descricao={`${arquivo.titulo} contém dado pessoal. Informe para que você precisa do documento: o acesso é registrado (LGPD, art. 37) e aparece na trilha de auditoria.`}
      rodape={
        <>
          <Botao variante="terciario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={Download} carregando={baixar.isPending} onClick={confirmar}>
            Registrar e baixar
          </Botao>
        </>
      }
    >
      <AreaTexto
        rotulo="Finalidade do acesso"
        obrigatorio
        rows={3}
        maxLength={FINALIDADE_MAXIMA}
        contador
        value={finalidade}
        onChange={(e) => definirFinalidade(e.target.value)}
        erro={tentou ? erro : null}
        ajuda="Ex.: conferência do atestado na análise de habilitação técnica."
      />
      <ErroOperacao erro={baixar.error} titulo="O documento não foi baixado" />
    </Dialogo>
  );
}

function TabelaDocumentos({ processoId, dados, podeAnalisar }: { processoId: string; dados: ArquivosProcesso; podeAnalisar: boolean }) {
  const idLegenda = useId();
  const { avisar } = useAvisos();
  const ler = useLerAtestado(processoId);
  const baixar = useBaixarArquivo(processoId);
  const [lendo, definirLendo] = useState<string | null>(null);
  const [comFinalidade, definirComFinalidade] = useState<ArquivoProcesso | null>(null);

  const lerAtestado = (arquivo: ArquivoProcesso) => {
    definirLendo(arquivo.id);
    ler.mutate(arquivo.id, {
      onSuccess: (lido) => {
        const l = lido.leitura;
        if (l?.situacao === 'concluida') {
          avisar({
            tipo: 'sucesso',
            titulo: 'Leitura concluída',
            mensagem: `${contar(l.mencoes.length, 'quantitativo localizado', 'quantitativos localizados')} em ${arquivo.titulo} (${l.metodo === 'ocr' ? 'OCR' : 'camada de texto'}). Confira os trechos-fonte.`,
          });
        } else if (l) {
          avisar({ tipo: 'aviso', titulo: 'Leitura não concluída', mensagem: l.mensagem ?? SITUACOES_LEITURA[l.situacao].rotulo });
        }
      },
      onSettled: () => definirLendo(null),
    });
  };

  const baixarDireto = (arquivo: ArquivoProcesso) => {
    if (arquivo.contemDadoPessoal) {
      definirComFinalidade(arquivo);
      return;
    }
    baixar.mutate({ arquivo, finalidade: null });
  };

  if (dados.itens.length === 0) return <p>Nenhum documento enviado neste processo.</p>;
  return (
    <>
      <ErroOperacao erro={ler.error} titulo="A leitura assistida não foi feita" />
      <ErroOperacao erro={baixar.error} titulo="O documento não foi baixado" />
      <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
        <table className="tabela tabela--compacta">
          <caption id={idLegenda} className="tabela__legenda">
            Documentos do processo ({formatarNumero(dados.itens.length)})
          </caption>
          <thead>
            <tr>
              <th scope="col">Documento</th>
              <th scope="col">Licitante</th>
              <th scope="col">Arquivo</th>
              <th scope="col">Verificações</th>
              <th scope="col">Enviado</th>
              <th scope="col">Leitura assistida</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map((a) => (
              <tr key={a.id}>
                <th scope="row">
                  {a.titulo}
                  <span className="texto-pequeno texto-secundario documentos__detalhe">
                    {TIPOS_ARQUIVO[a.tipo]}
                    {a.exercicio !== null ? ` — exercício ${a.exercicio}` : ''}
                  </span>
                </th>
                <td>{a.fornecedor?.nome ?? '—'}</td>
                <td>
                  <span className="numero">
                    {rotuloFormato(a)}, {formatarTamanho(a.tamanhoBytes)}
                  </span>
                  <span className="texto-pequeno documentos__detalhe">
                    SHA-256 <code className="mono">{a.sha256.slice(0, 12)}…</code> <BotaoCopiar valor={a.sha256} rotulo={`SHA-256 de ${a.titulo}`} />
                  </span>
                </td>
                <td>
                  <span className="pilha pilha--compacta">
                    {a.antivirus === 'limpo' ? (
                      <Etiqueta tom="sucesso" compacta icone={ShieldCheck}>
                        Antivírus: limpo
                      </Etiqueta>
                    ) : (
                      <Etiqueta tom="neutro" compacta>
                        Antivírus não configurado
                      </Etiqueta>
                    )}
                    {a.contemDadoPessoal ? (
                      <Etiqueta tom="info" compacta>
                        Contém dado pessoal
                      </Etiqueta>
                    ) : null}
                  </span>
                </td>
                <td>
                  {a.enviadoPor.nome}
                  <span className="texto-pequeno texto-secundario numero documentos__detalhe">
                    {formatarInstante(a.enviadoEm)}
                  </span>
                </td>
                <td>
                  {a.tipo !== 'atestado_capacidade_tecnica' ? (
                    <span className="texto-secundario">Não se aplica</span>
                  ) : a.leitura === null ? (
                    <span className="texto-secundario">Ainda não lido</span>
                  ) : (
                    <span className="pilha pilha--compacta">
                      <Etiqueta tom={SITUACOES_LEITURA[a.leitura.situacao].tom} compacta>
                        {SITUACOES_LEITURA[a.leitura.situacao].rotulo}
                      </Etiqueta>
                      <span className="texto-pequeno">
                        {a.leitura.situacao === 'concluida'
                          ? `${contar(a.leitura.mencoes.length, 'quantitativo', 'quantitativos')} por ${a.leitura.metodo === 'ocr' ? `OCR${a.leitura.confiancaOcr !== null ? ` (confiança ${formatarNumero(a.leitura.confiancaOcr)}%)` : ''}` : 'camada de texto'}`
                          : (a.leitura.mensagem ?? '')}
                      </span>
                    </span>
                  )}
                </td>
                <td className="tabela__celula--acoes">
                  <Botao tamanho="compacto" icone={Download} aria-label={`Baixar ${a.titulo}`} carregando={baixar.isPending && baixar.variables?.arquivo.id === a.id} onClick={() => baixarDireto(a)}>
                    Baixar
                  </Botao>
                  {podeAnalisar && a.tipo === 'atestado_capacidade_tecnica' ? (
                    <Botao tamanho="compacto" icone={ScanText} aria-label={`${a.leitura ? 'Ler de novo' : 'Ler atestado'} ${a.titulo}`} carregando={lendo === a.id} disabled={lendo !== null && lendo !== a.id} onClick={() => lerAtestado(a)}>
                      {a.leitura ? 'Ler de novo' : 'Ler atestado'}
                    </Botao>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {comFinalidade ? <BaixarComFinalidade processoId={processoId} arquivo={comFinalidade} aoFechar={() => definirComFinalidade(null)} /> : null}
    </>
  );
}

function AnaliseLicitante({ a }: { a: AnaliseHabilitacaoLicitante }) {
  const idLegenda = useId();
  const sinal = SINAIS[a.sinal];
  return (
    <section className="cartao pilha" aria-labelledby={`${idLegenda}-titulo`}>
      <div className="linha linha--entre">
        <h3 id={`${idLegenda}-titulo`} className="secao__titulo">
          {a.fornecedor.nome}
        </h3>
        <Etiqueta tom={sinal.tom}>{sinal.rotulo}</Etiqueta>
      </div>
      <p>
        {a.mensagem}{' '}
        <span className="texto-secundario">
          ({contar(a.atestados, 'atestado enviado', 'atestados enviados')}, {contar(a.atestadosLidos, 'lido', 'lidos')})
        </span>
      </p>
      {a.parcelas.length > 0 ? (
        <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
          <table className="tabela tabela--compacta">
            <caption id={idLegenda} className="tabela__legenda">
              Quantitativos somados — {a.fornecedor.nome}
            </caption>
            <thead>
              <tr>
                <th scope="col">Parcela</th>
                <th scope="col" className="tabela__alinhar--fim">
                  Mínimo exigido
                </th>
                <th scope="col" className="tabela__alinhar--fim">
                  Somado nos atestados
                </th>
                <th scope="col">Sinal</th>
                <th scope="col">Trechos-fonte</th>
              </tr>
            </thead>
            <tbody>
              {a.parcelas.map((p) => (
                <tr key={p.parcelaId}>
                  <th scope="row">{p.descricao}</th>
                  <td className="numero tabela__alinhar--fim">
                    {formatarNumero(p.exigido)} {p.unidade}
                  </td>
                  <td className="numero tabela__alinhar--fim">
                    {formatarNumero(p.somado)} {p.unidade}
                  </td>
                  <td>
                    {p.atende === null ? (
                      <Etiqueta tom="neutro" compacta>
                        Sem leitura
                      </Etiqueta>
                    ) : p.atende ? (
                      <Etiqueta tom="sucesso" compacta>
                        Alcança o mínimo
                      </Etiqueta>
                    ) : (
                      <Etiqueta tom="aviso" compacta>
                        Abaixo do mínimo
                      </Etiqueta>
                    )}
                  </td>
                  <td>
                    {p.contribuicoes.length === 0 ? (
                      <span className="texto-secundario">Nenhum quantitativo localizado</span>
                    ) : (
                      <ul className="lista-simples">
                        {p.contribuicoes.map((c) => (
                          <li key={c.arquivoId} className="documentos__contribuicao">
                            <strong>{c.titulo}</strong>: <span className="numero">{formatarNumero(c.quantidade)}</span> {p.unidade}
                            {c.criterio === 'total_declarado' ? ' (total declarado)' : ''}
                            <ul className="lista-simples texto-pequeno documentos__evidencias">
                              {c.evidencias.map((e) => (
                                <li key={e.indice}>
                                  Página {e.pagina}, linha {e.linha}: “{e.trecho}” — {CONFIANCAS[e.confianca]}
                                  {e.observacao ? `. ${e.observacao}` : ''}
                                </li>
                              ))}
                            </ul>
                            {c.observacao ? <span className="texto-pequeno texto-secundario documentos__detalhe">{c.observacao}</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="texto-pequeno">
        <strong>Balanço patrimonial (art. 69, I e § 6º):</strong> {a.balancos.mensagem}
        {a.balancos.suficiente === false ? ' Faltam exercícios.' : ''}
      </p>
    </section>
  );
}

function LeituraAssistida({ q }: { q: QualificacaoTecnica }) {
  return (
    <Secao
      titulo="Leitura assistida dos atestados (RIA-08)"
      id="leitura-assistida"
      descricao="Soma, por licitante, os quantitativos localizados nos atestados lidos e compara com o mínimo do edital. Cada número traz a página e a linha de onde veio."
    >
      <Alerta tipo="aviso" titulo="Sinal para apoio à análise — requer revisão humana">
        <p>{q.aviso}</p>
      </Alerta>
      {q.analise.length === 0 ? (
        <p>Nenhum licitante registrado na disputa deste processo.</p>
      ) : (
        <div className="pilha">
          {q.analise.map((a) => (
            <AnaliseLicitante key={a.fornecedor.id} a={a} />
          ))}
        </div>
      )}
      <details>
        <summary>Fontes, premissas e data da análise</summary>
        <ListaDefinicoes
          itens={[
            { termo: 'Gerada em', valor: <span className="numero">{formatarInstante(q.geradaEm)}</span> },
            { termo: 'Fundamento', valor: q.fundamento },
            {
              termo: 'Fontes',
              valor:
                q.fontes.length === 0 ? (
                  'Nenhum atestado lido ainda.'
                ) : (
                  <ul className="lista-simples">
                    {q.fontes.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                ),
            },
            {
              termo: 'Premissas',
              valor: (
                <ul className="lista-simples">
                  {q.premissas.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              ),
            },
          ]}
        />
      </details>
    </Secao>
  );
}

export default function DocumentosProcesso() {
  const { id = '' } = useParams();
  const processo = useProcesso(id);
  const arquivos = useArquivosProcesso(id);
  const qualificacao = useQualificacaoTecnica(id);
  const { temPermissao } = useSessao();
  const [enviando, definirEnviando] = useState(false);
  const podeEnviar = temPermissao('documentos:enviar') && arquivos.data?.armazenamentoDisponivel === true;

  return (
    <Pagina
      titulo="Documentos e habilitação"
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Jornada da contratação', para: '/jornada' },
        { rotulo: processo.data?.titulo ?? 'Processo', para: `/jornada/${encodeURIComponent(id)}` },
      ]}
      tela="jornada.documentos"
      subtitulo={processo.data ? <span className="mono">{processo.data.numeroSei}</span> : undefined}
      acoes={
        <>
          <LinkBotao to={`/jornada/${encodeURIComponent(id)}`} icone={ArrowLeft}>
            Voltar ao processo
          </LinkBotao>
          {podeEnviar ? (
            <Botao variante="primario" icone={Upload} onClick={() => definirEnviando(true)}>
              Enviar documento
            </Botao>
          ) : null}
        </>
      }
    >
      <div className="pilha pilha--ampla">
        <ConteudoConsulta
          consulta={qualificacao}
          carregando={<EsqueletoTexto linhas={6} />}
          rotuloCarregando="Carregando as exigências do edital"
          naoEncontrado={{ titulo: 'Processo não encontrado', descricao: 'O processo não existe ou está fora das UASGs do seu escopo.' }}
        >
          {(q) => <ExigenciasTecnicas q={q} podeEditar={temPermissao('jornada:editar')} />}
        </ConteudoConsulta>

        <Secao
          titulo="Documentos do processo"
          id="documentos"
          descricao="Os arquivos ficam no servidor da Ágora e só são baixados por aqui, com a sua permissão e o escopo da UASG do processo. O tipo é conferido pelo conteúdo, e o SHA-256 identifica cada arquivo."
        >
          <ConteudoConsulta consulta={arquivos} carregando={<EsqueletoTexto linhas={5} />} rotuloCarregando="Carregando os documentos">
            {(dados) => (
              <div className="pilha">
                {!dados.armazenamentoDisponivel ? (
                  <Alerta tipo="aviso" titulo="Envio de documentos desligado">
                    <p>O armazenamento de documentos não está configurado neste ambiente. Fale com a equipe de tecnologia (AGORA_ARQUIVOS_DIR).</p>
                  </Alerta>
                ) : null}
                {!dados.ocrDisponivel ? (
                  <p className="texto-pequeno texto-secundario documentos__detalhe">Atestados digitalizados (só imagem) não são lidos neste ambiente: o serviço de OCR não está configurado.</p>
                ) : null}
                <TabelaDocumentos processoId={id} dados={dados} podeAnalisar={temPermissao('documentos:analisar')} />
                {enviando ? (
                  <EnviarDocumento
                    processoId={id}
                    aberto={enviando}
                    aoFechar={() => definirEnviando(false)}
                    licitantes={qualificacao.data?.licitantes ?? []}
                    tamanhoMaximoBytes={dados.tamanhoMaximoBytes}
                  />
                ) : null}
              </div>
            )}
          </ConteudoConsulta>
        </Secao>

        {qualificacao.data ? <LeituraAssistida q={qualificacao.data} /> : null}
      </div>
    </Pagina>
  );
}
