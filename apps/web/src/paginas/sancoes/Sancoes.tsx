import { useState, type FormEvent } from 'react';
import { Calculator, Gavel } from 'lucide-react';
import type { EntradaDosimetria, ResultadoDosimetria, TipoSancao } from '@agora/contratos';
import {
  formatarData,
  formatarMoeda,
  INFRACOES_ART_155,
  prazoDefesa,
  sancoesCabiveis,
  validarDataISO,
  type Centavos,
  type IncisoInfracao,
} from '@agora/dominio';
import { useFornecedor, useFornecedores, useInstaurarSancao, useSancoes, useSimularDosimetria, type FiltroSancoes } from '../../api/fornecedores';
import {
  Alerta,
  AreaTexto,
  BarraFiltros,
  Botao,
  CaixaSelecao,
  CampoBusca,
  CampoMoeda,
  CampoTexto,
  ConfirmarAcao,
  Dialogo,
  EstadoVazio,
  Etiqueta,
  FalhaConsulta,
  GrupoOpcoes,
  ListaDefinicoes,
  Pagina,
  Paginacao,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarPercentual } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { chavesDe, opcoesDe, SITUACOES_SANCAO, TIPOS_SANCAO } from '../compartilhado/rotulos';
import { colunasSancao } from './colunasSancao';

const FILTROS = ['situacao', 'tipo'] as const;
const COLUNAS = colunasSancao({ comFornecedor: true });
const MINIMO_RELATO = 20;

function calcularPrazoDefesa(intimacao: string): { vencimento: string; fundamento: string } | null {
  if (!validarDataISO(intimacao)) return null;
  try {
    return prazoDefesa(intimacao);
  } catch {
    return null;
  }
}

// ───────────────────────── Instaurar processo ─────────────────────────

interface ErrosInstauracao {
  fornecedor?: string;
  inciso?: string;
  tipo?: string;
  intimacao?: string;
  relato?: string;
}

function DialogoInstaurar({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  const { avisar } = useAvisos();
  const instaurar = useInstaurarSancao();
  const [busca, definirBusca] = useState('');
  const [fornecedor, definirFornecedor] = useState<{ id: string; razaoSocial: string } | null>(null);
  const [contratoId, definirContratoId] = useState('');
  const [inciso, definirInciso] = useState<IncisoInfracao | ''>('');
  const [tipo, definirTipo] = useState<TipoSancao | null>(null);
  const [intimacao, definirIntimacao] = useState('');
  const [relato, definirRelato] = useState('');
  const [erros, definirErros] = useState<ErrosInstauracao>({});
  const [confirmando, definirConfirmando] = useState(false);

  const buscaValida = busca.trim().length >= 3;
  const resultados = useFornecedores({ busca: busca.trim(), tamanhoPagina: 10 }, aberto && buscaValida);
  const detalheFornecedor = useFornecedor(fornecedor?.id ?? null);
  const cabiveis = inciso === '' ? [] : sancoesCabiveis(inciso);
  const prazo = calcularPrazoDefesa(intimacao);

  const limpar = () => {
    definirBusca('');
    definirFornecedor(null);
    definirContratoId('');
    definirInciso('');
    definirTipo(null);
    definirIntimacao('');
    definirRelato('');
    definirErros({});
    definirConfirmando(false);
    instaurar.reset();
  };

  const fechar = () => {
    limpar();
    aoFechar();
  };

  const validar = (): boolean => {
    const novos: ErrosInstauracao = {};
    if (!fornecedor) novos.fornecedor = 'Selecione o fornecedor.';
    if (inciso === '') novos.inciso = 'Selecione a infração do art. 155.';
    if (!tipo) novos.tipo = 'Selecione a sanção cabível em análise.';
    if (!validarDataISO(intimacao)) novos.intimacao = 'Informe a data da intimação.';
    if (relato.trim().length < MINIMO_RELATO) novos.relato = `Descreva os fatos com pelo menos ${MINIMO_RELATO} caracteres.`;
    definirErros(novos);
    return Object.keys(novos).length === 0;
  };

  const revisar = (evento: FormEvent) => {
    evento.preventDefault();
    if (validar()) {
      instaurar.reset();
      definirConfirmando(true);
    }
  };

  const confirmar = () => {
    if (!fornecedor || inciso === '' || !tipo) return;
    const nome = fornecedor.razaoSocial;
    instaurar.mutate(
      {
        fornecedorId: fornecedor.id,
        contratoId: contratoId === '' ? null : contratoId,
        incisoInfracao: inciso,
        tipo,
        intimacaoEm: intimacao,
        relato: relato.trim(),
      },
      {
        onSuccess: (sancao) => {
          avisar({
            tipo: 'sucesso',
            titulo: 'Processo sancionatório instaurado',
            mensagem: sancao.prazoDefesa
              ? `${nome}: prazo de defesa até ${formatarData(sancao.prazoDefesa)}.`
              : `${nome}: processo registrado em instrução.`,
          });
          fechar();
        },
      },
    );
  };

  const contratos = detalheFornecedor.data?.contratos ?? [];
  const opcoesFornecedores = (resultados.data?.itens ?? []).map((f) => ({
    valor: f.id,
    rotulo: f.razaoSocial,
    ajuda: `${f.documento}${f.sancoesVigentes > 0 ? ` · ${f.sancoesVigentes} sanção(ões) vigente(s)` : ''}`,
  }));
  const idFormulario = 'formulario-instaurar-sancao';

  return (
    <>
      <Dialogo
        aberto={aberto}
        aoFechar={fechar}
        titulo="Instaurar processo sancionatório"
        largura="ampla"
        descricao={
          <p>
            Registra a abertura do processo administrativo (Lei 14.133/2021, arts. 155 a 163). A aplicação de qualquer sanção depende de
            decisão da autoridade competente, após contraditório e ampla defesa.
          </p>
        }
        rodape={
          <>
            <Botao variante="secundario" onClick={fechar}>
              Cancelar
            </Botao>
            <Botao variante="primario" type="submit" form={idFormulario}>
              Revisar e instaurar
            </Botao>
          </>
        }
      >
        <form id={idFormulario} className="formulario" onSubmit={revisar} noValidate>
          <fieldset className="grupo-campos">
            <legend>Fornecedor e contrato</legend>
            <CampoBusca
              rotulo="Buscar fornecedor"
              placeholder="Razão social, nome ou CNPJ (mínimo 3 caracteres)"
              valor={busca}
              aoMudar={definirBusca}
            />
            {fornecedor ? (
              <p className="texto-pequeno">
                Selecionado: <strong>{fornecedor.razaoSocial}</strong>
              </p>
            ) : null}
            {!buscaValida ? (
              <p className="texto-pequeno texto-secundario">Digite ao menos 3 caracteres para listar fornecedores.</p>
            ) : resultados.isPending ? (
              <p className="texto-pequeno texto-secundario" role="status">
                Buscando fornecedores…
              </p>
            ) : resultados.isError ? (
              <Alerta tipo="erro" compacto>
                Não foi possível buscar fornecedores. Tente outro termo.
              </Alerta>
            ) : opcoesFornecedores.length === 0 ? (
              <p className="texto-pequeno texto-secundario" role="status">
                Nenhum fornecedor encontrado para “{busca.trim()}”.
              </p>
            ) : (
              <GrupoOpcoes
                legenda="Fornecedor"
                nome="fornecedor-sancao"
                obrigatorio
                opcoes={opcoesFornecedores}
                valor={fornecedor?.id ?? null}
                aoMudar={(id) => {
                  const escolhido = resultados.data?.itens.find((f) => f.id === id);
                  if (escolhido) {
                    definirFornecedor({ id: escolhido.id, razaoSocial: escolhido.razaoSocial });
                    definirContratoId('');
                  }
                }}
                erro={erros.fornecedor}
              />
            )}
            {erros.fornecedor && (!buscaValida || opcoesFornecedores.length === 0) ? (
              <p className="campo__erro" role="alert">
                {erros.fornecedor}
              </p>
            ) : null}
            <Selecao
              rotulo="Contrato relacionado"
              ajuda={fornecedor ? 'Opcional: infrações na fase de licitação podem não ter contrato.' : 'Selecione o fornecedor para listar os contratos.'}
              opcaoVazia={fornecedor && detalheFornecedor.isPending ? 'Carregando contratos…' : 'Sem contrato relacionado'}
              opcoes={contratos.map((c) => ({ valor: c.id, rotulo: `Contrato ${c.numero} — ${c.objeto}` }))}
              value={contratoId}
              disabled={!fornecedor}
              onChange={(e) => definirContratoId(e.target.value)}
            />
          </fieldset>

          <fieldset className="grupo-campos">
            <legend>Infração e sanção em análise</legend>
            <Selecao
              rotulo="Infração (art. 155)"
              obrigatorio
              opcaoVazia="Selecione…"
              opcoes={INFRACOES_ART_155.map((i) => ({ valor: i.inciso, rotulo: `Inciso ${i.inciso} — ${i.descricao}` }))}
              value={inciso}
              erro={erros.inciso}
              onChange={(e) => {
                const escolhido = INFRACOES_ART_155.find((i) => i.inciso === e.target.value)?.inciso ?? '';
                definirInciso(escolhido);
                if (escolhido === '' || !sancoesCabiveis(escolhido).some((s) => s.tipo === tipo)) definirTipo(null);
              }}
            />
            {inciso === '' ? (
              <p className="texto-pequeno texto-secundario">As sanções cabíveis (art. 156) aparecem após escolher a infração.</p>
            ) : (
              <GrupoOpcoes
                legenda="Sanção cabível em análise (art. 156)"
                nome="tipo-sancao"
                obrigatorio
                opcoes={cabiveis.map((s) => ({ valor: s.tipo, rotulo: TIPOS_SANCAO[s.tipo], ajuda: `${s.condicao} (${s.fundamento})` }))}
                valor={tipo}
                aoMudar={definirTipo}
                erro={erros.tipo}
              />
            )}
          </fieldset>

          <fieldset className="grupo-campos">
            <legend>Intimação e relato</legend>
            <CampoTexto
              rotulo="Data da intimação"
              type="date"
              obrigatorio
              value={intimacao}
              onChange={(e) => definirIntimacao(e.target.value)}
              erro={erros.intimacao}
              ajuda={
                prazo
                  ? `Prazo de defesa: ${formatarData(prazo.vencimento)} (15 dias úteis — arts. 157 e 158).`
                  : 'O prazo de defesa (15 dias úteis, arts. 157 e 158) é calculado a partir desta data.'
              }
            />
            <AreaTexto
              rotulo="Relato dos fatos"
              obrigatorio
              rows={5}
              maxLength={4000}
              contador
              value={relato}
              onChange={(e) => definirRelato(e.target.value)}
              erro={erros.relato}
              ajuda="Descreva a conduta, as datas e os documentos que a comprovam (número SEI)."
            />
          </fieldset>
        </form>
      </Dialogo>

      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => definirConfirmando(false)}
        titulo="Instaurar processo sancionatório"
        descricao={
          <div className="pilha pilha--compacta">
            <p>
              Instaurar processo contra <strong>{fornecedor?.razaoSocial}</strong> pela infração do{' '}
              <strong>art. 155, inciso {inciso}</strong>, com análise de <strong>{tipo ? TIPOS_SANCAO[tipo].toLowerCase() : ''}</strong>?
            </p>
            {prazo ? <p>Prazo de defesa: {formatarData(prazo.vencimento)}.</p> : null}
            <p className="processo-sancionatorio__aviso">
              A instauração não aplica penalidade. A decisão é humana, da autoridade competente, após contraditório e ampla defesa.
            </p>
          </div>
        }
        rotuloConfirmar="Instaurar processo"
        aoConfirmar={confirmar}
        processando={instaurar.isPending}
        erro={instaurar.error}
      />
    </>
  );
}

// ───────────────────────── Simulador de dosimetria ─────────────────────────

const GRAVIDADES: readonly { valor: EntradaDosimetria['gravidade']; rotulo: string }[] = [
  { valor: 'leve', rotulo: 'Leve' },
  { valor: 'media', rotulo: 'Média' },
  { valor: 'grave', rotulo: 'Grave' },
  { valor: 'gravissima', rotulo: 'Gravíssima' },
];

const AGRAVANTES = ['Reincidência', 'Prejuízo ao serviço público', 'Má-fé ou dolo comprovado', 'Vantagem indevida obtida'] as const;
const ATENUANTES = ['Primariedade', 'Colaboração com a apuração', 'Reparação espontânea do dano', 'Baixa gravidade do resultado'] as const;

function alternarItem(lista: readonly string[], item: string): string[] {
  return lista.includes(item) ? lista.filter((i) => i !== item) : [...lista, item];
}

function ResultadoSimulacao({ resultado }: { resultado: ResultadoDosimetria }) {
  return (
    <div className="resultado-simulacao" role="status">
      <h3 className="secao__titulo">Proposta de dosimetria</h3>
      <ListaDefinicoes
        colunas={4}
        itens={[
          { termo: 'Percentual calculado', valor: <span className="numero">{formatarPercentual(resultado.percentualCalculado, 2)}</span> },
          { termo: 'Percentual aplicado', valor: <strong className="numero">{formatarPercentual(resultado.percentualAplicado, 2)}</strong> },
          { termo: 'Valor proposto da multa', valor: <strong className="numero">{formatarMoeda(resultado.valorMulta)}</strong> },
          {
            termo: 'Limites legais (0,5% a 30%)',
            valor:
              resultado.limitado === 'minimo' ? (
                <Etiqueta tom="aviso" compacta>
                  Ajustado ao mínimo de 0,5%
                </Etiqueta>
              ) : resultado.limitado === 'maximo' ? (
                <Etiqueta tom="aviso" compacta>
                  Ajustado ao máximo de 30%
                </Etiqueta>
              ) : (
                <Etiqueta tom="sucesso" compacta>
                  Dentro dos limites
                </Etiqueta>
              ),
          },
        ]}
      />
      <div className="pilha pilha--compacta">
        <h4>Memória de cálculo</h4>
        <ol className="memoria-calculo">
          {resultado.memoriaCalculo.map((linha, i) => (
            <li key={i}>{linha}</li>
          ))}
        </ol>
      </div>
      <p className="texto-pequeno texto-secundario">Fundamento: {resultado.fundamento}</p>
      <Alerta tipo="aviso" titulo="Apoio à decisão — não aplica penalidade">
        <p>{resultado.aviso}</p>
        <p>A sanção é decidida pela autoridade competente; esta simulação não aplica penalidade.</p>
      </Alerta>
    </div>
  );
}

function SimuladorDosimetria() {
  const simular = useSimularDosimetria();
  const [valorContrato, definirValorContrato] = useState<Centavos | null>(null);
  const [gravidade, definirGravidade] = useState<EntradaDosimetria['gravidade']>('media');
  const [agravantes, definirAgravantes] = useState<string[]>([]);
  const [atenuantes, definirAtenuantes] = useState<string[]>([]);
  const [programaIntegridade, definirProgramaIntegridade] = useState(false);
  const [danoAdministracao, definirDanoAdministracao] = useState(false);
  const [erroValor, definirErroValor] = useState<string | null>(null);

  const calcular = (evento: FormEvent) => {
    evento.preventDefault();
    if (valorContrato === null || valorContrato <= 0) {
      definirErroValor('Informe o valor do contrato.');
      return;
    }
    definirErroValor(null);
    simular.mutate({ valorContrato, gravidade, agravantes, atenuantes, programaIntegridade, danoAdministracao });
  };

  return (
    <Secao
      titulo="Simulador de dosimetria da multa (art. 156)"
      id="dosimetria"
      descricao="Calcula uma proposta de percentual de multa entre 0,5% e 30% do valor do contrato (art. 156, § 3º), considerando as circunstâncias do § 1º. Não grava nada."
    >
      <form className="formulario" onSubmit={calcular} noValidate>
        <div className="formulario__linha">
          <CampoMoeda rotulo="Valor do contrato" obrigatorio valor={valorContrato} aoMudar={definirValorContrato} erro={erroValor} />
        </div>
        <GrupoOpcoes legenda="Gravidade da infração" nome="gravidade" horizontal opcoes={GRAVIDADES} valor={gravidade} aoMudar={definirGravidade} />
        <div className="formulario__linha">
          <fieldset className="grupo-campos">
            <legend>Agravantes</legend>
            {AGRAVANTES.map((a) => (
              <CaixaSelecao key={a} rotulo={a} checked={agravantes.includes(a)} onChange={() => definirAgravantes((l) => alternarItem(l, a))} />
            ))}
          </fieldset>
          <fieldset className="grupo-campos">
            <legend>Atenuantes</legend>
            {ATENUANTES.map((a) => (
              <CaixaSelecao key={a} rotulo={a} checked={atenuantes.includes(a)} onChange={() => definirAtenuantes((l) => alternarItem(l, a))} />
            ))}
          </fieldset>
        </div>
        <CaixaSelecao
          rotulo="O fornecedor comprova programa de integridade"
          ajuda="Implantação ou aperfeiçoamento de programa de integridade (art. 156, § 1º, V)."
          checked={programaIntegridade}
          onChange={(e) => definirProgramaIntegridade(e.target.checked)}
        />
        <CaixaSelecao
          rotulo="Houve dano à Administração"
          ajuda="Danos que da infração provierem para a Administração Pública (art. 156, § 1º, IV)."
          checked={danoAdministracao}
          onChange={(e) => definirDanoAdministracao(e.target.checked)}
        />
        <div className="linha">
          <Botao type="submit" variante="primario" icone={Calculator} carregando={simular.isPending}>
            Calcular proposta
          </Botao>
        </div>
      </form>
      {simular.isError ? (
        <Alerta tipo="erro" anunciar titulo="Não foi possível calcular">
          <p>{simular.error.message}</p>
        </Alerta>
      ) : null}
      {simular.data ? <ResultadoSimulacao resultado={simular.data} /> : null}
    </Secao>
  );
}

// ───────────────────────── Página ─────────────────────────

export default function Sancoes() {
  const { temPermissao } = useSessao();
  const podeInstruir = temPermissao('sancoes:instruir');
  const [instaurando, definirInstaurando] = useState(false);
  const p = useParametrosUrl();
  const filtro: FiltroSancoes = {
    situacao: p.opcao('situacao', chavesDe(SITUACOES_SANCAO)),
    tipo: p.opcao('tipo', chavesDe(TIPOS_SANCAO)),
    pagina: p.pagina,
    tamanhoPagina: p.tamanhoPagina,
  };
  const consulta = useSancoes(filtro);
  const filtrosAtivos = p.algumAtivo(FILTROS);
  const limpar = () => p.limpar(FILTROS);

  return (
    <Pagina
      titulo="Sanções"
      subtitulo="Processos sancionatórios de fornecedores (Lei 14.133/2021, arts. 155 a 163): instrução, defesa, decisão e registro no CEIS/CNEP."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="sancoes"
      acoes={
        podeInstruir ? (
          <Botao variante="primario" icone={Gavel} onClick={() => definirInstaurando(true)}>
            Instaurar processo
          </Botao>
        ) : null
      }
    >
      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : (
        <>
          <BarraFiltros
            total={consulta.data?.total}
            substantivo={['processo sancionatório', 'processos sancionatórios']}
            filtrosAtivos={filtrosAtivos}
            aoLimpar={limpar}
            rotulo="Filtros de sanções"
          >
            <Selecao
              rotulo="Situação"
              opcaoVazia="Todas"
              opcoes={opcoesDe(SITUACOES_SANCAO)}
              value={filtro.situacao ?? ''}
              onChange={(e) => p.atualizar({ situacao: e.target.value })}
            />
            <Selecao
              rotulo="Sanção"
              opcaoVazia="Todas"
              opcoes={opcoesDe(TIPOS_SANCAO)}
              value={filtro.tipo ?? ''}
              onChange={(e) => p.atualizar({ tipo: e.target.value })}
            />
          </BarraFiltros>
          <Tabela
            id="sancoes"
            legenda="Processos sancionatórios"
            colunas={COLUNAS}
            linhas={consulta.data?.itens}
            chave={(s) => s.id}
            atualizando={consulta.isFetching && consulta.data !== undefined}
            destaque={(s) => (s.situacao === 'defesa' || (!s.registradaCeisCnep && s.prazoRegistroCeisCnep !== null) ? 'aviso' : undefined)}
            vazio={
              <EstadoVazio
                icone={Gavel}
                titulo={filtrosAtivos ? 'Nenhum processo atende aos filtros' : 'Nenhum processo sancionatório registrado'}
                descricao={
                  filtrosAtivos
                    ? 'Revise os critérios ou limpe os filtros para ver todos os processos.'
                    : 'Os processos instaurados contra fornecedores aparecerão aqui, com prazos de defesa e de registro no CEIS/CNEP.'
                }
                acao={
                  filtrosAtivos ? (
                    <Botao variante="secundario" onClick={limpar}>
                      Limpar filtros
                    </Botao>
                  ) : null
                }
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
                  rotulo="Paginação dos processos sancionatórios"
                />
              ) : null
            }
          />
        </>
      )}
      <SimuladorDosimetria />
      {podeInstruir ? <DialogoInstaurar aberto={instaurando} aoFechar={() => definirInstaurando(false)} /> : null}
    </Pagina>
  );
}
