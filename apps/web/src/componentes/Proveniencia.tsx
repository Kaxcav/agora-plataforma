import { CircleCheck, CircleDashed, CircleX, Clock, Database } from 'lucide-react';
import type { FonteDados, Proveniencia as DadosProveniencia } from '@agora/contratos';
import { formatarInstante } from '../utilitarios/formatacao';

export const NOMES_FONTES: Record<FonteDados, string> = {
  PNCP: 'PNCP',
  COMPRAS_GOV: 'Compras.gov.br',
  CONTRATOS_GOV: 'Contratos.gov.br',
  SIAFI: 'SIAFI',
  AGORA: 'Ágora (registro próprio)',
};

const SITUACOES: Record<DadosProveniencia['situacao'], { rotulo: string; classe: string; Icone: typeof CircleCheck }> = {
  atualizado: { rotulo: 'Atualizado', classe: 'sucesso', Icone: CircleCheck },
  desatualizado: { rotulo: 'Desatualizado', classe: 'aviso', Icone: Clock },
  falhou: { rotulo: 'Última sincronização falhou', classe: 'erro', Icone: CircleX },
  nunca_sincronizado: { rotulo: 'Nunca sincronizado', classe: 'neutro', Icone: CircleDashed },
};

function ItemProveniencia({ dado }: { dado: DadosProveniencia }) {
  const s = SITUACOES[dado.situacao];
  return (
    <li className={`proveniencia__item proveniencia__item--${s.classe}`}>
      <span className="proveniencia__fonte">
        <Database size={14} aria-hidden="true" />
        Fonte: <strong>{NOMES_FONTES[dado.fonte]}</strong>
      </span>
      <span className="proveniencia__data">
        {dado.atualizadoEm ? <>Atualizado em {formatarInstante(dado.atualizadoEm)}</> : 'Sem data de atualização'}
      </span>
      <span className="proveniencia__situacao">
        <s.Icone size={14} aria-hidden="true" />
        {s.rotulo}
      </span>
    </li>
  );
}

function ehLista(dados: DadosProveniencia | readonly DadosProveniencia[]): dados is readonly DadosProveniencia[] {
  return Array.isArray(dados);
}

/** Origem, horário e estado de sincronização de cada conjunto de dados exibido. */
export function Proveniencia({ dados, titulo = 'Proveniência dos dados' }: { dados: DadosProveniencia | readonly DadosProveniencia[]; titulo?: string }) {
  const lista: readonly DadosProveniencia[] = ehLista(dados) ? dados : [dados];
  if (lista.length === 0) return null;
  const algumProblema = lista.some((d) => d.situacao !== 'atualizado');
  return (
    <aside className={['proveniencia', algumProblema ? 'proveniencia--atencao' : ''].filter(Boolean).join(' ')} aria-label={titulo}>
      <ul className="proveniencia__lista">
        {lista.map((d) => (
          <ItemProveniencia key={`${d.fonte}-${d.atualizadoEm ?? 'nunca'}`} dado={d} />
        ))}
      </ul>
      {algumProblema ? (
        <p className="proveniencia__nota">
          Parte dos dados pode estar desatualizada. Os valores exibidos são os da última sincronização bem-sucedida.
        </p>
      ) : null}
    </aside>
  );
}
