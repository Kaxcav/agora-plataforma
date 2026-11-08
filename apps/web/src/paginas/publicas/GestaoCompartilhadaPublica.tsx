/**
 * Gestão compartilhada com a sociedade na página pública do contrato (art. 174, § 3º, VI): registros da execução,
 * manifestações publicadas com as respostas, envio pelo cidadão identificado e relatório final.
 */
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Send, ShieldCheck } from 'lucide-react';
import { formatarData, formatarMoeda, LIMITES_GESTAO_COMPARTILHADA } from '@agora/dominio';
import type { AssuntoManifestacao, GestaoCompartilhadaPublica, ManifestacaoPublica, MinhaManifestacao } from '@agora/contratos';
import { useConfiguracaoPublica } from '../../api/sessao';
import { useEnviarManifestacao, useGestaoPublica } from '../../api/sociedade';
import { Alerta, AreaTexto, Botao, Campo, ConteudoConsulta, EsqueletoTexto, Etiqueta, LinkBotao, ListaDefinicoes, Secao, Selecao } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { ASSUNTOS, CONCLUSOES, PRAZOS } from '../sociedade/rotulos';
import '../../design/paginas-sociedade.css';

const LIMITE_IMAGEM_BYTES = 5 * 1024 * 1024;

function Manifestacao({ m }: { m: ManifestacaoPublica }) {
  const prazo = PRAZOS[m.situacaoPrazo];
  return (
    <li className="sociedade__manifestacao">
      <div className="sociedade__cabecalho">
        <strong>{m.autor}</strong>
        <span className="texto-secundario">{formatarInstante(m.recebidaEm)}</span>
        <Etiqueta tom="neutro" icone={null}>
          {ASSUNTOS[m.assunto]}
        </Etiqueta>
        <Etiqueta tom={prazo.tom}>{prazo.rotulo}</Etiqueta>
      </div>
      <p className="sociedade__texto">{m.texto}</p>
      {m.imagemUrl ? <img className="sociedade__imagem" src={m.imagemUrl} alt={`Imagem enviada por ${m.autor}`} loading="lazy" /> : null}
      <p className="texto-pequeno texto-secundario">Prazo para a resposta da Administração: {formatarData(m.prazoResposta)}.</p>
      {m.respostas.length > 0 ? (
        <ul className="sociedade__respostas" aria-label={`Respostas à manifestação de ${m.autor}`}>
          {m.respostas.map((r) => (
            <li key={r.id}>
              <p className="sociedade__cabecalho">
                <strong>{r.origem === 'contratado' ? `Contratado: ${r.autor}` : `Administração: ${r.autor}`}</strong>
                <span className="texto-secundario">
                  {r.funcao} · {formatarInstante(r.respondidaEm)}
                </span>
              </p>
              <p className="sociedade__texto">{r.texto}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function EnviarManifestacao({ contratoId }: { contratoId: string }) {
  const base = useId();
  const { usuario, temPermissao } = useSessao();
  const configuracao = useConfiguracaoPublica();
  const enviar = useEnviarManifestacao(contratoId);
  const [assunto, definirAssunto] = useState<AssuntoManifestacao>('execucao');
  const [texto, definirTexto] = useState('');
  const [imagem, definirImagem] = useState<File | null>(null);
  const [tentou, definirTentou] = useState(false);
  const [recebida, definirRecebida] = useState<MinhaManifestacao | null>(null);
  const retorno = `/transparencia/contratos/${contratoId}`;

  if (!usuario) {
    return (
      <div className="pilha pilha--compacta">
        <p>Para enviar mensagem ou imagem sobre este contrato, identifique-se. A Ágora não pede cadastro: a identificação é a sua conta gov.br.</p>
        <div className="sociedade__acoes">
          {configuracao.data?.govbrHabilitado ? (
            <a className="botao botao--govbr" href={`/api/v1/sessao/govbr/cidadao?retorno=${encodeURIComponent(retorno)}`}>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>Entrar com gov.br para enviar</span>
            </a>
          ) : (
            <LinkBotao to={`/entrar?retorno=${encodeURIComponent(retorno)}`} variante="primario">
              Entrar para enviar
            </LinkBotao>
          )}
        </div>
        {configuracao.data?.ambiente === 'demonstracao' && !configuracao.data.govbrHabilitado ? (
          <p className="texto-pequeno texto-secundario">No ambiente de demonstração, use a conta da cidadã (perfil Cidadão) na tela de entrada.</p>
        ) : null}
      </div>
    );
  }

  if (!temPermissao('sociedade:manifestar')) {
    return (
      <Alerta tipo="info" titulo="Envio reservado ao cidadão identificado">
        <p>As manifestações são enviadas por cidadãos identificados pelo gov.br. Servidores respondem pela tela Gestão compartilhada.</p>
      </Alerta>
    );
  }

  const { textoMinimo, textoMaximo } = LIMITES_GESTAO_COMPARTILHADA;
  const erroTexto = texto.trim().length < textoMinimo ? `Escreva pelo menos ${textoMinimo} caracteres.` : null;
  const erroImagem = imagem && imagem.size > LIMITE_IMAGEM_BYTES ? 'A imagem passa de 5 MB.' : null;

  const escolherImagem = (evento: ChangeEvent<HTMLInputElement>) => definirImagem(evento.target.files?.[0] ?? null);

  const confirmar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (erroTexto || erroImagem) return;
    enviar.mutate(
      { assunto, texto: texto.trim(), imagem },
      {
        onSuccess: (m) => {
          definirRecebida(m);
          definirTexto('');
          definirImagem(null);
          definirTentou(false);
        },
      },
    );
  };

  return (
    <form className="formulario" onSubmit={confirmar} noValidate aria-labelledby={`${base}-titulo`}>
      <h3 id={`${base}-titulo`} className="sr-only">
        Formulário de manifestação
      </h3>
      {recebida ? (
        <Alerta tipo="sucesso" anunciar titulo="Manifestação recebida">
          <p>
            Ela aguarda moderação e só aparece aqui depois de aprovada.
            {recebida.metadadosRemovidos.length > 0 ? ' Os dados de localização e do aparelho foram retirados da imagem.' : ''} Acompanhe em{' '}
            <Link to="/sociedade/minhas-manifestacoes">Minhas manifestações</Link>.
          </p>
        </Alerta>
      ) : null}
      <p className="texto-secundario">
        Antes de publicar, a mensagem passa por moderação. Em público, o seu nome aparece só com o primeiro nome e as iniciais; CPF, e-mail e telefone
        escritos no texto são tarjados.
      </p>
      <Selecao
        rotulo="Assunto"
        obrigatorio
        value={assunto}
        onChange={(e) => definirAssunto(e.target.value as AssuntoManifestacao)}
        opcoes={Object.entries(ASSUNTOS).map(([valor, rotulo]) => ({ valor, rotulo }))}
      />
      <AreaTexto
        rotulo="Mensagem"
        obrigatorio
        contador
        maxLength={textoMaximo}
        rows={5}
        value={texto}
        onChange={(e) => definirTexto(e.target.value)}
        erro={tentou ? erroTexto : null}
      />
      <Campo id={`${base}-imagem`} rotulo="Imagem (opcional)" erro={tentou ? erroImagem : null} ajuda="PNG ou JPEG de até 5 MB. A localização e os dados do aparelho são retirados antes de guardar.">
        {(atributos) => <input {...atributos} className="campo__controle" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={escolherImagem} />}
      </Campo>
      <ErroOperacao erro={enviar.error} titulo="A manifestação não foi enviada" />
      <div className="sociedade__acoes">
        <Botao type="submit" variante="primario" icone={Send} carregando={enviar.isPending}>
          Enviar manifestação
        </Botao>
      </div>
    </form>
  );
}

function Conteudo({ g }: { g: GestaoCompartilhadaPublica }) {
  const relatorio = g.relatorioFinal;
  return (
    <>
      <Secao titulo="Acompanhamento da execução" id="acompanhamento-execucao" descricao="Fotos e vídeos publicados pela fiscalização do contrato (art. 19, III).">
        {g.registros.length === 0 ? (
          <p className="texto-secundario">A fiscalização ainda não publicou registros da execução deste contrato.</p>
        ) : (
          <ul className="sociedade__galeria" aria-label="Registros da execução">
            {g.registros.map((r) => (
              <li key={r.id}>
                <figure className="sociedade__midia">
                  {r.midia === 'video' ? (
                    <video controls preload="metadata" src={r.url} aria-label={r.titulo}>
                      <a href={r.url}>Baixar o vídeo {r.titulo}</a>
                    </video>
                  ) : (
                    <img src={r.url} alt={r.titulo} loading="lazy" />
                  )}
                  <figcaption>
                    <strong>{r.titulo}</strong>
                    <span className="texto-pequeno texto-secundario"> · registrado em {formatarData(r.registradoEm)}</span>
                    {r.descricao ? <span className="texto-pequeno"> — {r.descricao}</span> : null}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao
        titulo="Manifestações da sociedade"
        id="manifestacoes-sociedade"
        descricao={`Mensagens de cidadãos identificados, publicadas após moderação, com as respostas da Administração e do contratado. A Administração responde em até ${g.prazoRespostaDias} dias.`}
      >
        {g.manifestacoes.length === 0 ? (
          <p className="texto-secundario">Nenhuma manifestação publicada sobre este contrato.</p>
        ) : (
          <ul className="sociedade__manifestacoes" aria-label="Manifestações publicadas">
            {g.manifestacoes.map((m) => (
              <Manifestacao key={m.id} m={m} />
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Enviar manifestação" id="enviar-manifestacao">
        <EnviarManifestacao contratoId={g.contratoId} />
      </Secao>

      <Secao titulo="Relatório final" id="relatorio-final" descricao="Consecução dos objetivos que justificaram a contratação (art. 174, § 3º, VI, d).">
        {relatorio ? (
          <div className="pilha">
            <ListaDefinicoes
              itens={[
                { termo: 'Conclusão', valor: CONCLUSOES[relatorio.conclusao] },
                { termo: 'Publicado em', valor: formatarInstante(relatorio.publicadoEm) },
                { termo: 'Responsável', valor: relatorio.publicadoPor },
                { termo: 'Vigência', valor: `${formatarData(relatorio.execucao.vigenciaInicio)} a ${formatarData(relatorio.execucao.vigenciaFim)}` },
                { termo: 'Valor global', valor: formatarMoeda(relatorio.execucao.valorGlobal) },
                { termo: 'Valor pago', valor: formatarMoeda(relatorio.execucao.valorPago) },
                { termo: 'Termos aditivos', valor: String(relatorio.execucao.aditivos) },
                { termo: 'SHA-256', valor: <span className="dados-abertos__hash">{relatorio.sha256}</span>, largo: true },
              ]}
            />
            <h3>Objetivos que justificaram a contratação</h3>
            <p className="sociedade__texto">{relatorio.objetivos}</p>
            <h3>Resultados alcançados</h3>
            <p className="sociedade__texto">{relatorio.resultados}</p>
          </div>
        ) : (
          <p className="texto-secundario">O relatório final é publicado pela gestão do contrato ao fim da vigência ({formatarData(g.vigenciaFim)}).</p>
        )}
      </Secao>
    </>
  );
}

export function GestaoCompartilhadaPublicaContrato({ contratoId }: { contratoId: string }) {
  const consulta = useGestaoPublica(contratoId);
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto />} rotuloCarregando="Carregando a gestão compartilhada com a sociedade">
      {(g) => <Conteudo g={g} />}
    </ConteudoConsulta>
  );
}
