/**
 * Manifestação vista pela Administração (RF-37): texto como sairá em público, imagem já sem metadados, decisão da
 * moderação (sempre com motivo) e respostas identificadas. Os botões só aparecem para quem tem a permissão; a API
 * decide de qualquer forma.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { Check, MessageSquareReply, X } from 'lucide-react';
import { formatarData, LIMITES_GESTAO_COMPARTILHADA } from '@agora/dominio';
import type { ManifestacaoModeracao } from '@agora/contratos';
import { useModerarManifestacao, useResponderManifestacao } from '../../api/sociedade';
import { AreaTexto, Botao, CampoTexto, ConfirmarAcao, Etiqueta, GrupoOpcoes, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ASSUNTOS, PRAZOS, SITUACOES } from './rotulos';

function DialogoModeracao({ m, decisao, aoFechar }: { m: ManifestacaoModeracao; decisao: 'publicar' | 'recusar' | null; aoFechar: () => void }) {
  const moderar = useModerarManifestacao();
  const { avisar } = useAvisos();
  const [motivo, definirMotivo] = useState('');
  const [tentou, definirTentou] = useState(false);
  const minimo = LIMITES_GESTAO_COMPARTILHADA.motivoMinimo;
  const erro = motivo.trim().length < minimo ? `Explique a decisão em pelo menos ${minimo} caracteres.` : null;
  const fechar = () => {
    definirMotivo('');
    definirTentou(false);
    moderar.reset();
    aoFechar();
  };
  return (
    <ConfirmarAcao
      aberto={decisao !== null}
      aoFechar={fechar}
      titulo={decisao === 'publicar' ? 'Publicar manifestação' : 'Não publicar manifestação'}
      descricao={
        decisao === 'publicar'
          ? 'A mensagem e a imagem ficam visíveis a qualquer pessoa na página pública do contrato, com o autor só pelo primeiro nome e as iniciais.'
          : 'A mensagem não será publicada. O autor verá o motivo em Minhas manifestações.'
      }
      rotuloConfirmar={decisao === 'publicar' ? 'Publicar' : 'Não publicar'}
      variante={decisao === 'publicar' ? 'primario' : 'perigo'}
      processando={moderar.isPending}
      erro={moderar.error}
      aoConfirmar={() => {
        definirTentou(true);
        if (erro || decisao === null) return;
        moderar.mutate(
          { id: m.id, decisao, motivo: motivo.trim() },
          {
            onSuccess: () => {
              avisar({ tipo: 'sucesso', titulo: decisao === 'publicar' ? 'Manifestação publicada' : 'Manifestação não publicada', mensagem: 'A decisão e o motivo ficaram na trilha de auditoria.' });
              fechar();
            },
          },
        );
      }}
    >
      <AreaTexto
        rotulo="Motivo da decisão"
        obrigatorio
        contador
        maxLength={LIMITES_GESTAO_COMPARTILHADA.motivoMaximo}
        rows={3}
        value={motivo}
        onChange={(e) => definirMotivo(e.target.value)}
        erro={tentou ? erro : null}
        ajuda="Fica na trilha de auditoria e é mostrado ao autor."
      />
    </ConfirmarAcao>
  );
}

function DialogoResposta({ m, aberto, aoFechar }: { m: ManifestacaoModeracao; aberto: boolean; aoFechar: () => void }) {
  const responder = useResponderManifestacao();
  const { avisar } = useAvisos();
  const [origem, definirOrigem] = useState<'administracao' | 'contratado'>('administracao');
  const [texto, definirTexto] = useState('');
  const [representante, definirRepresentante] = useState('');
  const [tentou, definirTentou] = useState(false);
  const { respostaMinima, respostaMaxima } = LIMITES_GESTAO_COMPARTILHADA;
  const erroTexto = texto.trim().length < respostaMinima ? `Escreva pelo menos ${respostaMinima} caracteres.` : null;
  const erroRepresentante = origem === 'contratado' && representante.trim().length < 3 ? 'Informe o nome do preposto que enviou a resposta.' : null;
  const fechar = () => {
    definirTexto('');
    definirRepresentante('');
    definirOrigem('administracao');
    definirTentou(false);
    responder.reset();
    aoFechar();
  };
  return (
    <ConfirmarAcao
      aberto={aberto}
      aoFechar={fechar}
      largura="media"
      titulo="Responder manifestação"
      descricao="A resposta é pública e identificada: a Administração aparece com o seu nome abreviado e a sua função; o contratado, com o preposto."
      rotuloConfirmar="Publicar resposta"
      processando={responder.isPending}
      erro={responder.error}
      aoConfirmar={() => {
        definirTentou(true);
        if (erroTexto || erroRepresentante) return;
        responder.mutate(
          { id: m.id, origem, texto: texto.trim(), representante: origem === 'contratado' ? representante.trim() : null },
          {
            onSuccess: () => {
              avisar({ tipo: 'sucesso', titulo: 'Resposta publicada', mensagem: 'A resposta aparece na página pública do contrato.' });
              fechar();
            },
          },
        );
      }}
    >
      <GrupoOpcoes
        legenda="Quem responde"
        nome={`origem-${m.id}`}
        valor={origem}
        aoMudar={definirOrigem}
        opcoes={[
          { valor: 'administracao', rotulo: 'A Administração (eu, em nome da gestão ou da fiscalização)' },
          { valor: 'contratado', rotulo: 'O contratado (registro a resposta que ele enviou)' },
        ]}
      />
      {origem === 'contratado' ? (
        <CampoTexto rotulo="Preposto do contratado" obrigatorio maxLength={120} value={representante} onChange={(e) => definirRepresentante(e.target.value)} erro={tentou ? erroRepresentante : null} />
      ) : null}
      <AreaTexto rotulo="Resposta" obrigatorio contador maxLength={respostaMaxima} rows={5} value={texto} onChange={(e) => definirTexto(e.target.value)} erro={tentou ? erroTexto : null} />
    </ConfirmarAcao>
  );
}

export function CartaoManifestacao({ m, mostrarContrato }: { m: ManifestacaoModeracao; mostrarContrato: boolean }) {
  const { temPermissao } = useSessao();
  const [decisao, definirDecisao] = useState<'publicar' | 'recusar' | null>(null);
  const [respondendo, definirRespondendo] = useState(false);
  const situacao = SITUACOES[m.situacao];
  const prazo = PRAZOS[m.situacaoPrazo];
  return (
    <li className="sociedade__manifestacao">
      <div className="sociedade__cabecalho">
        {mostrarContrato ? (
          <Link to={`/sociedade/contratos/${m.contrato.id}`}>
            Contrato {m.contrato.numero} (UASG {m.contrato.uasg})
          </Link>
        ) : null}
        <strong>{m.autor}</strong>
        <span className="texto-secundario">{formatarInstante(m.recebidaEm)}</span>
        <Etiqueta tom="neutro" icone={null}>
          {ASSUNTOS[m.assunto]}
        </Etiqueta>
        <Etiqueta tom={situacao.tom}>{situacao.rotulo}</Etiqueta>
        {m.situacao === 'publicada' ? <Etiqueta tom={prazo.tom}>{prazo.rotulo}</Etiqueta> : null}
      </div>
      <p className="sociedade__texto">{m.texto}</p>
      {m.dadosPessoaisTarjados ? <p className="texto-pequeno texto-secundario">CPF, e-mail ou telefone do texto foram tarjados na versão pública.</p> : null}
      {m.imagemUrl ? <img className="sociedade__imagem" src={m.imagemUrl} alt={`Imagem enviada por ${m.autor}`} loading="lazy" /> : null}
      {m.metadadosRemovidos.length > 0 ? <p className="texto-pequeno texto-secundario">Retirado da imagem: {m.metadadosRemovidos.join(', ')}.</p> : null}
      {m.motivoModeracao ? (
        <p className="texto-pequeno">
          <strong>Moderação{m.moderadaPor ? ` (${m.moderadaPor})` : ''}:</strong> {m.motivoModeracao}
        </p>
      ) : null}
      {m.situacao === 'publicada' ? <p className="texto-pequeno texto-secundario">Prazo de resposta: {formatarData(m.prazoResposta)}.</p> : null}
      {m.respostas.length > 0 ? (
        <ul className="sociedade__respostas" aria-label={`Respostas à manifestação de ${m.autor}`}>
          {m.respostas.map((r) => (
            <li key={r.id}>
              <p className="sociedade__cabecalho">
                <strong>{r.autor}</strong>
                <span className="texto-secundario">
                  {r.funcao} · {formatarInstante(r.respondidaEm)}
                </span>
              </p>
              <p className="sociedade__texto">{r.texto}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sociedade__acoes">
        {m.situacao === 'em_moderacao' && temPermissao('sociedade:moderar') ? (
          <>
            <Botao tamanho="compacto" variante="primario" icone={Check} onClick={() => definirDecisao('publicar')}>
              Publicar
            </Botao>
            <Botao tamanho="compacto" variante="secundario" icone={X} onClick={() => definirDecisao('recusar')}>
              Não publicar
            </Botao>
          </>
        ) : null}
        {m.situacao === 'publicada' && temPermissao('sociedade:responder') ? (
          <Botao tamanho="compacto" variante="secundario" icone={MessageSquareReply} onClick={() => definirRespondendo(true)}>
            Responder
          </Botao>
        ) : null}
      </div>
      <DialogoModeracao m={m} decisao={decisao} aoFechar={() => definirDecisao(null)} />
      <DialogoResposta m={m} aberto={respondendo} aoFechar={() => definirRespondendo(false)} />
    </li>
  );
}
