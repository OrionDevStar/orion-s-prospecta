# Prospecta · Orion

Ferramenta pessoal para encontrar negócios locais e organizar prospecção. Esta é a referência do código do Prospecta: você pode clonar, modificar e hospedar por conta própria, sem login do ChatGPT e sem chave de API.

## Rodar no seu computador

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

O servidor escuta somente em `127.0.0.1` por padrão. Caso queira expor em outra interface, configure `HOST` conscientemente. Ele serve somente a pasta `dist/`.

## O que funciona

- Busca por cidade brasileira, nicho e raio.
- Negócios reais do OpenStreetMap via Overpass.
- Mapa, filtros por site e contato e ordenação.
- Telefone, Instagram e WhatsApp quando disponíveis.
- Lista pessoal com etapa, verificação de site, notas e data de retorno.
- CSV dos resultados filtrados, com atribuição da fonte.
- Backup JSON para levar a lista a outro navegador ou computador.

“Sem site informado” significa ausência do campo no cadastro consultado. Confira a presença digital antes de abordar. Um telefone não confirma WhatsApp; a interface distingue número cadastrado como WhatsApp de uma tentativa com telefone.

## Dados e privacidade

A lista pessoal, as notas e o cache ficam no **localStorage do navegador**, na origem em que você abriu o aplicativo. Não há banco de dados no servidor. Alterar host ou porta muda essa origem: exporte Backup antes de trocar de endereço, navegador ou computador.

A lista da publicação anterior em ChatGPT Sites não migra automaticamente para localhost. Exporte o Backup lá e use **Importar backup** aqui. A importação acrescenta IDs novos e preserva os registros já existentes.

A busca precisa de internet e envia centro aproximado, raio e tipo de negócio ao Overpass. O mapa usa OpenFreeMap. O aplicativo não envia mensagens, não tem rastreamento e não solicita geolocalização do dispositivo. A data de retorno é um registro, sem notificação automática.

O cache dura 15 minutos. Consultas novas têm intervalo mínimo de 10 segundos. Cada consulta retorna até 600 registros brutos, não um censo de empresas. A cobertura e os contatos variam por região; os registros podem estar incompletos ou desatualizados.

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
| `tests/` | Testes de domínio e servidor local |
| `scripts/prepare-assets.mjs` | Aquisição reproduzível de bibliotecas e municípios |
| `scripts/serve.mjs` | Servidor HTTP local sem dependências |
| `scripts/assets-manifest.mjs` | Fontes e versões dos arquivos externos |

`dist/vendor/` e `dist/cities.json` são preparados automaticamente e ignorados pelo Git. Para recriá-los com as mesmas versões, use `npm run prepare:assets`. Para atualizar uma dependência, altere o manifesto e execute `npm run prepare:assets -- --force`.

## Hospedar por conta própria

Prepare os arquivos:

```bash
npm run prepare:assets
```

Publique o conteúdo de `dist/` em qualquer servidor estático. Não é preciso API do ChatGPT, autenticação OpenAI ou backend específico. A publicação anterior em ChatGPT Sites **não recebe deploy automático a partir deste GitHub**.

## Fontes e licenças de terceiros

- Negócios: © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright), ODbL.
- Mapa base: [OpenFreeMap](https://openfreemap.org/) / © OpenMapTiles / OpenStreetMap.
- [Leaflet 1.9.4](https://github.com/Leaflet/Leaflet), licença BSD-2-Clause.
- [MapLibre GL JS 5.6.1](https://github.com/maplibre/maplibre-gl-js), licenças incluídas na distribuição.
- [MapLibre GL Leaflet 0.1.1](https://github.com/maplibre/maplibre-gl-leaflet), licença da distribuição.
- [Leaflet.VectorGrid 1.3.0](https://github.com/Leaflet/Leaflet.VectorGrid), Beerware.
- [Municípios Brasileiros](https://github.com/kelvins/Municipios-Brasileiros), MIT, cópia fixada por commit no manifesto.

As licenças são baixadas junto com os arquivos para `dist/vendor/`. O mapa usa renderização simplificada por Canvas quando WebGL não está disponível. As fontes tipográficas opcionais vêm do Google Fonts, com fallback para fontes do sistema.
