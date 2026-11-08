/**
 * Conferência das citações de um documento gerado (RIA-14), exibida ao lado do texto na visualização do documento.
 * Aponta citação inexistente, vetada ou com assunto que não confere; com citação inexistente ou vetada, a aprovação
 * só é liberada pelo servidor depois da revisão humana registrada aqui.
 */
import { useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { DocumentoGerado } from '@agora/contratos';
import { useCitacoesProcesso, useRevisarCitacoes } from '../../api/iaAncorada';
import { Alerta, AreaTexto, Botao, ConfirmarAcao, Etiqueta, useAvisos } from '../../componentes';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { ListaCitacoesApontadas } from './comum';

const MINIMO_JUSTIFICATIVA = 30;

export function ConferenciaCitacoesDocumento({ processoId, documento, podeRevisar }: { processoId: string; documento: DocumentoGerado; podeRevisar: boolean }) {
  const { avisar } = useAvisos();
  const consulta = useCitacoesProcesso(processoId, `${documento.id}:${documento.situacao}`);
  const revisar = useRevisarCitacoes(processoId);
  const [aberto, definirAberto] = useState(false);
  const [justificativa, definirJustificativa] = useState('');

  const dados = consulta.data?.find((c) => c.documentoId === documento.id);
  if (consulta.isError) {
    return <p className="texto-pequeno texto-secundario">Não foi possível conferir as citações agora.</p>;
  }
  if (!dados) return <p className="texto-pequeno texto-secundario">Conferindo as citações…</p>;

  const { conferencia, estrutura, revisao } = dados;
  const apontadas = conferencia.citacoes.filter((c) => c.situacao !== 'confere' && c.situacao !== 'outra_norma');
  const fechar = () => {
    definirAberto(false);
    definirJustificativa('');
    revisar.reset();
  };

  return (
    <section className="conferencia-citacoes" aria-label="Conferência das citações legais">
      <h5 className="jornada-apoio__titulo">Citações legais (conferência com a lei)</h5>
      <p className="linha texto-pequeno">
        {conferencia.fiel ? (
          <Etiqueta tom="sucesso" compacta>
            Citações fiéis
          </Etiqueta>
        ) : (
          <Etiqueta tom={conferencia.bloqueantes > 0 ? 'erro' : 'aviso'} compacta>
            {contar(apontadas.length, 'citação apontada', 'citações apontadas')}
          </Etiqueta>
        )}
        <span className="texto-secundario">
          {contar(conferencia.total, 'citação encontrada', 'citações encontradas')}
          {conferencia.outrasNormas > 0 ? `, ${conferencia.outrasNormas} de outras normas` : ''}
        </span>
      </p>
      {apontadas.length > 0 ? <ListaCitacoesApontadas citacoes={apontadas} /> : null}
      {dados.aprovacaoBloqueada ? (
        <Alerta tipo="aviso" compacto titulo="Aprovação bloqueada até a revisão das citações (RIA-14)">
          <p>Há citação inexistente ou vetada. Confira cada uma, corrija o texto na próxima versão ou registre a revisão com a justificativa.</p>
        </Alerta>
      ) : null}
      {revisao ? (
        <p className="texto-pequeno">
          Revisão das citações registrada por {revisao.revisadoPor.nome} em {formatarInstante(revisao.revisadoEm)}: “{revisao.justificativa}”
        </p>
      ) : null}
      {podeRevisar && apontadas.length > 0 && revisao === null && documento.situacao !== 'aprovado' ? (
        <Botao tamanho="compacto" icone={ClipboardCheck} onClick={() => definirAberto(true)}>
          Registrar revisão das citações
        </Botao>
      ) : null}
      {estrutura.aplicavel ? (
        <p className="texto-pequeno">
          Estrutura do modelo padronizado ({estrutura.fundamento}): {estrutura.presentes} de {estrutura.total} seções obrigatórias
          {estrutura.ausentes.length > 0 ? ` — faltam: ${estrutura.ausentes.map((a) => `${a.titulo} (${a.fundamento})`).join('; ')}` : ''}.
        </p>
      ) : null}
      <p className="texto-pequeno texto-secundario">{conferencia.aviso}</p>

      <ConfirmarAcao
        aberto={aberto}
        aoFechar={fechar}
        titulo="Registrar revisão das citações"
        largura="media"
        descricao={
          <p>
            Registra que você conferiu as {contar(apontadas.length, 'citação apontada', 'citações apontadas')} da versão {documento.versao}. O registro fica na trilha
            de auditoria e libera a aprovação, que continua sendo ato separado.
          </p>
        }
        rotuloConfirmar="Registrar revisão"
        confirmarDesabilitado={justificativa.trim().length < MINIMO_JUSTIFICATIVA}
        processando={revisar.isPending}
        erro={revisar.error}
        aoConfirmar={() =>
          revisar.mutate(
            { documentoId: documento.id, justificativa: justificativa.trim() },
            {
              onSuccess: () => {
                avisar({ tipo: 'sucesso', titulo: 'Revisão registrada', mensagem: 'A revisão das citações ficou na trilha de auditoria.' });
                fechar();
              },
            },
          )
        }
      >
        <AreaTexto
          rotulo="Justificativa da revisão"
          ajuda={`Diga o que foi conferido e o que será feito (mínimo de ${MINIMO_JUSTIFICATIVA} caracteres).`}
          obrigatorio
          value={justificativa}
          maxLength={2000}
          contador
          onChange={(e) => definirJustificativa(e.target.value)}
        />
      </ConfirmarAcao>
    </section>
  );
}
