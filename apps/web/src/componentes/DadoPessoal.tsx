import { useState } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import type { EntradaRevelar } from '@agora/contratos';
import { useRevelarDadoPessoal } from '../api/auditoria';
import { useSessao } from '../sessao/ContextoSessao';
import { Botao } from './Botao';
import { AreaTexto } from './Campo';
import { ConfirmarAcao } from './Dialogo';

export interface PropsDadoPessoal {
  /** Valor mascarado vindo da API. */
  valor: string;
  recurso: EntradaRevelar['recurso'];
  id: string;
  campo: EntradaRevelar['campo'];
  /** Descrição do dado para o diálogo ("CPF do credor"). */
  descricao: string;
}

const MINIMO = 10;
const MAXIMO = 300;

/**
 * Dado pessoal mascarado por padrão (LGPD). "Revelar" exige finalidade e registra o acesso
 * (`POST /lgpd/revelar`, art. 37). O valor revelado vive só no estado deste componente.
 */
export function DadoPessoal({ valor, recurso, id, campo, descricao }: PropsDadoPessoal) {
  const { temPermissao } = useSessao();
  const revelar = useRevelarDadoPessoal();
  const [aberto, definirAberto] = useState(false);
  const [finalidade, definirFinalidade] = useState('');
  const [tentou, definirTentou] = useState(false);
  const [revelado, definirRevelado] = useState<{ valor: string; registro: string } | null>(null);

  const mascarado = valor.includes('*');
  const podeRevelar = mascarado && temPermissao('lgpd:revelar');
  const tamanho = finalidade.trim().length;
  const erroFinalidade =
    tentou && tamanho < MINIMO ? `Descreva a finalidade com pelo menos ${MINIMO} caracteres.` : null;

  const fechar = () => {
    definirAberto(false);
    definirFinalidade('');
    definirTentou(false);
    revelar.reset();
  };

  const confirmar = () => {
    definirTentou(true);
    if (tamanho < MINIMO) return;
    revelar.mutate(
      { recurso, id, campo, finalidade: finalidade.trim() },
      {
        onSuccess: (resposta) => {
          definirRevelado({ valor: resposta.valor, registro: resposta.registroAcessoId });
          definirAberto(false);
          definirFinalidade('');
          definirTentou(false);
        },
      },
    );
  };

  if (revelado) {
    return (
      <span className="dado-pessoal dado-pessoal--revelado">
        <span className="mono">{revelado.valor}</span>
        <span className="dado-pessoal__registro" title={`Registro de acesso ${revelado.registro}`}>
          <ShieldCheck size={14} aria-hidden="true" /> acesso registrado
        </span>
        <Botao variante="terciario" tamanho="compacto" icone={EyeOff} onClick={() => definirRevelado(null)} aria-label={`Ocultar ${descricao}`}>
          Ocultar
        </Botao>
      </span>
    );
  }

  return (
    <span className="dado-pessoal">
      <span className="mono">{valor}</span>
      {mascarado ? <span className="sr-only"> (mascarado para proteção de dado pessoal)</span> : null}
      {podeRevelar ? (
        <>
          <Botao variante="terciario" tamanho="compacto" icone={Eye} onClick={() => definirAberto(true)} aria-label={`Revelar ${descricao}`}>
            Revelar
          </Botao>
          <ConfirmarAcao
            aberto={aberto}
            aoFechar={fechar}
            titulo={`Revelar ${descricao}`}
            descricao={
              <p>
                O acesso a dado pessoal é registrado com seu nome, data, hora e finalidade (LGPD, art. 37) e aparece no relatório de acessos
                da auditoria. Informe para que você precisa do dado completo.
              </p>
            }
            rotuloConfirmar="Revelar e registrar acesso"
            aoConfirmar={confirmar}
            processando={revelar.isPending}
            erro={revelar.error}
          >
            <AreaTexto
              rotulo="Finalidade do acesso"
              obrigatorio
              value={finalidade}
              onChange={(e) => definirFinalidade(e.target.value)}
              maxLength={MAXIMO}
              contador
              rows={3}
              erro={erroFinalidade}
              ajuda="Ex.: conferência de documento para emissão de nota de empenho."
            />
          </ConfirmarAcao>
        </>
      ) : null}
    </span>
  );
}
