import { useState, type FormEvent } from 'react';
import { BellRing } from 'lucide-react';
import type { CanalNotificacao, EntradaNotificacao, NotificacaoDetalhe, TipoNotificacao, UsuarioResumo } from '@agora/contratos';
import { validarDataISO } from '@agora/dominio';
import { useDispararNotificacao } from '../../api/notificacoes';
import { mensagemDeErro } from '../../api/cliente';
import { Alerta, AreaTexto, Botao, CaixaSelecao, CampoTexto, Dialogo, GrupoOpcoes, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar } from '../../utilitarios/formatacao';
import { CANAIS_NOTIFICACAO, TIPOS_NOTIFICACAO } from './rotulos';

export interface InstrumentoNotificavel {
  tipo: 'ata' | 'contrato';
  id: string;
  /** "Contrato 12/2026" */
  identificador: string;
  gestor: UsuarioResumo | null;
  /** Só contratos têm fiscal. */
  fiscal?: UsuarioResumo | null;
  /** Razão social da contratada (contrato) ou texto das fornecedoras (ata). */
  contratada: string;
  temGarantia?: boolean;
}

type Destino = EntradaNotificacao['destinatarios'][number];

const MINIMO_RELATO = 20;
const DESCRICAO_TIPO: Record<TipoNotificacao, string> = {
  vencimento: 'Fim da vigência e providência da faixa do semáforo (30, 60, 90 ou 120 dias).',
  reajuste: 'Aniversário da data-base e índice do reajuste.',
  garantia: 'Validade da garantia contratual e pedido de renovação.',
  pendencia: 'Pendência a tratar, com prazo.',
  ocorrencia: 'Falha na execução registrada pela fiscalização. Aviso obrigatório (art. 117, § 1º).',
};

function resumoEnvios(n: NotificacaoDetalhe): string {
  const partes = [contar(n.contagem.enviados, 'envio concluído', 'envios concluídos')];
  if (n.contagem.pendentes > 0) partes.push(`${n.contagem.pendentes} na fila`);
  if (n.contagem.falhas > 0) partes.push(contar(n.contagem.falhas, 'falha', 'falhas'));
  if (n.contagem.suprimidos > 0) partes.push(`${n.contagem.suprimidos} não enviado(s) por preferência ou canal`);
  return `${partes.join(', ')}. Acompanhe a situação na central de notificações.`;
}

export function DialogoNotificar({ instrumento, aberto, aoFechar }: { instrumento: InstrumentoNotificavel; aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const disparar = useDispararNotificacao();
  const ehContrato = instrumento.tipo === 'contrato';
  const destinoPadrao: Destino[] = ehContrato && instrumento.fiscal ? ['fiscal'] : ['gestor'];
  const [tipo, definirTipo] = useState<TipoNotificacao>('vencimento');
  const [destinos, definirDestinos] = useState<Destino[]>(destinoPadrao);
  const [canais, definirCanais] = useState<CanalNotificacao[]>(['email']);
  const [detalhe, definirDetalhe] = useState('');
  const [prazo, definirPrazo] = useState('');
  const [complemento, definirComplemento] = useState('');
  const [erros, definirErros] = useState<{ destinos?: string; canais?: string; detalhe?: string; prazo?: string }>({});

  const tipos = (Object.keys(TIPOS_NOTIFICACAO) as TipoNotificacao[]).filter((t) => t !== 'garantia' || (ehContrato && instrumento.temGarantia));
  const opcoesDestino: { valor: Destino; rotulo: string; desabilitado: boolean }[] = [
    ...(ehContrato
      ? [{ valor: 'fiscal' as const, rotulo: instrumento.fiscal ? `Fiscal do contrato — ${instrumento.fiscal.nome}` : 'Fiscal do contrato (não designado)', desabilitado: !instrumento.fiscal }]
      : []),
    { valor: 'gestor', rotulo: instrumento.gestor ? `Gestor — ${instrumento.gestor.nome}` : 'Gestor (não designado)', desabilitado: !instrumento.gestor },
    { valor: 'contratada', rotulo: `${ehContrato ? 'Contratada' : 'Fornecedoras da ata'} — ${instrumento.contratada}`, desabilitado: false },
  ];
  const pedeDetalhe = tipo === 'ocorrencia' || tipo === 'pendencia';

  const limpar = () => {
    definirTipo('vencimento');
    definirDestinos(destinoPadrao);
    definirCanais(['email']);
    definirDetalhe('');
    definirPrazo('');
    definirComplemento('');
    definirErros({});
    disparar.reset();
  };

  const fechar = () => {
    limpar();
    aoFechar();
  };

  const alternar = <T extends string>(lista: readonly T[], item: T): T[] => (lista.includes(item) ? lista.filter((i) => i !== item) : [...lista, item]);

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: typeof erros = {};
    if (destinos.length === 0) novos.destinos = 'Escolha ao menos um destinatário.';
    if (canais.length === 0) novos.canais = 'Escolha ao menos um canal.';
    if (tipo === 'ocorrencia' && detalhe.trim().length < MINIMO_RELATO) novos.detalhe = `Descreva a ocorrência com pelo menos ${MINIMO_RELATO} caracteres.`;
    if (tipo === 'pendencia' && detalhe.trim() === '') novos.detalhe = 'Informe o motivo da pendência.';
    if (pedeDetalhe && prazo !== '' && !validarDataISO(prazo)) novos.prazo = 'Data inválida.';
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    disparar.mutate(
      {
        instrumentoTipo: instrumento.tipo,
        instrumentoId: instrumento.id,
        tipo,
        destinatarios: destinos,
        canais,
        dataReferencia: pedeDetalhe && prazo !== '' ? prazo : null,
        detalhe: pedeDetalhe ? detalhe.trim() : null,
        complemento: complemento.trim() === '' ? null : complemento.trim(),
      },
      {
        onSuccess: (notificacao) => {
          avisar({ tipo: notificacao.contagem.falhas > 0 ? 'aviso' : 'sucesso', titulo: 'Aviso registrado e enviado', mensagem: resumoEnvios(notificacao) });
          fechar();
        },
      },
    );
  };

  const idFormulario = `formulario-notificar-${instrumento.id}`;
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      titulo={`Notificar sobre ${instrumento.identificador}`}
      largura="ampla"
      descricao={
        <p>
          O aviso usa um modelo de mensagem em português com o fundamento legal, entra na fila de envio e fica registrado na trilha de auditoria. O e-mail
          do destinatário não é exibido. Avisos opcionais respeitam as preferências de cada servidor.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} icone={BellRing} carregando={disparar.isPending}>
            Enviar aviso
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes
          legenda="Tipo de aviso"
          nome={`tipo-aviso-${instrumento.id}`}
          obrigatorio
          opcoes={tipos.map((t) => ({ valor: t, rotulo: TIPOS_NOTIFICACAO[t].rotulo, ajuda: DESCRICAO_TIPO[t] }))}
          valor={tipo}
          aoMudar={definirTipo}
        />
        <fieldset className="grupo-campos">
          <legend>Destinatários</legend>
          {opcoesDestino.map((o) => (
            <CaixaSelecao
              key={o.valor}
              rotulo={o.rotulo}
              checked={destinos.includes(o.valor)}
              disabled={o.desabilitado}
              onChange={() => definirDestinos((l) => alternar(l, o.valor))}
            />
          ))}
          {erros.destinos ? (
            <p className="campo__erro" role="alert">
              {erros.destinos}
            </p>
          ) : null}
        </fieldset>
        <fieldset className="grupo-campos">
          <legend>Canais</legend>
          {(Object.keys(CANAIS_NOTIFICACAO) as CanalNotificacao[]).map((c) => (
            <CaixaSelecao
              key={c}
              rotulo={CANAIS_NOTIFICACAO[c]}
              ajuda={
                c === 'sei'
                  ? 'Inclui o aviso como documento no processo SEI do instrumento.'
                  : c === 'govbr'
                    ? 'Caixa postal do gov.br: só para pessoas físicas que aderiram ao canal.'
                    : 'Servidor de e-mail do órgão.'
              }
              checked={canais.includes(c)}
              onChange={() => definirCanais((l) => alternar(l, c))}
            />
          ))}
          {erros.canais ? (
            <p className="campo__erro" role="alert">
              {erros.canais}
            </p>
          ) : null}
        </fieldset>
        {pedeDetalhe ? (
          <div className="formulario__linha">
            <AreaTexto
              rotulo={tipo === 'ocorrencia' ? 'Relato da ocorrência' : 'Motivo da pendência'}
              obrigatorio
              rows={4}
              maxLength={4000}
              contador
              value={detalhe}
              onChange={(e) => definirDetalhe(e.target.value)}
              erro={erros.detalhe}
              ajuda={tipo === 'ocorrencia' ? 'Descreva a falha, as datas e o que a contratada deve regularizar.' : undefined}
            />
            <CampoTexto
              rotulo={tipo === 'ocorrencia' ? 'Prazo para regularização' : 'Prazo'}
              type="date"
              value={prazo}
              onChange={(e) => definirPrazo(e.target.value)}
              erro={erros.prazo}
              ajuda="Opcional."
            />
          </div>
        ) : null}
        <AreaTexto
          rotulo="Mensagem complementar"
          rows={3}
          maxLength={2000}
          contador
          value={complemento}
          onChange={(e) => definirComplemento(e.target.value)}
          ajuda="Opcional. Entra no fim do texto do modelo."
        />
        {disparar.isError ? (
          <Alerta tipo="erro" anunciar titulo="Não foi possível enviar o aviso">
            <p>{mensagemDeErro(disparar.error)}</p>
          </Alerta>
        ) : null}
      </form>
    </Dialogo>
  );
}

/** Botão "Notificar" das telas de contrato e de ata. Aparece só para quem pode disparar (o servidor decide). */
export function BotaoNotificar({ instrumento }: { instrumento: InstrumentoNotificavel }) {
  const { temPermissao } = useSessao();
  const [aberto, definirAberto] = useState(false);
  if (!temPermissao('notificacoes:enviar')) return null;
  return (
    <>
      <Botao variante="secundario" icone={BellRing} onClick={() => definirAberto(true)}>
        Notificar
      </Botao>
      <DialogoNotificar instrumento={instrumento} aberto={aberto} aoFechar={() => definirAberto(false)} />
    </>
  );
}
