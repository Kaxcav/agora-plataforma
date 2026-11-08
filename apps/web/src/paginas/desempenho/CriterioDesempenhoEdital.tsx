/**
 * Etapa 4 — desempenho anterior na pontuação técnica (RN-37; art. 36, § 3º, e art. 37, III): o edital fixa a parte
 * da nota técnica que vem da nota do registro de desempenho, a nota de quem não tem histórico e o regulamento que
 * disciplina o critério. Só se aplica à técnica e preço e à melhor técnica; o servidor confere e recusa sem regulamento.
 */
import { useId, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import type { CriterioDesempenhoEdital as Criterio } from '@agora/contratos';
import { useCriterioDesempenho, useSalvarCriterioDesempenho } from '../../api/desempenho';
import { Alerta, Alternador, AreaTexto, Botao, CampoTexto, useAvisos } from '../../componentes';
import { formatarInstante } from '../../utilitarios/formatacao';
import { ErroOperacao } from '../jornada/comum';
import type { PropsEtapa } from '../jornada/etapas/tipos';

function lerNumero(texto: string): number | null {
  const n = Number(texto.replace(',', '.').trim());
  return texto.trim() === '' || !Number.isFinite(n) ? null : n;
}

function Formulario({ processoId, criterio, editavel }: { processoId: string; criterio: Criterio; editavel: boolean }) {
  const base = useId();
  const { avisar } = useAvisos();
  const salvar = useSalvarCriterioDesempenho(processoId);
  const [adotado, definirAdotado] = useState(criterio.adotado);
  const [peso, definirPeso] = useState(criterio.pesoDesempenhoPercentual === null ? '20' : String(criterio.pesoDesempenhoPercentual));
  const [semHistorico, definirSemHistorico] = useState(criterio.notaSemHistorico === null ? '50' : String(criterio.notaSemHistorico));
  const [regulamento, definirRegulamento] = useState(criterio.regulamento ?? '');

  const valorPeso = lerNumero(peso);
  const valorSemHistorico = lerNumero(semHistorico);
  const erroPeso = adotado && (valorPeso === null || valorPeso <= 0 || valorPeso > 100) ? 'Informe um percentual maior que 0 e até 100.' : null;
  const erroSemHistorico = adotado && (valorSemHistorico === null || valorSemHistorico < 0 || valorSemHistorico > 100) ? 'Informe uma nota de 0 a 100.' : null;
  const erroRegulamento = adotado && regulamento.trim().length < 10 ? 'Indique o regulamento (ato, número e artigo).' : null;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (erroPeso || erroSemHistorico || erroRegulamento) return;
    salvar.mutate(
      adotado ? { adotado, pesoDesempenhoPercentual: valorPeso, notaSemHistorico: valorSemHistorico, regulamento: regulamento.trim() } : { adotado: false },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Critério salvo', mensagem: 'Gere nova versão do TR e do edital para incluir a cláusula.' }) },
    );
  };

  return (
    <form className="pilha pilha--compacta" onSubmit={enviar} noValidate aria-label="Critério de desempenho do edital">
      <Alternador
        rotulo="Considerar o desempenho anterior na pontuação técnica"
        ligado={adotado}
        aoMudar={definirAdotado}
        desabilitado={!editavel}
        ajuda="A nota vem do registro cadastral de desempenho (avaliações definitivas), nunca digitada."
      />
      {adotado ? (
        <div className="formulario__linha">
          <CampoTexto
            id={`${base}-peso`}
            rotulo="Parte da nota técnica (%)"
            inputMode="decimal"
            value={peso}
            disabled={!editavel}
            erro={erroPeso}
            onChange={(e) => definirPeso(e.target.value)}
          />
          <CampoTexto
            id={`${base}-sem`}
            rotulo="Nota para quem não tem histórico (0 a 100)"
            inputMode="decimal"
            value={semHistorico}
            disabled={!editavel}
            erro={erroSemHistorico}
            onChange={(e) => definirSemHistorico(e.target.value)}
          />
        </div>
      ) : null}
      {adotado ? (
        <AreaTexto
          rotulo="Regulamento que disciplina o critério"
          obrigatorio
          rows={2}
          maxLength={500}
          value={regulamento}
          disabled={!editavel}
          erro={erroRegulamento}
          ajuda="O art. 36, § 3º, condiciona o critério a regulamento; sem ele, o TCU considerou o uso irregular (Acórdão 7695/2024-2ª Câmara)."
          onChange={(e) => definirRegulamento(e.target.value)}
        />
      ) : null}
      <ErroOperacao erro={salvar.error} titulo="O critério não foi salvo" />
      {editavel ? (
        <div className="linha">
          <Botao variante="primario" type="submit" icone={Save} carregando={salvar.isPending}>
            Salvar critério de desempenho
          </Botao>
        </div>
      ) : null}
      {criterio.atualizadoEm ? (
        <p className="texto-pequeno texto-secundario">
          Última alteração em {formatarInstante(criterio.atualizadoEm)}
          {criterio.atualizadoPor ? ` por ${criterio.atualizadoPor.nome}` : ''}.
        </p>
      ) : null}
    </form>
  );
}

export function CriterioDesempenhoEdital({ processo, editavel }: PropsEtapa) {
  const base = useId();
  const consulta = useCriterioDesempenho(processo.id);
  const criterio = consulta.data;
  return (
    <section className="pilha" aria-labelledby={`${base}-titulo`} id="criterio-desempenho">
      <h3 id={`${base}-titulo`} className="secao__titulo">
        Desempenho anterior na pontuação técnica (RN-37)
      </h3>
      {!criterio ? (
        <p className="texto-secundario" role="status">
          {consulta.isError ? 'Não foi possível carregar o critério de desempenho.' : 'Carregando o critério de desempenho…'}
        </p>
      ) : !criterio.aplicavel && !criterio.adotado ? (
        <p className="texto-pequeno texto-secundario">{criterio.explicacao}</p>
      ) : (
        <>
          <p className="texto-pequeno texto-secundario">{criterio.explicacao}</p>
          {!criterio.aplicavel ? (
            <Alerta tipo="aviso" compacto titulo="Critério de julgamento sem pontuação técnica">
              <p>O critério foi adotado, mas o edital não usa técnica e preço nem melhor técnica. Retire o critério ou ajuste o julgamento.</p>
            </Alerta>
          ) : null}
          <Formulario key={criterio.atualizadoEm ?? 'novo'} processoId={processo.id} criterio={criterio} editavel={editavel} />
        </>
      )}
    </section>
  );
}
