/**
 * Importação da cesta de preços por planilha (RF-16). O arquivo é lido como texto no navegador e enviado ao servidor,
 * que valida cada linha e devolve a prévia; a gravação só acontece depois, com todas as linhas válidas.
 */
import { useId, useState, type ChangeEvent } from 'react';
import { Download, FileCheck2, Upload } from 'lucide-react';
import type { EntradaImportacaoCesta, PreviaImportacaoCesta } from '@agora/contratos';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { URL_MODELO_CESTA, useImportarCesta, usePreviaImportacaoCesta } from '../../../api/jornada';
import { Alerta, AreaTexto, Botao, Campo, Dialogo, Etiqueta, GrupoOpcoes, useAvisos } from '../../../componentes';
import { formatarNumero } from '../../../utilitarios/formatacao';
import { ErroOperacao } from '../comum';
import { rotuloFonte } from '../rotulos';

const MAXIMO_CARACTERES = 100_000;

/** Lê o arquivo como UTF-8; se vier com caracteres inválidos (planilha salva em Windows-1252), relê nessa codificação. */
async function lerArquivoComoTexto(arquivo: File): Promise<string> {
  const bytes = await arquivo.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  return utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(bytes) : utf8;
}

interface PropsImportarCesta {
  processoId: string;
  aberto: boolean;
  aoFechar: () => void;
  cotacoesAtuais: number;
}

export function ImportarCesta({ processoId, aberto, aoFechar, cotacoesAtuais }: PropsImportarCesta) {
  const base = useId();
  const { avisar } = useAvisos();
  const previa = usePreviaImportacaoCesta(processoId);
  const importar = useImportarCesta(processoId);
  const [conteudo, definirConteudo] = useState('');
  const [modo, definirModo] = useState<EntradaImportacaoCesta['modo']>(cotacoesAtuais > 0 ? 'acrescentar' : 'substituir');
  const [conferido, definirConferido] = useState<{ entrada: EntradaImportacaoCesta; resultado: PreviaImportacaoCesta } | null>(null);
  const [erroArquivo, definirErroArquivo] = useState<string | null>(null);

  const entrada: EntradaImportacaoCesta = { conteudo, modo };
  const atual = conferido !== null && conferido.entrada.conteudo === conteudo && conferido.entrada.modo === modo ? conferido.resultado : null;
  const podeImportar = atual !== null && atual.errosGerais.length === 0 && atual.comErro === 0 && atual.validas > 0;
  const excedeLimite = conteudo.length > MAXIMO_CARACTERES;

  const fechar = () => {
    definirConteudo('');
    definirConferido(null);
    definirErroArquivo(null);
    previa.reset();
    importar.reset();
    aoFechar();
  };

  const escolherArquivo = async (evento: ChangeEvent<HTMLInputElement>) => {
    const arquivo = evento.target.files?.[0];
    definirErroArquivo(null);
    if (!arquivo) return;
    if (arquivo.size > MAXIMO_CARACTERES * 2) {
      definirErroArquivo('O arquivo é grande demais para uma cesta de preços (limite de 50 cotações).');
      return;
    }
    definirConteudo(await lerArquivoComoTexto(arquivo));
  };

  const conferir = () => {
    importar.reset();
    previa.mutate(entrada, { onSuccess: (resultado) => definirConferido({ entrada, resultado }) });
  };

  const gravar = () =>
    importar.mutate(entrada, {
      onSuccess: () => {
        avisar({
          tipo: 'sucesso',
          titulo: 'Cotações importadas',
          mensagem: `${formatarNumero(atual?.validas ?? 0)} cotação(ões) incluídas; a análise estatística foi recalculada. Confira os expurgos sugeridos.`,
        });
        fechar();
      },
    });

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      largura="ampla"
      titulo="Importar cotações de planilha"
      descricao="A planilha é conferida no servidor antes de gravar. Colunas: fonte, identificação, valor unitário, data da cotação e justificativa (obrigatória na pesquisa direta com fornecedor)."
      rodape={
        <>
          <Botao variante="terciario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={Upload} disabled={!podeImportar} carregando={importar.isPending} onClick={gravar}>
            {atual && podeImportar ? `Importar ${formatarNumero(atual.validas)} cotação(ões)` : 'Importar cotações'}
          </Botao>
        </>
      }
    >
      <p>
        <a href={URL_MODELO_CESTA} download className="link-externo">
          <Download size={16} aria-hidden="true" /> Baixar modelo de planilha (CSV)
        </a>
      </p>
      <Campo
        id={`${base}-arquivo`}
        rotulo="Arquivo da planilha"
        ajuda="Salve a planilha como CSV (separado por ponto e vírgula). Fonte aceita o código, o nome ou o inciso do art. 23, § 1º (I a V)."
        erro={erroArquivo}
      >
        {(atributos) => <input {...atributos} className="campo__controle" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void escolherArquivo(e)} />}
      </Campo>
      <AreaTexto
        rotulo="Conteúdo da planilha"
        rows={7}
        value={conteudo}
        onChange={(e) => definirConteudo(e.target.value)}
        erro={excedeLimite ? 'O conteúdo passa do limite de 100.000 caracteres.' : null}
        ajuda="O arquivo escolhido aparece aqui. Você também pode colar as linhas copiadas da planilha."
      />
      <GrupoOpcoes
        legenda="O que fazer com as cotações atuais"
        nome={`${base}-modo`}
        valor={modo}
        aoMudar={definirModo}
        opcoes={[
          { valor: 'acrescentar', rotulo: `Acrescentar às ${formatarNumero(cotacoesAtuais)} cotação(ões) atuais` },
          { valor: 'substituir', rotulo: 'Substituir as cotações atuais', ajuda: 'As cotações e os expurgos atuais são descartados. A operação fica na trilha de auditoria.' },
        ]}
      />
      <div>
        <Botao icone={FileCheck2} disabled={conteudo.trim() === '' || excedeLimite} carregando={previa.isPending} onClick={conferir}>
          Conferir planilha
        </Botao>
      </div>

      <ErroOperacao erro={previa.error} titulo="Não foi possível conferir a planilha" />
      <ErroOperacao erro={importar.error} titulo="As cotações não foram importadas" />

      {atual ? <ResultadoPrevia previa={atual} idLegenda={`${base}-legenda`} /> : null}
    </Dialogo>
  );
}

function ResultadoPrevia({ previa, idLegenda }: { previa: PreviaImportacaoCesta; idLegenda: string }) {
  if (previa.errosGerais.length > 0) {
    return (
      <Alerta tipo="erro" anunciar titulo="A planilha não pode ser importada">
        <ul>
          {previa.errosGerais.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </Alerta>
    );
  }
  return (
    <>
      <Alerta tipo={previa.comErro > 0 ? 'aviso' : 'sucesso'} anunciar titulo={previa.comErro > 0 ? 'Corrija as linhas com erro' : 'Planilha conferida'}>
        <p>
          {formatarNumero(previa.validas)} linha(s) válida(s) e {formatarNumero(previa.comErro)} com erro.
          {previa.cabecalhoReconhecido ? '' : ' A primeira linha não é um cabeçalho: as colunas foram lidas na ordem do modelo.'} A cesta ficará com{' '}
          {formatarNumero(previa.totalAposImportacao)} cotação(ões).
        </p>
      </Alerta>
      <div className="tabela-rolagem" role="region" aria-labelledby={idLegenda} tabIndex={0}>
        <table className="tabela tabela--compacta">
          <caption id={idLegenda} className="tabela__legenda">
            Prévia da importação
          </caption>
          <thead>
            <tr>
              <th scope="col">Linha</th>
              <th scope="col">Fonte</th>
              <th scope="col">Identificação</th>
              <th scope="col" className="tabela__alinhar--fim">
                Valor unitário
              </th>
              <th scope="col">Data</th>
              <th scope="col">Situação</th>
            </tr>
          </thead>
          <tbody>
            {previa.linhas.map((l) => (
              <tr key={l.linha}>
                <td className="numero">{l.linha}</td>
                <td>{l.fonte ? rotuloFonte(l.fonte, true) : '—'}</td>
                <td>{l.descricaoFonte || '—'}</td>
                <td className="numero tabela__alinhar--fim">{l.valorUnitario !== null ? formatarMoeda(l.valorUnitario) : '—'}</td>
                <td>{l.dataCotacao ? formatarData(l.dataCotacao) : '—'}</td>
                <td>
                  {l.erros.length === 0 ? (
                    <Etiqueta tom="sucesso" compacta>
                      Válida
                    </Etiqueta>
                  ) : (
                    <ul className="lista-erros">
                      {l.erros.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
