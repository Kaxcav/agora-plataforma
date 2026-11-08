# @agora/dominio — especificação

Pacote TypeScript **puro**: zero dependências de runtime, sem I/O, sem `Date.now()` implícito (toda função que depende de "hoje" recebe a data como parâmetro), determinístico. É a única fonte de verdade das regras da Lei 14.133/2021 na Ágora. API e interface importam daqui.

Convenções obrigatórias:
- Dinheiro sempre em **centavos inteiros** (`type Centavos = number`). Nunca ponto flutuante para valores monetários; arredondamento com `Math.round` só no fim do cálculo.
- Datas de calendário sempre `DataISO` = `'YYYY-MM-DD'` (string). Use aritmética UTC internamente (`Date.UTC`) para nunca sofrer com fuso horário.
- Nomes de símbolos e mensagens em **pt-BR**.
- Toda função que produz um juízo legal retorna também `fundamento: string` (ex.: `'Lei 14.133/2021, art. 125'`).
- Funções que geram **sinais** (risco, fracionamento, artigo de luxo, outlier) nunca "decidem": retornam `sinal` + explicação. A decisão é humana.
- Sem `any`, sem `@ts-ignore`, sem `catch` vazio, sem TODO. Entrada inválida → lançar `ErroDominio` (classe exportada, com `codigo: string`).
- `tsconfig` usa `erasableSyntaxOnly`: **proibido `enum`, `namespace` e parameter properties**. Use uniões de literais e objetos `as const`.
- Imports relativos com extensão `.ts` (ex.: `import { x } from './datas.ts'`).

Estrutura de arquivos (`src/`):

```
index.ts               reexporta tudo
erros.ts               ErroDominio
moeda.ts
documentos.ts
datas.ts
vigencia.ts
lei14133/limites.ts
lei14133/aditivos.ts
lei14133/sancoes.ts
lei14133/desempate.ts
lei14133/etp.ts
lei14133/precos.ts
lei14133/segregacao.ts
lei14133/prazos.ts
lei14133/luxo.ts
lei14133/score.ts
catalogo-regras.ts
```

Testes em `test/*.test.ts` com `node:test` + `node:assert/strict` (executados por `node --test`). Cobrir caminho feliz, bordas e erros de cada função. Meta: todas as funções exportadas testadas.

---

## erros.ts

```ts
export class ErroDominio extends Error {
  readonly codigo: string;
  constructor(codigo: string, mensagem: string) // define this.name = 'ErroDominio'
}
```

## moeda.ts

```ts
export type Centavos = number;
export function ehCentavos(v: unknown): v is Centavos            // inteiro finito (pode ser negativo)
export function paraCentavos(reais: number | string): Centavos   // aceita 1234.5, "1234,50", "1.234,50", "R$ 1.234,50"; inválido → ErroDominio('MOEDA_INVALIDA')
export function formatarMoeda(c: Centavos): string               // "R$ 1.234,56"; negativo "-R$ 1.234,56"; use Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'}) e normalize espaços especiais (U+00A0/U+202F) para espaço comum
export function formatarMoedaCompacta(c: Centavos): string       // "R$ 1,2 mi", "R$ 350 mil", "R$ 2,5 bi"; < 1 mil → formatarMoeda
export function somar(...valores: Centavos[]): Centavos
export function percentual(parte: number, total: number, casas?: number /*=1*/): number   // total 0 → 0
export function aplicarPercentual(c: Centavos, pct: number): Centavos  // Math.round(c * pct / 100)
```

## documentos.ts

```ts
export function somenteDigitos(s: string): string
export function validarCpf(cpf: string): boolean       // dígitos verificadores; rejeita sequências repetidas (111.111.111-11)
export function validarCnpj(cnpj: string): boolean     // numérico de 14 dígitos com DV (não implementar o CNPJ alfanumérico)
export function formatarCpf(cpf: string): string       // "123.456.789-09"
export function formatarCnpj(cnpj: string): string     // "12.345.678/0001-95"
export function tipoDocumento(doc: string): 'cpf' | 'cnpj' | 'invalido'
export function mascararCpf(cpf: string): string       // padrão de anonimização do governo federal: "***.456.789-**"
export function mascararDocumento(doc: string): string // CNPJ → formatarCnpj (CNPJ não é dado pessoal); CPF → mascararCpf; inválido → "Documento inválido"
export function mascararEmail(email: string): string   // "joao.silva@mj.gov.br" → "j*********@mj.gov.br" (mantém domínio; mantém 1º caractere)
export function mascararTelefone(tel: string): string  // "(61) 99876-1234" → "(61) *****-1234"
export function mascararNome(nome: string): string     // "Maria das Graças Souza" → "Maria G. S." (primeiro nome + iniciais, ignorando "da/das/de/do/dos/e")
```

## datas.ts

Lei 14.133, art. 183: prazos contados excluindo o dia do começo e incluindo o do vencimento; dias úteis = dias com expediente; se o vencimento cair em dia sem expediente, prorroga-se para o primeiro dia útil seguinte.

```ts
export type DataISO = string;
export function validarDataISO(d: string): boolean
export function hojeISO(agora: Date): DataISO                       // usa fuso America/Sao_Paulo via Intl (en-CA formata YYYY-MM-DD)
export function adicionarDias(d: DataISO, n: number): DataISO
export function diasEntre(inicio: DataISO, fim: DataISO): number    // fim - inicio em dias (pode ser negativo)
export function diaDaSemana(d: DataISO): number                      // 0 = domingo
export function pascoa(ano: number): DataISO                         // algoritmo de Meeus/Jones/Butcher
export interface OpcoesCalendario {
  feriadosExtras?: DataISO[];               // feriados locais/portarias cadastrados pelo órgão
  considerarPontosFacultativos?: boolean;   // padrão true: Carnaval (segunda e terça) e Corpus Christi sem expediente
}
export function feriadosNacionais(ano: number): { data: DataISO; nome: string; tipo: 'feriado' | 'ponto_facultativo' }[]
// Feriados (Leis 662/1949, 6.802/1980, 14.759/2023): 01-01 Confraternização Universal; Sexta-feira Santa (Páscoa − 2);
// 04-21 Tiradentes; 05-01 Dia do Trabalho; 09-07 Independência; 10-12 Nossa Senhora Aparecida; 11-02 Finados;
// 11-15 Proclamação da República; 11-20 Dia Nacional de Zumbi e da Consciência Negra; 12-25 Natal.
// Pontos facultativos: Carnaval segunda (Páscoa − 48) e terça (Páscoa − 47); Corpus Christi (Páscoa + 60).
// Ordenar por data.
export function ehDiaUtil(d: DataISO, opcoes?: OpcoesCalendario): boolean
export function adicionarDiasUteis(d: DataISO, n: number, opcoes?: OpcoesCalendario): DataISO  // n ≥ 0; n=0 retorna d se útil, senão próximo útil
export function diasUteisEntre(inicio: DataISO, fim: DataISO, opcoes?: OpcoesCalendario): number // exclui início, inclui fim; fim < inicio → negativo simétrico
export function proximoDiaUtil(d: DataISO, opcoes?: OpcoesCalendario): DataISO // d se útil
export function contarPrazo(inicio: DataISO, dias: number, tipo: 'uteis' | 'corridos', opcoes?: OpcoesCalendario): { vencimento: DataISO; fundamento: string }
// corridos: adicionarDias e, se cair em dia não útil, proximoDiaUtil. uteis: adicionarDiasUteis. fundamento 'Lei 14.133/2021, art. 183'.
export function formatarData(d: DataISO): string  // "08/11/2026"
```

## vigencia.ts

```ts
export type Semaforo = 'vencido' | 'critico' | 'atencao' | 'alerta' | 'planejamento' | 'regular';
// vencido: dias < 0; critico: 0..30; atencao: 31..60; alerta: 61..90; planejamento: 91..120 (RN-31); regular: > 120
export function classificarVigencia(fim: DataISO, hoje: DataISO): { diasRestantes: number; semaforo: Semaforo; rotulo: string }
// rotulo pt-BR: "Vencido há 3 dias", "Vence hoje", "Vence em 1 dia", "Vence em 45 dias"
export interface EntradaQueimaSaldo { valorTotal: Centavos; valorExecutado: Centavos; inicio: DataISO; fim: DataISO; hoje: DataISO }
export function projetarQueimaSaldo(e: EntradaQueimaSaldo): {
  percentualExecutado: number; percentualTempoDecorrido: number;
  ritmoDiario: Centavos;                     // executado / dias decorridos (0 se nenhum dia decorrido)
  dataEsgotamentoProjetada: DataISO | null;  // null se ritmo 0
  esgotaAntesDoFim: boolean;
  sinal: 'normal' | 'acelerado' | 'lento';   // acelerado: %executado > %tempo + 15; lento: %executado < %tempo − 30
  explicacao: string;
}
```

## lei14133/limites.ts — dispensa por valor (art. 75, I e II) e fracionamento (art. 75, § 1º)

Valores atualizados anualmente por decreto (art. 182). A tabela é versionada; a vigência mais recente com `vigenteDesde <= data` vale.

```ts
export interface LimiteDispensa { norma: string; vigenteDesde: DataISO; obrasServicosEngenharia: Centavos; demais: Centavos }
export const LIMITES_DISPENSA: readonly LimiteDispensa[] = [
  { norma: 'Lei 14.133/2021, art. 75, I e II (valores originais)', vigenteDesde: '2021-04-01', obrasServicosEngenharia: 10_000_000, demais: 5_000_000 },
  { norma: 'Decreto 10.922/2021', vigenteDesde: '2022-01-01', obrasServicosEngenharia: 10_804_082, demais: 5_402_041 },
  { norma: 'Decreto 11.317/2022', vigenteDesde: '2023-01-01', obrasServicosEngenharia: 11_441_665, demais: 5_720_833 },
  { norma: 'Decreto 11.871/2023', vigenteDesde: '2024-01-01', obrasServicosEngenharia: 11_981_202, demais: 5_990_602 },
  { norma: 'Decreto 12.343/2024', vigenteDesde: '2025-01-01', obrasServicosEngenharia: 12_545_115, demais: 6_272_559 },
];
export type TipoObjetoDispensa = 'obras_servicos_engenharia' | 'demais';
export function limiteDispensaVigente(data: DataISO, tipo: TipoObjetoDispensa, tabela?: readonly LimiteDispensa[]): { valor: Centavos; norma: string; vigenteDesde: DataISO; fundamento: string }
// data anterior à primeira vigência → ErroDominio('LIMITE_INEXISTENTE')
export function avaliarFracionamento(e: {
  data: DataISO; tipo: TipoObjetoDispensa;
  contratacoesMesmaNaturezaNoExercicio: Centavos[];  // dispensas por valor já feitas pela mesma unidade gestora, mesmo ramo, no exercício
  novaContratacao: Centavos;
  tabela?: readonly LimiteDispensa[];
}): { somaComNova: Centavos; limite: Centavos; percentualDoLimite: number; sinal: 'sem_risco' | 'atencao' | 'risco'; explicacao: string; fundamento: string }
// sinal: risco se somaComNova > limite; atencao se ≥ 80% do limite; senão sem_risco. fundamento 'Lei 14.133/2021, art. 75, § 1º'.
```

## lei14133/aditivos.ts — art. 125

Alterações unilaterais: o contratado é obrigado a aceitar acréscimos ou supressões de até 25% do valor inicial atualizado do contrato; em reforma de edifício ou de equipamento, o limite para **acréscimos** é 50%. Acréscimos e supressões são computados separadamente, sem compensação entre si (jurisprudência do TCU).

```ts
export function avaliarAditivo(e: {
  valorInicialAtualizado: Centavos;
  acrescimosAnteriores: Centavos;      // soma, valor positivo
  supressoesAnteriores: Centavos;      // soma, valor positivo
  tipo: 'acrescimo' | 'supressao';
  valor: Centavos;                     // positivo
  reformaEdificioOuEquipamento?: boolean;
}): { percentualAcumulado: number; limitePercentual: number; permitido: boolean; margemRestante: Centavos; explicacao: string; fundamento: string }
// valores negativos ou valorInicial ≤ 0 → ErroDominio('ADITIVO_INVALIDO')
```

## lei14133/sancoes.ts — arts. 155 a 163

```ts
export type IncisoInfracao = 'I'|'II'|'III'|'IV'|'V'|'VI'|'VII'|'VIII'|'IX'|'X'|'XI'|'XII';
export const INFRACOES_ART_155: readonly { inciso: IncisoInfracao; descricao: string }[]
// I dar causa à inexecução parcial do contrato; II inexecução parcial que cause grave dano à Administração, ao funcionamento dos serviços públicos ou ao interesse coletivo;
// III inexecução total do contrato; IV deixar de entregar a documentação exigida para o certame; V não manter a proposta, salvo fato superveniente justificado;
// VI não celebrar o contrato ou não entregar a documentação exigida para a contratação, quando convocado dentro do prazo de validade da proposta;
// VII ensejar o retardamento da execução ou da entrega do objeto sem motivo justificado; VIII apresentar declaração ou documentação falsa ou prestar declaração falsa durante a licitação ou a execução;
// IX fraudar a licitação ou praticar ato fraudulento na execução do contrato; X comportar-se de modo inidôneo ou cometer fraude de qualquer natureza;
// XI praticar atos ilícitos com vistas a frustrar os objetivos da licitação; XII praticar ato lesivo previsto no art. 5º da Lei 12.846/2013.
export type TipoSancao = 'advertencia' | 'multa' | 'impedimento_licitar' | 'declaracao_inidoneidade';
export function sancoesCabiveis(inciso: IncisoInfracao): { tipo: TipoSancao; condicao: string; fundamento: string }[]
// art. 156: § 2º advertência só para inciso I, quando não se justificar sanção mais grave; § 3º multa para qualquer inciso;
// § 4º impedimento (até 3 anos) para II a VII quando não se justificar sanção mais grave; § 5º inidoneidade (3 a 6 anos) para VIII a XII, e para II a VII quando se justificar sanção mais grave.
export type Gravidade = 'leve' | 'media' | 'grave' | 'gravissima';
export interface ParametrosDosimetria { base: Record<Gravidade, number>; porAgravante: number; porAtenuante: number; programaIntegridade: number; danoAdministracao: number }
export const PARAMETROS_DOSIMETRIA_PADRAO: ParametrosDosimetria = { base: { leve: 1, media: 5, grave: 10, gravissima: 20 }, porAgravante: 2, porAtenuante: 1, programaIntegridade: 2, danoAdministracao: 3 };
// Parâmetros ilustrativos: o órgão deve definir os seus em ato normativo próprio. Deixe isso escrito no JSDoc.
export function calcularDosimetriaMulta(e: {
  valorContrato: Centavos; gravidade: Gravidade; agravantes: string[]; atenuantes: string[];
  programaIntegridade: boolean; danoAdministracao: boolean; parametros?: ParametrosDosimetria;
}): { percentualCalculado: number; percentualAplicado: number; valorMulta: Centavos; limitado: 'minimo' | 'maximo' | null; memoriaCalculo: string[]; fundamento: string; aviso: string }
// pct = base[gravidade] + agravantes.length*porAgravante − atenuantes.length*porAtenuante − (programaIntegridade? programaIntegridade:0) + (dano? danoAdministracao:0)
// aplicado = clamp(pct, 0.5, 30) — art. 156, § 3º (multa entre 0,5% e 30% do valor do contrato). Considerações do art. 156, § 1º na memória.
// aviso: 'Proposta de dosimetria para apoio à decisão. A sanção é aplicada pela autoridade competente após processo com contraditório e ampla defesa (arts. 157 e 158).'
export function prazoDefesa(intimacao: DataISO, opcoes?: OpcoesCalendario): { vencimento: DataISO; fundamento: string }   // 15 dias úteis — arts. 157 e 158
export function prazoRegistroCeisCnep(aplicacao: DataISO, opcoes?: OpcoesCalendario): { vencimento: DataISO; fundamento: string } // 15 dias úteis — art. 161
export function vigenciaSancao(tipo: 'impedimento_licitar' | 'declaracao_inidoneidade', inicio: DataISO, anos: number): { fim: DataISO; fundamento: string }
// impedimento: 1 ≤ anos ≤ 3; inidoneidade: 3 ≤ anos ≤ 6; fora → ErroDominio('PRAZO_SANCAO_INVALIDO')
export function calcularMultaMoratoria(e: { valorParcela: Centavos; diasAtraso: number; percentualDia: number; limiteDias: number }): { diasConsiderados: number; percentualAplicado: number; valorMulta: Centavos; limitado: boolean; memoriaCalculo: string[]; fundamento: string; aviso: string }
// art. 162: percentual diário sobre a parcela em atraso até o limite de dias previsto em contrato. Apoio à decisão.
```

## lei14133/desempate.ts — art. 60 (+ LC 123/2006)

```ts
export interface Licitante {
  id: string; nome: string; valorProposta: Centavos;
  meEpp?: boolean;
  lanceDisputaFinal?: Centavos;            // art. 60, I
  notaDesempenhoPrevio?: number;           // 0–100, art. 60, II (registro cadastral / atesto)
  acoesEquidadeGenero?: boolean;           // art. 60, III — Decreto 11.430/2023
  programaIntegridade?: boolean;           // art. 60, IV
  empresaBrasileira?: boolean;             // art. 60, § 1º, II
  investePesquisaDesenvolvimentoNoPais?: boolean; // § 1º, III
  praticaMitigacaoClimatica?: boolean;     // § 1º, IV — Lei 12.187/2009
}
export function aplicarDesempate(licitantes: Licitante[], opcoes?: { empateFictoMeEpp?: boolean; margemEmpateFictoPercentual?: number /*=5 (pregão)*/ }): {
  classificacao: { id: string; nome: string; posicao: number; valorConsiderado: Centavos }[];
  empateDetectado: boolean;
  criterioDecisivo: string | null;
  passos: { ordem: number; criterio: string; fundamento: string; resultado: string }[];
  sorteioNecessario: boolean;   // se nenhum critério desempatar
}
// Ordenar por menor valor. Se o 1º lugar estiver empatado com outros (mesmo valor), aplicar em ordem, só entre os empatados:
// 0) (se empateFictoMeEpp e há ME/EPP dentro da margem acima da melhor proposta não-ME/EPP) — LC 123/2006, arts. 44 e 45: registrar passo informativo
// 1) art. 60, I — menor lanceDisputaFinal; 2) II — maior notaDesempenhoPrevio; 3) III — acoesEquidadeGenero true vence; 4) IV — programaIntegridade true vence;
// 5) § 1º, II empresa brasileira; 6) § 1º, III P&D no país; 7) § 1º, IV mitigação climática. Persistindo, sorteioNecessario = true.
// (§ 1º, I — preferência territorial — não se aplica a órgão federal: registrar como passo "não aplicável".)
```

## lei14133/etp.ts — art. 18, § 1º e § 2º

```ts
export type IncisoEtp = 'I'|'II'|'III'|'IV'|'V'|'VI'|'VII'|'VIII'|'IX'|'X'|'XI'|'XII'|'XIII';
export const INCISOS_ETP: readonly { inciso: IncisoEtp; titulo: string; obrigatorio: boolean }[]
// obrigatórios (§ 2º): I, IV, VI, VIII e XIII. Títulos:
// I Descrição da necessidade da contratação; II Previsão no plano de contratações anual; III Requisitos da contratação;
// IV Estimativas das quantidades e memórias de cálculo; V Levantamento de mercado; VI Estimativa do valor da contratação;
// VII Descrição da solução como um todo; VIII Justificativas para o parcelamento ou não; IX Demonstrativo dos resultados pretendidos;
// X Providências prévias à celebração do contrato; XI Contratações correlatas e/ou interdependentes;
// XII Impactos ambientais e medidas mitigadoras; XIII Posicionamento conclusivo sobre a adequação da contratação.
export type ConteudoEtp = Partial<Record<IncisoEtp, { texto?: string; justificativaAusencia?: string }>>;
export function validarEtp(c: ConteudoEtp, minimoCaracteres?: number /*=30*/): {
  completo: boolean; percentualPreenchido: number;
  pendencias: { inciso: IncisoEtp; motivo: 'obrigatorio_vazio' | 'sem_justificativa_ausencia'; mensagem: string }[];
  fundamento: string;
}
// obrigatório sem texto suficiente → obrigatorio_vazio; não obrigatório sem texto e sem justificativa (≥ minimo) → sem_justificativa_ausencia.
```

## lei14133/precos.ts — art. 23 e IN SEGES/ME 65/2021

```ts
export type FonteCotacao = 'painel_precos' | 'contratacao_similar' | 'midia_especializada' | 'fornecedor_direto' | 'nota_fiscal';
export interface Cotacao { id: string; fonte: FonteCotacao; descricaoFonte: string; valorUnitario: Centavos; dataCotacao: DataISO; justificativaEscolhaFornecedor?: string }
export function analisarCestaPrecos(cotacoes: Cotacao[], opcoes: { dataReferencia: DataISO; metodo?: 'iqr' | 'percentual_mediana'; percentualMediana?: number /*=50*/ }): {
  estatisticas: { n: number; media: Centavos; mediana: Centavos; menor: Centavos; maior: Centavos; desvioPadrao: Centavos; coeficienteVariacao: number };
  sugeridasExpurgo: { id: string; motivo: 'inexequivel' | 'excessivamente_elevado'; explicacao: string }[];
  estatisticasSaneadas: { n: number; media: Centavos; mediana: Centavos; menor: Centavos; coeficienteVariacao: number };
  metodologiaRecomendada: 'media' | 'mediana';   // CV saneado ≤ 25% → média; senão mediana
  valorEstimado: Centavos;                       // conforme metodologia, sobre o conjunto saneado
  alertas: { codigo: string; mensagem: string; fundamento: string }[];
  aviso: string;
}
// iqr (padrão quando n ≥ 4): Tukey, fora de [Q1 − 1,5·IQR, Q3 + 1,5·IQR]; abaixo = inexequivel, acima = excessivamente_elevado.
// percentual_mediana (padrão quando n < 4): fora de mediana ± percentualMediana%.
// Alertas: MENOS_DE_3_PRECOS (IN 65/2021, art. 6º, § 5º); FORNECEDOR_DIRETO_INSUFICIENTE (< 3 cotações diretas quando houver alguma — art. 23, § 1º, IV);
// COTACAO_DIRETA_ANTIGA (> 6 meses da dataReferencia — art. 23, § 1º, IV); SEM_JUSTIFICATIVA_FORNECEDOR (cotação direta sem justificativa — art. 23, § 1º, IV);
// SIMILAR_ANTIGA (contratacao_similar > 1 ano — art. 23, § 1º, II); MIDIA_ANTIGA (midia_especializada > 6 meses — art. 23, § 1º, III).
// cotacoes vazio → ErroDominio('CESTA_VAZIA'). aviso: 'Expurgos são sugestões estatísticas; a exclusão de preços deve ser confirmada e justificada pelo agente responsável.'
```

## lei14133/segregacao.ts — art. 7º, § 1º, e art. 9º

```ts
export type PapelProcesso = 'requisitante' | 'equipe_planejamento' | 'agente_contratacao' | 'pregoeiro' | 'comissao_contratacao' | 'autoridade_competente' | 'gestor_contrato' | 'fiscal_tecnico' | 'fiscal_administrativo' | 'parecerista_juridico';
export interface Designacao { papel: PapelProcesso; servidorId: string; nome: string; cpf?: string }
export const PARES_CONFLITANTES: readonly { a: PapelProcesso; b: PapelProcesso; motivo: string }[]
// Defina ao menos: equipe_planejamento×agente_contratacao; equipe_planejamento×pregoeiro; agente_contratacao×fiscal_tecnico; agente_contratacao×fiscal_administrativo;
// pregoeiro×fiscal_tecnico; agente_contratacao×autoridade_competente; pregoeiro×autoridade_competente; gestor_contrato×fiscal_tecnico;
// parecerista_juridico × qualquer outro papel (gere os pares); comissao_contratacao×fiscal_tecnico.
export function verificarSegregacao(designacoes: Designacao[], opcoes?: { sociosFornecedores?: { cnpj: string; razaoSocial: string; cpfsSocios: string[] }[] }): {
  valido: boolean;
  conflitos: { tipo: 'acumulo_funcoes' | 'vinculo_societario'; servidorId: string; nome: string; papeis: PapelProcesso[]; descricao: string; fundamento: string }[];
}
// vinculo_societario: cpf do designado (comparar só dígitos) entre cpfsSocios → fundamento 'Lei 14.133/2021, art. 9º, § 1º, e art. 14, IV'. Sinal para análise, não acusação.
```

## lei14133/prazos.ts — arts. 54, 55, 75 § 3º e 94

```ts
export type ObjetoLicitacao = 'bens' | 'servicos_comuns' | 'servicos_especiais' | 'obras_servicos_engenharia_comuns' | 'obras_servicos_engenharia_especiais';
export type CriterioJulgamento = 'menor_preco' | 'maior_desconto' | 'tecnica_preco' | 'melhor_tecnica' | 'maior_lance' | 'maior_retorno_economico';
export type RegimeExecucao = 'integrada' | 'semi_integrada' | 'outro';
export function prazoMinimoPropostas(p: { objeto: ObjetoLicitacao; criterio: CriterioJulgamento; regime?: RegimeExecucao }): { diasUteis: number; fundamento: string }
// art. 55: I bens — a) 8 (menor preço/maior desconto), b) 15 demais; II serviços e obras — a) 10 (menor preço/maior desconto em serviços comuns e obras/serviços comuns de engenharia),
// b) 25 (menor preço/maior desconto em serviços especiais e obras/serviços especiais de engenharia), c) 60 (contratação integrada), d) 35 (semi-integrada ou demais casos);
// III maior lance: 15; IV técnica e preço ou melhor técnica: 35. maior_retorno_economico cai em II, d (35).
export function dataMinimaAberturaPropostas(publicacao: DataISO, p: Parameters<typeof prazoMinimoPropostas>[0], opcoes?: OpcoesCalendario): { data: DataISO; diasUteis: number; fundamento: string }
export function prazoAvisoDispensaEletronica(publicacao: DataISO, opcoes?: OpcoesCalendario): { data: DataISO; fundamento: string } // 3 dias úteis — art. 75, § 3º
export function prazoDivulgacaoContratoPncp(assinatura: DataISO, origem: 'licitacao' | 'contratacao_direta', opcoes?: OpcoesCalendario): { limite: DataISO; diasUteis: number; fundamento: string }
// art. 94: I 20 dias úteis (licitação); II 10 dias úteis (contratação direta). A divulgação no PNCP é condição de eficácia.
export function situacaoDivulgacaoPncp(assinatura: DataISO, origem: 'licitacao' | 'contratacao_direta', divulgacao: DataISO | null, hoje: DataISO, opcoes?: OpcoesCalendario): { situacao: 'divulgado_no_prazo' | 'divulgado_fora_do_prazo' | 'pendente_no_prazo' | 'pendente_vencido'; limite: DataISO; explicacao: string }
```

## lei14133/luxo.ts — art. 20 (Decreto 10.818/2021)

```ts
export const TERMOS_INDICATIVOS_LUXO: readonly string[]  // ex.: 'luxo', 'premium', 'gourmet', 'grife', 'cristal', 'ouro', 'banhado a ouro', 'seda pura', 'couro legítimo', 'champanhe', 'caviar', 'importado de luxo', 'edição limitada', 'alto padrão', 'design exclusivo'
export function sinalizarArtigoLuxo(descricao: string, termos?: readonly string[]): { sinal: 'sem_indicio' | 'possivel_artigo_luxo'; termosEncontrados: string[]; orientacao: string; fundamento: string }
// comparação sem acento e sem caixa, por palavra/expressão inteira. orientacao: exigir justificativa de que o bem é de qualidade comum ou enquadra exceção do Decreto 10.818/2021.
```

## lei14133/score.ts — art. 88, §§ 3º e 4º (avaliação de desempenho do fornecedor)

```ts
export interface IndicadoresDesempenho {
  entregasNoPrazo: number; entregasTotal: number;
  recebimentosAprovados: number; recebimentosTotal: number;     // termos de recebimento definitivo sem ressalva
  ocorrenciasFiscalizacao: number; ocorrenciasResolvidasNoPrazo: number;
  sancoes: { tipo: TipoSancao; dataAplicacao: DataISO }[];
}
export interface PesosIdc { prazo: number; qualidade: number; ocorrencias: number }   // somam 1
export const PESOS_IDC_PADRAO: PesosIdc = { prazo: 0.4, qualidade: 0.4, ocorrencias: 0.2 };
export function calcularIdc(ind: IndicadoresDesempenho, hoje: DataISO, pesos?: PesosIdc): {
  nota: number;                // 0–100, 1 casa decimal
  faixa: 'excelente' | 'bom' | 'regular' | 'insuficiente' | 'critico';   // ≥90, ≥75, ≥60, ≥40, <40
  componentes: { nome: string; valor: number; peso: number; contribuicao: number }[];
  penalidades: { tipo: TipoSancao; dataAplicacao: DataISO; desconto: number }[];  // só sanções dos últimos 36 meses: advertência −5, multa −10, impedimento −25, inidoneidade −40
  semHistorico: boolean;       // todos os totais 0 → nota 0, faixa 'regular', semHistorico true, não penaliza ausência de dados
  metodologia: string;
  fundamento: string;          // 'Lei 14.133/2021, art. 88, §§ 3º e 4º'
  aviso: string;               // 'Indicador objetivo de apoio. Não constitui sanção nem impede participação em licitações.'
}
// componente sem dados (total 0) usa 100 e é marcado na metodologia.
```

## catalogo-regras.ts — Modo Especificação Técnica e Caderno de Regras

```ts
export type TipoRegra = 'RF' | 'RN' | 'RIA' | 'RNF';
export interface RegraCatalogo { id: string; tipo: TipoRegra; titulo: string; descricao: string; fundamento: string; etapa: 1|2|3|4|5|6|7|null; telas: string[]; implementacao: string /* símbolo do domínio ou módulo da API */ }
export const CATALOGO_REGRAS: readonly RegraCatalogo[]
export function regrasPorTela(tela: string): RegraCatalogo[]
export function regrasPorEtapa(etapa: number): RegraCatalogo[]
```

Conteúdo mínimo do catálogo (escreva descrições completas em pt-BR):
- RN-01 artigo de luxo (art. 20; sinalizarArtigoLuxo; etapa 1; tela 'jornada.dfd')
- RN-02 justificativa de não padronização (art. 19, § 2º; etapa 1)
- RN-03 segregação de funções (art. 7º, § 1º; verificarSegregacao; etapa 2; tela 'jornada.equipe')
- RN-04 elementos mínimos do ETP (art. 18, § 2º; validarEtp; etapa 3)
- RN-05 regras da cesta de preços (art. 23, § 1º; analisarCestaPrecos; etapa 3)
- RN-06 habilitação econômico-financeira sem faturamento mínimo (art. 69; etapa 4)
- RN-07 acesso ao edital sem cadastro (art. 25, § 3º; etapa 5)
- RN-08 desempate (art. 60; aplicarDesempate; etapa 6)
- RN-09 trava pré-assinatura/prorrogação CEIS/CNEP e regularidade (art. 91, § 4º; etapa 7)
- RN-10 limites de aditivos (art. 125; avaliarAditivo; etapa 7; tela 'contratos.detalhe')
- RN-11 prazo de divulgação no PNCP (art. 94; situacaoDivulgacaoPncp; etapa 7; telas 'contratos.detalhe','painel')
- RN-12 dosimetria de multa 0,5%–30% (art. 156, § 3º; calcularDosimetriaMulta; etapa 7; tela 'sancoes')
- RN-13 prazos de defesa e registro CEIS/CNEP (arts. 157, 158 e 161)
- RN-14 dispensa por valor e fracionamento (art. 75, § 1º; avaliarFracionamento; etapa 1)
- RN-15 prazos mínimos de propostas (art. 55; etapa 5)
- RN-16 contagem de prazos (art. 183; contarPrazo)
- RN-17 vigência e semáforo 30/60/90 (classificarVigencia; telas 'painel','contratos','atas')
- RN-18 ordem cronológica de pagamentos (art. 141; tela 'pagamentos')
- RIA-01 consolidação de demandas e anti-fracionamento (sinal; etapa 1)
- RIA-02 robô de instrução SEI (etapa 2; integração planejada — descrever como requisito)
- RIA-03 saneamento estatístico de preços (sugestão; etapa 3)
- RIA-04 redação assistida de TR/edital com fontes e revisão humana obrigatória (etapa 4)
- RIA-05 tarjamento LGPD e sigilo (art. 13; etapa 5)
- RIA-06 sinais de conluio e vínculos societários (etapa 6; sinal para análise)
- RIA-07 projeção de queima de saldo (projetarQueimaSaldo; etapa 7)
- RNF-01 soberania: implantação na infraestrutura do órgão, sem serviços estrangeiros em tempo de execução
- RNF-02 LGPD: mascaramento, registro de acesso a dado pessoal, minimização (LGPD arts. 6º, 37 e 46)
- RNF-03 trilha de auditoria encadeada por hash (art. 169 a 171)
- RNF-04 acessibilidade: gov.br DS, WCAG 2.1 AA, eMAG
- RNF-05 autorização no servidor por perfil e UASG
- RNF-06 IA nunca decide sanção, habilitação ou fraude; human-in-the-loop
- RF para as telas de operação: painel, atas, contratos, itens, empenhos, pagamentos, vínculos, ajustes, administração, auditoria, transparência (um RF por tela, ids RF-01…)
```

## lei14133/pesquisa-precos.ts — art. 23, §§ 1º e 2º (RF-25) e projeção do valor estimado (RIA-11)

```ts
export type OrigemPrecoAutomatizada = 'painel_precos' | 'contratacoes_similares' | 'notas_fiscais' | 'sinapi' | 'sicro';
export interface AmostraPrecoExterna { origem: OrigemPrecoAutomatizada; identificador: string; descricao: string; valorUnitario: Centavos; data: DataISO; unidade?: string; local?: string }
export function enquadrarAmostraArt23(origem: OrigemPrecoAutomatizada, tipoObjeto: TipoObjetoPesquisa): { fonteCotacao: FonteCotacao; inciso: string; fundamento: string; prazoMeses: number | null } | null;
// Bens e serviços (§ 1º): painel → I; similares → II (12 meses); notas fiscais → V (12 meses, IN 65/2021, art. 5º, V).
// Obras e serviços de engenharia (§ 2º, ordem legal): Sinapi/Sicro → I (fonteCotacao 'midia_especializada', tabela oficial);
// similares → III (12 meses); notas fiscais → IV. Painel em obras e Sinapi/Sicro em bens/serviços → null (não aplicável).
export function selecionarSugestoesPrecos(amostras: AmostraPrecoExterna[], opcoes: { hoje: DataISO; tipoObjeto: TipoObjetoPesquisa; limitePorOrigem?: number /*=5, máx. 50*/ }): {
  sugestoes: (AmostraPrecoExterna & { fonteCotacao; inciso; fundamento; prazoMeses; descricaoFonte: string /* ≤ 500 */ })[];
  descartadas: { origem; identificador; motivo }[];   // fonte não prevista, sem identificador, valor ≤ 0, data inválida/futura, fora do prazo, repetida
  excedentes: number;                                 // além do limite por origem
  alertas: { codigo: 'SEM_PARAMETRO_PRIORITARIO' | 'SEM_REFERENCIA_SINAPI_SICRO' | 'POUCAS_SUGESTOES'; mensagem; fundamento }[];
  aviso: string;                                      // AVISO_SUGESTOES_PRECOS: o agente escolhe o que entra na cesta
}
// Ordem: § 1º → painel, similares, notas (IN 65/2021, art. 5º, § 1º); § 2º → Sinapi, Sicro, similares, notas.
// Em cada origem, mais recente primeiro; empate mantém a ordem da fonte.

export interface IndiceMensal { competencia: string /* AAAA-MM */; valor: number }
export function projetarValorEstimado(e: { valorBase: Centavos; dataBase: DataISO; dataPrevista: DataISO; ipca: IndiceMensal[] /* variação % */; cambio?: IndiceMensal[] /* cotação */; percentualCambial?: number /* 0..100 */ }): {
  meses; fatorCentral; fatorMinimo; fatorMaximo; valorBase; valorProjetado; faixa: { minimo; maximo }; variacaoPercentual;
  inflacao: { taxaMensalMedia; desvioMensal; competencias; periodo; acumuladoPeriodo };
  cambio: { participacao; taxaMensalMedia; desvioMensal; competencias; periodo; ultimaCotacao } | null;
  sinal: { nivel: 'informativo' | 'atencao' /* |variação| ≥ 5% */; mensagem };
  premissas: string[]; memoriaCalculo: string[]; fundamento: string; aviso: string /* "Requer revisão humana" */;
}
// Média geométrica mensal dos 12 últimos meses (mínimo 6; câmbio: 13 cotações, mínimo 7); horizonte em meses de 30,4375 dias,
// até 36 meses; fator = (1 − p)·(1 + IPCA)^m + p·(1 + câmbio)^m; faixa = taxas ± 1 desvio-padrão amostral.
// Erros: ErroDominio('PROJECAO_INVALIDA') para data prevista ≤ data-base ou > 36 meses, série curta, competência inválida ou repetida,
// percentual fora de 0..100 ou câmbio ausente com parcela cambial.
```

- RF-25 consulta automática e combinada de preços (selecionarSugestoesPrecos, enquadrarAmostraArt23; etapa 3; tela 'jornada.detalhe')
- RIA-11 projeção cambial e inflacionária do valor estimado (projetarValorEstimado; etapa 3; sinal, não altera o valor)
## notificacoes.ts — central de notificações (RF-26) e semáforo 30/60/90/120 (RN-31)

Modelos de mensagem fixos em pt-BR (sem IA), faixas de aviso, avisos obrigatórios, entrega conforme a preferência e novas tentativas.

```ts
export type TipoNotificacao = 'vencimento' | 'reajuste' | 'garantia' | 'pendencia' | 'ocorrencia';
export type CanalNotificacao = 'email' | 'sei' | 'govbr';
export type PapelDestinatario = 'gestor' | 'fiscal' | 'contratada' | 'responsavel';
export type FaixaVencimento = 30 | 60 | 90 | 120;
export function faixaVencimento(diasRestantes: number): FaixaVencimento | null   // 0..30→30; ..60→60; ..90→90; ..120→120; senão null
export function avaliarAvisoVencimento(vigenciaFim: DataISO, hoje: DataISO): { diasRestantes; faixa; obrigatorio; rotulo } | null
export function avaliarAvisoReajuste(dataBase: DataISO, hoje: DataISO, antecedenciaDias = 30): { aniversario: DataISO; diasAte: number } | null
export function avaliarAvisoGarantia(validaAte: DataISO, hoje: DataISO, antecedenciaDias = 30): { diasRestantes: number } | null
export function avisoObrigatorio(tipo: TipoNotificacao, faixa: FaixaVencimento | null): boolean   // ocorrência; vencimento na faixa de 30
export function baseLegalEnvio(papel: PapelDestinatario): string   // LGPD, art. 7º (e art. 23 para servidores)
export function preferenciaPadrao(canal: CanalNotificacao): boolean   // e-mail e SEI ligados; gov.br desligado (adesão)
export function decidirEntregaNotificacao(e: { canal; papel; obrigatoria; preferencia: boolean | null; destinatarioPessoaFisica }): { enviar: boolean; motivo: string | null }
export function proximaTentativa(tentativasRealizadas: number, agora: string, maximo = 5): string | null   // +1, +5, +15, +60 min; null = falhou
export function montarMensagemNotificacao(e: EntradaMensagemNotificacao): { assunto; corpo; fundamento; obrigatoria; faixa }
```

Erros: `DIAS_INVALIDOS`, `TENTATIVA_INVALIDA` e `NOTIFICACAO_INVALIDA` (tipo, canal ou papel desconhecido; relato de ocorrência com menos de 20 caracteres; data de referência ausente em reajuste e garantia; complemento acima de 2000 caracteres).
## lei14133/luxo.ts — trava de minutas (roteiro PoC-01)

```ts
export function avaliarBloqueioLuxoMinutas(itens: readonly { descricao: string }[], justificativa: string | null, minimoCaracteres?: number): { bloqueado: boolean; itens: { item: number; termos: string[] }[]; mensagem: string; fundamento: string }
// bloqueado = algum item com indício (sinalizarArtigoLuxo) e justificativa com menos de minimoCaracteres (padrão 30).
// A API chama antes de redigir qualquer minuta e antes de chamar o provedor de IA (RN-01).
```

## lei14133/sustentabilidade.ts — art. 5º, art. 11, IV, e art. 18, § 1º, XII (RN-21)

```ts
export interface CriteriosSustentabilidade { criteriosAmbientais: string | null; logisticaReversa: string | null }
export function verificarSustentabilidade(e: { politicaAtiva: boolean; criterios: CriteriosSustentabilidade; documento: 'etp' | 'tr' }, minimoCaracteres?: number): { exigida: boolean; completa: boolean; pendencias: { campo: 'criteriosAmbientais' | 'logisticaReversa'; mensagem: string }[]; orientacao: string; fundamento: string }
// política ligada: cada critério com menos de minimoCaracteres (padrão 30) vira pendência; desligada: sem pendências.
```

## lei14133/selecao.ts — arts. 17, 41, 71 e 165 (RN-20, RN-22, RF-18)

```ts
export type ExigenciaProvaConceito = 'nenhuma' | 'prova_conceito' | 'amostra';
export const PRAZO_MAXIMO_PROVA_CONCEITO_DIAS_UTEIS = 30;
export function validarProvaConceito(p: ParametrosProvaConceito, minimoCaracteres?: number): { exigida; completa; pendencias: { campo: 'roteiro' | 'justificativa' | 'prazoDiasUteis'; mensagem }[]; fundamento }
export function prazoProvaConceito(convocacao: DataISO, prazoDiasUteis: number, opcoes?: OpcoesCalendario): { limite: DataISO; fundamento } // art. 183
export function validarInversaoFases(p: { adotada: boolean; motivacao: string | null }, minimoCaracteres?: number): { pendencias: string[]; fundamento } // art. 17, § 1º
export const PRAZOS_RECURSAIS_DIAS_UTEIS = { razoes: 3, contrarrazoes: 3, reconsideracao: 3, decisaoSuperior: 10 };
export function prazosRecursoSelecao(dataAto: DataISO, encaminhamento: DataISO | null, opcoes?): { razoes; contrarrazoes; reconsideracao; decisaoSuperior: DataISO | null; fundamento }
// razões = ato + 3 du; contrarrazões = fim das razões + 3 du; reconsideração = fim das contrarrazões + 3 du; decisão superior = encaminhamento + 10 du.
export function avaliarSelecao(e: EstadoSelecao, hoje: DataISO, opcoes?): AvaliacaoSelecao
// ordem: disputa → prova de conceito do vencedor provisório (se exigida) → habilitação (invertidas com inversão de fases) →
// intenção de recurso no dia do ato (preclusão no dia seguinte) → razões → contrarrazões → reconsideração → decisão superior →
// adjudicação → homologação. Reprovação, inabilitação ou reforma em recurso excluem o licitante; o próximo classificado vira
// vencedor provisório (convocacaoAutomatica = true quando há prova a refazer). Reforma pode reintegrar licitante excluído.
export function validarAtoSelecao(e: EstadoSelecao, ato: AtoSelecao, hoje: DataISO, opcoes?): AvaliacaoSelecao
// lança ErroDominio ATO_SELECAO_FORA_DE_ORDEM (ato fora da vez ou do prazo) ou ATO_SELECAO_INVALIDO (licitante ilegítimo).
```

Regras novas no catálogo: RN-20 (prova de conceito ou amostra), RN-21 (sustentabilidade obrigatória), RN-22 (fase recursal única e prazos), RF-18 (adjudicação, homologação e divulgação dos documentos preparatórios). RN-01 passa a citar `avaliarBloqueioLuxoMinutas`.
