import type { ReactNode } from 'react';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  Info,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Prioridade, Semaforo as ValorSemaforo, SituacaoInstrumento } from '@agora/contratos';
import { classificarVigencia, hojeISO } from '@agora/dominio';

export type TomEtiqueta = 'neutro' | 'info' | 'sucesso' | 'aviso' | 'alerta' | 'erro' | 'critico';

const ICONES_TOM: Record<TomEtiqueta, LucideIcon> = {
  neutro: CircleDashed,
  info: Info,
  sucesso: CircleCheck,
  aviso: TriangleAlert,
  alerta: Clock,
  erro: CircleX,
  critico: OctagonAlert,
};

export interface PropsEtiqueta {
  tom?: TomEtiqueta;
  icone?: LucideIcon | null;
  children: ReactNode;
  titulo?: string;
  compacta?: boolean;
}

/** Situação comunicada SEMPRE por ícone + texto (nunca só por cor). */
export function Etiqueta({ tom = 'neutro', icone, children, titulo, compacta }: PropsEtiqueta) {
  const Icone = icone === null ? null : (icone ?? ICONES_TOM[tom]);
  return (
    <span className={['etiqueta', `etiqueta--${tom}`, compacta ? 'etiqueta--compacta' : ''].filter(Boolean).join(' ')} title={titulo}>
      {Icone ? <Icone size={14} aria-hidden="true" /> : null}
      <span>{children}</span>
    </span>
  );
}

const SEMAFORO: Record<ValorSemaforo, { tom: TomEtiqueta; rotulo: string; faixa: string }> = {
  vencido: { tom: 'erro', rotulo: 'Vencido', faixa: 'vigência encerrada' },
  critico: { tom: 'critico', rotulo: 'Crítico', faixa: 'até 30 dias' },
  atencao: { tom: 'aviso', rotulo: 'Atenção', faixa: '31 a 60 dias' },
  alerta: { tom: 'alerta', rotulo: 'Alerta', faixa: '61 a 90 dias' },
  regular: { tom: 'sucesso', rotulo: 'Regular', faixa: 'mais de 90 dias' },
};

export function rotuloSemaforo(valor: ValorSemaforo): string {
  return SEMAFORO[valor].rotulo;
}

export interface PropsSemaforo {
  valor: ValorSemaforo;
  /** Com a data de fim, mostra "Vence em 45 dias" (classificarVigencia do domínio). */
  vigenciaFim?: string;
  compacto?: boolean;
}

/** Semáforo de vigência 30/60/90 (RN-17). */
export function Semaforo({ valor, vigenciaFim, compacto }: PropsSemaforo) {
  const def = SEMAFORO[valor];
  const detalhe = vigenciaFim ? classificarVigencia(vigenciaFim, hojeISO(new Date())).rotulo : def.faixa;
  return (
    <span className="semaforo">
      <Etiqueta tom={def.tom} titulo={`${def.rotulo}: ${def.faixa}`} compacta={compacto}>
        {def.rotulo}
      </Etiqueta>
      {compacto ? <span className="sr-only">, {detalhe}</span> : <span className="semaforo__detalhe">{detalhe}</span>}
    </span>
  );
}

const PRIORIDADE: Record<Prioridade, { tom: TomEtiqueta; rotulo: string }> = {
  alta: { tom: 'erro', rotulo: 'Alta' },
  media: { tom: 'aviso', rotulo: 'Média' },
  baixa: { tom: 'neutro', rotulo: 'Baixa' },
};

export function EtiquetaPrioridade({ valor, prefixo }: { valor: Prioridade; prefixo?: string }) {
  const def = PRIORIDADE[valor];
  return (
    <Etiqueta tom={def.tom} compacta>
      {prefixo ? `${prefixo} ${def.rotulo.toLowerCase()}` : def.rotulo}
    </Etiqueta>
  );
}

const SITUACAO_INSTRUMENTO: Record<SituacaoInstrumento, { tom: TomEtiqueta; rotulo: string }> = {
  vigente: { tom: 'sucesso', rotulo: 'Vigente' },
  a_vencer: { tom: 'aviso', rotulo: 'A vencer' },
  encerrado: { tom: 'neutro', rotulo: 'Encerrado' },
};

export function EtiquetaSituacao({ valor }: { valor: SituacaoInstrumento }) {
  const def = SITUACAO_INSTRUMENTO[valor];
  return (
    <Etiqueta tom={def.tom} compacta>
      {def.rotulo}
    </Etiqueta>
  );
}
