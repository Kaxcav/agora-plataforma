/**
 * Plano de contratações anual (Lei 14.133/2021, art. 12, VII e § 1º; Decreto 10.947/2022 — RF-31): as unidades
 * registram as demandas de cada UASG e exercício, o planejamento consolida as de mesma natureza, a autoridade competente
 * aprova (ou devolve para ajustes) e o plano aprovado vai ao PNCP pela fila de integrações do servidor. O servidor decide
 * perfil, escopo de UASG e segregação entre quem consolida e quem aprova; a tela só esconde o que ele negaria.
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import { CalendarRange, CheckCheck, ClipboardList, FilePlus2, Layers, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import type {
  CategoriaPca,
  DemandaPlanoContratacoes,
  EntradaDemandaPca,
  ItemPlanoContratacoes,
  PlanoContratacoesDetalhe,
  PrioridadeDemandaPca,
  ResumoPlanoContratacoes,
  TipoItemCatalogo,
} from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO, validarDataISO } from '@agora/dominio';
import {
  useAcaoPlano,
  useCriarPlano,
  useDevolverPlano,
  usePlanoContratacoes,
  usePlanosContratacoes,
  useRegistrarDemanda,
  useRemoverDemanda,
} from '../../api/planejamento';
import {
  Alerta,
  AreaTexto,
  Botao,
  CampoMoeda,
  CampoTexto,
  ConfirmarAcao,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  ListaDefinicoes,
  Pagina,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { ErroFormulario, focarPrimeiroInvalido, ResumoErros } from '../ajustes/ErroFormulario';
import { opcoesDe } from '../compartilhado/rotulos';
import { CATEGORIAS_PCA, PRIORIDADES_PCA, rotuloCodigo, SITUACOES_PCA, SITUACOES_PUBLICACAO_PCA, TIPOS_CATALOGO } from './comum';

const COLUNAS_PLANOS: readonly ColunaTabela<ResumoPlanoContratacoes>[] = [
  {
    id: 'plano',
    cabecalho: 'Plano',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (p) => `${p.ano}-${p.uasg}`,
    celula: (p) => (
      <span className="pilha pilha--compacta">
        <strong>
          PCA {p.ano} · UASG {p.uasg}
        </strong>
        <span className="texto-pequeno texto-secundario">{p.uasgNome}</span>
      </span>
    ),
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    ordenavel: true,
    valorOrdenacao: (p) => SITUACOES_PCA[p.situacao].rotulo,
    celula: (p) => (
      <Etiqueta tom={SITUACOES_PCA[p.situacao].tom} compacta>
        {SITUACOES_PCA[p.situacao].rotulo}
      </Etiqueta>
    ),
  },
  { id: 'demandas', cabecalho: 'Demandas', alinhamento: 'fim', celula: (p) => <span className="numero">{p.demandas}</span> },
  { id: 'itens', cabecalho: 'Itens', alinhamento: 'fim', celula: (p) => <span className="numero">{p.itens}</span> },
  {
    id: 'valor',
    cabecalho: 'Valor estimado',
    alinhamento: 'fim',
    ordenavel: true,
    valorOrdenacao: (p) => p.valorTotal,
    celula: (p) => <span className="numero">{formatarMoeda(p.valorTotal)}</span>,
  },
  {
    id: 'pncp',
    cabecalho: 'PNCP',
    celula: (p) => (p.publicacao?.idPncp ? <span className="mono texto-pequeno">{p.publicacao.idPncp}</span> : <span className="texto-secundario">—</span>),
  },
];

const COLUNAS_ITENS: readonly ColunaTabela<ItemPlanoContratacoes>[] = [
  { id: 'item', cabecalho: 'Item', identificadora: true, fixa: true, celula: (i) => <span className="mono">{i.identificador}</span> },
  {
    id: 'descricao',
    cabecalho: 'Descrição',
    prioritaria: true,
    celula: (i) => (
      <span className="pilha pilha--compacta">
        <span>{i.descricao}</span>
        <span className="texto-pequeno texto-secundario">
          {rotuloCodigo(i.codigoCatalogo, i.tipoCatalogo)} · {CATEGORIAS_PCA[i.categoria]}
        </span>
      </span>
    ),
  },
  {
    id: 'quantidade',
    cabecalho: 'Quantidade',
    alinhamento: 'fim',
    celula: (i) => (
      <span className="numero">
        {formatarNumero(i.quantidade)} {i.unidadeFornecimento}
      </span>
    ),
  },
  { id: 'valor', cabecalho: 'Valor total', alinhamento: 'fim', celula: (i) => <span className="numero">{formatarMoeda(i.valorTotal)}</span> },
  { id: 'data', cabecalho: 'Data desejada', celula: (i) => <span className="numero">{formatarData(i.dataDesejada)}</span> },
  {
    id: 'prioridade',
    cabecalho: 'Prioridade',
    celula: (i) => (
      <Etiqueta tom={PRIORIDADES_PCA[i.prioridade].tom} compacta>
        {PRIORIDADES_PCA[i.prioridade].rotulo}
      </Etiqueta>
    ),
  },
  {
    id: 'unidades',
    cabecalho: 'Unidades requisitantes',
    celula: (i) => (
      <span className="texto-pequeno">
        {i.unidadesRequisitantes.join('; ')}
        {i.demandas > 1 ? ` (${i.demandas} demandas agregadas)` : ''}
      </span>
    ),
  },
];

function colunasDemandas(): readonly ColunaTabela<DemandaPlanoContratacoes>[] {
  return [
    {
      id: 'descricao',
      cabecalho: 'Demanda',
      identificadora: true,
      fixa: true,
      celula: (d) => (
        <span className="pilha pilha--compacta">
          <span>{d.descricao}</span>
          <span className="texto-pequeno texto-secundario">
            {d.unidadeRequisitante} · {rotuloCodigo(d.codigoCatalogo, d.tipoCatalogo)}
          </span>
        </span>
      ),
    },
    {
      id: 'quantidade',
      cabecalho: 'Quantidade',
      alinhamento: 'fim',
      celula: (d) => (
        <span className="numero">
          {formatarNumero(d.quantidade)} {d.unidadeFornecimento}
        </span>
      ),
    },
    { id: 'valor', cabecalho: 'Valor estimado', alinhamento: 'fim', celula: (d) => <span className="numero">{formatarMoeda(d.valorTotal)}</span> },
    { id: 'data', cabecalho: 'Data desejada', celula: (d) => <span className="numero">{formatarData(d.dataDesejada)}</span> },
    {
      id: 'prioridade',
      cabecalho: 'Prioridade',
      prioritaria: true,
      celula: (d) => (
        <Etiqueta tom={PRIORIDADES_PCA[d.prioridade].tom} compacta>
          {PRIORIDADES_PCA[d.prioridade].rotulo}
        </Etiqueta>
      ),
    },
    { id: 'item', cabecalho: 'Item do plano', celula: (d) => (d.itemNumero === null ? <span className="texto-secundario">—</span> : <span className="numero">{d.itemNumero}</span>) },
  ];
}

// ───────────────────────── formulários ─────────────────────────

interface ErrosDemanda {
  unidadeRequisitante?: string;
  descricao?: string;
  codigoCatalogo?: string;
  unidadeFornecimento?: string;
  quantidade?: string;
  valorUnitario?: string;
  dataDesejada?: string;
}

function FormularioDemanda({ plano, aberto, aoFechar }: { plano: PlanoContratacoesDetalhe; aberto: boolean; aoFechar: () => void }) {
  const registrar = useRegistrarDemanda(plano.id);
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const [unidade, definirUnidade] = useState('');
  const [descricao, definirDescricao] = useState('');
  const [codigo, definirCodigo] = useState('');
  const [tipo, definirTipo] = useState<TipoItemCatalogo>('material');
  const [fornecimento, definirFornecimento] = useState('unidade');
  const [quantidade, definirQuantidade] = useState('');
  const [valor, definirValor] = useState<number | null>(null);
  const [data, definirData] = useState('');
  const [prioridade, definirPrioridade] = useState<PrioridadeDemandaPca>('media');
  const [categoria, definirCategoria] = useState<CategoriaPca>('material');
  const [erros, definirErros] = useState<ErrosDemanda>({});

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const q = Number(quantidade.replace(',', '.'));
    const encontrados: ErrosDemanda = {};
    if (unidade.trim().length < 2) encontrados.unidadeRequisitante = 'Informe a unidade requisitante.';
    if (descricao.trim().length < 10) encontrados.descricao = 'Descreva o objeto com pelo menos 10 caracteres.';
    if (codigo.trim() !== '' && !/^\d{1,9}$/.test(codigo.trim())) encontrados.codigoCatalogo = 'O código do catálogo tem só dígitos (até 9).';
    if (fornecimento.trim() === '') encontrados.unidadeFornecimento = 'Informe a unidade de fornecimento.';
    if (!Number.isFinite(q) || q <= 0) encontrados.quantidade = 'Informe uma quantidade maior que zero.';
    if (valor === null || valor <= 0) encontrados.valorUnitario = 'Informe o valor unitário estimado.';
    if (!validarDataISO(data) || !data.startsWith(String(plano.ano))) encontrados.dataDesejada = `Informe uma data dentro de ${plano.ano}.`;
    definirErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    const entrada: EntradaDemandaPca = {
      unidadeRequisitante: unidade.trim(),
      descricao: descricao.trim(),
      codigoCatalogo: codigo.trim() === '' ? null : codigo.trim(),
      tipoCatalogo: codigo.trim() === '' ? null : tipo,
      unidadeFornecimento: fornecimento.trim(),
      quantidade: q,
      valorUnitario: valor ?? 0,
      dataDesejada: data,
      prioridade,
      categoria,
    };
    registrar.mutate(entrada, {
      onSuccess: () => {
        aoFechar();
        avisar({ tipo: 'sucesso', titulo: 'Demanda registrada', mensagem: `A demanda entrou no PCA ${plano.ano} da UASG ${plano.uasg}.` });
      },
    });
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={registrar.isPending ? () => undefined : aoFechar}
      titulo="Registrar demanda"
      largura="media"
      descricao={
        <p>
          Demanda da unidade para o plano de {plano.ano}: objeto, quantidade, estimativa preliminar do valor, data desejada e grau de prioridade
          (Decreto 10.947/2022, art. 8º).
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar demanda
          </Botao>
        </>
      }
    >
      <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
        <ResumoErros quantidade={Object.keys(erros).length} />
        <CampoTexto rotulo="Unidade requisitante" obrigatorio maxLength={200} value={unidade} onChange={(e) => definirUnidade(e.target.value)} erro={erros.unidadeRequisitante} />
        <AreaTexto rotulo="Descrição do objeto" obrigatorio rows={2} maxLength={2048} value={descricao} onChange={(e) => definirDescricao(e.target.value)} erro={erros.descricao} />
        <div className="formulario__linha">
          <CampoTexto
            rotulo="Código do catálogo"
            inputMode="numeric"
            maxLength={9}
            value={codigo}
            onChange={(e) => definirCodigo(e.target.value)}
            erro={erros.codigoCatalogo}
            ajuda="CATMAT ou CATSER. Deixe em branco se o item não consta do catálogo."
          />
          <Selecao rotulo="Tipo do código" opcoes={opcoesDe(TIPOS_CATALOGO)} value={tipo} onChange={(e) => definirTipo(e.target.value === 'servico' ? 'servico' : 'material')} />
        </div>
        <div className="formulario__linha">
          <CampoTexto rotulo="Unidade de fornecimento" obrigatorio maxLength={100} value={fornecimento} onChange={(e) => definirFornecimento(e.target.value)} erro={erros.unidadeFornecimento} />
          <CampoTexto rotulo="Quantidade" obrigatorio inputMode="decimal" value={quantidade} onChange={(e) => definirQuantidade(e.target.value)} erro={erros.quantidade} />
          <CampoMoeda rotulo="Valor unitário estimado" obrigatorio valor={valor} aoMudar={definirValor} erro={erros.valorUnitario} />
        </div>
        <div className="formulario__linha">
          <CampoTexto rotulo="Data desejada" obrigatorio type="date" value={data} onChange={(e) => definirData(e.target.value)} erro={erros.dataDesejada} />
          <Selecao
            rotulo="Grau de prioridade"
            obrigatorio
            opcoes={opcoesDe(PRIORIDADES_PCA)}
            value={prioridade}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'alta' || v === 'media' || v === 'baixa') definirPrioridade(v);
            }}
          />
          <Selecao
            rotulo="Categoria"
            obrigatorio
            opcoes={opcoesDe(CATEGORIAS_PCA)}
            value={categoria}
            onChange={(e) => {
              const v = e.target.value;
              if (v in CATEGORIAS_PCA) definirCategoria(v as CategoriaPca);
            }}
          />
        </div>
        <ErroFormulario erro={registrar.error} titulo="Não foi possível registrar a demanda" />
      </form>
    </Dialogo>
  );
}

function FormularioNovoPlano({ aberto, aoFechar, aoCriar }: { aberto: boolean; aoFechar: () => void; aoCriar: (id: string) => void }) {
  const criar = useCriarPlano();
  const { usuario } = useSessao();
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const proximoAno = Number(hojeISO(new Date()).slice(0, 4)) + 1;
  const [uasg, definirUasg] = useState(usuario?.uasgs[0] ?? '');
  const [ano, definirAno] = useState(String(proximoAno));
  const [erro, definirErro] = useState<string | null>(null);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(uasg.trim())) {
      definirErro('Informe o código da UASG, com 6 dígitos.');
      return;
    }
    definirErro(null);
    criar.mutate(
      { uasg: uasg.trim(), ano: Number(ano) },
      {
        onSuccess: (plano) => {
          aoFechar();
          aoCriar(plano.id);
          avisar({ tipo: 'sucesso', titulo: 'Plano aberto', mensagem: `PCA ${plano.ano} da UASG ${plano.uasg} em elaboração.` });
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={criar.isPending ? () => undefined : aoFechar}
      titulo="Abrir plano de contratações"
      largura="estreita"
      descricao={<p>Abre a elaboração do plano de uma UASG para o exercício. As unidades passam a registrar as demandas nele.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={criar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={criar.isPending}>
            Abrir plano
          </Botao>
        </>
      }
    >
      <form id={idFormulario} onSubmit={enviar} noValidate className="formulario">
        <CampoTexto rotulo="UASG" obrigatorio inputMode="numeric" maxLength={6} value={uasg} onChange={(e) => definirUasg(e.target.value)} erro={erro} />
        <Selecao
          rotulo="Exercício"
          obrigatorio
          opcoes={[proximoAno - 1, proximoAno, proximoAno + 1].map((a) => ({ valor: String(a), rotulo: String(a) }))}
          value={ano}
          onChange={(e) => definirAno(e.target.value)}
        />
        <ErroFormulario erro={criar.error} titulo="Não foi possível abrir o plano" />
      </form>
    </Dialogo>
  );
}

// ───────────────────────── detalhe ─────────────────────────

type Confirmacao = 'consolidar' | 'aprovar' | 'publicar' | 'devolver' | null;

function DetalhePlano({ plano }: { plano: PlanoContratacoesDetalhe }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consolidar = useAcaoPlano(plano.id, 'consolidar');
  const aprovar = useAcaoPlano(plano.id, 'aprovar');
  const publicar = useAcaoPlano(plano.id, 'publicar');
  const devolver = useDevolverPlano(plano.id);
  const remover = useRemoverDemanda(plano.id);
  const [confirmacao, definirConfirmacao] = useState<Confirmacao>(null);
  const [formulario, definirFormulario] = useState({ chave: 0, aberto: false });
  const [motivo, definirMotivo] = useState('');
  const podeEditar = temPermissao('pca:editar') && plano.origem === 'agora';
  const podeAprovar = temPermissao('pca:aprovar') && plano.origem === 'agora';
  const emElaboracao = plano.situacao === 'em_elaboracao';
  const titulo = `PCA ${plano.ano} · UASG ${plano.uasg}`;

  const executar = (mutacao: typeof consolidar, mensagem: (p: PlanoContratacoesDetalhe) => string, tituloAviso: string) =>
    mutacao.mutate(undefined, {
      onSuccess: (p) => {
        definirConfirmacao(null);
        avisar({ tipo: 'sucesso', titulo: tituloAviso, mensagem: mensagem(p) });
      },
    });

  const colunas = colunasDemandas();
  return (
    <Secao
      titulo={titulo}
      id="plano-selecionado"
      descricao={plano.uasgNome}
      acoes={
        <div className="linha">
          {podeEditar && emElaboracao ? (
            <>
              <Botao icone={Plus} onClick={() => definirFormulario((f) => ({ chave: f.chave + 1, aberto: true }))}>
                Registrar demanda
              </Botao>
              <Botao variante="primario" icone={Layers} disabled={plano.demandas === 0} onClick={() => definirConfirmacao('consolidar')}>
                Consolidar demandas
              </Botao>
            </>
          ) : null}
          {podeAprovar && plano.situacao === 'consolidado' ? (
            <>
              <Botao variante="terciario" icone={RotateCcw} onClick={() => definirConfirmacao('devolver')}>
                Devolver para ajustes
              </Botao>
              <Botao variante="primario" icone={CheckCheck} onClick={() => definirConfirmacao('aprovar')}>
                Aprovar e publicar no PNCP
              </Botao>
            </>
          ) : null}
          {podeAprovar && plano.situacao === 'aprovado' && plano.publicacao?.situacao === 'erro' ? (
            <Botao variante="primario" icone={Send} onClick={() => definirConfirmacao('publicar')}>
              Publicar no PNCP
            </Botao>
          ) : null}
        </div>
      }
    >
      <div className="pilha">
        <ListaDefinicoes
          colunas={3}
          itens={[
            {
              termo: 'Situação',
              valor: (
                <Etiqueta tom={SITUACOES_PCA[plano.situacao].tom} compacta>
                  {SITUACOES_PCA[plano.situacao].rotulo}
                </Etiqueta>
              ),
            },
            { termo: 'Valor estimado', valor: <span className="numero">{formatarMoeda(plano.valorTotal)}</span> },
            { termo: 'Demandas e itens', valor: `${plano.demandas} demandas · ${plano.itens} itens consolidados` },
            {
              termo: 'Consolidação',
              valor: plano.consolidadoEm ? `${formatarInstante(plano.consolidadoEm)} por ${plano.consolidadoPor?.nome ?? '—'}` : 'Ainda não consolidado',
            },
            { termo: 'Aprovação', valor: plano.aprovadoEm ? `${formatarInstante(plano.aprovadoEm)} por ${plano.aprovadoPor?.nome ?? '—'}` : 'Ainda não aprovado' },
            {
              termo: 'Publicação no PNCP',
              valor: plano.publicacao ? (
                <span className="pilha pilha--compacta">
                  <Etiqueta tom={SITUACOES_PUBLICACAO_PCA[plano.publicacao.situacao].tom} compacta>
                    {SITUACOES_PUBLICACAO_PCA[plano.publicacao.situacao].rotulo}
                  </Etiqueta>
                  {plano.publicacao.idPncp ? <span className="mono texto-pequeno">Nº {plano.publicacao.idPncp}</span> : null}
                </span>
              ) : (
                'Depois da aprovação'
              ),
            },
          ]}
        />
        {plano.origem === 'pncp' ? (
          <Alerta tipo="info" compacto titulo="Plano lido do PNCP">
            <p>Este plano foi elaborado fora da Ágora e trazido do PNCP pela consulta do servidor. Ele só pode ser consultado aqui.</p>
          </Alerta>
        ) : null}
        {plano.devolucao && emElaboracao ? (
          <Alerta tipo="aviso" compacto titulo="Plano devolvido para ajustes">
            <p>
              {plano.devolucao.motivo} — {plano.devolucao.por?.nome ?? 'autoridade'}, em {formatarInstante(plano.devolucao.em)}.
            </p>
          </Alerta>
        ) : null}
        {plano.publicacao?.situacao === 'publicado' && plano.publicacao.modo === 'offline' ? (
          <Alerta tipo="info" compacto titulo="Publicação simulada">
            <p>
              Em demonstração, as integrações ficam em modo offline: o número de controle e o protocolo ({plano.publicacao.protocolo ?? '—'}) são
              simulados.
            </p>
          </Alerta>
        ) : null}
        {plano.publicacao?.situacao === 'erro' ? (
          <Alerta tipo="erro" compacto titulo="O PNCP recusou a publicação">
            <p>{plano.publicacao.ultimoErro ?? 'Veja o motivo na fila de integrações.'}</p>
          </Alerta>
        ) : null}

        <Tabela
          id="pca-itens"
          legenda={`Itens consolidados do ${titulo}`}
          colunas={COLUNAS_ITENS}
          linhas={plano.itensConsolidados}
          chave={(i) => i.id}
          semFerramentas
          vazio={<EstadoVazio icone={ClipboardList} titulo="Nenhum item consolidado" descricao="Os itens aparecem depois da consolidação das demandas." />}
        />
        <Tabela
          id="pca-demandas"
          legenda={`Demandas das unidades do ${titulo}`}
          colunas={colunas}
          linhas={plano.demandasRegistradas}
          chave={(d) => d.id}
          semFerramentas
          vazio={<EstadoVazio icone={FilePlus2} titulo="Nenhuma demanda registrada" />}
          {...(podeEditar && emElaboracao
            ? {
                acoes: {
                  cabecalho: 'Ações',
                  celula: (d: DemandaPlanoContratacoes) => (
                    <Botao
                      variante="terciario"
                      tamanho="compacto"
                      icone={Trash2}
                      carregando={remover.isPending && remover.variables === d.id}
                      onClick={() =>
                        remover.mutate(d.id, { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Demanda removida', mensagem: d.descricao }) })
                      }
                    >
                      Remover<span className="sr-only"> a demanda {d.descricao}</span>
                    </Botao>
                  ),
                },
              }
            : {})}
        />
        <p className="texto-pequeno texto-secundario">{plano.fundamento}.</p>
      </div>

      {podeEditar ? (
        <FormularioDemanda key={formulario.chave} plano={plano} aberto={formulario.aberto} aoFechar={() => definirFormulario((f) => ({ ...f, aberto: false }))} />
      ) : null}
      <ConfirmarAcao
        aberto={confirmacao === 'consolidar'}
        aoFechar={() => definirConfirmacao(null)}
        titulo="Consolidar demandas"
        descricao={
          <p>
            As {plano.demandas} demandas viram itens do plano: as de mesmo código do catálogo, unidade de fornecimento e categoria são agregadas, com
            a data mais cedo e a prioridade mais alta (Decreto 10.947/2022, art. 11). Depois, o plano segue para a aprovação da autoridade.
          </p>
        }
        rotuloConfirmar="Consolidar"
        processando={consolidar.isPending}
        erro={consolidar.error}
        aoConfirmar={() => executar(consolidar, (p) => `${p.demandas} demandas consolidadas em ${p.itens} itens.`, 'Plano consolidado')}
      />
      <ConfirmarAcao
        aberto={confirmacao === 'aprovar'}
        aoFechar={() => definirConfirmacao(null)}
        titulo="Aprovar e publicar no PNCP"
        descricao={
          <p>
            Como autoridade competente, você aprova os {plano.itens} itens do plano ({formatarMoeda(plano.valorTotal)}). O plano aprovado é enviado ao
            PNCP pela fila de integrações (Decreto 10.947/2022, art. 12). Quem consolidou o plano não pode aprová-lo.
          </p>
        }
        rotuloConfirmar="Aprovar e publicar"
        processando={aprovar.isPending}
        erro={aprovar.error}
        aoConfirmar={() =>
          executar(
            aprovar,
            (p) => (p.situacao === 'publicado' ? `Plano publicado no PNCP sob o nº ${p.publicacao?.idPncp ?? ''}.` : 'Plano aprovado; a publicação segue pela fila.'),
            'Plano aprovado',
          )
        }
      />
      <ConfirmarAcao
        aberto={confirmacao === 'publicar'}
        aoFechar={() => definirConfirmacao(null)}
        titulo="Publicar no PNCP"
        descricao={<p>Reenvia ao PNCP o plano aprovado cuja publicação foi recusada. Confira antes se a causa apontada foi corrigida.</p>}
        rotuloConfirmar="Publicar"
        processando={publicar.isPending}
        erro={publicar.error}
        aoConfirmar={() => executar(publicar, () => 'O plano voltou para a fila de publicação.', 'Publicação reenviada')}
      />
      <ConfirmarAcao
        aberto={confirmacao === 'devolver'}
        aoFechar={() => definirConfirmacao(null)}
        titulo="Devolver para ajustes"
        descricao={<p>O plano volta à elaboração e a consolidação é desfeita (Decreto 10.947/2022, art. 12, § 1º). Explique o que deve ser ajustado.</p>}
        rotuloConfirmar="Devolver"
        variante="perigo"
        processando={devolver.isPending}
        erro={devolver.error}
        confirmarDesabilitado={motivo.trim().length < 20}
        aoConfirmar={() =>
          devolver.mutate(
            { motivo: motivo.trim() },
            {
              onSuccess: () => {
                definirConfirmacao(null);
                definirMotivo('');
                avisar({ tipo: 'sucesso', titulo: 'Plano devolvido', mensagem: 'O plano voltou à elaboração.' });
              },
            },
          )
        }
      >
        <AreaTexto rotulo="Ajustes pedidos" obrigatorio rows={3} value={motivo} onChange={(e) => definirMotivo(e.target.value)} ajuda="Mínimo de 20 caracteres." />
      </ConfirmarAcao>
    </Secao>
  );
}

export default function PlanoContratacoes() {
  const p = useParametrosUrl();
  const { temPermissao } = useSessao();
  const lista = usePlanosContratacoes({});
  const selecionado = p.texto('plano') ?? null;
  const detalhe = usePlanoContratacoes(selecionado);
  const [novo, definirNovo] = useState({ chave: 0, aberto: false });
  const [filtroAno, definirFiltroAno] = useState('');
  const podeEditar = temPermissao('pca:editar');

  return (
    <Pagina
      titulo="Plano de contratações"
      subtitulo="Demandas das unidades, consolidação, aprovação pela autoridade competente e publicação no PNCP (Lei 14.133/2021, art. 12, VII)."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Planejamento' }]}
      tela="planejamento.pca"
      acoes={
        podeEditar ? (
          <Botao variante="secundario" icone={CalendarRange} onClick={() => definirNovo((n) => ({ chave: n.chave + 1, aberto: true }))}>
            Abrir plano
          </Botao>
        ) : null
      }
    >
      <ConteudoConsulta consulta={lista} carregando={<EsqueletoTabela colunas={6} />} rotuloCarregando="Carregando planos">
        {(planos) => {
          const anos = [...new Set(planos.map((x) => x.ano))].sort((a, b) => b - a);
          const visiveis = filtroAno === '' ? planos : planos.filter((x) => String(x.ano) === filtroAno);
          return (
            <div className="pilha">
              <div className="barra-filtros">
                <div className="barra-filtros__campos">
                  <Selecao
                    rotulo="Exercício"
                    opcaoVazia="Todos"
                    opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))}
                    value={filtroAno}
                    onChange={(e) => definirFiltroAno(e.target.value)}
                  />
                </div>
              </div>
              <Tabela
                id="pca-planos"
                legenda="Planos de contratações anuais"
                colunas={COLUNAS_PLANOS}
                linhas={visiveis}
                chave={(x) => x.id}
                atualizando={lista.isFetching}
                ordenacaoInicial={{ por: 'plano', ordem: 'desc' }}
                destaque={(x) => (x.id === selecionado ? 'sucesso' : undefined)}
                vazio={<EstadoVazio icone={ClipboardList} titulo="Nenhum plano no seu escopo de UASG" />}
                acoes={{
                  cabecalho: 'Abrir',
                  celula: (x) => (
                    <Botao variante="terciario" tamanho="compacto" onClick={() => p.atualizar({ plano: x.id })} aria-pressed={x.id === selecionado}>
                      Abrir<span className="sr-only"> o PCA {x.ano} da UASG {x.uasg}</span>
                    </Botao>
                  ),
                }}
              />
            </div>
          );
        }}
      </ConteudoConsulta>
      {selecionado ? (
        <ConteudoConsulta consulta={detalhe} rotuloCarregando="Carregando o plano" naoEncontrado={{ titulo: 'Plano não encontrado' }}>
          {(plano) => <DetalhePlano plano={plano} />}
        </ConteudoConsulta>
      ) : (
        <Alerta tipo="info" compacto>
          <p>Abra um plano da lista para ver as demandas, os itens consolidados e a publicação no PNCP.</p>
        </Alerta>
      )}
      {podeEditar ? (
        <FormularioNovoPlano
          key={novo.chave}
          aberto={novo.aberto}
          aoFechar={() => definirNovo((n) => ({ ...n, aberto: false }))}
          aoCriar={(id) => p.atualizar({ plano: id })}
        />
      ) : null}
    </Pagina>
  );
}
