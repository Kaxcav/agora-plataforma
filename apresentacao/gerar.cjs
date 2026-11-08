/* Gera apresentacao/Agora-Apresentacao.pptx a partir das capturas em docs/capturas.
 * Uso: NODE_PATH=<pasta com pptxgenjs, react, react-dom, react-icons, sharp> node apresentacao/gerar.cjs
 * Números de qualidade vêm de apresentacao/numeros.json (gerado na verificação final). */
const path = require('path');
const fs = require('fs');
const pptxgen = require('pptxgenjs');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const sharp = require('sharp');
const Lu = require('react-icons/lu');

const RAIZ = path.resolve(__dirname, '..');
const CAPTURAS = path.join(RAIZ, 'docs', 'capturas');
const SAIDA = path.join(__dirname, 'Agora-Apresentacao.pptx');
const N = JSON.parse(fs.readFileSync(path.join(__dirname, 'numeros.json'), 'utf8'));

const THEME = {
  name: 'Agora',
  headFontFace: 'Calibri',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '333333', lt1: 'FFFFFF', dk2: '071D41', lt2: 'EEF3FB',
    accent1: '1351B4', accent2: 'FFCD07', accent3: '168821', accent4: 'E52207', accent5: '0C326F', accent6: '636363',
    hlink: '1351B4', folHlink: '0C326F',
  },
};
const HEX = THEME.colors;

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13,333" × 7,5"
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = 'Ágora — Plataforma Integrada de Contratações Públicas';
pres.subject = 'Proposta de solução soberana para gestão de contratações públicas (Lei 14.133/2021)';
pres.author = 'Ágora';
const C = pres.SchemeColor;

// ───────── Layouts ─────────
pres.defineSlideMaster({
  title: 'CAPA',
  background: { color: HEX.dk2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 2.0, w: 7.0, h: 1.3, fontSize: 60, bold: true, color: C.background1, valign: 'bottom', margin: 0 }, text: '' } },
    { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 3.45, w: 6.6, h: 2.2, fontSize: 20, color: C.background2, valign: 'top', margin: 0 }, text: '' } },
  ],
});
pres.defineSlideMaster({
  title: 'CONTEUDO',
  background: { color: HEX.lt1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: 12.1, h: 0.85, fontSize: 30, bold: true, color: C.text2, valign: 'middle', margin: 0 }, text: '' } },
    { text: { text: 'Ágora · Plataforma Integrada de Contratações Públicas', options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: C.accent6, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.accent6, align: 'right' },
});
pres.defineSlideMaster({
  title: 'ESCURO',
  background: { color: HEX.dk2 },
  objects: [
    { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.35, w: 12.1, h: 0.85, fontSize: 30, bold: true, color: C.background1, valign: 'middle', margin: 0 }, text: '' } },
    { text: { text: 'Ágora · Plataforma Integrada de Contratações Públicas', options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: C.background2, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.5, h: 0.3, fontSize: 10, color: C.background2, align: 'right' },
});

// ───────── Utilitários ─────────
async function icone(nome, corHex, tamanho = 256) {
  const Comp = Lu[nome] || Lu.LuCircleDot;
  const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { size: tamanho, color: `#${corHex}`, strokeWidth: 2 }));
  const png = await sharp(Buffer.from(svg)).resize(tamanho, tamanho).png().toBuffer();
  return 'image/png;base64,' + png.toString('base64');
}

/** Ícone branco num círculo colorido (motivo visual da apresentação). */
async function circuloIcone(slide, nome, x, y, d, corFundo, nomeObjeto) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: corFundo }, line: { color: corFundo }, objectName: `${nomeObjeto}-circulo` });
  const m = d * 0.24;
  slide.addImage({ data: await icone(nome, HEX.lt1), x: x + m, y: y + m, w: d - 2 * m, h: d - 2 * m, objectName: `${nomeObjeto}-icone`, altText: '' });
}

/** Captura de tela num cartão branco com sombra discreta. */
function captura(slide, arquivo, x, y, w, h, alt) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.08,
    fill: { color: HEX.lt1 }, line: { color: 'D5DCE6', width: 0.75 },
    shadow: { type: 'outer', color: '0B1A33', opacity: 0.18, blur: 8, offset: 3, angle: 90 },
    objectName: `moldura-${arquivo}`,
  });
  slide.addImage({ path: path.join(CAPTURAS, `${arquivo}.png`), x, y, w, h, sizing: { type: 'cover', w, h }, altText: alt, objectName: `captura-${arquivo}` });
}

function texto(slide, conteudo, opcoes) {
  slide.addText(conteudo, { isTextBox: true, margin: 0, color: C.text1, fontSize: 16, valign: 'top', ...opcoes });
}

function lista(slide, itens, opcoes) {
  const runs = itens.map((t, i) => ({ text: t, options: { bullet: { indent: 18 }, breakLine: i < itens.length - 1, paraSpaceAfter: 8 } }));
  texto(slide, runs, opcoes);
}

async function main() {
  // 1 ── Capa
  pres.addSection({ title: 'Abertura' });
  {
    const s = pres.addSlide({ masterName: 'CAPA', sectionTitle: 'Abertura' });
    s.addText('Ágora', { placeholder: 'title' });
    s.addText([
      { text: 'Plataforma Integrada de Contratações Públicas', options: { bold: true, breakLine: true, fontSize: 24 } },
      { text: 'Soberana, segura e aderente à Lei 14.133/2021 — do pedido ao contrato, na infraestrutura do próprio órgão.', options: { breakLine: true } },
      { text: ' ', options: { breakLine: true, fontSize: 10 } },
      { text: 'Proposta ao Ministério da Justiça e Segurança Pública · novembro de 2026', options: { fontSize: 14 } },
    ], { placeholder: 'body' });
    captura(s, '10-inicio-painel', 7.75, 1.55, 5.0, 3.125, 'Tela inicial da Ágora com indicadores da carteira de atas e contratos');
    texto(s, 'Demonstração com dados 100% fictícios', { x: 7.75, y: 4.85, w: 5.0, h: 0.3, fontSize: 11, color: C.background2, italic: true });
    s.addNotes('Abertura. A Ágora é uma plataforma completa de contratações públicas, da demanda ao contrato, pensada para rodar dentro da infraestrutura do Ministério, sem dependência de nuvem estrangeira. Tudo o que vamos mostrar usa dados fictícios.');
  }

  // 2 ── Em uma frase
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Abertura' });
    s.addText('A contratação inteira, com a lei testada no código', { placeholder: 'title' });
    texto(s, 'Planejamento, seleção do fornecedor, gestão de atas e contratos, financeiro, sanções e transparência numa única plataforma que o órgão hospeda, audita e é dono.', { x: 0.6, y: 1.35, w: 12.1, h: 0.8, fontSize: 18 });
    const stats = [
      ['7', 'etapas da Lei 14.133 integradas', 'do DFD ao contrato assinado', 'LuRoute'],
      [String(N.testesTotal), 'testes automatizados', `${N.testesDominio} de regras · ${N.testesApi} de API · ${N.testesE2e} no navegador`, 'LuListChecks'],
      ['0', 'serviços estrangeiros em uso', 'o navegador só fala com a própria Ágora', 'LuShieldCheck'],
    ];
    for (let i = 0; i < stats.length; i++) {
      const [num, rotulo, detalhe, ic] = stats[i];
      const x = 0.6 + i * 4.1;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 2.55, w: 3.8, h: 3.9, rectRadius: 0.12, fill: { color: HEX.lt2 }, line: { color: HEX.lt2 }, objectName: `stat-${i}-fundo` });
      await circuloIcone(s, ic, x + 0.35, 2.85, 0.75, HEX.accent1, `stat-${i}`);
      texto(s, num, { x: x + 0.35, y: 3.75, w: 3.1, h: 1.1, fontSize: 66, bold: true, color: C.text2, valign: 'middle' });
      texto(s, rotulo, { x: x + 0.35, y: 4.85, w: 3.1, h: 0.8, fontSize: 18, bold: true, color: C.text2 });
      texto(s, detalhe, { x: x + 0.35, y: 5.7, w: 3.1, h: 0.65, fontSize: 14, color: C.accent6 });
    }
    s.addNotes('Mensagem central: não é só uma tela nova. É a regra da Lei 14.133 implementada em um pacote de domínio testado, uma arquitetura que roda no órgão e uma jornada completa de contratação.');
  }

  // 3 ── Problemas do sistema atual
  pres.addSection({ title: 'Diagnóstico' });
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Diagnóstico' });
    s.addText('O portal atual tem riscos estruturais, não só de interface', { placeholder: 'title' });
    const cards = [
      ['LuDatabase', 'Banco exposto ao navegador', '138 tabelas e 123 funções acessadas direto do navegador; a segurança depende apenas de políticas do banco.'],
      ['LuFileWarning', 'Dado “oficial” montado no cliente', 'Empenhos são montados no navegador e gravados como fonte SIAFI/Contratos.gov.br.'],
      ['LuCloud', 'Hospedagem estrangeira, sem saída', 'Front-end no Vercel e banco em Supabase hospedado; não há pacote para a nuvem do órgão.'],
      ['LuShieldOff', 'Cabeçalhos de segurança ausentes', 'Sem CSP, sem proteção contra clickjacking e com CORS aberto (*).'],
      ['LuUserX', 'Dados pessoais sem minimização', 'CPF, e-mail e telefone sem máscara; fontes do Google carregadas a cada acesso.'],
      ['LuScanSearch', 'Escopo restrito à execução', 'Sem planejamento, seleção do fornecedor, sanções ou score de fornecedores.'],
    ];
    for (let i = 0; i < cards.length; i++) {
      const [ic, titulo, desc] = cards[i];
      const col = i % 3, lin = Math.floor(i / 3);
      const x = 0.6 + col * 4.1, y = 1.45 + lin * 2.55;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w: 3.85, h: 2.3, rectRadius: 0.1, fill: { color: HEX.lt1 }, line: { color: 'D5DCE6', width: 1 }, objectName: `problema-${i}-cartao` });
      await circuloIcone(s, ic, x + 0.3, y + 0.3, 0.6, HEX.accent4, `problema-${i}`);
      texto(s, titulo, { x: x + 1.05, y: y + 0.3, w: 2.6, h: 0.65, fontSize: 16, bold: true, color: C.text2, valign: 'middle' });
      texto(s, desc, { x: x + 0.3, y: y + 1.05, w: 3.3, h: 1.1, fontSize: 14 });
    }
    texto(s, 'Fonte: análise dos 175 módulos JavaScript públicos e dos cabeçalhos HTTP do portal, sem testes intrusivos (docs/ANALISE-ARQUITETURA.md).', { x: 0.6, y: 6.55, w: 12.1, h: 0.3, fontSize: 11, color: C.accent6, italic: true });
    s.addNotes('Todos os pontos foram verificados no código público do portal ou nos cabeçalhos HTTP, sem nenhum teste invasivo. Importante: hospedar no Vercel não é ilegal por si só; o ponto é de conformidade — transferência internacional de dados pessoais (LGPD, arts. 33 a 36), requisitos de nuvem da administração federal (IN GSI/PR nº 5/2021) e dependência de fornecedor. A decisão final cabe à segurança da informação e à CONJUR.');
  }

  // 4 ── Comparativo
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Diagnóstico' });
    s.addText('Portal atual × Ágora', { placeholder: 'title' });
    const cab = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: HEX.dk2 }, fontSize: 14 } });
    const lin = (a, b, c) => [{ text: a, options: { bold: true, color: C.text2 } }, { text: b }, { text: c, options: { color: C.accent3, bold: true } }];
    const linhas = [
      [cab('Dimensão'), cab('Portal atual'), cab('Ágora')],
      lin('Hospedagem', 'Vercel + Supabase hospedado', 'Nuvem ou datacenter do órgão (Docker / Kubernetes)'),
      lin('Acesso a dados', 'Navegador → banco (PostgREST)', 'Navegador → API própria; banco nunca exposto'),
      lin('Autorização', 'Perfil decidido no navegador', 'Perfil e UASG decididos no servidor, em toda rota'),
      lin('Dados oficiais', 'Montados e gravados pelo navegador', 'Integrações no servidor, com procedência e hash'),
      lin('Auditoria', 'Histórico simples', 'Trilha encadeada por SHA-256, verificável'),
      lin('LGPD', 'Dados pessoais sem máscara', 'Máscara padrão; revelação com finalidade registrada'),
      lin('Segurança HTTP', 'Sem CSP; CORS aberto', 'CSP estrita, anti-clickjacking, CORS fechado'),
      lin('Lei 14.133', 'Execução contratual', '7 etapas, da demanda ao contrato, com regras testadas'),
      lin('Código', 'Dependente da plataforma', 'Cedido ao órgão (art. 93), sem licença por usuário'),
    ];
    s.addTable(linhas, { x: 0.6, y: 1.4, w: 12.1, colW: [2.3, 4.3, 5.5], fontSize: 13, color: C.text1, border: { type: 'solid', pt: 0.75, color: 'D5DCE6' }, rowH: 0.48, valign: 'middle', margin: [0.04, 0.12, 0.04, 0.12] });
    s.addNotes('Cada linha deste quadro corresponde a um controle implementado e testado na Ágora. Destaque a coluna de autorização e de dados oficiais: são os dois riscos mais sérios do modelo atual.');
  }

  // 5 ── Arquitetura
  pres.addSection({ title: 'Solução' });
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Solução' });
    s.addText('Arquitetura soberana: o órgão hospeda, o órgão controla', { placeholder: 'title' });
    const caixa = async (x, y, w, h, ic, titulo, linhas, cor, nome) => {
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: cor === 'escuro' ? HEX.dk2 : HEX.lt2 }, line: { color: cor === 'escuro' ? HEX.dk2 : 'C9D6EA', width: 1 }, objectName: `${nome}-caixa` });
      await circuloIcone(s, ic, x + 0.25, y + 0.25, 0.6, cor === 'escuro' ? HEX.accent1 : HEX.accent5, nome);
      texto(s, titulo, { x: x + 1.0, y: y + 0.25, w: w - 1.2, h: 0.6, fontSize: 17, bold: true, color: cor === 'escuro' ? C.background1 : C.text2, valign: 'middle' });
      texto(s, linhas.join('\n'), { x: x + 0.25, y: y + 1.0, w: w - 0.5, h: h - 1.15, fontSize: 13, color: cor === 'escuro' ? C.background2 : C.text1, paraSpaceAfter: 4 });
    };
    await caixa(0.6, 1.55, 3.2, 2.6, 'LuMonitor', 'Navegador', ['Interface gov.br DS', 'Fontes e ícones locais', 'Só fala com a Ágora (CSP)'], 'claro', 'arq-navegador');
    await caixa(4.55, 1.35, 4.3, 3.0, 'LuServer', 'Ágora (servidor do órgão)', ['API com RBAC por perfil e UASG', 'Regras da Lei 14.133 testadas', 'Trilha de auditoria encadeada', 'LGPD: máscara e registro de acesso'], 'escuro', 'arq-servidor');
    await caixa(9.6, 1.55, 3.1, 2.6, 'LuDatabase', 'PostgreSQL 16', ['Do órgão, com TLS', 'Migrações versionadas', 'Auditoria só de inclusão'], 'claro', 'arq-banco');
    await caixa(2.6, 4.75, 4.2, 1.85, 'LuRefreshCw', 'Integrações no servidor', ['PNCP · Compras.gov.br · Contratos.gov.br', 'SEI e Login Único gov.br (pontos prontos)'], 'claro', 'arq-integracoes');
    await caixa(7.3, 4.75, 3.6, 1.85, 'LuBrain', 'IA opcional', ['Só auto-hospedada no órgão', 'Rascunhos com revisão humana'], 'claro', 'arq-ia');
    // Extensões de forma nunca podem ser negativas (o PowerPoint recusa o arquivo): linhas para a esquerda usam flipH.
    const seta = (x1, y1, x2, y2, nome) => s.addShape(pres.shapes.LINE, {
      x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1),
      flipH: x2 < x1, flipV: y2 < y1,
      line: { color: HEX.accent6, width: 2, endArrowType: 'triangle' }, objectName: nome,
    });
    seta(3.85, 2.85, 4.5, 2.85, 'seta-nav-srv');
    seta(8.9, 2.85, 9.55, 2.85, 'seta-srv-banco');
    seta(5.9, 4.4, 5.2, 4.7, 'seta-srv-integ');
    seta(7.6, 4.4, 8.4, 4.7, 'seta-srv-ia');
    s.addNotes('Um único processo Node.js serve a interface e a API; o banco é PostgreSQL. O navegador não chama nenhum serviço externo — a política CSP impede. Integrações com PNCP e Compras.gov.br rodam no servidor, com registro de procedência. IA é opcional e só com modelo hospedado pelo próprio órgão.');
  }

  // 6 ── Gestão do dia a dia
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Solução' });
    s.addText('Gestão do dia a dia: o que exige atenção, primeiro', { placeholder: 'title' });
    captura(s, '10-inicio-painel', 0.6, 1.45, 7.6, 4.75, 'Tela inicial com indicadores, vencimentos e fila de pendências');
    lista(s, [
      'Vencimentos em 30, 60 e 90 dias, com semáforo',
      'Contratos sem divulgação no PNCP no prazo do art. 94',
      'Projeção de queima de saldo de cada contrato',
      'Fila de pendências com observação obrigatória e “Desfazer”',
      'Procedência e horário de cada conjunto de dados',
      'Nunca exibe zero provisório: carregamento com esqueleto',
    ], { x: 8.6, y: 1.55, w: 4.1, h: 4.8, fontSize: 15 });
    s.addNotes('Painel do gestor. Destaque a divulgação no PNCP (condição de eficácia do contrato, art. 94) e a fila de pendências: resolver pede observação e pode ser desfeito, e tudo vai para a trilha de auditoria.');
  }

  // 7 ── Contrato 360
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Solução' });
    s.addText('Contrato 360: a lei aplicada em cada tela', { placeholder: 'title' });
    captura(s, '12-contrato-detalhe', 5.1, 1.45, 7.6, 4.75, 'Detalhe de um contrato com valores, divulgação no PNCP e linha do tempo');
    const itens = [
      ['LuScale', 'Aditivos (art. 125)', 'Simulador recusa acréscimos acima de 25% e mostra a margem restante.'],
      ['LuMegaphone', 'Divulgação no PNCP (art. 94)', 'Prazo de 20 ou 10 dias úteis calculado com feriados.'],
      ['LuTrendingUp', 'Queima de saldo', 'Projeta a data de esgotamento e alerta antes do fim da vigência.'],
    ];
    for (let i = 0; i < itens.length; i++) {
      const [ic, t, d] = itens[i];
      const y = 1.55 + i * 1.6;
      await circuloIcone(s, ic, 0.6, y, 0.6, HEX.accent1, `c360-${i}`);
      texto(s, t, { x: 1.35, y, w: 3.4, h: 0.45, fontSize: 16, bold: true, color: C.text2 });
      texto(s, d, { x: 1.35, y: y + 0.45, w: 3.4, h: 0.9, fontSize: 14 });
    }
    s.addNotes('No detalhe do contrato, cada regra mostra o fundamento legal. Demonstre o simulador de aditivos na aba Aditivos: um acréscimo de 30% é recusado pelo art. 125, com a regularidade do fornecedor (art. 91, § 4º).');
  }

  // 8 ── Jornada
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Solução' });
    s.addText('Jornada da contratação: as 7 etapas conectadas', { placeholder: 'title' });
    const etapas = ['Demanda e PCA', 'SEI e equipe', 'ETP, riscos e preços', 'TR, edital e minuta', 'Jurídico e publicação', 'Seleção do fornecedor', 'Contrato e gestão'];
    for (let i = 0; i < etapas.length; i++) {
      const x = 0.6 + i * 1.75;
      s.addShape(pres.shapes.OVAL, { x: x + 0.45, y: 1.4, w: 0.65, h: 0.65, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, objectName: `etapa-${i + 1}-circulo` });
      texto(s, String(i + 1), { x: x + 0.45, y: 1.4, w: 0.65, h: 0.65, fontSize: 20, bold: true, color: C.background1, align: 'center', valign: 'middle' });
      texto(s, etapas[i], { x, y: 2.1, w: 1.55, h: 0.6, fontSize: 13, bold: true, color: C.text2, align: 'center' });
      if (i < etapas.length - 1) s.addShape(pres.shapes.LINE, { x: x + 1.15, y: 1.725, w: 1.05, h: 0, line: { color: 'B8C6DB', width: 1.5 }, objectName: `etapa-${i + 1}-ligacao` });
    }
    captura(s, '26-jornada-etapa-6', 0.6, 3.0, 5.6, 3.5, 'Etapa de seleção do fornecedor com desempate passo a passo');
    lista(s, [
      'Bloqueios legais impedem o avanço indevido: segregação de funções, ETP incompleto, faturamento mínimo no edital',
      'Sinais para análise, nunca acusações: artigo de luxo, fracionamento, sócios em comum',
      'TR, edital e minuta com as 19 cláusulas do art. 92 gerados como rascunho, com revisão humana obrigatória',
      'Contratar verifica sanções e regularidade e cria o contrato na carteira',
    ], { x: 6.6, y: 3.05, w: 6.1, h: 3.5, fontSize: 14 });
    s.addNotes('Oito processos fictícios estão distribuídos pelas etapas para a demonstração ao vivo (ver roteiro). A imagem mostra o desempate do art. 60 passo a passo. Ao final, o contrato nasce na carteira com as tarefas do plano de gestão.');
  }

  // 9 ── Regras testadas
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Solução' });
    s.addText('Regras da Lei 14.133 implementadas e testadas', { placeholder: 'title' });
    const cab = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: HEX.dk2 } } });
    const l = (a, b, c) => [{ text: a, options: { bold: true, color: C.text2 } }, { text: b }, { text: c }];
    s.addTable([
      [cab('Regra'), cab('Fundamento'), cab('O que a Ágora faz')],
      l('Contagem de prazos', 'art. 183', 'Dias úteis com feriados nacionais e do órgão'),
      l('Dispensa e fracionamento', 'art. 75, § 1º', 'Limite vigente por decreto; sinal a partir de 80%'),
      l('Elementos do ETP', 'art. 18, §§ 1º e 2º', 'Exige I, IV, VI, VIII e XIII; justificativa nos demais'),
      l('Cesta de preços', 'art. 23; IN 65/2021', 'Estatística, expurgo sugerido com justificativa'),
      l('Segregação de funções', 'art. 7º, § 1º', 'Bloqueia papéis conflitantes na equipe'),
      l('Habilitação', 'art. 69', 'Veda faturamento mínimo; PL mínimo até 10%'),
      l('Desempate', 'art. 60; LC 123', 'Cascata legal aplicada passo a passo'),
      l('Aditivos', 'art. 125', 'Limites de 25% e 50%, sem compensação'),
      l('Multas', 'art. 156, § 3º', 'Dosimetria de 0,5% a 30% com memória de cálculo'),
    ], { x: 0.6, y: 1.4, w: 8.4, colW: [2.5, 2.0, 3.9], fontSize: 13, color: C.text1, border: { type: 'solid', pt: 0.75, color: 'D5DCE6' }, rowH: 0.47, valign: 'middle', margin: [0.04, 0.1, 0.04, 0.1] });
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 9.4, y: 1.4, w: 3.3, h: 4.7, rectRadius: 0.12, fill: { color: HEX.lt2 }, line: { color: HEX.lt2 }, objectName: 'regras-stat-fundo' });
    texto(s, String(N.testesDominio), { x: 9.7, y: 1.8, w: 2.8, h: 1.2, fontSize: 66, bold: true, color: C.text2 });
    texto(s, 'testes automatizados só nas regras de domínio', { x: 9.7, y: 3.05, w: 2.8, h: 0.9, fontSize: 16, bold: true, color: C.text2 });
    texto(s, 'Fonte única de verdade: interface e servidor usam o mesmo pacote de regras. O Caderno de Regras (RF/RN/RIA) é gerado da própria plataforma.', { x: 9.7, y: 4.0, w: 2.8, h: 1.9, fontSize: 13, color: C.accent6 });
    s.addNotes('Essas regras ficam em um pacote isolado, sem dependências, e cada uma traz o fundamento legal no resultado. Os valores de dispensa seguem a tabela de decretos de atualização (até o Decreto 12.343/2024); a atualização de 2026 deve ser incluída na implantação.');
  }

  // 10 ── IA responsável
  {
    const s = pres.addSlide({ masterName: 'ESCURO', sectionTitle: 'Solução' });
    s.addText('IA com responsabilidade: apoio, nunca decisão', { placeholder: 'title' });
    const itens = [
      ['LuFilePen', 'Só rascunhos', 'DFD, ETP, TR, edital e minuta saem como rascunho, com premissas e fontes, e exigem aprovação humana.'],
      ['LuLock', 'Seções protegidas', 'Habilitação, sanções, conclusão do parecer e posicionamento do ETP nunca são escritos pela IA.'],
      ['LuServerCog', 'Auto-hospedada ou nenhuma', 'Padrão sem IA: modelos de texto determinísticos. Se habilitada, só endpoint do próprio órgão.'],
      ['LuScale', 'Sinais, não acusações', 'Fracionamento, artigo de luxo e vínculos societários são alertas para análise humana.'],
    ];
    for (let i = 0; i < itens.length; i++) {
      const [ic, t, d] = itens[i];
      const col = i % 2, lin = Math.floor(i / 2);
      const x = 0.6 + col * 6.15, y = 1.6 + lin * 2.55;
      await circuloIcone(s, ic, x, y, 0.8, HEX.accent1, `ia-${i}`);
      texto(s, t, { x: x + 1.05, y: y + 0.05, w: 4.8, h: 0.5, fontSize: 20, bold: true, color: C.background1 });
      texto(s, d, { x: x + 1.05, y: y + 0.6, w: 4.8, h: 1.4, fontSize: 15, color: C.background2 });
    }
    s.addNotes('Resposta direta à pergunta mais comum: a IA não decide sanção, habilitação, fraude ou multa. Ela redige rascunhos com fontes, e o servidor rejeita qualquer resposta que altere as seções protegidas. Sem IA configurada, a plataforma funciona integralmente com modelos de texto.');
  }

  // 11 ── Segurança e LGPD
  pres.addSection({ title: 'Garantias' });
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Garantias' });
    s.addText('Segurança e LGPD verificáveis, não declaradas', { placeholder: 'title' });
    captura(s, '30-auditoria', 6.4, 1.45, 6.3, 3.94, 'Trilha de auditoria com verificação de integridade');
    const itens = [
      ['LuFingerprint', 'Trilha encadeada por SHA-256; adulteração é detectada'],
      ['LuEyeOff', 'CPF, e-mail e telefone mascarados por padrão'],
      ['LuClipboardCheck', 'Revelar dado pessoal exige finalidade e fica registrado'],
      ['LuKeyRound', 'Sessão HttpOnly, CSRF, limite de tentativas, scrypt'],
      ['LuUsers', 'Perfil e UASG aplicados no servidor, em toda rota'],
      ['LuGlobeLock', 'CSP estrita: nenhuma chamada a terceiros'],
    ];
    for (let i = 0; i < itens.length; i++) {
      const [ic, t] = itens[i];
      const y = 1.5 + i * 0.85;
      await circuloIcone(s, ic, 0.6, y, 0.55, HEX.accent5, `seg-${i}`);
      texto(s, t, { x: 1.35, y, w: 4.8, h: 0.55, fontSize: 15, valign: 'middle' });
    }
    texto(s, 'Cada controle tem teste automatizado: autenticação, CSRF, perfis, escopo por UASG, cadeia de auditoria e registro de acesso.', { x: 6.4, y: 5.6, w: 6.3, h: 0.8, fontSize: 13, color: C.accent6, italic: true });
    s.addNotes('Mostre ao vivo o botão “Verificar integridade da cadeia” como auditor e a revelação de um CPF com finalidade registrada. Esses comportamentos estão cobertos por testes automatizados.');
  }

  // 12 ── Acessibilidade
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Garantias' });
    s.addText('Padrão Digital de Governo e acessibilidade', { placeholder: 'title' });
    captura(s, '40-celular-inicio', 0.8, 1.45, 2.3, 4.98, 'Tela inicial no celular');
    captura(s, '41-celular-contratos', 3.5, 1.45, 2.3, 4.98, 'Lista de contratos no celular em formato de cartões');
    lista(s, [
      'gov.br DS 3.7: Rawline servida pela própria aplicação, tokens oficiais de cor',
      `${N.telasAxe} telas verificadas automaticamente com axe (WCAG 2.1 AA), sem violações graves`,
      'Navegação completa por teclado, foco visível e link de salto',
      'Tabelas viram cartões no celular; zoom de 200% sem perda',
      'Situação nunca comunicada só por cor: ícone e texto',
      'Modo especificação técnica mostra as regras de cada tela',
    ], { x: 6.4, y: 1.55, w: 6.3, h: 4.8, fontSize: 15 });
    s.addNotes('A verificação automática não substitui a avaliação com pessoas com deficiência; ela está prevista no plano de implantação. A interface segue o Padrão Digital de Governo sem usar marcas oficiais, porque é um produto ofertado ao órgão.');
  }

  // 13 ── Implantação
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Garantias' });
    s.addText('Implantação na infraestrutura do órgão', { placeholder: 'title' });
    const colunas = [
      ['LuRocket', 'Demonstração', ['Um comando: npm start', 'PostgreSQL embutido e dados fictícios', 'Pronto em cerca de 1 minuto']],
      ['LuContainer', 'Docker Compose', ['Imagem única + PostgreSQL 16', 'Contêiner não-root, somente leitura', 'Encerramento gracioso e healthcheck']],
      ['LuNetwork', 'Kubernetes', ['2 réplicas, probes e PDB', 'NetworkPolicy de saída restrita', 'Segredos no cofre do órgão']],
    ];
    for (let i = 0; i < colunas.length; i++) {
      const [ic, t, linhas] = colunas[i];
      const x = 0.6 + i * 4.1;
      s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 1.5, w: 3.85, h: 3.6, rectRadius: 0.12, fill: { color: HEX.lt2 }, line: { color: HEX.lt2 }, objectName: `impl-${i}-fundo` });
      await circuloIcone(s, ic, x + 0.3, 1.8, 0.7, HEX.accent1, `impl-${i}`);
      texto(s, t, { x: x + 1.15, y: 1.85, w: 2.5, h: 0.6, fontSize: 19, bold: true, color: C.text2, valign: 'middle' });
      lista(s, linhas, { x: x + 0.3, y: 2.75, w: 3.3, h: 2.2, fontSize: 14 });
    }
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 5.4, w: 12.1, h: 1.1, rectRadius: 0.12, fill: { color: HEX.dk2 }, line: { color: HEX.dk2 }, objectName: 'impl-cessao-fundo' });
    texto(s, [
      { text: 'Código cedido ao órgão (Lei 14.133, art. 93). ', options: { bold: true, color: C.background1 } },
      { text: 'Pilha aberta (Node.js, PostgreSQL, React), sem licença por usuário e sem dependência de nuvem estrangeira.', options: { color: C.background2 } },
    ], { x: 0.9, y: 5.55, w: 11.5, h: 0.8, fontSize: 16, valign: 'middle' });
    s.addNotes('O mesmo pacote roda em qualquer ambiente do órgão. Verificamos a imagem com PostgreSQL 16: inicialização, dados, encerramento gracioso e reinício com a cadeia de auditoria íntegra.');
  }

  // 14 ── Qualidade em números
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Garantias' });
    s.addText('Qualidade medida', { placeholder: 'title' });
    const stats = [
      [String(N.testesDominio), 'testes de regras'],
      [String(N.testesApi), 'testes de API e segurança'],
      [String(N.testesE2e), 'testes ponta a ponta no navegador'],
      ['0', 'violações graves de acessibilidade'],
    ];
    for (let i = 0; i < stats.length; i++) {
      const [n, r] = stats[i];
      const x = 0.6 + i * 3.05;
      texto(s, n, { x, y: 1.45, w: 2.8, h: 1.0, fontSize: 54, bold: true, color: C.text2 });
      texto(s, r, { x, y: 2.45, w: 2.8, h: 0.6, fontSize: 15, color: C.accent6 });
    }
    s.addChart(pres.charts.BAR, [{ name: 'JavaScript inicial (KB)', labels: ['Portal atual (2 primeiros arquivos)', 'Ágora (todos os arquivos iniciais)'], values: [N.jsPortalPrimeiraTelaKb, N.jsAgoraPrimeiraTelaKb] }], {
      x: 0.6, y: 3.35, w: 7.4, h: 3.2, barDir: 'bar',
      showTitle: true, title: 'JavaScript baixado para abrir o sistema (KB, sem compressão)', titleFontSize: 14, titleColor: HEX.dk2, titleFontFace: '+mn-lt',
      showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: HEX.dk1, dataLabelFontSize: 13, dataLabelFontFace: '+mn-lt',
      chartColors: [HEX.accent1], showLegend: false,
      catAxisLabelColor: HEX.dk1, catAxisLabelFontSize: 13, catAxisLabelFontFace: '+mn-lt',
      valAxisHidden: true, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
    });
    texto(s, `O portal atual soma ${N.jsPortalTotalMb} MB de JavaScript em 175 arquivos. A Ágora carrega cada tela sob demanda.`, { x: 8.4, y: 3.6, w: 4.3, h: 1.4, fontSize: 15 });
    texto(s, 'Travas da Fábrica Kaxcav a cada entrega: zero-slop, ciclos de dependência, camadas e varredura de segredos.', { x: 8.4, y: 5.1, w: 4.3, h: 1.3, fontSize: 13, color: C.accent6, italic: true });
    s.addNotes('Números da verificação final desta versão. O gráfico compara o JavaScript baixado para abrir a primeira tela: no portal atual, só os dois primeiros arquivos já somam mais que a primeira tela inteira da Ágora.');
  }

  // 15 ── Próximos passos
  pres.addSection({ title: 'Encerramento' });
  {
    const s = pres.addSlide({ masterName: 'CONTEUDO', sectionTitle: 'Encerramento' });
    s.addText('Próximos passos propostos', { placeholder: 'title' });
    const passos = [
      ['Semanas 1–2', 'Piloto em homologação', 'Implantação na nuvem do órgão com dados fictícios; validação com gestores e fiscais.'],
      ['Semanas 3–4', 'Identidade e dados reais', 'Login Único gov.br; sincronização online com o PNCP e Compras.gov.br.'],
      ['Mês 2', 'SEI e ICP-Brasil', 'Integração com a API do SEI do órgão e assinatura com certificado.'],
      ['Mês 2–3', 'Homologação', 'Teste de intrusão autorizado, avaliação de acessibilidade com usuários e validação dos modelos pela CONJUR.'],
    ];
    for (let i = 0; i < passos.length; i++) {
      const [quando, t, d] = passos[i];
      const x = 0.6 + i * 3.05;
      s.addShape(pres.shapes.OVAL, { x: x + 0.05, y: 1.55, w: 0.5, h: 0.5, fill: { color: HEX.accent1 }, line: { color: HEX.accent1 }, objectName: `passo-${i}-marco` });
      if (i < passos.length - 1) s.addShape(pres.shapes.LINE, { x: x + 0.6, y: 1.8, w: 2.45, h: 0, line: { color: 'B8C6DB', width: 1.5 }, objectName: `passo-${i}-ligacao` });
      texto(s, quando, { x, y: 2.25, w: 2.8, h: 0.4, fontSize: 14, bold: true, color: C.accent1 });
      texto(s, t, { x, y: 2.7, w: 2.8, h: 0.5, fontSize: 18, bold: true, color: C.text2 });
      texto(s, d, { x, y: 3.25, w: 2.8, h: 1.6, fontSize: 14 });
    }
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y: 5.15, w: 12.1, h: 1.3, rectRadius: 0.12, fill: { color: HEX.lt2 }, line: { color: HEX.lt2 }, objectName: 'passos-pendencias-fundo' });
    texto(s, [
      { text: 'A validar na implantação: ', options: { bold: true, color: C.text2 } },
      { text: 'decreto de atualização dos limites de dispensa de 2026; parâmetros de dosimetria em ato normativo do órgão; prazos de retenção da LGPD; modelos de documentos pela CONJUR.' },
    ], { x: 0.9, y: 5.3, w: 11.5, h: 1.0, fontSize: 14, valign: 'middle' });
    s.addNotes('Proposta de piloto curto, com dados fictícios primeiro. Os itens “a validar” são decisões do órgão, não lacunas técnicas: a plataforma já tem os pontos de configuração para cada um.');
  }

  // 16 ── Encerramento
  {
    const s = pres.addSlide({ masterName: 'CAPA', sectionTitle: 'Encerramento' });
    s.addText('Obrigado', { placeholder: 'title' });
    s.addText([
      { text: 'Vamos à demonstração ao vivo.', options: { bold: true, breakLine: true, fontSize: 24 } },
      { text: 'Roteiro: docs/ROTEIRO-DEMONSTRACAO.md · Arquitetura, segurança e LGPD: pasta docs/', options: { fontSize: 16 } },
    ], { placeholder: 'body' });
    captura(s, '20-jornada-lista', 7.75, 1.55, 5.0, 3.125, 'Lista de processos da jornada de contratação');
    s.addNotes('Encerramento e transição para a demonstração ao vivo seguindo o roteiro.');
  }

  await pres.writeFile({ fileName: SAIDA });
  const { applyTheme } = require(process.env.APPLY_THEME);
  await applyTheme(SAIDA, THEME);
  console.log('gerado:', SAIDA);
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
