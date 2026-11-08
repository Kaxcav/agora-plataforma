/**
 * Peças compartilhadas das telas de vínculos e impedimentos (F4 e F14): rótulos, lista de sinais com evidências,
 * seleção de fornecedor e os diálogos de registrar vínculo e de propor extensão de sanção.
 */
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { FilePlus2, Gavel } from 'lucide-react';
import type {
  AlvoExtensaoSancao,
  EntradaVinculo,
  FonteVinculo,
  NaturezaVinculo,
  SinalVinculo,
  SituacaoExtensaoSancao,
  TipoSinalVinculo,
  VinculoRegistrado,
} from '@agora/contratos';
import { hojeISO, validarDataISO } from '@agora/dominio';
import { useFornecedores } from '../../api/fornecedores';
import { useAgentesPublicos, useProporExtensao, useRegistrarVinculo, useVinculosFornecedor } from '../../api/impedimentos';
import {
  Alerta,
  AreaTexto,
  Botao,
  CampoBusca,
  CampoTexto,
  Dialogo,
  Etiqueta,
  GrupoOpcoes,
  Selecao,
  useAvisos,
  type ColunaTabela,
  type TomEtiqueta,
} from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import type { RotuloTom } from '../compartilhado/rotulos';
import './estilos-vinculos.css';

export const NATUREZAS_VINCULO: Record<NaturezaVinculo, string> = {
  conjuge: 'Cônjuge ou companheiro',
  parentesco: 'Parentesco (até o 3º grau)',
  societario: 'Societário',
  tecnico: 'Técnico',
  comercial: 'Comercial',
  economico: 'Econômico',
  financeiro: 'Financeiro',
  trabalhista: 'Trabalhista',
  civil: 'Civil',
};

export const FONTES_VINCULO: Record<FonteVinculo, string> = {
  qsa_receita: 'Quadro societário (dados abertos do CNPJ)',
  cadastro_fornecedor: 'Cadastro do fornecedor',
  declaracao_licitante: 'Declaração do licitante',
  declaracao_agente: 'Declaração do agente público',
  informado_agente: 'Informado por agente público',
};

const TIPOS_SINAL: Record<TipoSinalVinculo, string> = {
  socio_comum: 'Sócio em comum',
  administrador_comum: 'Administrador em comum',
  endereco_comum: 'Endereço de cadastro em comum',
  contato_comum: 'Contato de cadastro em comum',
  vinculo_informado: 'Vínculo entre licitantes',
  agente_publico: 'Vínculo com agente público',
  possivel_sucessao: 'Possível sucessão de empresa sancionada',
};

export const SITUACOES_EXTENSAO: Record<SituacaoExtensaoSancao, RotuloTom> = {
  contraditorio: { rotulo: 'Contraditório e ampla defesa', tom: 'aviso' },
  analise_juridica: { rotulo: 'Análise jurídica prévia', tom: 'info' },
  decisao: { rotulo: 'Aguardando decisão da autoridade', tom: 'alerta' },
  estendida: { rotulo: 'Sanção estendida', tom: 'erro' },
  nao_estendida: { rotulo: 'Extensão não acolhida', tom: 'sucesso' },
  arquivada: { rotulo: 'Arquivada', tom: 'neutro' },
};

export const ALVOS_EXTENSAO: Record<AlvoExtensaoSancao, string> = {
  sucessora: 'Pessoa jurídica sucessora',
  coligada_controlada: 'Empresa do mesmo ramo coligada ou controlada',
  socio_administrador: 'Sócio com poderes de administração',
  administrador: 'Administrador',
};

export function EtiquetaSituacaoExtensao({ situacao }: { situacao: SituacaoExtensaoSancao }) {
  const s = SITUACOES_EXTENSAO[situacao];
  return (
    <Etiqueta tom={s.tom} compacta>
      {s.rotulo}
    </Etiqueta>
  );
}

const TOM_NIVEL: Record<SinalVinculo['nivel'], { rotulo: string; tom: TomEtiqueta }> = {
  risco: { rotulo: 'Risco', tom: 'erro' },
  atencao: { rotulo: 'Atenção', tom: 'aviso' },
};

/** Sinais com as evidências e a marca "requer revisão humana". Nenhum sinal decide nada. */
export function ListaSinaisVinculo({
  sinais,
  titulo,
  vazio,
  acao,
}: {
  sinais: readonly SinalVinculo[];
  titulo: string;
  vazio: ReactNode;
  acao?: (sinal: SinalVinculo) => ReactNode;
}) {
  if (sinais.length === 0) return <p className="texto-secundario">{vazio}</p>;
  return (
    <ul className="sinais-vinculo" aria-label={titulo}>
      {sinais.map((s, i) => (
        <li key={`${s.tipo}-${i}`} className={['sinal-vinculo', s.nivel === 'risco' ? 'sinal-vinculo--risco' : ''].filter(Boolean).join(' ')}>
          <div className="sinal-vinculo__topo">
            <Etiqueta tom={TOM_NIVEL[s.nivel].tom} compacta>
              {TOM_NIVEL[s.nivel].rotulo}
            </Etiqueta>
            <h3 className="sinal-vinculo__titulo">
              {TIPOS_SINAL[s.tipo]} ({s.regra})
            </h3>
            <Etiqueta tom="info" compacta icone={null}>
              Requer revisão humana
            </Etiqueta>
          </div>
          <p className="sinal-vinculo__mensagem">{s.mensagem}</p>
          <div>
            <p className="texto-pequeno texto-forte">Evidências</p>
            <ul className="sinal-vinculo__evidencias texto-pequeno">
              {s.evidencias.map((e, j) => (
                <li key={j}>
                  <span className="sinal-vinculo__fonte">{FONTES_VINCULO[e.fonte]}:</span> {e.descricao}
                </li>
              ))}
            </ul>
          </div>
          <p className="texto-pequeno texto-secundario">
            Fornecedores:{' '}
            {s.fornecedores.map((f, j) => (
              <span key={f.id}>
                {j > 0 ? '; ' : ''}
                <Link to={`/impedimentos/fornecedores/${f.id}`}>{f.nome}</Link>
              </span>
            ))}
            {s.agente ? ` · Agente público: ${s.agente.nome}` : ''} · Fundamento: {s.fundamento}
          </p>
          {acao ? <div className="linha">{acao(s)}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** Escolha de um fornecedor do cadastro por busca (mínimo de 3 caracteres). */
export function SeletorFornecedor({
  rotulo,
  nome,
  selecionado,
  aoSelecionar,
  erro,
  ativo,
}: {
  rotulo: string;
  nome: string;
  selecionado: { id: string; nome: string } | null;
  aoSelecionar: (f: { id: string; nome: string }) => void;
  erro?: string | undefined;
  ativo: boolean;
}) {
  const [busca, definirBusca] = useState('');
  const valida = busca.trim().length >= 3;
  const resultados = useFornecedores({ busca: busca.trim(), tamanhoPagina: 10 }, ativo && valida);
  const opcoes = (resultados.data?.itens ?? []).map((f) => ({ valor: f.id, rotulo: f.razaoSocial, ajuda: f.documento }));
  return (
    <div className="pilha pilha--compacta">
      <CampoBusca rotulo={`Buscar ${rotulo.toLowerCase()}`} placeholder="Razão social ou CNPJ (mínimo 3 caracteres)" valor={busca} aoMudar={definirBusca} />
      {selecionado ? (
        <p className="texto-pequeno">
          Selecionado: <strong>{selecionado.nome}</strong>
        </p>
      ) : null}
      {valida && opcoes.length > 0 ? (
        <GrupoOpcoes
          legenda={rotulo}
          nome={nome}
          obrigatorio
          opcoes={opcoes}
          valor={selecionado?.id ?? null}
          aoMudar={(id) => {
            const f = resultados.data?.itens.find((x) => x.id === id);
            if (f) aoSelecionar({ id: f.id, nome: f.razaoSocial });
          }}
          erro={erro}
        />
      ) : valida && !resultados.isPending ? (
        <p className="texto-pequeno texto-secundario" role="status">
          Nenhum fornecedor encontrado para “{busca.trim()}”.
        </p>
      ) : null}
      {erro && !(valida && opcoes.length > 0) ? (
        <p className="campo__erro" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}

const MINIMO_EVIDENCIA = 15;
const MINIMO_DESCRICAO = 10;

/** Registro de vínculo de fonte lícita, com fonte e evidência (RIA-10). Nada é deduzido: o agente informa. */
export function DialogoRegistrarVinculo({
  aberto,
  aoFechar,
  fornecedorInicial,
  processoId,
}: {
  aberto: boolean;
  aoFechar: () => void;
  fornecedorInicial?: { id: string; nome: string } | null;
  processoId?: string | null;
}) {
  const { avisar } = useAvisos();
  const registrar = useRegistrarVinculo();
  const agentes = useAgentesPublicos(aberto);
  const [fornecedor, definirFornecedor] = useState<{ id: string; nome: string } | null>(fornecedorInicial ?? null);
  const [contraparte, definirContraparte] = useState<'fornecedor' | 'agente'>('fornecedor');
  const [outro, definirOutro] = useState<{ id: string; nome: string } | null>(null);
  const [agenteId, definirAgenteId] = useState('');
  const [natureza, definirNatureza] = useState<NaturezaVinculo | ''>('');
  const [grau, definirGrau] = useState<'1' | '2' | '3' | null>(null);
  const [fonte, definirFonte] = useState<EntradaVinculo['fonte'] | null>(null);
  const [descricao, definirDescricao] = useState('');
  const [evidencia, definirEvidencia] = useState('');
  const [erros, definirErros] = useState<Record<string, string>>({});

  const limpar = () => {
    definirFornecedor(fornecedorInicial ?? null);
    definirContraparte('fornecedor');
    definirOutro(null);
    definirAgenteId('');
    definirNatureza('');
    definirGrau(null);
    definirFonte(null);
    definirDescricao('');
    definirEvidencia('');
    definirErros({});
    registrar.reset();
  };
  const fechar = () => {
    limpar();
    aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: Record<string, string> = {};
    if (!fornecedor) novos.fornecedor = 'Selecione o fornecedor.';
    if (contraparte === 'fornecedor' && !outro) novos.outro = 'Selecione o outro fornecedor.';
    if (contraparte === 'fornecedor' && outro && fornecedor && outro.id === fornecedor.id) novos.outro = 'Escolha um fornecedor diferente.';
    if (contraparte === 'agente' && agenteId === '') novos.agente = 'Selecione o agente público.';
    if (natureza === '') novos.natureza = 'Selecione a natureza do vínculo.';
    if (natureza === 'parentesco' && grau === null) novos.grau = 'Informe o grau de parentesco.';
    if (!fonte) novos.fonte = 'Informe a fonte.';
    if (descricao.trim().length < MINIMO_DESCRICAO) novos.descricao = `Descreva o vínculo com pelo menos ${MINIMO_DESCRICAO} caracteres.`;
    if (evidencia.trim().length < MINIMO_EVIDENCIA) novos.evidencia = `Descreva a evidência com pelo menos ${MINIMO_EVIDENCIA} caracteres.`;
    definirErros(novos);
    if (Object.keys(novos).length > 0 || !fornecedor || natureza === '' || !fonte) return;
    registrar.mutate(
      {
        natureza,
        grauParentesco: natureza === 'parentesco' && grau !== null ? (Number(grau) as 1 | 2 | 3) : null,
        fornecedorId: fornecedor.id,
        outroFornecedorId: contraparte === 'fornecedor' ? (outro?.id ?? null) : null,
        agenteId: contraparte === 'agente' ? agenteId : null,
        fonte,
        descricao: descricao.trim(),
        evidencia: evidencia.trim(),
        processoId: processoId ?? null,
      },
      {
        onSuccess: () => {
          avisar({ tipo: 'sucesso', titulo: 'Vínculo registrado', mensagem: 'O vínculo passa a alimentar os sinais de análise (RIA-10).' });
          fechar();
        },
      },
    );
  };

  const idFormulario = 'formulario-registrar-vinculo';
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      titulo="Registrar vínculo"
      largura="ampla"
      descricao={
        <p>
          Registre só vínculos de fonte lícita, com a evidência e onde ela está juntada. A Ágora não deduz parentesco por cruzamento de dados
          pessoais: o vínculo vira sinal para análise humana, nunca desclassificação.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar vínculo
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <fieldset className="grupo-campos">
          <legend>Partes do vínculo</legend>
          {fornecedorInicial ? (
            <p>
              Fornecedor: <strong>{fornecedorInicial.nome}</strong>
            </p>
          ) : (
            <SeletorFornecedor rotulo="Fornecedor" nome="vinculo-fornecedor" selecionado={fornecedor} aoSelecionar={definirFornecedor} erro={erros.fornecedor} ativo={aberto} />
          )}
          <GrupoOpcoes
            legenda="Com quem é o vínculo"
            nome="vinculo-contraparte"
            horizontal
            opcoes={[
              { valor: 'fornecedor', rotulo: 'Outro fornecedor' },
              { valor: 'agente', rotulo: 'Agente público do órgão' },
            ]}
            valor={contraparte}
            aoMudar={definirContraparte}
          />
          {contraparte === 'fornecedor' ? (
            <SeletorFornecedor rotulo="Outro fornecedor" nome="vinculo-outro" selecionado={outro} aoSelecionar={definirOutro} erro={erros.outro} ativo={aberto} />
          ) : (
            <Selecao
              rotulo="Agente público"
              obrigatorio
              opcaoVazia={agentes.isPending ? 'Carregando agentes…' : 'Selecione…'}
              opcoes={(agentes.data ?? []).map((a) => ({ valor: a.id, rotulo: a.nome }))}
              value={agenteId}
              onChange={(e) => definirAgenteId(e.target.value)}
              erro={erros.agente}
            />
          )}
        </fieldset>
        <fieldset className="grupo-campos">
          <legend>Natureza, fonte e evidência</legend>
          <Selecao
            rotulo="Natureza do vínculo"
            obrigatorio
            opcaoVazia="Selecione…"
            opcoes={Object.entries(NATUREZAS_VINCULO).map(([valor, rotulo]) => ({ valor, rotulo }))}
            value={natureza}
            onChange={(e) => {
              const valor = e.target.value;
              definirNatureza(valor in NATUREZAS_VINCULO ? (valor as NaturezaVinculo) : '');
              if (valor !== 'parentesco') definirGrau(null);
            }}
            erro={erros.natureza}
          />
          {natureza === 'parentesco' ? (
            <GrupoOpcoes
              legenda="Grau de parentesco (linha reta, colateral ou por afinidade)"
              nome="vinculo-grau"
              horizontal
              obrigatorio
              opcoes={[
                { valor: '1', rotulo: '1º grau' },
                { valor: '2', rotulo: '2º grau' },
                { valor: '3', rotulo: '3º grau' },
              ]}
              valor={grau}
              aoMudar={definirGrau}
              erro={erros.grau}
            />
          ) : null}
          <GrupoOpcoes
            legenda="Fonte"
            nome="vinculo-fonte"
            obrigatorio
            opcoes={[
              { valor: 'declaracao_licitante', rotulo: 'Declaração do licitante', ajuda: 'O próprio licitante declarou o vínculo (por exemplo, na proposta ou na habilitação).' },
              { valor: 'informado_agente', rotulo: 'Informado por agente público', ajuda: 'Documento oficial juntado ao processo (certidão, registro público, comunicação formal).' },
            ]}
            valor={fonte}
            aoMudar={definirFonte}
            erro={erros.fonte}
          />
          <AreaTexto rotulo="Descrição do vínculo" obrigatorio rows={3} maxLength={2000} value={descricao} onChange={(e) => definirDescricao(e.target.value)} erro={erros.descricao} />
          <AreaTexto
            rotulo="Evidência"
            obrigatorio
            rows={3}
            maxLength={2000}
            value={evidencia}
            onChange={(e) => definirEvidencia(e.target.value)}
            erro={erros.evidencia}
            ajuda="Documento que comprova o vínculo e onde está juntado (por exemplo, número do documento SEI)."
          />
        </fieldset>
        {registrar.isError ? (
          <Alerta tipo="erro" anunciar titulo="Não foi possível registrar o vínculo">
            <p>{registrar.error.message}</p>
          </Alerta>
        ) : null}
      </form>
    </Dialogo>
  );
}

const MINIMO_FUNDAMENTACAO = 50;

/**
 * Proposta de extensão de sanção (art. 160) a partir de um sinal de possível sucessão: abre o contraditório.
 * `sinal.fornecedores[0]` é a empresa suspeita; `sinal.fornecedores[1]`, a sancionada.
 */
export function DialogoProporExtensao({ aberto, aoFechar, sinal }: { aberto: boolean; aoFechar: () => void; sinal: SinalVinculo | null }) {
  const navegar = useNavigate();
  const { avisar } = useAvisos();
  const propor = useProporExtensao();
  const suspeita = sinal?.fornecedores[0] ?? null;
  const sancionada = sinal?.fornecedores[1] ?? null;
  const [alvo, definirAlvo] = useState<AlvoExtensaoSancao>('sucessora');
  const quadro = useVinculosFornecedor(sancionada?.id ?? '', aberto && (alvo === 'administrador' || alvo === 'socio_administrador'));
  const [integranteId, definirIntegranteId] = useState('');
  const [fundamentacao, definirFundamentacao] = useState('');
  const [intimacao, definirIntimacao] = useState(() => hojeISO(new Date()));
  const [erros, definirErros] = useState<Record<string, string>>({});
  const pessoa = alvo === 'administrador' || alvo === 'socio_administrador';
  const administradores = (quadro.data?.quadro.integrantes ?? []).filter((i) => i.qualificacao !== 'socio');

  const fechar = () => {
    definirAlvo('sucessora');
    definirIntegranteId('');
    definirFundamentacao('');
    definirErros({});
    propor.reset();
    aoFechar();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (!sinal?.sancaoOrigemId || !suspeita) return;
    const novos: Record<string, string> = {};
    if (pessoa && integranteId === '') novos.integrante = 'Selecione quem administra a empresa sancionada.';
    if (fundamentacao.trim().length < MINIMO_FUNDAMENTACAO) novos.fundamentacao = `Fundamente com pelo menos ${MINIMO_FUNDAMENTACAO} caracteres.`;
    if (!validarDataISO(intimacao)) novos.intimacao = 'Informe a data da intimação.';
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    propor.mutate(
      {
        sancaoOrigemId: sinal.sancaoOrigemId,
        alvo,
        alvoFornecedorId: pessoa ? null : suspeita.id,
        alvoIntegranteId: pessoa ? integranteId : null,
        fundamentacao: fundamentacao.trim(),
        sinal: sinal.mensagem,
        intimacaoEm: intimacao,
      },
      {
        onSuccess: (extensao) => {
          avisar({ tipo: 'sucesso', titulo: 'Proposta de extensão registrada', mensagem: 'O contraditório foi aberto; nada foi estendido ainda.' });
          fechar();
          void navegar(`/impedimentos/extensoes/${extensao.id}`);
        },
      },
    );
  };

  const idFormulario = 'formulario-propor-extensao';
  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      titulo="Propor extensão da sanção"
      largura="ampla"
      descricao={
        <p>
          Abre o procedimento do art. 160 da Lei 14.133/2021: intimação com prazo de defesa de 15 dias úteis, análise jurídica prévia e decisão
          da autoridade competente. A proposta não estende nada por si.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} icone={Gavel} carregando={propor.isPending}>
            Abrir o contraditório
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        {sinal ? (
          <Alerta tipo="aviso" compacto titulo="Sinal de origem (requer revisão humana)">
            <p>{sinal.mensagem}</p>
          </Alerta>
        ) : null}
        <GrupoOpcoes
          legenda="Quem seria alcançado"
          nome="extensao-alvo"
          obrigatorio
          opcoes={[
            { valor: 'sucessora', rotulo: `${ALVOS_EXTENSAO.sucessora}: ${suspeita?.nome ?? ''}` },
            { valor: 'coligada_controlada', rotulo: `${ALVOS_EXTENSAO.coligada_controlada}: ${suspeita?.nome ?? ''}` },
            { valor: 'socio_administrador', rotulo: `${ALVOS_EXTENSAO.socio_administrador} de ${sancionada?.nome ?? 'sancionada'}` },
            { valor: 'administrador', rotulo: `${ALVOS_EXTENSAO.administrador} de ${sancionada?.nome ?? 'sancionada'}` },
          ]}
          valor={alvo}
          aoMudar={definirAlvo}
        />
        {pessoa ? (
          <Selecao
            rotulo="Pessoa do quadro societário da sancionada"
            obrigatorio
            opcaoVazia={quadro.isPending ? 'Carregando o quadro societário…' : 'Selecione…'}
            opcoes={administradores.map((i) => ({ valor: i.id, rotulo: `${i.nome} — CPF ${i.documento}` }))}
            value={integranteId}
            onChange={(e) => definirIntegranteId(e.target.value)}
            erro={erros.integrante}
            ajuda="Só administradores e sócios com poderes de administração podem ser alcançados (art. 160)."
          />
        ) : null}
        <AreaTexto
          rotulo="Fundamentação"
          obrigatorio
          rows={5}
          maxLength={5000}
          contador
          value={fundamentacao}
          onChange={(e) => definirFundamentacao(e.target.value)}
          erro={erros.fundamentacao}
          ajuda="Descreva o abuso da personalidade jurídica ou a confusão patrimonial e as provas juntadas ao processo."
        />
        <CampoTexto
          rotulo="Data da intimação"
          type="date"
          obrigatorio
          value={intimacao}
          onChange={(e) => definirIntimacao(e.target.value)}
          erro={erros.intimacao}
          ajuda="O prazo de defesa de 15 dias úteis é contado a partir desta data."
        />
        {propor.isError ? (
          <Alerta tipo="erro" anunciar titulo="Não foi possível registrar a proposta">
            <p>{propor.error.message}</p>
          </Alerta>
        ) : null}
      </form>
    </Dialogo>
  );
}

/** Botão que abre o registro de vínculo, para quem tem a permissão. */
export function BotaoRegistrarVinculo({ aoClicar }: { aoClicar: () => void }) {
  return (
    <Botao variante="secundario" icone={FilePlus2} onClick={aoClicar}>
      Registrar vínculo
    </Botao>
  );
}

/** Colunas da tabela de vínculos registrados (painel, processo e fornecedor). */
export const COLUNAS_VINCULOS: ColunaTabela<VinculoRegistrado>[] = [
  {
    id: 'partes',
    cabecalho: 'Partes',
    identificadora: true,
    celula: (v) => (
      <>
        <Link to={`/impedimentos/fornecedores/${v.fornecedor.id}`}>{v.fornecedor.nome}</Link>
        {' e '}
        {v.outroFornecedor ? <Link to={`/impedimentos/fornecedores/${v.outroFornecedor.id}`}>{v.outroFornecedor.nome}</Link> : `${v.agente?.nome ?? ''} (agente público)`}
      </>
    ),
  },
  { id: 'natureza', cabecalho: 'Natureza', celula: (v) => `${NATUREZAS_VINCULO[v.natureza]}${v.grauParentesco ? ` — ${v.grauParentesco}º grau` : ''}` },
  { id: 'fonte', cabecalho: 'Fonte', celula: (v) => FONTES_VINCULO[v.fonte] },
  { id: 'evidencia', cabecalho: 'Evidência', celula: (v) => v.evidencia },
  { id: 'situacao', cabecalho: 'Situação', celula: (v) => (v.situacao === 'ativo' ? 'Ativo' : `Revogado: ${v.motivoRevogacao ?? ''}`) },
  { id: 'registro', cabecalho: 'Registrado em', celula: (v) => <span className="numero">{formatarInstante(v.registradoEm)}</span> },
];
