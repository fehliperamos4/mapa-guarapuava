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
let features = [];
let map;
let mapLayers;
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
