/** Manifestações do cidadão identificado (RF-37): situação da moderação, motivo e respostas. */
import { Link } from 'react-router';
import { formatarData } from '@agora/dominio';
import { useMinhasManifestacoes } from '../../api/sociedade';
import { ConteudoConsulta, EstadoVazio, EsqueletoTexto, Etiqueta, LinkBotao, Pagina } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ASSUNTOS, SITUACOES } from './rotulos';
import '../../design/paginas-sociedade.css';

export default function MinhasManifestacoes() {
  const consulta = useMinhasManifestacoes();
  return (
    <Pagina
      titulo="Minhas manifestações"
      subtitulo="Mensagens que você enviou sobre contratos, com a decisão da moderação e as respostas (Lei 14.133/2021, art. 174, § 3º, VI)."
      tela="sociedade.minhas"
      acoes={
        <LinkBotao to="/transparencia" variante="secundario">
          Consultar contratos
        </LinkBotao>
      }
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={5} />} rotuloCarregando="Carregando as suas manifestações">
        {(lista) =>
          lista.length === 0 ? (
            <EstadoVazio
              titulo="Você ainda não enviou manifestações"
              descricao="Abra um contrato na Transparência e use a seção Enviar manifestação."
              acao={
                <LinkBotao to="/transparencia" variante="primario">
                  Ir para a Transparência
                </LinkBotao>
              }
            />
          ) : (
            <ul className="sociedade__manifestacoes" aria-label="Minhas manifestações">
              {lista.map((m) => {
                const situacao = SITUACOES[m.situacao];
                return (
                  <li key={m.id} className="sociedade__manifestacao">
                    <div className="sociedade__cabecalho">
                      <Link to={`/transparencia/contratos/${m.contrato.id}`}>Contrato {m.contrato.numero}</Link>
                      <span className="texto-secundario">{formatarInstante(m.recebidaEm)}</span>
                      <Etiqueta tom="neutro" icone={null}>
                        {ASSUNTOS[m.assunto]}
                      </Etiqueta>
                      <Etiqueta tom={situacao.tom}>{situacao.rotulo}</Etiqueta>
                    </div>
                    <p className="sociedade__texto">{m.texto}</p>
                    {m.temImagem ? (
                      <p className="texto-pequeno texto-secundario">
                        Imagem anexada
                        {m.metadadosRemovidos.length > 0 ? `; retirados antes de guardar: ${m.metadadosRemovidos.join(', ')}.` : '.'}
                      </p>
                    ) : null}
                    {m.motivoModeracao ? (
                      <p className="texto-pequeno">
                        <strong>Motivo da moderação:</strong> {m.motivoModeracao}
                      </p>
                    ) : null}
                    {m.situacao === 'publicada' ? (
                      <p className="texto-pequeno texto-secundario">Prazo para a resposta da Administração: {formatarData(m.prazoResposta)}.</p>
                    ) : null}
                    {m.respostas.length > 0 ? (
                      <ul className="sociedade__respostas" aria-label="Respostas">
                        {m.respostas.map((r) => (
                          <li key={r.id}>
                            <p className="sociedade__cabecalho">
                              <strong>{r.autor}</strong>
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
              })}
            </ul>
          )
        }
      </ConteudoConsulta>
    </Pagina>
  );
}
