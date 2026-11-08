/**
 * Peças complementares da fase preparatória (frente P — RF-32 e RN-39), abaixo do painel de cada etapa: a dotação
 * orçamentária (etapas 3 e 4), as peças cuja janela inclui a etapa exibida — no mesmo painel de documentos da jornada,
 * com versões, aprovação, árvore do SEI e PDF — e o checklist de documentos do processo.
 * Portaria, declaração orçamentária e despacho são aprovados pela autoridade competente designada (o servidor confere).
 */
import type { EtapaJornada, ProcessoDetalhe } from '@agora/contratos';
import { useSessao } from '../../../sessao/ContextoSessao';
import { DocumentosEtapa } from '../Documentos';
import { ChecklistDocumentos } from './ChecklistDocumentos';
import { documentoDaAutoridade, pecasDaEtapa } from './rotulos';
import { SecaoDotacao } from './SecaoDotacao';

export interface PropsPecasComplementares {
  processo: ProcessoDetalhe;
  etapa: EtapaJornada;
  /** A etapa exibida é a atual (processo sem contrato). */
  atual: boolean;
  /** Perfil com `jornada:editar`. */
  podeEditar: boolean;
}

export default function PecasComplementares({ processo, etapa, atual, podeEditar }: PropsPecasComplementares) {
  const { temPermissao, usuario } = useSessao();
  const editavel = atual && podeEditar;
  const autoridade = atual && temPermissao('jornada:autorizar') && processo.equipe.some((e) => e.papel === 'autoridade_competente' && e.usuario.id === usuario?.id);
  const tipos = pecasDaEtapa(etapa);
  return (
    <div className="pilha pilha--ampla">
      {etapa === 3 || etapa === 4 ? <SecaoDotacao processo={processo} editavel={editavel} /> : null}
      {tipos.length > 0 ? (
        <DocumentosEtapa
          processo={processo}
          tipos={tipos}
          editavel={editavel}
          podeAprovar={(tipo) => (documentoDaAutoridade(tipo) ? autoridade : editavel)}
          titulo="Peças complementares da instrução"
          descricao={
            <>
              <p>
                Modelos de texto preenchidos com os dados do processo, sem IA nos atos da autoridade. A portaria de designação, a declaração de
                adequação orçamentária e o despacho de autorização são aprovados e assinados pela autoridade competente designada; as demais
                peças, pela equipe do processo.
              </p>
              {autoridade && !editavel ? (
                <p>Como autoridade competente designada, abra a peça em &ldquo;Visualizar&rdquo; para revisar e aprovar.</p>
              ) : null}
            </>
          }
        />
      ) : null}
      <ChecklistDocumentos processo={processo} />
    </div>
  );
}
