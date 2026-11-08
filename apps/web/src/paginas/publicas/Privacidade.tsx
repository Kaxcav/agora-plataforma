import { useConfiguracaoPublica } from '../../api/sessao';
import { Alerta, Esqueleto, Pagina } from '../../componentes';

/** Política de privacidade e LGPD (Lei 13.709/2018). */
export default function Privacidade() {
  const { data: config, isPending } = useConfiguracaoPublica();
  const orgao = config ? `${config.orgao.nome}${config.orgao.unidade ? ` — ${config.orgao.unidade}` : ''}` : null;

  return (
    <Pagina
      titulo="Privacidade e proteção de dados pessoais"
      tituloDocumento="Privacidade e LGPD"
      subtitulo="Como a Ágora trata dados pessoais, com que finalidade e quais são os seus direitos (Lei 13.709/2018 — LGPD)."
      estreita
    >
      <div className="texto-institucional">
        <section aria-labelledby="priv-controlador">
          <h2 id="priv-controlador">Controlador e encarregado</h2>
          <p>
            O controlador dos dados tratados nesta plataforma é{' '}
            {orgao ? <strong>{orgao}</strong> : isPending ? <Esqueleto largura="14rem" /> : 'o órgão responsável pela implantação'}, que utiliza a Ágora
            para gerir suas contratações públicas. A plataforma é implantada na infraestrutura do próprio órgão; nenhum dado é enviado a serviços
            de terceiros pelo navegador.
          </p>
          <p>
            Encarregado pelo tratamento de dados pessoais (LGPD, art. 41):{' '}
            {config ? (
              <>
                <strong>{config.encarregadoLgpd.nome}</strong> — <a href={`mailto:${config.encarregadoLgpd.email}`}>{config.encarregadoLgpd.email}</a>
              </>
            ) : isPending ? (
              <Esqueleto largura="16rem" />
            ) : (
              'consulte o canal de atendimento do órgão'
            )}
            .
          </p>
        </section>

        <section aria-labelledby="priv-dados">
          <h2 id="priv-dados">Dados pessoais tratados</h2>
          <ul>
            <li>
              <strong>Usuários da plataforma</strong> (servidores e colaboradores): nome, e-mail institucional, CPF, perfis de acesso, UASGs de atuação,
              unidade interna e data do último acesso.
            </li>
            <li>
              <strong>Fornecedores pessoa física e credores</strong>: nome, CPF, telefone e e-mail de contato, necessários à execução dos contratos e
              dos pagamentos.
            </li>
            <li>
              <strong>Sócios de fornecedores</strong>: CPF, usado apenas para sinalizar possíveis conflitos de interesse (Lei 14.133/2021, art. 9º e art.
              14) — sinal para análise, nunca acusação.
            </li>
            <li>
              <strong>Registros técnicos</strong>: data, hora e ação de cada operação, com o endereço IP armazenado apenas de forma irreversível
              (resumo criptográfico).
            </li>
          </ul>
        </section>

        <section aria-labelledby="priv-finalidades">
          <h2 id="priv-finalidades">Finalidades e bases legais</h2>
          <div className="tabela-rolagem" role="region" aria-labelledby="priv-tabela-bases" tabIndex={0}>
            <table className="tabela tabela--compacta">
              <caption id="priv-tabela-bases" className="tabela__legenda">
                Finalidades do tratamento e respectivas bases legais
              </caption>
              <thead>
                <tr>
                  <th scope="col">Finalidade</th>
                  <th scope="col">Base legal</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Planejar, contratar e gerir contratações públicas (atas, contratos, empenhos e pagamentos)</th>
                  <td>Cumprimento de obrigação legal e execução de políticas públicas — LGPD, art. 7º, II e III, e art. 23; Lei 14.133/2021</td>
                </tr>
                <tr>
                  <th scope="row">Autenticar usuários e controlar o acesso por perfil e UASG</th>
                  <td>Execução de políticas públicas e segurança da informação — LGPD, art. 7º, III, e art. 46</td>
                </tr>
                <tr>
                  <th scope="row">Manter trilha de auditoria das operações</th>
                  <td>Cumprimento de obrigação legal e controle — LGPD, art. 7º, II; Lei 14.133/2021, arts. 169 a 171</td>
                </tr>
                <tr>
                  <th scope="row">Divulgar contratos no PNCP e no portal de transparência</th>
                  <td>Obrigação legal de transparência — Lei 14.133/2021, arts. 94 e 174; Lei 12.527/2011</td>
                </tr>
                <tr>
                  <th scope="row">Instruir processos sancionatórios</th>
                  <td>Exercício regular de direitos em processo administrativo — LGPD, art. 7º, VI; Lei 14.133/2021, arts. 155 a 163</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="priv-protecao">
          <h2 id="priv-protecao">Como os dados são protegidos</h2>
          <ul>
            <li>CPF, e-mail e telefone aparecem mascarados por padrão (ex.: ***.456.789-**).</li>
            <li>
              Ver o dado completo exige permissão específica e a indicação da finalidade; cada acesso é registrado com usuário, data e motivo (LGPD,
              art. 37) e pode ser consultado pela auditoria.
            </li>
            <li>Toda escrita gera um evento na trilha de auditoria encadeada por hash, que não pode ser alterada nem excluída.</li>
            <li>A autorização é decidida no servidor, por perfil e por UASG; a comunicação é cifrada (HTTPS).</li>
            <li>Inteligência artificial, quando habilitada, roda em infraestrutura do órgão e nunca toma decisões sobre pessoas.</li>
          </ul>
        </section>

        <section aria-labelledby="priv-cookies">
          <h2 id="priv-cookies">Cookies e armazenamento no navegador</h2>
          <p>
            A Ágora usa <strong>um único cookie</strong>, <code>agora_sessao</code>, estritamente necessário para manter você conectado. Ele é
            protegido (HttpOnly, SameSite=Strict), não é acessível por scripts, não serve para rastreamento e deixa de valer ao sair ou após 8 horas
            sem uso (máximo de 12 horas).
            {config?.govbrHabilitado
              ? ' Durante o login com gov.br, um cookie técnico temporário protege o retorno da autenticação e é descartado logo em seguida.'
              : ''}
          </p>
          <p>
            Não há cookies de publicidade, de análise de audiência nem de terceiros. Preferências de exibição (densidade das tabelas, colunas
            visíveis, menu recolhido) ficam apenas no armazenamento da sessão do navegador e não contêm dados pessoais nem dados de negócio.
          </p>
        </section>

        <section aria-labelledby="priv-retencao">
          <h2 id="priv-retencao">Prazo de retenção</h2>
          <ul>
            <li>Sessões: encerradas ao sair ou automaticamente após 8 horas sem uso.</li>
            <li>Tentativas de login: usadas apenas para bloquear abusos por 15 minutos.</li>
            <li>
              Trilha de auditoria, registros de acesso a dados pessoais e documentos das contratações: mantidos pelos prazos da tabela de temporalidade
              do órgão (Lei 8.159/1991), por serem documentos públicos.
            </li>
            <li>Usuários desligados são desativados, preservando o histórico de autoria das operações.</li>
          </ul>
        </section>

        <section aria-labelledby="priv-direitos">
          <h2 id="priv-direitos">Seus direitos como titular</h2>
          <p>Nos termos do art. 18 da LGPD, você pode solicitar ao encarregado:</p>
          <ul>
            <li>confirmação da existência de tratamento e acesso aos seus dados;</li>
            <li>correção de dados incompletos, inexatos ou desatualizados;</li>
            <li>informações sobre compartilhamento com outras entidades públicas (órgãos de controle e PNCP);</li>
            <li>informações sobre a possibilidade de não fornecer consentimento, quando ele for a base legal;</li>
            <li>revisão de decisões tomadas unicamente com base em tratamento automatizado — a Ágora não toma esse tipo de decisão.</li>
          </ul>
          <Alerta tipo="info" compacto>
            Dados necessários ao cumprimento de obrigação legal ou à execução de políticas públicas não podem ser eliminados a pedido enquanto durar a
            obrigação de guarda (LGPD, art. 16).
          </Alerta>
        </section>
      </div>
    </Pagina>
  );
}
