/**
 * Exigências de qualificação técnica do edital (RN-25): parcelas de maior relevância (≥ 4% do valor total
 * estimado, art. 67, § 1º) e quantitativo mínimo dos atestados (até 50% da parcela, art. 67, § 2º).
 * A prévia usa as mesmas funções do domínio; quem decide é o servidor.
 */
import { useId, useState } from 'react';
import { Plus, Settings2, Trash2 } from 'lucide-react';
import type { EntradaParcelaQualificacao, QualificacaoTecnica } from '@agora/contratos';
import { classificarParcelaRelevancia, formatarMoeda, limiteQuantitativoMinimo } from '@agora/dominio';
import { useDefinirQualificacao } from '../../api/documentos';
import { Alerta, Botao, CampoMoeda, CampoTexto, Dialogo, Etiqueta, Secao, useAvisos } from '../../componentes';
import { formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import { percentualCurto } from './rotulos';

interface ParcelaEditavel {
  chave: string;
  id?: string;
  descricao: string;
  unidade: string;
  quantidadeObjeto: string;
  valorEstimado: number | null;
  quantidadeMinima: string;
  termos: string;
}

function numero(texto: string): number {
  const v = Number(texto.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : Number.NaN;
}

function paraEdicao(q: QualificacaoTecnica): ParcelaEditavel[] {
  return q.parcelas.map((p) => ({
    chave: p.id,
    id: p.id,
    descricao: p.descricao,
    unidade: p.unidade,
    quantidadeObjeto: String(p.quantidadeObjeto).replace('.', ','),
    valorEstimado: p.valorEstimado,
    quantidadeMinima: String(p.quantidadeMinima).replace('.', ','),
    termos: p.termos.join(', '),
  }));
}

/** Prévia da RN-25 para uma parcela em edição (mensagem para o usuário ou `null` quando confere). */
function previa(p: ParcelaEditavel, total: number | null): string | null {
  const objeto = numero(p.quantidadeObjeto);
  const minimo = numero(p.quantidadeMinima);
  if (p.descricao.trim().length < 3 || p.unidade.trim() === '' || !(objeto > 0) || !(minimo > 0) || p.valorEstimado === null || p.valorEstimado <= 0) return 'Preencha todos os campos.';
  const mensagens: string[] = [];
  if (total !== null) {
    const r = classificarParcelaRelevancia(p.valorEstimado, total);
    if (!r.maiorRelevancia) mensagens.push(`A parcela vale ${percentualCurto(r.percentualDoTotal)} do total; só se exige atestado de parcela com 4% ou mais (art. 67, § 1º).`);
  }
  const limite = limiteQuantitativoMinimo(objeto);
  if (minimo > limite) mensagens.push(`O mínimo passa de 50% da parcela; o máximo é ${formatarNumero(limite)} ${p.unidade} (art. 67, § 2º).`);
  return mensagens.length === 0 ? null : mensagens.join(' ');
}

function EditarExigencias({ q, aberto, aoFechar }: { q: QualificacaoTecnica; aberto: boolean; aoFechar: () => void }) {
  const base = useId();
  const { avisar } = useAvisos();
  const definir = useDefinirQualificacao(q.processoId);
  const [parcelas, definirParcelas] = useState<ParcelaEditavel[]>(() => paraEdicao(q));
  const [contador, definirContador] = useState(0);

  const alterar = (chave: string, campo: Partial<ParcelaEditavel>) => definirParcelas((lista) => lista.map((p) => (p.chave === chave ? { ...p, ...campo } : p)));
  const acrescentar = () => {
    definirContador((n) => n + 1);
    definirParcelas((lista) => [...lista, { chave: `nova-${contador}`, descricao: '', unidade: '', quantidadeObjeto: '', valorEstimado: null, quantidadeMinima: '', termos: '' }]);
  };
  const fechar = () => {
    definirParcelas(paraEdicao(q));
    definir.reset();
    aoFechar();
  };
  const problemas = parcelas.map((p) => previa(p, q.valorTotalEstimado));
  const salvar = () => {
    const entrada: EntradaParcelaQualificacao[] = parcelas.map((p) => ({
      ...(p.id ? { id: p.id } : {}),
      descricao: p.descricao.trim(),
      unidade: p.unidade.trim(),
      quantidadeObjeto: numero(p.quantidadeObjeto),
      valorEstimado: p.valorEstimado ?? 0,
      quantidadeMinima: numero(p.quantidadeMinima),
      termos: p.termos
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length >= 2),
    }));
    definir.mutate(
      { parcelas: entrada },
      {
        onSuccess: (r) => {
          avisar({ tipo: 'sucesso', titulo: 'Exigências registradas', mensagem: `${r.parcelas.length} parcela(s) de maior relevância conferidas pelo art. 67.` });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      largura="ampla"
      titulo="Definir exigências de qualificação técnica"
      descricao={`Valor total estimado da contratação: ${q.valorTotalEstimado === null ? 'ainda não apurado' : formatarMoeda(q.valorTotalEstimado)}. Só se exige atestado das parcelas de 4% ou mais desse valor, com mínimo de até 50% da parcela.`}
      rodape={
        <>
          <Botao variante="terciario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" carregando={definir.isPending} disabled={problemas.some((p) => p !== null)} onClick={salvar}>
            Salvar exigências
          </Botao>
        </>
      }
    >
      {parcelas.length === 0 ? <p>Nenhuma parcela: o edital não exigirá atestado de capacidade técnica com quantitativo.</p> : null}
      {parcelas.map((p, i) => (
        <fieldset key={p.chave} className="cartao pilha pilha--compacta">
          <legend>Parcela {i + 1}</legend>
          <CampoTexto id={`${base}-${p.chave}-descricao`} rotulo="Descrição da parcela" obrigatorio maxLength={300} value={p.descricao} onChange={(e) => alterar(p.chave, { descricao: e.target.value })} />
          <div className="grade grade--3">
            <CampoTexto rotulo="Unidade" obrigatorio maxLength={60} value={p.unidade} onChange={(e) => alterar(p.chave, { unidade: e.target.value })} ajuda="Ex.: unidade, pontos de função, m²" />
            <CampoTexto rotulo="Quantidade no objeto" obrigatorio inputMode="decimal" value={p.quantidadeObjeto} onChange={(e) => alterar(p.chave, { quantidadeObjeto: e.target.value })} />
            <CampoMoeda rotulo="Valor estimado da parcela" obrigatorio valor={p.valorEstimado} aoMudar={(v) => alterar(p.chave, { valorEstimado: v })} />
          </div>
          <div className="grade grade--2">
            <CampoTexto rotulo="Quantidade mínima nos atestados" obrigatorio inputMode="decimal" value={p.quantidadeMinima} onChange={(e) => alterar(p.chave, { quantidadeMinima: e.target.value })} />
            <CampoTexto rotulo="Palavras que identificam a parcela nos atestados" value={p.termos} onChange={(e) => alterar(p.chave, { termos: e.target.value })} ajuda="Separadas por vírgula (opcional). Ex.: colete, proteção balística" />
          </div>
          {problemas[i] ? (
            <Alerta tipo="aviso" compacto>
              <p>{problemas[i]}</p>
            </Alerta>
          ) : null}
          <div>
            <Botao variante="terciario" tamanho="compacto" icone={Trash2} onClick={() => definirParcelas((lista) => lista.filter((x) => x.chave !== p.chave))}>
              Remover parcela {i + 1}
            </Botao>
          </div>
        </fieldset>
      ))}
      <div>
        <Botao icone={Plus} onClick={acrescentar} disabled={parcelas.length >= 20}>
          Acrescentar parcela
        </Botao>
      </div>
      <ErroOperacao erro={definir.error} titulo="As exigências não foram registradas" />
    </Dialogo>
  );
}

export function ExigenciasTecnicas({ q, podeEditar }: { q: QualificacaoTecnica; podeEditar: boolean }) {
  const [editando, definirEditando] = useState(false);
  const idLegenda = useId();
  return (
    <Secao
      titulo="Exigências de qualificação técnica do edital"
      id="exigencias"
      descricao={
        <>
          Parcelas de maior relevância (art. 67, § 1º) e quantitativo mínimo dos atestados (art. 67, § 2º). Valor total estimado:{' '}
          <span className="numero">{q.valorTotalEstimado === null ? 'não apurado' : formatarMoeda(q.valorTotalEstimado)}</span>.
          {q.definidaEm ? (
            <>
              {' '}
              Definidas em <span className="numero">{formatarInstante(q.definidaEm)}</span>
              {q.definidaPor ? ` por ${q.definidaPor.nome}` : ''}.
            </>
          ) : null}
        </>
      }
      acoes={
        podeEditar && q.editavel ? (
          <Botao icone={Settings2} onClick={() => definirEditando(true)}>
            Definir exigências
          </Botao>
        ) : null
      }
    >
      {!q.editavel ? <p className="texto-secundario">As exigências não podem mais ser alteradas: o processo já passou da elaboração do edital (etapa 4).</p> : null}
      {q.parcelas.length === 0 ? (
        <p>O edital não exige atestado com quantitativo mínimo.</p>
      ) : (
        <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
          <table className="tabela tabela--compacta">
            <caption id={idLegenda} className="tabela__legenda">
              Parcelas de maior relevância
            </caption>
            <thead>
              <tr>
                <th scope="col">Parcela</th>
                <th scope="col" className="tabela__alinhar--fim">
                  Quantidade no objeto
                </th>
                <th scope="col" className="tabela__alinhar--fim">
                  Valor estimado
                </th>
                <th scope="col" className="tabela__alinhar--fim">
                  Mínimo nos atestados
                </th>
                <th scope="col">Conferência (RN-25)</th>
              </tr>
            </thead>
            <tbody>
              {q.parcelas.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.descricao}</th>
                  <td className="numero tabela__alinhar--fim">
                    {formatarNumero(p.quantidadeObjeto)} {p.unidade}
                  </td>
                  <td className="numero tabela__alinhar--fim">
                    {formatarMoeda(p.valorEstimado)} ({percentualCurto(p.percentualDoTotal)} do total)
                  </td>
                  <td className="numero tabela__alinhar--fim">
                    {formatarNumero(p.quantidadeMinima)} {p.unidade} ({percentualCurto(p.percentualMinimo)})
                  </td>
                  <td>
                    {p.maiorRelevancia && p.quantidadeMinima <= p.limiteQuantidadeMinima ? (
                      <Etiqueta tom="sucesso" compacta>
                        Dentro do art. 67
                      </Etiqueta>
                    ) : (
                      <Etiqueta tom="aviso" compacta>
                        Revisar: {p.maiorRelevancia ? 'mínimo acima de 50%' : 'parcela abaixo de 4%'}
                      </Etiqueta>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando ? <EditarExigencias q={q} aberto={editando} aoFechar={() => definirEditando(false)} /> : null}
    </Secao>
  );
}
