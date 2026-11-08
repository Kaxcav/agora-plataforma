/**
 * Stepper horizontal das 7 etapas. A etapa atual do processo recebe `aria-current="step"`; as concluídas,
 * ícone de check; a atual com bloqueios, ícone de alerta. Qualquer etapa pode ser aberta para consulta.
 */
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Check, TriangleAlert } from 'lucide-react';
import { ETAPAS_JORNADA, type EtapaJornada } from '@agora/contratos';
import { contar } from '../../utilitarios/formatacao';
import { TOTAL_ETAPAS } from './rotulos';

type SituacaoEtapa = 'concluida' | 'atual' | 'futura';

export interface PropsTrilhaEtapas {
  etapaAtual: EtapaJornada;
  selecionada: EtapaJornada;
  bloqueios: number;
  /** Etapa 7 concluída (contrato gerado). */
  encerrado: boolean;
  /** Endereço que abre a etapa (mantém os demais parâmetros da URL). */
  endereco: (etapa: EtapaJornada) => string;
}

export function TrilhaEtapas({ etapaAtual, selecionada, bloqueios, encerrado, endereco }: PropsTrilhaEtapas) {
  const trilha = useRef<HTMLElement>(null);

  // Em telas estreitas a trilha rola na horizontal: centraliza a etapa exibida (sem rolar a página).
  useEffect(() => {
    const nav = trilha.current;
    if (!nav || nav.scrollWidth <= nav.clientWidth) return;
    const item = nav.querySelector<HTMLElement>('.jornada-trilha__item--selecionada');
    if (!item) return;
    const deslocamento = item.getBoundingClientRect().left - nav.getBoundingClientRect().left;
    nav.scrollLeft = Math.max(0, nav.scrollLeft + deslocamento - (nav.clientWidth - item.offsetWidth) / 2);
  }, [selecionada]);

  return (
    <nav ref={trilha} className="jornada-trilha" aria-label="Etapas do processo">
      <ol className="jornada-trilha__lista">
        {ETAPAS_JORNADA.map(({ etapa, titulo }) => {
          const situacao: SituacaoEtapa = etapa < etapaAtual || (encerrado && etapa === etapaAtual) ? 'concluida' : etapa === etapaAtual ? 'atual' : 'futura';
          const comBloqueio = situacao === 'atual' && bloqueios > 0;
          const textoSituacao =
            situacao === 'concluida'
              ? 'Concluída'
              : situacao === 'futura'
                ? 'Não iniciada'
                : comBloqueio
                  ? `Atual · ${contar(bloqueios, 'bloqueio', 'bloqueios')}`
                  : 'Atual · sem bloqueios';
          return (
            <li
              key={etapa}
              className={[
                'jornada-trilha__item',
                `jornada-trilha__item--${situacao}`,
                comBloqueio ? 'jornada-trilha__item--bloqueada' : '',
                etapa === selecionada ? 'jornada-trilha__item--selecionada' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <Link
                to={endereco(etapa)}
                replace
                preventScrollReset
                className="jornada-trilha__link"
                aria-current={etapa === etapaAtual ? 'step' : undefined}
              >
                <span className="jornada-trilha__marcador" aria-hidden="true">
                  {situacao === 'concluida' ? <Check size={16} strokeWidth={3} /> : comBloqueio ? <TriangleAlert size={16} /> : etapa}
                </span>
                <span className="jornada-trilha__textos">
                  <span className="jornada-trilha__numero">
                    Etapa {etapa}
                    <span className="sr-only"> de {TOTAL_ETAPAS}</span>
                  </span>
                  <span className="jornada-trilha__titulo">{titulo}</span>
                  <span className="jornada-trilha__situacao">{textoSituacao}</span>
                </span>
                {etapa === selecionada ? <span className="sr-only">, em exibição</span> : null}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
