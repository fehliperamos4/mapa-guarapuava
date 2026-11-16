'use strict';

const select = document.getElementById('unit');
const microareaFilter = document.getElementById('mobile-microarea-filter');
const microareaSelect = document.getElementById('mobile-microarea');
const list = document.getElementById('feature-list');
const count = document.getElementById('count');
const mapTitle = document.getElementById('map-title');
const listTitle = document.getElementById('list-title');
const details = document.getElementById('detail-content');
const detailTitle = document.getElementById('detail-title');
const generalButton = document.getElementById('show-general');
const viewButtons = [...document.querySelectorAll('.map-view-button')];
const viewHelp = document.getElementById('view-help');
const addressForm = document.getElementById('address-search');
const addressInput = document.getElementById('address-query');
const addressButton = document.getElementById('address-submit');
const addressStatus = document.getElementById('address-status');
const addressResults = document.getElementById('address-results');
const registryGrid = document.getElementById('registry-grid');
const registryKpis = document.getElementById('registry-kpis');
const registryCount = document.getElementById('registry-count');
const registryMissingUnits = document.getElementById('registry-missing-units');
let features = [];
let map;
let mapLayers;
let addressMarker;
let selectedIndex = null;
let visible = [];
let view = 'microareas';
const coverageColors = ['#34836b', '#d98751', '#667fbe', '#c76b7d', '#a7834b', '#688d61', '#8c72a2', '#438f9c', '#c47f4a'];
const typeNames = { microarea: 'Microárea', area_descoberta: 'Área descoberta', abrangencia: 'Área de cobertura', outro: 'Unidade / ponto' };

const missingRegistryUnitNames = [
  'ESF ADAO KAMINSKI', 'ESF BOQUEIRAO', 'ESF CAMPO VELHO', 'ESF CONCORDIA', 'ESF ENTRE RIOS',
  'ESF ENTRE RIOS II', 'ESF GUAIRACA', 'ESF JARDIM DAS AMERICAS', 'ESF JARDIM ARAUCARIA',
  'ESF JORDAO', 'ESF MORRO ALTO', 'ESF PALMEIRINHA', 'ESF PALMEIRINHA VOLANTE', 'ESF PAZ E BEM',
  'ESF PLANALTO', 'ESF RESIDENCIAL 2000', 'ESF RIO DAS PEDRAS', 'ESF SANTANA', 'ESF SANTA CRUZ',
  'ESF SAO CRISTOVAO', 'ESF SAO MIGUEL', 'ESF TANCREDO NEVES', 'ESF VILA BELA', 'ESF VILA CARLI',
  'ESF VILA COLIBRI'
];

const registryNotes = {
  'UBS BONSUCESSO': 'A abrangência declara 2 áreas descobertas e 977 pessoas. Os 2 polígonos de Adriano são uma única área descoberta, conforme esclarecido pelo responsável. Só essa área está identificável nesta cópia; a segunda área declarada não tem desenho reconhecível. A soma das microáreas (7.987) fica 66 abaixo do campo da abrangência (8.053).',
  'UBS FEROZ': 'A abrangência registra 3.818 pessoas no total, 3.562 nas microáreas e 252 em área descoberta. A soma desses dois últimos valores é 3.814: diferença de 4 mantida conforme decisão do responsável pelo mapa. A área descoberta é informada, mas seu polígono não aparece nesta cópia.',
  'UBS GUARÁ': 'As 5 microáreas aparecem em 27 recortes de polígonos. Aqui cada ACS e população aparecem uma única vez. A soma das microáreas é 2.536; o total registrado na abrangência é 2.553 (diferença de 17).',
  'UBS PARQUE DAS ÁRVORES': 'A soma das 7 microáreas é 4.264; a abrangência registra 4.265 (diferença de 1). Silmara tem 392 pessoas registradas. O parâmetro de 400 pessoas não é um mínimo federal vigente.',
  'UBS RECANTO FELIZ': 'A soma das 8 microáreas é 5.139; a abrangência registra 5.180 (diferença de 41).',
  'UBS XARQUINHO I': 'Neste território, o rótulo “Usuários” foi interpretado como cadastrados, conforme esclarecido pelo responsável. A soma das 10 microáreas é 5.659. A abrangência registra 6.352 no total e 686 pessoas em 2 áreas descobertas; os dois desenhos dessas áreas mostram 102 + 447 = 549 (diferença de 137). Total menos descobertos informados resulta em 5.666, 7 acima da soma das microáreas.',
  'UBS XARQUINHO II DOURADOS': 'Os 2 recortes de polígono com o mesmo nome representam uma única área descoberta. O total da abrangência (4.154) corresponde às 3.922 pessoas nas microáreas mais as 232 informadas para a área descoberta.',
  'UBS XARQUINHO II PINHEIROS': 'A soma das 4 microáreas é 2.920; a abrangência registra 2.943 (diferença de 23).'
};

function featureColor(feature) {
  if (feature.properties.tipo !== 'abrangencia') return feature.properties.style?.color || '#82a580';
  const index = features.filter(f => f.properties.tipo === 'abrangencia').indexOf(feature);
  return coverageColors[index % coverageColors.length];
}

function make(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = value;
  return element;
}

function addressLabel(properties) {
  if (typeof properties.address === 'string' && properties.address.trim()) return properties.address.trim();
  const street = [properties.street, properties.housenumber].filter(Boolean).join(', ');
  const parts = [properties.name, street, properties.district, properties.city, properties.state];
  return [...new Set(parts.filter(part => typeof part === 'string' && part.trim()).map(part => part.trim()))].join(' · ');
}

async function fetchAddressJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Serviço indisponível (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function findAddresses(search) {
  try {
    // Geosearch results from Esri are displayed temporarily and are not cached.
    const params = new URLSearchParams({
      SingleLine: search, f: 'json', outFields: 'Match_addr,AddNum,Addr_type', maxLocations: '5',
      forStorage: 'false', sourceCountry: 'BRA', outSR: '4326'
    });
    const data = await fetchAddressJson(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params}`, 12000);
    if (data.error || !Array.isArray(data.candidates)) throw new Error('Serviço indisponível');
    if (data.candidates.length) return data.candidates.map(candidate => ({
      geometry: { type: 'Point', coordinates: [candidate.location?.x, candidate.location?.y] },
      properties: { address: candidate.address, housenumber: candidate.attributes?.AddNum }
    }));
  } catch (error) {
    // Try the alternate service if the primary service cannot respond.
  }
  const params = new URLSearchParams({ q: search, lat: '-25.3905', lon: '-51.4655', limit: '5', lang: 'default' });
  const data = await fetchAddressJson(`https://photon.komoot.io/api/?${params}`, 20000);
  if (!Array.isArray(data.features)) throw new Error('Serviço alternativo indisponível');
  return data.features;
}

addressForm.addEventListener('submit', async event => {
  event.preventDefault();
  const query = addressInput.value.trim();
  if (!query || addressButton.disabled) return;
  if (!map) {
    addressStatus.textContent = 'O mapa ainda não está disponível. Verifique sua conexão e tente novamente.';
    return;
  }
  addressButton.disabled = true;
  addressForm.setAttribute('aria-busy', 'true');
  addressResults.replaceChildren();
  addressStatus.textContent = 'Buscando endereço...';
  try {
    const search = /guarapuava/i.test(query) ? query : `${query}, Guarapuava, Paraná`;
    const results = (await findAddresses(search)).filter(result => {
      const coordinates = result.geometry?.coordinates;
      return result.geometry?.type === 'Point' && Array.isArray(coordinates) && coordinates.length >= 2 &&
        Number.isFinite(coordinates[0]) && Math.abs(coordinates[0]) <= 180 &&
        Number.isFinite(coordinates[1]) && Math.abs(coordinates[1]) <= 90;
    });
    if (!results.length) {
      addressStatus.textContent = 'Nenhum endereço encontrado. Tente informar a rua, o número ou o bairro.';
      return;
    }
    addressStatus.textContent = results.length === 1
      ? 'Um resultado encontrado. Selecione e confira se o endereço está correto.'
      : `${results.length} resultados encontrados. Selecione e confira o endereço.`;
    results.forEach(result => {
      const properties = result.properties || {};
      const hasNumber = Boolean(properties.housenumber);
      const label = (addressLabel(properties) || 'Local sem endereço detalhado') + (hasNumber ? '' : ' (número não identificado)');
      const item = make('li', '');
      const button = make('button', 'address-result', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        const [longitude, latitude] = result.geometry.coordinates;
        if (addressMarker) map.removeLayer(addressMarker);
        const content = make('div', 'address-popup', label);
        addressMarker = L.marker([latitude, longitude]).addTo(map).bindPopup(content);
        map.setView([latitude, longitude], 17);
        addressMarker.openPopup();
        addressResults.replaceChildren();
        addressStatus.textContent = hasNumber
          ? 'Endereço localizado no mapa. A posição pode ser aproximada; confirme o número e a rua.'
          : 'Este resultado não inclui o número do imóvel. Confira a rua e tente informar mais detalhes.';
      });
      item.append(button);
      addressResults.append(item);
    });
  } catch (error) {
    addressStatus.textContent = 'Não foi possível consultar o serviço de endereços. Tente novamente em alguns instantes.';
    console.error(error);
  } finally {
    addressButton.disabled = false;
    addressForm.removeAttribute('aria-busy');
  }
});

// Preserve line breaks from My Maps descriptions without rendering their HTML.
function descriptionText(html) {
  const parsed = new DOMParser().parseFromString(html || '', 'text/html');
  parsed.querySelectorAll('script,style,iframe,object').forEach(el => el.remove());
  parsed.querySelectorAll('br').forEach(el => el.replaceWith('\n'));
  parsed.querySelectorAll('p,div,li,tr').forEach(el => el.append('\n'));
  parsed.querySelectorAll('td,th').forEach(el => el.append(' '));
  return parsed.body.textContent.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeRegistryFeatureTypes() {
  for (const feature of features) {
    const p = feature.properties;
    const name = (p.name || '').toLocaleUpperCase('pt-BR');
    if (name.startsWith('ÁREA DESCOBERTA') || (p.ubs === 'UBS BONSUCESSO' && name.includes('ADRIANO'))) {
      p.tipo = 'area_descoberta';
    }
    // The Guará point was associated with a duplicated label in the JSON.
    if (p.ubs === 'UBS GUARÁ - UBS GUARÁ' && name.includes('ESF GUARÁ')) p.ubs = 'UBS GUARÁ';
  }
}

function registryFields(description) {
  const sections = { total: {}, covered: {}, uncovered: {}, domiciles: {} };
  let current = 'total';
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR');
  for (const line of descriptionText(description).split('\n')) {
    const normalized = normalize(line.trim());
    if (normalized.includes('MICROAREAS COBERTAS')) { current = 'covered'; continue; }
    if (normalized.includes('AREAS DESCOBERTAS')) { current = 'uncovered'; continue; }
    if (normalized.includes('DOMICILIOS')) { current = 'domiciles'; continue; }
    if (normalized.includes('TOTAL DA UBS')) { current = 'total'; continue; }
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const label = normalize(line.slice(0, separator).trim());
    const value = line.slice(separator + 1).trim();
    if (label) sections[current][label] = value;
  }
  return sections;
}

function registryNumber(value) {
  if (value == null || !String(value).trim() || /NAO INFORMADO/i.test(value)) return null;
  const digits = String(value).trim().replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

function registryValue(section, labels) {
  for (const label of labels) {
    const value = section[label];
    if (value != null) return value;
  }
  return null;
}

function formatRegistryNumber(value) {
  return value == null ? 'Não informado' : new Intl.NumberFormat('pt-BR').format(value);
}

function featureRegistryInfo(feature) {
  const p = feature.properties;
  const sections = registryFields(p.description);
  const population = registryNumber(registryValue(sections.total, ['CADASTRADOS', 'USUARIOS']));
  const number = registryValue(sections.total, ['MICROAREA']);
  const name = (p.name || 'ACS não identificado').replace(/\s+-\s+PARTE\s+\d+\s+-\s+UBS\s+.+$/i, '').replace(/\s+-\s+UBS\s+.+$/i, '').trim();
  return { feature, sections, population, number: number == null ? '' : number.trim(), name };
}

function logicalFeatureGroups(items, discovered = false) {
  const groups = new Map();
  for (const feature of items) {
    const info = featureRegistryInfo(feature);
    const p = feature.properties;
    let logicalName = (p.name || '').replace(/\s+-\s+PARTE\s+\d+(?=\s+-\s+UBS\b)/i, '').trim();
    const key = discovered
      ? `${p.ubs}|${logicalName}`
      : `${p.ubs}|${logicalName}|${info.number}|${info.population}`;
    if (!groups.has(key)) groups.set(key, { ...info, features: [] });
    groups.get(key).features.push(feature);
  }
  return [...groups.values()];
}

function appendRegistryStat(container, label, value, className = '') {
  const stat = make('div', `registry-stat ${className}`.trim());
  stat.append(make('span', 'registry-stat-label', label), make('strong', 'registry-stat-value', value));
  container.append(stat);
}

function renderRegistryCard(coverage) {
  const unit = coverage.properties.ubs || coverage.properties.name || 'Unidade sem nome';
  const sections = registryFields(coverage.properties.description);
  const totalPopulation = registryNumber(registryValue(sections.total, ['CADASTRADOS', 'USUARIOS']));
  const declaredDiscoveredAreas = registryNumber(registryValue(sections.uncovered, ['AREAS']));
  const declaredDiscoveredPopulation = registryNumber(registryValue(sections.uncovered, ['CADASTRADOS', 'USUARIOS']));
  const records = features.filter(feature => feature.properties.ubs === unit && feature.properties.tipo === 'microarea');
  const uncoveredFeatures = features.filter(feature => feature.properties.ubs === unit && feature.properties.tipo === 'area_descoberta');
  const microareas = logicalFeatureGroups(records).sort((a, b) => {
    const numberA = Number(a.number.replace(/\D/g, '')) || Number.MAX_SAFE_INTEGER;
    const numberB = Number(b.number.replace(/\D/g, '')) || Number.MAX_SAFE_INTEGER;
    return numberA - numberB || a.name.localeCompare(b.name, 'pt-BR');
  });
  const uncoveredAreas = logicalFeatureGroups(uncoveredFeatures, true);
  const discoveredAreaCount = unit === 'UBS BONSUCESSO' ? 1 : (declaredDiscoveredAreas ?? uncoveredAreas.length);
  const discoveredPopulation = declaredDiscoveredPopulation;
  const card = make('details', 'registry-card');
  const summary = make('summary', 'registry-card-summary');
  const title = make('div', 'registry-card-title');
  title.append(make('h4', '', unit), make('span', 'registry-total-pill', `${formatRegistryNumber(totalPopulation)} no total da abrangência`));
  const highlights = make('div', 'registry-card-highlights');
  appendRegistryStat(highlights, 'Microáreas', formatRegistryNumber(microareas.length));
  appendRegistryStat(highlights, 'Áreas descobertas', String(discoveredAreaCount));
  summary.append(title, highlights, make('span', 'registry-toggle', '＋'));
  card.append(summary);

  const body = make('div', 'registry-card-body');
  const metrics = make('div', 'registry-card-metrics');
  appendRegistryStat(metrics, 'Total da unidade', formatRegistryNumber(totalPopulation));
  appendRegistryStat(metrics, 'Microáreas', formatRegistryNumber(microareas.length));
  appendRegistryStat(metrics, 'Pessoas em áreas descobertas', formatRegistryNumber(discoveredPopulation));
  body.append(metrics);

  const microareaSection = make('section', 'registry-microareas');
  microareaSection.append(make('h5', '', `Microáreas por ACS · ${formatRegistryNumber(microareas.length)}`));
  const rows = make('ul', 'registry-microarea-list');
  for (const area of microareas) {
    const row = make('li', 'registry-microarea-row');
    const description = make('span', 'registry-microarea-description');
    const microareaLabel = area.number ? `Microárea ${area.number.padStart(2, '0')}` : 'Microárea';
    description.append(make('strong', '', area.name), make('span', '', microareaLabel));
    const countBlock = make('span', 'registry-microarea-count');
    countBlock.append(make('strong', '', formatRegistryNumber(area.population)));
    countBlock.append(make('span', '', 'cadastrados'));
    const locateMicroarea = make('button', 'registry-microarea-map-button', 'Ver no mapa ↗');
    locateMicroarea.type = 'button';
    locateMicroarea.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      select.value = unit;
      view = 'microareas';
      render(false);
      const index = features.indexOf(area.feature);
      if (index >= 0) choose(index, true);
      document.querySelector('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    countBlock.append(locateMicroarea);
    row.append(description, countBlock);
    rows.append(row);
  }
  if (!microareas.length) rows.append(make('li', 'registry-no-data', 'Nenhuma microárea identificada nesta cópia.'));
  microareaSection.append(rows);
  body.append(microareaSection);

  const discoveredSection = make('section', 'registry-discovered');
  const discoveredHeading = make('div', 'registry-discovered-heading');
  discoveredHeading.append(make('h5', '', 'Áreas descobertas'), make('span', '', `${discoveredAreaCount} ${discoveredAreaCount === 1 ? 'área' : 'áreas'} · ${formatRegistryNumber(discoveredPopulation)} pessoas`));
  discoveredSection.append(discoveredHeading);
  if (uncoveredAreas.length) {
    const uncoveredList = make('ul', 'registry-uncovered-list');
    for (const area of uncoveredAreas) {
      const uncoveredName = area.feature.properties.ubs === 'UBS BONSUCESSO' && area.name.includes('ADRIANO')
        ? 'Área de Adriano'
        : area.name.replace(/^ÁREA DESCOBERTA\s*-?\s*/i, '').replace(/\s+-\s+UBS\s+.+$/i, '').trim() || 'Área descoberta identificada';
      const item = make('li', 'registry-uncovered-row');
      const pieceCount = area.features.length;
      const isBonsucesso = unit === 'UBS BONSUCESSO' && area.name.includes('ADRIANO');
      const populationText = isBonsucesso
        ? '2 pontos · 977 pessoas'
        : area.population == null ? 'Pessoas não informadas' : `${formatRegistryNumber(area.population)} pessoas`;
      item.append(make('strong', '', uncoveredName), make('span', '', populationText));
      uncoveredList.append(item);
    }
    discoveredSection.append(uncoveredList);
  }
  if (!discoveredAreaCount) discoveredSection.append(make('p', 'registry-no-data', 'A abrangência registra zero áreas descobertas.'));
  else if (discoveredAreaCount > uncoveredAreas.length) {
    const missingGeometryCount = discoveredAreaCount - uncoveredAreas.length;
    discoveredSection.append(make('p', 'registry-missing-shape', `${missingGeometryCount} ${missingGeometryCount === 1 ? 'área declarada não tem' : 'áreas declaradas não têm'} um polígono identificável nesta cópia.`));
  } else if (!uncoveredAreas.length) {
    discoveredSection.append(make('p', 'registry-missing-shape', 'A abrangência informa a área descoberta, mas o desenho não aparece nesta cópia.'));
  }
  body.append(discoveredSection);

  const actions = make('div', 'registry-card-actions');
  const locate = make('button', 'registry-map-button', 'Ver esta unidade no mapa ↗');
  locate.type = 'button';
  locate.addEventListener('click', () => {
    select.value = unit;
    view = 'microareas';
    render();
    document.querySelector('.workspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  actions.append(locate, make('span', 'registry-source', 'Fonte: cópia do My Maps · 15/11/2026'));
  body.append(actions);
  card.append(body);
  return { card, microareas, discoveredAreaCount };
}

function renderRegistry() {
  if (!registryGrid || !registryKpis) return;
  const coverages = features.filter(feature => feature.properties.tipo === 'abrangencia')
    .sort((a, b) => (a.properties.ubs || '').localeCompare(b.properties.ubs || '', 'pt-BR'));
  registryGrid.replaceChildren();
  const cards = coverages.map(renderRegistryCard);
  for (const result of cards) registryGrid.append(result.card);
  const totalMicroareas = cards.reduce((sum, result) => sum + result.microareas.length, 0);
  registryKpis.replaceChildren();
  const totalDiscoveredAreas = cards.reduce((sum, result) => sum + result.discoveredAreaCount, 0);
  const kpis = [
    ['Áreas de cobertura', String(coverages.length), 'unidades no mapa'],
    ['Microáreas', String(totalMicroareas), 'por ACS'],
    ['Áreas descobertas', String(totalDiscoveredAreas), 'nas unidades']
  ];
  for (const [label, value, note] of kpis) {
    const item = make('article', 'registry-kpi');
    item.append(make('span', 'registry-kpi-label', label), make('strong', 'registry-kpi-value', value), make('span', 'registry-kpi-note', note));
    registryKpis.append(item);
  }
  if (registryCount) registryCount.textContent = `${coverages.length} territórios · ${totalMicroareas} microáreas únicas`;
}

function showDetail(feature) {
  const p = feature.properties;
  detailTitle.textContent = 'Detalhes da área';
  generalButton.hidden = !select.value;
  details.replaceChildren();
  details.append(make('span', 'detail-type', typeNames[p.tipo] || 'Área'));
  details.append(make('h3', '', p.name || 'Área sem nome'));
  if (p.ubs) details.append(make('p', 'detail-unit', p.ubs));
  details.append(make('div', 'detail-label', 'Informações registradas'));
  const description = descriptionText(p.description);
  details.append(make('p', 'detail-description', description || 'Nenhuma informação adicional registrada nesta área.'));
  details.append(make('div', 'detail-label', 'Camada de origem'));
  details.append(make('p', 'detail-description', p.layer || 'Não informada'));
}

// Build the card from text nodes: descriptions in the source map may contain HTML.
function makeMapPopup(feature) {
  const p = feature.properties;
  const card = make('article', 'map-popup');
  card.append(make('span', 'map-popup-type', typeNames[p.tipo] || 'Área'));
  card.append(make('h3', 'map-popup-title', p.name || 'Área sem nome'));
  if (p.ubs && !p.name?.includes(p.ubs)) card.append(make('p', 'map-popup-unit', p.ubs));
  const info = make('div', 'map-popup-info');
  info.append(make('span', 'map-popup-label', p.tipo === 'abrangencia' ? 'Informações da unidade' : 'Informações'));
  info.append(make('p', 'map-popup-description', descriptionText(p.description) || 'Nenhuma informação adicional registrada nesta área.'));
  card.append(info);
  return card;
}

function showGeneral(unit) {
  selectedIndex = null;
  microareaSelect.value = '';
  if (map) map.closePopup();
  for (const button of list.querySelectorAll('button')) {
    button.classList.remove('active');
    button.setAttribute('aria-pressed', 'false');
  }
  detailTitle.textContent = 'Informações gerais';
  generalButton.hidden = true;
  details.replaceChildren();
  details.append(make('span', 'detail-type', 'Unidade de saúde'));
  details.append(make('h3', '', unit));
  const candidates = features.filter(f => f.properties.ubs === unit && ['abrangencia', 'outro'].includes(f.properties.tipo) && descriptionText(f.properties.description));
  const general = candidates.find(f => f.properties.tipo === 'abrangencia') || candidates[0];
  details.append(make('div', 'detail-label', 'Informações registradas'));
  details.append(make('p', 'detail-description', general ? descriptionText(general.properties.description) : 'Não há informações gerais identificadas para esta UBS nesta cópia do mapa.'));
  if (general) {
    details.append(make('div', 'detail-label', 'Fonte no mapa'));
    details.append(make('p', 'detail-description', general.properties.name));
  }
}

function showEmptyDetail() {
  detailTitle.textContent = 'Detalhes da área';
  generalButton.hidden = true;
  details.replaceChildren();
  const panel = make('div', 'detail-empty');
  panel.append(make('span', 'detail-symbol', '✳'));
  const copy = make('div');
  copy.append(make('h3', '', 'Escolha uma área'));
  copy.append(make('p', '', 'Ao selecionar uma área no mapa ou na lista, as informações disponíveis aparecem aqui.'));
  panel.append(copy); details.append(panel);
}

function choose(index, pan, position) {
  selectedIndex = index;
  const feature = features[index];
  microareaSelect.value = String(index);
  showDetail(feature);
  for (const button of list.querySelectorAll('button')) {
    const isSelected = Number(button.dataset.index) === index;
    button.classList.toggle('active', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  }
  if (map && mapLayers && mapLayers[index]) {
    const layer = mapLayers[index];
    const bounds = layer.getBounds && layer.getBounds();
    if (pan && bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16 });
    const popupPosition = position || (bounds && bounds.isValid() ? bounds.getCenter() : null);
    if (popupPosition) {
      L.popup({ className: 'area-popup', maxWidth: 320, minWidth: 220, maxHeight: 220, autoPanPadding: [20, 20] })
        .setLatLng(popupPosition).setContent(makeMapPopup(feature)).openOn(map);
    }
  }
}

function render(fitMap = true) {
  const unit = select.value;
  microareaFilter.hidden = !unit;
  microareaSelect.replaceChildren();
  const microareas = features.map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.properties.ubs === unit && feature.properties.tipo === 'microarea')
    .sort((a, b) => (a.feature.properties.name || '').localeCompare(b.feature.properties.name || '', 'pt-BR', { numeric: true }));
  const placeholder = make('option', '', microareas.length ? 'Todas as microáreas' : 'Nenhuma microárea disponível');
  placeholder.value = '';
  microareaSelect.append(placeholder);
  microareaSelect.disabled = !microareas.length;
  for (const { feature, index } of microareas) {
    const option = make('option', '', feature.properties.name || 'Microárea sem nome');
    option.value = String(index);
    microareaSelect.append(option);
  }
  visible = features.map((feature, index) => ({ feature, index })).filter(({ feature }) =>
    (!unit || feature.properties.ubs === unit) &&
    (view === 'abrangencias' ? feature.properties.tipo === 'abrangencia' : feature.properties.tipo !== 'abrangencia')
  );
  if (map) map.closePopup();
  selectedIndex = null;
  if (unit) showGeneral(unit); else showEmptyDetail();
  mapTitle.textContent = unit || 'Todo o território';
  listTitle.textContent = view === 'abrangencias' ? 'Áreas de cobertura' : 'Microáreas e pontos';
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  viewHelp.textContent = view === 'abrangencias'
    ? 'Selecione a área de cobertura de uma UBS para ver as informações da unidade.'
    : 'Selecione uma microárea para ver as informações.';
  count.textContent = `${visible.length} ${visible.length === 1 ? 'item' : 'itens'}`;
  list.replaceChildren();
  if (!visible.length) list.append(make('p', 'empty', 'Nenhum item encontrado nesta unidade.'));
  const sorted = [...visible].sort((a, b) => (a.feature.properties.name || '').localeCompare(b.feature.properties.name || '', 'pt-BR'));
  for (const { feature, index } of sorted) {
    const p = feature.properties;
    const button = make('button', 'feature-item'); button.type = 'button'; button.dataset.index = index; button.setAttribute('aria-pressed', 'false');
    const dot = make('span', 'feature-dot'); dot.style.backgroundColor = featureColor(feature);
    const copy = make('span', 'feature-copy'); copy.append(make('span', 'feature-name', p.name || 'Área sem nome')); copy.append(make('span', 'feature-type', typeNames[p.tipo] || 'Área'));
    button.append(dot, copy, make('span', 'feature-arrow', '↗'));
    button.addEventListener('click', () => choose(index, true));
    list.append(button);
  }
  if (!map) return;
  if (mapLayers) Object.values(mapLayers).forEach(layer => map.removeLayer(layer));
  mapLayers = {};
  const bounds = L.latLngBounds([]);
  for (const { feature, index } of visible) {
    const p = feature.properties;
    const color = featureColor(feature);
    const style = { ...p.style, color, fillColor: p.tipo === 'abrangencia' ? color : p.style?.fillColor, fillOpacity: p.tipo === 'abrangencia' ? 0.25 : (p.style?.fillOpacity ?? 0.3), opacity: 0.85, weight: p.tipo === 'abrangencia' ? 3 : (p.style?.weight || 2) };
    const group = L.geoJSON(feature, { style: () => style, pointToLayer: (_f, latlng) => L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: p.style?.color || '#246148', fillOpacity: 1 }) });
    group.eachLayer(layer => layer.on('click', event => choose(index, false, event.latlng)));
    group.addTo(map); mapLayers[index] = group;
    if (group.getBounds().isValid()) bounds.extend(group.getBounds());
  }
  if (fitMap && bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
}

async function start() {
  try {
    const response = await fetch('mapa.json?v=20261115-5');
    if (!response.ok) throw new Error('Falha ao carregar os dados');
    const data = await response.json();
    features = data.features || [];
    normalizeRegistryFeatureTypes();
    renderRegistry();
    const units = [...new Set(features.map(f => f.properties.ubs).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const unit of units) { const option = make('option', '', unit); option.value = unit; select.append(option); }
    if (typeof L !== 'undefined') {
      map = L.map('map', { zoomControl: true, scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    } else document.getElementById('map-error').hidden = false;
    select.addEventListener('change', () => render());
    microareaSelect.addEventListener('change', () => {
      const index = microareaSelect.value;
      if (index === '') { render(); return; }
      if (view !== 'microareas') { view = 'microareas'; render(false); }
      choose(Number(index), true);
    });
    viewButtons.forEach(button => button.addEventListener('click', () => {
      if (view !== button.dataset.view) { view = button.dataset.view; render(false); }
    }));
    generalButton.addEventListener('click', () => { if (select.value) showGeneral(select.value); });
    document.getElementById('overview').addEventListener('click', () => { select.value = ''; render(); });
    render();
  } catch (error) {
    list.replaceChildren(make('p', 'empty', 'Não foi possível carregar as áreas. Tente novamente.'));
    if (registryGrid) registryGrid.replaceChildren(make('p', 'registry-loading', 'Não foi possível carregar os dados das unidades.'));
    document.getElementById('map-error').hidden = false;
    console.error(error);
  }
}
start();

