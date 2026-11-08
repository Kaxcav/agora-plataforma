/**
 * Gestão compartilhada com a sociedade (RF-37), visão da Administração: fila de moderação e manifestações das
 * UASGs do escopo, e acesso ao painel de cada contrato (registros da execução e relatório final).
 */
import { useState } from 'react';
import { Link } from 'react-router';
import type { SituacaoManifestacao } from '@agora/contratos';
import { useContratos } from '../../api/contratos';
import { useManifestacoesModeracao } from '../../api/sociedade';
import { CampoBusca, ConteudoConsulta, EstadoVazio, EsqueletoTexto, Pagina, Paginacao, Secao, Selecao } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { CartaoManifestacao } from './CartaoManifestacao';
import '../../design/paginas-sociedade.css';

const FILTROS: { valor: SituacaoManifestacao | 'todas'; rotulo: string }[] = [
  { valor: 'em_moderacao', rotulo: 'Aguardando moderação' },
  { valor: 'publicada', rotulo: 'Publicadas' },
  { valor: 'recusada', rotulo: 'Não publicadas' },
  { valor: 'todas', rotulo: 'Todas' },
];

function BuscaContrato() {
  const { temPermissao } = useSessao();
  const [busca, definirBusca] = useState('');
  const habilitado = temPermissao('contratos:ler') && busca.trim().length >= 2;
  const consulta = useContratos({ busca: busca.trim(), pagina: 1, tamanhoPagina: 10 }, habilitado);
  if (!temPermissao('contratos:ler')) return null;
  return (
    <Secao titulo="Abrir um contrato" id="abrir-contrato" descricao="Para publicar fotos e vídeos da execução ou o relatório final, abra o painel do contrato.">
      <div className="pilha pilha--compacta">
        <CampoBusca rotulo="Buscar contrato" placeholder="Número, objeto ou fornecedor" valor={busca} aoMudar={definirBusca} />
        {habilitado && consulta.data ? (
          consulta.data.itens.length === 0 ? (
            <p className="texto-secundario">Nenhum contrato encontrado no seu escopo.</p>
          ) : (
            <ul className="lista-simples pilha pilha--compacta" aria-label="Contratos encontrados">
              {consulta.data.itens.map((c) => (
                <li key={c.id}>
                  <Link to={`/sociedade/contratos/${c.id}`}>
                    Contrato {c.numero} — {c.objeto}
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </Secao>
  );
}

export default function GestaoCompartilhada() {
  const [situacao, definirSituacao] = useState<SituacaoManifestacao | 'todas'>('em_moderacao');
  const [pagina, definirPagina] = useState(1);
  const [tamanhoPagina, definirTamanhoPagina] = useState(25);
  const consulta = useManifestacoesModeracao({ situacao: situacao === 'todas' ? undefined : situacao, pagina, tamanhoPagina });

  return (
    <Pagina
      titulo="Gestão compartilhada com a sociedade"
      subtitulo="Manifestações de cidadãos identificados pelo gov.br sobre os contratos: moderação com motivo, respostas identificadas e prazo de 30 dias (Lei 14.133/2021, art. 174, § 3º, VI)."
      tela="sociedade"
    >
      <div className="pilha pilha--ampla">
        <BuscaContrato />
        <Secao
          titulo="Manifestações"
          id="manifestacoes"
          acoes={
            <Selecao
              rotulo="Situação"
              value={situacao}
              onChange={(e) => {
                definirSituacao(e.target.value as SituacaoManifestacao | 'todas');
                definirPagina(1);
              }}
              opcoes={FILTROS.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))}
            />
          }
        >
          <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Carregando as manifestações">
            {(dados) =>
              dados.itens.length === 0 ? (
                <EstadoVazio titulo="Nenhuma manifestação nesta situação" descricao="As mensagens enviadas pelos cidadãos aparecem aqui para moderação." />
              ) : (
                <div className="pilha">
                  <ul className="sociedade__manifestacoes" aria-label="Manifestações da sociedade">
                    {dados.itens.map((m) => (
                      <CartaoManifestacao key={m.id} m={m} mostrarContrato />
                    ))}
                  </ul>
                  <Paginacao
                    pagina={pagina}
                    tamanhoPagina={tamanhoPagina}
                    total={dados.total}
                    aoMudarPagina={definirPagina}
                    aoMudarTamanho={(t) => {
                      definirTamanhoPagina(t);
                      definirPagina(1);
                    }}
                    rotulo="Paginação das manifestações"
                  />
                </div>
              )
            }
          </ConteudoConsulta>
        </Secao>
      </div>
    </Pagina>
  );
}
