import { useId } from 'react';
import { Check, KeyRound, Minus } from 'lucide-react';
import type { PerfilAcesso } from '@agora/contratos';
import { usePerfis } from '../../api/admin';
import { Alerta, ConteudoConsulta, EsqueletoTabela, EstadoVazio, Pagina, Secao } from '../../componentes';
import { NOMES_PERMISSOES, TODAS_PERMISSOES } from '../../sessao/permissoes';
import { contar } from '../../utilitarios/formatacao';

function MatrizPermissoes({ perfis }: { perfis: readonly PerfilAcesso[] }) {
  const idLegenda = useId();
  return (
    <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
      <table className="tabela matriz">
        <caption id={idLegenda} className="tabela__legenda">
          Matriz de permissões por perfil
        </caption>
        <thead>
          <tr>
            <th scope="col">Permissão</th>
            {perfis.map((p) => (
              <th key={p.codigo} scope="col" className="tabela__alinhar--centro">
                {p.nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TODAS_PERMISSOES.map((permissao) => (
            <tr key={permissao}>
              <th scope="row" className="matriz__permissao">
                {NOMES_PERMISSOES[permissao]}
                <code>{permissao}</code>
              </th>
              {perfis.map((p) =>
                p.permissoes.includes(permissao) ? (
                  <td key={p.codigo} className="matriz__celula">
                    <Check className="matriz__sim" size={18} aria-hidden="true" />
                    <span className="sr-only">Sim</span>
                  </td>
                ) : (
                  <td key={p.codigo} className="matriz__celula">
                    <Minus className="matriz__nao" size={18} aria-hidden="true" />
                    <span className="sr-only">Não</span>
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Perfis() {
  const consulta = usePerfis();
  return (
    <Pagina
      titulo="Perfis de acesso"
      subtitulo="Controle de acesso baseado em perfis (RBAC), combinado com o escopo de UASGs de cada usuário."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Administração' }]}
      tela="admin"
    >
      <Alerta tipo="info" compacto>
        <p>
          A matriz é definida no código da Ágora e aplicada pelo servidor em cada requisição (RNF-05). Esta tela é somente de consulta; para
          mudar o que uma pessoa pode fazer, altere os perfis dela em Usuários.
        </p>
      </Alerta>
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={8} colunas={6} />} rotuloCarregando="Carregando perfis">
        {(perfis) =>
          perfis.length === 0 ? (
            <EstadoVazio icone={KeyRound} titulo="Nenhum perfil disponível" />
          ) : (
            <>
              <Secao titulo="Perfis" id="perfis" descricao={contar(perfis.length, 'perfil disponível', 'perfis disponíveis')}>
                <ul className="cartoes-perfis lista-simples">
                  {perfis.map((p) => (
                    <li key={p.codigo} className="cartao-perfil">
                      <h3 className="cartao-perfil__nome">{p.nome}</h3>
                      <p className="cartao-perfil__descricao">{p.descricao}</p>
                      <p className="cartao-perfil__total">
                        {contar(p.permissoes.length, 'permissão', 'permissões')} · <code>{p.codigo}</code>
                      </p>
                    </li>
                  ))}
                </ul>
              </Secao>
              <Secao titulo="Matriz de permissões" id="matriz" descricao="Cada linha é uma permissão; cada coluna, um perfil.">
                <MatrizPermissoes perfis={perfis} />
              </Secao>
            </>
          )
        }
      </ConteudoConsulta>
    </Pagina>
  );
}
