/**
 * Coluna lateral do processo: árvore do processo SEI (com a integração com o SEI do órgão — RF-35), bloqueios da
 * etapa atual e sinais de atenção.
 */
import { useState } from 'react';
import { CircleCheck, FileText, OctagonAlert, PenLine } from 'lucide-react';
import type { ProcessoDetalhe } from '@agora/contratos';
import { useAssinarDocumentoSei } from '../../api/jornada';
import { Botao, BotaoCopiar, ConfirmarAcao, Etiqueta, Secao, useAvisos } from '../../componentes';
import { contar, formatarInstante } from '../../utilitarios/formatacao';
import { NumeroSeiDocumento, PainelSei, useAssinaturaSimuladaPermitida } from './IntegracaoSei';
import { NIVEIS_SINAL, tituloEtapa } from './rotulos';

type DocumentoArvore = ProcessoDetalhe['arvoreSei'][number];

/** "Assinado por Ana Ribeiro em 05/11/2026 às 14:20" (assinatura simulada). */
export function textoAssinatura(doc: DocumentoArvore): string {
  return `Assinado${doc.assinadoPor ? ` por ${doc.assinadoPor}` : ''}${doc.assinadoEm ? ` em ${formatarInstante(doc.assinadoEm)}` : ''}`;
}

/**
 * A assinatura segue a permissão do tipo de documento, como no servidor: o checklist do parecer é da
 * assessoria jurídica (`jornada:aprovar_juridico`); os demais, de quem edita a jornada (`jornada:editar`).
 */
export function ArvoreSei({ processo, podeAssinar }: { processo: ProcessoDetalhe; podeAssinar: (doc: DocumentoArvore) => boolean }) {
  const { avisar } = useAvisos();
  const assinar = useAssinarDocumentoSei(processo.id);
  const [alvo, definirAlvo] = useState<DocumentoArvore | null>(null);
  const assinaturaSimulada = useAssinaturaSimuladaPermitida(processo.id);
  const pendentes = processo.arvoreSei.filter((d) => !d.assinado).length;

  const fechar = () => {
    definirAlvo(null);
    assinar.reset();
  };

  return (
    <Secao
      titulo="Árvore do processo SEI"
      id="arvore-sei"
      descricao={
        <span className="pilha pilha--compacta">
          <BotaoCopiar valor={processo.numeroSei} rotulo="número do processo SEI" />
          <span className="texto-pequeno">
            {processo.arvoreSei.length === 0
              ? 'Nenhum documento incluído'
              : `${contar(processo.arvoreSei.length, 'documento', 'documentos')}, ${pendentes === 0 ? 'todos assinados' : `${pendentes} pendente${pendentes === 1 ? '' : 's'} de assinatura`}`}
          </span>
        </span>
      }
    >
      {processo.arvoreSei.length === 0 ? (
        <p className="texto-secundario">Documentos aprovados na Ágora entram aqui com numeração sequencial, como na árvore do SEI.</p>
      ) : (
        <ol className="jornada-sei">
          {processo.arvoreSei.map((doc) => (
            <li key={doc.numero} className="jornada-sei__item">
              <FileText className="jornada-sei__icone" size={18} aria-hidden="true" />
              <div className="jornada-sei__corpo">
                <span className="jornada-sei__numero mono">{doc.numero}</span>
                <span className="jornada-sei__titulo">{doc.titulo}</span>
                <NumeroSeiDocumento processoId={processo.id} numeroArvore={doc.numero} />
                {doc.assinado ? (
                  <Etiqueta tom="sucesso" compacta>
                    {textoAssinatura(doc)}
                  </Etiqueta>
                ) : (
                  <Etiqueta tom="aviso" compacta>
                    Pendente de assinatura
                  </Etiqueta>
                )}
              </div>
              {!doc.assinado && assinaturaSimulada && podeAssinar(doc) ? (
                <Botao
                  tamanho="compacto"
                  icone={PenLine}
                  aria-label={`Assinar documento ${doc.numero} — ${doc.titulo}`}
                  onClick={() => {
                    assinar.reset();
                    definirAlvo(doc);
                  }}
                >
                  Assinar
                </Botao>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      <PainelSei processo={processo} />
      <ConfirmarAcao
        aberto={alvo !== null}
        aoFechar={fechar}
        titulo="Assinar documento (simulação)"
        descricao={
          alvo ? (
            <p>
              Registra a sua assinatura no documento <strong className="mono">{alvo.numero}</strong> — {alvo.titulo}. Esta é uma simulação: nenhum
              documento é enviado ao SEI e não há assinatura com certificado ICP-Brasil.
            </p>
          ) : null
        }
        rotuloConfirmar="Assinar (simulação)"
        aoConfirmar={() => {
          if (!alvo) return;
          const numero = alvo.numero;
          assinar.mutate(numero, {
            onSuccess: () => {
              avisar({ tipo: 'sucesso', titulo: 'Assinatura registrada', mensagem: `Documento ${numero} assinado (simulação).` });
              definirAlvo(null);
            },
          });
        }}
        processando={assinar.isPending}
        erro={assinar.error}
      />
    </Secao>
  );
}

export function ListaBloqueios({ processo }: { processo: ProcessoDetalhe }) {
  const encerrado = processo.contratoGerado !== null;
  const bloqueios = processo.bloqueiosDetalhe;
  return (
    <Secao
      titulo="Bloqueios"
      id="bloqueios"
      descricao={encerrado ? 'Processo concluído.' : `Regras que impedem concluir a etapa ${processo.etapaAtual} — ${tituloEtapa(processo.etapaAtual)}.`}
    >
      {encerrado || bloqueios.length === 0 ? (
        <p className="jornada-sem-bloqueio">
          <CircleCheck size={18} aria-hidden="true" />
          <span>{encerrado ? 'Nenhuma pendência: o contrato foi gerado.' : 'Nenhum bloqueio registrado: a etapa pode ser concluída.'}</span>
        </p>
      ) : (
        <ul className="jornada-ocorrencias">
          {bloqueios.map((b, i) => (
            <li key={`${b.regra}-${i}`} className="jornada-ocorrencia">
              <OctagonAlert className="jornada-ocorrencia__icone jornada-ocorrencia__icone--bloqueio" size={18} aria-hidden="true" />
              <div className="jornada-ocorrencia__corpo">
                <p>
                  <span className="jornada-regra-id">{b.regra}</span> <span className="sr-only">Bloqueio: </span>
                  {b.mensagem}
                </p>
                <p className="texto-pequeno texto-secundario">{b.fundamento}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

export function ListaSinais({ processo }: { processo: ProcessoDetalhe }) {
  return (
    <Secao titulo="Sinais" id="sinais" descricao="Alertas para análise da equipe. Não impedem o avanço e não constituem decisão.">
      {processo.sinais.length === 0 ? (
        <p className="texto-secundario">Nenhum sinal de atenção para este processo.</p>
      ) : (
        <ul className="jornada-ocorrencias">
          {processo.sinais.map((s, i) => {
            const nivel = NIVEIS_SINAL[s.nivel];
            return (
              <li key={`${s.regra}-${i}`} className="jornada-ocorrencia">
                <div className="jornada-ocorrencia__corpo">
                  <p className="linha">
                    <Etiqueta tom={nivel.tom} compacta>
                      {nivel.rotulo}
                    </Etiqueta>
                    <span className="jornada-regra-id">{s.regra}</span>
                  </p>
                  <p>{s.mensagem}</p>
                  <p className="texto-pequeno texto-secundario">{s.fundamento}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}
