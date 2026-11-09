import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { formatarData, formatarMoeda } from '@agora/dominio';
import { useOrdemCronologicaPublica } from '../../api/publico';
import {
  Campo,
  EstadoVazio,
  FalhaConsulta,
  EsqueletoTabela,
  Pagina,
} from '../../componentes';

function mesAtualPadrao(): string {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  return `${ano}-${mes}`;
}

export default function OrdemCronologica() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mesParam = searchParams.get('mes');
  const [mes, setMes] = useState<string>(mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesAtualPadrao());

  const consulta = useOrdemCronologicaPublica(mes);

  const aoMudarMes = (novoMes: string) => {
    setMes(novoMes);
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev);
      if (novoMes) p.set('mes', novoMes);
      else p.delete('mes');
      return p;
    });
  };

  return (
    <Pagina
      titulo="Ordem cronológica dos pagamentos"
      tituloDocumento="Ordem cronológica dos pagamentos"
      subtitulo="Publicação mensal da ordem cronológica de exigibilidade dos pagamentos e das justificativas de alteração (Lei 14.133/2021, art. 141, § 3º)."
      trilha={[{ rotulo: 'Transparência', para: '/transparencia' }]}
      tela="ordem-cronologica"
    >
      <p className="texto-secundario">
        Em cumprimento ao art. 141, § 3º da Lei 14.133/2021, o órgão publica mensalmente a ordem cronológica para cada fonte diferenciada
        de recursos e as justificativas fundamentadas para eventuais alterações dessa ordem. Em atenção à Lei Geral de Proteção de Dados Pessoais
        (LGPD) e à Lei de Acesso à Informação (LAI), credores pessoa física têm seu CPF mascarado, e contratações com sigilo vigente de segurança
        pública têm seu objeto e credor resguardados sob rotulagem de informação classificada. Consulte também{' '}
        <Link to="/transparencia">Transparência: contratos</Link> e{' '}
        <Link to="/transparencia/editais">Editais publicados</Link>.
      </p>

      <div className="barra-filtros margem-abaixo">
        <div className="grupo-campos">
          <Campo rotulo="Mês de referência (AAAA-MM)" id="seletor-mes">
            {(atributos) => (
              <input
                {...atributos}
                type="month"
                value={mes}
                className="campo-texto"
                aria-label="Selecionar mês de referência da ordem cronológica"
                onChange={(e) => aoMudarMes(e.target.value)}
              />
            )}
          </Campo>
        </div>
      </div>

      {consulta.isError && consulta.data === undefined ? (
        <FalhaConsulta consulta={consulta} />
      ) : consulta.isLoading ? (
        <EsqueletoTabela linhas={6} colunas={8} />
      ) : !consulta.data || consulta.data.uasgs.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum pagamento ou alteração encontrada"
          descricao={`Não constam pagamentos exigíveis ou alterações da ordem cronológica registrados para o mês ${mes}.`}
        />
      ) : (
        <div className="pilha pilha--espacada">
          {consulta.data.uasgs.map((u) => (
            <section key={u.uasg} className="cartao pilha" aria-labelledby={`uasg-titulo-${u.uasg}`}>
              <header className="cartao__cabecalho">
                <h2 id={`uasg-titulo-${u.uasg}`} className="cartao__titulo">
                  {u.orgao} — UASG {u.uasg}
                </h2>
              </header>

              <div className="cartao__corpo pilha pilha--espacada">
                {u.fontes.map((f) => (
                  <div key={f.fonteRecurso} className="pilha">
                    <h3 className="titulo-secao">Fonte de recursos: {f.fonteRecurso}</h3>

                    {f.notas.length === 0 ? (
                      <p className="texto-secundario">Nenhuma nota fiscal na fila desta fonte no mês de referência.</p>
                    ) : (
                      <div className="tabela-conteiner">
                        <table className="tabela" id={`tabela-notas-${u.uasg}-${f.fonteRecurso}`}>
                          <caption className="sr-only">
                            Ordem cronológica de pagamentos da UASG {u.uasg}, fonte {f.fonteRecurso}, mês {mes}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col" className="numero">Posição</th>
                              <th scope="col">Contrato</th>
                              <th scope="col">Objeto</th>
                              <th scope="col">Credor / Fornecedor</th>
                              <th scope="col">CNPJ / CPF</th>
                              <th scope="col" className="texto-fim">Valor</th>
                              <th scope="col">Exigibilidade</th>
                              <th scope="col">Situação</th>
                              <th scope="col">Pago em</th>
                            </tr>
                          </thead>
                          <tbody>
                            {f.notas.map((n) => (
                              <tr key={n.id}>
                                <td className="numero">
                                  {n.posicaoFila !== null ? `${n.posicaoFila}º` : '—'}
                                </td>
                                <td className="sem-quebra">Contrato {n.numeroContrato}</td>
                                <td>{n.objeto}</td>
                                <td>{n.fornecedor.razaoSocial}</td>
                                <td className="mono sem-quebra">
                                  {n.fornecedor.cnpj ?? n.fornecedor.cpf ?? '—'}
                                </td>
                                <td className="texto-fim numero sem-quebra">{formatarMoeda(n.valor)}</td>
                                <td className="sem-quebra numero">{formatarData(n.dataExigibilidade)}</td>
                                <td>
                                  <span className={`etiqueta etiqueta--${n.situacao === 'pago' ? 'sucesso' : n.situacao === 'atrasado' ? 'perigo' : 'info'}`}>
                                    {n.situacao}
                                  </span>
                                </td>
                                <td className="sem-quebra numero">{n.pagoEm ? formatarData(n.pagoEm) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {f.alteracoes.length > 0 ? (
                      <div className="pilha margem-topo">
                        <h4 className="texto-negrito texto-perigo">
                          Alterações justificadas da ordem cronológica no mês (art. 141, § 1º)
                        </h4>
                        <div className="tabela-conteiner">
                          <table className="tabela" id={`tabela-alteracoes-${u.uasg}-${f.fonteRecurso}`}>
                            <caption className="sr-only">
                              Justificativas de alteração da ordem cronológica na UASG {u.uasg}, fonte {f.fonteRecurso}, mês {mes}
                            </caption>
                            <thead>
                              <tr>
                                <th scope="col">Contrato</th>
                                <th scope="col">Inciso</th>
                                <th scope="col">Justificativa</th>
                                <th scope="col">Autoridade</th>
                                <th scope="col">Ato</th>
                                <th scope="col">Data</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.alteracoes.map((a) => (
                                <tr key={a.id}>
                                  <td className="sem-quebra">Contrato {a.numeroContrato}</td>
                                  <td className="sem-quebra">Inciso {a.inciso}</td>
                                  <td>{a.justificativa}</td>
                                  <td>{a.autoridade}</td>
                                  <td>{a.ato}</td>
                                  <td className="sem-quebra numero">{formatarData(a.data)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Pagina>
  );
}
