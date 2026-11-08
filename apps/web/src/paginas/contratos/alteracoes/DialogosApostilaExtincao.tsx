import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { FormaExtincaoContrato, MotivoExtincaoContrato, PainelAlteracoesContrato, RegimeMaoDeObra } from '@agora/contratos';
import { formatarData, formatarMoeda, validarDataISO, type Centavos } from '@agora/dominio';
import { useInstaurarExtincao, useReajustarContrato, useRepactuarContrato } from '../../../api/alteracoes';
import { AreaTexto, Botao, CaixaSelecao, CampoMoeda, CampoTexto, Dialogo, GrupoOpcoes, Selecao, useAvisos } from '../../../componentes';
import { AlertaErro } from './AlertaErro';
import { MOTIVOS_EXTINCAO, hojeLocal } from './rotulos';

interface PropsBase {
  contratoId: string;
  numero: string;
  aoFechar: () => void;
}

/** Reajuste por apostila (art. 25, § 7º, e art. 136, I): só depois de 12 meses da data do orçamento estimado. */
export function DialogoReajuste({ contratoId, numero, painel, aoFechar }: PropsBase & { painel: PainelAlteracoesContrato }) {
  const { avisar } = useAvisos();
  const reajustar = useReajustarContrato(contratoId);
  const [percentual, definirPercentual] = useState('');
  const [fonte, definirFonte] = useState('');
  const [erros, definirErros] = useState<Record<string, string>>({});
  const id = `formulario-reajuste-${contratoId}`;
  const r = painel.reajuste;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const valor = Number(percentual.replace(',', '.'));
    const novos: Record<string, string> = {};
    if (!Number.isFinite(valor) || valor === 0) novos['percentual'] = 'Informe a variação do índice no período, em %.';
    if (fonte.trim().length < 5) novos['fonte'] = 'Informe a fonte e o período do índice.';
    definirErros(novos);
    if (Object.keys(novos).length > 0) return;
    reajustar.mutate(
      { percentual: valor, fonteIndice: fonte.trim() },
      {
        onSuccess: (a) => {
          avisar({ tipo: 'sucesso', titulo: 'Reajuste apostilado', mensagem: `${a.numero ?? 'Apostila'}: ${formatarMoeda(a.valor)}.` });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto
      aoFechar={reajustar.isPending ? () => undefined : aoFechar}
      titulo="Registrar reajuste"
      largura="media"
      descricao={
        <p>
          Contrato {numero}. Índice {r.indice}; data-base (orçamento estimado) em {formatarData(r.dataBase)}; o próximo ciclo completa 12 meses em{' '}
          {formatarData(r.proximoAniversario)}. O reajuste incide sobre o saldo de {formatarMoeda(r.saldoContratual)} e é registrado por apostila.
        </p>
      }
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={reajustar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={id} carregando={reajustar.isPending}>
            Apostilar reajuste
          </Botao>
        </>
      }
    >
      <form id={id} className="formulario" onSubmit={enviar} noValidate>
        <CampoTexto
          rotulo={`Variação do ${r.indice} no período (%)`}
          inputMode="decimal"
          obrigatorio
          value={percentual}
          onChange={(e) => definirPercentual(e.target.value)}
          erro={erros['percentual']}
          ajuda="Ex.: 4,62. Pode ser negativa."
        />
        <CampoTexto rotulo="Fonte e período do índice" obrigatorio maxLength={300} value={fonte} onChange={(e) => definirFonte(e.target.value)} erro={erros['fonte']} ajuda="Ex.: série oficial do índice, de mês a mês." />
        <AlertaErro erro={reajustar.error} titulo="O reajuste não foi registrado" />
      </form>
    </Dialogo>
  );
}

interface Componente {
  descricao: string;
  origem: 'mao_de_obra' | 'insumos';
  dataBase: string;
  valorMensalAnterior: Centavos | null;
  valorMensalNovo: Centavos | null;
  documento: string;
}

const componenteVazio = (): Componente => ({ descricao: '', origem: 'mao_de_obra', dataBase: '', valorMensalAnterior: null, valorMensalNovo: null, documento: '' });

/** Repactuação (art. 135): serviço com dedicação exclusiva ou predominância de mão de obra, com demonstração analítica. */
export function DialogoRepactuacao({ contratoId, numero, painel, aoFechar }: PropsBase & { painel: PainelAlteracoesContrato }) {
  const { avisar } = useAvisos();
  const repactuar = useRepactuarContrato(contratoId);
  const [regime, definirRegime] = useState<RegimeMaoDeObra | ''>(painel.regimeMaoDeObra ?? '');
  const [solicitadaEm, definirSolicitadaEm] = useState(hojeLocal());
  const [efeitosDesde, definirEfeitosDesde] = useState(hojeLocal());
  const [componentes, definirComponentes] = useState<Componente[]>([componenteVazio()]);
  const [excluidas, definirExcluidas] = useState(false);
  const [justificativa, definirJustificativa] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const id = `formulario-repactuacao-${contratoId}`;
  const alterar = (i: number, parcial: Partial<Componente>) => definirComponentes(componentes.map((c, j) => (j === i ? { ...c, ...parcial } : c)));

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const incompleto = componentes.some((c) => c.descricao.trim() === '' || !validarDataISO(c.dataBase) || c.valorMensalAnterior === null || c.valorMensalNovo === null || c.documento.trim() === '');
    if (incompleto || !validarDataISO(solicitadaEm) || !validarDataISO(efeitosDesde) || justificativa.trim().length < 20) {
      definirErro('Preencha cada componente (descrição, data-base, valores mensais e documento), as datas e a justificativa (20 caracteres ou mais).');
      return;
    }
    definirErro(null);
    repactuar.mutate(
      {
        ...(regime ? { regimeMaoDeObra: regime } : {}),
        solicitadaEm,
        efeitosDesde,
        clausulasNaoTrabalhistasExcluidas: excluidas,
        justificativa: justificativa.trim(),
        componentes: componentes.map((c) => ({
          descricao: c.descricao.trim(),
          origem: c.origem,
          dataBase: c.dataBase,
          valorMensalAnterior: c.valorMensalAnterior ?? 0,
          valorMensalNovo: c.valorMensalNovo ?? 0,
          documento: c.documento.trim(),
        })),
      },
      {
        onSuccess: (a) => {
          avisar({ tipo: 'sucesso', titulo: 'Repactuação apostilada', mensagem: `${a.numero ?? 'Apostila'}: ${formatarMoeda(a.valor)}.` });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto
      aoFechar={repactuar.isPending ? () => undefined : aoFechar}
      titulo="Registrar repactuação"
      largura="ampla"
      descricao={<p>Contrato {numero}. Cada componente cumpre 1 ano contado da sua data-base: proposta, última repactuação ou convenção coletiva anterior (art. 135, § 3º).</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={repactuar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="primario" type="submit" form={id} carregando={repactuar.isPending}>
            Apostilar repactuação
          </Botao>
        </>
      }
    >
      <form id={id} className="formulario" onSubmit={enviar} noValidate>
        {painel.regimeMaoDeObra ? null : (
          <Selecao
            rotulo="Regime de mão de obra do contrato"
            value={regime}
            onChange={(e) => definirRegime(e.target.value as RegimeMaoDeObra | '')}
            opcaoVazia="Selecione"
            opcoes={[
              { valor: 'dedicacao_exclusiva', rotulo: 'Dedicação exclusiva de mão de obra' },
              { valor: 'predominancia', rotulo: 'Predominância de mão de obra' },
              { valor: 'sem_dedicacao', rotulo: 'Sem dedicação de mão de obra' },
            ]}
          />
        )}
        <CampoTexto rotulo="Data do pedido do contratado" type="date" obrigatorio max={hojeLocal()} value={solicitadaEm} onChange={(e) => definirSolicitadaEm(e.target.value)} />
        <CampoTexto rotulo="Efeitos financeiros a partir de" type="date" obrigatorio value={efeitosDesde} onChange={(e) => definirEfeitosDesde(e.target.value)} />
        {componentes.map((c, i) => (
          <fieldset key={i} className="pilha pilha--compacta">
            <legend>Componente {i + 1} da planilha de custos</legend>
            <CampoTexto rotulo="Descrição" obrigatorio maxLength={300} value={c.descricao} onChange={(e) => alterar(i, { descricao: e.target.value })} />
            <GrupoOpcoes
              legenda="Origem do custo"
              nome={`origem-${contratoId}-${i}`}
              horizontal
              opcoes={[
                { valor: 'mao_de_obra', rotulo: 'Mão de obra' },
                { valor: 'insumos', rotulo: 'Insumos' },
              ]}
              valor={c.origem}
              aoMudar={(origem) => alterar(i, { origem })}
            />
            <CampoTexto rotulo="Data-base do componente" type="date" obrigatorio value={c.dataBase} onChange={(e) => alterar(i, { dataBase: e.target.value })} />
            <CampoMoeda rotulo="Custo mensal anterior" obrigatorio valor={c.valorMensalAnterior} aoMudar={(v) => alterar(i, { valorMensalAnterior: v })} />
            <CampoMoeda rotulo="Custo mensal novo" obrigatorio valor={c.valorMensalNovo} aoMudar={(v) => alterar(i, { valorMensalNovo: v })} />
            <CampoTexto
              rotulo="Documento que fundamenta"
              obrigatorio
              maxLength={300}
              value={c.documento}
              onChange={(e) => alterar(i, { documento: e.target.value })}
              ajuda="Acordo, convenção ou dissídio coletivo, ou planilha de custos (art. 135, § 6º)."
            />
            {componentes.length > 1 ? (
              <Botao variante="secundario" tamanho="compacto" icone={Trash2} onClick={() => definirComponentes(componentes.filter((_, j) => j !== i))}>
                Remover componente {i + 1}
              </Botao>
            ) : null}
          </fieldset>
        ))}
        <Botao variante="secundario" tamanho="compacto" icone={Plus} onClick={() => definirComponentes([...componentes, componenteVazio()])}>
          Acrescentar componente
        </Botao>
        <CaixaSelecao
          rotulo="Desconsiderei as cláusulas coletivas de matéria não trabalhista ou que só obrigam a Administração (art. 135, §§ 1º e 2º)"
          checked={excluidas}
          onChange={(e) => definirExcluidas(e.target.checked)}
        />
        <AreaTexto rotulo="Justificativa" obrigatorio rows={3} maxLength={5000} contador value={justificativa} onChange={(e) => definirJustificativa(e.target.value)} />
        {erro ? (
          <p className="campo__erro" role="alert">
            {erro}
          </p>
        ) : null}
        <AlertaErro erro={repactuar.error} titulo="A repactuação não foi registrada" />
      </form>
    </Dialogo>
  );
}

/** Abertura do processo de extinção (arts. 137 e 138): unilateral com prazo de defesa, consensual ou judicial/arbitral. */
export function DialogoExtincao({ contratoId, numero, aoFechar }: PropsBase) {
  const { avisar } = useAvisos();
  const instaurar = useInstaurarExtincao(contratoId);
  const [forma, definirForma] = useState<FormaExtincaoContrato>('unilateral');
  const [motivo, definirMotivo] = useState<MotivoExtincaoContrato>('art137_I');
  const [prazo, definirPrazo] = useState('15');
  const [interesse, definirInteresse] = useState(false);
  const [referencia, definirReferencia] = useState('');
  const [fundamentacao, definirFundamentacao] = useState('');
  const [erro, definirErro] = useState<string | null>(null);
  const id = `formulario-extincao-${contratoId}`;

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (fundamentacao.trim().length < 50) {
      definirErro('Motive a extinção com pelo menos 50 caracteres (art. 137, caput).');
      return;
    }
    definirErro(null);
    instaurar.mutate(
      {
        forma,
        motivo,
        fundamentacao: fundamentacao.trim(),
        ...(forma === 'unilateral' ? { prazoDefesaDiasUteis: Number(prazo) } : {}),
        ...(forma === 'consensual' ? { interesseAdministracao: interesse } : {}),
        ...(forma === 'judicial_arbitral' ? { referenciaDecisao: referencia.trim() } : {}),
      },
      {
        onSuccess: (a) => {
          avisar({
            tipo: 'sucesso',
            titulo: 'Processo de extinção aberto',
            mensagem: a.contraditorio ? `Contratado notificado; defesa até ${formatarData(a.contraditorio.prazoFim)}.` : 'Segue para a decisão da autoridade competente.',
          });
          aoFechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto
      aoFechar={instaurar.isPending ? () => undefined : aoFechar}
      titulo="Abrir processo de extinção"
      largura="media"
      descricao={<p>Contrato {numero}. A extinção é decisão da autoridade competente, motivada nos autos, com contraditório e ampla defesa (art. 137).</p>}
      rodape={
        <>
          <Botao variante="secundario" onClick={aoFechar} disabled={instaurar.isPending}>
            Cancelar
          </Botao>
          <Botao variante="perigo" type="submit" form={id} carregando={instaurar.isPending}>
            Abrir processo de extinção
          </Botao>
        </>
      }
    >
      <form id={id} className="formulario" onSubmit={enviar} noValidate>
        <GrupoOpcoes
          legenda="Forma da extinção"
          nome={`forma-${contratoId}`}
          opcoes={[
            { valor: 'unilateral', rotulo: 'Unilateral, por ato escrito da Administração', ajuda: 'O contratado é notificado e tem prazo para defesa.' },
            { valor: 'consensual', rotulo: 'Consensual', ajuda: 'Por acordo, conciliação, mediação ou comitê de resolução de disputas.' },
            { valor: 'judicial_arbitral', rotulo: 'Decisão judicial ou arbitral' },
          ]}
          valor={forma}
          aoMudar={definirForma}
        />
        <Selecao
          rotulo="Motivo (art. 137)"
          obrigatorio
          value={motivo}
          onChange={(e) => definirMotivo(e.target.value as MotivoExtincaoContrato)}
          opcoes={Object.entries(MOTIVOS_EXTINCAO).map(([valor, rotulo]) => ({ valor, rotulo }))}
        />
        {forma === 'unilateral' ? (
          <CampoTexto
            rotulo="Prazo de defesa (dias úteis)"
            type="number"
            min={1}
            max={60}
            obrigatorio
            value={prazo}
            onChange={(e) => definirPrazo(e.target.value)}
            ajuda="A lei não fixa o prazo; o sugerido acompanha o da defesa no processo de responsabilização (art. 158)."
          />
        ) : null}
        {forma === 'consensual' ? (
          <CaixaSelecao rotulo="Há interesse da Administração na extinção (art. 138, II)" checked={interesse} onChange={(e) => definirInteresse(e.target.checked)} />
        ) : null}
        {forma === 'judicial_arbitral' ? (
          <CampoTexto rotulo="Número do processo ou da decisão" obrigatorio maxLength={200} value={referencia} onChange={(e) => definirReferencia(e.target.value)} />
        ) : null}
        <AreaTexto rotulo="Motivação" obrigatorio rows={4} maxLength={5000} contador value={fundamentacao} onChange={(e) => definirFundamentacao(e.target.value)} />
        {erro ? (
          <p className="campo__erro" role="alert">
            {erro}
          </p>
        ) : null}
        <AlertaErro erro={instaurar.error} titulo="O processo de extinção não foi aberto" />
      </form>
    </Dialogo>
  );
}
