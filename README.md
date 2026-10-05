# Scrobble Audit

**Veja exatamente o que alguém ouviu em qualquer período, com os scrobbles da Last.fm.**

Quer saber o que tocou na sua conta entre 08:00 e 13:00 de um dia? Em que horários uma música foi ouvida? Quem ouviu mais música na última semana? O Scrobble Audit responde isso em poucos cliques, mostrando cada música no horário exato em que foi registrada e conferindo o total com a própria Last.fm.

[![Licença: MIT](https://img.shields.io/badge/licen%C3%A7a-MIT-blue.svg)](LICENSE)
[![Deploy na Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmacedo-kayki%2Fscrobble-audit&env=LASTFM_API_KEY&envDescription=API%20key%20da%20Last.fm%20%28fica%20s%C3%B3%20no%20servidor%29&envLink=https%3A%2F%2Fwww.last.fm%2Fapi%2Faccount%2Fcreate&project-name=scrobble-audit)

![Tela de auditoria do Scrobble Audit](docs/screenshot.png)
<sub>Imagem com dados de exemplo.</sub>

> **O que é um scrobble?** É o registro que a Last.fm guarda toda vez que você ouve uma música, no Spotify, no YouTube Music, no celular ou em qualquer app conectado. Cada scrobble tem a música, o artista e o horário em que tocou.

---

## O que dá para fazer

- **Escolher qualquer período**, até o segundo: "hoje das 08:00 às 13:00", "de sexta à noite até domingo", "o mês passado inteiro".
- **Ver cada música ouvida** nesse período, com data e horário.
- **Ter certeza de que nada ficou de fora.** No fim, o total encontrado é comparado com o que a Last.fm informa. Se bater, aparece **"Tudo conferido"**.
- **Descobrir todas as vezes que uma música tocou**: é só clicar nela.
- **Filtrar** por artista, música, álbum, dia, horário do dia (inclusive de madrugada, como das 22:00 às 02:00), dia da semana e muito mais.
- **Ver resumos e gráficos**: total de scrobbles, músicas e artistas mais ouvidos, horários e dias da semana em que mais se ouve música.
- **Montar um ranking** e comparar quantos scrobbles cada pessoa fez **no mesmo período**, inclusive de um artista, música ou álbum específico.
- **Baixar os resultados** como planilha (abre no Excel) ou como arquivo para abrir no Scrobble Audit depois.
- **Abrir de novo** uma auditoria ou um ranking que você baixou, sem buscar tudo outra vez, ou mandar o arquivo para outra pessoa abrir.

Todos os horários aparecem no **horário de Brasília**.

![Ranking de usuários](docs/ranking.png)
<sub>Imagem com dados de exemplo.</sub>

## Como usar

1. **Digite o nome de usuário** da Last.fm de quem você quer ver (o seu ou de outra pessoa com perfil público).
2. **Escolha o período** em "De" e "Até", ou clique em um atalho: *Hoje*, *Ontem*, *Últimos 7 dias*…
3. Clique em **Auditar** e espere a busca terminar. Dá para acompanhar o progresso e cancelar se quiser.
4. Pronto! Agora você pode:
   - clicar em **uma linha da lista** para ver os detalhes daquele scrobble;
   - clicar em **uma música** para ver todas as vezes em que ela tocou;
   - usar os **filtros** à esquerda (os números e gráficos acompanham os filtros);
   - trocar a lista para **Por música**, **Por artista** ou **Por álbum**;
   - clicar em **Exportar** para baixar uma planilha ou um arquivo.

### Ranking

1. Na aba **Ranking**, escolha o período em "De" e "Até", ou clique num atalho (*Hoje*, *Últimos 7 dias*…). O atalho **Igual à aba Auditoria** copia o período que você já preencheu lá.
2. Digite um nome de usuário e clique em **Colocar no ranking**. Repita para cada pessoa.

Todo mundo é comparado exatamente no mesmo período. Para trocar o período depois, clique em **Mudar período**.

**Filtrar o ranking:** em **Filtrar ranking**, digite um artista, uma música e/ou um álbum para ver quem mais ouviu aquilo no período. A lista se reorganiza pelo total filtrado, e o botão **Ver** abre a auditoria da pessoa já com o mesmo filtro. Pessoas colocadas no ranking antes dessa função existir aparecem com "Atualize para filtrar"; é só clicar em **Atualizar**. Cada pessoa tem os botões **Ver** (abre a auditoria completa), **Atualizar** (busca de novo) e **Tirar** (remove do ranking).

### Abrir um arquivo baixado

Clique em **Importar**, ou simplesmente arraste o arquivo para a página. O Scrobble Audit reconhece sozinho se é uma auditoria ou um ranking. Uma auditoria aberta de arquivo aparece como **"Aberto de um arquivo"**, e o botão **Auditar de novo** confere tudo outra vez na Last.fm.

## Perguntas frequentes

**Preciso de senha ou de login?**
Não. O Scrobble Audit só lê informações públicas da Last.fm. Você nunca digita sua senha.

**Consigo ver qualquer pessoa?**
Qualquer pessoa com perfil público na Last.fm. Quem deixou o histórico privado não pode ser auditado.

**Meus dados ficam guardados em algum lugar?**
Só no seu próprio navegador: histórico de nomes pesquisados, ranking e a última auditoria, para nada se perder quando você recarregar a página. Para apagar tudo, use **Configurações → Apagar tudo**.

**O que significa "Tudo conferido"?**
Que o número de scrobbles encontrados é exatamente o número que a Last.fm informa para aquele período. Se aparecer **"Faltaram alguns scrobbles"**, é só clicar em Auditar de novo.

**O que são "scrobbles muito próximos"?**
Scrobbles registrados com menos de 30 segundos de diferença entre um e outro. Como uma música precisa tocar por um tempo para virar scrobble, isso pode indicar registros duplicados ou estranhos. Vale dar uma olhada.

**A planilha abriu toda em uma coluna só no Excel. E agora?**
Em **Configurações → Formato da planilha**, troque a opção e baixe de novo.

**Por que algumas músicas aparecem sem álbum ou sem duração?**
Porque a Last.fm não tem essa informação para elas. O Scrobble Audit mostra "não informado" em vez de inventar. A duração não vem junto com os scrobbles: para ver, clique em **Buscar durações**.

**A busca está demorando.**
Períodos com dezenas de milhares de scrobbles podem levar alguns minutos, porque a Last.fm entrega os dados aos poucos. Se aparecer "Muitos pedidos agora", espere um pouco: o Scrobble Audit tenta de novo sozinho.

---

## Para desenvolvedores

> A partir daqui o texto é técnico: instalação, publicação e funcionamento interno.

O site é estático, sem framework, sem etapa de build e sem dependências: HTML, CSS e JavaScript (ES modules). A única parte de servidor é um proxy mínimo que guarda a API key da Last.fm, para que ela nunca chegue ao navegador.

### Publicar na Vercel

**Com um clique:** use o botão **Deploy na Vercel** no topo e informe a `LASTFM_API_KEY` quando pedir.

**Manualmente:**

1. Obtenha uma API key em <https://www.last.fm/api/account/create>. O *Callback URL* pode ficar vazio, e o *shared secret* não é usado.
2. Na Vercel: **Add New → Project** e importe o repositório.
3. Em **Framework Preset**, escolha **Other**. Deixe *Build Command*, *Output Directory* e *Install Command* vazios.
4. Em **Environment Variables**, adicione `LASTFM_API_KEY`.
5. Clique em **Deploy**. Se trocar a key depois, faça um *Redeploy* para ela valer.

### Rodar localmente

Requisito: Python 3.8+.

```bash
git clone https://github.com/macedo-kayki/scrobble-audit.git
cd scrobble-audit
cp .env.example .env        # preencha LASTFM_API_KEY=...
python servidor.py          # http://localhost:5173  (--open abre o navegador)
```

O `servidor.py` serve o site e o proxy em `/api/lastfm`, com os mesmos cabeçalhos de segurança da produção. Abrir o `index.html` direto do disco (`file://`) não funciona, porque o navegador bloqueia ES modules nesse modo.

### Segurança da API key

| Ambiente | Proxy | Onde a key fica |
|---|---|---|
| Vercel | [`api/lastfm.js`](api/lastfm.js) (Vercel Function) | variável de ambiente `LASTFM_API_KEY` |
| Local | [`servidor.py`](servidor.py) | arquivo `.env` (no `.gitignore`) |

O navegador chama `/api/lastfm` sem key, e o proxy acrescenta a key no servidor. Os dois proxies:

- aceitam só os métodos de leitura usados pelo app (`user.getrecenttracks`, `user.getinfo`, `track.getinfo`);
- descartam parâmetros desconhecidos e qualquer `api_key` vinda do cliente;
- nunca devolvem a key;
- não enviam CORS e recusam requisições *cross-site* do navegador.

O site usa uma Content Security Policy restritiva ([`vercel.json`](vercel.json)), e todo conteúdo dinâmico é escapado antes de entrar no HTML. Em instâncias públicas, scripts fora do navegador ainda podem consumir a cota da key; para limitar isso, use uma regra de *rate limiting* no Vercel Firewall. O visitante também pode colar a própria key em Configurações; nesse caso ela é usada direto do navegador dele.

Para hospedagem só estática (sem functions), defina `proxyUrl: ''` em [`site.config.js`](site.config.js). Assim cada visitante informa a própria key.

### Como a busca garante o período exato

O método `user.getRecentTracks` devolve até 200 scrobbles por página, do mais novo para o mais antigo:

1. **Folga de 1 s:** a consulta usa `from − 1` e `to + 1`, e o intervalo exato é aplicado no cliente. O resultado fica correto qualquer que seja a semântica de `from`/`to` da API.
2. **Cursor de tempo:** cada página pede `to = scrobble mais antigo já visto + 1`, em vez de `page=N`. Scrobbles que chegam durante a busca, inclusive offline com data retroativa, não deslocam as páginas.
3. **Deduplicação exata:** o segundo de fronteira é relido, e para cada scrobble idêntico fica a maior multiplicidade vista em uma única resposta. Assim duplicatas legítimas são preservadas.
4. **Segundos com 200 scrobbles ou mais** (importações) são paginados isoladamente.
5. **Paralelismo:** volumes grandes são divididos em fatias de tempo disjuntas, sob um limite global de ≈4 requisições por segundo.
6. **Verificação:** o total coletado é comparado com um novo `@attr.total`. Se faltar algo, a janela é percorrida de novo, até 2 vezes.

Todos esses casos têm testes automatizados. O algoritmo também foi validado contra a API real: uma auditoria de 10 anos (23.903 scrobbles) bateu exatamente com o total da Last.fm.

O fuso horário é fixo (`TIME_ZONE = 'America/Sao_Paulo'` em [`src/config.js`](src/config.js)); para outra região, troque essa constante.

### Estrutura

```
index.html · site.config.js     página e configuração pública (URL do proxy)
api/lastfm.js                   proxy da Last.fm (Vercel Function)
servidor.py                     servidor local: site + proxy (key no .env)
vercel.json                     cabeçalhos de segurança
src/
  main.js · config.js           inicialização e constantes
  core/                         lógica pura, sem DOM (testável no Node)
    time.js · model.js · audit.js · filters.js · stats.js
    export.js · importer.js · storage.js · rateLimiter.js · errors.js
  sources/
    registry.js                 interface ScrobbleSource (novas fontes)
    lastfm/client.js            HTTP, novas tentativas e erros
    lastfm/source.js            busca exata por intervalo
  ui/                           estado, componentes e telas
tests/                          testes (node --test) e smoke.html
docs/                           imagens deste README
```

Para adicionar outra fonte de scrobbles (ListenBrainz, Libre.fm…), implemente a interface de [`src/sources/registry.js`](src/sources/registry.js) e registre-a em `src/main.js`. Filtros, estatísticas, exportação e ranking funcionam sem alterações.

### Testes

```bash
npm test        # node --test "tests/*.test.js"  — Node 20+
```

Os testes cobrem fuso horário e horário de verão, filtros, estatísticas, exportação e importação (ida e volta), o algoritmo de busca (com uma API simulada) e o proxy. Para ver a interface sem API key, rode `python servidor.py` e abra `/tests/smoke.html?run=audit`. Essa página usa dados de exemplo e outros cenários: `ranking`, `import`, `notfound`, `ratelimit`, `empty`.

### Contribuindo

Issues e pull requests são bem-vindos. Mantenha a lógica em `src/core/` sem acesso ao DOM, use o template `html` de `src/ui/dom.js` (que escapa os valores) para conteúdo dinâmico, nunca commite `.env` e rode `npm test` antes do PR.

## Licença

[MIT](LICENSE). O Scrobble Audit não tem ligação oficial com a Last.fm. Os dados vêm da [Last.fm API](https://www.last.fm/api), sujeita aos [termos de uso](https://www.last.fm/api/tos).
