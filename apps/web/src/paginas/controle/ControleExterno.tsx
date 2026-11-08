/**
 * Controle externo (Lei 14.133/2021, art. 171; RF-24 e RN-30): medidas do TCU e da CGU sobre processos e contratos,
 * com o prazo de resposta do órgão em dias úteis, a prorrogação, a resposta e a revogação. A cautelar com efeito
 * suspensivo bloqueia o avanço do processo e a assinatura do contrato até a revogação. O servidor calcula os prazos
 * e decide quem pode registrar; aqui a prévia do prazo é só informativa.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Landmark, Plus } from 'lucide-react';
import type { EntradaMedidaControle, FiltroMedidasControle, MedidaControle, OrgaoControle, TipoMedidaControle } from '@agora/contratos';
import { formatarData, hojeISO, prazoRespostaMedida, validarDataISO } from '@agora/dominio';
import { useContratos } from '../../api/contratos';
import { useMedidasControle, useProrrogarMedida, useRegistrarMedida, useResponderMedida, useRevogarMedida } from '../../api/controle';
import { useProcessos } from '../../api/jornada';
import {
  Alerta,
  AreaTexto,
  BarraFiltros,
  Botao,
  CaixaSelecao,
  CampoBusca,
  CampoTexto,
  Dialogo,
  EstadoVazio,
  FalhaConsulta,
  GrupoOpcoes,
  ListaDefinicoes,
  Pagina,
  Paginacao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { ErroOperacao } from '../jornada/comum';
import { EtiquetaMedida, ORGAOS_CONTROLE, prazoEfetivo, SITUACOES_MEDIDA, TIPOS_MEDIDA } from './comum';

const FILTROS = ['situacao', 'orgao', 'alvo', 'busca'] as const;
const SITUACOES_FILTRO = ['abertas', 'aguardando_resposta', 'resposta_vencida', 'respondida', 'revogada'] as const;
const ORGAOS: readonly OrgaoControle[] = ['TCU', 'CGU'];
const TIPOS: readonly TipoMedidaControle[] = ['cautelar', 'determinacao', 'diligencia', 'recomendacao'];
const MINIMO_OBJETO = 20;

function restantes(m: MedidaControle): string {
  if (m.diasUteisRestantes === null) return '';
  if (m.diasUteisRestantes < 0) return `vencido há ${-m.diasUteisRestantes} dia(s) útil(eis)`;
  if (m.diasUteisRestantes === 0) return 'vence hoje';
  return `${m.diasUteisRestantes} dia(s) útil(eis)`;
}

const COLUNAS: readonly ColunaTabela<MedidaControle>[] = [
  {
    id: 'medida',
    cabecalho: 'Medida',
    identificadora: true,
    fixa: true,
    celula: (m) => (
      <span className="pilha pilha--compacta">
        <strong>
          {TIPOS_MEDIDA[m.tipo]} do {m.orgao} nº {m.numero}
        </strong>
        <span className="texto-pequeno texto-secundario">{m.efeitoSuspensivo ? 'Com efeito suspensivo' : 'Sem efeito suspensivo'}</span>
      </span>
    ),
  },
  {
    id: 'alvo',
    cabecalho: 'Atinge',
    prioritaria: true,
    celula: (m) => <Link to={m.alvo.caminho}>{m.alvo.identificador}</Link>,
  },
  { id: 'situacao', cabecalho: 'Situação', prioritaria: true, celula: (m) => <EtiquetaMedida medida={m} /> },
  {
    id: 'prazo',
    cabecalho: 'Resposta até',
    celula: (m) => (
      <span className="pilha pilha--compacta">
        <span className="numero">{formatarData(prazoEfetivo(m))}</span>
        <span className="texto-pequeno texto-secundario">{m.prorrogacao ? 'prorrogado' : restantes(m)}</span>
      </span>
    ),
  },
  { id: 'ciencia', cabecalho: 'Ciência', celula: (m) => <span className="numero">{formatarData(m.cienciaEm)}</span> },
  { id: 'uasg', cabecalho: 'UASG', celula: (m) => <span className="numero">{m.uasg}</span> },
];

// ───────────────────────── Registrar medida ─────────────────────────

interface AlvoEscolhido {
  tipo: 'processo' | 'contrato';
  id: string;
  rotulo: string;
}

function BuscaProcesso({ busca, valor, aoEscolher }: { busca: string; valor: string | null; aoEscolher: (a: AlvoEscolhido) => void }) {
  const consulta = useProcessos({ busca, tamanhoPagina: 10 });
  const itens = consulta.data?.itens ?? [];
  if (consulta.isPending) return <p className="texto-pequeno texto-secundario" role="status">Buscando processos…</p>;
  if (itens.length === 0) return <p className="texto-pequeno texto-secundario" role="status">Nenhum processo encontrado para “{busca}”.</p>;
  return (
    <GrupoOpcoes
      legenda="Processo atingido"
      nome="alvo-processo"
      obrigatorio
      opcoes={itens.map((p) => ({ valor: p.id, rotulo: `Processo ${p.numeroSei}`, ajuda: `${p.titulo} · etapa ${p.etapaAtual}` }))}
      valor={valor}
      aoMudar={(id) => {
        const p = itens.find((x) => x.id === id);
        if (p) aoEscolher({ tipo: 'processo', id: p.id, rotulo: `Processo ${p.numeroSei}` });
      }}
    />
  );
}

function BuscaContrato({ busca, valor, aoEscolher }: { busca: string; valor: string | null; aoEscolher: (a: AlvoEscolhido) => void }) {
  const consulta = useContratos({ busca, tamanhoPagina: 10 });
  const itens = consulta.data?.itens ?? [];
  if (consulta.isPending) return <p className="texto-pequeno texto-secundario" role="status">Buscando contratos…</p>;
  if (itens.length === 0) return <p className="texto-pequeno texto-secundario" role="status">Nenhum contrato encontrado para “{busca}”.</p>;
  return (
    <GrupoOpcoes
      legenda="Contrato atingido"
      nome="alvo-contrato"
      obrigatorio
      opcoes={itens.map((c) => ({ valor: c.id, rotulo: `Contrato ${c.numero}`, ajuda: `${c.objeto} · UASG ${c.uasg.codigo}` }))}
      valor={valor}
      aoMudar={(id) => {
        const c = itens.find((x) => x.id === id);
        if (c) aoEscolher({ tipo: 'contrato', id: c.id, rotulo: `Contrato ${c.numero}` });
      }}
    />
  );
}

interface ErrosMedida {
  numero?: string;
  decididaEm?: string;
  cienciaEm?: string;
  alvo?: string;
  objeto?: string;
  prazo?: string;
}

function FormularioMedida({ idFormulario, aoConcluir }: { idFormulario: string; aoConcluir: () => void }) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarMedida();
  const hoje = hojeISO(new Date());
  const [orgao, definirOrgao] = useState<OrgaoControle>('TCU');
  const [tipo, definirTipo] = useState<TipoMedidaControle>('cautelar');
  const [suspensivo, definirSuspensivo] = useState(true);
  const [numero, definirNumero] = useState('');
  const [decididaEm, definirDecididaEm] = useState('');
  const [cienciaEm, definirCienciaEm] = useState('');
  const [tipoAlvo, definirTipoAlvo] = useState<'processo' | 'contrato'>('processo');
  const [busca, definirBusca] = useState('');
  const [alvo, definirAlvo] = useState<AlvoEscolhido | null>(null);
  const [objeto, definirObjeto] = useState('');
  const [prazoDias, definirPrazoDias] = useState('');
  const [erros, definirErros] = useState<ErrosMedida>({});

  const efeitoSuspensivo = tipo === 'cautelar' && suspensivo;
  const diasFixados = !efeitoSuspensivo && prazoDias.trim() !== '' ? Number(prazoDias) : null;
  let previa: string | null = null;
  if (validarDataISO(cienciaEm)) {
    try {
      const prazo = prazoRespostaMedida({ ciencia: cienciaEm, efeitoSuspensivo, diasUteisFixados: diasFixados });
      previa = `Resposta até ${formatarData(prazo.vencimento)} (${prazo.diasUteis} dias úteis). ${prazo.fundamento}. O servidor confirma o prazo com os feriados locais.`;
    } catch {
      previa = null;
    }
  }

  const validar = (): boolean => {
    const novos: ErrosMedida = {};
    if (numero.trim() === '') novos.numero = 'Informe o número da decisão ou do ofício.';
    if (!validarDataISO(decididaEm)) novos.decididaEm = 'Informe a data da decisão.';
    if (!validarDataISO(cienciaEm)) novos.cienciaEm = 'Informe a data da ciência.';
    else if (cienciaEm > hoje) novos.cienciaEm = 'A ciência não pode ser futura.';
    else if (validarDataISO(decididaEm) && cienciaEm < decididaEm) novos.cienciaEm = 'A ciência não pode ser anterior à decisão.';
    if (!alvo) novos.alvo = `Selecione o ${tipoAlvo} atingido.`;
    if (objeto.trim().length < MINIMO_OBJETO) novos.objeto = `Descreva o objeto com pelo menos ${MINIMO_OBJETO} caracteres.`;
    if (diasFixados !== null && (!Number.isInteger(diasFixados) || diasFixados < 1 || diasFixados > 120)) novos.prazo = 'Informe um número inteiro de 1 a 120 dias úteis.';
    definirErros(novos);
    return Object.keys(novos).length === 0;
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!validar() || !alvo) return;
    const entrada: EntradaMedidaControle = {
      orgao,
      tipo,
      numero: numero.trim(),
      decididaEm,
      cienciaEm,
      objeto: objeto.trim(),
      efeitoSuspensivo,
      processoId: alvo.tipo === 'processo' ? alvo.id : null,
      contratoId: alvo.tipo === 'contrato' ? alvo.id : null,
      prazoDiasUteis: diasFixados,
    };
    registrar.mutate(entrada, {
      onSuccess: (m) => {
        avisar({
          tipo: 'sucesso',
          titulo: 'Medida registrada',
          mensagem: `${TIPOS_MEDIDA[m.tipo]} nº ${m.numero}: resposta até ${formatarData(m.prazoResposta)}${m.bloqueia ? '. O processo ou contrato fica bloqueado até a revogação.' : '.'}`,
        });
        aoConcluir();
      },
    });
  };

  return (
    <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
      <fieldset className="grupo-campos">
        <legend>Medida</legend>
        <GrupoOpcoes legenda="Órgão de controle" nome="orgao-medida" horizontal obrigatorio opcoes={ORGAOS.map((o) => ({ valor: o, rotulo: ORGAOS_CONTROLE[o] }))} valor={orgao} aoMudar={definirOrgao} />
        <div className="formulario__linha">
          <Selecao
            rotulo="Tipo de medida"
            obrigatorio
            opcoes={TIPOS.map((t) => ({ valor: t, rotulo: TIPOS_MEDIDA[t] }))}
            value={tipo}
            onChange={(e) => {
              const escolhido = TIPOS.find((t) => t === e.target.value);
              if (escolhido) definirTipo(escolhido);
            }}
          />
          <CampoTexto rotulo="Número da decisão ou do ofício" obrigatorio value={numero} maxLength={60} onChange={(e) => definirNumero(e.target.value)} erro={erros.numero} />
        </div>
        {tipo === 'cautelar' ? (
          <CaixaSelecao
            rotulo="Com efeito suspensivo"
            ajuda="Suspende o processo ou a assinatura do contrato até a revogação (RN-30). O prazo de resposta é o legal, de 10 dias úteis (art. 171, § 2º)."
            checked={suspensivo}
            onChange={(e) => definirSuspensivo(e.target.checked)}
          />
        ) : null}
        <div className="formulario__linha">
          <CampoTexto rotulo="Data da decisão" type="date" obrigatorio max={hoje} value={decididaEm} onChange={(e) => definirDecididaEm(e.target.value)} erro={erros.decididaEm} />
          <CampoTexto
            rotulo="Data da ciência pelo órgão"
            type="date"
            obrigatorio
            max={hoje}
            value={cienciaEm}
            onChange={(e) => definirCienciaEm(e.target.value)}
            erro={erros.cienciaEm}
            ajuda="Intimação do órgão: o prazo de resposta conta a partir desta data, em dias úteis."
          />
        </div>
        {!efeitoSuspensivo ? (
          <CampoTexto
            rotulo="Prazo fixado na comunicação (dias úteis)"
            inputMode="numeric"
            value={prazoDias}
            onChange={(e) => definirPrazoDias(e.target.value)}
            erro={erros.prazo}
            ajuda="Deixe em branco se a comunicação não fixar prazo: vale a referência de 10 dias úteis."
          />
        ) : null}
        {previa ? (
          <p className="texto-pequeno" role="status">
            {previa}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="grupo-campos">
        <legend>Processo ou contrato atingido</legend>
        <GrupoOpcoes
          legenda="A medida atinge"
          nome="tipo-alvo"
          horizontal
          opcoes={[
            { valor: 'processo', rotulo: 'Processo da jornada' },
            { valor: 'contrato', rotulo: 'Contrato' },
          ]}
          valor={tipoAlvo}
          aoMudar={(v) => {
            definirTipoAlvo(v);
            definirAlvo(null);
          }}
        />
        <CampoBusca
          rotulo={tipoAlvo === 'processo' ? 'Buscar processo' : 'Buscar contrato'}
          placeholder={tipoAlvo === 'processo' ? 'Número SEI ou objeto (mínimo 3 caracteres)' : 'Número, objeto ou fornecedor (mínimo 3 caracteres)'}
          valor={busca}
          aoMudar={definirBusca}
        />
        {alvo ? (
          <p className="texto-pequeno">
            Selecionado: <strong>{alvo.rotulo}</strong>
          </p>
        ) : null}
        {busca.trim().length < 3 ? (
          <p className="texto-pequeno texto-secundario">Digite ao menos 3 caracteres para listar.</p>
        ) : tipoAlvo === 'processo' ? (
          <BuscaProcesso busca={busca.trim()} valor={alvo?.id ?? null} aoEscolher={definirAlvo} />
        ) : (
          <BuscaContrato busca={busca.trim()} valor={alvo?.id ?? null} aoEscolher={definirAlvo} />
        )}
        {erros.alvo ? (
          <p className="campo__erro" role="alert">
            {erros.alvo}
          </p>
        ) : null}
      </fieldset>

      <AreaTexto
        rotulo="Objeto da medida"
        obrigatorio
        rows={4}
        maxLength={2000}
        contador
        value={objeto}
        onChange={(e) => definirObjeto(e.target.value)}
        erro={erros.objeto}
        ajuda="O que o órgão de controle determinou ou suspendeu, com a referência do processo de controle."
      />
      <ErroOperacao erro={registrar.error} titulo="A medida não foi registrada" />
    </form>
  );
}

function DialogoRegistrar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const idFormulario = 'formulario-medida-controle';
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo="Registrar medida do controle externo"
      largura="ampla"
      descricao={<p>Registre a medida do TCU ou da CGU de que o órgão foi intimado. O registro, a resposta e a revogação ficam na trilha de auditoria.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario}>
            Registrar medida
          </Botao>
        </>
      }
    >
      <FormularioMedida idFormulario={idFormulario} aoConcluir={aoFechar} />
    </Dialogo>
  );
}

// ───────────────────────── Detalhe, prorrogação, resposta e revogação ─────────────────────────

type Acao = 'prorrogacao' | 'resposta' | 'revogacao';

const TITULOS_ACAO: Record<Acao, string> = {
  prorrogacao: 'Registrar prorrogação do prazo',
  resposta: 'Registrar resposta do órgão',
  revogacao: 'Registrar revogação',
};

function FormularioAcao({ medida, acao, aoConcluir }: { medida: MedidaControle; acao: Acao; aoConcluir: (m: MedidaControle) => void }) {
  const { avisar } = useAvisos();
  const prorrogar = useProrrogarMedida();
  const responder = useResponderMedida();
  const revogar = useRevogarMedida();
  const hoje = hojeISO(new Date());
  const [data, definirData] = useState(acao === 'prorrogacao' ? '' : hoje);
  const [texto, definirTexto] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const minimo = acao === 'resposta' ? 20 : 10;
  const mutacao = acao === 'prorrogacao' ? prorrogar : acao === 'resposta' ? responder : revogar;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!validarDataISO(data)) return definirErro('Informe a data.');
    if (texto.trim().length < minimo) return definirErro(`Escreva pelo menos ${minimo} caracteres.`);
    definirErro(null);
    const sucesso = (m: MedidaControle) => {
      avisar({ tipo: 'sucesso', titulo: 'Registro concluído', mensagem: `${TITULOS_ACAO[acao]}: ${TIPOS_MEDIDA[m.tipo]} nº ${m.numero}.` });
      aoConcluir(m);
    };
    if (acao === 'prorrogacao') prorrogar.mutate({ id: medida.id, entrada: { prorrogadoAte: data, justificativa: texto.trim() } }, { onSuccess: sucesso });
    else if (acao === 'resposta') responder.mutate({ id: medida.id, entrada: { respondidaEm: data, texto: texto.trim() } }, { onSuccess: sucesso });
    else revogar.mutate({ id: medida.id, entrada: { revogadaEm: data, texto: texto.trim() } }, { onSuccess: sucesso });
  };

  const rotuloData = acao === 'prorrogacao' ? 'Novo prazo de resposta' : acao === 'resposta' ? 'Data da resposta' : 'Data da revogação';
  const rotuloTexto =
    acao === 'prorrogacao' ? 'Justificativa da prorrogação' : acao === 'resposta' ? 'Medidas adotadas e informações prestadas' : 'Decisão de revogação ou de mérito';
  return (
    <form className="formulario cartao" onSubmit={enviar} noValidate aria-label={TITULOS_ACAO[acao]}>
      <h3 className="secao__titulo">{TITULOS_ACAO[acao]}</h3>
      <CampoTexto
        rotulo={rotuloData}
        type="date"
        obrigatorio
        value={data}
        min={acao === 'prorrogacao' ? prazoEfetivo(medida) : medida.cienciaEm}
        max={acao === 'prorrogacao' ? undefined : hoje}
        onChange={(e) => definirData(e.target.value)}
      />
      <AreaTexto rotulo={rotuloTexto} obrigatorio rows={3} maxLength={acao === 'resposta' ? 5000 : 2000} contador value={texto} onChange={(e) => definirTexto(e.target.value)} />
      {erro ? (
        <p className="campo__erro" role="alert">
          {erro}
        </p>
      ) : null}
      <ErroOperacao erro={mutacao.error} titulo="O registro não foi concluído" />
      <div className="linha">
        <Botao type="submit" variante={acao === 'revogacao' ? 'perigo' : 'primario'} carregando={mutacao.isPending}>
          {TITULOS_ACAO[acao]}
        </Botao>
      </div>
    </form>
  );
}

function DialogoMedida({ medida, podeRegistrar, aoFechar, aoAtualizar }: { medida: MedidaControle | null; podeRegistrar: boolean; aoFechar: () => void; aoAtualizar: (m: MedidaControle) => void }) {
  const [acao, definirAcao] = useState<Acao | null>(null);
  const fechar = () => {
    definirAcao(null);
    aoFechar();
  };
  if (!medida) return <Dialogo aberto={false} aoFechar={fechar} titulo="Medida de controle" />;
  const aberta = medida.situacao !== 'revogada';
  return (
    <Dialogo
      aberto
      aoFechar={fechar}
      titulo={`${TIPOS_MEDIDA[medida.tipo]} do ${medida.orgao} nº ${medida.numero}`}
      largura="ampla"
      rodape={
        <Botao variante="secundario" onClick={fechar}>
          Fechar
        </Botao>
      }
    >
      <div className="pilha">
        {medida.bloqueia ? (
          <Alerta tipo="erro" titulo="Suspensão cautelar em vigor (RN-30)">
            <p>
              {medida.alvo.tipo === 'processo'
                ? 'O processo não avança de etapa nem gera o contrato até a revogação.'
                : 'A assinatura de termos do contrato fica bloqueada até a revogação.'}
            </p>
          </Alerta>
        ) : null}
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Órgão de controle', valor: ORGAOS_CONTROLE[medida.orgao] },
            { termo: 'Situação', valor: <span className="pilha pilha--compacta"><span>{SITUACOES_MEDIDA[medida.situacao]}</span><span className="texto-pequeno texto-secundario">{medida.explicacao}</span></span> },
            { termo: 'Atinge', valor: <Link to={medida.alvo.caminho}>{medida.alvo.identificador}</Link> },
            { termo: 'Efeito', valor: medida.efeitoSuspensivo ? 'Suspensivo' : 'Sem suspensão' },
            { termo: 'Decisão', valor: formatarData(medida.decididaEm) },
            { termo: 'Ciência', valor: formatarData(medida.cienciaEm) },
            {
              termo: 'Prazo de resposta',
              valor: (
                <span className="pilha pilha--compacta">
                  <span className="numero">
                    {formatarData(medida.prazoResposta)} ({medida.diasUteisPrazo} dias úteis)
                  </span>
                  <span className="texto-pequeno texto-secundario">{medida.fundamentoPrazo}</span>
                </span>
              ),
            },
            {
              termo: 'Prorrogação',
              valor: medida.prorrogacao ? `Até ${formatarData(medida.prorrogacao.ate)} — ${medida.prorrogacao.justificativa}` : 'Sem prorrogação',
            },
            { termo: 'Objeto', valor: medida.objeto, largo: true },
            {
              termo: 'Resposta do órgão',
              valor: medida.resposta ? `${formatarData(medida.resposta.em)}${medida.resposta.por ? `, por ${medida.resposta.por.nome}` : ''}: ${medida.resposta.texto}` : 'Ainda não registrada',
              largo: true,
            },
            ...(medida.prazoDecisaoMerito
              ? [{ termo: 'Prazo do tribunal para o mérito', valor: `${formatarData(medida.prazoDecisaoMerito.limite)} — ${medida.prazoDecisaoMerito.fundamento}`, largo: true }]
              : []),
            {
              termo: 'Revogação',
              valor: medida.revogacao ? `${formatarData(medida.revogacao.em)}${medida.revogacao.por ? `, por ${medida.revogacao.por.nome}` : ''}: ${medida.revogacao.texto}` : 'Não revogada',
              largo: true,
            },
            { termo: 'Registrada', valor: `${formatarInstante(medida.registradaEm)}${medida.registradaPor ? `, por ${medida.registradaPor.nome}` : ''}`, largo: true },
          ]}
        />
        {podeRegistrar && aberta ? (
          <div className="linha" role="group" aria-label="Registros da medida">
            {medida.resposta === null ? (
              <>
                <Botao variante={acao === 'prorrogacao' ? 'primario' : 'secundario'} onClick={() => definirAcao('prorrogacao')}>
                  Prorrogação
                </Botao>
                <Botao variante={acao === 'resposta' ? 'primario' : 'secundario'} onClick={() => definirAcao('resposta')}>
                  Resposta
                </Botao>
              </>
            ) : null}
            <Botao variante={acao === 'revogacao' ? 'primario' : 'secundario'} onClick={() => definirAcao('revogacao')}>
              Revogação
            </Botao>
          </div>
        ) : null}
        {podeRegistrar && aberta && acao ? (
          <FormularioAcao
            key={`${medida.id}-${acao}`}
            medida={medida}
            acao={acao}
            aoConcluir={(m) => {
              definirAcao(null);
              aoAtualizar(m);
            }}
          />
        ) : null}
      </div>
    </Dialogo>
  );
}

// ───────────────────────── Página ─────────────────────────

export default function ControleExterno() {
  const { temPermissao } = useSessao();
  const podeRegistrar = temPermissao('controle_externo:registrar');
  const p = useParametrosUrl();
  const filtro: FiltroMedidasControle = {
    situacao: p.opcao('situacao', SITUACOES_FILTRO),
    orgao: p.opcao('orgao', ORGAOS),
    alvo: p.opcao('alvo', ['processo', 'contrato'] as const),
    busca: p.texto('busca'),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = useMedidasControle(filtro);
  const [registrando, definirRegistrando] = useState(false);
  const [selecionada, definirSelecionada] = useState<MedidaControle | null>(null);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  return (
    <Pagina
      titulo="Controle externo"
      subtitulo="Medidas do TCU e da CGU sobre processos e contratos, com o prazo de resposta do órgão em dias úteis (Lei 14.133/2021, art. 171)."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="controle.externo"
      acoes={
        podeRegistrar ? (
          <Botao variante="primario" icone={Plus} onClick={() => definirRegistrando(true)}>
            Registrar medida
          </Botao>
        ) : null
      }
    >
      <Alerta tipo="info" titulo="Como funciona">
        <p>
          A cautelar com efeito suspensivo bloqueia o avanço do processo e a assinatura do contrato até a revogação (RN-30). Intimado da suspensão, o órgão
          tem 10 dias úteis, admitida a prorrogação, para informar as medidas adotadas e prestar as informações (art. 171, § 2º).
        </p>
      </Alerta>
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['medida', 'medidas']}
            feminino
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros das medidas de controle"
          >
            <CampoBusca rotulo="Buscar" placeholder="Número, objeto, processo ou contrato" valor={filtro.busca ?? ''} aoMudar={(v) => p.atualizar({ busca: v })} />
            <Selecao
              rotulo="Situação"
              opcaoVazia="Todas"
              opcoes={[{ valor: 'abertas', rotulo: 'Em aberto ou suspensivas' }, ...(['aguardando_resposta', 'resposta_vencida', 'respondida', 'revogada'] as const).map((s) => ({ valor: s, rotulo: SITUACOES_MEDIDA[s] }))]}
              value={filtro.situacao ?? ''}
              onChange={(e) => p.atualizar({ situacao: e.target.value })}
            />
            <Selecao rotulo="Órgão" opcaoVazia="Todos" opcoes={ORGAOS.map((o) => ({ valor: o, rotulo: o }))} value={filtro.orgao ?? ''} onChange={(e) => p.atualizar({ orgao: e.target.value })} />
            <Selecao
              rotulo="Atinge"
              opcaoVazia="Processos e contratos"
              opcoes={[
                { valor: 'processo', rotulo: 'Processos' },
                { valor: 'contrato', rotulo: 'Contratos' },
              ]}
              value={filtro.alvo ?? ''}
              onChange={(e) => p.atualizar({ alvo: e.target.value })}
            />
          </BarraFiltros>
          <Tabela
            id="medidas-controle"
            legenda="Medidas de controle externo"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(m) => m.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            destaque={(m) => (m.bloqueia || m.situacao === 'resposta_vencida' ? 'erro' : m.semaforo === 'critico' || m.semaforo === 'atencao' ? 'aviso' : undefined)}
            acoes={{
              cabecalho: 'Ações',
              celula: (m) => (
                <Botao tamanho="compacto" onClick={() => definirSelecionada(m)} aria-label={`Detalhes da medida nº ${m.numero}`}>
                  Detalhes
                </Botao>
              ),
            }}
            vazio={
              <EstadoVazio
                icone={Landmark}
                titulo={filtrosAtivos ? 'Nenhuma medida atende aos filtros' : 'Nenhuma medida registrada'}
                descricao={filtrosAtivos ? 'Revise os critérios ou limpe os filtros.' : 'As medidas do TCU e da CGU registradas aparecem aqui, com os prazos de resposta.'}
              />
            }
            rodape={
              consulta.data && consulta.data.total > 0 ? (
                <Paginacao
                  pagina={filtro.pagina ?? 1}
                  tamanhoPagina={filtro.tamanhoPagina ?? 25}
                  total={consulta.data.total}
                  aoMudarPagina={p.definirPagina}
                  aoMudarTamanho={p.definirTamanhoPagina}
                  rotulo="Paginação das medidas de controle"
                />
              ) : null
            }
          />
        </>
      )}
      {podeRegistrar ? <DialogoRegistrar aberto={registrando} aoFechar={() => definirRegistrando(false)} /> : null}
      <DialogoMedida medida={selecionada} podeRegistrar={podeRegistrar} aoFechar={() => definirSelecionada(null)} aoAtualizar={definirSelecionada} />
    </Pagina>
  );
}
