import { useConfiguracaoPublica } from '../../api/sessao';
import { Pagina } from '../../componentes';

/** Declaração de acessibilidade (WCAG 2.1 AA, eMAG 3.1, gov.br DS 3.7). */
export default function Acessibilidade() {
  const { data: config } = useConfiguracaoPublica();
  return (
    <Pagina
      titulo="Acessibilidade"
      subtitulo="Compromisso da Ágora com o acesso de todas as pessoas, inclusive as que usam tecnologias assistivas."
      estreita
    >
      <div className="texto-institucional">
        <section aria-labelledby="acess-padroes">
          <h2 id="acess-padroes">Padrões adotados</h2>
          <p>
            A interface segue o Padrão Digital de Governo (gov.br Design System 3.7), tem como meta o nível AA das Diretrizes de Acessibilidade para
            Conteúdo Web (WCAG 2.1) e observa o Modelo de Acessibilidade em Governo Eletrônico (eMAG 3.1) e a Lei Brasileira de Inclusão (Lei
            13.146/2015, art. 63).
          </p>
        </section>

        <section aria-labelledby="acess-recursos">
          <h2 id="acess-recursos">Recursos disponíveis</h2>
          <ul>
            <li>
              Link <strong>“Ir para o conteúdo principal”</strong> como primeiro item de cada página, visível ao receber o foco.
            </li>
            <li>Navegação completa por teclado, com foco sempre visível (contorno dourado) e ordem de leitura lógica.</li>
            <li>Regiões identificadas (cabeçalho, menu principal, conteúdo, rodapé) e um título principal por página, anunciado ao trocar de página.</li>
            <li>Textos com contraste mínimo de 4,5:1; a interface funciona com ampliação de até 200% sem perda de conteúdo.</li>
            <li>Situações (vencido, crítico, em risco) sempre indicadas por ícone e texto, nunca só por cor.</li>
            <li>Tabelas com título, cabeçalhos associados e ordenação anunciada; em telas estreitas, cada linha vira um cartão.</li>
            <li>Gráficos acompanhados de tabela com os mesmos valores.</li>
            <li>Resultados de filtros e avisos anunciados por leitores de tela, sem mover o foco.</li>
            <li>Formulários com rótulos visíveis, campos obrigatórios identificados e mensagens de erro ligadas ao campo.</li>
            <li>Animações reduzidas quando o sistema operacional pede menos movimento.</li>
            <li>Dados pessoais mascarados são lidos como tal pelos leitores de tela.</li>
          </ul>
        </section>

        <section aria-labelledby="acess-teclado">
          <h2 id="acess-teclado">Teclas úteis</h2>
          <div className="tabela-rolagem" role="region" aria-labelledby="acess-tabela-teclas" tabIndex={0}>
            <table className="tabela tabela--compacta">
              <caption id="acess-tabela-teclas" className="tabela__legenda">
                Atalhos de teclado
              </caption>
              <thead>
                <tr>
                  <th scope="col">Tecla</th>
                  <th scope="col">Ação</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd>
                  </th>
                  <td>Avança ou volta entre links, botões e campos</td>
                </tr>
                <tr>
                  <th scope="row">
                    <kbd>Enter</kbd> / <kbd>Espaço</kbd>
                  </th>
                  <td>Aciona botões, links e interruptores</td>
                </tr>
                <tr>
                  <th scope="row">
                    <kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>End</kbd>
                  </th>
                  <td>Troca de aba nos grupos de abas</td>
                </tr>
                <tr>
                  <th scope="row">
                    <kbd>Esc</kbd>
                  </th>
                  <td>Fecha diálogos, o menu em telas pequenas e listas suspensas</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="acess-avaliacao">
          <h2 id="acess-avaliacao">Avaliação e limitações conhecidas</h2>
          <p>
            A conformidade é verificada com testes automatizados e revisão manual com teclado e leitor de tela. Ferramentas automáticas não bastam
            para declarar conformidade plena; por isso, a avaliação com pessoas usuárias de tecnologias assistivas integra o plano de implantação.
          </p>
          <p>
            Documentos gerados por terceiros e anexos externos (por exemplo, arquivos publicados no PNCP) podem não seguir os mesmos critérios.
          </p>
        </section>

        <section aria-labelledby="acess-contato">
          <h2 id="acess-contato">Encontrou uma barreira?</h2>
          <p>
            Informe a página, o que tentou fazer e o recurso de acessibilidade que usa
            {config ? (
              <>
                {' '}
                pelo canal de atendimento do {config.orgao.sigla} ou pelo e-mail{' '}
                <a href={`mailto:${config.encarregadoLgpd.email}`}>{config.encarregadoLgpd.email}</a>
              </>
            ) : (
              ' pelo canal de atendimento do órgão'
            )}
            . Toda manifestação é respondida e usada para corrigir a interface.
          </p>
          {config ? <p className="texto-pequeno texto-secundario">Declaração referente à versão {config.versao} da Ágora.</p> : null}
        </section>
      </div>
    </Pagina>
  );
}
