import { useEffect, useId, useState } from 'react';
import { Campo, Selecao } from '../../componentes/Campo';
import { useSessao } from '../../sessao/ContextoSessao';

/**
 * Filtro por UASG. Usuário com escopo restrito escolhe entre as suas UASGs; com escopo total, informa
 * o código de 6 dígitos (o contrato da API não expõe catálogo de UASGs).
 */
export function CampoUasg({ valor, aoMudar, rotulo = 'UASG' }: { valor: string | undefined; aoMudar: (valor: string | undefined) => void; rotulo?: string }) {
  const { usuario } = useSessao();
  const id = useId();
  const [texto, definirTexto] = useState(valor ?? '');
  const [erro, definirErro] = useState<string | null>(null);

  useEffect(() => {
    definirTexto(valor ?? '');
  }, [valor]);

  if (usuario && !usuario.todasUasgs && usuario.uasgs.length > 0) {
    return (
      <Selecao
        rotulo={rotulo}
        value={valor ?? ''}
        opcaoVazia="Todas do meu escopo"
        opcoes={usuario.uasgs.map((u) => ({ valor: u, rotulo: u }))}
        onChange={(e) => aoMudar(e.target.value || undefined)}
      />
    );
  }

  const aplicar = () => {
    const limpo = texto.replace(/\D/g, '');
    if (limpo === '') {
      definirErro(null);
      aoMudar(undefined);
    } else if (limpo.length === 6) {
      definirErro(null);
      aoMudar(limpo);
    } else {
      definirErro('O código da UASG tem 6 dígitos.');
    }
  };

  return (
    <Campo id={id} rotulo={rotulo} erro={erro}>
      {(atributos) => (
        <input
          {...atributos}
          className="campo__controle numero"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          placeholder="Todas"
          value={texto}
          onChange={(e) => definirTexto(e.target.value)}
          onBlur={aplicar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              aplicar();
            }
          }}
        />
      )}
    </Campo>
  );
}
