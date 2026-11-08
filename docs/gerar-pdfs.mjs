// Gera a documentação da Ágora em PDF: capa, sumário com páginas, cabeçalho e rodapé paginados,
// marcadores (sumário lateral do leitor de PDF) e PDF etiquetado (leitores de tela).
//
// Uso, na pasta plataforma:   node docs/gerar-pdfs.mjs
// Saída:                       docs/pdf/*.pdf (um por documento + 00-documentacao-completa.pdf)
// Requisitos: Chromium do Playwright (npx playwright install chromium).
// Opcional: Python com pypdf, para numerar as páginas do sumário (sem ele o sumário sai só com links).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pastaSaida = join(raiz, 'docs', 'pdf');
const versao = JSON.parse(readFileSync(join(raiz, 'apps', 'api', 'package.json'), 'utf8')).version;
const dataHoje = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date());

/** Ordem de leitura: apresentação → diagnóstico → documentos técnicos → especificações. */
const DOCUMENTOS = [
  { md: 'README.md', pdf: '01-visao-geral.pdf', categoria: 'Apresentação', titulo: 'Visão geral da Ágora', subtitulo: 'O que é a plataforma, como executar a demonstração e como implantar no órgão' },
  { md: 'docs/MANUAL-DO-USUARIO.md', pdf: '02-manual-do-usuario.pdf', categoria: 'Manual', titulo: 'Manual do usuário', subtitulo: 'Como usar a Ágora no dia a dia: entrar, acompanhar a carteira, conduzir a jornada da contratação e administrar a plataforma' },
  { md: 'docs/ROTEIRO-DEMONSTRACAO.md', pdf: '03-roteiro-de-demonstracao.pdf', categoria: 'Apresentação', titulo: 'Roteiro de demonstração', subtitulo: 'Passo a passo de 25 minutos, com a conta e as telas de cada etapa' },
  { md: 'docs/ANALISE-ARQUITETURA.md', pdf: '04-analise-de-arquitetura.pdf', categoria: 'Diagnóstico', titulo: 'Análise de arquitetura do portal ComprasSUSP', subtitulo: 'Como o sistema atual é montado, os problemas encontrados e como a Ágora resolve cada um' },
  { md: 'docs/REQUISITOS-REDESIGN.md', pdf: '05-requisitos.pdf', categoria: 'Diagnóstico', titulo: 'Requisitos do novo portal', subtitulo: 'Operações a preservar, melhorias prioritárias, critérios de aceite e visão de futuro' },
  { md: 'docs/ARQUITETURA.md', pdf: '06-arquitetura-tecnica.pdf', categoria: 'Documento técnico', titulo: 'Arquitetura técnica', subtitulo: 'Pilha, configuração, banco de dados, integrações, IA opcional e operação' },
  { md: 'docs/SEGURANCA.md', pdf: '07-seguranca-da-informacao.pdf', categoria: 'Documento técnico', titulo: 'Segurança da informação', subtitulo: 'Princípios, controles, cabeçalhos HTTP e responsabilidades do órgão na implantação' },
  { md: 'docs/LGPD.md', pdf: '08-protecao-de-dados-lgpd.pdf', categoria: 'Documento técnico', titulo: 'Proteção de dados pessoais (LGPD)', subtitulo: 'Papéis, dados tratados, medidas técnicas, direitos dos titulares e retenção' },
  { md: 'docs/JORNADA.md', pdf: '09-jornada-da-contratacao.pdf', categoria: 'Especificação', titulo: 'Jornada da contratação', subtitulo: 'As 7 etapas da Lei nº 14.133/2021: regras de avanço, documentos e árvore SEI' },
  { md: 'docs/INTERFACE.md', pdf: '10-interface-e-acessibilidade.pdf', categoria: 'Especificação', titulo: 'Interface e acessibilidade', subtitulo: 'Padrão Digital de Governo, estrutura das telas, componentes, WCAG 2.1 AA e desempenho' },
  { md: 'packages/dominio/ESPECIFICACAO.md', pdf: '11-regras-de-negocio.pdf', categoria: 'Especificação', titulo: 'Regras de negócio da Lei nº 14.133/2021', subtitulo: 'Prazos, limites de dispensa, aditivos, sanções, desempate, ETP, pesquisa de preços e demais regras codificadas' },
];

const COMPLETO = {
  pdf: '00-documentacao-completa.pdf',
  categoria: 'Dossiê técnico',
  titulo: 'Documentação da Ágora',
  subtitulo: 'Apresentação, diagnóstico do portal atual, arquitetura, segurança, LGPD e especificações da plataforma',
};

// ───────────────────────────── Markdown → HTML (subconjunto usado nos documentos) ─────────────────────────────

const escapar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const desescapar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const indentacao = (l) => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;
const RE_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const RE_CERCA = /^\s*```/;
const ehBranca = (l) => /^\s*$/.test(l);
const ehOrdenado = (l) => /^\s*\d/.test(l);

function slug(texto) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** Converte a marcação em linha. `ctx.link(url, textoHtml)` decide como cada link vira HTML. */
function emLinha(texto, ctx) {
  const codigos = [];
  let s = texto.replace(/`([^`]+)`/g, (_, c) => {
    codigos.push(c.replace(/\\\|/g, '|'));
    return `\u0000${codigos.length - 1}\u0000`;
  });
  s = escapar(s.replace(/\\\|/g, '|'));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => ctx.imagem(desescapar(url), alt));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => ctx.link(desescapar(url), t));
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?![\s*])([^*]+?)\*(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?![\s_])([^_]+?)_(?!\w)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapar(codigos[Number(i)])}</code>`);
}

const textoPlano = (md, ctx) => desescapar(emLinha(md, ctx).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

const blocoCodigo = (texto, linguagem) =>
  `<pre${linguagem ? ` data-linguagem="${escapar(linguagem)}"` : ''}><code>${escapar(texto.replace(/\s+$/, ''))}</code></pre>`;

/** Parágrafo só com imagens → figura numerada; a legenda é o texto alternativo da primeira imagem. */
function figura(texto, ctx) {
  const imagens = [...texto.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map((m) => ({ alt: m[1].trim(), url: m[2] }));
  const legenda = imagens[0].alt;
  const numero = ++ctx.figuras.total;
  const tags = imagens.map((im, k) => ctx.imagem(im.url, escapar(im.alt || (k > 0 ? `${legenda} (continuação)` : legenda)))).join('');
  const rotulo = legenda ? `<figcaption><strong>Figura ${numero}.</strong> ${emLinha(legenda, ctx)}</figcaption>` : '';
  return `<figure class="figura figura-${imagens.length}"><div class="imagens">${tags}</div>${rotulo}</figure>`;
}

const TIPOS_IMAGEM = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

function ehInicioDeBloco(l) {
  return /^#{1,6}\s/.test(l) || RE_CERCA.test(l) || /^\s*\|/.test(l) || /^(---|\*\*\*|___)\s*$/.test(l) || /^>/.test(l);
}

function lerCerca(linhas, i) {
  const recuo = indentacao(linhas[i]);
  const linguagem = linhas[i].trim().slice(3).trim();
  const codigo = [];
  i++;
  while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) {
    codigo.push(linhas[i].slice(Math.min(recuo, indentacao(linhas[i]))));
    i++;
  }
  return { html: blocoCodigo(codigo.join('\n'), linguagem), i: i + 1 };
}

function lerLista(linhas, i, ctx) {
  const base = indentacao(linhas[i]);
  const ordenada = ehOrdenado(linhas[i]);
  const inicio = ordenada ? parseInt(linhas[i].trim(), 10) : 1;
  const itens = [];
  let aposBranca = false;
  while (i < linhas.length) {
    const l = linhas[i];
    if (ehBranca(l)) {
      let j = i + 1;
      while (j < linhas.length && ehBranca(linhas[j])) j++;
      if (j >= linhas.length) {
        i = j;
        break;
      }
      const proxima = linhas[j];
      const mesmoNivel = RE_ITEM.test(proxima) && indentacao(proxima) === base && ehOrdenado(proxima) === ordenada;
      if (mesmoNivel || (indentacao(proxima) > base && itens.length > 0)) {
        i = j;
        aposBranca = true;
        continue;
      }
      break;
    }
    const m = l.match(RE_ITEM);
    const recuo = indentacao(l);
    if (m && recuo === base) {
      if (ehOrdenado(l) !== ordenada) break;
      itens.push([{ tipo: 'texto', linhas: [m[3]] }]);
      aposBranca = false;
      i++;
      continue;
    }
    if (itens.length === 0) break;
    const partes = itens.at(-1);
    if (m && recuo > base) {
      const sub = lerLista(linhas, i, ctx);
      partes.push({ tipo: 'html', html: sub.html });
      i = sub.i;
      aposBranca = false;
      continue;
    }
    if (recuo > base && RE_CERCA.test(l)) {
      const cerca = lerCerca(linhas, i);
      partes.push({ tipo: 'html', html: cerca.html });
      i = cerca.i;
      aposBranca = false;
      continue;
    }
    if (recuo <= base && (m || aposBranca || ehInicioDeBloco(l))) break;
    const ultima = partes.at(-1);
    if (ultima.tipo === 'texto' && !aposBranca) ultima.linhas.push(l.trim());
    else partes.push({ tipo: 'texto', linhas: [l.trim()] });
    aposBranca = false;
    i++;
  }
  const htmlItens = itens.map((partes) => {
    const textos = partes.filter((p) => p.tipo === 'texto').length;
    const corpo = partes
      .map((p) => (p.tipo === 'html' ? p.html : textos > 1 ? `<p>${emLinha(p.linhas.join(' '), ctx)}</p>` : emLinha(p.linhas.join(' '), ctx)))
      .join('');
    return `<li>${corpo}</li>`;
  });
  const tag = ordenada ? 'ol' : 'ul';
  const atributoInicio = ordenada && inicio !== 1 ? ` start="${inicio}"` : '';
  return { html: `<${tag}${atributoInicio}>${htmlItens.join('')}</${tag}>`, i };
}

const celulas = (l) =>
  l
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
const ehSeparadorTabela = (l) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l);

function lerTabela(linhas, i, ctx) {
  const cabecalho = celulas(linhas[i]);
  const alinhamentos = celulas(linhas[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-+:$/.test(c) ? 'right' : null));
  const estilo = (k) => (alinhamentos[k] ? ` style="text-align:${alinhamentos[k]}"` : '');
  i += 2;
  const corpo = [];
  while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
    const linha = celulas(linhas[i]);
    corpo.push(`<tr>${cabecalho.map((_, k) => `<td${estilo(k)}>${emLinha(linha[k] ?? '', ctx)}</td>`).join('')}</tr>`);
    i++;
  }
  const html = `<table><thead><tr>${cabecalho.map((c, k) => `<th scope="col"${estilo(k)}>${emLinha(c, ctx)}</th>`).join('')}</tr></thead><tbody>${corpo.join('')}</tbody></table>`;
  return { html, i };
}

/**
 * Converte um documento. O primeiro `#` vira o título da capa (não entra no corpo).
 * Retorna o HTML do corpo e os títulos de nível 2 (para o sumário).
 */
function converter(md, ctx) {
  const linhas = md.replace(/\r\n/g, '\n').split('\n');
  const partes = [];
  const titulos = [];
  let h1Visto = false;
  let i = 0;
  while (i < linhas.length) {
    const l = linhas[i];
    if (ehBranca(l)) {
      i++;
      continue;
    }
    let m;
    if (RE_CERCA.test(l)) {
      const cerca = lerCerca(linhas, i);
      partes.push(cerca.html);
      i = cerca.i;
      continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) {
      const nivel = m[1].length;
      i++;
      if (nivel === 1 && !h1Visto) {
        h1Visto = true;
        continue;
      }
      const nivelHtml = Math.max(2, nivel);
      const id = ctx.id(textoPlano(m[2], ctx));
      if (nivelHtml === 2) titulos.push({ id, texto: textoPlano(m[2], ctx), html: emLinha(m[2], ctx) });
      partes.push(`<h${nivelHtml} id="${id}">${emLinha(m[2], ctx)}</h${nivelHtml}>`);
      continue;
    }
    if (/^(---|\*\*\*|___)\s*$/.test(l)) {
      partes.push('<hr>');
      i++;
      continue;
    }
    if (/^\s*\|/.test(l) && i + 1 < linhas.length && ehSeparadorTabela(linhas[i + 1])) {
      const tabela = lerTabela(linhas, i, ctx);
      partes.push(tabela.html);
      i = tabela.i;
      continue;
    }
    if (RE_ITEM.test(l)) {
      const lista = lerLista(linhas, i, ctx);
      partes.push(lista.html);
      i = lista.i;
      continue;
    }
    if (/^>/.test(l)) {
      const citacao = [];
      while (i < linhas.length && /^>/.test(linhas[i])) citacao.push(linhas[i++].replace(/^>\s?/, ''));
      partes.push(`<blockquote>${converter(citacao.join('\n'), { ...ctx, citacao: true }).html}</blockquote>`);
      continue;
    }
    const paragrafo = [l.trim()];
    i++;
    while (i < linhas.length && !ehBranca(linhas[i]) && !ehInicioDeBloco(linhas[i]) && !RE_ITEM.test(linhas[i])) paragrafo.push(linhas[i++].trim());
    const texto = paragrafo.join(' ');
    if (/^(\s*!\[[^\]]*\]\([^)\s]+\)\s*)+$/.test(texto)) {
      partes.push(figura(texto, ctx));
      continue;
    }
    partes.push(`<p>${emLinha(texto, ctx)}</p>`);
  }
  return { html: partes.join('\n'), titulos };
}

// ───────────────────────────── Página HTML ─────────────────────────────

const fonte = (peso, estilo, arquivo) => {
  const dados = readFileSync(join(raiz, 'apps', 'web', 'public', 'fontes', 'rawline', arquivo)).toString('base64');
  return `@font-face{font-family:Rawline;font-weight:${peso};font-style:${estilo};src:url(data:font/woff2;base64,${dados}) format('woff2');}`;
};
const FONTES = [
  fonte(400, 'normal', 'rawline-400.woff2'),
  fonte(400, 'italic', 'rawline-400i.woff2'),
  fonte(500, 'normal', 'rawline-500.woff2'),
  fonte(600, 'normal', 'rawline-600.woff2'),
  fonte(700, 'normal', 'rawline-700.woff2'),
  fonte(800, 'normal', 'rawline-800.woff2'),
].join('\n');

const textoCss = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

const MONOGRAMA = `<svg class="monograma" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="7" fill="#1351B4"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5 16 6.5l10 6"/><path d="M9.5 14.5v8.5M16 14.5v8.5M22.5 14.5v8.5"/></g><path d="M6.5 25.5h19" stroke="#FFCD07" stroke-width="2.2" stroke-linecap="round"/></svg>`;
const ARTE_CAPA = `<svg class="arte" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><g fill="none" stroke="#1351B4" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12.5 16 6.5l10 6"/><path d="M9.5 14.5v8.5M16 14.5v8.5M22.5 14.5v8.5"/><path d="M6.5 25.5h19"/></g></svg>`;

function estilos({ categoria, rodape }) {
  return `
${FONTES}
@page {
  size: A4;
  margin: 22mm 18mm 20mm 18mm;
  @top-left { content: "Ágora · Contratações Públicas"; font-family: Rawline, sans-serif; font-size: 7.5pt; font-weight: 700; color: #1351B4; vertical-align: bottom; padding-bottom: 5mm; }
  @top-right { content: ${textoCss(categoria)}; font-family: Rawline, sans-serif; font-size: 7.5pt; font-weight: 500; color: #636363; vertical-align: bottom; padding-bottom: 5mm; }
  @bottom-left { content: ${textoCss(rodape)}; font-family: Rawline, sans-serif; font-size: 7.5pt; color: #636363; vertical-align: top; padding-top: 5mm; }
  @bottom-right { content: counter(page) " / " counter(pages); font-family: Rawline, sans-serif; font-size: 7.5pt; font-weight: 700; color: #071D41; vertical-align: top; padding-top: 5mm; }
}
@page capa {
  margin: 0;
  @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; }
}
html { font-family: Rawline, Raleway, "Segoe UI", sans-serif; font-size: 10pt; line-height: 1.55; color: #333; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; }

.capa { page: capa; break-after: page; position: relative; overflow: hidden; box-sizing: border-box; width: 210mm; height: 297mm; padding: 24mm 22mm 20mm; background: #071D41; color: #fff; display: flex; flex-direction: column; }
.capa .marca { display: flex; align-items: center; gap: 4mm; position: relative; z-index: 1; }
.capa .monograma { width: 14mm; height: 14mm; }
.capa .marca-nome { font-size: 20pt; font-weight: 800; line-height: 1; letter-spacing: .01em; }
.capa .marca-sub { font-size: 8.5pt; font-weight: 600; color: #C5D4EB; letter-spacing: .12em; text-transform: uppercase; margin-top: 1.5mm; }
.capa .arte { position: absolute; right: -34mm; top: 36mm; width: 170mm; height: 170mm; opacity: .55; }
.capa .meio { margin-top: auto; margin-bottom: 22mm; max-width: 158mm; position: relative; z-index: 1; }
.capa .faixa { width: 18mm; height: 1.4mm; background: #FFCD07; border-radius: 1mm; margin-bottom: 7mm; }
.capa .categoria { font-size: 9.5pt; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #FFCD07; margin: 0 0 4mm; }
.capa h1 { font-size: 31pt; line-height: 1.1; font-weight: 800; margin: 0 0 6mm; color: #fff; letter-spacing: -.005em; }
.capa .subtitulo { font-size: 12.5pt; line-height: 1.45; color: #C5D4EB; margin: 0; }
.capa .pe { position: relative; z-index: 1; display: flex; justify-content: space-between; align-items: flex-end; gap: 10mm; border-top: .3mm solid rgba(255,255,255,.2); padding-top: 5mm; font-size: 8.5pt; line-height: 1.5; color: #C5D4EB; }
.capa .pe strong { color: #fff; font-weight: 700; }
.capa .pe .direita { text-align: right; }

h2 { font-size: 15pt; line-height: 1.25; font-weight: 700; color: #071D41; margin: 9mm 0 3mm; padding-bottom: 2mm; border-bottom: .4mm solid #DBE8FB; break-after: avoid; }
h3 { font-size: 12pt; line-height: 1.3; font-weight: 700; color: #1351B4; margin: 6mm 0 2mm; break-after: avoid; }
h4, h5, h6 { font-size: 10.5pt; font-weight: 700; color: #071D41; margin: 5mm 0 1.5mm; break-after: avoid; }
main > h2:first-child, .sumario + h2, .doc-cabecalho + h2 { margin-top: 0; }
p { margin: 0 0 2.6mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0 0 1.3mm; padding-left: .5mm; }
li > ul, li > ol, li > pre { margin-top: 1.3mm; }
li > p { margin: 0 0 1.3mm; }
ul > li::marker { color: #1351B4; }
ol > li::marker { color: #1351B4; font-weight: 700; }
a { color: #1351B4; text-decoration: underline; text-decoration-color: #A8C2EB; text-underline-offset: .18em; }
strong { font-weight: 700; color: #1B1B1B; }
em { font-style: italic; }
code { font-family: Consolas, "Cascadia Mono", monospace; font-size: .88em; background: #EEF2F8; color: #0C326F; padding: .06em .32em; border-radius: .8mm; overflow-wrap: anywhere; }
pre { background: #F3F5F9; border: .3mm solid #DFE5EE; border-radius: 1.6mm; padding: 3mm 4mm; margin: 0 0 3.5mm; font-size: 8.2pt; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; break-inside: avoid; }
pre code { background: none; color: #1B1B1B; padding: 0; font-size: 1em; border-radius: 0; }
blockquote { margin: 0 0 4mm; padding: 3mm 4mm; background: #FFF5C2; border-radius: 1.6mm; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }
figure.figura { margin: 2mm 0 6mm; break-inside: avoid; }
figure.figura .imagens { display: flex; justify-content: center; align-items: flex-start; gap: 8mm; }
figure.figura img { display: block; max-width: 100%; max-height: 100mm; width: auto; height: auto; border: .3mm solid #C9D2DF; border-radius: 1.5mm; }
figure.figura-2 img { max-width: 46%; max-height: 128mm; }
figure.figura figcaption { font-size: 8.5pt; line-height: 1.45; color: #555; margin: 2.5mm auto 0; max-width: 160mm; text-align: center; }
figure.figura figcaption strong { color: #071D41; }
hr { border: 0; border-top: .3mm solid #D5DBE5; margin: 6mm 0; }
table { width: 100%; border-collapse: collapse; margin: 1mm 0 4.5mm; font-size: 8.6pt; line-height: 1.42; }
thead { display: table-header-group; }
th { background: #0C326F; color: #fff; text-align: left; font-weight: 700; padding: 1.8mm 2.4mm; vertical-align: bottom; }
th code { background: rgba(255,255,255,.16); color: #fff; }
td { padding: 1.6mm 2.4mm; border-bottom: .25mm solid #E0E4EA; vertical-align: top; }
tbody tr:nth-child(even) td { background: #F7F9FC; }
tr { break-inside: avoid; }
td code { overflow-wrap: anywhere; }
.ref-doc { font-weight: 600; color: #071D41; }

.sumario { background: #EDF5FF; border-radius: 2mm; padding: 5mm 6mm 3.5mm; margin: 0 0 9mm; break-inside: avoid; }
.sumario h2 { font-size: 10pt; letter-spacing: .14em; text-transform: uppercase; color: #1351B4; border: 0; margin: 0 0 3mm; padding: 0; }
.sumario ol { list-style: none; padding: 0; margin: 0; }
.sumario li { margin: 0 0 1.6mm; padding: 0; }
.sumario a { display: flex; align-items: baseline; gap: 2mm; color: #1B1B1B; text-decoration: none; }
.sumario .t { flex: 0 1 auto; }
.sumario .pontos { flex: 1 1 8mm; border-bottom: .3mm dotted #9AA8BD; transform: translateY(-.9mm); }
.sumario .n { flex: 0 0 auto; min-width: 7mm; text-align: right; font-weight: 700; color: #1351B4; font-variant-numeric: tabular-nums; }
.sem-paginas .pontos, .sem-paginas .n { display: none; }

.sumario-geral { margin: 0; padding: 0; background: none; }
.sumario-geral > h2 { font-size: 22pt; letter-spacing: 0; text-transform: none; color: #071D41; margin: 0 0 8mm; }
.sumario-geral li { margin: 0 0 4.5mm; }
.sumario-geral a { gap: 4mm; }
.sumario-geral .num { flex: 0 0 9mm; font-size: 15pt; font-weight: 800; color: #1351B4; line-height: 1.1; }
.sumario-geral .t { display: flex; flex-direction: column; }
.sumario-geral .cat { font-size: 7.5pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #636363; }
.sumario-geral .tit { font-size: 12pt; font-weight: 700; color: #071D41; line-height: 1.3; }
.sumario-geral .sub { font-size: 9pt; color: #555; line-height: 1.4; }
.sumario-geral .n { font-size: 11pt; }

.doc { break-before: page; }
.doc-cabecalho { margin: 0 0 8mm; padding: 0 0 5mm; border-bottom: .6mm solid #071D41; break-after: avoid; }
.doc-cabecalho .categoria { font-size: 8.5pt; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: #1351B4; margin: 0 0 2mm; }
.doc-cabecalho h1 { font-size: 22pt; line-height: 1.15; font-weight: 800; color: #071D41; margin: 0 0 2.5mm; }
.doc-cabecalho .subtitulo { font-size: 10.5pt; color: #555; margin: 0; }
`;
}

function capa({ categoria, titulo, subtitulo }) {
  return `<section class="capa">
  ${ARTE_CAPA}
  <div class="marca">${MONOGRAMA}<div><div class="marca-nome">Ágora</div><div class="marca-sub">Plataforma integrada de contratações públicas</div></div></div>
  <div class="meio">
    <div class="faixa" aria-hidden="true"></div>
    <p class="categoria">${escapar(categoria)}</p>
    <h1>${escapar(titulo)}</h1>
    <p class="subtitulo">${escapar(subtitulo)}</p>
  </div>
  <div class="pe">
    <div><strong>Versão ${escapar(versao)}</strong><br>${escapar(dataHoje)}</div>
    <div class="direita">Lei nº 14.133/2021 · LGPD (Lei nº 13.709/2018)<br>Padrão Digital de Governo (gov.br DS)</div>
  </div>
</section>`;
}

function documentoHtml({ titulo, categoria, rodape, conteudo }) {
  const tituloPdf = titulo.includes('Ágora') ? titulo : `${titulo} — Ágora`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(tituloPdf)}</title><style>${estilos({ categoria, rodape })}</style></head><body>${conteudo}</body></html>`;
}

function sumarioDoc(titulos, paginas) {
  const itens = titulos
    .map((t) => `<li><a href="#${t.id}"><span class="t">${t.html}</span><span class="pontos" aria-hidden="true"></span><span class="n">${paginas?.get(t.id) ?? ''}</span></a></li>`)
    .join('');
  return `<nav class="sumario${paginas ? '' : ' sem-paginas'}" aria-labelledby="sumario"><h2 id="sumario">Neste documento</h2><ol>${itens}</ol></nav>`;
}

function sumarioGeral(docs, paginas) {
  const itens = docs
    .map(
      (d, k) => `<li><a href="#${d.ancora}"><span class="num">${String(k + 1).padStart(2, '0')}</span><span class="t"><span class="cat">${escapar(d.categoria)}</span><span class="tit">${escapar(d.titulo)}</span><span class="sub">${escapar(d.subtitulo)}</span></span><span class="pontos" aria-hidden="true"></span><span class="n">${paginas?.get(d.ancora) ?? ''}</span></a></li>`,
    )
    .join('');
  return `<nav class="sumario sumario-geral${paginas ? '' : ' sem-paginas'}" aria-labelledby="sumario-geral"><h2 id="sumario-geral">Sumário</h2><ol>${itens}</ol></nav>`;
}

// ───────────────────────────── PDF ─────────────────────────────

const temPypdf = spawnSync('python', ['-c', 'import pypdf'], { stdio: 'ignore' }).status === 0;
const pastaTemp = mkdtempSync(join(tmpdir(), 'agora-pdf-'));

function python(codigo, ...argumentos) {
  const r = spawnSync('python', ['-c', codigo, ...argumentos], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`pypdf falhou: ${r.stderr}`);
  return r.stdout;
}

/** Páginas físicas dos marcadores, na ordem do documento (busca em profundidade). */
function paginasDosMarcadores(arquivo) {
  const codigo = [
    'import sys, json',
    'from pypdf import PdfReader',
    'r = PdfReader(sys.argv[1])',
    'saida = []',
    'def percorrer(itens):',
    '    for it in itens:',
    '        if isinstance(it, list): percorrer(it)',
    '        else: saida.append(r.get_destination_page_number(it) + 1)',
    'percorrer(r.outline)',
    'sys.stdout.write(json.dumps(saida))',
  ].join('\n');
  return JSON.parse(python(codigo, arquivo));
}

/**
 * O Chromium monta o texto dos marcadores a partir das linhas desenhadas: perde o espaço nas quebras de linha
 * e às vezes repete a primeira linha. Aqui cada marcador recebe o texto exato do título correspondente.
 * Clonar o documento preserva a estrutura etiquetada (acessibilidade).
 */
function corrigirMarcadores(arquivo, titulos) {
  const temp = join(pastaTemp, 'titulos.json');
  writeFileSync(temp, JSON.stringify(titulos), 'utf8');
  const codigo = [
    'import sys, json',
    'from pypdf import PdfWriter',
    'from pypdf.generic import NameObject, TextStringObject',
    'titulos = json.load(open(sys.argv[2], encoding="utf-8"))',
    'w = PdfWriter(clone_from=sys.argv[1])',
    'itens = []',
    'def percorrer(no):',
    '    while no is not None:',
    '        no = no.get_object()',
    '        itens.append(no)',
    '        if "/First" in no: percorrer(no["/First"])',
    '        no = no.get("/Next")',
    'raiz = w.root_object.get("/Outlines")',
    'if raiz is not None: percorrer(raiz.get_object().get("/First"))',
    'if len(itens) != len(titulos): sys.exit(f"marcadores={len(itens)} titulos={len(titulos)}")',
    'for it, t in zip(itens, titulos): it[NameObject("/Title")] = TextStringObject(t)',
    'w.write(sys.argv[1])',
  ].join('\n');
  python(codigo, arquivo, temp);
}

async function imprimir(pagina, html) {
  await pagina.setContent(html, { waitUntil: 'load' });
  await pagina.evaluate(() => document.fonts.ready);
  const pdf = await pagina.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
  const titulos = await pagina.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => ({ id: h.id, texto: h.textContent.replace(/\s+/g, ' ').trim() })),
  );
  return { pdf, titulos };
}

/**
 * Duas passagens: a primeira descobre em que página caiu cada título (o k-ésimo marcador é o k-ésimo título
 * do documento); a segunda escreve os números no sumário. Por fim, os marcadores recebem o texto exato.
 */
async function gerar(pagina, montar, comSumario, arquivo) {
  let { pdf, titulos } = await imprimir(pagina, montar(null));
  if (temPypdf) {
    if (comSumario) {
      const temp = join(pastaTemp, basename(arquivo));
      writeFileSync(temp, pdf);
      const paginasMarcadores = paginasDosMarcadores(temp);
      if (paginasMarcadores.length !== titulos.length) {
        throw new Error(`${basename(arquivo)}: ${paginasMarcadores.length} marcadores para ${titulos.length} títulos`);
      }
      const paginas = new Map(titulos.map((t, k) => [t.id, paginasMarcadores[k]]));
      ({ pdf, titulos } = await imprimir(pagina, montar(paginas)));
    }
    writeFileSync(arquivo, pdf);
    corrigirMarcadores(arquivo, titulos.map((t) => t.texto));
  } else {
    writeFileSync(arquivo, pdf);
  }
  return readFileSync(arquivo).length;
}

// ───────────────────────────── Execução ─────────────────────────────

const porArquivoMd = new Map(DOCUMENTOS.map((d) => [basename(d.md).toLowerCase(), d]));

function contexto({ prefixo, modoCompleto, dirMd }) {
  const usados = new Map();
  return {
    figuras: { total: 0 },
    imagem(url, altHtml) {
      const caminho = join(dirMd, url);
      const tipo = TIPOS_IMAGEM[extname(caminho).toLowerCase()];
      if (!tipo) throw new Error(`Imagem sem tipo conhecido: ${url}`);
      const dados = readFileSync(caminho).toString('base64');
      return `<img src="data:${tipo};base64,${dados}" alt="${altHtml}">`;
    },
    id(texto) {
      const base = `${prefixo}${slug(texto) || 'secao'}`;
      const n = (usados.get(base) ?? 0) + 1;
      usados.set(base, n);
      return n === 1 ? base : `${base}-${n}`;
    },
    link(url, textoHtml) {
      if (/^https?:\/\//.test(url)) return `<a href="${escapar(url)}">${textoHtml}</a>`;
      const alvo = porArquivoMd.get(basename(url.split('#')[0]).toLowerCase());
      if (alvo && modoCompleto) return `<a href="#${alvo.ancora}">${textoHtml}</a>`;
      if (alvo) return `<span class="ref-doc">${textoHtml}</span> (documento <em>${escapar(alvo.pdf)}</em>)`;
      return textoHtml;
    },
  };
}

DOCUMENTOS.forEach((d) => {
  d.ancora = `doc-${slug(d.titulo)}`;
});

mkdirSync(pastaSaida, { recursive: true });
for (const arquivo of readdirSync(pastaSaida)) if (arquivo.endsWith('.pdf')) rmSync(join(pastaSaida, arquivo));
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const relatorio = [];

try {
  // Documentos individuais
  for (const d of DOCUMENTOS) {
    const md = readFileSync(join(raiz, d.md), 'utf8');
    const { html, titulos } = converter(md, contexto({ prefixo: '', modoCompleto: false, dirMd: dirname(join(raiz, d.md)) }));
    const comSumario = titulos.length >= 5;
    const montar = (paginas) =>
      documentoHtml({
        titulo: d.titulo,
        categoria: d.categoria,
        rodape: `Ágora · ${d.titulo}`,
        conteudo: `${capa(d)}<main>${comSumario ? sumarioDoc(titulos, paginas) : ''}${html}</main>`,
      });
    const bytes = await gerar(pagina, montar, comSumario, join(pastaSaida, d.pdf));
    relatorio.push(`${d.pdf}  ${(bytes / 1024).toFixed(0)} KB`);
  }

  // Dossiê completo
  const corpos = DOCUMENTOS.map((d) => {
    const md = readFileSync(join(raiz, d.md), 'utf8');
    const { html } = converter(md, contexto({ prefixo: `${d.ancora}--`, modoCompleto: true, dirMd: dirname(join(raiz, d.md)) }));
    return `<article class="doc"><header class="doc-cabecalho"><p class="categoria">${escapar(d.categoria)}</p><h1 id="${d.ancora}">${escapar(d.titulo)}</h1><p class="subtitulo">${escapar(d.subtitulo)}</p></header>${html}</article>`;
  }).join('\n');
  const montarCompleto = (paginas) =>
    documentoHtml({
      titulo: COMPLETO.titulo,
      categoria: COMPLETO.categoria,
      rodape: 'Ágora · Documentação completa',
      conteudo: `${capa(COMPLETO)}<main>${sumarioGeral(DOCUMENTOS, paginas)}${corpos}</main>`,
    });
  const bytes = await gerar(pagina, montarCompleto, true, join(pastaSaida, COMPLETO.pdf));
  relatorio.unshift(`${COMPLETO.pdf}  ${(bytes / 1024).toFixed(0)} KB`);
} finally {
  await navegador.close();
  rmSync(pastaTemp, { recursive: true, force: true });
}

console.log(`PDFs em ${pastaSaida}${temPypdf ? '' : ' (sem pypdf: sumários sem número de página)'}`);
for (const linha of relatorio) console.log(`  ${linha}`);
