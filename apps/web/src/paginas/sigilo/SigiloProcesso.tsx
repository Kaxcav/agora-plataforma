/**
 * `/jornada/:id/sigilo` — sigilo de segurança pública do processo (RF-33): classificação do processo, dos documentos,
 * dos anexos e do contrato (RN-40), credenciamento, cofre de anexos (RNF-09) e registro de todos os acessos.
 * O servidor decide quem acessa; a tela mostra a decisão e registra o motivo de cada acesso ao conteúdo.
 */
import { useId, useState } from 'react';
import { useParams } from 'react-router';
import { ArrowLeft, FileDown, KeyRound, Lock, LockOpen, ShieldCheck, Upload, UserMinus, UserPlus } from 'lucide-react';
import type { ClassificacaoSigilo, ItemSigiloProcesso, SigiloProcesso as DadosSigilo } from '@agora/contratos';
import { formatarData } from '@agora/dominio';
import {
  useAcessosSigilo,
  useBaixarAnexoCofre,
  useBaixarPdfMarcado,
  useDesclassificarSigilo,
  useRevogarCredencialSigilo,
  useSigiloProcesso,
} from '../../api/sigilo';
import { Alerta, Botao, ConteudoConsulta, EsqueletoTexto, Etiqueta, LinkBotao, ListaDefinicoes, Pagina, Paginacao, Secao, useAvisos } from '../../componentes';
import { formatarInstante, formatarNumero } from '../../utilitarios/formatacao';
import { DialogoClassificar, DialogoCredencial, DialogoMotivo, type AlvoDialogo, type PedidoMotivo } from './Dialogos';
import { BASES_ACESSO, OPERACOES, ROTULO_GRAU, rotuloClassificacao, SITUACOES, termoFinal } from './rotulos';

function EtiquetaClassificacao({ c }: { c: ClassificacaoSigilo | null }) {
  if (c === null) return <span className="texto-secundario">Sem classificação</span>;
  const situacao = SITUACOES[c.situacao];
  return (
    <span className="pilha pilha--compacta">
      <Etiqueta tom={c.situacao === 'vigente' ? 'alerta' : 'neutro'} compacta icone={c.situacao === 'vigente' ? Lock : LockOpen}>
        {c.situacao === 'vigente' ? rotuloClassificacao(c) : situacao.rotulo}
      </Etiqueta>
      <span className="texto-pequeno texto-secundario mono">{c.codigoIndexacao}</span>
    </span>
  );
}

function DetalhesClassificacao({ c }: { c: ClassificacaoSigilo }) {
  return (
    <ListaDefinicoes
      itens={[
        { termo: 'Situação', valor: <Etiqueta tom={SITUACOES[c.situacao].tom} compacta>{SITUACOES[c.situacao].rotulo}</Etiqueta> },
        { termo: 'Tipo', valor: c.tipo === 'lai' ? `Informação ${c.grau ? ROTULO_GRAU[c.grau].toLowerCase() : 'classificada'} (Lei 12.527/2011)` : 'Orçamento sigiloso (Lei 14.133/2021, art. 24)' },
        { termo: 'Código de indexação', valor: <span className="mono">{c.codigoIndexacao}</span> },
        { termo: 'Hipótese', valor: c.hipotese ? `Art. 23, ${c.hipotese}` : '—' },
        { termo: 'Produção da informação', valor: formatarData(c.dataProducao) },
        { termo: 'Termo final', valor: termoFinal(c) },
        { termo: 'Autoridade classificadora', valor: c.autoridade ? `${c.autoridade.nome} — ${c.autoridade.cargo}` : '—' },
        { termo: 'Registrada por', valor: `${c.classificadaPor.nome} em ${formatarInstante(c.classificadaEm)} (versão ${c.versao})` },
        { termo: 'Fundamento', valor: c.fundamento, largo: true },
        { termo: 'Razões', valor: c.razoes, largo: true },
      ]}
    />
  );
}

function MeuAcesso({ s }: { s: DadosSigilo }) {
  const { orgaoControle, credencial } = s.meuAcesso;
  if (orgaoControle) {
    return (
      <Alerta tipo="info" titulo="Você acessa como órgão de controle">
        <p>O acesso é irrestrito (Lei 14.133/2021, art. 24, I, e art. 169, § 2º) e cada acesso fica registrado. Quem recebe a informação passa a responder pela manutenção do sigilo.</p>
      </Alerta>
    );
  }
  if (credencial) {
    return (
      <Alerta tipo="sucesso" titulo={`Você tem credencial neste processo até o grau ${ROTULO_GRAU[credencial.grauMaximo].toLowerCase()}`}>
        <p>
          {credencial.validaAte ? `Válida até ${formatarData(credencial.validaAte)}. ` : 'Válida até a revogação. '}Cada acesso ao conteúdo classificado fica registrado com o motivo.
        </p>
      </Alerta>
    );
  }
  return (
    <Alerta tipo="aviso" titulo="Você não tem credencial neste processo">
      <p>O conteúdo classificado fica oculto para você, e as tentativas de acesso são registradas. Para acessar, peça o credenciamento ao gestor de segurança e credenciamento.</p>
    </Alerta>
  );
}

export default function SigiloProcesso() {
  const { id = '' } = useParams();
  const consulta = useSigiloProcesso(id);
  const { avisar } = useAvisos();
  const pdf = useBaixarPdfMarcado(id);
  const cofre = useBaixarAnexoCofre(id);
  const desclassificar = useDesclassificarSigilo(id);
  const revogar = useRevogarCredencialSigilo(id);
  const [classificando, definirClassificando] = useState<AlvoDialogo | null>(null);
  const [pedido, definirPedido] = useState<PedidoMotivo | null>(null);
  const [credenciando, definirCredenciando] = useState(false);
  const [paginaAcessos, definirPaginaAcessos] = useState(1);
  const acessos = useAcessosSigilo(id, paginaAcessos);
  const idTabela = useId();
  const idAcessos = useId();
  const idCredenciais = useId();
  const s = consulta.data;
  const podeClassificar = s?.meuAcesso.podeClassificar ?? false;

  const pedirPdf = (item: ItemSigiloProcesso) => {
    if (!item.documentoTipo) return;
    const tipo = item.documentoTipo;
    definirPedido({
      titulo: `PDF marcado: ${item.titulo}`,
      descricao: 'O PDF sai com a marcação do grau de sigilo nos cabeçalhos e rodapés de todas as páginas. Informe para que você precisa do documento: o acesso fica registrado.',
      rotulo: 'Motivo do acesso',
      botao: 'Registrar e baixar',
      minimo: 10,
      maximo: 300,
      ajuda: 'Ex.: conferência das especificações na análise das propostas.',
      executar: (motivo) =>
        pdf.mutateAsync({ tipo, motivo }).then((nome) => avisar({ tipo: 'sucesso', titulo: 'Acesso registrado', mensagem: `${nome}: o acesso ficou registrado com o motivo informado.` })),
    });
  };

  const pedirCofre = (item: ItemSigiloProcesso) => {
    if (!item.arquivoId) return;
    const arquivoId = item.arquivoId;
    definirPedido({
      titulo: `Baixar do cofre: ${item.titulo}`,
      descricao: 'O anexo é decifrado no servidor só para este download. Informe o motivo: o acesso fica registrado.',
      rotulo: 'Motivo do acesso',
      botao: 'Registrar e baixar',
      minimo: 10,
      maximo: 300,
      executar: (motivo) =>
        cofre.mutateAsync({ arquivoId, motivo }).then((nome) => avisar({ tipo: 'sucesso', titulo: 'Acesso registrado', mensagem: `${nome}: o acesso ao anexo do cofre ficou registrado.` })),
    });
  };

  const pedirDesclassificacao = (titulo: string, c: ClassificacaoSigilo) => {
    definirPedido({
      titulo: `Desclassificar: ${titulo}`,
      descricao: 'Com a desclassificação, a informação volta a seguir as regras comuns de publicidade (Lei 14.133/2021, art. 13). O ato fica na trilha de auditoria.',
      rotulo: 'Motivo da desclassificação',
      botao: 'Desclassificar',
      minimo: 20,
      maximo: 1000,
      executar: (motivo) =>
        desclassificar.mutateAsync({ classificacaoId: c.id, motivo }).then(() => avisar({ tipo: 'sucesso', titulo: 'Informação desclassificada', mensagem: `${titulo} não é mais sigiloso.` })),
    });
  };

  const pedirRevogacao = (nome: string, credencialId: string) => {
    definirPedido({
      titulo: `Revogar a credencial de ${nome}`,
      descricao: 'A pessoa deixa de acessar o conteúdo classificado deste processo imediatamente.',
      rotulo: 'Motivo da revogação',
      botao: 'Revogar',
      minimo: 10,
      maximo: 500,
      executar: (motivo) => revogar.mutateAsync({ credencialId, motivo }).then(() => avisar({ tipo: 'sucesso', titulo: 'Credencial revogada', mensagem: `${nome} não tem mais acesso.` })),
    });
  };

  const acoesClassificacao = (alvo: AlvoDialogo, c: ClassificacaoSigilo | null) =>
    podeClassificar ? (
      <>
        <Botao tamanho="compacto" icone={Lock} aria-label={`${c?.situacao === 'vigente' ? 'Reclassificar' : 'Classificar'} ${alvo.titulo}`} onClick={() => definirClassificando({ ...alvo, atual: c?.situacao === 'vigente' ? c : null })}>
          {c?.situacao === 'vigente' ? 'Reclassificar' : 'Classificar'}
        </Botao>
        {c?.situacao === 'vigente' ? (
          <Botao tamanho="compacto" icone={LockOpen} aria-label={`Desclassificar ${alvo.titulo}`} onClick={() => pedirDesclassificacao(alvo.titulo, c)}>
            Desclassificar
          </Botao>
        ) : null}
      </>
    ) : null;

  return (
    <Pagina
      titulo="Sigilo do processo"
      trilha={[
        { rotulo: 'Início', para: '/' },
        { rotulo: 'Jornada da contratação', para: '/jornada' },
        { rotulo: s?.titulo ?? 'Processo', para: `/jornada/${encodeURIComponent(id)}` },
      ]}
      tela="jornada.sigilo"
      subtitulo={s ? <span className="mono">{s.numeroSei}</span> : undefined}
      acoes={
        <>
          <LinkBotao to={`/jornada/${encodeURIComponent(id)}`} icone={ArrowLeft}>
            Voltar ao processo
          </LinkBotao>
          {s && podeClassificar && s.cofre.disponivel ? (
            <Botao variante="primario" icone={Upload} onClick={() => definirClassificando({ alvo: 'anexo', titulo: 'anexo sigiloso', atual: null, novoAnexo: true })}>
              Enviar anexo sigiloso
            </Botao>
          ) : null}
        </>
      }
    >
      <ConteudoConsulta
        consulta={consulta}
        carregando={<EsqueletoTexto linhas={8} />}
        rotuloCarregando="Carregando o sigilo do processo"
        naoEncontrado={{ titulo: 'Processo não encontrado', descricao: 'O processo não existe ou está fora das UASGs do seu escopo.' }}
      >
        {(dados) => (
          <div className="pilha pilha--ampla">
            <MeuAcesso s={dados} />

            <Secao
              titulo="Classificação do processo"
              id="sigilo-processo"
              descricao="Processo classificado só abre para quem tem credencial nele; na transparência aparece apenas o registro mínimo (Decreto 7.845/2012, art. 20)."
              acoes={acoesClassificacao({ alvo: 'processo', titulo: `processo ${dados.numeroSei}`, atual: null }, dados.processo)}
            >
              {dados.processo ? <DetalhesClassificacao c={dados.processo} /> : <p>O processo não tem classificação de sigilo: os atos seguem a regra da publicidade (Lei 14.133/2021, art. 13).</p>}
            </Secao>

            <Secao
              titulo="Documentos e anexos"
              id="sigilo-documentos"
              descricao="Documento classificado não aparece na transparência nem vai ao PNCP; o conteúdo só é mostrado a quem tem acesso. Anexos sigilosos ficam cifrados no cofre."
            >
              {dados.itens.length === 0 ? (
                <p>O processo ainda não tem documentos gerados nem anexos.</p>
              ) : (
                <div className="tabela-rolagem" role="region" aria-labelledby={idTabela} tabIndex={0}>
                  <table className="tabela tabela--compacta">
                    <caption id={idTabela} className="tabela__legenda">
                      Classificação dos documentos e anexos ({formatarNumero(dados.itens.length)})
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Documento</th>
                        <th scope="col">Classificação</th>
                        <th scope="col">Termo final</th>
                        <th scope="col">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.itens.map((item) => {
                        const c = item.classificacao;
                        const vigente = c?.situacao === 'vigente';
                        const chave = item.documentoTipo ?? item.arquivoId ?? item.titulo;
                        return (
                          <tr key={chave}>
                            <th scope="row">
                              {item.titulo}
                              <span className="texto-pequeno texto-secundario documentos__detalhe">
                                {item.descricao}
                                {item.noCofre ? ' — no cofre (AES-256-GCM)' : ''}
                              </span>
                            </th>
                            <td>
                              <EtiquetaClassificacao c={c} />
                            </td>
                            <td>{c && vigente ? termoFinal(c) : '—'}</td>
                            <td className="tabela__celula--acoes">
                              {acoesClassificacao(
                                { alvo: item.alvo, ...(item.documentoTipo ? { documentoTipo: item.documentoTipo } : {}), ...(item.arquivoId ? { arquivoId: item.arquivoId } : {}), titulo: item.titulo, atual: null },
                                c,
                              )}
                              {item.alvo === 'documento' && vigente ? (
                                <Botao tamanho="compacto" icone={FileDown} aria-label={`PDF marcado ${item.titulo}`} carregando={pdf.isPending && pdf.variables?.tipo === item.documentoTipo} onClick={() => pedirPdf(item)}>
                                  PDF marcado
                                </Botao>
                              ) : null}
                              {item.noCofre ? (
                                <Botao tamanho="compacto" icone={KeyRound} aria-label={`Baixar do cofre ${item.titulo}`} onClick={() => pedirCofre(item)}>
                                  Baixar do cofre
                                </Botao>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {!dados.cofre.disponivel || dados.cofre.motivoIndisponivel ? (
                <p className="texto-pequeno texto-secundario">{dados.cofre.motivoIndisponivel ?? 'Cofre indisponível neste ambiente.'}</p>
              ) : null}
            </Secao>

            {dados.contrato ? (
              <Secao
                titulo={`Contrato ${dados.contrato.numero}`}
                id="sigilo-contrato"
                descricao="Contrato sigiloso (art. 91, § 1º) não é divulgado no PNCP, e a transparência mostra só número, unidade e vigência."
                acoes={acoesClassificacao({ alvo: 'contrato', titulo: `contrato ${dados.contrato.numero}`, atual: null }, dados.contrato.classificacao)}
              >
                {dados.contrato.classificacao ? <DetalhesClassificacao c={dados.contrato.classificacao} /> : <p>O contrato não é sigiloso.</p>}
              </Secao>
            ) : null}

            <Secao titulo="Orçamento estimado (art. 24)" id="sigilo-orcamento">
              <ListaDefinicoes
                itens={[
                  {
                    termo: 'Situação',
                    valor: (
                      <Etiqueta tom={dados.orcamento.situacao === 'sigiloso' ? 'alerta' : 'neutro'} compacta>
                        {dados.orcamento.situacao === 'sigiloso' ? 'Sigiloso' : dados.orcamento.situacao === 'divulgado' ? 'Divulgado' : 'Público'}
                      </Etiqueta>
                    ),
                  },
                  { termo: 'Divulgado em', valor: dados.orcamento.divulgadoEm ? formatarInstante(dados.orcamento.divulgadoEm) : '—' },
                  { termo: 'Motivo do sigilo', valor: dados.orcamento.motivo ?? '—', largo: true },
                  { termo: 'Regra', valor: `${dados.orcamento.mensagem} (${dados.orcamento.fundamento})`, largo: true },
                ]}
              />
            </Secao>

            <Secao
              titulo="Credenciais de acesso"
              id="sigilo-credenciais"
              descricao="Quem tem necessidade de conhecer a informação e credencial de segurança, ou termo de compromisso de manutenção de sigilo (Decreto 7.845/2012, art. 18)."
              acoes={
                dados.meuAcesso.podeCredenciar ? (
                  <Botao icone={UserPlus} onClick={() => definirCredenciando(true)}>
                    Credenciar
                  </Botao>
                ) : null
              }
            >
              {dados.credenciais.length === 0 ? (
                <p>Ninguém credenciado neste processo.</p>
              ) : (
                <div className="tabela-rolagem" role="region" aria-labelledby={idCredenciais} tabIndex={0}>
                  <table className="tabela tabela--compacta">
                    <caption id={idCredenciais} className="tabela__legenda">
                      Credenciais ({formatarNumero(dados.credenciais.filter((c) => c.ativa).length)} ativas)
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Pessoa</th>
                        <th scope="col">Grau máximo</th>
                        <th scope="col">Fundamento</th>
                        <th scope="col">Validade</th>
                        <th scope="col">Situação</th>
                        <th scope="col">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.credenciais.map((c) => (
                        <tr key={c.id}>
                          <th scope="row">
                            {c.usuario.nome}
                            <span className="texto-pequeno texto-secundario documentos__detalhe">{c.necessidade}</span>
                          </th>
                          <td>{ROTULO_GRAU[c.grauMaximo]}</td>
                          <td>{c.fundamento === 'tcms' ? 'Termo de compromisso' : 'Credencial de segurança'}</td>
                          <td className="numero">{c.validaAte ? formatarData(c.validaAte) : 'Até a revogação'}</td>
                          <td>
                            {c.ativa ? (
                              <Etiqueta tom="sucesso" compacta>
                                Ativa
                              </Etiqueta>
                            ) : (
                              <span className="texto-secundario">Revogada{c.revogadaEm ? ` em ${formatarInstante(c.revogadaEm)}` : ''}</span>
                            )}
                          </td>
                          <td className="tabela__celula--acoes">
                            {c.ativa && dados.meuAcesso.podeCredenciar ? (
                              <Botao tamanho="compacto" icone={UserMinus} aria-label={`Revogar a credencial de ${c.usuario.nome}`} onClick={() => pedirRevogacao(c.usuario.nome, c.id)}>
                                Revogar
                              </Botao>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>

            <Secao
              titulo="Registro de acessos"
              id="sigilo-acessos"
              descricao="Todo acesso a informação sigilosa, permitido ou negado, fica registrado (Decreto 7.845/2012, art. 38, § 4º). Quem não gere o sigilo vê só os próprios acessos."
            >
              <ConteudoConsulta consulta={acessos} carregando={<EsqueletoTexto linhas={4} />} rotuloCarregando="Carregando os acessos">
                {(p) =>
                  p.total === 0 ? (
                    <p>Nenhum acesso registrado.</p>
                  ) : (
                    <div className="pilha">
                      <div className="tabela-rolagem" role="region" aria-labelledby={idAcessos} tabIndex={0}>
                        <table className="tabela tabela--compacta">
                          <caption id={idAcessos} className="tabela__legenda">
                            Acessos registrados ({formatarNumero(p.total)})
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">Quando</th>
                              <th scope="col">Pessoa</th>
                              <th scope="col">Informação</th>
                              <th scope="col">Operação</th>
                              <th scope="col">Decisão</th>
                              <th scope="col">Motivo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.itens.map((a) => (
                              <tr key={a.id}>
                                <td className="numero sem-quebra">{formatarInstante(a.ocorridoEm)}</td>
                                <th scope="row">{a.usuario.nome}</th>
                                <td>{a.titulo}</td>
                                <td>{OPERACOES[a.operacao]}</td>
                                <td>
                                  <Etiqueta tom={BASES_ACESSO[a.base].tom} compacta icone={a.permitido ? ShieldCheck : undefined}>
                                    {BASES_ACESSO[a.base].rotulo}
                                  </Etiqueta>
                                </td>
                                <td>{a.motivo ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Paginacao pagina={p.pagina} tamanhoPagina={p.tamanhoPagina} total={p.total} aoMudarPagina={definirPaginaAcessos} rotulo="Paginação dos acessos" />
                    </div>
                  )
                }
              </ConteudoConsulta>
            </Secao>

            {dados.historico.length > 0 ? (
              <details>
                <summary>Classificações anteriores ({formatarNumero(dados.historico.length)})</summary>
                <ul className="lista-simples">
                  {dados.historico.map((h) => (
                    <li key={h.id}>
                      <span className="mono">{h.codigoIndexacao}</span> — versão {h.versao}, encerrada{h.desclassificadaEm ? ` em ${formatarInstante(h.desclassificadaEm)}` : ''}
                      {h.motivoDesclassificacao ? `: ${h.motivoDesclassificacao}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {classificando ? <DialogoClassificar processoId={id} alvo={classificando} aoFechar={() => definirClassificando(null)} /> : null}
            {credenciando ? <DialogoCredencial processoId={id} sigilo={dados} aoFechar={() => definirCredenciando(false)} /> : null}
          </div>
        )}
      </ConteudoConsulta>
      {pedido ? <DialogoMotivo pedido={pedido} aoFechar={() => definirPedido(null)} /> : null}
    </Pagina>
  );
}
