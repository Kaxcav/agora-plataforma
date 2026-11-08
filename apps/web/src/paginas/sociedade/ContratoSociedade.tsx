/**
 * Painel da gestão compartilhada de um contrato (RF-37): fotos e vídeos da execução publicados pela fiscalização
 * (art. 19, III), com o ponto de checagem do sigilo; manifestações; e o relatório final ao fim da vigência.
 */
import { useId, useState, type ChangeEvent, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { Camera, FileCheck2 } from 'lucide-react';
import { formatarData, formatarMoeda, LIMITES_GESTAO_COMPARTILHADA } from '@agora/dominio';
import type { ConclusaoRelatorioFinal, GestaoCompartilhadaContrato, RegistroExecucaoInterno } from '@agora/contratos';
import { useEnviarRegistroExecucao, useGestaoContrato, usePublicarRelatorioFinal } from '../../api/sociedade';
import {
  Alerta,
  AreaTexto,
  Botao,
  CaixaSelecao,
  Campo,
  CampoTexto,
  ConteudoConsulta,
  Dialogo,
  EsqueletoDetalhe,
  Etiqueta,
  GrupoOpcoes,
  LinkBotao,
  ListaDefinicoes,
  Pagina,
  Secao,
  useAvisos,
} from '../../componentes';
import { useSessao } from '../../sessao/ContextoSessao';
import { formatarInstante } from '../../utilitarios/formatacao';
import { formatarTamanho } from '../documentos/rotulos';
import { ErroOperacao } from '../jornada/comum';
import { CartaoManifestacao } from './CartaoManifestacao';
import { CONCLUSOES } from './rotulos';
import '../../design/paginas-sociedade.css';

function hojeLocal(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
}

function EnviarRegistro({ g, aberto, aoFechar }: { g: GestaoCompartilhadaContrato; aberto: boolean; aoFechar: () => void }) {
  const base = useId();
  const { avisar } = useAvisos();
  const enviar = useEnviarRegistroExecucao(g.contrato.id);
  const [arquivo, definirArquivo] = useState<File | null>(null);
  const [titulo, definirTitulo] = useState('');
  const [descricao, definirDescricao] = useState('');
  const [data, definirData] = useState(hojeLocal());
  const [sigiloso, definirSigiloso] = useState(false);
  const [tentou, definirTentou] = useState(false);
  const limite = g.tamanhoMaximoVideoBytes;
  const erroArquivo = arquivo === null ? 'Escolha a foto ou o vídeo.' : arquivo.size > limite ? `O arquivo passa do limite de ${formatarTamanho(limite)}.` : null;
  const erroTitulo = titulo.trim().length < 3 ? 'Informe um título com pelo menos 3 caracteres.' : null;
  const erroData = data === '' ? 'Informe o dia do registro.' : data > hojeLocal() ? 'A data não pode ser futura.' : null;

  const fechar = () => {
    definirArquivo(null);
    definirTitulo('');
    definirDescricao('');
    definirSigiloso(false);
    definirTentou(false);
    enviar.reset();
    aoFechar();
  };

  const confirmar = (evento?: FormEvent) => {
    evento?.preventDefault();
    definirTentou(true);
    if (erroArquivo || erroTitulo || erroData || arquivo === null) return;
    enviar.mutate(
      { arquivo, titulo: titulo.trim(), descricao: descricao.trim(), registradoEm: data, sigiloso },
      {
        onSuccess: (r: RegistroExecucaoInterno) => {
          avisar({
            tipo: 'sucesso',
            titulo: r.publicado ? 'Registro publicado' : 'Registro guardado sem publicação',
            mensagem: r.publicado ? 'A foto ou o vídeo já aparece na página pública do contrato, sem os dados de localização.' : (r.motivoRetencao ?? 'Registro sigiloso.'),
          });
          fechar();
        },
      },
    );
  };

  return (
    <Dialogo
      aberto={aberto}
      aoFechar={fechar}
      largura="media"
      titulo="Publicar foto ou vídeo da execução"
      descricao={`JPEG, PNG ou vídeo MP4 de até ${formatarTamanho(limite)}. O tipo é conferido pelo conteúdo e a localização e os dados do aparelho são retirados antes de guardar.`}
      rodape={
        <>
          <Botao variante="terciario" onClick={fechar}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={Camera} carregando={enviar.isPending} onClick={() => confirmar()}>
            Publicar registro
          </Botao>
        </>
      }
    >
      <form className="pilha" onSubmit={confirmar} noValidate>
        <Campo id={`${base}-arquivo`} rotulo="Foto ou vídeo" obrigatorio erro={tentou ? erroArquivo : null}>
          {(atributos) => (
            <input
              {...atributos}
              className="campo__controle"
              type="file"
              accept=".jpg,.jpeg,.png,.mp4,.mov,image/jpeg,image/png,video/mp4,video/quicktime"
              onChange={(e: ChangeEvent<HTMLInputElement>) => definirArquivo(e.target.files?.[0] ?? null)}
            />
          )}
        </Campo>
        <CampoTexto rotulo="Título" obrigatorio maxLength={200} value={titulo} onChange={(e) => definirTitulo(e.target.value)} erro={tentou ? erroTitulo : null} ajuda="Ex.: Fundações do bloco B, medição 3." />
        <AreaTexto rotulo="Descrição (opcional)" maxLength={2000} contador rows={3} value={descricao} onChange={(e) => definirDescricao(e.target.value)} />
        <CampoTexto rotulo="Dia do registro" obrigatorio type="date" max={hojeLocal()} value={data} onChange={(e) => definirData(e.target.value)} erro={tentou ? erroData : null} />
        <CaixaSelecao
          rotulo="Contém elemento sigiloso (art. 13): guardar sem publicar"
          ajuda="Use quando a imagem mostrar elemento cujo sigilo seja imprescindível à segurança da sociedade e do Estado, como instalações táticas."
          checked={sigiloso}
          onChange={(e) => definirSigiloso(e.target.checked)}
        />
        <ErroOperacao erro={enviar.error} titulo="O registro não foi recebido" />
      </form>
    </Dialogo>
  );
}

function Registros({ g }: { g: GestaoCompartilhadaContrato }) {
  const { temPermissao } = useSessao();
  const [enviando, definirEnviando] = useState(false);
  return (
    <Secao
      titulo="Acompanhamento da execução"
      id="registros-execucao"
      descricao="Fotos e vídeos da obra ou do serviço publicados para a sociedade (art. 19, III). O registro marcado como sigiloso fica guardado e não é publicado."
      acoes={
        temPermissao('sociedade:registrar') ? (
          g.armazenamentoDisponivel ? (
            <Botao variante="primario" icone={Camera} onClick={() => definirEnviando(true)}>
              Publicar foto ou vídeo
            </Botao>
          ) : null
        ) : null
      }
    >
      {!g.armazenamentoDisponivel ? (
        <Alerta tipo="aviso" titulo="Armazenamento de arquivos desligado">
          <p>Defina AGORA_ARQUIVOS_DIR no servidor para publicar fotos e vídeos.</p>
        </Alerta>
      ) : null}
      {g.registros.length === 0 ? (
        <p className="texto-secundario">Nenhum registro da execução deste contrato.</p>
      ) : (
        <ul className="sociedade__galeria" aria-label="Registros da execução">
          {g.registros.map((r) => (
            <li key={r.id}>
              <figure className="sociedade__midia">
                {r.midia === 'video' ? (
                  <video controls preload="metadata" src={r.url} aria-label={r.titulo}>
                    <a href={r.url}>Baixar o vídeo {r.titulo}</a>
                  </video>
                ) : (
                  <img src={r.url} alt={r.titulo} loading="lazy" />
                )}
                <figcaption className="pilha pilha--compacta">
                  <strong>{r.titulo}</strong>
                  <span>
                    {r.publicado ? (
                      <Etiqueta tom="sucesso">Publicado</Etiqueta>
                    ) : (
                      <Etiqueta tom="aviso" titulo={r.motivoRetencao ?? undefined}>
                        Guardado sem publicar (sigilo)
                      </Etiqueta>
                    )}
                  </span>
                  <span className="texto-pequeno texto-secundario">
                    {formatarData(r.registradoEm)} · {r.enviadoPor} · {formatarTamanho(r.bytes)}
                  </span>
                  {r.metadadosRemovidos.length > 0 ? <span className="texto-pequeno texto-secundario">Retirado: {r.metadadosRemovidos.join(', ')}.</span> : null}
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}
      <EnviarRegistro g={g} aberto={enviando} aoFechar={() => definirEnviando(false)} />
    </Secao>
  );
}

function RelatorioFinal({ g }: { g: GestaoCompartilhadaContrato }) {
  const { temPermissao } = useSessao();
  const { avisar } = useAvisos();
  const publicar = usePublicarRelatorioFinal(g.contrato.id);
  const [objetivos, definirObjetivos] = useState('');
  const [resultados, definirResultados] = useState('');
  const [conclusao, definirConclusao] = useState<ConclusaoRelatorioFinal>('atingidos');
  const [tentou, definirTentou] = useState(false);
  const { relatorioMinimo, relatorioMaximo } = LIMITES_GESTAO_COMPARTILHADA;
  const r = g.relatorioFinal;

  if (r) {
    return (
      <Secao titulo="Relatório final" id="relatorio-final" descricao="Publicado na página pública do contrato (art. 174, § 3º, VI, d).">
        <div className="pilha">
          <ListaDefinicoes
            itens={[
              { termo: 'Conclusão', valor: CONCLUSOES[r.conclusao] },
              { termo: 'Publicado em', valor: formatarInstante(r.publicadoEm) },
              { termo: 'Responsável', valor: r.publicadoPor },
              { termo: 'Valor pago', valor: formatarMoeda(r.execucao.valorPago) },
              { termo: 'SHA-256', valor: <span className="dados-abertos__hash">{r.sha256}</span>, largo: true },
            ]}
          />
          <h3>Objetivos</h3>
          <p className="sociedade__texto">{r.objetivos}</p>
          <h3>Resultados</h3>
          <p className="sociedade__texto">{r.resultados}</p>
        </div>
      </Secao>
    );
  }
  if (!g.contrato.encerrado) {
    return (
      <Secao titulo="Relatório final" id="relatorio-final">
        <p className="texto-secundario">O relatório final é publicado ao fim da vigência, a partir de {formatarData(g.contrato.vigenciaFim)}.</p>
      </Secao>
    );
  }
  if (!temPermissao('sociedade:relatorio_final')) {
    return (
      <Secao titulo="Relatório final" id="relatorio-final">
        <p className="texto-secundario">A vigência terminou; o relatório final ainda não foi publicado pela gestão do contrato.</p>
      </Secao>
    );
  }
  const erroObjetivos = objetivos.trim().length < relatorioMinimo ? `Escreva pelo menos ${relatorioMinimo} caracteres.` : null;
  const erroResultados = resultados.trim().length < relatorioMinimo ? `Escreva pelo menos ${relatorioMinimo} caracteres.` : null;
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    definirTentou(true);
    if (erroObjetivos || erroResultados) return;
    publicar.mutate(
      { objetivos: objetivos.trim(), resultados: resultados.trim(), conclusao },
      { onSuccess: () => avisar({ tipo: 'sucesso', titulo: 'Relatório final publicado', mensagem: 'O relatório já aparece na página pública do contrato.' }) },
    );
  };
  return (
    <Secao titulo="Relatório final" id="relatorio-final" descricao="Informações sobre a consecução dos objetivos que justificaram a contratação (art. 174, § 3º, VI, d). A publicação é única e fica na trilha de auditoria.">
      <form className="formulario" onSubmit={enviar} noValidate>
        <AreaTexto rotulo="Objetivos que justificaram a contratação" obrigatorio contador maxLength={relatorioMaximo} rows={5} value={objetivos} onChange={(e) => definirObjetivos(e.target.value)} erro={tentou ? erroObjetivos : null} />
        <AreaTexto rotulo="Resultados alcançados" obrigatorio contador maxLength={relatorioMaximo} rows={5} value={resultados} onChange={(e) => definirResultados(e.target.value)} erro={tentou ? erroResultados : null} />
        <GrupoOpcoes
          legenda="Conclusão"
          nome="conclusao-relatorio"
          valor={conclusao}
          aoMudar={definirConclusao}
          opcoes={(Object.keys(CONCLUSOES) as ConclusaoRelatorioFinal[]).map((c) => ({ valor: c, rotulo: CONCLUSOES[c] }))}
        />
        <ErroOperacao erro={publicar.error} titulo="O relatório não foi publicado" />
        <div className="sociedade__acoes">
          <Botao type="submit" variante="primario" icone={FileCheck2} carregando={publicar.isPending}>
            Publicar relatório final
          </Botao>
        </div>
      </form>
    </Secao>
  );
}

export default function ContratoSociedade() {
  const { id = '' } = useParams();
  const consulta = useGestaoContrato(id);
  const g = consulta.data;
  return (
    <Pagina
      titulo={g ? `Gestão compartilhada: contrato ${g.contrato.numero}` : 'Gestão compartilhada do contrato'}
      tituloDocumento="Gestão compartilhada do contrato"
      trilha={[{ rotulo: 'Gestão compartilhada', para: '/sociedade' }]}
      subtitulo={g?.contrato.objeto}
      tela="sociedade.contrato"
      acoes={
        g ? (
          <LinkBotao to={`/transparencia/contratos/${g.contrato.id}`} variante="secundario">
            Ver a página pública
          </LinkBotao>
        ) : null
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoDetalhe />}
        rotuloCarregando="Carregando a gestão compartilhada do contrato"
        naoEncontrado={{ titulo: 'Contrato não encontrado', descricao: 'O contrato não existe ou está fora das UASGs do seu escopo.' }}
      >
        {(dados) => (
          <div className="pilha pilha--ampla">
            <Registros g={dados} />
            <Secao titulo="Manifestações" id="manifestacoes-contrato" descricao={`Prazo de resposta: ${dados.prazoRespostaDias} dias a partir do recebimento.`}>
              {dados.manifestacoes.length === 0 ? (
                <p className="texto-secundario">Nenhuma manifestação sobre este contrato.</p>
              ) : (
                <ul className="sociedade__manifestacoes" aria-label="Manifestações do contrato">
                  {dados.manifestacoes.map((m) => (
                    <CartaoManifestacao key={m.id} m={m} mostrarContrato={false} />
                  ))}
                </ul>
              )}
            </Secao>
            <RelatorioFinal g={dados} />
          </div>
        )}
      </ConteudoConsulta>
    </Pagina>
  );
}
