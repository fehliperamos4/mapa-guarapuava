'use strict';

const select = document.getElementById('unit');
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
let features = [];
let map;
let mapLayers;
let addressMarker;
const addressCache = new Map();
let selectedIndex = null;
let visible = [];
let view = 'microareas';
const coverageColors = ['#34836b', '#d98751', '#667fbe', '#c76b7d', '#a7834b', '#688d61', '#8c72a2', '#438f9c', '#c47f4a'];
const typeNames = { microarea: 'Microárea', abrangencia: 'Área de abrangência', outro: 'Unidade / ponto' };

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

async function findAddresses(search, cacheKey) {
  const cached = addressCache.get(cacheKey);
  if (cached) return cached;

  try {
    const params = new URLSearchParams({ q: search, lat: '-25.3905', lon: '-51.4655', limit: '5', lang: 'default' });
    const data = await fetchAddressJson(`https://photon.komoot.io/api/?${params}`, 7000);
    if (!Array.isArray(data.features)) throw new Error('Resposta inválida do serviço de busca');
    addressCache.set(cacheKey, data.features);
    return data.features;
  } catch (error) {
    // Geosearch results from Esri are displayed temporarily and are not cached.
    const params = new URLSearchParams({
      SingleLine: search, f: 'json', outFields: 'Match_addr', maxLocations: '5',
      forStorage: 'false', sourceCountry: 'BRA', outSR: '4326'
    });
    const data = await fetchAddressJson(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?${params}`, 20000);
    if (data.error || !Array.isArray(data.candidates)) throw new Error('Serviço alternativo indisponível');
    return data.candidates.map(candidate => ({
      geometry: { type: 'Point', coordinates: [candidate.location?.x, candidate.location?.y] },
      properties: { address: candidate.address }
    }));
  }
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
    const cacheKey = search.toLocaleLowerCase('pt-BR');
    const results = (await findAddresses(search, cacheKey)).filter(result => {
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
      const label = addressLabel(result.properties || {}) || 'Local sem endereço detalhado';
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
        addressStatus.textContent = 'Endereço localizado no mapa. A posição pode ser aproximada; confirme o número e a rua.';
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
  visible = features.map((feature, index) => ({ feature, index })).filter(({ feature }) =>
    (!unit || feature.properties.ubs === unit) &&
    (view === 'abrangencias' ? feature.properties.tipo === 'abrangencia' : feature.properties.tipo !== 'abrangencia')
  );
  if (map) map.closePopup();
  selectedIndex = null;
  if (unit) showGeneral(unit); else showEmptyDetail();
  mapTitle.textContent = unit || 'Todo o território';
  listTitle.textContent = view === 'abrangencias' ? 'Áreas das UBS' : 'Microáreas e pontos';
  viewButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
  viewHelp.textContent = view === 'abrangencias'
    ? 'Selecione a área de uma UBS para ver as informações da unidade.'
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
    const response = await fetch('mapa.json');
    if (!response.ok) throw new Error('Falha ao carregar os dados');
    const data = await response.json();
    features = data.features || [];
    const units = [...new Set(features.map(f => f.properties.ubs).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    for (const unit of units) { const option = make('option', '', unit); option.value = unit; select.append(option); }
    if (typeof L !== 'undefined') {
      map = L.map('map', { zoomControl: true, scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    } else document.getElementById('map-error').hidden = false;
    select.addEventListener('change', () => render());
    viewButtons.forEach(button => button.addEventListener('click', () => {
      if (view !== button.dataset.view) { view = button.dataset.view; render(false); }
    }));
    generalButton.addEventListener('click', () => { if (select.value) showGeneral(select.value); });
    document.getElementById('overview').addEventListener('click', () => { select.value = ''; render(); });
    render();
  } catch (error) {
    list.replaceChildren(make('p', 'empty', 'Não foi possível carregar as áreas. Tente novamente.'));
    document.getElementById('map-error').hidden = false;
    console.error(error);
  }
}
start();

