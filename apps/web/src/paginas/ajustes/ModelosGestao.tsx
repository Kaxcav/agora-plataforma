import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import type { ModeloGestao } from '@agora/contratos';
import { useModelosGestao, useSalvarModeloGestao, type EntradaModeloGestao } from '../../api/ajustes';
import {
  Alternador,
  BarraFiltros,
  Botao,
  CampoTexto,
  ConfirmarAcao,
  ConteudoConsulta,
  Dialogo,
  EsqueletoTabela,
  EstadoVazio,
  Etiqueta,
  GrupoOpcoes,
  Pagina,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { contar } from '../../utilitarios/formatacao';
import { useParametrosUrl } from '../../utilitarios/parametrosUrl';
import { chavesDe, opcoesDe } from '../compartilhado/rotulos';
import { AvisoSomenteLeitura, focarPrimeiroInvalido, ResumoErros } from './ErroFormulario';

type TipoModelo = ModeloGestao['tipo'];
type EventoModelo = ModeloGestao['evento'];
type TarefaModelo = ModeloGestao['tarefas'][number];
type Papel = TarefaModelo['papelResponsavel'];

const TIPOS: Record<TipoModelo, string> = { ata: 'Ata de registro de preços', contrato: 'Contrato' };

const EVENTOS: Record<EventoModelo, string> = {
  assinatura: 'Na assinatura',
  inicio_vigencia: 'No início da vigência',
  mensal: 'Mensal',
  reajuste: 'No reajuste',
  fim_vigencia: 'No fim da vigência',
};

const PAPEIS: Record<Papel, string> = { gestor: 'Gestor', fiscal: 'Fiscal', financeiro: 'Financeiro' };

const MINIMO_DIAS = -365;
const MAXIMO_DIAS = 1825;

/** 5 → "D+5"; −10 → "D−10"; 0 → "D". */
function prazoRelativo(dias: number): string {
  if (dias === 0) return 'D';
  return dias > 0 ? `D+${dias}` : `D−${Math.abs(dias)}`;
}

function descricaoPrazo(dias: number): string {
  if (dias === 0) return 'no dia do evento';
  const n = Math.abs(dias);
  return `${n} ${n === 1 ? 'dia' : 'dias'} ${dias > 0 ? 'após o evento' : 'antes do evento'}`;
}

type LinhaTarefa = TarefaModelo & { ordem: number };

const COLUNAS_TAREFAS: ColunaTabela<LinhaTarefa>[] = [
  { id: 'titulo', cabecalho: 'Tarefa', identificadora: true, fixa: true, celula: (t) => t.titulo },
  { id: 'macrotarefa', cabecalho: 'Macrotarefa', prioritaria: true, celula: (t) => t.macrotarefa },
  {
    id: 'prazo',
    cabecalho: 'Prazo relativo',
    prioritaria: true,
    celula: (t) => (
      <span className="numero" title={descricaoPrazo(t.diasRelativos)}>
        <span aria-hidden="true">{prazoRelativo(t.diasRelativos)}</span>
        <span className="sr-only">{descricaoPrazo(t.diasRelativos)}</span>
      </span>
    ),
  },
  { id: 'papel', cabecalho: 'Responsável', prioritaria: true, celula: (t) => PAPEIS[t.papelResponsavel] },
];

interface TarefaRascunho {
  chave: number;
  titulo: string;
  macrotarefa: string;
  dias: string;
  papel: Papel;
}

function tarefaVazia(chave: number): TarefaRascunho {
  return { chave, titulo: '', macrotarefa: '', dias: '0', papel: 'gestor' };
}

interface PropsFormulario {
  aberto: boolean;
  modelo: ModeloGestao | null;
  aoFechar: () => void;
}

function FormularioModelo({ aberto, modelo, aoFechar }: PropsFormulario) {
  const salvar = useSalvarModeloGestao();
  const { avisar } = useAvisos();
  const idFormulario = useId();
  const formulario = useRef<HTMLFormElement>(null);
  const botaoAdicionar = useRef<HTMLButtonElement>(null);
  const titulos = useRef(new Map<number, HTMLInputElement>());
  const sequencia = useRef(Math.max(1, modelo?.tarefas.length ?? 0));

  const [nome, definirNome] = useState(modelo?.nome ?? '');
  const [tipo, definirTipo] = useState<TipoModelo>(modelo?.tipo ?? 'contrato');
  const [evento, definirEvento] = useState<EventoModelo>(modelo?.evento ?? 'assinatura');
  const [ativo, definirAtivo] = useState(modelo?.ativo ?? true);
  const [tarefas, definirTarefas] = useState<TarefaRascunho[]>(() =>
    modelo && modelo.tarefas.length > 0
      ? modelo.tarefas.map((t, i) => ({ chave: i + 1, titulo: t.titulo, macrotarefa: t.macrotarefa, dias: String(t.diasRelativos), papel: t.papelResponsavel }))
      : [tarefaVazia(1)],
  );
  const [erros, definirErros] = useState<Record<string, string>>({});
  const [confirmando, definirConfirmando] = useState(false);
  const [focar, definirFocar] = useState<number | null>(null);

  useEffect(() => {
    if (focar === null) return;
    titulos.current.get(focar)?.focus();
    definirFocar(null);
  }, [focar]);

  const alterarTarefa = (chave: number, mudanca: Partial<TarefaRascunho>) =>
    definirTarefas((atuais) => atuais.map((t) => (t.chave === chave ? { ...t, ...mudanca } : t)));

  const adicionar = () => {
    sequencia.current += 1;
    const chave = sequencia.current;
    definirTarefas((atuais) => [...atuais, tarefaVazia(chave)]);
    definirFocar(chave);
  };

  const remover = (chave: number) => {
    definirTarefas((atuais) => atuais.filter((t) => t.chave !== chave));
    window.requestAnimationFrame(() => botaoAdicionar.current?.focus());
  };

  const validar = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (nome.trim().length < 3) e.nome = 'Informe o nome do modelo (mínimo de 3 caracteres).';
    if (tarefas.length === 0) e.tarefas = 'Inclua ao menos uma tarefa no modelo.';
    for (const t of tarefas) {
      if (!t.titulo.trim()) e[`${t.chave}-titulo`] = 'Informe o título da tarefa.';
      if (!t.macrotarefa.trim()) e[`${t.chave}-macrotarefa`] = 'Informe a macrotarefa (agrupador no plano de gestão).';
      const n = Number(t.dias);
      if (t.dias.trim() === '' || !Number.isInteger(n) || n < MINIMO_DIAS || n > MAXIMO_DIAS) {
        e[`${t.chave}-dias`] = `Use um número inteiro de dias entre ${MINIMO_DIAS} e ${MAXIMO_DIAS}.`;
      }
    }
    return e;
  };

  const enviar = (evento_: FormEvent) => {
    evento_.preventDefault();
    const encontrados = validar();
    definirErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(formulario.current);
      return;
    }
    salvar.reset();
    definirConfirmando(true);
  };

  const confirmar = () => {
    const entrada: EntradaModeloGestao = {
      tipo,
      nome: nome.trim(),
      evento,
      ativo,
      tarefas: tarefas.map((t) => ({
        titulo: t.titulo.trim(),
        macrotarefa: t.macrotarefa.trim(),
        diasRelativos: Number(t.dias),
        papelResponsavel: t.papel,
      })),
    };
    salvar.mutate(
      { id: modelo?.id ?? null, entrada },
      {
        onSuccess: (salvo) => {
          definirConfirmando(false);
          aoFechar();
          avisar({ tipo: 'sucesso', mensagem: modelo ? `Modelo “${salvo.nome}” atualizado.` : `Modelo “${salvo.nome}” criado.` });
        },
      },
    );
  };

  const quantidadeErros = Object.keys(erros).length;

  return (
    <>
      <Dialogo
        aberto={aberto}
        aoFechar={salvar.isPending ? () => undefined : aoFechar}
        titulo={modelo ? `Editar modelo “${modelo.nome}”` : 'Novo modelo de gestão'}
        largura="ampla"
        descricao={
          <p>
            As tarefas do modelo entram no plano de gestão dos instrumentos criados a partir de agora. Planos de gestão já existentes não são
            alterados.
          </p>
        }
        rodape={
          <>
            <Botao variante="secundario" onClick={aoFechar} disabled={salvar.isPending}>
              Cancelar
            </Botao>
            <Botao variante="primario" type="submit" form={idFormulario}>
              Revisar e salvar
            </Botao>
          </>
        }
      >
        <form id={idFormulario} ref={formulario} onSubmit={enviar} noValidate className="formulario">
          <ResumoErros quantidade={quantidadeErros} />
          <CampoTexto
            rotulo="Nome do modelo"
            obrigatorio
            maxLength={120}
            value={nome}
            onChange={(e) => definirNome(e.target.value)}
            erro={erros.nome}
            ajuda="Ex.: Gestão mensal de contratos de serviços contínuos."
          />
          <div className="formulario__linha">
            <GrupoOpcoes
              legenda="Tipo de instrumento"
              nome={`${idFormulario}-tipo`}
              obrigatorio
              horizontal
              opcoes={chavesDe(TIPOS).map((t) => ({ valor: t, rotulo: TIPOS[t] }))}
              valor={tipo}
              aoMudar={definirTipo}
            />
            <Selecao
              rotulo="Evento que gera as tarefas"
              obrigatorio
              opcoes={opcoesDe(EVENTOS)}
              value={evento}
              onChange={(e) => definirEvento(chavesDe(EVENTOS).find((v) => v === e.target.value) ?? 'assinatura')}
            />
          </div>
          <Alternador
            rotulo="Modelo ativo"
            ligado={ativo}
            aoMudar={definirAtivo}
            ajuda="Modelos inativos deixam de gerar tarefas para novos instrumentos."
          />
          <fieldset className="grupo-campos">
            <legend>Tarefas do modelo</legend>
            <p className="campo__ajuda">
              O prazo é contado em dias a partir do evento: use números negativos para tarefas anteriores ao evento (ex.: −30 para trinta dias
              antes do fim da vigência).
            </p>
            {erros.tarefas ? <p className="campo__erro">{erros.tarefas}</p> : null}
            {tarefas.map((t, indice) => (
              <fieldset key={t.chave} className="grupo-campos modelo-tarefa">
                <legend>Tarefa {indice + 1}</legend>
                <div className="formulario__linha">
                  <CampoTexto
                    ref={(el) => {
                      if (el) titulos.current.set(t.chave, el);
                      else titulos.current.delete(t.chave);
                    }}
                    rotulo="Título"
                    obrigatorio
                    maxLength={160}
                    value={t.titulo}
                    onChange={(e) => alterarTarefa(t.chave, { titulo: e.target.value })}
                    erro={erros[`${t.chave}-titulo`]}
                  />
                  <CampoTexto
                    rotulo="Macrotarefa"
                    obrigatorio
                    maxLength={80}
                    value={t.macrotarefa}
                    onChange={(e) => alterarTarefa(t.chave, { macrotarefa: e.target.value })}
                    erro={erros[`${t.chave}-macrotarefa`]}
                    ajuda="Agrupador, ex.: Fiscalização mensal."
                  />
                </div>
                <div className="formulario__linha">
                  <CampoTexto
                    rotulo="Dias em relação ao evento"
                    obrigatorio
                    type="number"
                    inputMode="numeric"
                    step={1}
                    min={MINIMO_DIAS}
                    max={MAXIMO_DIAS}
                    value={t.dias}
                    onChange={(e) => alterarTarefa(t.chave, { dias: e.target.value })}
                    erro={erros[`${t.chave}-dias`]}
                    ajuda={Number.isInteger(Number(t.dias)) && t.dias.trim() !== '' ? `${prazoRelativo(Number(t.dias))}: ${descricaoPrazo(Number(t.dias))}` : undefined}
                  />
                  <Selecao
                    rotulo="Papel responsável"
                    obrigatorio
                    opcoes={opcoesDe(PAPEIS)}
                    value={t.papel}
                    onChange={(e) => alterarTarefa(t.chave, { papel: chavesDe(PAPEIS).find((v) => v === e.target.value) ?? 'gestor' })}
                  />
                </div>
                <div className="modelo-tarefa__acoes">
                  <Botao
                    variante="terciario"
                    tamanho="compacto"
                    icone={Trash2}
                    onClick={() => remover(t.chave)}
                    aria-label={`Remover tarefa ${indice + 1}${t.titulo.trim() ? `: ${t.titulo.trim()}` : ''}`}
                  >
                    Remover
                  </Botao>
                </div>
              </fieldset>
            ))}
            <div>
              <Botao ref={botaoAdicionar} variante="secundario" icone={Plus} onClick={adicionar}>
                Adicionar tarefa
              </Botao>
            </div>
          </fieldset>
        </form>
      </Dialogo>
      <ConfirmarAcao
        aberto={confirmando}
        aoFechar={() => definirConfirmando(false)}
        titulo="Salvar modelo de gestão"
        descricao={
          <p>
            Salvar o modelo <strong>{nome.trim()}</strong> com {contar(tarefas.length, 'tarefa', 'tarefas')}? As alterações valem para os
            instrumentos criados a partir de agora e ficam registradas na trilha de auditoria.
          </p>
        }
        rotuloConfirmar="Salvar modelo de gestão"
        aoConfirmar={confirmar}
        processando={salvar.isPending}
        erro={salvar.error}
      />
    </>
  );
}

function CartaoModelo({ modelo, podeEditar, aoEditar }: { modelo: ModeloGestao; podeEditar: boolean; aoEditar: () => void }) {
  const linhas: LinhaTarefa[] = modelo.tarefas.map((t, i) => ({ ...t, ordem: i + 1 }));
  return (
    <Secao
      id={`modelo-${modelo.id}`}
      titulo={modelo.nome}
      descricao={
        <span className="linha">
          <span>
            {TIPOS[modelo.tipo]} · {EVENTOS[modelo.evento]}
          </span>
          {modelo.ativo ? (
            <Etiqueta tom="sucesso" compacta>
              Ativo
            </Etiqueta>
          ) : (
            <Etiqueta tom="neutro" compacta>
              Inativo
            </Etiqueta>
          )}
        </span>
      }
      acoes={
        podeEditar ? (
          <Botao variante="secundario" tamanho="compacto" icone={Pencil} onClick={aoEditar} aria-label={`Editar modelo ${modelo.nome}`}>
            Editar
          </Botao>
        ) : null
      }
    >
      <Tabela
        id={`modelo-tarefas-${modelo.id}`}
        legenda={`Tarefas do modelo ${modelo.nome}`}
        semFerramentas
        colunas={COLUNAS_TAREFAS}
        linhas={linhas}
        chave={(t) => String(t.ordem)}
        vazio={<EstadoVazio icone={ListChecks} titulo="Modelo sem tarefas" descricao="Edite o modelo para incluir as tarefas do plano de gestão." />}
      />
    </Secao>
  );
}

export default function ModelosGestao() {
  const p = useParametrosUrl();
  const tipo = p.opcao('tipo', chavesDe(TIPOS));
  const consulta = useModelosGestao(tipo);
  const { temPermissao } = useSessao();
  const podeEditar = temPermissao('ajustes:editar');
  const [formulario, definirFormulario] = useState<{ chave: number; modelo: ModeloGestao | null; aberto: boolean }>({
    chave: 0,
    modelo: null,
    aberto: false,
  });

  const abrir = (modelo: ModeloGestao | null) => definirFormulario((f) => ({ chave: f.chave + 1, modelo, aberto: true }));
  const fechar = () => definirFormulario((f) => ({ ...f, aberto: false }));

  return (
    <Pagina
      titulo="Modelos de gestão"
      subtitulo="Tarefas padrão que formam o plano de gestão de cada ata ou contrato a partir de um evento (assinatura, vigência, reajuste)."
      trilha={[{ rotulo: 'Início', para: '/' }, { rotulo: 'Ajustes' }]}
      tela="ajustes"
      acoes={
        podeEditar ? (
          <Botao variante="primario" icone={Plus} onClick={() => abrir(null)}>
            Novo modelo
          </Botao>
        ) : null
      }
    >
      {podeEditar ? null : <AvisoSomenteLeitura />}
      <BarraFiltros
        total={consulta.data?.length}
        substantivo={['modelo', 'modelos']}
        filtrosAtivos={tipo !== undefined}
        aoLimpar={() => p.limpar(['tipo'])}
        rotulo="Filtros de modelos de gestão"
      >
        <Selecao
          rotulo="Tipo de instrumento"
          opcaoVazia="Todos"
          opcoes={opcoesDe(TIPOS)}
          value={tipo ?? ''}
          onChange={(e) => p.atualizar({ tipo: e.target.value })}
        />
      </BarraFiltros>
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoTabela linhas={4} colunas={4} />} rotuloCarregando="Carregando modelos de gestão">
        {(modelos) =>
          modelos.length === 0 ? (
            <EstadoVazio
              icone={ListChecks}
              titulo={tipo ? 'Nenhum modelo para este tipo de instrumento' : 'Nenhum modelo de gestão cadastrado'}
              descricao={
                tipo
                  ? 'Limpe o filtro para ver todos os modelos.'
                  : 'Sem modelos, os planos de gestão dos novos instrumentos começam vazios.'
              }
              acao={
                tipo ? (
                  <Botao variante="secundario" onClick={() => p.limpar(['tipo'])}>
                    Limpar filtros
                  </Botao>
                ) : podeEditar ? (
                  <Botao variante="primario" icone={Plus} onClick={() => abrir(null)}>
                    Novo modelo
                  </Botao>
                ) : null
              }
            />
          ) : (
            <div className="pilha pilha--ampla">
              {modelos.map((m) => (
                <CartaoModelo key={m.id} modelo={m} podeEditar={podeEditar} aoEditar={() => abrir(m)} />
              ))}
            </div>
          )
        }
      </ConteudoConsulta>
      {podeEditar ? <FormularioModelo key={formulario.chave} aberto={formulario.aberto} modelo={formulario.modelo} aoFechar={fechar} /> : null}
    </Pagina>
  );
}
