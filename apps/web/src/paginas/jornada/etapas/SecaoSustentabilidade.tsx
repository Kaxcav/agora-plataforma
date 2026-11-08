/**
 * Critérios de sustentabilidade ambiental e logística reversa do ETP e do TR (RN-21). Com a política do órgão
 * ligada, o servidor não conclui o ETP (etapa 3) nem o TR (etapa 4) sem os dois critérios preenchidos.
 */
import { useId, useState, type FormEvent } from 'react';
import { Leaf, RotateCcw, Save } from 'lucide-react';
import { useSalvarSustentabilidade } from '../../../api/selecao';
import { AreaTexto, Botao, Etiqueta, ListaDefinicoes, useAvisos } from '../../../componentes';
import { ErroOperacao, mesmoConteudo, textoOuNulo } from '../comum';
import { MINIMO_TEXTO, textoSuficiente, type PropsEtapa } from './tipos';

interface PropsSecaoSustentabilidade extends PropsEtapa {
  /** Documento que a etapa conclui: ETP (etapa 3) ou TR (etapa 4). */
  documento: 'etp' | 'tr';
}

const NOMES = { etp: 'Estudo Técnico Preliminar', tr: 'termo de referência' } as const;

/** Critérios preenchidos com o mínimo exigido pela RN-21 (prévia; o servidor decide). */
export function sustentabilidadeCompleta(criterios: { criteriosAmbientais: string | null; logisticaReversa: string | null }): boolean {
  return textoSuficiente(criterios.criteriosAmbientais) && textoSuficiente(criterios.logisticaReversa);
}

export function SecaoSustentabilidade({ processo, editavel, documento }: PropsSecaoSustentabilidade) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarSustentabilidade(processo.id);
  const salvo = { criteriosAmbientais: processo.sustentabilidade.criteriosAmbientais, logisticaReversa: processo.sustentabilidade.logisticaReversa };
  const [criterios, definirCriterios] = useState(salvo);
  const obrigatoria = processo.sustentabilidade.politicaObrigatoria;
  const alterado = !mesmoConteudo(
    { criteriosAmbientais: textoOuNulo(criterios.criteriosAmbientais ?? ''), logisticaReversa: textoOuNulo(criterios.logisticaReversa ?? '') },
    { criteriosAmbientais: salvo.criteriosAmbientais, logisticaReversa: salvo.logisticaReversa },
  );
  const completa = sustentabilidadeCompleta(salvo);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvar.mutate(
      { criteriosAmbientais: textoOuNulo(criterios.criteriosAmbientais ?? ''), logisticaReversa: textoOuNulo(criterios.logisticaReversa ?? '') },
      {
        onSuccess: (atualizado) => {
          definirCriterios({ criteriosAmbientais: atualizado.sustentabilidade.criteriosAmbientais, logisticaReversa: atualizado.sustentabilidade.logisticaReversa });
          avisar({
            tipo: sustentabilidadeCompleta(atualizado.sustentabilidade) || !obrigatoria ? 'sucesso' : 'aviso',
            titulo: 'Critérios de sustentabilidade salvos',
            mensagem:
              sustentabilidadeCompleta(atualizado.sustentabilidade) || !obrigatoria
                ? `Os critérios entram no ${NOMES[documento]} na próxima geração do documento.`
                : 'Ainda faltam critérios exigidos pela política do órgão (RN-21).',
          });
        },
      },
    );
  };

  const etiqueta = (
    <Etiqueta tom={completa ? 'sucesso' : obrigatoria ? 'erro' : 'neutro'} icone={Leaf}>
      {completa ? 'Critérios preenchidos (RN-21)' : obrigatoria ? 'Obrigatórios pela política do órgão (RN-21)' : 'Recomendados (política desligada)'}
    </Etiqueta>
  );

  if (!editavel) {
    return (
      <section className="secao jornada-subsecao" id={`etapa-sustentabilidade-${documento}`} aria-labelledby={`${base}-titulo`}>
        <div className="secao__cabecalho">
          <h3 id={`${base}-titulo`} className="secao__titulo">
            Sustentabilidade ambiental e logística reversa
          </h3>
          {etiqueta}
        </div>
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Critérios de sustentabilidade ambiental', valor: salvo.criteriosAmbientais ?? 'Não informados', largo: true },
            { termo: 'Logística reversa', valor: salvo.logisticaReversa ?? 'Não informada', largo: true },
          ]}
        />
      </section>
    );
  }

  return (
    <form className="secao jornada-subsecao" id={`etapa-sustentabilidade-${documento}`} onSubmit={enviar} noValidate aria-labelledby={`${base}-titulo`}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={`${base}-titulo`} className="secao__titulo">
            Sustentabilidade ambiental e logística reversa
          </h3>
          <p className="secao__descricao">
            {obrigatoria
              ? `A política do órgão está ligada: o ${NOMES[documento]} só se conclui com os dois critérios (art. 5º, art. 11, IV, e art. 18, § 1º, XII).`
              : `A política do órgão está desligada: os critérios são recomendados e entram no ${NOMES[documento]} quando preenchidos.`}
          </p>
        </div>
        {etiqueta}
      </div>
      <AreaTexto
        rotulo="Critérios de sustentabilidade ambiental"
        obrigatorio={obrigatoria}
        rows={3}
        maxLength={20_000}
        ajuda={`Exigências do objeto e da execução: eficiência energética, materiais, embalagens, emissões. Mínimo de ${MINIMO_TEXTO} caracteres.`}
        value={criterios.criteriosAmbientais ?? ''}
        onChange={(e) => definirCriterios((c) => ({ ...c, criteriosAmbientais: e.target.value }))}
      />
      <AreaTexto
        rotulo="Logística reversa (desfazimento e reciclagem de bens e refugos)"
        obrigatorio={obrigatoria}
        rows={3}
        maxLength={20_000}
        ajuda={`Quem recolhe, recicla e dá destinação final aos bens substituídos e aos resíduos. Mínimo de ${MINIMO_TEXTO} caracteres.`}
        value={criterios.logisticaReversa ?? ''}
        onChange={(e) => definirCriterios((c) => ({ ...c, logisticaReversa: e.target.value }))}
      />
      <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar os critérios de sustentabilidade" />
      <div className="jornada-barra-acoes">
        <p className="texto-pequeno texto-secundario" aria-live="polite">
          {alterado ? 'Há alterações não salvas.' : 'Sem alterações pendentes.'}
        </p>
        <div className="linha">
          <Botao
            variante="terciario"
            icone={RotateCcw}
            disabled={!alterado || salvar.isPending}
            onClick={() => {
              definirCriterios(salvo);
              salvar.reset();
            }}
          >
            Descartar alterações
          </Botao>
          <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending} disabled={!alterado}>
            Salvar critérios
          </Botao>
        </div>
      </div>
    </form>
  );
}
