import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { estruturarTextoLei, type BaseNormativa } from '@agora/dominio';
import { ARQUIVO_BASE_NORMATIVA } from '../ia/base-normativa.ts';

/**
 * Gera a base normativa (RNF-08) a partir do texto compilado oficial da Lei 14.133/2021, uma linha por dispositivo:
 *
 *   node apps/api/src/cli/base-normativa.ts --texto lei.txt --url <endereço> --sha256-arquivo <hash> \
 *     --obtido-em 2026-11-08T16:34:00Z --formato docx --fonte "<órgão>" --observacao "<nota>"
 *
 * O texto vem do arquivo obtido no portal oficial (no .docx, o texto de cada parágrafo do documento). A saída fica em
 * `apps/api/dados/normas/` e é versionada no repositório como dado público (Lei 9.610/1998, art. 8º, IV).
 */
function principal(): number {
  const { values } = parseArgs({
    options: {
      texto: { type: 'string' },
      url: { type: 'string' },
      'sha256-arquivo': { type: 'string' },
      'obtido-em': { type: 'string' },
      formato: { type: 'string' },
      fonte: { type: 'string' },
      observacao: { type: 'string' },
      saida: { type: 'string' },
    },
  });
  const faltando = ['texto', 'url', 'sha256-arquivo', 'obtido-em', 'formato', 'fonte'].filter((k) => !values[k as keyof typeof values]);
  if (faltando.length > 0) {
    process.stderr.write(`Informe: ${faltando.map((k) => `--${k}`).join(', ')}\n`);
    return 1;
  }
  const texto = readFileSync(values.texto ?? '', 'utf8').replace(/^﻿/, '');
  const artigos = estruturarTextoLei(texto);
  if (artigos.length < 190) {
    process.stderr.write(`Estrutura incompleta: ${artigos.length} artigos lidos.\n`);
    return 1;
  }
  const base: BaseNormativa = {
    norma: { id: 'lei-14133-2021', titulo: 'Lei 14.133/2021', ementa: 'Lei de Licitações e Contratos Administrativos.', numero: '14.133', ano: 2021 },
    proveniencia: {
      fonte: values.fonte ?? '',
      url: values.url ?? '',
      obtidoEm: values['obtido-em'] ?? '',
      formato: values.formato ?? '',
      sha256Arquivo: values['sha256-arquivo'] ?? '',
      sha256Texto: createHash('sha256').update(texto, 'utf8').digest('hex'),
      observacao: values.observacao ?? '',
    },
    artigos,
  };
  const saida = values.saida ?? ARQUIVO_BASE_NORMATIVA;
  mkdirSync(dirname(saida), { recursive: true });
  writeFileSync(saida, `${JSON.stringify(base, null, 1)}\n`, 'utf8');
  process.stdout.write(`Base normativa gravada em ${saida}: ${artigos.length} artigos.\n`);
  return 0;
}

process.exitCode = principal();
