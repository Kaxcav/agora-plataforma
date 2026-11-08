/**
 * Peças compartilhadas pelas telas da Jornada: erro com regras bloqueantes, prévia de requisitos,
 * entrada monetária compacta (tabelas editáveis), progresso compacto e avisos de somente consulta.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleDashed, Eye, Lock } from 'lucide-react';
import type { EtapaJornada } from '@agora/contratos';
import { paraCentavos, type Centavos } from '@agora/dominio';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { regrasBloqueantes, type RegraBloqueante } from '../../api/jornada';
import { Alerta } from '../../componentes';
import { NUMEROS_ETAPAS, TOTAL_ETAPAS, tituloEtapa } from './rotulos';

/** Identificador para linhas novas (cotações, riscos, licitantes); o servidor valida e persiste. */
export function novoId(): string {
  return crypto.randomUUID();
}

/** Texto aparado ou `null` quando vazio. */
export function textoOuNulo(valor: string): string | null {
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
}

export type Calculo<T> = { ok: true; valor: T } | { ok: false; mensagem: string };

/** Executa uma regra do domínio que valida a entrada (lança `ErroDominio`) e devolve o resultado ou a mensagem. */
export function calcular<T>(regra: () => T): Calculo<T> {
  try {
    return { ok: true, valor: regra() };
  } catch (erro) {
    return { ok: false, mensagem: erro instanceof Error ? erro.message : 'Não foi possível calcular com os dados informados.' };
  }
}

export function ListaRegras({ regras }: { regras: readonly RegraBloqueante[] }) {
  return (
    <ul className="jornada-regras">
      {regras.map((r, i) => (
        <li key={`${r.regra ?? 'regra'}-${i}`} className="jornada-regras__item">
          {r.regra ? <span className="jornada-regra-id">{r.regra}</span> : null}{' '}
          <span>{r.mensagem}</span>
        </li>
      ))}
    </ul>
  );
}

/** Erro de uma operação: 422 vira a lista de regras que bloqueiam; demais erros mostram mensagem e código de suporte. */
export function ErroOperacao({ erro, titulo = 'A operação não foi concluída' }: { erro: unknown; titulo?: string }) {
  if (!erro) return null;
  const regras = regrasBloqueantes(erro);
  const idRequisicao = erro instanceof ErroApi ? erro.idRequisicao : null;
  return (
    <Alerta tipo="erro" anunciar titulo={titulo}>
      <p>{mensagemDeErro(erro)}</p>
      {regras && regras.length > 0 ? (
        <ListaRegras regras={regras} />
      ) : erro instanceof ErroApi && erro.detalhes.length > 0 ? (
        <ul>
          {erro.detalhes.map((d, i) => (
            <li key={i}>{d.mensagem}</li>
          ))}
        </ul>
      ) : null}
      {idRequisicao ? (
        <p className="texto-pequeno">
          Código para o suporte: <code className="selecionavel">{idRequisicao}</code>
        </p>
      ) : null}
    </Alerta>
  );
}

export interface Requisito {
  id: string;
  rotulo: ReactNode;
  atendido: boolean;
  detalhe?: ReactNode;
}

/**
 * Prévia, no navegador, das condições para avançar a etapa (mesmas regras do domínio).
 * O servidor continua sendo quem decide no "Avançar etapa".
 */
export function Requisitos({ titulo, itens }: { titulo: string; itens: readonly Requisito[] }) {
  const idTitulo = useId();
  const pendentes = itens.filter((i) => !i.atendido).length;
  return (
    <section className="jornada-requisitos" aria-labelledby={idTitulo}>
      <div className="linha linha--entre">
        <h3 id={idTitulo} className="jornada-requisitos__titulo">
          {titulo}
        </h3>
        <p className="texto-pequeno texto-secundario" aria-live="polite" aria-atomic="true">
          {pendentes === 0 ? 'Todas as condições atendidas nesta prévia' : `${pendentes} de ${itens.length} condições pendentes`}
        </p>
      </div>
      <ul className="jornada-requisitos__lista">
        {itens.map((item) => (
          <li key={item.id} className={`jornada-requisitos__item${item.atendido ? ' jornada-requisitos__item--ok' : ''}`}>
            {item.atendido ? <CircleCheck size={16} aria-hidden="true" /> : <CircleDashed size={16} aria-hidden="true" />}
            <span>
              <span className="sr-only">{item.atendido ? 'Atendido: ' : 'Pendente: '}</span>
              {item.rotulo}
              {item.detalhe ? <span className="jornada-requisitos__detalhe">{item.detalhe}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="texto-pequeno texto-secundario">
        Prévia calculada neste navegador com as regras do domínio. A verificação que vale é a do servidor, ao avançar a etapa.
      </p>
    </section>
  );
}

export type MotivoSomenteConsulta = 'concluida' | 'futura' | 'sem_permissao' | 'encerrado';

const TEXTOS_CONSULTA: Record<MotivoSomenteConsulta, { titulo: string; texto: string }> = {
  concluida: {
    titulo: 'Etapa concluída — somente consulta',
    texto: 'Os registros desta etapa ficam disponíveis para consulta. A edição é feita apenas na etapa atual do processo.',
  },
  futura: {
    titulo: 'Etapa ainda não iniciada',
    texto: 'Os campos ficam disponíveis quando o processo chegar a esta etapa, depois de resolvidos os bloqueios das etapas anteriores.',
  },
  sem_permissao: {
    titulo: 'Consulta somente leitura',
    texto: 'Seu perfil permite consultar este processo, mas não alterar os registros desta etapa.',
  },
  encerrado: {
    titulo: 'Processo concluído',
    texto: 'O contrato já foi gerado. Os registros da jornada ficam disponíveis para consulta e auditoria.',
  },
};

export function AvisoSomenteConsulta({ motivo }: { motivo: MotivoSomenteConsulta }) {
  const def = TEXTOS_CONSULTA[motivo];
  return (
    <div className="jornada-consulta" role="note">
      {motivo === 'sem_permissao' ? <Lock size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      <p>
        <strong>{def.titulo}.</strong> {def.texto}
      </p>
    </div>
  );
}

/** "3/7" com trilho de 7 segmentos; o leitor de tela ouve "Etapa 3 de 7: …". */
export function MiniProgresso({ etapa }: { etapa: EtapaJornada }) {
  return (
    <span className="jornada-mini">
      <span className="jornada-mini__linha" aria-hidden="true">
        <span className="jornada-mini__trilho">
          {NUMEROS_ETAPAS.map((n) => (
            <span
              key={n}
              className={['jornada-mini__segmento', n < etapa ? 'jornada-mini__segmento--feito' : '', n === etapa ? 'jornada-mini__segmento--atual' : '']
                .filter(Boolean)
                .join(' ')}
            />
          ))}
        </span>
        <span className="numero texto-forte">
          {etapa}/{TOTAL_ETAPAS}
        </span>
      </span>
      <span className="jornada-mini__titulo" aria-hidden="true">
        {tituloEtapa(etapa)}
      </span>
      <span className="sr-only">
        Etapa {etapa} de {TOTAL_ETAPAS}: {tituloEtapa(etapa)}
      </span>
    </span>
  );
}

const formatoDecimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function textoDeCentavos(valor: Centavos | null): string {
  return valor === null ? '' : formatoDecimal.format(valor / 100);
}

export interface PropsEntradaMoeda {
  valor: Centavos | null;
  aoMudar: (valor: Centavos | null) => void;
  /** Nome acessível (a célula da tabela não tem rótulo visível). */
  rotulo: string;
  desabilitado?: boolean;
  /** Para receber o foco programaticamente (ex.: linha recém-incluída). */
  id?: string;
}

/** Entrada monetária compacta para tabelas editáveis; confirma ao sair do campo ou com Enter. */
export function EntradaMoeda({ valor, aoMudar, rotulo, desabilitado, id }: PropsEntradaMoeda) {
  const idErro = useId();
  const [texto, definirTexto] = useState(() => textoDeCentavos(valor));
  const [invalido, definirInvalido] = useState(false);
  const ultimo = useRef(valor);

  useEffect(() => {
    if (valor !== ultimo.current) {
      ultimo.current = valor;
      definirTexto(textoDeCentavos(valor));
    }
  }, [valor]);

  const confirmar = () => {
    const limpo = texto.trim();
    if (limpo === '') {
      definirInvalido(false);
      ultimo.current = null;
      aoMudar(null);
      return;
    }
    try {
      const centavos = paraCentavos(limpo);
      definirInvalido(false);
      ultimo.current = centavos;
      definirTexto(textoDeCentavos(centavos));
      aoMudar(centavos);
    } catch {
      definirInvalido(true);
    }
  };

  return (
    <span className="jornada-moeda">
      <span className="jornada-moeda__grupo">
        <span className="jornada-moeda__prefixo" aria-hidden="true">
          R$
        </span>
        <input
          id={id}
          className="campo__controle campo__controle--moeda numero"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          aria-label={rotulo}
          aria-invalid={invalido || undefined}
          aria-describedby={invalido ? idErro : undefined}
          value={texto}
          disabled={desabilitado}
          onChange={(e) => definirTexto(e.target.value)}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              confirmar();
            }
          }}
        />
      </span>
      {invalido ? (
        <span id={idErro} className="campo__erro">
          Informe reais, ex.: 1.234,56
        </span>
      ) : null}
    </span>
  );
}

/** Igualdade estrutural simples para detectar alterações não salvas em formulários. */
export function mesmoConteudo(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
