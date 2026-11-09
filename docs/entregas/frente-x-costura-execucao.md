# Frente X — Costura da execução contratual (ligações entre as frentes K, L, M e N)

## 1. O que foi ligado

As frentes K (alterações), L (recebimentos e garantias), M (nota fiscal e IMR) e N (desempenho e lições) entregaram módulos que funcionavam separados. Esta frente liga os quatro, sem regra nova: cada ligação usa a função de domínio que já existia.

1. **Um só livro de ocorrências.** A migração `032_costura_execucao.sql` leva as ocorrências de `ocorrencias_execucao` (frente N) para `contratos_ocorrencias` (frente L) e recria `ocorrencias_execucao` como visão sobre o livro único, com gatilhos de inclusão e de solução. A fiscalização (L) e as lições aprendidas (N) leem e gravam o mesmo registro. O livro ganhou categoria, dias de atraso, valor de glosa e os tipos ocorrência, glosa e rescisão.
2. **Recebimentos na avaliação de desempenho e no IDC.**
   - A prévia da avaliação (`derivadosDoPeriodo`) conta, dos termos de recebimento, as entregas no prazo (provisório lavrado dentro do prazo) e os recebimentos definitivos sem ressalva. Ocorrências resolvidas no prazo vêm do livro único.
   - A tela de emissão traz as contagens preenchidas; o agente pode ajustá-las. A API aceita as contagens omitidas e as deriva no servidor.
   - O termo provisório soma entregas e entregas no prazo em `fornecedores_indicadores`; o definitivo e as ocorrências já somavam. As ocorrências lançadas pelas lições aprendidas também contam.
3. **Recebimento definitivo na conferência da nota.** A entrega ganhou quantidade e itens (opcionais). O contexto da conferência traz o termo definitivo aceito ligado à parcela (`recebimentoDefinitivo`) e a tela pré-carrega a quantidade recebida: por item, quando a entrega detalha os itens, ou o total, quando o contrato tem um item só. A quantidade faturada nunca é preenchida: sai da nota, e a conferência a compara com a recebida.
4. **Prorrogação e extinção agem sobre a garantia.**
   - **Prorrogação assinada:** para a garantia de execução vigente cuja validade não cobre a nova vigência e que ainda não tem renovação em aberto, registra a exigência de renovação (movimento), abre pendência com prazo de até 15 dias e avisa a contratada pela central de notificações. O prazo nunca passa da nova vigência.
   - **Extinção decidida:** a multa aplicada e não descontada segue o desconto do art. 156, § 8º (pagamentos devidos primeiro, depois a garantia), gravado em `multas_descontos`, de modo que a multa não é cobrada duas vezes. O que sobra é liberado pela trava do art. 100 (`avaliarLiberacaoGarantia`), com a caução em dinheiro atualizada, ou fica retida, com o motivo registrado.
   - **Aviso ao emitente da garantia:** novo papel de destinatário `emitente_garantia`, pelo SEI, com base legal LGPD própria.

## 2. Revisão do código do agy (correções feitas)

- **Execução sem apuração.** O agy debitava a garantia direto, por cima de `multas_descontos`: a multa continuava com saldo cheio e podia ser descontada de novo, a ordem dos pagamentos primeiro era ignorada e, com mais de uma garantia, o mesmo débito era executado em cada uma. Foi substituído por `execucao/garantia-extincao.ts`, que reaproveita `planejarDescontoMulta`, `avaliarLiberacaoGarantia` e `atualizarCaucaoDinheiro`.
- **Liberação sem trava.** A liberação ignorava recebimentos pendentes, ocorrências abertas e a atualização da caução. Agora passa pela trava do domínio.
- **Execução sem valor.** O efeito "execução da garantia" executava o saldo inteiro sem valor apurado nem motivo. Agora a garantia fica retida e a execução segue por `/garantias/:id/execucao`, com a decisão da autoridade e o valor (art. 139, III).
- **Erros engolidos dentro da transação.** `catch {}` escondia qualquer erro, inclusive de SQL (que anula a transação). Só a falta de destinatário (`ErroDisparo`, `ErroApi`) segue sem aviso; o resto sobe.
- **Aviso duplicado e sem auditoria.** A extinção gerava um aviso por garantia e sem evento de auditoria; agora é um aviso, auditado.
- **Prorrogação.** Garantia ainda a apresentar recebia exigência de renovação, e uma segunda prorrogação abria pendência em duplicidade. Ambos corrigidos.
- **Conferência da nota.** A busca do recebimento "por competência" podia ligar a entrega errada à parcela: ficou só o vínculo explícito. A tela preenchia também a quantidade faturada com a recebida, o que escondia a divergência que a conferência deve apontar. A quantidade única era aplicada a todos os itens.
- **Avaliação de desempenho.** A tela mantinha contagens do período anterior ao mudar as datas; agora recarrega a cada período. Removido `as any` e a checagem de tipo errada em `sancoesNoPeriodo`.
- **Ocorrência.** O mapeamento do tipo para a validação tinha ramo inatingível; os tipos novos usam `outra`.

## 3. Arquivos

- Banco: `apps/api/migracoes/032_costura_execucao.sql`.
- API: `modulos/execucao/garantia-extincao.ts` (novo), `execucao/{rotas,repositorio,avisos}.ts`, `alteracoes/{rotas,servico}.ts`, `desempenho/{repositorio,rotas}.ts`, `imr/servico.ts`, `licoes/rotas.ts`, `notificacoes/{rotas,servico}.ts`.
- Domínio: `catalogo-regras.ts` (RN-33, RN-35, RN-36 e RN-37), `notificacoes.ts` (papel e base legal).
- Contratos: `packages/contratos/src/index.ts`.
- Web: `AbaAvaliacoesContrato.tsx`, `ConferenciaNota.tsx`, `execucao/comum.tsx`, `notificacoes/rotulos.ts`.
- Testes: `apps/api/test/costura-execucao.test.ts` (5 testes) e `e2e/testes/costura-execucao.spec.ts` (2 testes, com axe).

## 4. Regras do catálogo atualizadas

Nenhum código novo. Descrições atualizadas: **RN-33** (prorrogação assinada exige e abre a renovação da garantia), **RN-35** (efeito da extinção na garantia e aviso ao emitente), **RN-36** (quantidade recebida aferida no termo definitivo) e **RN-37** (indicadores vindos dos termos de recebimento e do livro único).

## 5. Rotas

Nenhuma rota nova. Mudam os corpos: `POST /contratos/:id/ocorrencias` (categoria, dias de atraso, valor de glosa, tipos novos), `POST /contratos/:id/recebimentos` (quantidade e itens), `POST .../avaliacoes-desempenho` (contagens opcionais), a prévia (entregas e recebimentos), o contexto da conferência (`recebimentoDefinitivo`), `decidir-extincao` (efeito na garantia e aviso) e o disparo manual (destinatário `emitente_garantia`).

## 6. Variáveis de ambiente

Nenhuma.

## 7. Equivalentes lícitos

- **Execução automática da garantia na extinção** passa a ser retenção com execução decidida pela autoridade: sem valor apurado e sem decisão, a Ágora não debita (art. 139, III; regra 5 do projeto).
- **Multa**: só se desconta pela ordem do art. 156, § 8º, com cada retenção registrada.

## 8. Limitações

- O aviso ao emitente sai pelo SEI com o nome do emissor registrado na garantia; não há e-mail do emitente (a Ágora não guarda dado de contato dele). O envio real depende do SEI do órgão.
- A liberação na extinção sem culpa da Administração exige entregas recebidas e ocorrências encerradas; se houver pendência, a garantia fica retida até a liberação manual.
- A entrega sem quantidade informada vale 1 unidade na conferência.
- O desempenho conta entregas pelo termo provisório; entrega sem provisório lavrado ainda não entra nas contagens.

## 9. Seção pronta para o manual do usuário

### Ligações entre fiscalização, recebimentos, nota fiscal e garantia

**Ocorrências.** Há um só livro de ocorrências por contrato. O que o fiscal ou o gestor registra na aba Fiscalização aparece nas lições aprendidas e na avaliação de desempenho, e o contrário também vale.

**Avaliação de desempenho.** Ao emitir a avaliação (gestor ou fiscal designado), a Ágora já traz o número de entregas no prazo e de recebimentos definitivos sem ressalva do período, tirados dos termos de recebimento. Confira os números, ajuste se for preciso e indique as evidências.

**Conferência da nota fiscal.** Quando a entrega foi ligada à nota e tem termo de recebimento definitivo, a tela de conferência mostra o termo e preenche a quantidade recebida. A quantidade cobrada continua sendo a da nota: se for maior que a recebida, a divergência é apontada.

**Prorrogação e garantia.** Ao assinar a prorrogação, se a validade da garantia de execução não cobrir a nova vigência, a Ágora registra a exigência de renovação na aba Garantias, abre uma pendência com prazo e avisa a contratada. Quem trata: o gestor, com o apoio do financeiro.

**Extinção e garantia.** Ao decidir a extinção, a autoridade (perfil com a permissão de decidir alterações) vê o efeito na garantia no registro do ato:
- multa aplicada e ainda não descontada é descontada primeiro dos pagamentos devidos e depois da garantia;
- sem débito, entregas pendentes ou ocorrências abertas, a garantia é liberada, com a caução em dinheiro atualizada;
- com pendência, ou se a decisão indicar execução da garantia, a garantia fica retida: a execução, com valor e motivo, é feita depois pela autoridade na aba Garantias.

O emitente da garantia (seguradora, banco ou depositário) é avisado pela central de notificações.
