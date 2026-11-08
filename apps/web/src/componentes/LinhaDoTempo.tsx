import { CalendarCheck, CalendarClock, CalendarX2, FilePen, Flag, Megaphone, Percent, PenLine, Scale, type LucideIcon } from 'lucide-react';
import type { EventoLinhaDoTempo } from '@agora/contratos';
import { formatarData } from '@agora/dominio';

const ICONES: Record<EventoLinhaDoTempo['tipo'], LucideIcon> = {
  assinatura: PenLine,
  divulgacao: Megaphone,
  inicio_vigencia: CalendarCheck,
  fim_vigencia: CalendarX2,
  aditivo: FilePen,
  reajuste: Percent,
  apostilamento: Scale,
  marco: Flag,
};

/** Linha do tempo do instrumento; eventos futuros aparecem tracejados e são anunciados como previstos. */
export function LinhaDoTempo({ eventos, titulo = 'Linha do tempo' }: { eventos: readonly EventoLinhaDoTempo[]; titulo?: string }) {
  if (eventos.length === 0) {
    return <p className="texto-secundario">Nenhum evento registrado.</p>;
  }
  return (
    <ol className="linha-tempo" aria-label={titulo}>
      {eventos.map((e, i) => {
        const Icone = e.futuro ? CalendarClock : ICONES[e.tipo];
        return (
          <li key={`${e.data}-${i}`} className={['linha-tempo__evento', e.futuro ? 'linha-tempo__evento--futuro' : ''].filter(Boolean).join(' ')}>
            <span className="linha-tempo__marcador" aria-hidden="true">
              <Icone size={14} />
            </span>
            <div className="linha-tempo__conteudo">
              <p className="linha-tempo__data numero">
                <time dateTime={e.data}>{formatarData(e.data)}</time>
                {e.futuro ? <span className="linha-tempo__previsto"> · previsto</span> : null}
              </p>
              <p className="linha-tempo__titulo">{e.titulo}</p>
              {e.descricao ? <p className="linha-tempo__descricao">{e.descricao}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
