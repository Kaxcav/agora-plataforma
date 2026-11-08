import type { NaturezaDuracaoContrato } from '@agora/contratos';
import { CaixaSelecao, GrupoOpcoes, Selecao } from '../../../componentes';
import { NATUREZAS } from './rotulos';

/** Respostas da RN-33 (arts. 105 a 114) — o servidor decide o que a natureza do contrato exige. */
export interface TravasProrrogacao {
  vantajosidadeAtestada: boolean;
  precoCompativel: boolean;
  previsaoEdital: boolean;
  creditoOrcamentario: boolean;
  causaAtraso?: 'sem_culpa_contratado' | 'culpa_contratado';
  moraConstituida: boolean;
}

export const travasVazias: TravasProrrogacao = {
  vantajosidadeAtestada: false,
  precoCompativel: false,
  previsaoEdital: false,
  creditoOrcamentario: false,
  moraConstituida: false,
};

interface Props {
  /** Natureza já registrada no contrato (null: o primeiro registro a define). */
  naturezaContrato: NaturezaDuracaoContrato | null;
  natureza: NaturezaDuracaoContrato | '';
  aoMudarNatureza: (natureza: NaturezaDuracaoContrato | '') => void;
  travas: TravasProrrogacao;
  aoMudar: (travas: TravasProrrogacao) => void;
}

/** Campos da prorrogação conforme a natureza do contrato: contínuo, TI estruturante, receita ou escopo (RN-33). */
export function CamposTravasProrrogacao({ naturezaContrato, natureza, aoMudarNatureza, travas, aoMudar }: Props) {
  const efetiva = naturezaContrato ?? (natureza || null);
  const marcar = (campo: keyof TravasProrrogacao) => (e: { target: { checked: boolean } }) => aoMudar({ ...travas, [campo]: e.target.checked });
  const receita = efetiva === 'receita_sem_investimento' || efetiva === 'receita_com_investimento';
  return (
    <fieldset className="pilha">
      <legend>Travas da prorrogação (RN-33)</legend>
      {naturezaContrato ? (
        <p className="texto-secundario">Natureza do contrato: {NATUREZAS[naturezaContrato]}.</p>
      ) : (
        <Selecao
          rotulo="Natureza do contrato quanto à duração"
          obrigatorio
          value={natureza}
          onChange={(e) => aoMudarNatureza(e.target.value as NaturezaDuracaoContrato | '')}
          opcaoVazia="Selecione"
          opcoes={Object.entries(NATUREZAS).map(([valor, rotulo]) => ({ valor, rotulo }))}
        />
      )}
      {efetiva === 'escopo' ? (
        <>
          <GrupoOpcoes
            legenda="O objeto não foi concluído no prazo"
            nome="causa-atraso"
            opcoes={[
              { valor: 'sem_culpa_contratado', rotulo: 'Sem culpa do contratado', ajuda: 'A vigência se prorroga automaticamente (art. 111).' },
              { valor: 'culpa_contratado', rotulo: 'Por culpa do contratado', ajuda: 'Só depois de constituída a mora, com as sanções cabíveis.' },
            ]}
            valor={travas.causaAtraso ?? null}
            aoMudar={(causaAtraso) => aoMudar({ ...travas, causaAtraso })}
          />
          {travas.causaAtraso === 'culpa_contratado' ? (
            <CaixaSelecao rotulo="O contratado foi constituído em mora (art. 111, parágrafo único, I)" checked={travas.moraConstituida} onChange={marcar('moraConstituida')} />
          ) : null}
        </>
      ) : efetiva ? (
        <>
          <CaixaSelecao rotulo="O edital prevê a prorrogação (art. 107)" checked={travas.previsaoEdital} onChange={marcar('previsaoEdital')} />
          {!receita ? (
            <>
              <CaixaSelecao
                rotulo="A autoridade atestou que as condições e os preços continuam vantajosos (art. 107)"
                checked={travas.vantajosidadeAtestada}
                onChange={marcar('vantajosidadeAtestada')}
              />
              <CaixaSelecao rotulo="A pesquisa de preços confirmou que o preço continua compatível com o mercado" checked={travas.precoCompativel} onChange={marcar('precoCompativel')} />
            </>
          ) : null}
        </>
      ) : null}
      {!receita && efetiva ? (
        <CaixaSelecao rotulo="Há crédito orçamentário para o exercício (art. 105)" checked={travas.creditoOrcamentario} onChange={marcar('creditoOrcamentario')} />
      ) : null}
    </fieldset>
  );
}
