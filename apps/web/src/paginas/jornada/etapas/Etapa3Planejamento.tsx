/**
 * Etapa 3 — ETP, riscos e preços: ETP (RN-04), matriz de riscos (art. 22), cesta de preços (RN-05, RIA-03,
 * art. 24) e os documentos da fase de planejamento.
 */
import { validarEtp } from '@agora/dominio';
import { DocumentosEtapa } from '../Documentos';
import { Requisitos, type Requisito } from '../comum';
import { analiseDaCesta, SecaoCesta } from './SecaoCesta';
import { SecaoEtp } from './SecaoEtp';
import { SecaoPesquisaPrecos } from './SecaoPesquisaPrecos';
import { SecaoRiscos } from './SecaoRiscos';
import { SecaoSustentabilidade, sustentabilidadeCompleta } from './SecaoSustentabilidade';
import { textoSuficiente, type PropsEtapa } from './tipos';

const ALERTAS_IMPEDITIVOS = ['FORNECEDOR_DIRETO_INSUFICIENTE', 'SEM_JUSTIFICATIVA_FORNECEDOR'];

export default function Etapa3Planejamento(props: PropsEtapa) {
  const { processo, editavel } = props;
  const cesta = processo.cestaPrecos;
  const analise = analiseDaCesta(cesta);
  const validas = cesta.cotacoes.filter((c) => !c.expurgada).length;
  const impeditivos = (analise?.analise.alertas ?? []).filter((a) => ALERTAS_IMPEDITIVOS.includes(a.codigo));

  const requisitos: Requisito[] = [
    { id: 'etp', rotulo: 'ETP completo, com os incisos obrigatórios e as ausências justificadas (RN-04)', atendido: validarEtp(processo.etp).completo },
    { id: 'riscos', rotulo: 'Ao menos um risco na matriz (art. 22)', atendido: processo.riscos.length > 0 },
    {
      id: 'cesta',
      rotulo: 'Cesta analisada com pelo menos 3 preços válidos após os expurgos (art. 23)',
      atendido: analise?.origem === 'servidor' && validas >= 3,
      detalhe: ` — ${validas} válido${validas === 1 ? '' : 's'}`,
    },
    {
      id: 'fornecedor',
      rotulo: 'Pesquisa direta com ao menos 3 fornecedores e escolha justificada (RN-05, art. 23, § 1º, IV)',
      atendido: impeditivos.length === 0,
    },
    {
      id: 'sigilo',
      rotulo: 'Orçamento sigiloso com motivo registrado (art. 24)',
      atendido: !cesta.orcamentoSigiloso || textoSuficiente(cesta.motivoSigilo),
      detalhe: cesta.orcamentoSigiloso ? undefined : ' — orçamento público',
    },
    {
      id: 'sustentabilidade',
      rotulo: 'Critérios de sustentabilidade ambiental e logística reversa preenchidos (RN-21)',
      atendido: !processo.sustentabilidade.politicaObrigatoria || sustentabilidadeCompleta(processo.sustentabilidade),
      detalhe: processo.sustentabilidade.politicaObrigatoria ? undefined : ' — política do órgão desligada',
    },
  ];

  return (
    <div className="pilha pilha--ampla">
      <nav className="jornada-sumario" aria-label="Seções da etapa 3">
        <a href="#etapa3-etp">ETP</a>
        <a href="#etapa-sustentabilidade-etp">Sustentabilidade</a>
        <a href="#etapa3-riscos">Matriz de riscos</a>
        <a href="#etapa3-cesta">Cesta de preços</a>
        <a href="#etapa3-pesquisa">Consulta automática de preços</a>
        <a href="#etapa3-projecao">Projeção do valor</a>
        <a href="#etapa3-documentos">Documentos</a>
      </nav>
      <SecaoEtp {...props} />
      <SecaoSustentabilidade {...props} documento="etp" />
      <SecaoRiscos {...props} />
      <SecaoCesta {...props} />
      <SecaoPesquisaPrecos {...props} />
      {editavel ? <Requisitos titulo="Condições para avançar à etapa 4 (com os dados salvos)" itens={requisitos} /> : null}
      <div id="etapa3-documentos">
        <DocumentosEtapa
          processo={processo}
          tipos={['etp', 'matriz_riscos', 'nota_tecnica_precos']}
          editavel={editavel}
          titulo="Documentos do planejamento"
          descricao="Gerados a partir do ETP, da matriz de riscos e da cesta salvos. Revise e aprove para incluí-los na árvore do processo SEI."
        />
      </div>
    </div>
  );
}
