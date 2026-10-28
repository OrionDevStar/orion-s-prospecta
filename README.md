# Prospecta

Aplicação web para encontrar negócios locais e organizar prospecção com dados do OpenStreetMap. Pode ser executada localmente ou publicada em um servidor estático, sem conta de usuário ou chave de API.

## Instalação e execução local

Requisito: **Node.js 24 ou superior**, com npm.

```bash
git clone https://github.com/OrionDevStar/orion-s-prospecta.git
cd orion-s-prospecta
npm start
```

Abra **http://127.0.0.1:3000**.

Não é necessário `npm install`: o servidor e os scripts usam apenas módulos nativos do Node.js. Na primeira execução, `npm start` baixa as bibliotecas de mapa e a base de municípios em versões fixadas. Nas próximas, reutiliza os arquivos locais.

Para mudar a porta:

```bash
PORT=8080 npm start
```

O servidor escuta somente em `127.0.0.1` por padrão. Caso queira expor em outra interface, configure `HOST` conscientemente. Os arquivos públicos vêm somente de `dist/`; a API opcional de conferência Google aceita apenas requisições locais da própria aplicação.

## Conferência Google opcional

Crie um arquivo **`.env` na raiz do repositório**:

```dotenv
PLACESAPI=sua_chave_google_places
```

Habilite **Places API (New)** no projeto Google Cloud com faturamento ativo e restrinja a chave a essa API e ao IP público de saída do servidor. Reinicie `npm start`. O servidor Node lê `.env` com recursos nativos, sem dependências. A chave fica fora de `dist/`, do navegador e das respostas da API. `.env` e `.local/` são ignorados pelo Git.

Após uma busca, use **Abrir consultas Google** para abrir a página de conferência sem mapa. Nenhum candidato começa selecionado: marque os estabelecimentos desejados e use **Consultar selecionados**, em lotes de até cinco. Há opções de selecionar todos e limpar a seleção. Desmarcar um próximo estabelecimento durante o lote impede o envio dele; parar interrompe as próximas consultas, sem repetir a chamada em andamento.

Na fila **Verificar**, cada cartão também oferece **Consultar Google**. Esse clique explícito abre a conferência e consulta somente aquele estabelecimento, usando uma tentativa do limite. O mesmo botão individual existe na página Google e no diálogo do negócio. A ação direta é consumida antes da consulta: recarregar a página não a repete. Abrir a conferência genérica não envia chamadas à API.

Uma única requisição **Text Search Enterprise** busca até três correspondências, o site cadastrado e o status de funcionamento. A máscara de campos é fixa; não há paginação, fotos, avaliações, mapas Google pagos ou repetição automática. Nome, proximidade, endereço e telefone ajudam a evitar homônimos. Um telefone divergente ou correspondência ambígua mantém o negócio pendente. O resultado permanece no mesmo cartão, inclusive quando há site ou fechamento. Facebook ou Instagram no campo de site é sinalizado como perfil social e mantém o negócio como candidato; agregadores de links ficam pendentes de conferência. Campo vazio não confirma ausência de site, cardápio ou pedidos.

Quando a identificação é confiável, `businessStatus` indica se o estabelecimento está **fechado permanentemente** ou **fechado temporariamente**. Ambos ficam na seção **Fora da prospecção**, com o motivo visível, antes de considerar o site. Essa verificação usa a mesma chamada; não há custo de uma segunda consulta. O status não corresponde ao horário em que o comércio está fechado naquele dia. Correspondências incertas não declaram o candidato fechado. Os dados Google continuam efêmeros e podem estar desatualizados.

### Limites para preservar a faixa gratuita

A [tabela oficial](https://developers.google.com/maps/billing-and-pricing/pricing), consultada em **27/10/2026**, informa **1.000 consultas gratuitas por mês** para Text Search Enterprise. Esta instalação bloqueia antes de consultar ao atingir qualquer um dos limites:

- **25 tentativas por dia**;
- **900 tentativas no mês**;
- **900 tentativas em qualquer período de 32 dias**.

O dia e o mês seguem **America/Los_Angeles**, como a [franquia do Google](https://developers.google.com/maps/billing-and-pricing/pay-as-you-go#free-usage-caps-and-volume-discounts). O limite diário permite no máximo 775 tentativas em um mês de 31 dias. O crédito de avaliação de US$300 por 90 dias não aumenta esses tetos. O código não consulta o saldo nem a validade dos créditos de avaliação.

Toda tentativa externa é contabilizada **antes** do envio, incluindo falhas, timeouts e negativas do Google. O controle fica em **`.local/places-usage.json`**, com arquivos auxiliares de inicialização e bloqueio; não guarda nomes, telefones, respostas Google ou credenciais. Reiniciar o servidor ou trocar a chave não zera o uso. Concorrência entre abas e processos respeita o mesmo contador. Corrupção, falha de gravação, relógio retrocedendo ou remoção isolada do contador bloqueiam consultas. Preserve a pasta `.local/` ao mover a instalação; recriar toda essa pasta perde o histórico local.

Para reduzir os limites, também são aceitas `PLACES_DAILY_LIMIT` e `PLACES_MONTHLY_LIMIT` em `.env`; zero desabilita novas chamadas. Valores acima de 25/dia ou 900/mês são recusados. Não existe opção de liberar automaticamente a faixa paga.

**O limite é local, não um limite da conta Google.** A franquia é compartilhada entre projetos da mesma conta de faturamento; usos anteriores, outros aplicativos, outras instalações e serviços Google não são visíveis por esta chave. Para uma segunda camada, ajuste a cota diária do método Text Search no Google Cloud para **25**, quando essa cota estiver disponível, e revise os demais usos da conta. Um projeto dedicado ajuda a separar o consumo, mas não cria outra franquia para a mesma conta. [Orçamentos e alertas não bloqueiam gastos automaticamente](https://developers.google.com/maps/billing-and-pricing/manage-costs).

### Tratamento dos resultados Google

As consultas abrem em uma aba Google reutilizada, sem fechar a lista local nem mostrar dados Google no mapa OpenStreetMap. **Voltar à busca local** foca a lista e mantém a aba de resultados aberta. **Rever consulta** retorna ao resultado disponível nessa aba, sem repetir a chamada. Cada cartão mostra os dados encontrados, inclusive site, endereço, telefone e funcionamento quando informados.

A lista registra **Google consultado**, com data e um atalho para a ficha no Maps quando houve correspondência segura. Esse histórico guarda no navegador somente o ID de origem OpenStreetMap, a data da ação e o Place ID; não guarda nomes, sites, telefones, endereços ou conclusões fornecidos pela API. Place IDs estão isentos da restrição de armazenamento nas [políticas Places](https://developers.google.com/maps/documentation/places/web-service/policies). Abrir a ficha usa [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started), sem chave nem chamada à Places API. Em correspondências incertas, o atalho faz uma busca com o nome e a cidade originais, sem associar uma ficha não confirmada.

**Ignorar na minha lista** salva sua decisão e retira o estabelecimento da fila local e das próximas consultas. **Manter para revisar** salva o candidato original, preservando notas, etapas e revisões existentes. Essas decisões são suas; não copiam o conteúdo Google para a lista nem qualificam automaticamente uma oportunidade.

Os detalhes completos ficam na memória das páginas abertas, com uma cópia em memória na busca local para a aba Google. Recarregar ou reabrir a aba Google restaura os detalhes enquanto a busca local permanecer aberta, sem nova chamada. A página do mapa não exibe esses dados. Se não restar uma página com a sessão em memória, os detalhes se perdem; o histórico, o atalho e suas decisões continuam no navegador. O conteúdo Google não entra no localStorage, sessionStorage, CSV, backup ou cache de buscas. **Rever consulta** nunca faz outra chamada automaticamente quando há histórico; para atualizar dados, use **Atualizar dados (1 chamada)** quando o resultado estiver disponível, ou **Consultar novamente (1 chamada)** quando só houver histórico. Candidatos novos podem ser selecionados para lotes. Falhas não são registradas como conferências concluídas e continuam sujeitas aos limites de tentativas. O histórico de consultas não faz parte do backup; as decisões de ignorar e as revisões pessoais fazem.

A separação dos resultados e a retenção temporária seguem as orientações de exibição e armazenamento das [políticas Places](https://developers.google.com/maps/documentation/places/web-service/policies) e nos [termos específicos](https://cloud.google.com/maps-platform/terms/maps-service-terms). A API não expõe todos os links vistos na interface do Maps e a integração não comprova ausência online. O uso do Google está sujeito aos [termos gerais](https://cloud.google.com/maps-platform/terms); a integração não autoriza copiar seus resultados para uma base permanente de leads.

## O que funciona

- Busca por cidade brasileira, nicho e raio.
- Negócios reais do OpenStreetMap via Overpass.
- Mapa, filtro por contato e ordenação.
- Detecção de links de site, cardápio, pedidos, reservas, redes sociais e agregadores de links disponíveis na fonte.
- Oportunidades separadas de candidatos ainda não verificados; sites e soluções online identificados impedem a qualificação. Redes sociais, sozinhas, não excluem candidatos.
- Busca e contexto de trabalho salvos automaticamente: empresas, cidade, nicho, raio, filtros, aba, seleção, mapa e posição da lista.
- Telefone, Instagram e WhatsApp quando disponíveis.
- Lista pessoal com etapa, revisão de presença digital, evidências, notas e data de retorno.
- CSV dos resultados filtrados, com atribuição da fonte.
- Backup JSON para levar a lista a outro navegador ou computador.

A tela inicial **Oportunidades** mostra somente negócios para os quais você registrou uma revisão sem site ou solução online encontrada. A falta de um campo `website` no OpenStreetMap **não qualifica** um negócio. Site hospedado por terceiros, cardápio, sistema de pedidos e página de reservas contam como soluções e impedem a qualificação. Apenas Facebook, Instagram ou outra rede social pode indicar uma oportunidade para melhorar a presença online. Uma página de links exige conferir os destinos, sem exclusão automática.

Os registros sem site ou solução identificada, inclusive os que só têm redes sociais, ficam na aba **Verificar** até a revisão manual. Abra o negócio, confira o Google Maps (inclusive os botões Site, Cardápio e Pedir on-line) e busque nome e cidade na web e redes sociais. Para liberar uma oportunidade, registre que não encontrou site ou solução online e confirme os três itens de revisão. A data fica salva; editar notas ou etapa não a altera. Use **Refazer conferência** para registrar uma nova revisão com os três itens. Abrir e fechar o diálogo não salva nem qualifica o negócio.

Use **Ignorar** no cartão para retirar um estabelecimento da fila sem consultar o Google. Essa decisão fica salva neste navegador, vale nas próximas buscas e também o remove dos candidatos de consulta Google. Ela não afirma que o negócio tenha site ou esteja fechado. Abra **Ignorados** na fila, ou **Minha lista → Ignorados**, e use **Voltar a verificar** para desfazer. Notas e etapas são preservadas; o backup e o CSV de revisões incluem a decisão e a data, sem tratar ignorados como oportunidades.

Se encontrar uma solução, marque a presença existente e registre seu link opcionalmente. A exclusão fica salva no navegador e vale nas próximas buscas. Um site ou solução nova na fonte prevalece sobre uma revisão anterior sem site; uma rede social, sozinha, não bloqueia a oportunidade. Exclusões antigas baseadas apenas em redes sociais ou páginas de links voltam para revisão, preservando links, notas e etapas. Exclusões manuais feitas com os critérios novos continuam válidas. Em **Minha lista → Todas as revisões**, você pode consultar pendências e exclusões, sem tratá-las como oportunidades. Marcações antigas de “sem site” sem data de revisão precisam ser refeitas com os critérios atuais; notas e etapas são preservadas.

**A conferência completa continua necessária.** A integração Google opcional automatiza a consulta de sites cadastrados; sem ela, a conferência de Maps é manual. Nenhuma dessas fontes comprova ausência em toda a internet. Os dados podem estar incompletos ou desatualizados. Não é uma lista automaticamente validada de empresas sem site. Um telefone não confirma WhatsApp; a interface distingue número cadastrado como WhatsApp de uma tentativa com telefone.

## Dados e privacidade

A lista pessoal, as notas e a busca de trabalho ficam no **localStorage do navegador**, na origem em que você abriu o aplicativo. A aba mantém também uma cópia de seu próprio contexto em `sessionStorage`, para retomar o ponto correto ao voltar do Google. O servidor não guarda esses registros; na integração Google, guarda apenas os instantes das tentativas para limitar o consumo. Alterar host ou porta muda a origem do navegador: exporte Backup antes de trocar de endereço, navegador ou computador.

A busca salva **não expira com o cache de 15 minutos**: recarregar, sair para conferir no Google e voltar, fechar e abrir uma aba ou reiniciar o servidor não exige refazer a pesquisa. Os registros continuam candidatos, sem qualificação automática. Ao atualizar uma instalação antiga, a aplicação tenta recuperar a última busca OpenStreetMap ainda presente no cache, mesmo desatualizada, sem consultar os serviços novamente. A data original é mantida; dados já removidos do navegador não podem ser reconstruídos pelo servidor.

O rodapé informa se a busca ficou salva de forma permanente, apenas nesta aba ou se não pôde ser gravada. Se nenhuma cópia puder ser salva, a navegação para a conferência Google é bloqueada para preservar a fila aberta. Uma falha ao ler a lista pessoal também bloqueia sua sobrescrita; o botão Backup permite exportar o conteúdo original para recuperação. Gravações de notas, etapas e ignorados combinam somente as alterações realizadas com os dados mais recentes, preservando edições independentes em outras abas. Alterações ainda não salvas mantêm o diálogo aberto.

Para transferir uma lista entre instalações, exporte um arquivo em **Backup** na instalação de origem e use **Importar backup** na de destino. O backup inclui também a busca e o contexto de trabalho OpenStreetMap, sem respostas Google. A importação acrescenta IDs novos, preserva notas e etapas dos registros já existentes e restaura o contexto quando ele está presente. Backups antigos sem contexto continuam compatíveis. Sites e soluções importados também impedem a qualificação de um registro existente; perfis sociais são preservados sem exclusão automática.

O CSV respeita a aba e os filtros ativos e inclui o estado da presença digital, a qualificação, os links de evidência e a data da revisão. Um CSV de candidatos ou de todas as revisões inclui registros não qualificados, identificados como tal.

A busca precisa de internet e envia centro aproximado, raio e tipo de negócio ao Overpass. O mapa usa OpenFreeMap. O aplicativo não envia mensagens, não tem rastreamento e não solicita geolocalização do dispositivo. A data de retorno é um registro, sem notificação automática.

O cache de respostas reutilizáveis dura 15 minutos; a lista de trabalho salva é independente desse prazo. Consultas novas têm intervalo mínimo de 10 segundos. Cada consulta retorna até 600 registros brutos, não um censo de empresas. A cobertura e os contatos variam por região; os registros podem estar incompletos ou desatualizados.

## Desenvolver e testar

```bash
npm test
npm run check
```

Edite diretamente os arquivos de `dist/` e recarregue o navegador. Não há compilação.

| Caminho | Conteúdo |
| --- | --- |
| `dist/index.html` | Estrutura da interface |
| `dist/styles.css` | Estilos responsivos |
| `dist/app.mjs` | Interface, mapa, busca e persistência |
| `dist/domain.mjs` | Normalização, consultas, CSV e backup |
| `dist/workspace.mjs` | Busca OpenStreetMap e contexto de trabalho preservados no navegador |
| `dist/lead-store.mjs` | Gravação da lista pessoal sem sobrescrever dados ilegíveis ou edições independentes de outras abas |
| `tests/` | Testes de domínio e servidor local |
| `scripts/prepare-assets.mjs` | Aquisição reproduzível de bibliotecas e municípios |
| `scripts/serve.mjs` | Servidor HTTP local sem dependências |
| `scripts/places.mjs` | Consulta Google opcional e controle persistente de consumo |
| `dist/google.html`, `dist/google.mjs`, `dist/google.css` | Conferência Google sem mapa e sem persistência dos resultados |
| `dist/google-history.mjs` | Histórico da ação de consulta e Place IDs, sem guardar conteúdo Places |
| `dist/google-results.mjs` | Classificação dos links e sessão de resultados em memória entre páginas abertas |
| `scripts/assets-manifest.mjs` | Fontes e versões dos arquivos externos |

`dist/vendor/` e `dist/cities.json` são preparados automaticamente e ignorados pelo Git. Para recriá-los com as mesmas versões, use `npm run prepare:assets`. Para atualizar uma dependência, altere o manifesto e execute `npm run prepare:assets -- --force`.

## Hospedagem

Prepare os arquivos:

```bash
npm run prepare:assets
```

Publique o conteúdo de `dist/` em um servidor estático. A busca OpenStreetMap não exige autenticação, banco de dados ou backend específico. A conferência Google exige o servidor Node local e `.env`; ela fica indisponível em hospedagem somente estática. Mapas e buscas continuam dependendo de conexão com os serviços externos descritos abaixo.

## Fontes e licenças de terceiros

- Negócios: © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL.
- Mapa base: [OpenFreeMap](https://openfreemap.org/) / © OpenMapTiles / OpenStreetMap.
- [Leaflet 1.9.4](https://github.com/Leaflet/Leaflet), licença BSD-2-Clause.
- [MapLibre GL JS 5.6.1](https://github.com/maplibre/maplibre-gl-js), licenças incluídas na distribuição.
- [MapLibre GL Leaflet 0.1.1](https://github.com/maplibre/maplibre-gl-leaflet), licença da distribuição.
- [Leaflet.VectorGrid 1.3.0](https://github.com/Leaflet/Leaflet.VectorGrid), Beerware.
- [Municípios Brasileiros](https://github.com/kelvins/Municipios-Brasileiros), MIT, cópia fixada por commit no manifesto.

As licenças são baixadas junto com os arquivos para `dist/vendor/`. O mapa usa renderização simplificada por Canvas quando WebGL não está disponível. As fontes tipográficas opcionais vêm do Google Fonts, com fallback para fontes do sistema.
