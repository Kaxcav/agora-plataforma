/**
 * Catálogo público de dados abertos (RF-38; Decreto 8.777/2016; Lei 12.527/2011, art. 8º, § 3º): conjuntos em CSV
 * e JSON, sem login, com dicionário de dados, licença aberta, data de atualização, periodicidade e SHA-256.
 */
import { Download } from 'lucide-react';
import type { ConjuntoDadosAbertos } from '@agora/contratos';
import { useCatalogoDadosAbertos } from '../../api/dados-abertos';
import { Alerta, ConteudoConsulta, EsqueletoTexto, LinkExterno, ListaDefinicoes, Pagina, Secao } from '../../componentes';
import { formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { formatarTamanho } from '../documentos/rotulos';
import '../../design/paginas-sociedade.css';

const TIPOS: Record<ConjuntoDadosAbertos['dicionario'][number]['tipo'], string> = {
  identificador: 'Identificador',
  texto: 'Texto',
  inteiro: 'Número inteiro',
  decimal: 'Valor em reais (ponto decimal)',
  data: 'Data (AAAA-MM-DD)',
  booleano: 'Verdadeiro ou falso',
};

function Conjunto({ c }: { c: ConjuntoDadosAbertos }) {
  return (
    <Secao titulo={c.titulo} id={`conjunto-${c.id}`} descricao={c.descricao}>
      <div className="pilha">
        <ListaDefinicoes
          itens={[
            { termo: 'Registros', valor: <span className="numero">{formatarNumero(c.registros)}</span> },
            { termo: 'Atualizado em', valor: c.atualizadoEm ? formatarInstante(c.atualizadoEm) : 'Sem registros' },
            { termo: 'Periodicidade', valor: c.periodicidade },
            { termo: 'Licença', valor: <LinkExterno href={c.licenca.url}>{c.licenca.nome}</LinkExterno> },
            { termo: 'Publicador', valor: c.publicador },
            { termo: 'Fundamento', valor: c.fundamento },
          ]}
        />
        <ul className="lista-simples pilha pilha--compacta" aria-label={`Arquivos de ${c.titulo}`}>
          {c.arquivos.map((a) => (
            <li key={a.formato} className="dados-abertos__arquivos">
              <a className="botao botao--secundario botao--compacto" href={a.url} download={`${c.id}.${a.formato}`}>
                <Download size={16} aria-hidden="true" />
                <span>
                  Baixar {a.formato.toUpperCase()} de {c.titulo.toLowerCase()} ({formatarTamanho(a.bytes)})
                </span>
              </a>
              <span className="texto-pequeno texto-secundario">
                SHA-256: <span className="dados-abertos__hash">{a.sha256}</span>
              </span>
            </li>
          ))}
        </ul>
        <details>
          <summary>Dicionário de dados ({c.dicionario.length} colunas)</summary>
          <div className="tabela-rolagem">
            <table className="tabela">
              <caption className="tabela__legenda">Dicionário de dados: {c.titulo}</caption>
              <thead>
                <tr>
                  <th scope="col">Coluna</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {c.dicionario.map((col) => (
                  <tr key={col.nome}>
                    <th scope="row" className="mono">
                      {col.nome}
                    </th>
                    <td>{TIPOS[col.tipo]}</td>
                    <td>{col.descricao}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Secao>
  );
}

export default function DadosAbertos() {
  const consulta = useCatalogoDadosAbertos();
  return (
    <Pagina
      titulo="Dados abertos"
      subtitulo="Conjuntos de dados das contratações em formato aberto (CSV e JSON), sem cadastro e sob licença aberta (Decreto 8.777/2016 e Lei 12.527/2011)."
      tela="dados-abertos"
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Carregando o catálogo de dados abertos">
        {(catalogo) => (
          <div className="pilha pilha--ampla">
            <Alerta tipo="info" titulo="Como usar">
              <p>
                Os arquivos são gerados a partir da base da Ágora no momento do download, em UTF-8, com vírgula como separador e ponto como separador
                decimal no CSV. Nenhum dado pessoal sai no catálogo: o CPF de fornecedor pessoa física fica de fora e o nome aparece só com as iniciais.
                Confira a integridade de cada arquivo pelo SHA-256. Cite a fonte ({catalogo.publicador}) ao reutilizar os dados. Cada endereço aceita até{' '}
                {catalogo.limiteRequisicoesPorMinuto} downloads por minuto.
              </p>
            </Alerta>
            {catalogo.conjuntos.map((c) => (
              <Conjunto key={c.id} c={c} />
            ))}
            {catalogo.indisponiveis.length > 0 ? (
              <Secao titulo="Conjuntos previstos" id="conjuntos-previstos">
                <ul className="lista-simples">
                  {catalogo.indisponiveis.map((c) => (
                    <li key={c.id}>
                      <strong>{c.titulo}:</strong> {c.motivo}
                    </li>
                  ))}
                </ul>
              </Secao>
            ) : null}
          </div>
        )}
      </ConteudoConsulta>
    </Pagina>
  );
}
