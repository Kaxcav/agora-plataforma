/**
 * Declaração de inexistência de impedimento do próprio agente (RN-28; Lei 14.133/2021, art. 7º, I a III, e art. 9º,
 * § 1º). Sem declaração válida, a designação da equipe recusa o agente: ele só atua no processo depois de declarar.
 */
import { useState, type FormEvent } from 'react';
import { PenLine, Plus, Trash2 } from 'lucide-react';
import type { CapacitacaoAgente, MinhaDeclaracao as DadosDeclaracao, NaturezaVinculo, VinculoFuncional } from '@agora/contratos';
import { CAPACITACOES_AGENTE, formatarData, VINCULOS_FUNCIONAIS } from '@agora/dominio';
import { useAssinarDeclaracao, useMinhaDeclaracao } from '../../api/impedimentos';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  CampoTexto,
  ConteudoConsulta,
  EsqueletoDetalhe,
  Etiqueta,
  GrupoOpcoes,
  Pagina,
  Secao,
  Selecao,
  Tabela,
  useAvisos,
  type ColunaTabela,
} from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { rotuloPapel } from '../jornada/rotulos';
import { NATUREZAS_VINCULO, SeletorFornecedor } from './comum';

type PapelAptidao = DadosDeclaracao['aptidao']['papeis'][number];

const COLUNAS_PAPEIS: ColunaTabela<PapelAptidao>[] = [
  { id: 'papel', cabecalho: 'Papel no processo', identificadora: true, celula: (p) => rotuloPapel(p.papel) },
  {
    id: 'apto',
    cabecalho: 'Pode atuar?',
    celula: (p) =>
      p.apto ? (
        <Etiqueta tom="sucesso" compacta>
          Sim
        </Etiqueta>
      ) : (
        <Etiqueta tom="erro" compacta>
          Não
        </Etiqueta>
      ),
  },
  { id: 'detalhe', cabecalho: 'Por quê', celula: (p) => [...p.pendencias, ...p.sinais].join(' ') || 'Requisitos atendidos.' },
];

interface VinculoDeclarado {
  chave: string;
  fornecedor: { id: string; nome: string };
  natureza: NaturezaVinculo;
  grauParentesco: 1 | 2 | 3 | null;
  descricao: string;
}

function FormularioDeclaracao({ dados }: { dados: DadosDeclaracao }) {
  const { avisar } = useAvisos();
  const assinar = useAssinarDeclaracao();
  const anterior = dados.declaracao;
  const [semParentesco, definirSemParentesco] = useState(false);
  const [semConflito, definirSemConflito] = useState(false);
  const [vinculo, definirVinculo] = useState<VinculoFuncional>(anterior?.vinculo ?? 'servidor_efetivo');
  const [cargo, definirCargo] = useState(anterior?.cargoMatricula ?? '');
  const [capacitacao, definirCapacitacao] = useState<CapacitacaoAgente | null>(anterior?.capacitacao ?? null);
  const [descricaoCapacitacao, definirDescricaoCapacitacao] = useState(anterior?.capacitacaoDescricao ?? '');
  const [vinculos, definirVinculos] = useState<VinculoDeclarado[]>([]);
  const [novoFornecedor, definirNovoFornecedor] = useState<{ id: string; nome: string } | null>(null);
  const [novaNatureza, definirNovaNatureza] = useState<NaturezaVinculo | ''>('');
  const [novoGrau, definirNovoGrau] = useState<'1' | '2' | '3' | null>(null);
  const [novaDescricao, definirNovaDescricao] = useState('');
  const [erros, definirErros] = useState<Record<string, string>>({});

  const adicionarVinculo = () => {
    const novos: Record<string, string> = {};
    if (!novoFornecedor) novos.novoFornecedor = 'Selecione a empresa.';
    if (novaNatureza === '') novos.novaNatureza = 'Selecione a natureza.';
    if (novaNatureza === 'parentesco' && novoGrau === null) novos.novoGrau = 'Informe o grau.';
    if (novaDescricao.trim().length < 10) novos.novaDescricao = 'Descreva com pelo menos 10 caracteres.';
    definirErros(novos);
    if (Object.keys(novos).length > 0 || !novoFornecedor || novaNatureza === '') return;
    definirVinculos((l) => [
      ...l,
      {
        chave: `${novoFornecedor.id}-${l.length}`,
        fornecedor: novoFornecedor,
        natureza: novaNatureza,
        grauParentesco: novaNatureza === 'parentesco' && novoGrau ? (Number(novoGrau) as 1 | 2 | 3) : null,
        descricao: novaDescricao.trim(),
      },
    ]);
    definirNovoFornecedor(null);
    definirNovaNatureza('');
    definirNovoGrau(null);
    definirNovaDescricao('');
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const novos: Record<string, string> = {};
    if (capacitacao === null) novos.capacitacao = 'Informe a capacitação (art. 7º, II).';
    if (capacitacao !== null && capacitacao !== 'nenhuma' && descricaoCapacitacao.trim().length < 10) {
      novos.descricaoCapacitacao = 'Descreva a capacitação com pelo menos 10 caracteres.';
    }
    definirErros(novos);
    if (Object.keys(novos).length > 0 || capacitacao === null) return;
    assinar.mutate(
      {
        semParentescoOuVinculo: semParentesco,
        semConflitoInteresses: semConflito,
        vinculo,
        cargoMatricula: cargo.trim() || null,
        capacitacao,
        capacitacaoDescricao: capacitacao === 'nenhuma' ? null : descricaoCapacitacao.trim(),
        vinculosDeclarados: vinculos.map((v) => ({ fornecedorId: v.fornecedor.id, natureza: v.natureza, grauParentesco: v.grauParentesco, descricao: v.descricao })),
      },
      {
        onSuccess: (r) => {
          definirVinculos([]);
          avisar({
            tipo: 'sucesso',
            titulo: 'Declaração assinada',
            mensagem: r.declaracao ? `Válida até ${formatarData(r.declaracao.validaAte)}.` : 'Declaração registrada.',
          });
        },
      },
    );
  };

  return (
    <form className="formulario" onSubmit={enviar} noValidate>
      <fieldset className="grupo-campos">
        <legend>Inexistência de impedimento</legend>
        <CaixaSelecao
          rotulo="Declaro que não sou cônjuge ou companheiro de licitantes ou contratados habituais da Administração nem tenho com eles parentesco, colateral ou por afinidade, até o 3º grau, ou vínculo técnico, comercial, econômico, financeiro, trabalhista ou civil (art. 7º, III)."
          checked={semParentesco}
          onChange={(e) => definirSemParentesco(e.target.checked)}
        />
        <CaixaSelecao
          rotulo="Declaro que não participo, direta ou indiretamente, de licitação ou de execução de contrato em situação de conflito de interesses (art. 9º, § 1º)."
          checked={semConflito}
          onChange={(e) => definirSemConflito(e.target.checked)}
        />
        {!semParentesco || !semConflito ? (
          <p className="texto-pequeno texto-secundario">Sem as duas afirmações, a declaração fica registrada, mas você não poderá ser designado.</p>
        ) : null}
      </fieldset>

      <fieldset className="grupo-campos">
        <legend>Vínculo funcional e capacitação (art. 7º, I e II)</legend>
        <Selecao
          rotulo="Vínculo com a Administração"
          obrigatorio
          opcoes={Object.entries(VINCULOS_FUNCIONAIS).map(([valor, rotulo]) => ({ valor, rotulo }))}
          value={vinculo}
          onChange={(e) => {
            const valor = e.target.value;
            if (valor in VINCULOS_FUNCIONAIS) definirVinculo(valor as VinculoFuncional);
          }}
          ajuda="Agente de contratação e pregoeiro são servidores efetivos ou empregados públicos permanentes (art. 8º)."
        />
        <CampoTexto rotulo="Cargo e matrícula" value={cargo} maxLength={200} onChange={(e) => definirCargo(e.target.value)} />
        <GrupoOpcoes
          legenda="Capacitação"
          nome="declaracao-capacitacao"
          obrigatorio
          opcoes={Object.entries(CAPACITACOES_AGENTE).map(([valor, rotulo]) => ({ valor: valor as CapacitacaoAgente, rotulo }))}
          valor={capacitacao}
          aoMudar={definirCapacitacao}
          erro={erros.capacitacao}
        />
        {capacitacao !== null && capacitacao !== 'nenhuma' ? (
          <AreaTexto
            rotulo="Descrição da capacitação"
            obrigatorio
            rows={2}
            maxLength={1000}
            value={descricaoCapacitacao}
            onChange={(e) => definirDescricaoCapacitacao(e.target.value)}
            erro={erros.descricaoCapacitacao}
            ajuda="Cargo com atribuições em licitações, curso, escola de governo e ano."
          />
        ) : null}
      </fieldset>

      <fieldset className="grupo-campos">
        <legend>Vínculos com empresas (opcional)</legend>
        <p className="texto-pequeno texto-secundario">
          Informe empresas com as quais você tem algum vínculo, mesmo que não sejam contratadas habituais. A Ágora avisará (RIA-10) se alguma delas
          participar de processo em que você atue.
        </p>
        {vinculos.length > 0 ? (
          <ul className="lista-simples pilha pilha--compacta" aria-label="Vínculos a declarar">
            {vinculos.map((v) => (
              <li key={v.chave} className="linha">
                <span>
                  {v.fornecedor.nome} — {NATUREZAS_VINCULO[v.natureza]}
                  {v.grauParentesco ? ` (${v.grauParentesco}º grau)` : ''}: {v.descricao}
                </span>
                <Botao
                  variante="terciario"
                  tamanho="compacto"
                  somenteIcone
                  icone={Trash2}
                  aria-label={`Remover vínculo com ${v.fornecedor.nome}`}
                  onClick={() => definirVinculos((l) => l.filter((x) => x.chave !== v.chave))}
                />
              </li>
            ))}
          </ul>
        ) : null}
        <SeletorFornecedor rotulo="Empresa" nome="declaracao-empresa" selecionado={novoFornecedor} aoSelecionar={definirNovoFornecedor} erro={erros.novoFornecedor} ativo />
        <Selecao
          rotulo="Natureza do vínculo"
          opcaoVazia="Selecione…"
          opcoes={Object.entries(NATUREZAS_VINCULO).map(([valor, rotulo]) => ({ valor, rotulo }))}
          value={novaNatureza}
          onChange={(e) => {
            const valor = e.target.value;
            definirNovaNatureza(valor in NATUREZAS_VINCULO ? (valor as NaturezaVinculo) : '');
          }}
          erro={erros.novaNatureza}
        />
        {novaNatureza === 'parentesco' ? (
          <GrupoOpcoes
            legenda="Grau de parentesco"
            nome="declaracao-grau"
            horizontal
            opcoes={[
              { valor: '1', rotulo: '1º grau' },
              { valor: '2', rotulo: '2º grau' },
              { valor: '3', rotulo: '3º grau' },
            ]}
            valor={novoGrau}
            aoMudar={definirNovoGrau}
            erro={erros.novoGrau}
          />
        ) : null}
        <CampoTexto rotulo="Descrição do vínculo" value={novaDescricao} maxLength={1000} onChange={(e) => definirNovaDescricao(e.target.value)} erro={erros.novaDescricao} />
        <div>
          <Botao variante="secundario" icone={Plus} onClick={adicionarVinculo}>
            Adicionar vínculo
          </Botao>
        </div>
      </fieldset>

      {assinar.isError ? (
        <Alerta tipo="erro" anunciar titulo="Não foi possível assinar a declaração">
          <p>{assinar.error.message}</p>
        </Alerta>
      ) : null}
      <div className="linha">
        <Botao type="submit" variante="primario" icone={PenLine} carregando={assinar.isPending}>
          Assinar declaração
        </Botao>
      </div>
    </form>
  );
}

function Conteudo({ dados }: { dados: DadosDeclaracao }) {
  const d = dados.declaracao;
  const aptoAlgum = dados.aptidao.papeis.some((p) => p.apto);
  return (
    <>
      {d === null ? (
        <Alerta tipo="aviso" titulo="Você ainda não assinou a declaração">
          <p>Sem ela, você não pode ser designado para atuar em processos (RN-28). Assine abaixo.</p>
        </Alerta>
      ) : d.situacao === 'vencida' ? (
        <Alerta tipo="aviso" titulo="Sua declaração venceu">
          <p>Venceu em {formatarData(d.validaAte)}. Assine uma nova declaração para voltar a atuar.</p>
        </Alerta>
      ) : (
        <Alerta tipo={aptoAlgum ? 'sucesso' : 'aviso'} titulo={`Declaração assinada em ${formatarInstante(d.declaradaEm)}`}>
          <p>
            Válida até {formatarData(d.validaAte)}. {d.vinculosDeclarados.length > 0 ? `${d.vinculosDeclarados.length} vínculo(s) declarado(s).` : 'Nenhum vínculo declarado.'}
          </p>
        </Alerta>
      )}
      <Secao titulo="Em que papéis você pode atuar" id="aptidao" descricao="Conferência dos requisitos dos arts. 7º, 8º e 9º com a sua declaração atual.">
        <Tabela
          id="aptidao-papeis"
          legenda="Aptidão por papel no processo"
          colunas={COLUNAS_PAPEIS}
          linhas={dados.aptidao.papeis}
          chave={(p) => p.papel}
          semFerramentas
        />
      </Secao>
      <Secao
        titulo={d ? 'Renovar a declaração' : 'Assinar a declaração'}
        id="assinar"
        descricao="A declaração vale por 12 meses e deve ser renovada sempre que surgir situação de impedimento. A nova declaração substitui a anterior."
      >
        <FormularioDeclaracao dados={dados} />
      </Secao>
    </>
  );
}

export default function MinhaDeclaracao() {
  const consulta = useMinhaDeclaracao();
  return (
    <Pagina
      titulo="Minha declaração de impedimentos"
      subtitulo="Declaração de inexistência de impedimento do agente público (Lei 14.133/2021, arts. 7º e 9º)."
      trilha={[{ rotulo: 'Início', para: '/' }]}
      tela="impedimentos.declaracao"
      estreita
    >
      <ConteudoConsulta consulta={consulta} carregando={<EsqueletoDetalhe />} rotuloCarregando="Carregando a sua declaração">
        {(dados) => <Conteudo dados={dados} />}
      </ConteudoConsulta>
    </Pagina>
  );
}
