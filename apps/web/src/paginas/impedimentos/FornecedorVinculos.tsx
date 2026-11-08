/** Vínculos e impedimentos de um fornecedor: quadro societário (CPF mascarado), sinais, vínculos e extensões de sanção. */
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Gavel, RefreshCw } from 'lucide-react';
import type { IntegranteQuadro, SinalVinculo, VinculosFornecedor } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useConsultarQsa, useVinculosFornecedor } from '../../api/impedimentos';
import {
  Alerta,
  Botao,
  ConteudoConsulta,
  EsqueletoDetalhe,
  EstadoVazio,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  Secao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { abreviarHash, formatarInstante } from '../../utilitarios/formatacao';
import {
  ALVOS_EXTENSAO,
  BotaoRegistrarVinculo,
  COLUNAS_VINCULOS,
  DialogoProporExtensao,
  DialogoRegistrarVinculo,
  EtiquetaSituacaoExtensao,
  ListaSinaisVinculo,
} from './comum';

const QUALIFICACOES: Record<IntegranteQuadro['qualificacao'], string> = {
  socio: 'Sócio',
  administrador: 'Administrador',
  socio_administrador: 'Sócio-administrador',
};

const COLUNAS_QUADRO: ColunaTabela<IntegranteQuadro>[] = [
  { id: 'nome', cabecalho: 'Nome (mascarado)', identificadora: true, celula: (i) => i.nome },
  { id: 'documento', cabecalho: 'CPF', celula: (i) => <span className="mono">{i.documento}</span> },
  { id: 'qualificacao', cabecalho: 'Qualificação', celula: (i) => QUALIFICACOES[i.qualificacao] },
  { id: 'entrada', cabecalho: 'Entrada na sociedade', celula: (i) => (i.dataEntrada ? <span className="numero">{formatarData(i.dataEntrada)}</span> : '—') },
];

function Conteudo({ dados }: { dados: VinculosFornecedor }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consultar = useConsultarQsa(dados.quadro.fornecedor.id);
  const [registrando, definirRegistrando] = useState(false);
  const [sinalExtensao, definirSinalExtensao] = useState<SinalVinculo | null>(null);
  const { quadro } = dados;
  const pj = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(quadro.fornecedor.documento);
  const podeRegistrar = temPermissao('impedimentos:registrar');
  const podePropor = temPermissao('sancoes:instruir');

  return (
    <>
      <Secao
        titulo="Quadro societário e cadastro do CNPJ"
        id="quadro"
        descricao="Dados abertos do CNPJ (Receita Federal), consultados pelo servidor. O CPF dos sócios aparece mascarado, como nos dados abertos."
        acoes={
          podeRegistrar && pj ? (
            <Botao
              variante="secundario"
              icone={RefreshCw}
              carregando={consultar.isPending}
              onClick={() =>
                consultar.mutate(undefined, {
                  onSuccess: (q) =>
                    avisar({
                      tipo: 'sucesso',
                      titulo: 'Quadro societário atualizado',
                      mensagem: `${q.integrantes.length} integrante(s) — ${q.proveniencia?.modo === 'online' ? 'base do CNPJ' : 'simulação offline'}.`,
                    }),
                })
              }
            >
              Consultar quadro societário
            </Botao>
          ) : null
        }
      >
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'CNPJ ou CPF', valor: <span className="mono">{quadro.fornecedor.documento}</span> },
            { termo: 'Abertura', valor: quadro.dataAbertura ? formatarData(quadro.dataAbertura) : 'Não informada' },
            { termo: 'Endereço do cadastro', valor: quadro.endereco ?? 'Não informado' },
          ]}
        />
        {consultar.isError ? (
          <Alerta tipo="erro" anunciar titulo="Não foi possível consultar a base do CNPJ">
            <p>{consultar.error.message}</p>
          </Alerta>
        ) : null}
        <Tabela
          id="quadro-societario"
          legenda="Integrantes do quadro societário"
          colunas={COLUNAS_QUADRO}
          linhas={quadro.integrantes}
          chave={(i) => i.id}
          semFerramentas
          vazio={<EstadoVazio titulo="Sem quadro societário registrado" descricao={pj ? 'Use “Consultar quadro societário”.' : 'Pessoa física não tem quadro societário.'} />}
        />
        <p className="texto-pequeno texto-secundario">
          {quadro.proveniencia
            ? `Fonte: ${quadro.proveniencia.fonte}. Consultado em ${formatarInstante(quadro.proveniencia.consultadoEm)}; ${quadro.proveniencia.registros} integrante(s); hash ${abreviarHash(quadro.proveniencia.hash)}.`
            : 'Quadro do cadastro do fornecedor; a base do CNPJ ainda não foi consultada.'}
        </p>
      </Secao>

      <Secao titulo="Sinais de vínculo e de possível sucessão" id="sinais" descricao="Com outros fornecedores do cadastro e com agentes públicos. Sinal não é acusação.">
        <ListaSinaisVinculo
          sinais={dados.sinais}
          titulo="Sinais do fornecedor"
          vazio="Nenhum sinal encontrado nas fontes consultadas."
          acao={
            podePropor
              ? (s) =>
                  s.tipo === 'possivel_sucessao' && s.sancaoOrigemId ? (
                    <Botao variante="secundario" tamanho="compacto" icone={Gavel} onClick={() => definirSinalExtensao(s)}>
                      Propor extensão da sanção
                    </Botao>
                  ) : null
              : undefined
          }
        />
      </Secao>

      <Secao
        titulo="Vínculos registrados"
        id="vinculos"
        acoes={podeRegistrar ? <BotaoRegistrarVinculo aoClicar={() => definirRegistrando(true)} /> : null}
      >
        <Tabela
          id="vinculos-fornecedor"
          legenda="Vínculos registrados do fornecedor"
          colunas={COLUNAS_VINCULOS}
          linhas={dados.vinculos}
          chave={(v) => v.id}
          semFerramentas
          vazio={<EstadoVazio titulo="Nenhum vínculo registrado" />}
        />
      </Secao>

      <Secao titulo="Extensões de sanção (art. 160)" id="extensoes">
        {dados.extensoes.length === 0 ? (
          <p className="texto-secundario">Nenhum procedimento de extensão envolve este fornecedor.</p>
        ) : (
          <ul className="lista-simples pilha pilha--compacta">
            {dados.extensoes.map((e) => (
              <li key={e.id} className="linha">
                <Link to={`/impedimentos/extensoes/${e.id}`}>
                  {ALVOS_EXTENSAO[e.alvo.tipo]}: {e.alvo.fornecedor?.nome ?? e.alvo.pessoa?.nome ?? '—'} (sanção de {e.sancaoOrigem.fornecedor.nome})
                </Link>
                <EtiquetaSituacaoExtensao situacao={e.situacao} />
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {podeRegistrar ? (
        <DialogoRegistrarVinculo
          aberto={registrando}
          aoFechar={() => definirRegistrando(false)}
          fornecedorInicial={{ id: quadro.fornecedor.id, nome: quadro.fornecedor.nome }}
        />
      ) : null}
      {podePropor ? <DialogoProporExtensao aberto={sinalExtensao !== null} aoFechar={() => definirSinalExtensao(null)} sinal={sinalExtensao} /> : null}
    </>
  );
}

export default function FornecedorVinculos() {
  const { id = '' } = useParams();
  const consulta = useVinculosFornecedor(id);
  return (
    <Pagina
      titulo={consulta.data ? consulta.data.quadro.fornecedor.nome : 'Vínculos do fornecedor'}
      subtitulo="Vínculos, quadro societário e impedimentos do fornecedor."
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Vínculos e impedimentos', para: '/impedimentos' },
      ]}
      tela="impedimentos.fornecedor"
      acoes={
        <LinkBotao to={`/fornecedores/${id}`} variante="secundario">
          Ver cadastro do fornecedor
        </LinkBotao>
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando os vínculos do fornecedor"
        naoEncontrado={{ titulo: 'Fornecedor não encontrado', acao: <LinkBotao to="/impedimentos">Voltar para vínculos e impedimentos</LinkBotao> }}
      >
        {(dados) => <Conteudo dados={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
