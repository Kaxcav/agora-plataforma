import { useLocation } from 'react-router';
import { MapPinOff } from 'lucide-react';
import { EstadoVazio, LinkBotao, Pagina } from '../componentes';
import { useSessao } from '../sessao/ContextoSessao';

export default function NaoEncontrada() {
  const { usuario } = useSessao();
  const { pathname } = useLocation();
  return (
    <Pagina titulo="Página não encontrada" trilha={usuario ? [{ rotulo: 'Início', para: '/' }] : undefined}>
      <EstadoVazio
        icone={MapPinOff}
        titulo="Não encontramos este endereço"
        descricao={
          <p>
            O endereço <code>{pathname}</code> não existe ou foi movido. Confira o link ou siga por um dos caminhos abaixo.
          </p>
        }
        acao={
          <div className="linha">
            {usuario ? (
              <LinkBotao to="/" variante="primario">
                Ir para o início
              </LinkBotao>
            ) : (
              <LinkBotao to="/entrar" variante="primario">
                Entrar na Ágora
              </LinkBotao>
            )}
            <LinkBotao to="/transparencia" variante="secundario">
              Transparência
            </LinkBotao>
          </div>
        }
      />
    </Pagina>
  );
}
