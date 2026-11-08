/**
 * Rota de contratação dentro da jornada (RF-34, RN-41, RN-42). Envolve o painel da etapa: na etapa 1 acrescenta a
 * escolha da rota; nas etapas seguintes acrescenta o que a rota exige (comprovação da inexigibilidade, aviso de
 * dispensa, adesão) e, na seleção e na gestão das rotas diretas, substitui a disputa e o contrato da licitação.
 * Tudo é decidido no servidor; a tela só mostra e envia.
 */
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { CalendarClock, FileCheck2, Gavel, Megaphone, Save, ShoppingCart, Stamp } from 'lucide-react';
import type {
  ComprovacaoInexigibilidadeProcesso,
  EtapaJornada,
  HipoteseDispensa,
  HipoteseInexigibilidade,
  ProcessoDetalhe,
  RotaContratacao,
  RotaProcesso,
} from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO, type Centavos } from '@agora/dominio';
import {
  useAceiteFornecedorAdesao,
  useAtasDisponiveisAdesao,
  useAutorizarContratacao,
  useEscolherRota,
  useJulgarDispensa,
  usePublicarAvisoDispensa,
  useRegistrarPropostaDispensa,
  useRotaProcesso,
  useSalvarInexigibilidade,
  useSolicitarAdesao,
} from '../../api/rotas-contratacao';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoBusca,
  CampoMoeda,
  CampoTexto,
  EsqueletoTexto,
  Etiqueta,
  GrupoOpcoes,
  LinkBotao,
  ListaDefinicoes,
  Selecao,
  Tabela,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { QuadroDocumentos, ROTULOS_HIPOTESE_DISPENSA, ROTULOS_HIPOTESE_INEXIGIBILIDADE, ROTULOS_ROTA, rotaDiretaPelaModalidade, SeletorFornecedor } from './componentes';

const MINIMO = 30;
const suficiente = (t: string | null | undefined) => (t ?? '').trim().length >= MINIMO;

interface PropsPainelRota {
  processo: ProcessoDetalhe;
  etapa: EtapaJornada;
  atual: boolean;
  editavel: boolean;
  /** Painel padrão da etapa (licitação). */
  children: ReactNode;
}

function porValor(rota: RotaProcesso): boolean {
  return rota.rota === 'dispensa' && (rota.hipoteseDispensa === 'valor_demais' || rota.hipoteseDispensa === 'valor_obras_engenharia');
}

function Subsecao({ id, titulo, descricao, icone, children }: { id: string; titulo: string; descricao?: ReactNode; icone?: ReactNode; children: ReactNode }) {
  return (
    <section className="secao jornada-subsecao" aria-labelledby={id}>
      <div className="secao__cabecalho">
        <div>
          <h3 id={id} className="secao__titulo">
            {icone} {titulo}
          </h3>
          {descricao ? <div className="secao__descricao">{descricao}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function Pendencias({ rota }: { rota: RotaProcesso }) {
  if (rota.pendencias.length === 0) return null;
  return (
    <Alerta tipo="aviso" compacto titulo="O que a rota ainda exige nesta etapa">
      <ul className="lista-simples">
        {rota.pendencias.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </Alerta>
  );
}

// ───────────────────────── etapa 1: escolha da rota ─────────────────────────

function EscolhaRota({ processo, rota, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; editavel: boolean }) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useEscolherRota(processo.id);
  const [escolha, definirEscolha] = useState<RotaContratacao>(rota.rota);
  const [hipotese, definirHipotese] = useState<HipoteseDispensa>(rota.hipoteseDispensa ?? 'valor_demais');
  const [inciso, definirInciso] = useState(rota.incisoDispensa ?? '');
  const [hipoteseInex, definirHipoteseInex] = useState<HipoteseInexigibilidade>(rota.hipoteseInexigibilidade ?? 'exclusividade');
  const [natureza, definirNatureza] = useState(rota.natureza ?? '');
  const [justificativa, definirJustificativa] = useState(rota.justificativa ?? '');
  const [analise, definirAnalise] = useState(rota.justificativaFracionamento ?? '');

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvar.mutate(
      {
        rota: escolha,
        hipoteseDispensa: escolha === 'dispensa' ? hipotese : null,
        incisoDispensa: escolha === 'dispensa' && hipotese === 'outra' ? inciso : null,
        hipoteseInexigibilidade: escolha === 'inexigibilidade' ? hipoteseInex : null,
        justificativa: escolha === 'licitacao' ? null : justificativa,
        natureza: escolha === 'dispensa' && hipotese !== 'outra' ? natureza : null,
        justificativaFracionamento: analise || null,
      },
      {
        onSuccess: (r) =>
          avisar({ tipo: r.pendencias.length === 0 ? 'sucesso' : 'aviso', titulo: 'Rota de contratação salva', mensagem: r.pendencias.length === 0 ? `${r.titulo}: ${r.modalidade}.` : 'Há pendências da rota nesta etapa.' }),
      },
    );
  };

  return (
    <Subsecao id={`${base}-titulo`} titulo="Rota de contratação" descricao="A rota define os documentos e as travas do processo (art. 72) e adapta as etapas seguintes." icone={<FileCheck2 size={18} aria-hidden="true" />}>
      <form className="formulario pilha" onSubmit={enviar} aria-describedby={`${base}-titulo`}>
        <GrupoOpcoes
          legenda="Como o órgão vai contratar"
          nome={`${base}-rota`}
          valor={escolha}
          aoMudar={editavel ? definirEscolha : () => undefined}
          opcoes={(Object.keys(ROTULOS_ROTA) as RotaContratacao[]).map((r) => ({ valor: r, rotulo: ROTULOS_ROTA[r].titulo, ajuda: ROTULOS_ROTA[r].ajuda }))}
        />
        {escolha === 'dispensa' ? (
          <GrupoOpcoes
            legenda="Hipótese de dispensa"
            nome={`${base}-hipotese`}
            valor={hipotese}
            aoMudar={editavel ? definirHipotese : () => undefined}
            opcoes={(Object.keys(ROTULOS_HIPOTESE_DISPENSA) as HipoteseDispensa[]).map((h) => ({ valor: h, rotulo: ROTULOS_HIPOTESE_DISPENSA[h] }))}
          />
        ) : null}
        {escolha === 'dispensa' && hipotese === 'outra' ? (
          <CampoTexto rotulo="Inciso do art. 75" ajuda='Ex.: "VIII" (emergência) ou "IV, c".' value={inciso} onChange={(e) => definirInciso(e.target.value)} disabled={!editavel} obrigatorio />
        ) : null}
        {escolha === 'dispensa' && hipotese !== 'outra' ? (
          <CampoTexto
            rotulo="Ramo de atividade do objeto"
            ajuda="Despesas do mesmo ramo no exercício são somadas para o limite da dispensa (art. 75, § 1º). Ex.: material de expediente."
            value={natureza}
            onChange={(e) => definirNatureza(e.target.value)}
            disabled={!editavel}
            obrigatorio
          />
        ) : null}
        {escolha === 'inexigibilidade' ? (
          <Selecao
            rotulo="Hipótese de inexigibilidade (art. 74)"
            obrigatorio
            value={hipoteseInex}
            onChange={(e) => definirHipoteseInex(e.target.value as HipoteseInexigibilidade)}
            disabled={!editavel}
            opcoes={(Object.keys(ROTULOS_HIPOTESE_INEXIGIBILIDADE) as HipoteseInexigibilidade[]).map((h) => ({ valor: h, rotulo: ROTULOS_HIPOTESE_INEXIGIBILIDADE[h] }))}
          />
        ) : null}
        {escolha !== 'licitacao' ? (
          <AreaTexto
            rotulo="Justificativa da escolha da rota"
            ajuda={`Mínimo de ${MINIMO} caracteres (art. 72, I e VI).`}
            value={justificativa}
            onChange={(e) => definirJustificativa(e.target.value)}
            disabled={!editavel}
            obrigatorio
            rows={3}
          />
        ) : null}
        {rota.fracionamento?.sinal === 'risco' || rota.justificativaFracionamento ? (
          <AreaTexto
            rotulo="Análise do agente sobre o indício de fracionamento"
            ajuda="A soma do mesmo ramo no exercício passou do limite. Registre por que não há fracionamento ou licite o objeto."
            value={analise}
            onChange={(e) => definirAnalise(e.target.value)}
            disabled={!editavel}
            rows={3}
          />
        ) : null}
        {editavel ? (
          <div className="jornada-barra-acoes">
            <span />
            <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending}>
              Salvar rota
            </Botao>
          </div>
        ) : null}
        <ErroOperacao erro={salvar.error} titulo="Não foi possível salvar a rota" />
      </form>
      <ResumoRota rota={rota} />
      {rota.rota === 'adesao_ata' ? <AdesaoAta processo={processo} rota={rota} editavel={editavel} /> : null}
    </Subsecao>
  );
}

function ResumoRota({ rota }: { rota: RotaProcesso }) {
  const f = rota.fracionamento;
  return (
    <div className="pilha">
      <ListaDefinicoes
        colunas={3}
        itens={[
          { termo: 'Rota', valor: rota.titulo },
          { termo: 'Modalidade', valor: rota.modalidade },
          { termo: 'Fundamento', valor: rota.fundamento },
          ...(rota.limite ? [{ termo: 'Limite da dispensa por valor', valor: <span className="numero">{`${formatarMoeda(rota.limite.valor)} (${rota.limite.norma})`}</span> }] : []),
          ...(rota.valorEstimado !== null ? [{ termo: 'Valor estimado', valor: <span className="numero">{formatarMoeda(rota.valorEstimado)}</span> }] : []),
        ]}
      />
      {f ? (
        <Alerta tipo={f.sinal === 'risco' ? 'erro' : f.sinal === 'atencao' ? 'aviso' : 'info'} compacto titulo={`Fracionamento no ramo "${f.natureza}": ${f.percentualDoLimite.toLocaleString('pt-BR')}% do limite (RIA-01)`}>
          <p>{f.explicacao}</p>
        </Alerta>
      ) : null}
      <Pendencias rota={rota} />
      <QuadroDocumentos documentos={rota.documentos} titulo="Documentos e travas da rota (art. 72)" />
    </div>
  );
}

// ───────────────────────── adesão a ata (etapa 1 e 5) ─────────────────────────

function AdesaoAta({ processo, rota, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; editavel: boolean }) {
  const base = useId();
  const { avisar } = useAvisos();
  const [busca, definirBusca] = useState('');
  const atas = useAtasDisponiveisAdesao(processo.id, busca, editavel);
  const solicitar = useSolicitarAdesao(processo.id);
  const [itemId, definirItemId] = useState('');
  const [quantidade, definirQuantidade] = useState('');
  const [justificativa, definirJustificativa] = useState(rota.adesao?.justificativaVantagem ?? '');
  const itens = (atas.data ?? []).flatMap((a) => a.itens.map((i) => ({ ata: a, item: i })));
  const escolhido = itens.find((x) => x.item.id === itemId) ?? null;
  const a = rota.adesao;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!escolhido) return;
    solicitar.mutate(
      { ataId: escolhido.ata.id, itemId: escolhido.item.id, quantidade: Number(quantidade), justificativaVantagem: justificativa },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Adesão solicitada', mensagem: 'Registre o aceite do fornecedor e aguarde a anuência do gerenciador.' }) },
    );
  };

  return (
    <div className="pilha">
      <h4 id={`${base}-adesao`} className="secao__titulo">
        Adesão à ata (art. 86, §§ 2º a 5º)
      </h4>
      {a ? (
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Ata', valor: `${a.ata.numero} — UASG ${a.ata.uasg}` },
            { termo: 'Item', valor: `${a.item.numero}. ${a.item.descricao}` },
            { termo: 'Fornecedor', valor: a.fornecedor.nome },
            { termo: 'Quantidade', valor: <span className="numero">{`${a.quantidade} de ${a.limites.limitePorOrgao} possíveis por órgão`}</span> },
            { termo: 'Valor', valor: <span className="numero">{formatarMoeda(a.valorTotal)}</span> },
            { termo: 'Situação', valor: <Etiqueta tom={a.situacao === 'autorizada' ? 'sucesso' : a.situacao === 'recusada' ? 'erro' : 'aviso'}>{ROTULOS_ADESAO[a.situacao]}</Etiqueta> },
          ]}
        />
      ) : null}
      {editavel && (!a || a.situacao === 'solicitada' || a.situacao === 'recusada') ? (
        <form className="formulario pilha" onSubmit={enviar} aria-labelledby={`${base}-adesao`}>
          <CampoBusca rotulo="Buscar ata ou item" valor={busca} aoMudar={definirBusca} />
          <Selecao
            rotulo="Item da ata"
            obrigatorio
            opcaoVazia="Selecione…"
            value={itemId}
            onChange={(e) => definirItemId(e.target.value)}
            opcoes={itens.map(({ ata, item }) => ({
              valor: item.id,
              rotulo: `Ata ${ata.numero} (UASG ${ata.uasg}) — item ${item.numero}: ${item.descricao} — ${formatarMoeda(item.valorUnitario)}/${item.unidade} — até ${Math.min(item.saldoOrgao, item.saldoTotal)}`,
            }))}
          />
          {escolhido ? (
            <p className="texto-pequeno texto-secundario">
              Registrado: {escolhido.item.quantidadeRegistrada}. Limite por órgão (50%): {escolhido.item.limitePorOrgao}, saldo {escolhido.item.saldoOrgao}. Limite total (dobro):{' '}
              {escolhido.item.limiteTotal}, saldo {escolhido.item.saldoTotal}.
            </p>
          ) : null}
          <CampoTexto rotulo="Quantidade a aderir" type="number" min={1} inputMode="numeric" value={quantidade} onChange={(e) => definirQuantidade(e.target.value)} obrigatorio />
          <AreaTexto rotulo="Justificativa da vantagem da adesão" ajuda={`Mínimo de ${MINIMO} caracteres (art. 86, § 2º, I).`} value={justificativa} onChange={(e) => definirJustificativa(e.target.value)} rows={3} obrigatorio />
          <div className="jornada-barra-acoes">
            <span />
            <Botao variante="primario" type="submit" icone={Stamp} carregando={solicitar.isPending} disabled={!escolhido || !suficiente(justificativa) || !(Number(quantidade) > 0)}>
              Solicitar adesão
            </Botao>
          </div>
          <ErroOperacao erro={solicitar.error} titulo="A adesão foi recusada" />
        </form>
      ) : null}
    </div>
  );
}

const ROTULOS_ADESAO = { solicitada: 'Solicitada', aceita_fornecedor: 'Aceita pelo fornecedor', autorizada: 'Autorizada pelo gerenciador', recusada: 'Recusada' } as const;

function AceiteAdesao({ processo, rota, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; editavel: boolean }) {
  const base = useId();
  const aceite = useAceiteFornecedorAdesao(processo.id);
  const [data, definirData] = useState(hojeISO(new Date()));
  const a = rota.adesao;
  if (!a) return null;
  return (
    <Subsecao id={`${base}-titulo`} titulo="Aceite do fornecedor e anuência do gerenciador" descricao="O gerenciador só autoriza depois do aceite do fornecedor (Decreto 11.462/2023, art. 31, § 1º).">
      <ListaDefinicoes
        colunas={3}
        itens={[
          { termo: 'Situação', valor: <Etiqueta tom={a.situacao === 'autorizada' ? 'sucesso' : a.situacao === 'recusada' ? 'erro' : 'aviso'}>{ROTULOS_ADESAO[a.situacao]}</Etiqueta> },
          { termo: 'Aceite do fornecedor', valor: a.aceiteFornecedorEm ? formatarData(a.aceiteFornecedorEm) : 'Pendente' },
          { termo: 'Anuência', valor: a.anuenciaEm ? `${formatarData(a.anuenciaEm)} — ${a.anuenciaPor?.nome ?? ''}` : 'Pendente' },
          ...(a.limiteContratacao ? [{ termo: 'Contratar até', valor: formatarData(a.limiteContratacao) }] : []),
          ...(a.motivoRecusa ? [{ termo: 'Motivo da recusa', valor: a.motivoRecusa, largo: true }] : []),
        ]}
      />
      {editavel && a.situacao === 'solicitada' ? (
        <div className="linha">
          <CampoTexto rotulo="Data do aceite" type="date" value={data} onChange={(e) => definirData(e.target.value)} />
          <Botao variante="primario" onClick={() => aceite.mutate({ data })} carregando={aceite.isPending}>
            Registrar aceite do fornecedor
          </Botao>
        </div>
      ) : null}
      <ErroOperacao erro={aceite.error} />
    </Subsecao>
  );
}

// ───────────────────────── inexigibilidade (etapas 4 e 5) ─────────────────────────

function ComprovacaoInexigibilidade({ processo, rota, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; editavel: boolean }) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarInexigibilidade(processo.id);
  const atual = rota.inexigibilidade;
  const [c, definir] = useState<Omit<ComprovacaoInexigibilidadeProcesso, 'hipotese'>>(() => ({ ...atual, justificativaInviabilidade: atual?.justificativaInviabilidade ?? '' }));
  if (!atual) return null;
  const mudar = (parte: Partial<typeof c>) => definir((x) => ({ ...x, ...parte }));
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    salvar.mutate(c, { onSuccess: (r) => avisar({ tipo: r.inexigibilidade?.pendencias.length ? 'aviso' : 'sucesso', titulo: 'Comprovação salva', mensagem: r.inexigibilidade?.pendencias.length ? 'Ainda há elementos pendentes.' : 'A comprovação está completa.' }) });
  };
  return (
    <Subsecao id={`${base}-titulo`} titulo={`Comprovação da inexigibilidade — ${ROTULOS_HIPOTESE_INEXIGIBILIDADE[atual.hipotese]}`} descricao="A conclusão sobre a inexigibilidade é do agente e do parecer jurídico; a tela só confere os elementos exigidos.">
      <form className="formulario pilha" onSubmit={enviar}>
        <AreaTexto rotulo="Inviabilidade de competição" obrigatorio rows={3} value={c.justificativaInviabilidade ?? ''} onChange={(e) => mudar({ justificativaInviabilidade: e.target.value })} disabled={!editavel} />
        {atual.hipotese === 'exclusividade' ? (
          <>
            <Selecao
              rotulo="Documento de exclusividade"
              opcaoVazia="Selecione…"
              value={c.documentoExclusividade ?? ''}
              onChange={(e) => mudar({ documentoExclusividade: (e.target.value || null) as typeof c.documentoExclusividade })}
              disabled={!editavel}
              opcoes={[
                { valor: 'atestado', rotulo: 'Atestado' },
                { valor: 'contrato', rotulo: 'Contrato' },
                { valor: 'declaracao', rotulo: 'Declaração' },
                { valor: 'carta_exclusividade', rotulo: 'Carta de exclusividade' },
                { valor: 'outro', rotulo: 'Outro documento idôneo' },
              ]}
            />
            <CaixaSelecao rotulo="A especificação não indica preferência por marca (art. 74, § 1º)" checked={c.semPreferenciaMarca === true} onChange={(e) => mudar({ semPreferenciaMarca: e.target.checked })} disabled={!editavel} />
          </>
        ) : null}
        {atual.hipotese === 'artista' ? (
          <>
            <AreaTexto rotulo="Consagração pela crítica ou pela opinião pública" rows={2} value={c.consagracao ?? ''} onChange={(e) => mudar({ consagracao: e.target.value })} disabled={!editavel} />
            <CaixaSelecao rotulo="Contratação por empresário" checked={c.porEmpresario === true} onChange={(e) => mudar({ porEmpresario: e.target.checked })} disabled={!editavel} />
            <CaixaSelecao rotulo="Exclusividade permanente e contínua do empresário (art. 74, § 2º)" checked={c.exclusividadePermanente === true} onChange={(e) => mudar({ exclusividadePermanente: e.target.checked })} disabled={!editavel} />
          </>
        ) : null}
        {atual.hipotese === 'notoria_especializacao' ? (
          <>
            <CampoTexto rotulo='Alínea do art. 74, III ("a" a "h")' value={c.alinea ?? ''} onChange={(e) => mudar({ alinea: e.target.value })} disabled={!editavel} />
            <AreaTexto rotulo="Elementos da notória especialização (art. 74, § 3º)" rows={3} value={c.elementosNotoriaEspecializacao ?? ''} onChange={(e) => mudar({ elementosNotoriaEspecializacao: e.target.value })} disabled={!editavel} />
            <CaixaSelecao rotulo="O serviço é de publicidade ou divulgação (vedado)" checked={c.publicidade === true} onChange={(e) => mudar({ publicidade: e.target.checked })} disabled={!editavel} />
          </>
        ) : null}
        {atual.hipotese === 'credenciamento' ? (
          <CampoTexto rotulo="Edital de chamamento do credenciamento" value={c.editalChamamento ?? ''} onChange={(e) => mudar({ editalChamamento: e.target.value })} disabled={!editavel} />
        ) : null}
        {atual.hipotese === 'imovel' ? (
          <>
            <CaixaSelecao rotulo="Avaliação prévia do imóvel registrada (art. 74, § 5º, I)" checked={c.avaliacaoPrevia === true} onChange={(e) => mudar({ avaliacaoPrevia: e.target.checked })} disabled={!editavel} />
            <CaixaSelecao rotulo="Não há imóvel público vago e disponível (art. 74, § 5º, II)" checked={c.semImovelPublicoDisponivel === true} onChange={(e) => mudar({ semImovelPublicoDisponivel: e.target.checked })} disabled={!editavel} />
            <AreaTexto rotulo="Singularidade do imóvel e vantagem (art. 74, § 5º, III)" rows={3} value={c.justificativaSingularidade ?? ''} onChange={(e) => mudar({ justificativaSingularidade: e.target.value })} disabled={!editavel} />
          </>
        ) : null}
        {atual.pendencias.length > 0 ? (
          <Alerta tipo="aviso" compacto titulo="Elementos pendentes">
            <ul className="lista-simples">
              {atual.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Alerta>
        ) : (
          <Alerta tipo="sucesso" compacto titulo="Comprovação completa" />
        )}
        {editavel ? (
          <div className="jornada-barra-acoes">
            <span />
            <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending}>
              Salvar comprovação
            </Botao>
          </div>
        ) : null}
        <ErroOperacao erro={salvar.error} />
      </form>
    </Subsecao>
  );
}

// ───────────────────────── dispensa eletrônica (etapas 5 e 6, RN-41) ─────────────────────────

function AvisoDispensa({ processo, rota, atual, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; atual: boolean; editavel: boolean }) {
  const base = useId();
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const publicar = usePublicarAvisoDispensa(processo.id);
  const proposta = useRegistrarPropostaDispensa(processo.id);
  const [fornecedorId, definirFornecedor] = useState('');
  const [valor, definirValor] = useState<Centavos | null>(null);
  const aviso = rota.aviso;
  const parecerOk = processo.parecer.conclusao === 'favoravel' || processo.parecer.conclusao === 'favoravel_com_ressalvas';
  const podePublicar = atual && temPermissao('jornada:publicar') && !aviso;
  const recebeProposta = atual && editavel && processo.etapaAtual === 5 && !(aviso?.situacao === 'publicado' && !aviso.aberto);

  return (
    <Subsecao
      id={`${base}-titulo`}
      titulo="Aviso de dispensa eletrônica"
      icone={<Megaphone size={18} aria-hidden="true" />}
      descricao="Divulgado no PNCP por no mínimo 3 dias úteis, com a manifestação de interesse em propostas adicionais; ao final, seleciona-se a proposta mais vantajosa (art. 75, § 3º)."
    >
      <div className="jornada-prazo" aria-live="polite">
        {aviso?.situacao === 'publicado' && aviso.encerramento ? (
          <>
            <p className="jornada-prazo__data">
              Propostas adicionais até <strong className="numero">{formatarData(aviso.encerramento)}</strong>
            </p>
            <Etiqueta tom={aviso.aberto ? 'aviso' : 'sucesso'} icone={CalendarClock}>
              {aviso.aberto ? (aviso.diasUteisRestantes === 0 ? 'Último dia do aviso' : `Faltam ${aviso.diasUteisRestantes} dia(s) útil(eis)`) : 'Aviso encerrado'}
            </Etiqueta>
          </>
        ) : aviso ? (
          <p>{aviso.mensagem}</p>
        ) : rota.previaEncerramentoAviso ? (
          <p>
            Se publicado hoje, o aviso fica aberto até <strong className="numero">{formatarData(rota.previaEncerramentoAviso)}</strong> (3 dias úteis — art. 75, § 3º).
          </p>
        ) : null}
      </div>
      {aviso ? (
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Publicado em', valor: aviso.publicadoEm ? formatarData(aviso.publicadoEm) : 'Na fila do PNCP' },
            { termo: 'Número de controle PNCP', valor: aviso.numeroControle ? <span className="mono">{aviso.numeroControle}</span> : '—' },
            { termo: 'Protocolo', valor: aviso.protocolo ? <span className="mono">{aviso.protocolo}</span> : '—' },
            ...(aviso.modo === 'offline' ? [{ termo: 'Modo', valor: 'Simulação (integrações offline)' }] : []),
            ...(aviso.ultimoErro ? [{ termo: 'Último erro', valor: aviso.ultimoErro, largo: true }] : []),
          ]}
        />
      ) : null}
      {podePublicar ? (
        <div className="jornada-barra-acoes">
          <p className="texto-pequeno texto-secundario">{parecerOk ? 'O envio é feito pela fila de integrações do servidor.' : 'A publicação é liberada após o parecer jurídico favorável.'}</p>
          <Botao
            variante="primario"
            icone={Megaphone}
            disabled={!parecerOk}
            carregando={publicar.isPending}
            onClick={() => publicar.mutate(undefined, { onSuccess: (r) => avisar({ tipo: 'sucesso', titulo: 'Aviso publicado', mensagem: r.aviso?.mensagem ?? 'Aviso enviado ao PNCP.' }) })}
          >
            Publicar aviso no PNCP
          </Botao>
        </div>
      ) : null}
      <ErroOperacao erro={publicar.error} titulo="O aviso não foi publicado" />
      <TabelaPropostas rota={rota} />
      {recebeProposta ? (
        <form
          className="formulario pilha"
          aria-label="Registrar proposta"
          onSubmit={(e) => {
            e.preventDefault();
            if (!fornecedorId || valor === null) return;
            proposta.mutate({ fornecedorId, valor }, { onSuccess: () => { definirValor(null); avisar({ tipo: 'sucesso', titulo: 'Proposta registrada', mensagem: 'A proposta entra no julgamento depois do encerramento do aviso.' }); } });
          }}
        >
          <h4 className="secao__titulo">{aviso?.situacao === 'publicado' ? 'Registrar proposta adicional recebida no aviso' : 'Registrar proposta inicial (antes do aviso)'}</h4>
          <div className="grade grade--2">
            <SeletorFornecedor valor={fornecedorId} aoMudar={definirFornecedor} obrigatorio />
            <CampoMoeda rotulo="Valor total da proposta" valor={valor} aoMudar={definirValor} obrigatorio />
          </div>
          <div className="jornada-barra-acoes">
            <span />
            <Botao type="submit" variante="secundario" carregando={proposta.isPending} disabled={!fornecedorId || valor === null}>
              Registrar proposta
            </Botao>
          </div>
          <ErroOperacao erro={proposta.error} titulo="A proposta não foi registrada" />
        </form>
      ) : null}
    </Subsecao>
  );
}

function TabelaPropostas({ rota }: { rota: RotaProcesso }) {
  return (
    <Tabela
      id="rota-propostas"
      legenda="Propostas da dispensa"
      semFerramentas
      linhas={rota.propostas}
      chave={(p) => p.id}
      vazio="Nenhuma proposta registrada."
      destaque={(p) => (p.posicao === 1 ? 'sucesso' : p.motivoDesclassificacao ? 'erro' : undefined)}
      colunas={[
        { id: 'posicao', cabecalho: 'Posição', celula: (p) => (p.posicao ? `${p.posicao}º` : p.motivoDesclassificacao ? 'Desclassificada' : '—'), prioritaria: true },
        { id: 'fornecedor', cabecalho: 'Fornecedor', celula: (p) => p.fornecedor.nome, prioritaria: true, identificadora: true },
        { id: 'valor', cabecalho: 'Valor', celula: (p) => <span className="numero">{formatarMoeda(p.valor)}</span>, alinhamento: 'fim', prioritaria: true },
        { id: 'tipo', cabecalho: 'Recebida', celula: (p) => `${p.adicional ? 'Adicional, no aviso' : 'Inicial'} — ${formatarInstante(p.recebidaEm)}` },
        { id: 'motivo', cabecalho: 'Observação', celula: (p) => p.motivoDesclassificacao ?? '' },
      ]}
    />
  );
}

// ───────────────────────── etapa 6: seleção nas rotas diretas ─────────────────────────

function AutorizacaoContratacao({ processo, rota, atual }: { processo: ProcessoDetalhe; rota: RotaProcesso; atual: boolean }) {
  const base = useId();
  const { avisar } = useAvisos();
  const { temPermissao, usuario } = useSessao();
  const autorizar = useAutorizarContratacao(processo.id);
  const autoridade = temPermissao('jornada:homologar') && processo.equipe.some((e) => e.papel === 'autoridade_competente' && e.usuario.id === usuario?.id);
  const classificadas = rota.propostas.filter((p) => p.posicao !== null).sort((a, b) => (a.posicao ?? 0) - (b.posicao ?? 0));
  const fixo = porValor(rota) ? (classificadas[0]?.fornecedor.id ?? '') : rota.rota === 'adesao_ata' ? (rota.adesao?.fornecedor.id ?? '') : '';
  const [fornecedorId, definirFornecedor] = useState(fixo);
  const [valor, definirValor] = useState<Centavos | null>(null);
  const [razao, definirRazao] = useState('');
  const [preco, definirPreco] = useState('');
  const [habilitacao, definirHabilitacao] = useState(false);
  const a = rota.autorizacao;
  const precisaValor = !porValor(rota) && rota.rota !== 'adesao_ata';

  if (a) {
    return (
      <Subsecao id={`${base}-titulo`} titulo="Contratação autorizada" icone={<Gavel size={18} aria-hidden="true" />}>
        <ListaDefinicoes
          colunas={3}
          itens={[
            { termo: 'Contratado', valor: a.fornecedor.nome },
            { termo: 'Valor', valor: <span className="numero">{formatarMoeda(a.valor)}</span> },
            { termo: 'Autorizada em', valor: `${formatarData(a.data)} — ${a.por.nome}` },
            { termo: 'Razão da escolha', valor: a.razaoEscolha, largo: true },
            { termo: 'Justificativa de preço', valor: a.justificativaPreco, largo: true },
          ]}
        />
      </Subsecao>
    );
  }
  return (
    <Subsecao
      id={`${base}-titulo`}
      titulo="Autorização da contratação pela autoridade competente"
      icone={<Gavel size={18} aria-hidden="true" />}
      descricao="Razão da escolha do contratado, justificativa de preço e comprovação da habilitação (art. 72, V a VIII)."
    >
      {!atual ? null : !autoridade ? (
        <p className="texto-pequeno texto-secundario">A autorização é da autoridade competente designada na equipe do processo.</p>
      ) : (
        <form
          className="formulario pilha"
          onSubmit={(e) => {
            e.preventDefault();
            autorizar.mutate(
              { fornecedorId, valor: precisaValor ? valor : null, razaoEscolha: razao, justificativaPreco: preco, habilitacaoVerificada: habilitacao },
              { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Contratação autorizada', mensagem: 'Avance para a etapa 7 para gerar o contrato.' }) },
            );
          }}
        >
          {porValor(rota) ? (
            <Selecao
              rotulo="Proposta selecionada"
              obrigatorio
              value={fornecedorId}
              onChange={(e) => definirFornecedor(e.target.value)}
              opcoes={classificadas.map((p) => ({ valor: p.fornecedor.id, rotulo: `${p.posicao}º — ${p.fornecedor.nome} — ${formatarMoeda(p.valor)}` }))}
            />
          ) : rota.rota === 'adesao_ata' ? (
            <p>
              Contratado: <strong>{rota.adesao?.fornecedor.nome ?? '—'}</strong> (fornecedor do item da ata), valor{' '}
              <span className="numero">{rota.adesao ? formatarMoeda(rota.adesao.valorTotal) : '—'}</span>.
            </p>
          ) : (
            <div className="grade grade--2">
              <SeletorFornecedor valor={fornecedorId} aoMudar={definirFornecedor} rotulo="Contratado" obrigatorio />
              <CampoMoeda rotulo="Valor da contratação" valor={valor} aoMudar={definirValor} obrigatorio />
            </div>
          )}
          <AreaTexto rotulo="Razão da escolha do contratado" ajuda={`Mínimo de ${MINIMO} caracteres (art. 72, VI).`} rows={2} value={razao} onChange={(e) => definirRazao(e.target.value)} obrigatorio />
          <AreaTexto rotulo="Justificativa de preço" ajuda={`Mínimo de ${MINIMO} caracteres (art. 72, VII).`} rows={2} value={preco} onChange={(e) => definirPreco(e.target.value)} obrigatorio />
          <CaixaSelecao rotulo="Verifiquei que o contratado preenche os requisitos de habilitação (art. 72, V)" checked={habilitacao} onChange={(e) => definirHabilitacao(e.target.checked)} />
          <div className="jornada-barra-acoes">
            <span />
            <Botao
              type="submit"
              variante="primario"
              icone={Stamp}
              carregando={autorizar.isPending}
              disabled={!fornecedorId || !suficiente(razao) || !suficiente(preco) || !habilitacao || (precisaValor && valor === null)}
            >
              Autorizar contratação
            </Botao>
          </div>
          <ErroOperacao erro={autorizar.error} titulo="A contratação não foi autorizada" />
        </form>
      )}
    </Subsecao>
  );
}

function SelecaoRotaDireta({ processo, rota, atual, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; atual: boolean; editavel: boolean }) {
  const base = useId();
  const julgar = useJulgarDispensa(processo.id);
  const { avisar } = useAvisos();
  if (rota.rota === 'sicx') return <ComprasSicxDoProcesso processo={processo} rota={rota} atual={atual} editavel={editavel} />;
  return (
    <div className="pilha pilha--ampla">
      <Pendencias rota={rota} />
      {porValor(rota) ? (
        <Subsecao id={`${base}-julgamento`} titulo="Julgamento das propostas do aviso" descricao="Menor preço dentro do limite da dispensa; no empate, a proposta recebida primeiro.">
          <TabelaPropostas rota={rota} />
          {atual && editavel && !rota.julgadoEm ? (
            <div className="jornada-barra-acoes">
              <span />
              <Botao variante="primario" onClick={() => julgar.mutate(undefined, { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Propostas julgadas', mensagem: 'A proposta mais vantajosa está em 1º lugar.' }) })} carregando={julgar.isPending}>
                Julgar propostas
              </Botao>
            </div>
          ) : rota.julgadoEm ? (
            <p className="texto-pequeno texto-secundario">Julgado em {formatarInstante(rota.julgadoEm)}.</p>
          ) : null}
          <ErroOperacao erro={julgar.error} titulo="O julgamento não foi concluído" />
        </Subsecao>
      ) : null}
      {(!porValor(rota) || rota.julgadoEm) ? <AutorizacaoContratacao processo={processo} rota={rota} atual={atual} /> : null}
    </div>
  );
}

function ComprasSicxDoProcesso({ processo, rota, atual, editavel }: { processo: ProcessoDetalhe; rota: RotaProcesso; atual: boolean; editavel: boolean }) {
  const base = useId();
  return (
    <Subsecao id={`${base}-titulo`} titulo="Compra pelo Sicx" icone={<ShoppingCart size={18} aria-hidden="true" />} descricao="A conclusão da compra na plataforma é a contratação (Decreto 13.106/2026, art. 21).">
      <Pendencias rota={rota} />
      <Tabela
        id="rota-compras-sicx"
        legenda="Compras do processo no Sicx"
        semFerramentas
        linhas={rota.comprasSicx}
        chave={(c) => c.id}
        vazio="Nenhuma compra emitida para este processo."
        colunas={[
          { id: 'numero', cabecalho: 'Compra', celula: (c) => <span className="mono">{c.numero}</span>, identificadora: true, prioritaria: true },
          { id: 'item', cabecalho: 'Item', celula: (c) => `${c.item.descricao} × ${c.quantidade}`, prioritaria: true },
          { id: 'fornecedor', cabecalho: 'Fornecedor', celula: (c) => c.fornecedor.nome },
          { id: 'valor', cabecalho: 'Total', celula: (c) => <span className="numero">{formatarMoeda(c.valorTotal)}</span>, alinhamento: 'fim' },
          { id: 'situacao', cabecalho: 'Situação', celula: (c) => (c.situacao === 'concluida' ? (c.prazos?.mensagem ?? 'Concluída') : 'Ordem emitida, aguardando conclusão') },
        ]}
      />
      {atual && editavel && processo.etapaAtual === 6 ? (
        <div className="jornada-barra-acoes">
          <span />
          <LinkBotao to={`/sicx?uasg=${encodeURIComponent(rota.uasg)}&processo=${encodeURIComponent(processo.id)}`} variante="primario" icone={ShoppingCart}>
            Comprar na vitrine do Sicx
          </LinkBotao>
        </div>
      ) : null}
    </Subsecao>
  );
}

// ───────────────────────── painel ─────────────────────────

export default function PainelRota({ processo, etapa, atual, editavel, children }: PropsPainelRota) {
  // Na licitação só a etapa 1 consulta a rota (para a escolha); nas rotas diretas, todas as etapas.
  const precisaRota = etapa === 1 || rotaDiretaPelaModalidade(processo.modalidadePrevista);
  const consulta = useRotaProcesso(processo.id, precisaRota);
  const rota = precisaRota ? (consulta.data ?? null) : null;
  const direta = rota !== null && rota.rota !== 'licitacao';
  // Na seleção e na gestão a rota pode substituir o painel da licitação: espera a rota para não piscar a outra tela.
  const aguardando = precisaRota && rota === null && consulta.isLoading && (etapa === 6 || etapa === 7);
  const substitui = direta && (etapa === 6 || (etapa === 7 && rota.rota === 'sicx'));

  let principal: ReactNode = children;
  if (aguardando) principal = <EsqueletoTexto linhas={6} />;
  else if (rota && substitui && etapa === 6) principal = <SelecaoRotaDireta processo={processo} rota={rota} atual={atual} editavel={editavel} />;
  else if (rota && substitui) principal = <ComprasSicxDoProcesso processo={processo} rota={rota} atual={atual} editavel={editavel} />;

  // Posições fixas: o painel da etapa fica sempre no mesmo lugar e não é remontado quando a rota chega do servidor.
  return (
    <>
      {direta && rota ? (
        <p className="linha">
          <Etiqueta tom="info" icone={FileCheck2}>
            Rota: {rota.titulo}
          </Etiqueta>
          <span className="texto-pequeno texto-secundario">{rota.modalidade}</span>
        </p>
      ) : null}
      {direta && rota && etapa === 4 && rota.exigencias.edital === 'nao_se_aplica' ? (
        <Alerta tipo="info" compacto titulo="Documentos desta rota">
          <p>
            Nesta rota não há edital{rota.exigencias.termoReferencia === 'nao_se_aplica' ? ' nem termo de referência próprio' : ''}
            {rota.exigencias.minutaContrato !== 'obrigatorio' ? '; a minuta do contrato é facultativa (art. 95)' : ''}. Gere e aprove só os documentos exigidos.
          </p>
        </Alerta>
      ) : null}
      {principal}
      {rota && etapa === 1 ? (
        <EscolhaRota key={`${rota.rota}-${rota.escolhidaEm ?? ''}`} processo={processo} rota={rota} editavel={editavel && etapa === processo.etapaAtual} />
      ) : null}
      {direta && rota && (etapa === 4 || etapa === 5) && rota.rota === 'inexigibilidade' ? <ComprovacaoInexigibilidade processo={processo} rota={rota} editavel={editavel} /> : null}
      {direta && rota && etapa === 5 && porValor(rota) ? <AvisoDispensa processo={processo} rota={rota} atual={atual} editavel={editavel} /> : null}
      {direta && rota && etapa === 5 && rota.rota === 'adesao_ata' ? <AceiteAdesao processo={processo} rota={rota} editavel={editavel} /> : null}
      {direta && rota && etapa === 7 && (rota.rota === 'dispensa' || rota.rota === 'inexigibilidade') ? (
        <p className="texto-pequeno texto-secundario">Contratação direta: divulgue o contrato no PNCP em até 10 dias úteis da assinatura (art. 94, II).</p>
      ) : null}
      {direta && rota && etapa === 7 && rota.rota === 'sicx' ? (
        <p className="texto-pequeno texto-secundario">
          O recebimento e o pagamento são acompanhados na <Link to={`/sicx?uasg=${encodeURIComponent(rota.uasg)}`}>vitrine do Sicx</Link>.
        </p>
      ) : null}
    </>
  );
}
