/**
 * Intenções de registro de preços (Lei 14.133/2021, art. 86; Decreto 11.462/2023, art. 9º — RN-38): o órgão gerenciador
 * abre a IRP por pelo menos 8 dias úteis, as UASGs participantes registram a adesão com as quantidades e, depois do
 * encerramento, o gerenciador consolida a estimativa total. O prazo é contado e decidido no servidor, com o calendário do
 * órgão; a prévia da tela é só informativa.
 */
import { useId, useRef, useState, type FormEvent } from 'react';
import { Handshake, ListChecks, PackagePlus, Sigma } from 'lucide-react';
import type { AdesaoIrp, EntradaIrp, IntencaoRegistroPrecos } from '@agora/contratos';
import { diasUteisEntre, formatarData, hojeISO, prazoMinimoIrp, validarDataISO } from '@agora/dominio';
import { useAbrirIrp, useAderirIrp, useConsolidarIrp, useIntencoesRegistroPrecos } from '../../api/planejamento';
import {
  Alerta,
  AreaTexto,
  Botao,
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
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { ErroFormulario, focarPrimeiroInvalido, ResumoErros } from '../ajustes/ErroFormulario';
import { SITUACOES_IRP } from './comum';

const COLUNAS: readonly ColunaTabela<IntencaoRegistroPrecos>[] = [
  {
    id: 'numero',
    cabecalho: 'IRP',
    identificadora: true,
    fixa: true,
    ordenavel: true,
    valorOrdenacao: (i) => i.abertura,
    celula: (i) => (
      <span className="pilha pilha--compacta">
        <strong>IRP {i.numero}</strong>
        <span className="texto-pequeno texto-secundario">Gerenciadora: UASG {i.uasgGerenciadora}</span>
      </span>
    ),
  },
  { id: 'objeto', cabecalho: 'Objeto', prioritaria: true, celula: (i) => i.objeto },
  {
    id: 'periodo',
    cabecalho: 'Período',
    celula: (i) => (
      <span className="numero">
        {formatarData(i.abertura)} a {formatarData(i.encerramento)} ({i.diasUteis} dias úteis)
      </span>
    ),
  },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    celula: (i) => (
      <Etiqueta tom={SITUACOES_IRP[i.situacao].tom} compacta>
        {SITUACOES_IRP[i.situacao].rotulo}
      </Etiqueta>
    ),
  },
  {
    id: 'quantidade',
    cabecalho: 'Quantidade estimada',
    alinhamento: 'fim',
    celula: (i) => (
      <span className="numero">
        {formatarNumero(i.consolidacao?.quantidadeTotal ?? i.quantidadeTotal)} {i.unidadeFornecimento}
      </span>
    ),
  },
];

const COLUNAS_ADESOES: readonly ColunaTabela<AdesaoIrp>[] = [
  {
    id: 'uasg',
    cabecalho: 'UASG participante',
    identificadora: true,
    fixa: true,
    celula: (a) => (
      <span className="pilha pilha--compacta">
        <strong>UASG {a.uasg}</strong>
        <span className="texto-pequeno texto-secundario">{a.uasgNome}</span>
      </span>
    ),
  },
  { id: 'quantidade', cabecalho: 'Quantidade', alinhamento: 'fim', celula: (a) => <span className="numero">{formatarNumero(a.quantidade)}</span> },
  { id: 'manifestacao', cabecalho: 'Manifestação', prioritaria: true, celula: (a) => a.manifestacao },
  { id: 'registro', cabecalho: 'Registro', celula: (a) => `${formatarInstante(a.registradaEm)} · ${a.registradaPor?.nome ?? '—'}` },
];

interface ErrosIrp {
  uasgGerenciadora?: string;
  objeto?: string;
  codigoCatalogo?: string;
  unidadeFornecimento?: string;
  quantidadeGerenciador?: string;
  abertura?: string;
  encerramento?: string;
}

function FormularioIrp({ aberto, aoFechar, aoCriar }: { aberto: boolean; aoFechar: () => void; aoCriar: (id: string) => void }) {
  const p = useParametrosUrl();
  const { usuario } = useSessao();
  const abrir = useAbrirIrp();
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const hoje = hojeISO(new Date());
  const [uasg, definirUasg] = useState(p.texto('uasg') ?? usuario?.uasgs[0] ?? '');
  const [objeto, definirObjeto] = useState(p.texto('objeto') ?? '');
  const [codigo, definirCodigo] = useState(p.texto('codigo') ?? '');
  const [fornecimento, definirFornecimento] = useState(p.texto('unidade') ?? 'unidade');
  const [quantidade, definirQuantidade] = useState(p.texto('quantidade') ?? '');
  const [abertura, definirAbertura] = useState(hoje);
  const [encerramento, definirEncerramento] = useState(() => prazoMinimoIrp(hoje).encerramentoMinimo);
  const [erros, definirErros] = useState<ErrosIrp>({});
  const processoId = p.texto('processo') ?? null;

  // Prévia informativa (sem os feriados locais): o servidor conta com o calendário do órgão e decide.
  const previa = validarDataISO(abertura) ? prazoMinimoIrp(abertura) : null;
  const diasInformados = validarDataISO(abertura) && validarDataISO(encerramento) && encerramento > abertura ? diasUteisEntre(abertura, encerramento) : 0;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const q = Number(quantidade.replace(',', '.'));
    const encontrados: ErrosIrp = {};
    if (!/^\d{6}$/.test(uasg.trim())) encontrados.uasgGerenciadora = 'Informe a UASG gerenciadora, com 6 dígitos.';
    if (objeto.trim().length < 10) encontrados.objeto = 'Descreva o objeto com pelo menos 10 caracteres.';
    if (codigo.trim() !== '' && !/^\d{1,9}$/.test(codigo.trim())) encontrados.codigoCatalogo = 'O código do catálogo tem só dígitos (até 9).';
    if (fornecimento.trim() === '') encontrados.unidadeFornecimento = 'Informe a unidade de fornecimento.';
    if (!Number.isFinite(q) || q <= 0) encontrados.quantidadeGerenciador = 'Informe a quantidade do órgão gerenciador.';
    if (!validarDataISO(abertura)) encontrados.abertura = 'Informe a data de abertura.';
    if (!validarDataISO(encerramento)) encontrados.encerramento = 'Informe a data de encerramento.';
    definirErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    const entrada: EntradaIrp = {
      uasgGerenciadora: uasg.trim(),
      processoId,
      objeto: objeto.trim(),
      codigoCatalogo: codigo.trim() === '' ? null : codigo.trim(),
      unidadeFornecimento: fornecimento.trim(),
      quantidadeGerenciador: q,
      abertura,
      encerramento,
    };
    abrir.mutate(entrada, {
      onSuccess: (irp) => {
        aoFechar();
        aoCriar(irp.id);
        avisar({ tipo: 'sucesso', titulo: 'Intenção de registro de preços aberta', mensagem: `IRP ${irp.numero} aberta de ${formatarData(irp.abertura)} a ${formatarData(irp.encerramento)}.` });
      },
    });
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={abrir.isPending ? () => undefined : aoFechar}
      titulo="Abrir intenção de registro de preços"
      largura="media"
      descricao={
        <p>
          A IRP fica aberta por pelo menos 8 dias úteis para que outras unidades manifestem interesse e informem as quantidades (Lei 14.133/2021,
          art. 86; RN-38). {processoId ? 'A intenção fica ligada ao processo de origem.' : ''}
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={abrir.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={abrir.isPending}>
            Abrir intenção
          </Botao>
        </>
      }
    >
      <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
        <ResumoErros quantidade={Object.keys(erros).length} />
        <div className="formulario__linha">
          <CampoTexto rotulo="UASG gerenciadora" obrigatorio inputMode="numeric" maxLength={6} value={uasg} onChange={(e) => definirUasg(e.target.value)} erro={erros.uasgGerenciadora} />
          <CampoTexto rotulo="Código do catálogo" inputMode="numeric" maxLength={9} value={codigo} onChange={(e) => definirCodigo(e.target.value)} erro={erros.codigoCatalogo} />
        </div>
        <AreaTexto rotulo="Objeto" obrigatorio rows={2} maxLength={2000} value={objeto} onChange={(e) => definirObjeto(e.target.value)} erro={erros.objeto} />
        <div className="formulario__linha">
          <CampoTexto rotulo="Unidade de fornecimento" obrigatorio maxLength={100} value={fornecimento} onChange={(e) => definirFornecimento(e.target.value)} erro={erros.unidadeFornecimento} />
          <CampoTexto
            rotulo="Quantidade do gerenciador"
            obrigatorio
            inputMode="decimal"
            value={quantidade}
            onChange={(e) => definirQuantidade(e.target.value)}
            erro={erros.quantidadeGerenciador}
          />
        </div>
        <div className="formulario__linha">
          <CampoTexto rotulo="Abertura" obrigatorio type="date" value={abertura} onChange={(e) => definirAbertura(e.target.value)} erro={erros.abertura} />
          <CampoTexto
            rotulo="Encerramento"
            obrigatorio
            type="date"
            value={encerramento}
            onChange={(e) => definirEncerramento(e.target.value)}
            erro={erros.encerramento}
            ajuda={previa ? `Pelo menos 8 dias úteis: a partir de ${formatarData(previa.encerramentoMinimo)} (prévia sem os feriados locais).` : undefined}
          />
        </div>
        {previa && diasInformados < 8 ? (
          <Alerta tipo="aviso" compacto titulo="Período menor que 8 dias úteis">
            <p>O período informado tem {diasInformados} dias úteis. O servidor recusa a abertura com menos de 8 dias úteis (RN-38).</p>
          </Alerta>
        ) : null}
        <ErroFormulario erro={abrir.error} titulo="Não foi possível abrir a intenção de registro de preços" />
      </form>
    </Dialogo>
  );
}

function FormularioAdesao({ irp, aberto, aoFechar }: { irp: IntencaoRegistroPrecos; aberto: boolean; aoFechar: () => void }) {
  const aderir = useAderirIrp(irp.id);
  const { usuario } = useSessao();
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const [uasg, definirUasg] = useState(usuario?.uasgs.find((u) => u !== irp.uasgGerenciadora) ?? '');
  const [quantidade, definirQuantidade] = useState('');
  const [manifestacao, definirManifestacao] = useState('');
  const [erros, definirErros] = useState<{ uasg?: string; quantidade?: string; manifestacao?: string }>({});

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const q = Number(quantidade.replace(',', '.'));
    const encontrados: { uasg?: string; quantidade?: string; manifestacao?: string } = {};
    if (!/^\d{6}$/.test(uasg.trim())) encontrados.uasg = 'Informe a UASG participante, com 6 dígitos.';
    if (!Number.isFinite(q) || q <= 0) encontrados.quantidade = 'Informe a quantidade estimada pela unidade.';
    if (manifestacao.trim().length < 10) encontrados.manifestacao = 'Registre a manifestação de interesse com pelo menos 10 caracteres.';
    definirErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    aderir.mutate(
      { uasg: uasg.trim(), quantidade: q, manifestacao: manifestacao.trim() },
      {
        onSuccess: () => {
          aoFechar();
          avisar({ tipo: 'sucesso', titulo: 'Adesão registrada', mensagem: `A UASG ${uasg.trim()} aderiu à IRP ${irp.numero}.` });
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aderir.isPending ? () => undefined : aoFechar}
      titulo="Registrar adesão"
      largura="estreita"
      descricao={<p>Manifestação de interesse da unidade participante, com a quantidade estimada, enquanto a IRP {irp.numero} está aberta.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={aderir.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={aderir.isPending}>
            Registrar adesão
          </Botao>
        </>
      }
    >
      <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
        <ResumoErros quantidade={Object.keys(erros).length} />
        <CampoTexto rotulo="UASG participante" obrigatorio inputMode="numeric" maxLength={6} value={uasg} onChange={(e) => definirUasg(e.target.value)} erro={erros.uasg} />
        <CampoTexto
          rotulo={`Quantidade (${irp.unidadeFornecimento})`}
          obrigatorio
          inputMode="decimal"
          value={quantidade}
          onChange={(e) => definirQuantidade(e.target.value)}
          erro={erros.quantidade}
        />
        <AreaTexto rotulo="Manifestação de interesse" obrigatorio rows={3} maxLength={2000} value={manifestacao} onChange={(e) => definirManifestacao(e.target.value)} erro={erros.manifestacao} />
        <ErroFormulario erro={aderir.error} titulo="Não foi possível registrar a adesão" />
      </form>
    </Dialogo>
  );
}

function DetalheIrp({ irp }: { irp: IntencaoRegistroPrecos }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const consolidar = useConsolidarIrp(irp.id);
  const [adesao, definirAdesao] = useState({ chave: 0, aberto: false });
  const [confirmar, definirConfirmar] = useState(false);
  return (
    <Secao
      titulo={`IRP ${irp.numero}`}
      id="irp-selecionada"
      descricao={irp.objeto}
      acoes={
        <div className="linha">
          {temPermissao('irp:aderir') && irp.situacao === 'aberta' ? (
            <Botao icone={Handshake} onClick={() => definirAdesao((a) => ({ chave: a.chave + 1, aberto: true }))}>
              Registrar adesão
            </Botao>
          ) : null}
          {temPermissao('irp:gerenciar') && irp.situacao === 'encerrada' ? (
            <Botao variante="primario" icone={Sigma} onClick={() => definirConfirmar(true)}>
              Consolidar quantidades
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
                <Etiqueta tom={SITUACOES_IRP[irp.situacao].tom} compacta>
                  {SITUACOES_IRP[irp.situacao].rotulo}
                </Etiqueta>
              ),
            },
            { termo: 'Gerenciadora', valor: `UASG ${irp.uasgGerenciadora} — ${irp.uasgGerenciadoraNome}` },
            { termo: 'Período', valor: `${formatarData(irp.abertura)} a ${formatarData(irp.encerramento)} (${irp.diasUteis} dias úteis)` },
            { termo: 'Código do catálogo', valor: irp.codigoCatalogo ?? 'Sem código' },
            { termo: 'Quantidade do gerenciador', valor: `${formatarNumero(irp.quantidadeGerenciador)} ${irp.unidadeFornecimento}` },
            { termo: 'Total com as adesões', valor: `${formatarNumero(irp.quantidadeTotal)} ${irp.unidadeFornecimento}` },
            ...(irp.processo ? [{ termo: 'Processo de origem', valor: `Processo ${irp.processo.numeroSei}` }] : []),
          ]}
        />
        {irp.consolidacao ? (
          <Alerta tipo="sucesso" compacto titulo={`Estimativa total consolidada: ${formatarNumero(irp.consolidacao.quantidadeTotal)} ${irp.unidadeFornecimento}`}>
            <ul>
              {irp.consolidacao.participantes.map((x) => (
                <li key={x.uasg}>
                  UASG {x.uasg} ({x.papel === 'gerenciador' ? 'gerenciadora' : 'participante'}): {formatarNumero(x.quantidade)} — {formatarNumero(x.percentual)}%
                </li>
              ))}
            </ul>
            <p className="texto-pequeno">
              Consolidada em {formatarInstante(irp.consolidacao.consolidadaEm)} por {irp.consolidacao.consolidadaPor?.nome ?? '—'}.
            </p>
          </Alerta>
        ) : null}
        <Tabela
          id="irp-adesoes"
          legenda={`Adesões à IRP ${irp.numero}`}
          colunas={COLUNAS_ADESOES}
          linhas={irp.adesoes}
          chave={(a) => a.id}
          semFerramentas
          vazio={<EstadoVazio icone={Handshake} titulo="Nenhuma adesão registrada" />}
        />
        <p className="texto-pequeno texto-secundario">{irp.fundamento}.</p>
      </div>
      {temPermissao('irp:aderir') ? (
        <FormularioAdesao key={adesao.chave} irp={irp} aberto={adesao.aberto} aoFechar={() => definirAdesao((a) => ({ ...a, aberto: false }))} />
      ) : null}
      <ConfirmarAcao
        aberto={confirmar}
        aoFechar={() => definirConfirmar(false)}
        titulo="Consolidar quantidades"
        descricao={
          <p>
            Soma a quantidade do gerenciador às {irp.adesoes.length} adesões registradas: {formatarNumero(irp.quantidadeTotal)} {irp.unidadeFornecimento}{' '}
            (art. 86, caput). Depois da consolidação, não há novas adesões.
          </p>
        }
        rotuloConfirmar="Consolidar"
        processando={consolidar.isPending}
        erro={consolidar.error}
        aoConfirmar={() =>
          consolidar.mutate(undefined, {
            onSuccess: (r) => {
              definirConfirmar(false);
              avisar({ tipo: 'sucesso', titulo: 'Quantidades consolidadas', mensagem: `IRP ${r.numero}: ${formatarNumero(r.consolidacao?.quantidadeTotal ?? 0)} ${r.unidadeFornecimento}.` });
            },
          })
        }
      />
    </Secao>
  );
}

export default function IntencoesRegistroPrecos() {
  const p = useParametrosUrl();
  const { temPermissao } = useSessao();
  const consulta = useIntencoesRegistroPrecos();
  const selecionada = p.texto('irp') ?? null;
  // Vindo do DFD ("Propor intenção de registro de preços"), o formulário abre já preenchido.
  const [formulario, definirFormulario] = useState(() => ({ chave: 0, aberto: p.texto('nova') === '1' }));
  const podeGerenciar = temPermissao('irp:gerenciar');

  return (
    <Pagina
      titulo="Intenções de registro de preços"
      subtitulo="Abertura por pelo menos 8 dias úteis, adesão das unidades participantes e consolidação das quantidades (Lei 14.133/2021, art. 86)."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Planejamento' }]}
      tela="planejamento.irp"
      acoes={
        podeGerenciar ? (
          <Botao variante="primario" icone={PackagePlus} onClick={() => definirFormulario((f) => ({ chave: f.chave + 1, aberto: true }))}>
            Abrir intenção de registro de preços
          </Botao>
        ) : null
      }
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela colunas={5} />} rotuloCarregando="Carregando intenções de registro de preços">
        {(irps) => {
          const atual = irps.find((i) => i.id === selecionada) ?? null;
          return (
            <div className="pilha pilha--ampla">
              <Tabela
                id="irps"
                legenda="Intenções de registro de preços"
                colunas={COLUNAS}
                linhas={irps}
                chave={(i) => i.id}
                atualizando={consulta.isFetching}
                destaque={(i) => (i.id === selecionada ? 'sucesso' : undefined)}
                vazio={<EstadoVazio icone={ListChecks} titulo="Nenhuma intenção de registro de preços" />}
                acoes={{
                  cabecalho: 'Abrir',
                  celula: (i) => (
                    <Botao variante="terciario" tamanho="compacto" onClick={() => p.atualizar({ irp: i.id, nova: undefined })} aria-pressed={i.id === selecionada}>
                      Abrir<span className="sr-only"> a IRP {i.numero}</span>
                    </Botao>
                  ),
                }}
              />
              {atual ? (
                <DetalheIrp irp={atual} />
              ) : (
                <Alerta tipo="info" compacto>
                  <p>Abra uma intenção da lista para ver as adesões e a consolidação das quantidades.</p>
                </Alerta>
              )}
            </div>
          );
        }}
      </ConteudoConsulta>
      {podeGerenciar ? (
        <FormularioIrp
          key={formulario.chave}
          aberto={formulario.aberto}
          aoFechar={() => definirFormulario((f) => ({ ...f, aberto: false }))}
          aoCriar={(id) => p.atualizar({ irp: id, nova: undefined, processo: undefined, codigo: undefined, objeto: undefined, quantidade: undefined, unidade: undefined, uasg: undefined })}
        />
      ) : null}
    </Pagina>
  );
}
