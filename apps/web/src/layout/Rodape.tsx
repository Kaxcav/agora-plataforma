import { Link } from 'react-router';
import { useConfiguracaoPublica } from '../api/sessao';
import { Monograma } from './Marca';

const AMBIENTES = { demonstracao: 'Demonstração', homologacao: 'Homologação', producao: 'Produção' } as const;

export function Rodape() {
  const { data: configuracao } = useConfiguracaoPublica();
  return (
    <footer className="rodape">
      <div className="rodape__interno">
        <div className="rodape__coluna rodape__coluna--marca">
          <p className="rodape__marca">
            <Monograma tamanho={28} />
            <span>Ágora</span>
          </p>
          {configuracao ? (
            <p className="rodape__orgao">
              {configuracao.orgao.nome}
              {configuracao.orgao.unidade ? <> — {configuracao.orgao.unidade}</> : null}
            </p>
          ) : null}
          <p className="rodape__texto">
            Plataforma de gestão das contratações públicas (Lei 14.133/2021), implantada na infraestrutura do próprio órgão.
          </p>
        </div>
        <div className="rodape__coluna">
          <h2 className="rodape__titulo">Fontes de dados</h2>
          <ul className="lista-simples rodape__lista">
            <li>PNCP — Portal Nacional de Contratações Públicas</li>
            <li>Compras.gov.br</li>
            <li>Contratos.gov.br</li>
            <li>SIAFI (execução orçamentária e financeira)</li>
          </ul>
          <p className="rodape__nota">As integrações rodam no servidor da Ágora, com registro de proveniência; o navegador não acessa sistemas externos.</p>
        </div>
        <div className="rodape__coluna">
          <h2 className="rodape__titulo">Informações</h2>
          <ul className="lista-simples rodape__lista">
            <li>
              <Link to="/transparencia">Transparência</Link>
            </li>
            <li>
              <Link to="/privacidade">Privacidade e LGPD</Link>
            </li>
            <li>
              <Link to="/acessibilidade">Acessibilidade</Link>
            </li>
            <li>
              <Link to="/regras">Caderno de regras</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="rodape__base">
        <p>
          {configuracao ? (
            <>
              {configuracao.produto} versão {configuracao.versao} · Ambiente de {AMBIENTES[configuracao.ambiente].toLowerCase()}
            </>
          ) : (
            'Ágora'
          )}
        </p>
        <p>Padrão Digital de Governo (gov.br DS 3.7) · WCAG 2.1 AA · eMAG</p>
      </div>
    </footer>
  );
}

/** Faixa de ambiente (não fechável) em demonstração e homologação. */
export function FaixaAmbiente() {
  const { data: configuracao } = useConfiguracaoPublica();
  if (!configuracao || configuracao.ambiente === 'producao') return null;
  const texto =
    configuracao.ambiente === 'demonstracao'
      ? 'Ambiente de demonstração — todos os dados são fictícios'
      : 'Ambiente de homologação — dados de teste, sem validade jurídica';
  return (
    <div className={`faixa-ambiente faixa-ambiente--${configuracao.ambiente}`} role="note">
      <span className="faixa-ambiente__marcador" aria-hidden="true" />
      {texto}
    </div>
  );
}

/** Primeiro foco da página. */
export function LinkSalto() {
  return (
    <a
      className="link-salto"
      href="#conteudo"
      onClick={(e) => {
        e.preventDefault();
        document.getElementById('conteudo')?.focus();
      }}
    >
      Ir para o conteúdo principal
    </a>
  );
}
