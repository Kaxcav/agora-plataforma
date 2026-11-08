import type { UseQueryResult } from '@tanstack/react-query';
import { History } from 'lucide-react';
import type { EventoHistorico } from '@agora/contratos';
import { ConteudoConsulta, EstadoVazio } from '../../componentes/Estados';
import { EsqueletoTexto } from '../../componentes/Esqueleto';
import { formatarInstante } from '../../utilitarios/formatacao';

/** Histórico do instrumento (trilha de ações de usuários e integrações). */
export function Historico({ consulta }: { consulta: UseQueryResult<EventoHistorico[]> }) {
  return (
    <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTexto linhas={6} />} rotuloCarregando="Carregando histórico">
      {(eventos) =>
        eventos.length === 0 ? (
          <EstadoVazio icone={History} titulo="Sem eventos no histórico" descricao="As ações registradas sobre este instrumento aparecerão aqui." />
        ) : (
          <ol className="historico cartao" aria-label="Histórico de ações">
            {eventos.map((e) => (
              <li key={e.id}>
                <span className="historico__quando numero">
                  <time dateTime={e.ocorridoEm}>{formatarInstante(e.ocorridoEm)}</time>
                </span>
                <div>
                  <p className="historico__acao">{e.acao}</p>
                  <p className="texto-pequeno texto-secundario">
                    {e.usuario ? e.usuario.nome : 'Sistema (integração)'}
                    {e.detalhes ? ` — ${e.detalhes}` : ''}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )
      }
    </ConteudoConsulta>
  );
}
