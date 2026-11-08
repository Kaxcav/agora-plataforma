/**
 * Painel "Lições aprendidas de contratos anteriores" (RIA-12) no DFD, no ETP e no TR: sugestões de cláusula mais
 * rigorosa a partir do histórico de execução de contratos de objeto semelhante, com as fontes, as premissas e a marca
 * "requer revisão humana". O agente considera ou não cada sugestão; o servidor registra a decisão na trilha e só as
 * aceitas entram no rascunho do documento.
 */
import { useId, useState } from 'react';
import { Check, History, Lightbulb, X } from 'lucide-react';
import { Link } from 'react-router';
import type { DocumentoLicao, SugestaoLicaoAprendida } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import { useDecidirLicao, useLicoesAprendidas } from '../../api/licoes';
import { Alerta, AreaTexto, Botao, Etiqueta, useAvisos } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import type { PropsEtapa } from '../jornada/etapas/tipos';

const NOME_DOCUMENTO: Record<DocumentoLicao, string> = { dfd: 'DFD', etp: 'ETP', tr: 'TR' };
const NOME_FATO: Record<string, string> = {
  ocorrencia: 'Ocorrência',
  glosa: 'Glosa',
  atraso: 'Atraso',
  rescisao: 'Rescisão',
  aditivo: 'Aditivo',
  sancao: 'Sanção',
  avaliacao: 'Avaliação de desempenho',
};

function Sugestao({ sugestao, processoId, editavel }: { sugestao: SugestaoLicaoAprendida; processoId: string; editavel: boolean }) {
  const base = useId();
  const { avisar } = useAvisos();
  const decidir = useDecidirLicao(processoId);
  const [recusando, definirRecusando] = useState(false);
  const [motivo, definirMotivo] = useState('');
  const [tentou, definirTentou] = useState(false);
  const decisao = sugestao.decisao;
  const nomeDoc = NOME_DOCUMENTO[sugestao.documento];
  const erroMotivo = motivo.trim().length < 10 ? 'Explique em ao menos 10 caracteres por que a sugestão não será considerada.' : null;

  const enviar = (escolha: 'aceita' | 'recusada') => {
    if (escolha === 'recusada') {
      definirTentou(true);
      if (erroMotivo) return;
    }
    decidir.mutate(
      { documento: sugestao.documento, chave: sugestao.chave, decisao: escolha, motivo: escolha === 'recusada' ? motivo.trim() : null },
      {
        onSuccess: () => {
          avisar({
            tipo: 'sucesso',
            titulo: escolha === 'aceita' ? 'Lição considerada' : 'Lição não considerada',
            mensagem: escolha === 'aceita' ? `A cláusula entra no próximo rascunho do ${nomeDoc}, com a fonte.` : 'A decisão e o motivo ficaram registrados na trilha.',
          });
          definirRecusando(false);
          definirTentou(false);
        },
      },
    );
  };

  return (
    <article className="pilha pilha--compacta jornada-referencia" aria-labelledby={`${base}-titulo`}>
      <p className="linha">
        <Etiqueta tom="aviso" compacta icone={Lightbulb}>
          {sugestao.rotuloCategoria}
        </Etiqueta>
        <Etiqueta tom="neutro" compacta>
          {sugestao.regra} · sinal, requer revisão humana
        </Etiqueta>
        {decisao ? (
          <Etiqueta tom={decisao.decisao === 'aceita' ? 'sucesso' : 'neutro'} compacta>
            {decisao.decisao === 'aceita' ? `Considerada no ${nomeDoc}` : 'Não considerada'}
          </Etiqueta>
        ) : null}
      </p>
      <h4 id={`${base}-titulo`} className="jornada-requisitos__titulo">
        {sugestao.titulo}
      </h4>
      <p>{sugestao.clausula}</p>
      <p className="texto-pequeno texto-secundario">Fundamento: {sugestao.fundamento}</p>
      <details>
        <summary>
          Fontes: {sugestao.ocorrencias} fato(s) em {sugestao.fontes.length} contrato(s) semelhante(s)
        </summary>
        <ul className="pilha pilha--compacta">
          {sugestao.fontes.map((f) => (
            <li key={f.contratoId}>
              <Link to={`/contratos/${f.contratoId}`}>Contrato {f.numero}</Link> — {f.objeto}{' '}
              <span className="texto-pequeno texto-secundario">({f.motivo})</span>
              <ul>
                {f.fatos.map((fato, i) => (
                  <li key={`${fato.data}-${i}`} className="texto-pequeno">
                    {NOME_FATO[fato.tipo] ?? fato.tipo} em <span className="numero">{formatarData(fato.data)}</span>: {fato.descricao}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="texto-pequeno texto-secundario">Premissas: {sugestao.premissas.join(' ')}</p>
      </details>
      <p className="texto-pequeno texto-secundario">{sugestao.aviso}</p>
      {decisao ? (
        <p className="texto-pequeno">
          {decisao.decisao === 'aceita' ? 'Considerada' : 'Não considerada'} por {decisao.por?.nome ?? 'agente responsável'} em {formatarInstante(decisao.em)}
          {decisao.motivo ? ` — motivo: ${decisao.motivo}` : ''}.
        </p>
      ) : null}
      {editavel ? (
        <div className="pilha pilha--compacta">
          {recusando ? (
            <AreaTexto
              rotulo={`Motivo para não considerar — ${sugestao.titulo}`}
              obrigatorio
              rows={2}
              maxLength={2000}
              value={motivo}
              erro={tentou ? erroMotivo : null}
              onChange={(e) => definirMotivo(e.target.value)}
            />
          ) : null}
          <div className="linha">
            {decisao?.decisao !== 'aceita' && !recusando ? (
              <Botao tamanho="compacto" variante="primario" icone={Check} carregando={decidir.isPending} onClick={() => enviar('aceita')}>
                Considerar no {nomeDoc}
              </Botao>
            ) : null}
            {decisao?.decisao !== 'recusada' && !recusando ? (
              <Botao tamanho="compacto" variante="secundario" icone={X} onClick={() => definirRecusando(true)} disabled={decidir.isPending}>
                Não considerar
              </Botao>
            ) : null}
            {recusando ? (
              <>
                <Botao tamanho="compacto" variante="primario" carregando={decidir.isPending} onClick={() => enviar('recusada')}>
                  Registrar que não será considerada
                </Botao>
                <Botao tamanho="compacto" variante="terciario" onClick={() => definirRecusando(false)}>
                  Cancelar
                </Botao>
              </>
            ) : null}
          </div>
          <ErroOperacao erro={decidir.error} titulo="A decisão não foi registrada" />
        </div>
      ) : null}
    </article>
  );
}

/** Painel de lições aprendidas da etapa (DFD na etapa 1, ETP na 3 e TR na 4). */
export function LicoesAprendidas({ processo, editavel, documento }: PropsEtapa & { documento: DocumentoLicao }) {
  const base = useId();
  const assinatura = JSON.stringify([processo.titulo, processo.dfd.itens.map((i) => [i.catmat, i.descricao])]);
  const consulta = useLicoesAprendidas(processo.id, documento, assinatura);
  const dados = consulta.data;
  const nomeDoc = NOME_DOCUMENTO[documento];

  return (
    <section className="pilha" aria-labelledby={`${base}-titulo`} id={`licoes-${documento}`}>
      <h3 id={`${base}-titulo`} className="secao__titulo">
        <History size={18} aria-hidden="true" /> Lições aprendidas de contratos anteriores (RIA-12)
      </h3>
      <p className="texto-pequeno texto-secundario">
        A Ágora compara o objeto deste processo com o dos contratos do órgão (código do catálogo ou termos em comum) e aponta o que deu errado na
        execução: atrasos, falhas de qualidade, glosas, rescisões, aditivos, sanções e avaliações baixas. É um sinal para análise: só entra no
        rascunho do {nomeDoc} o que você decidir considerar.
      </p>
      {consulta.isPending ? (
        <p className="texto-secundario" role="status">
          Consultando a base de conhecimento…
        </p>
      ) : consulta.isError ? (
        <Alerta tipo="aviso" compacto titulo="Não foi possível consultar as lições aprendidas">
          <p>Tente novamente em instantes. O preenchimento do documento não depende desta consulta.</p>
        </Alerta>
      ) : dados && dados.sugestoes.length === 0 ? (
        <p className="texto-secundario">
          Nenhuma lição aprendida para objeto semelhante nos {dados.contratosAnalisados} contrato(s) analisado(s) em {formatarData(dados.consultadoEm)}.
        </p>
      ) : dados ? (
        <>
          <p role="status" className="texto-pequeno">
            {dados.sugestoes.length} sugestão(ões) a partir de {dados.contratosAnalisados} contrato(s) analisado(s) em {formatarData(dados.consultadoEm)}.
          </p>
          {dados.sugestoes.map((s) => (
            <Sugestao key={s.chave} sugestao={s} processoId={processo.id} editavel={editavel} />
          ))}
        </>
      ) : null}
      {dados && dados.decisoesAnteriores.length > 0 ? (
        <p className="texto-pequeno texto-secundario">
          Decisões anteriores que não aparecem mais como sugestão: {dados.decisoesAnteriores.map((d) => `${d.titulo} (${d.decisao})`).join('; ')}. As consideradas continuam no
          rascunho.
        </p>
      ) : null}
    </section>
  );
}
