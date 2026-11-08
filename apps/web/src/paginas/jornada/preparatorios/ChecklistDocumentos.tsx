/**
 * Checklist das peças do processo por etapa (RF-32): o que já está pronto e o que falta, apurado no servidor a partir
 * da versão atual de cada documento (aprovação, assinatura no SEI, parâmetros do edital e dotação).
 */
import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, ListChecks } from 'lucide-react';
import type { ChecklistDocumentosProcesso, ProcessoDetalhe } from '@agora/contratos';
import { useChecklistDocumentos } from '../../../api/preparatorios';
import { Botao, Carregando, EsqueletoTexto, Etiqueta, FalhaConsulta } from '../../../componentes';
import { contar } from '../../../utilitarios/formatacao';
import { OBRIGATORIEDADES, SITUACOES_PECA } from './rotulos';

function TabelaEtapa({ etapa }: { etapa: ChecklistDocumentosProcesso['etapas'][number] }) {
  const id = useId();
  return (
    <div className="tabela-rolagem" role="region" aria-labelledby={id} tabIndex={0}>
      <table className="tabela tabela--compacta">
        <caption id={id} className="tabela__legenda">
          Etapa {etapa.etapa} — {etapa.titulo}: {contar(etapa.prontas, 'pronta', 'prontas')}, {etapa.faltantes === 0 ? 'nenhuma exigida pendente' : `${contar(etapa.faltantes, 'exigida pendente', 'exigidas pendentes')}`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Peça</th>
            <th scope="col">Exigência</th>
            <th scope="col">Situação</th>
            <th scope="col">Assinada no SEI</th>
            <th scope="col">Fundamento</th>
          </tr>
        </thead>
        <tbody>
          {etapa.itens.map((item) => {
            const situacao = SITUACOES_PECA[item.situacao];
            return (
              <tr key={item.tipo}>
                <th scope="row">{item.titulo}</th>
                <td>{OBRIGATORIEDADES[item.obrigatoriedade]}</td>
                <td>
                  <Etiqueta tom={item.obrigatoriedade === 'recomendada' && item.situacao === 'falta' ? 'neutro' : situacao.tom} compacta>
                    {situacao.rotulo}
                    {item.versao !== null ? ` — versão ${item.versao}` : ''}
                  </Etiqueta>
                </td>
                <td>{item.assinado === null ? '—' : item.assinado ? 'Sim' : 'Não'}</td>
                <td className="texto-pequeno">{item.fundamento}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ChecklistDocumentos({ processo }: { processo: ProcessoDetalhe }) {
  const idTitulo = useId();
  const idConteudo = useId();
  const [aberto, definirAberto] = useState(false);
  const consulta = useChecklistDocumentos(processo.id, processo.atualizadoEm);
  const checklist = consulta.data;
  return (
    <section className="secao jornada-subsecao" aria-labelledby={idTitulo}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={idTitulo} className="secao__titulo">
            Checklist de documentos do processo
          </h3>
          <p className="secao__descricao" aria-live="polite">
            {checklist
              ? `${contar(checklist.prontas, 'peça pronta', 'peças prontas')}; ${checklist.faltantes === 0 ? 'nenhuma peça exigida pendente' : contar(checklist.faltantes, 'peça exigida pendente', 'peças exigidas pendentes')}; ${contar(checklist.recomendadasPendentes, 'recomendada pendente', 'recomendadas pendentes')}.`
              : 'O que já existe e o que falta, por etapa.'}
          </p>
        </div>
        <Botao
          variante="secundario"
          tamanho="compacto"
          icone={aberto ? ChevronUp : ListChecks}
          iconeFim={aberto ? undefined : ChevronDown}
          aria-expanded={aberto}
          aria-controls={idConteudo}
          onClick={() => definirAberto((a) => !a)}
        >
          {aberto ? 'Ocultar checklist' : 'Ver checklist'}
        </Botao>
      </div>
      <div id={idConteudo} hidden={!aberto} className="pilha">
        {!aberto ? null : consulta.isPending ? (
          <Carregando rotulo="Carregando o checklist">
            <EsqueletoTexto linhas={4} />
          </Carregando>
        ) : consulta.isError || !checklist ? (
          <FalhaConsulta consulta={consulta} titulo="Não foi possível carregar o checklist" />
        ) : (
          <>
            {checklist.etapas.map((etapa) => (
              <TabelaEtapa key={etapa.etapa} etapa={etapa} />
            ))}
            <p className="texto-pequeno texto-secundario">
              Peça pronta é a versão atual aprovada e válida; desatualizada é a gerada com parâmetros do edital ou dotação diferentes dos atuais.
              A situação é apurada automaticamente; a conferência é do servidor responsável. Para guardar uma cópia nos autos, gere o documento
              &ldquo;Checklist de documentos do processo&rdquo; nas peças complementares.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
