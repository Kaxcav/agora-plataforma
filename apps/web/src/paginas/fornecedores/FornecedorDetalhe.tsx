import { useParams } from 'react-router';
import { FileText, Gauge, Gavel, ShieldCheck, ShieldX } from 'lucide-react';
import type { FornecedorDetalhe as DadosFornecedor } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useFornecedor } from '../../api/fornecedores';
import {
  Abas,
  Alerta,
  ConteudoConsulta,
  EsqueletoDetalhe,
  EstadoVazio,
  Etiqueta,
  Indicador,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  Secao,
  Tabela,
} from '../../componentes';
import { formatarInstante, formatarNumero, formatarPercentual } from '../../utilitarios/formatacao';
import { COLUNAS_CONTRATO } from '../compartilhado/colunasContrato';
import { FAIXAS_IDC, PORTES, TIPOS_SANCAO } from '../compartilhado/rotulos';
import { colunasSancao } from '../sancoes/colunasSancao';
import { DocumentoFornecedor, formatarNotaIdc } from './idc';
import { RegularidadeFornecedor } from './RegularidadeFornecedor';

type ComponenteIdc = DadosFornecedor['idcDetalhe']['componentes'][number];
type PenalidadeIdc = DadosFornecedor['idcDetalhe']['penalidades'][number];

const COLUNAS_SANCAO_FORNECEDOR = colunasSancao({ comFornecedor: false });

/** Peso chega como fração (0,4) — exibido como percentual. */
function formatarPeso(peso: number): string {
  return formatarPercentual(peso <= 1 ? peso * 100 : peso, 0);
}

function SecaoIdc({ fornecedor }: { fornecedor: DadosFornecedor }) {
  const idc = fornecedor.idcDetalhe;
  const faixa = FAIXAS_IDC[idc.faixa];
  return (
    <Secao
      titulo="Índice de Desempenho do Contratado (IDC)"
      id="idc"
      descricao="Avaliação objetiva de desempenho prevista na Lei 14.133/2021, art. 88, §§ 3º e 4º."
    >
      <div className="idc-destaque">
        {idc.semHistorico ? (
          <>
            <p className="idc-destaque__nota texto-secundario">—</p>
            <div className="pilha pilha--compacta">
              <Etiqueta tom="neutro">Sem histórico</Etiqueta>
              <p className="texto-pequeno texto-secundario">Sem entregas, recebimentos ou ocorrências registrados: a ausência de dados não penaliza o fornecedor.</p>
            </div>
          </>
        ) : (
          <>
            <p className="idc-destaque__nota numero">
              {formatarNotaIdc(idc.nota)}
              <span className="idc-destaque__escala"> / 100</span>
            </p>
            <div className="pilha pilha--compacta">
              <Etiqueta tom={faixa.tom}>Faixa {faixa.rotulo.toLowerCase()}</Etiqueta>
              <p className="texto-pequeno texto-secundario">Faixas: excelente ≥ 90 · bom ≥ 75 · regular ≥ 60 · insuficiente ≥ 40 · crítico &lt; 40.</p>
            </div>
          </>
        )}
      </div>

      <Tabela<ComponenteIdc>
        id="fornecedor-idc-componentes"
        legenda="Componentes do índice"
        semFerramentas
        linhas={idc.componentes}
        chave={(c) => c.nome}
        colunas={[
          { id: 'nome', cabecalho: 'Componente', identificadora: true, fixa: true, celula: (c) => c.nome },
          { id: 'valor', cabecalho: 'Valor', alinhamento: 'fim', prioritaria: true, celula: (c) => <span className="numero">{formatarNotaIdc(c.valor)}</span> },
          { id: 'peso', cabecalho: 'Peso', alinhamento: 'fim', prioritaria: true, celula: (c) => <span className="numero">{formatarPeso(c.peso)}</span> },
          {
            id: 'contribuicao',
            cabecalho: 'Contribuição para a nota',
            alinhamento: 'fim',
            prioritaria: true,
            celula: (c) => <span className="numero">{formatarNotaIdc(c.contribuicao)}</span>,
          },
        ]}
        vazio={<EstadoVazio icone={Gauge} titulo="Sem componentes calculados" />}
      />

      <Tabela<PenalidadeIdc>
        id="fornecedor-idc-penalidades"
        legenda="Descontos por sanções nos últimos 36 meses"
        semFerramentas
        linhas={idc.penalidades}
        chave={(pn) => `${pn.tipo}-${pn.dataAplicacao}`}
        colunas={[
          { id: 'tipo', cabecalho: 'Sanção', identificadora: true, fixa: true, celula: (pn) => TIPOS_SANCAO[pn.tipo] },
          { id: 'data', cabecalho: 'Aplicada em', prioritaria: true, celula: (pn) => <span className="numero">{formatarData(pn.dataAplicacao)}</span> },
          {
            id: 'desconto',
            cabecalho: 'Desconto',
            alinhamento: 'fim',
            prioritaria: true,
            celula: (pn) => <span className="numero">−{formatarNotaIdc(Math.abs(pn.desconto))} pontos</span>,
          },
        ]}
        vazio={
          <EstadoVazio
            icone={ShieldCheck}
            titulo="Nenhum desconto por sanção"
            descricao="O fornecedor não teve sanções aplicadas nos últimos 36 meses."
          />
        }
      />

      <div className="pilha pilha--compacta">
        <h3 className="secao__titulo">Metodologia</h3>
        <p>{idc.metodologia}</p>
        <p className="texto-pequeno texto-secundario">Fundamento: {idc.fundamento}</p>
      </div>
      <Alerta tipo="info" titulo="Indicador objetivo de apoio, não é sanção">
        <p>{idc.aviso}</p>
      </Alerta>
    </Secao>
  );
}

function SecaoRegularidade({ fornecedor }: { fornecedor: DadosFornecedor }) {
  const r = fornecedor.regularidade;
  return (
    <Secao titulo="Regularidade" id="regularidade" descricao="Consulta exigida antes de assinar ou prorrogar contratos (RN-09; Lei 14.133/2021, art. 91, § 4º). Detalhes na aba “Regularidade e certidões”.">
      <div className="linha">
        {r.regular ? (
          <Etiqueta tom="sucesso" icone={ShieldCheck}>
            Regular
          </Etiqueta>
        ) : (
          <Etiqueta tom="erro" icone={ShieldX}>
            Irregular
          </Etiqueta>
        )}
        <span className="texto-pequeno texto-secundario">CEIS/CNEP consultados em {formatarInstante(r.consultadoEm)}</span>
      </div>
      {r.motivos.length > 0 ? (
        <div className="pilha pilha--compacta">
          <h3 className="secao__titulo">Motivos</h3>
          <ul>
            {r.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="pilha pilha--compacta">
        <h3 className="secao__titulo">Fontes consultadas</h3>
        {r.fontes.length > 0 ? (
          <ul>
            {r.fontes.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        ) : (
          <p className="texto-secundario">Nenhuma fonte registrada.</p>
        )}
      </div>
    </Secao>
  );
}

function ConteudoFornecedor({ fornecedor }: { fornecedor: DadosFornecedor }) {
  const idc = fornecedor.idcDetalhe;
  return (
    <>
      <div className="grade grade--kpi">
        <Indicador
          rotulo="IDC"
          icone={Gauge}
          tom={idc.semHistorico ? 'neutro' : idc.faixa === 'excelente' || idc.faixa === 'bom' ? 'sucesso' : idc.faixa === 'regular' ? 'info' : idc.faixa === 'insuficiente' ? 'aviso' : 'erro'}
          valor={idc.semHistorico ? 'Sem histórico' : formatarNotaIdc(idc.nota)}
          detalhe={idc.semHistorico ? 'ausência de dados não penaliza' : `faixa ${FAIXAS_IDC[idc.faixa].rotulo.toLowerCase()}`}
        />
        <Indicador rotulo="Contratos" icone={FileText} tom="info" valor={formatarNumero(fornecedor.contratos.length)} detalhe="no escopo do órgão" />
        <Indicador
          rotulo="Sanções vigentes"
          icone={Gavel}
          tom={fornecedor.sancoesVigentes > 0 ? 'erro' : 'sucesso'}
          valor={formatarNumero(fornecedor.sancoesVigentes)}
          detalhe={`${formatarNumero(fornecedor.sancoes.length)} processos no histórico`}
        />
        <Indicador
          rotulo="Regularidade"
          icone={fornecedor.regularidade.regular ? ShieldCheck : ShieldX}
          tom={fornecedor.regularidade.regular ? 'sucesso' : 'erro'}
          valor={fornecedor.regularidade.regular ? 'Regular' : 'Irregular'}
          detalhe={`consulta de ${formatarInstante(fornecedor.regularidade.consultadoEm)}`}
        />
      </div>

      <div className="detalhe-grade">
        <SecaoIdc fornecedor={fornecedor} />
        <div className="detalhe-grade__lateral">
          <Secao titulo="Dados cadastrais" id="dados-fornecedor">
            <ListaDefinicoes
              colunas={2}
              itens={[
                { termo: fornecedor.tipoPessoa === 'PJ' ? 'CNPJ' : 'CPF', valor: <DocumentoFornecedor fornecedor={fornecedor} />, largo: true },
                { termo: 'Tipo de pessoa', valor: fornecedor.tipoPessoa === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física' },
                { termo: 'Porte', valor: fornecedor.porte ? PORTES[fornecedor.porte] : 'Não informado' },
                { termo: 'UF', valor: fornecedor.uf ?? 'Não informada' },
              ]}
            />
          </Secao>
          <SecaoRegularidade fornecedor={fornecedor} />
        </div>
      </div>

      <Abas
        rotulo="Relações do fornecedor"
        abas={[
          {
            id: 'contratos',
            rotulo: 'Contratos',
            contador: fornecedor.contratos.length,
            conteudo: () => (
              <Tabela
                id="fornecedor-contratos"
                legenda={`Contratos de ${fornecedor.razaoSocial}`}
                colunas={COLUNAS_CONTRATO}
                linhas={fornecedor.contratos}
                chave={(c) => c.id}
                ordenacaoInicial={{ por: 'vigenciaFim', ordem: 'asc' }}
                vazio={<EstadoVazio icone={FileText} titulo="Nenhum contrato no seu escopo" descricao="Não há contratos deste fornecedor nas UASGs que você acompanha." />}
              />
            ),
          },
          {
            id: 'sancoes',
            rotulo: 'Sanções',
            contador: fornecedor.sancoes.length,
            conteudo: () => (
              <Tabela
                id="fornecedor-sancoes"
                legenda={`Processos sancionatórios de ${fornecedor.razaoSocial}`}
                colunas={COLUNAS_SANCAO_FORNECEDOR}
                linhas={fornecedor.sancoes}
                chave={(s) => s.id}
                ordenacaoInicial={{ por: 'instauradaEm', ordem: 'desc' }}
                vazio={<EstadoVazio icone={ShieldCheck} titulo="Nenhum processo sancionatório" descricao="Não há processos sancionatórios registrados para este fornecedor." />}
              />
            ),
          },
          {
            id: 'regularidade',
            rotulo: 'Regularidade e certidões',
            conteudo: () => <RegularidadeFornecedor fornecedor={fornecedor} />,
          },
        ]}
      />
    </>
  );
}

export default function FornecedorDetalhe() {
  const { id = '' } = useParams();
  const consulta = useFornecedor(id);
  const fornecedor = consulta.data;

  return (
    <Pagina
      titulo={fornecedor ? fornecedor.razaoSocial : 'Fornecedor'}
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Fornecedores', para: '/fornecedores' },
      ]}
      tela="fornecedores"
      subtitulo={fornecedor && fornecedor.tipoPessoa === 'PJ' ? <span className="mono">{fornecedor.documento}</span> : undefined}
      marcadores={
        fornecedor ? (
          <>
            {fornecedor.porte ? <Etiqueta tom="neutro">{PORTES[fornecedor.porte]}</Etiqueta> : null}
            {fornecedor.sancoesVigentes > 0 ? (
              <Etiqueta tom="erro">
                {formatarNumero(fornecedor.sancoesVigentes)} {fornecedor.sancoesVigentes === 1 ? 'sanção vigente' : 'sanções vigentes'}
              </Etiqueta>
            ) : (
              <Etiqueta tom="sucesso">Sem sanção vigente</Etiqueta>
            )}
          </>
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando o fornecedor"
        naoEncontrado={{
          titulo: 'Fornecedor não encontrado',
          descricao: 'O fornecedor não existe ou não tem relação com as UASGs do seu escopo.',
          acao: (
            <LinkBotao to="/fornecedores" variante="primario">
              Voltar para fornecedores
            </LinkBotao>
          ),
        }}
      >
        {(dados) => <ConteudoFornecedor fornecedor={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
