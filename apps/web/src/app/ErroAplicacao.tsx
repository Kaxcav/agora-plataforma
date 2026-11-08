import { useEffect } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { definirTituloDocumento } from '../layout/foco';

/**
 * Falha inesperada de renderização ou de carregamento de módulo (ex.: nova versão publicada
 * enquanto a página estava aberta). Não depende de provedores para funcionar.
 */
export function ErroAplicacao() {
  const erro = useRouteError();
  const falhaDeModulo = erro instanceof TypeError && /dynamically imported module|Importing a module script failed/i.test(erro.message);

  useEffect(() => {
    definirTituloDocumento('Erro');
  }, []);

  const detalhe = isRouteErrorResponse(erro)
    ? `${erro.status} ${erro.statusText}`
    : falhaDeModulo
      ? 'Uma nova versão da Ágora foi publicada. Recarregue a página para continuar.'
      : 'A interface encontrou um erro inesperado. Seus dados não foram alterados.';

  return (
    <main id="conteudo" className="erro-aplicacao" tabIndex={-1}>
      <div className="estado estado--erro">
        <ServerCrash className="estado__icone" size={40} aria-hidden="true" />
        <h1 className="estado__titulo">Não foi possível exibir esta página</h1>
        <p className="estado__descricao">{detalhe}</p>
        <div className="estado__acao linha">
          <button type="button" className="botao botao--primario" onClick={() => window.location.reload()}>
            <RefreshCw size={16} aria-hidden="true" />
            <span>Recarregar a página</span>
          </button>
          <a className="botao botao--secundario" href="/">
            <span>Ir para o início</span>
          </a>
        </div>
      </div>
    </main>
  );
}
