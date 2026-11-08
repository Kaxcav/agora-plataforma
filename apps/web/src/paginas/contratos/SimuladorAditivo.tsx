import { useRef, useState, type FormEvent } from 'react';
import { Calculator, CircleCheck, CircleX } from 'lucide-react';
import type { ContratoDetalhe, EntradaSimularAditivo, ResultadoSimulacaoAditivo } from '@agora/contratos';
import { formatarMoeda, type Centavos } from '@agora/dominio';
import { ErroApi, mensagemDeErro } from '../../api/cliente';
import { useSimularAditivo } from '../../api/contratos';
import { Alerta, BarraProgresso, Botao, CaixaSelecao, CampoMoeda, Etiqueta, GrupoOpcoes, ListaDefinicoes, Secao } from '../../componentes';
import { formatarPercentual } from '../../utilitarios/formatacao';

type TipoSimulacao = EntradaSimularAditivo['tipo'];

const TIPOS: readonly { valor: TipoSimulacao; rotulo: string; ajuda: string }[] = [
  { valor: 'acrescimo', rotulo: 'Acréscimo', ajuda: 'Aumento quantitativo do objeto' },
  { valor: 'supressao', rotulo: 'Supressão', ajuda: 'Redução quantitativa do objeto' },
];

function ResultadoSimulacao({ resultado, tipo }: { resultado: ResultadoSimulacaoAditivo; tipo: TipoSimulacao }) {
  const proporcao = resultado.limitePercentual > 0 ? (resultado.percentualAcumulado / resultado.limitePercentual) * 100 : 0;
  const nomeTipo = tipo === 'acrescimo' ? 'acréscimos' : 'supressões';
  const regular = resultado.regularidadeFornecedor.regular;
  return (
    <div className="resultado-simulacao">
      <div className="linha linha--entre">
        <h3 className="secao__titulo">Resultado da simulação</h3>
        {resultado.permitido ? (
          <Etiqueta tom="sucesso" icone={CircleCheck}>
            Dentro do limite legal
          </Etiqueta>
        ) : (
          <Etiqueta tom="erro" icone={CircleX}>
            Acima do limite legal
          </Etiqueta>
        )}
      </div>
      <div className="medidor">
        <div className="medidor__linha">
          <span className="medidor__rotulo">Acumulado de {nomeTipo}</span>
          <BarraProgresso
            valor={proporcao}
            rotulo={`Percentual acumulado de ${nomeTipo} em relação ao limite de ${formatarPercentual(resultado.limitePercentual, 0)}`}
            textoValor={`${formatarPercentual(resultado.percentualAcumulado)} de ${formatarPercentual(resultado.limitePercentual, 0)}`}
            tom={!resultado.permitido ? 'erro' : proporcao >= 80 ? 'aviso' : 'sucesso'}
          />
        </div>
      </div>
      <ListaDefinicoes
        itens={[
          { termo: 'Percentual acumulado', valor: <span className="numero">{formatarPercentual(resultado.percentualAcumulado)}</span> },
          { termo: 'Limite legal', valor: <span className="numero">{formatarPercentual(resultado.limitePercentual, 0)}</span> },
          { termo: 'Margem restante', valor: <span className="numero texto-forte">{formatarMoeda(resultado.margemRestante)}</span> },
        ]}
      />
      <p>{resultado.explicacao}</p>
      <p className="texto-pequeno texto-secundario">Fundamento: {resultado.fundamento}</p>
      <Alerta
        tipo={regular ? 'sucesso' : 'erro'}
        titulo={regular ? 'Fornecedor regular (RN-09)' : 'Fornecedor com restrições de regularidade (RN-09)'}
      >
        {resultado.regularidadeFornecedor.motivos.length > 0 ? (
          <ul>
            {resultado.regularidadeFornecedor.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : (
          <p>Sem impedimentos nas bases consultadas (CEIS/CNEP e regularidade fiscal) para assinar ou prorrogar.</p>
        )}
      </Alerta>
      <p className="texto-pequeno texto-secundario">
        A simulação apoia a análise; a formalização do termo aditivo depende de justificativa, disponibilidade orçamentária e manifestação
        jurídica.
      </p>
    </div>
  );
}

/** Simulador de aditivo (Lei 14.133/2021, art. 125) — somente leitura, não altera o contrato. */
export function SimuladorAditivo({ contrato }: { contrato: ContratoDetalhe }) {
  const simular = useSimularAditivo(contrato.id);
  const [tipo, definirTipo] = useState<TipoSimulacao>('acrescimo');
  const [valor, definirValor] = useState<Centavos | null>(null);
  const valorAtual = useRef<Centavos | null>(null);
  const [reforma, definirReforma] = useState(false);
  const [tentou, definirTentou] = useState(false);
  const [tipoSimulado, definirTipoSimulado] = useState<TipoSimulacao>('acrescimo');

  const erroValor = tentou && (valor === null || valor <= 0) ? 'Informe um valor maior que zero.' : null;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    const atual = valorAtual.current;
    if (atual === null || atual <= 0) return;
    definirTipoSimulado(tipo);
    simular.mutate({ tipo, valor: atual, reformaEdificioOuEquipamento: tipo === 'acrescimo' ? reforma : undefined });
  };

  const erro = simular.error;

  return (
    <Secao
      titulo="Simulador de aditivo (art. 125)"
      id="simulador-aditivo"
      descricao={
        <p>
          Verifica os limites de alteração unilateral sobre o valor inicial atualizado de {formatarMoeda(contrato.valorInicial)}: 25% para
          acréscimos e supressões, 50% para acréscimos em reforma de edifício ou de equipamento. A simulação não altera o contrato.
        </p>
      }
    >
      <form onSubmit={enviar} className="formulario" noValidate>
        <GrupoOpcoes
          legenda="Tipo de alteração"
          nome={`tipo-aditivo-${contrato.id}`}
          horizontal
          obrigatorio
          opcoes={TIPOS}
          valor={tipo}
          aoMudar={definirTipo}
        />
        <div className="formulario__linha">
          <CampoMoeda
            rotulo="Valor da alteração"
            obrigatorio
            valor={valor}
            aoMudar={(v) => {
              valorAtual.current = v;
              definirValor(v);
            }}
            erro={erroValor}
            ajuda="Valor do acréscimo ou da supressão pretendidos, em reais."
          />
        </div>
        {tipo === 'acrescimo' ? (
          <CaixaSelecao
            rotulo="Reforma de edifício ou de equipamento"
            ajuda="Eleva o limite de acréscimos para 50% (art. 125, parte final)."
            checked={reforma}
            onChange={(e) => definirReforma(e.target.checked)}
          />
        ) : null}
        <div className="linha">
          <Botao type="submit" variante="primario" icone={Calculator} carregando={simular.isPending}>
            Simular
          </Botao>
          <span className="texto-pequeno texto-secundario">Somente consulta: nada é gravado.</span>
        </div>
      </form>
      <div aria-live="polite">
        {erro ? (
          <Alerta tipo="erro" titulo="Não foi possível simular o aditivo">
            <p>{mensagemDeErro(erro)}</p>
            {erro instanceof ErroApi && erro.idRequisicao ? (
              <p className="texto-pequeno">
                Código para o suporte: <code>{erro.idRequisicao}</code>
              </p>
            ) : null}
          </Alerta>
        ) : null}
        {simular.data && !simular.isPending ? <ResultadoSimulacao resultado={simular.data} tipo={tipoSimulado} /> : null}
      </div>
    </Secao>
  );
}
