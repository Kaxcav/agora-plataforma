/**
 * Publicações no Diário Oficial da União (RF-36). A Imprensa Nacional recebe as matérias pelo INCom, sem API pública
 * de envio: a Ágora gera a matéria no padrão da Seção 3, o servidor credenciado a envia pelo INCom e registra aqui o
 * protocolo, e a publicação é conferida na consulta pública do DOU pelo servidor da Ágora (ou registrada à mão).
 */
import { useState, type FormEvent } from 'react';
import { FilePlus, Newspaper, RefreshCw, Send, SearchCheck } from 'lucide-react';
import type { CandidatoMateriaDou, MateriaDou, SituacaoMateriaDou, TipoMateriaDou } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import {
  useCandidatosDou,
  useConferirDou,
  useGerarMateriaDou,
  useMateriasDou,
  useRegistrarEnvioDou,
  useRegistrarJornalDou,
  useRegistrarPublicacaoDou,
  useResumoDou,
} from '../../api/dou';
import {
  Alerta,
  BarraFiltros,
  Botao,
  BotaoCopiar,
  CampoTexto,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  GrupoOpcoes,
  LinkExterno,
  ListaDefinicoes,
  Pagina,
  Paginacao,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import '../../design/paginas-dou.css';

const TIPOS: Record<TipoMateriaDou, { rotulo: string; ajuda: string }> = {
  aviso_licitacao: { rotulo: 'Aviso de licitação', ajuda: 'Extrato do edital, obrigatório no DOU e em jornal (art. 54, § 1º). Gerado sozinho quando o edital é aceito no PNCP.' },
  extrato_contrato: { rotulo: 'Extrato de contrato', ajuda: 'Publicidade complementar: a eficácia do contrato vem da divulgação no PNCP (art. 94).' },
  extrato_aditivo: { rotulo: 'Extrato de termo aditivo', ajuda: 'Publicidade complementar do aditivo, além do PNCP.' },
};

const SITUACOES: Record<SituacaoMateriaDou, { rotulo: string; tom: TomEtiqueta }> = {
  rascunho: { rotulo: 'A enviar pelo INCom', tom: 'aviso' },
  enviada: { rotulo: 'Enviada, aguardando publicação', tom: 'info' },
  publicada: { rotulo: 'Publicada', tom: 'sucesso' },
};

const ESCRITA: Record<TipoMateriaDou, 'jornada:publicar' | 'contratos:editar'> = {
  aviso_licitacao: 'jornada:publicar',
  extrato_contrato: 'contratos:editar',
  extrato_aditivo: 'contratos:editar',
};

const dataBr = (iso: string) => formatarData(iso);

const COLUNAS: ColunaTabela<MateriaDou>[] = [
  {
    id: 'ato',
    cabecalho: 'Ato',
    identificadora: true,
    prioritaria: true,
    fixa: true,
    celula: (m) => (
      <span className="pilha pilha--compacta">
        <span className="texto-forte">{m.identificacao}</span>
        <span className="texto-pequeno texto-secundario">
          Processo <span className="mono">{m.processo.numero}</span> · UASG {m.uasg}
        </span>
      </span>
    ),
  },
  { id: 'tipo', cabecalho: 'Tipo', celula: (m) => TIPOS[m.tipo].rotulo },
  {
    id: 'situacao',
    cabecalho: 'Situação',
    prioritaria: true,
    celula: (m) => (
      <Etiqueta tom={SITUACOES[m.situacao].tom} compacta>
        {SITUACOES[m.situacao].rotulo}
      </Etiqueta>
    ),
  },
  {
    id: 'envio',
    cabecalho: 'Envio pelo INCom',
    celula: (m) =>
      m.envio ? (
        <span className="pilha pilha--compacta">
          <span className="mono">{m.envio.protocolo}</span>
          <span className="texto-pequeno texto-secundario">Edição prevista: {dataBr(m.envio.dataPrevista)}</span>
        </span>
      ) : (
        '—'
      ),
  },
  {
    id: 'publicacao',
    cabecalho: 'Publicação',
    celula: (m) =>
      m.publicacao ? (
        <span className="numero">
          {dataBr(m.publicacao.data)}
          {m.publicacao.edicao ? `, ed. ${m.publicacao.edicao}` : ''}
          {m.publicacao.pagina ? `, p. ${m.publicacao.pagina}` : ''}
        </span>
      ) : (
        '—'
      ),
  },
];

// ───────────────────────── gerar matéria ─────────────────────────

function DialogoGerar({ aberto, aoFechar, aoGerar }: { aberto: boolean; aoFechar: () => void; aoGerar: (m: MateriaDou) => void }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const tipos = (Object.keys(TIPOS) as TipoMateriaDou[]).filter((t) => temPermissao(ESCRITA[t]));
  const [tipo, definirTipo] = useState<TipoMateriaDou | null>(tipos[0] ?? null);
  const [chave, definirChave] = useState('');
  const candidatos = useCandidatosDou(aberto ? tipo : null);
  const gerar = useGerarMateriaDou();
  const chaveDe = (c: CandidatoMateriaDou) => c.aditivoId ?? c.contratoId ?? c.processoId ?? '';
  const escolhido = candidatos.data?.find((c) => chaveDe(c) === chave) ?? null;

  const fechar = () => {
    gerar.reset();
    definirChave('');
    aoFechar();
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (!escolhido) return;
    gerar.mutate(
      {
        tipo: escolhido.tipo,
        ...(escolhido.processoId && escolhido.tipo === 'aviso_licitacao' ? { processoId: escolhido.processoId } : {}),
        ...(escolhido.contratoId ? { contratoId: escolhido.contratoId } : {}),
        ...(escolhido.aditivoId ? { aditivoId: escolhido.aditivoId } : {}),
      },
      {
        onSuccess: (m) => {
          avisar({ tipo: 'sucesso', titulo: 'Matéria gerada', mensagem: `${m.identificacao}. Confira o texto antes de enviar pelo INCom.` });
          fechar();
          aoGerar(m);
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      titulo="Gerar matéria para o DOU"
      descricao="A matéria sai no padrão da Seção 3 do DOU, com os dados do ato na Ágora. CPF de pessoa física aparece mascarado."
      rodape={
        <>
          <Botao onClick={fechar}>Cancelar</Botao>
          <Botao variante="primario" type="submit" form="form-gerar-dou" icone={FilePlus} carregando={gerar.isPending} disabled={!escolhido}>
            Gerar matéria
          </Botao>
        </>
      }
    >
      <form id="form-gerar-dou" className="pilha" onSubmit={enviar}>
        <GrupoOpcoes
          legenda="Tipo de matéria"
          nome="tipo-materia-dou"
          obrigatorio
          valor={tipo}
          aoMudar={(t) => {
            definirTipo(t);
            definirChave('');
          }}
          opcoes={tipos.map((t) => ({ valor: t, rotulo: TIPOS[t].rotulo, ajuda: TIPOS[t].ajuda }))}
        />
        <Selecao
          rotulo={tipo === 'aviso_licitacao' ? 'Processo com edital publicado no PNCP' : tipo === 'extrato_aditivo' ? 'Termo aditivo' : 'Contrato'}
          obrigatorio
          value={chave}
          onChange={(e) => definirChave(e.target.value)}
          opcaoVazia={candidatos.isPending ? 'Carregando…' : 'Selecione'}
          opcoes={(candidatos.data ?? []).map((c) => ({ valor: chaveDe(c), rotulo: `${c.rotulo}${c.materiaId ? ' (já tem matéria)' : ''}` }))}
          ajuda={escolhido?.materiaId ? 'Este ato já tem matéria: se ainda não foi enviada, o texto é refeito com os dados atuais.' : undefined}
        />
        <FalhaConsulta consulta={candidatos} titulo="Não foi possível listar os atos" />
        <ErroOperacao erro={gerar.error} titulo="Não foi possível gerar a matéria" />
      </form>
    </Dialogo>
  );
}

// ───────────────────────── detalhe da matéria ─────────────────────────

type Formulario = 'envio' | 'publicacao' | 'jornal' | null;

function agoraLocal(): string {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function DialogoMateria({ materia, aoFechar }: { materia: MateriaDou | null; aoFechar: () => void }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const [formulario, definirFormulario] = useState<Formulario>(null);
  const [protocolo, definirProtocolo] = useState('');
  const [enviadaEm, definirEnviadaEm] = useState(agoraLocal);
  const [data, definirData] = useState('');
  const [edicao, definirEdicao] = useState('');
  const [pagina, definirPagina] = useState('');
  const [url, definirUrl] = useState('');
  const [jornal, definirJornal] = useState('');
  const [dataJornal, definirDataJornal] = useState('');
  const gerar = useGerarMateriaDou();
  const envio = useRegistrarEnvioDou();
  const conferir = useConferirDou();
  const publicacao = useRegistrarPublicacaoDou();
  const registrarJornal = useRegistrarJornalDou();
  const [atual, definirAtual] = useState<MateriaDou | null>(null);
  const m = atual && materia && atual.id === materia.id ? atual : materia;

  const fechar = () => {
    for (const mutacao of [gerar, envio, conferir, publicacao, registrarJornal]) mutacao.reset();
    definirFormulario(null);
    definirAtual(null);
    aoFechar();
  };
  if (!m) return null;
  const podeEscrever = temPermissao(ESCRITA[m.tipo]);
  const atualizar = (titulo: string) => (nova: MateriaDou) => {
    definirAtual(nova);
    definirFormulario(null);
    avisar({ tipo: 'sucesso', titulo, mensagem: `${nova.identificacao}: ${SITUACOES[nova.situacao].rotulo.toLowerCase()}.` });
  };

  return (
    <Dialogo
      aberto={materia !== null}
      aoFechar={fechar}
      largura="ampla"
      titulo={m.identificacao}
      descricao={`${TIPOS[m.tipo].rotulo} · processo ${m.processo.numero} · Seção ${m.secao} do DOU`}
      rodape={<Botao onClick={fechar}>Fechar</Botao>}
    >
      <div className="pilha">
        <p className="linha">
          <Etiqueta tom={SITUACOES[m.situacao].tom}>{SITUACOES[m.situacao].rotulo}</Etiqueta>
          <Etiqueta tom={m.obrigatoria ? 'aviso' : 'neutro'} compacta>
            {m.obrigatoria ? 'Publicação obrigatória' : 'Publicidade complementar'}
          </Etiqueta>
          {m.automatica ? <Etiqueta compacta>Gerada ao publicar no PNCP</Etiqueta> : null}
        </p>
        <p className="texto-pequeno texto-secundario">{m.fundamento}</p>
        <pre className="materia-dou__texto" role="region" tabIndex={0} aria-label={`Texto da matéria ${m.identificacao}`}>
          {m.texto}
        </pre>
        <div className="botoes-fontes">
          <BotaoCopiar valor={m.texto} rotulo="o texto da matéria para colar no INCom" />
          {m.situacao === 'rascunho' && podeEscrever ? (
            <Botao
              tamanho="compacto"
              icone={RefreshCw}
              carregando={gerar.isPending}
              onClick={() =>
                gerar.mutate(
                  { tipo: m.tipo, ...(m.tipo === 'aviso_licitacao' && m.processo.id ? { processoId: m.processo.id } : {}), ...(m.contrato ? { contratoId: m.contrato.id } : {}), ...(m.aditivo ? { aditivoId: m.aditivo.id } : {}) },
                  { onSuccess: atualizar('Texto refeito com os dados atuais') },
                )
              }
            >
              Refazer com os dados atuais
            </Botao>
          ) : null}
        </div>
        <ListaDefinicoes
          colunas={2}
          itens={[
            { termo: 'Gerada em', valor: `${formatarInstante(m.geradaEm)}${m.geradaPor ? ` por ${m.geradaPor.nome}` : ''}` },
            {
              termo: 'Envio pelo INCom',
              valor: m.envio ? (
                <span className="pilha pilha--compacta">
                  <span>
                    Protocolo <span className="mono">{m.envio.protocolo}</span>, em {formatarInstante(m.envio.enviadaEm)}
                  </span>
                  <span className="texto-pequeno texto-secundario">Edição prevista: {dataBr(m.envio.dataPrevista)}</span>
                </span>
              ) : (
                'Ainda não enviada'
              ),
            },
            {
              termo: 'Publicação no DOU',
              valor: m.publicacao ? (
                <span className="pilha pilha--compacta">
                  <span>
                    {dataBr(m.publicacao.data)}
                    {m.publicacao.edicao ? `, edição ${m.publicacao.edicao}` : ''}
                    {m.publicacao.pagina ? `, página ${m.publicacao.pagina}` : ''}
                    {m.publicacao.forma === 'manual' ? ' (registro manual)' : m.publicacao.modo === 'offline' ? ' (conferência simulada)' : ' (conferida na consulta do DOU)'}
                  </span>
                  {m.publicacao.url ? (
                    <LinkExterno href={m.publicacao.url} tamanho="compacto">
                      Matéria no portal da Imprensa Nacional
                    </LinkExterno>
                  ) : null}
                </span>
              ) : (
                'Não publicada'
              ),
            },
            { termo: 'Última conferência', valor: m.conferencia.resultado ?? 'Nenhuma' },
            ...(m.tipo === 'aviso_licitacao'
              ? [{ termo: 'Jornal de grande circulação', valor: m.jornal ? `${m.jornal.nome}, ${dataBr(m.jornal.data)}` : 'Não registrado' }]
              : []),
          ]}
        />
        {m.conferencia.tarefa?.situacao === 'erro' ? (
          <Alerta tipo="erro" compacto titulo="A consulta do DOU falhou">
            <p>{m.conferencia.tarefa.ultimoErro ?? 'Falha sem mensagem.'}</p>
          </Alerta>
        ) : null}
        {m.conferencia.tarefa?.situacao === 'nova_tentativa' ? (
          <p className="texto-pequeno">A consulta do DOU não respondeu; a Ágora tenta de novo sozinha.</p>
        ) : null}
        {podeEscrever ? (
          <div className="botoes-fontes">
            {m.situacao === 'rascunho' ? (
              <Botao tamanho="compacto" variante="primario" icone={Send} aria-expanded={formulario === 'envio'} onClick={() => definirFormulario(formulario === 'envio' ? null : 'envio')}>
                Registrar envio pelo INCom
              </Botao>
            ) : null}
            {m.situacao === 'enviada' ? (
              <>
                <Botao tamanho="compacto" variante="primario" icone={SearchCheck} carregando={conferir.isPending} onClick={() => conferir.mutate(m.id, { onSuccess: atualizar('Conferência concluída') })}>
                  Conferir no DOU
                </Botao>
                <Botao tamanho="compacto" aria-expanded={formulario === 'publicacao'} onClick={() => definirFormulario(formulario === 'publicacao' ? null : 'publicacao')}>
                  Registrar publicação
                </Botao>
              </>
            ) : null}
            {m.tipo === 'aviso_licitacao' && m.situacao !== 'rascunho' && temPermissao('jornada:publicar') ? (
              <Botao tamanho="compacto" icone={Newspaper} aria-expanded={formulario === 'jornal'} onClick={() => definirFormulario(formulario === 'jornal' ? null : 'jornal')}>
                {m.jornal ? 'Corrigir publicação em jornal' : 'Registrar publicação em jornal'}
              </Botao>
            ) : null}
          </div>
        ) : null}
        {formulario === 'envio' ? (
          <form
            className="materia-dou__formulario materia-dou__formulario--duplo"
            onSubmit={(e) => {
              e.preventDefault();
              envio.mutate({ id: m.id, protocolo, enviadaEm: new Date(enviadaEm).toISOString() }, { onSuccess: atualizar('Envio registrado') });
            }}
          >
            <CampoTexto rotulo="Protocolo do INCom" obrigatorio value={protocolo} onChange={(e) => definirProtocolo(e.target.value)} maxLength={80} ajuda="Número que o INCom mostra ao concluir o envio." />
            <CampoTexto rotulo="Data e hora do envio" obrigatorio type="datetime-local" value={enviadaEm} onChange={(e) => definirEnviadaEm(e.target.value)} />
            <div className="botoes-fontes">
              <Botao type="submit" variante="primario" carregando={envio.isPending} disabled={protocolo.trim().length < 3}>
                Salvar envio
              </Botao>
            </div>
          </form>
        ) : null}
        {formulario === 'publicacao' ? (
          <form
            className="materia-dou__formulario materia-dou__formulario--duplo"
            onSubmit={(e) => {
              e.preventDefault();
              publicacao.mutate({ id: m.id, data, edicao, pagina, url: url.trim() === '' ? null : url.trim() }, { onSuccess: atualizar('Publicação registrada') });
            }}
          >
            <CampoTexto rotulo="Data da edição" obrigatorio type="date" value={data} onChange={(e) => definirData(e.target.value)} />
            <CampoTexto rotulo="Edição" obrigatorio value={edicao} onChange={(e) => definirEdicao(e.target.value)} maxLength={20} inputMode="numeric" />
            <CampoTexto rotulo="Página" obrigatorio value={pagina} onChange={(e) => definirPagina(e.target.value)} maxLength={20} inputMode="numeric" />
            <CampoTexto rotulo="Endereço da matéria (opcional)" type="url" value={url} onChange={(e) => definirUrl(e.target.value)} ajuda="Link da matéria em in.gov.br." />
            <div className="botoes-fontes">
              <Botao type="submit" variante="primario" carregando={publicacao.isPending} disabled={!data || !edicao || !pagina}>
                Salvar publicação
              </Botao>
            </div>
          </form>
        ) : null}
        {formulario === 'jornal' ? (
          <form
            className="materia-dou__formulario materia-dou__formulario--duplo"
            onSubmit={(e) => {
              e.preventDefault();
              registrarJornal.mutate({ id: m.id, nome: jornal, data: dataJornal }, { onSuccess: atualizar('Publicação em jornal registrada') });
            }}
          >
            <CampoTexto rotulo="Jornal diário de grande circulação" obrigatorio value={jornal} onChange={(e) => definirJornal(e.target.value)} maxLength={200} />
            <CampoTexto rotulo="Data da publicação no jornal" obrigatorio type="date" value={dataJornal} onChange={(e) => definirDataJornal(e.target.value)} />
            <div className="botoes-fontes">
              <Botao type="submit" variante="primario" carregando={registrarJornal.isPending} disabled={jornal.trim().length < 3 || !dataJornal}>
                Salvar publicação em jornal
              </Botao>
            </div>
          </form>
        ) : null}
        <ErroOperacao erro={gerar.error ?? envio.error ?? conferir.error ?? publicacao.error ?? registrarJornal.error} titulo="Não foi possível concluir" />
      </div>
    </Dialogo>
  );
}

// ───────────────────────── página ─────────────────────────

export default function PublicacoesDou() {
  const { temPermissao } = useSessao();
  const [tipo, definirTipo] = useState<TipoMateriaDou | null>(null);
  const [situacao, definirSituacao] = useState<SituacaoMateriaDou | null>(null);
  const [pagina, definirPagina] = useState(1);
  const [gerando, definirGerando] = useState(false);
  const [aberta, definirAberta] = useState<MateriaDou | null>(null);
  const resumo = useResumoDou();
  const lista = useMateriasDou({ tipo, situacao, pagina });
  const podeGerar = temPermissao('jornada:publicar') || temPermissao('contratos:editar');
  const filtrosAtivos = tipo !== null || situacao !== null;

  return (
    <Pagina
      titulo="Publicações no DOU"
      subtitulo="Avisos de licitação e extratos de contrato e de aditivo para a Seção 3 do Diário Oficial da União, com o envio pelo INCom e a conferência da publicação."
      tela="publicacoes.dou"
      acoes={
        podeGerar ? (
          <Botao variante="primario" icone={FilePlus} onClick={() => definirGerando(true)}>
            Gerar matéria
          </Botao>
        ) : null
      }
    >
      <Secao titulo="Situação" id="situacao-dou" descricao="O aviso de licitação é obrigatório (art. 54, § 1º); os extratos complementam a divulgação no PNCP (art. 94).">
        {resumo.data ? (
          <div className="pilha">
            {resumo.data.modo === 'offline' ? (
              <Alerta tipo="info" compacto titulo="Conferência simulada">
                <p>As integrações estão em modo offline: a conferência considera a matéria publicada na edição prevista. Nada é consultado no DOU.</p>
              </Alerta>
            ) : null}
            <ListaDefinicoes
              colunas={4}
              itens={[
                { termo: 'A enviar pelo INCom', valor: <span className="numero">{resumo.data.rascunho}</span> },
                { termo: 'Aguardando publicação', valor: <span className="numero">{resumo.data.enviada}</span> },
                { termo: 'Publicadas', valor: <span className="numero">{resumo.data.publicada}</span> },
                { termo: 'Avisos de licitação pendentes', valor: <span className="numero">{resumo.data.avisosPendentes}</span> },
              ]}
            />
          </div>
        ) : (
          <FalhaConsulta consulta={resumo} />
        )}
      </Secao>
      <Secao titulo="Matérias" id="materias-dou">
        <BarraFiltros
          total={lista.data?.total}
          substantivo={['matéria', 'matérias']}
          feminino
          filtrosAtivos={filtrosAtivos}
          aoLimpar={() => {
            definirTipo(null);
            definirSituacao(null);
            definirPagina(1);
          }}
        >
          <Selecao
            rotulo="Tipo"
            value={tipo ?? ''}
            opcaoVazia="Todos"
            opcoes={(Object.keys(TIPOS) as TipoMateriaDou[]).map((t) => ({ valor: t, rotulo: TIPOS[t].rotulo }))}
            onChange={(e) => {
              definirTipo((e.target.value || null) as TipoMateriaDou | null);
              definirPagina(1);
            }}
          />
          <Selecao
            rotulo="Situação"
            value={situacao ?? ''}
            opcaoVazia="Todas"
            opcoes={(Object.keys(SITUACOES) as SituacaoMateriaDou[]).map((s) => ({ valor: s, rotulo: SITUACOES[s].rotulo }))}
            onChange={(e) => {
              definirSituacao((e.target.value || null) as SituacaoMateriaDou | null);
              definirPagina(1);
            }}
          />
        </BarraFiltros>
        <FalhaConsulta consulta={lista} titulo="Não foi possível carregar as matérias" />
        <Tabela
          id="materias-dou"
          legenda="Matérias para o Diário Oficial da União"
          colunas={COLUNAS}
          linhas={lista.data?.itens}
          chave={(m) => m.id}
          carregando={lista.isPending}
          atualizando={lista.isFetching && !lista.isPending}
          vazio={<EstadoVazio titulo="Nenhuma matéria" descricao="Os avisos de licitação aparecem aqui quando o edital é aceito no PNCP." />}
          acoes={{
            cabecalho: 'Ações',
            celula: (m) => (
              <Botao tamanho="compacto" aria-label={`Abrir ${m.identificacao}`} onClick={() => definirAberta(m)}>
                Abrir
              </Botao>
            ),
          }}
          destaque={(m) => (m.tipo === 'aviso_licitacao' && m.situacao !== 'publicada' ? 'aviso' : undefined)}
        />
        {lista.data && lista.data.total > lista.data.tamanhoPagina ? (
          <Paginacao pagina={pagina} tamanhoPagina={lista.data.tamanhoPagina} total={lista.data.total} aoMudarPagina={definirPagina} />
        ) : null}
      </Secao>
      {podeGerar ? <DialogoGerar aberto={gerando} aoFechar={() => definirGerando(false)} aoGerar={definirAberta} /> : null}
      <DialogoMateria materia={aberta} aoFechar={() => definirAberta(null)} />
    </Pagina>
  );
}
