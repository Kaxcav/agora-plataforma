# Próximos passos (depois da 2.0.1)

Situação em 09/11/2026: a versão 2.0.1 está no master e no ar, com todas as verificações passando. Falta fechar a 2.0.2, que trata os pontos da seção 16 da rastreabilidade conferidos na conversa do cliente.

## 1. Rascunho na branch `agy-z-conversa` (não revisado)

O agy foi interrompido no meio desta tarefa. O código está no commit 98f20dc e ainda não passou por typecheck, testes, e2e nem gates.

- **Nota técnica de preços depois da homologação.** Corrige um desvio da conversa. Pelo RF-02.2, o sigilo do orçamento vai só até a conclusão dos lances ou do julgamento, e a Ágora nunca publicava a nota técnica de orçamento sigiloso. Agora ela passa a ser publicada com os documentos preparatórios depois da homologação. A exceção é o processo com classificação LAI vigente, por causa do art. 13. Arquivo: `apps/api/src/modulos/publico/preparatorios.ts`.
- **Ordem cronológica dos pagamentos, publicada por mês.** É obrigação legal do art. 141, § 3º. São três peças:
  - a rota `GET /api/v1/publico/ordem-cronologica?mes=AAAA-MM`;
  - a página pública `apps/web/src/paginas/publicas/OrdemCronologica.tsx`;
  - o teste `apps/api/test/ordem-cronologica-publica.test.ts`.

  Na página, contrato sigiloso aparece como "Informação classificada" e CPF aparece mascarado.

Para concluir:
1. Revise o diff com `git diff master...agy-z-conversa`.
2. Confira a página pública nova:
   - a consulta deve reaproveitar a de `dados-abertos/conjuntos.ts`, sem duplicar a lógica;
   - o objeto e o fornecedor de contrato sigiloso devem estar rotulados;
   - a tabela deve ser acessível, com cabeçalhos e foco.
3. Confirme que a regra nova entrou no catálogo e que o teste do catálogo foi ajustado.
4. Rode `npm run typecheck`, `npm test`, `npm run build` e `npm run e2e`. A navegação pública precisa cobrir a página nova.
5. Rode os gates da Fábrica e `fabrica_trace_requirements`.

## 2. Tarefa ainda não iniciada: alteração do PCA publicado e aviso de IRP dispensável

As duas foram decididas pelo usuário em 09/11/2026. Não estão na conversa, mas a lei permite. Passe a tarefa ao agy, rodando na pasta `plataforma`, depois que a seção 1 estiver no master.

**A. Alteração do PCA publicado (Decreto 10.947/2022)**
- Criar a migração `035_pca_alteracoes.sql` com a tabela `pca_alteracoes`:
  - tipo: inclusão, exclusão ou redimensionamento;
  - justificativa obrigatória;
  - situação: proposta, aprovada ou recusada;
  - quem propôs, quem decidiu e o motivo da recusa.
- Criar as rotas, todas só para plano publicado e todas com registro na trilha de auditoria:
  - `POST /pca/:id/alteracoes`, com a permissão `pca:editar`;
  - `POST /pca/:id/alteracoes/:alteracaoId/aprovar` e `/recusar`, com `pca:aprovar`. A recusa exige motivo.
- Quem propôs não aprova a própria alteração.
- Ao aprovar:
  - a mudança é aplicada ao plano, que ganha nova versão;
  - o plano é reenviado ao PNCP pela fila, reaproveitando `solicitarPublicacaoPca`, sem criar tipo novo de tarefa.
- `GET /pca/:id` passa a trazer as alterações. O sinal de "demanda fora do plano" passa a sugerir uma proposta de inclusão.
- Web: seção "Alterações do plano" na tela do PCA publicado.
- Acrescentar a regra no catálogo e um teste de API.
- O artigo exato do decreto fica para a conferência jurídica (rastreabilidade, seção 15, item 12).

**B. Aviso de IRP dispensável (Decreto 11.462/2023, art. 9º, § 1º)**
- Função pura no domínio: devolve o sinal quando nenhum participante é de UASG diferente da do gerenciador. É só aviso; a decisão é do gerenciador.
- `GET /irps` e `GET /irps/:id` passam a trazer o sinal, e a tela da IRP mostra o aviso sem bloquear nada.
- Acrescentar a regra no catálogo e um teste de domínio.

## 3. Fechar a 2.0.2

1. Subir a versão para 2.0.2 em todos os `package.json`. As dependências internas `@agora/*` também vão para 2.0.2. Depois, rode `npm install --package-lock-only`.
2. Rodar typecheck, testes, build, e2e completo, gates e trace.
3. Testar a migração 035 sobre um banco já populado da 2.0.1. Use `AGORA_DADOS_DIR`: suba primeiro a versão anterior e depois a nova sobre o mesmo diretório.
4. Fazer o merge no master, regenerar os PDFs com `node docs/gerar-pdfs.mjs` e dar push. O Railway publica sozinho.
5. Rodar `npm run build` no checkout principal e depois `fabrica_verify_deploy` com o perfil `agora` e a versão esperada 2.0.2.
6. Atualizar o manual (capítulos 7, 10 e 19), a rastreabilidade e o plano.

## 4. O que não é código

- **Credenciais e infraestrutura do órgão:** os 12 itens da seção 15 da rastreabilidade, como PNCP, Portal da Transparência, SEI, SMTP, gov.br, carimbo do tempo e cluster.
- **Conferência jurídica:** o texto do Decreto 11.430/2023 e do Decreto 9.450/2018, que tratam das cotas de contratação, e o artigo do Decreto 10.947/2022 sobre a alteração do PCA.
- **Limites da dispensa de 2027:** o decreto ainda não saiu. Quando sair, entra uma linha em `LIMITES_DISPENSA`.
