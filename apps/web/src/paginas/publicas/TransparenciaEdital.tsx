import { useParams } from 'react-router';
import { FileDown } from 'lucide-react';
import { formatarData } from '@agora/dominio';
import { useEditalPublico } from '../../api/publico';
import { ConteudoConsulta, EsqueletoDetalhe, LinkBotao, LinkExterno, ListaDefinicoes, Pagina, Secao } from '../../componentes';
import { SigiloEditalPublico } from '../sigilo/Publico';

export default function TransparenciaEdital() {
  const { id = '' } = useParams();
  const consulta = useEditalPublico(id);
  const edital = consulta.data;

  return (
    <Pagina
      titulo={edital ? `Edital — processo ${edital.numeroSei}` : 'Edital'}
      trilha={[
        { rotulo: 'Transparência', para: '/transparencia' },
        { rotulo: 'Editais publicados', para: '/transparencia/editais' },
      ]}
      tela="transparencia"
      subtitulo={edital?.objeto}
      acoes={
        edital?.linkPncp ? (
          <LinkExterno href={edital.linkPncp} comoBotao="secundario">
            Abrir no PNCP
          </LinkExterno>
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando o edital"
        naoEncontrado={{
          titulo: 'Edital não encontrado',
          descricao: 'O edital não existe ou ainda não foi publicado.',
          acao: (
            <LinkBotao to="/transparencia/editais" variante="primario">
              Voltar para a lista
            </LinkBotao>
          ),
        }}
      >
        {(e) => (
          <>
            <Secao titulo="Dados do edital" id="dados-edital-publico">
              <ListaDefinicoes
                itens={[
                  { termo: 'Processo', valor: <span className="mono">{e.numeroSei}</span> },
                  { termo: 'Órgão requisitante', valor: e.orgaoRequisitante },
                  { termo: 'Modalidade', valor: e.modalidade ?? '—' },
                  { termo: 'Publicado em', valor: formatarData(e.publicadoEm) },
                  { termo: 'Propostas a partir de', valor: e.dataMinimaPropostas ? formatarData(e.dataMinimaPropostas) : '—' },
                  { termo: 'Identificador PNCP', valor: e.idPncp ? <span className="mono">{e.idPncp}</span> : '—' },
                  { termo: 'Homologado em', valor: e.homologadoEm ? formatarData(e.homologadoEm) : 'Licitação ainda não homologada' },
                  { termo: 'Objeto', valor: e.objeto, largo: true },
                ]}
              />
            </Secao>
            <SigiloEditalPublico edital={e} />
            <Secao
              titulo="Inteiro teor"
              id="documentos-edital-publico"
              descricao="Última versão aprovada de cada documento, em PDF, com dados pessoais tarjados. Sem cadastro nem login (art. 25, § 3º)."
            >
              {e.documentos.length === 0 ? (
                <p className="texto-secundario">Nenhum documento disponível.</p>
              ) : (
                <ul className="lista-simples">
                  {e.documentos.map((d) => (
                    <li key={d.tipo}>
                      <a href={d.url} className="link-externo" target="_blank" rel="noopener noreferrer">
                        <FileDown size={16} aria-hidden="true" /> {d.titulo} (PDF, versão {d.versao})
                        <span className="sr-only"> — abre em nova aba</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
            <Secao
              titulo="Documentos da fase preparatória"
              id="preparatorios-edital-publico"
              descricao="Divulgados após a homologação, por não integrarem o edital e os anexos (Lei 14.133/2021, art. 54, § 3º). Última versão aprovada, em PDF, com dados pessoais tarjados."
            >
              {e.documentosPreparatorios.length === 0 ? (
                <p className="texto-secundario">
                  {e.homologadoEm ? 'Nenhum documento preparatório aprovado para divulgação.' : 'Os documentos da fase preparatória são divulgados aqui depois da homologação.'}
                </p>
              ) : (
                <ul className="lista-simples">
                  {e.documentosPreparatorios.map((d) => (
                    <li key={d.tipo}>
                      <a href={d.url} className="link-externo" target="_blank" rel="noopener noreferrer">
                        <FileDown size={16} aria-hidden="true" /> {d.titulo} (PDF, versão {d.versao})
                        <span className="sr-only"> — abre em nova aba</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </>
        )}
      </ConteudoConsulta>
    </Pagina>
  );
}
