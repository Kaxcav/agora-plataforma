/**
 * Aba "Ocorrências da execução" do contrato (art. 117; RIA-12): a fiscalização registra ocorrências, glosas,
 * atrasos e rescisões e a solução de cada uma. Junto aparecem os fatos que a Ágora deriva dos registros (aditivos
 * acima de 15%, sanções e avaliações baixas). É a base das lições aprendidas sugeridas em novos DFD, ETP e TR.
 */
import { useId, useState, type FormEvent } from 'react';
import { CheckCheck, NotebookPen, Plus } from 'lucide-react';
import type { CategoriaLicao, ContratoDetalhe, OcorrenciaExecucao, TipoOcorrenciaExecucao } from '@agora/contratos';
import { formatarData, formatarMoeda, hojeISO } from '@agora/dominio';
import { useOcorrenciasContrato, useRegistrarOcorrencia, useSolucionarOcorrencia } from '../../api/licoes';
import { AreaTexto, Botao, CampoMoeda, CampoTexto, ConteudoConsulta, Dialogo, EstadoVazio, Etiqueta, Secao, Selecao, Tabela, useAvisos } from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { ErroOperacao } from '../jornada/comum';

const TIPOS: Record<TipoOcorrenciaExecucao, string> = { ocorrencia: 'Ocorrência', glosa: 'Glosa', atraso: 'Atraso', rescisao: 'Rescisão' };
export const CATEGORIAS_LICAO: Record<CategoriaLicao, string> = {
  prazo: 'Prazos de entrega',
  qualidade: 'Qualidade do objeto',
  nivel_servico: 'Níveis de serviço',
  garantia: 'Garantia e inexecução',
  quantitativo: 'Quantidades estimadas',
  fiscalizacao: 'Gestão e fiscalização',
};
const SITUACOES: Record<OcorrenciaExecucao['situacao'], string> = {
  aberta: 'Em aberto',
  resolvida_no_prazo: 'Resolvida no prazo',
  resolvida_fora_do_prazo: 'Resolvida fora do prazo',
};
const NOMES_FATO: Record<string, string> = { aditivo: 'Aditivo', sancao: 'Sanção', avaliacao: 'Avaliação de desempenho', rescisao: 'Rescisão assinada' };

function ehTipo(v: string): v is TipoOcorrenciaExecucao {
  return v in TIPOS;
}
function ehCategoria(v: string): v is CategoriaLicao {
  return v in CATEGORIAS_LICAO;
}

function DialogoRegistrar({ contrato, aberto, aoFechar }: { contrato: ContratoDetalhe; aberto: boolean; aoFechar: () => void }) {
  const base = useId();
  const { avisar } = useAvisos();
  const registrar = useRegistrarOcorrencia(contrato.id);
  const [tipo, definirTipo] = useState<TipoOcorrenciaExecucao>('ocorrencia');
  const [categoria, definirCategoria] = useState<CategoriaLicao | ''>('');
  const [data, definirData] = useState(hojeISO(new Date()));
  const [descricao, definirDescricao] = useState('');
  const [dias, definirDias] = useState('');
  const [glosa, definirGlosa] = useState<number | null>(null);
  const [tentou, definirTentou] = useState(false);
  const idFormulario = `${base}-formulario`;
  const erroDescricao = descricao.trim().length < 15 ? 'Descreva o fato com ao menos 15 caracteres.' : null;
  const erroDias = tipo === 'atraso' && !/^[1-9]\d*$/.test(dias.trim()) ? 'Informe os dias de atraso.' : null;
  const erroGlosa = tipo === 'glosa' && (glosa === null || glosa <= 0) ? 'Informe o valor glosado.' : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    definirTentou(true);
    if (erroDescricao || erroDias || erroGlosa) return;
    registrar.mutate(
      {
        tipo,
        categoria: categoria === '' ? null : categoria,
        data,
        descricao: descricao.trim(),
        diasAtraso: tipo === 'atraso' ? Number(dias) : null,
        valorGlosa: tipo === 'glosa' ? glosa : null,
      },
      {
        onSuccess: () => {
          avisar({ tipo: 'sucesso', titulo: 'Ocorrência registrada', mensagem: 'O fato entra na base de lições aprendidas da Ágora.' });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={aoFechar}
      titulo={`Registrar ocorrência — Contrato ${contrato.numero}`}
      descricao={<p>Registro próprio da fiscalização (art. 117, § 1º). O fato ajuda a sugerir cláusulas melhores nas próximas contratações do mesmo objeto.</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={registrar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={idFormulario} carregando={registrar.isPending}>
            Registrar
          </Botao>
        </>
      }
    >
      <form id={idFormulario} className="formulario" onSubmit={enviar} noValidate>
        <div className="formulario__linha">
          <Selecao
            rotulo="Tipo"
            opcoes={Object.entries(TIPOS).map(([valor, rotulo]) => ({ valor, rotulo }))}
            value={tipo}
            onChange={(e) => {
              if (ehTipo(e.target.value)) definirTipo(e.target.value);
            }}
          />
          <Selecao
            rotulo="Categoria da lição"
            opcaoVazia="Conforme o tipo"
            opcoes={Object.entries(CATEGORIAS_LICAO).map(([valor, rotulo]) => ({ valor, rotulo }))}
            value={categoria}
            onChange={(e) => definirCategoria(ehCategoria(e.target.value) ? e.target.value : '')}
          />
          <CampoTexto id={`${base}-data`} rotulo="Data" type="date" value={data} onChange={(e) => definirData(e.target.value)} />
        </div>
        {tipo === 'atraso' ? (
          <CampoTexto id={`${base}-dias`} rotulo="Dias de atraso" inputMode="numeric" value={dias} erro={tentou ? erroDias : null} onChange={(e) => definirDias(e.target.value)} />
        ) : null}
        {tipo === 'glosa' ? <CampoMoeda rotulo="Valor glosado" valor={glosa} aoMudar={definirGlosa} erro={tentou ? erroGlosa : null} /> : null}
        <AreaTexto rotulo="Descrição do fato" obrigatorio rows={3} maxLength={2000} value={descricao} erro={tentou ? erroDescricao : null} onChange={(e) => definirDescricao(e.target.value)} />
        <ErroOperacao erro={registrar.error} titulo="A ocorrência não foi registrada" />
      </form>
    </Dialogo>
  );
}

function BotaoSolucao({ contratoId, ocorrencia }: { contratoId: string; ocorrencia: OcorrenciaExecucao }) {
  const { avisar } = useAvisos();
  const solucionar = useSolucionarOcorrencia(contratoId);
  const registrar = (situacao: 'resolvida_no_prazo' | 'resolvida_fora_do_prazo') =>
    solucionar.mutate(
      { id: ocorrencia.id, entrada: { situacao, resolvidaEm: hojeISO(new Date()) } },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Solução registrada', mensagem: SITUACOES[situacao] }) },
    );
  return (
    <div className="linha">
      <Botao tamanho="compacto" icone={CheckCheck} carregando={solucionar.isPending} onClick={() => registrar('resolvida_no_prazo')} aria-label={`Resolvida no prazo — ocorrência de ${formatarData(ocorrencia.data)}`}>
        No prazo
      </Botao>
      <Botao tamanho="compacto" variante="terciario" disabled={solucionar.isPending} onClick={() => registrar('resolvida_fora_do_prazo')} aria-label={`Resolvida fora do prazo — ocorrência de ${formatarData(ocorrencia.data)}`}>
        Fora do prazo
      </Botao>
    </div>
  );
}

export function AbaOcorrenciasContrato({ contrato }: { contrato: ContratoDetalhe }) {
  const consulta = useOcorrenciasContrato(contrato.id);
  const { temPermissao } = useSessao();
  const podeRegistrar = temPermissao('licoes:registrar');
  const [registrando, definirRegistrando] = useState(false);
  const [aberturas, definirAberturas] = useState(0);
  return (
    <ConteudoConsulta consulta={consulta} rotuloCarregando="Carregando as ocorrências da execução">
      {(base) => (
        <div className="pilha">
          {podeRegistrar ? (
            <div className="linha">
              <Botao
                variante="primario"
                icone={Plus}
                onClick={() => {
                  definirAberturas((n) => n + 1);
                  definirRegistrando(true);
                }}
              >
                Registrar ocorrência
              </Botao>
            </div>
          ) : null}
          <Tabela<OcorrenciaExecucao>
            id="contrato-ocorrencias-execucao"
            legenda={`Ocorrências da execução do contrato ${contrato.numero}`}
            semFerramentas
            linhas={base.ocorrencias}
            chave={(o) => o.id}
            colunas={[
              { id: 'data', cabecalho: 'Data', identificadora: true, fixa: true, celula: (o) => <span className="numero">{formatarData(o.data)}</span> },
              { id: 'tipo', cabecalho: 'Tipo', prioritaria: true, celula: (o) => TIPOS[o.tipo] },
              { id: 'categoria', cabecalho: 'Categoria', celula: (o) => CATEGORIAS_LICAO[o.categoria] },
              {
                id: 'descricao',
                cabecalho: 'Descrição',
                prioritaria: true,
                larguraMinima: '16rem',
                celula: (o) => (
                  <>
                    {o.descricao}
                    {o.diasAtraso ? ` (${o.diasAtraso} dia(s) de atraso)` : ''}
                    {o.valorGlosa ? ` (glosa de ${formatarMoeda(o.valorGlosa)})` : ''}
                  </>
                ),
              },
              {
                id: 'situacao',
                cabecalho: 'Situação',
                celula: (o) => (
                  <Etiqueta tom={o.situacao === 'aberta' ? 'aviso' : o.situacao === 'resolvida_no_prazo' ? 'sucesso' : 'neutro'} compacta>
                    {SITUACOES[o.situacao]}
                  </Etiqueta>
                ),
              },
            ]}
            acoes={podeRegistrar ? { cabecalho: 'Solução', celula: (o) => (o.situacao === 'aberta' ? <BotaoSolucao contratoId={contrato.id} ocorrencia={o} /> : null) } : undefined}
            vazio={<EstadoVazio icone={NotebookPen} titulo="Nenhuma ocorrência registrada" descricao="Os fatos registrados pela fiscalização aparecem aqui." />}
          />
          <Secao titulo="Fatos derivados dos registros da Ágora" simples nivel={3}>
            {base.fatosDerivados.length === 0 ? (
              <p className="texto-secundario">Nenhum aditivo acima de 15%, sanção aplicada ou avaliação abaixo de 60 neste contrato.</p>
            ) : (
              <ul>
                {base.fatosDerivados.map((f, i) => (
                  <li key={`${f.tipo}-${f.data}-${i}`}>
                    <span className="numero">{formatarData(f.data)}</span> — {NOMES_FATO[f.tipo] ?? f.tipo} ({CATEGORIAS_LICAO[f.categoria]}): {f.descricao}
                  </li>
                ))}
              </ul>
            )}
          </Secao>
          {registrando ? <DialogoRegistrar key={aberturas} contrato={contrato} aberto aoFechar={() => definirRegistrando(false)} /> : null}
        </div>
      )}
    </ConteudoConsulta>
  );
}
